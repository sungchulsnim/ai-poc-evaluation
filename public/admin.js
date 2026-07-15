const summaryGrid = document.querySelector("#summaryGrid");
const resultHead = document.querySelector("#resultHead");
const resultBody = document.querySelector("#resultBody");
const linkList = document.querySelector("#linkList");
const refreshButton = document.querySelector("#refreshButton");
const logoutButton = document.querySelector("#logoutButton");
const projectEditorList = document.querySelector("#projectEditorList");
const groupSettingsList = document.querySelector("#groupSettingsList");
const addProjectButton = document.querySelector("#addProjectButton");
const saveSettingsButton = document.querySelector("#saveSettingsButton");
const settingsMessage = document.querySelector("#settingsMessage");
const resetVotesButton = document.querySelector("#resetVotesButton");
const resetMessage = document.querySelector("#resetMessage");

let settings = null;
const DEFAULT_CRITERIA_WEIGHTS = {
  immediateUse: 50,
  businessEffect: 30,
  usability: 20
};

refreshButton.addEventListener("click", loadAll);
logoutButton.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  location.href = "/login";
});
addProjectButton.addEventListener("click", addProjectRow);
saveSettingsButton.addEventListener("click", saveSettings);
resetVotesButton.addEventListener("click", resetVotes);

await loadAll().catch(showLoadError);

async function loadAll() {
  const [results, appSettings] = await Promise.all([fetchJson("/api/results"), fetchJson("/api/admin/settings")]);
  settings = appSettings;
  document.title = `${results.contestName} 관리자`;
  renderSummary(results);
  renderResults(results);
  renderSettings(appSettings);
  if (await applyImportedProjectsFromHash()) return;
  renderLinks(results);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 401) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.hash)}`;
    return new Promise(() => {});
  }
  const data = await response.json();
  if (!data.ok) throw new Error(data.message || "데이터를 불러오지 못했습니다.");
  return data;
}

function showLoadError(error) {
  summaryGrid.innerHTML = `
    <article class="metric error-metric">
      <strong>확인 필요</strong>
      <span>${escapeHtml(error.message || "대시보드 데이터를 불러오지 못했습니다.")}</span>
    </article>
  `;
  resultBody.innerHTML = "";
  linkList.innerHTML = "";
}

function renderSummary(data) {
  const completion = data.expectedVoters
    ? `${Math.round((data.submissionCount / data.expectedVoters) * 100)}%`
    : "-";
  summaryGrid.innerHTML = [
    metric(data.submissionCount, "제출 완료"),
    metric(data.expectedVoters, "예상 참여자"),
    metric(completion, "참여율"),
    metric(`${data.projectCount}개`, "평가 과제")
  ].join("");
}

function metric(value, label) {
  return `<article class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`;
}

function renderResults(data) {
  const weights = data.criteriaWeights || DEFAULT_CRITERIA_WEIGHTS;
  const criteriaHeaders = data.criteria.map((criterion) => `
    <th class="criteria-weight-header">
      <span>${escapeHtml(criterion.title)}</span>
      <small>(${escapeHtml(weights[criterion.id] ?? 25)}%)</small>
    </th>
  `).join("");
  resultHead.innerHTML = `
    <tr>
      <th>순위</th>
      <th>과제명</th>
      <th>투표수</th>
      <th>최종점수</th>
      <th>원점수</th>
      ${criteriaHeaders}
    </tr>
  `;

  resultBody.innerHTML = data.rows.map((row) => {
    const criteriaCells = data.criteria
      .map((criterion) => `<td>${formatNumber(row.criteriaAverage[criterion.id])}</td>`)
      .join("");
    return `
      <tr>
        <td><span class="rank">${row.rank}</span></td>
        <td><strong>${escapeHtml(row.title)}</strong></td>
        <td>${row.voteCount}</td>
        <td><span class="score">${formatNumber(row.finalAverage)}</span></td>
        <td>${formatNumber(row.rawAverage)}</td>
        ${criteriaCells}
      </tr>
    `;
  }).join("");
}

function renderSettings(data) {
  renderProjectEditor(data.projects);
  renderGroupSettings(data.groups, data.projects);
}

async function applyImportedProjectsFromHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const rawProjects = params.get("projects");
  if (!rawProjects) return false;

  let titles = [];
  try {
    titles = JSON.parse(decodeURIComponent(rawProjects));
  } catch {
    titles = decodeURIComponent(rawProjects).split(/\r?\n/);
  }

  const importedProjects = titles
    .map(parseImportedProjectTitle)
    .filter((project) => project.title);

  const importedSettings = buildImportedSettings(importedProjects);
  if (!importedSettings.projects.length) return false;

  settings = { ...settings, ...importedSettings };
  renderProjectEditor(importedSettings.projects);
  renderGroupSettings(importedSettings.groups, importedSettings.projects);
  settingsMessage.textContent = `사다리 최종순서와 그룹별 제외 과제를 반영했습니다. ${formatImportMarkerSummary(importedSettings.markerCounts)} 자동 저장 중입니다.`;
  history.replaceState(null, "", location.pathname);
  await saveSettings({
    payload: importedSettings,
    successMessage: `사다리 최종순서, 그룹별 제외 과제, 과제명 표식 제거가 저장되었습니다. ${formatImportMarkerSummary(importedSettings.markerCounts)}`
  });
  return true;
}

function buildImportedSettings(importedProjects) {
  const existingIdsByTitle = new Map(
    (settings.projects || []).map((project) => [normalizeImportedProjectTitle(project.title), project.id])
  );
  const projects = importedProjects.map((project) => ({
    id: existingIdsByTitle.get(normalizeImportedProjectTitle(project.title)) || `project-${crypto.randomUUID()}`,
    title: project.title
  }));

  const markerCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const projectIdsByMarker = new Map();
  importedProjects.forEach((project, index) => {
    const marker = project.groupMarker;
    if (marker < 1 || marker > 5) return;
    markerCounts[marker] += 1;
    if (!projectIdsByMarker.has(marker)) projectIdsByMarker.set(marker, []);
    projectIdsByMarker.get(marker).push(projects[index].id);
  });

  const groups = ensureImportGroups(settings.groups).map((group) => {
    const groupNumber = Number(String(group.id || "").match(/\d+/)?.[0] || 0);
    const excludedProjectIds = groupNumber >= 1 && groupNumber <= 5 ? projectIdsByMarker.get(groupNumber) || [] : [];
    return { ...group, excludedProjectIds };
  });

  return { projects, groups, markerCounts };
}

function ensureImportGroups(groups = []) {
  const groupsByNumber = new Map();
  groups.forEach((group) => {
    const groupNumber = Number(String(group.id || "").match(/\d+/)?.[0] || 0);
    if (groupNumber >= 1 && groupNumber <= 6 && !groupsByNumber.has(groupNumber)) {
      groupsByNumber.set(groupNumber, group);
    }
  });

  return [1, 2, 3, 4, 5, 6].map((groupNumber) => (
    groupsByNumber.get(groupNumber) || {
      id: `group${groupNumber}`,
      name: `${groupNumber}그룹`,
      excludedProjectIds: []
    }
  ));
}

function formatImportMarkerSummary(markerCounts) {
  return [1, 2, 3, 4, 5]
    .map((groupNumber) => `${groupNumber}그룹 ${markerCounts[groupNumber] || 0}개`)
    .join(", ");
}

function parseImportedProjectTitle(value) {
  const rawTitle = String(value || "").replace(/[\u200B\uFEFF]/g, "").trim();
  const marker = rawTitle.match(/\s*_(\d+)\s*$/);
  return {
    title: rawTitle.replace(/\s*_\d+\s*$/, "").trim(),
    groupMarker: marker ? Number(marker[1]) : null
  };
}

function normalizeImportedProjectTitle(value) {
  return String(value || "")
    .replace(/\s*_\d+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function renderProjectEditor(projects) {
  projectEditorList.innerHTML = projects.map((project, index) => `
    <div class="project-editor-row" data-project-id="${escapeAttr(project.id)}">
      <span class="row-number">${index + 1}</span>
      <input type="text" value="${escapeAttr(project.title)}" aria-label="과제명">
      <button class="ghost-button icon-button" type="button" data-remove-project="${escapeAttr(project.id)}">삭제</button>
    </div>
  `).join("");

  projectEditorList.querySelectorAll("[data-remove-project]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest("[data-project-id]");
      row.remove();
      renumberProjectRows();
      syncGroupProjectOptions();
    });
  });

  projectEditorList.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", syncGroupProjectOptions);
  });
}

function renderGroupSettings(groups, projects) {
  groupSettingsList.innerHTML = groups.map((group) => groupSettingsHtml(group, projects)).join("");
}

function groupSettingsHtml(group, projects) {
  const excludedIds = new Set(group.excludedProjectIds || []);
  const rows = projects.map((project) => `
    <label class="exclude-row" data-project-option="${escapeAttr(project.id)}">
      <input type="checkbox" value="${escapeAttr(project.id)}" ${excludedIds.has(project.id) ? "checked" : ""}>
      <span>${escapeHtml(project.title)}</span>
    </label>
  `).join("");

  return `
    <article class="group-settings-card" data-group-id="${escapeAttr(group.id)}">
      <header>
        <strong>${escapeHtml(group.name)}</strong>
        <span class="muted">${escapeHtml(group.id)}</span>
      </header>
      <div class="exclude-list">${rows}</div>
    </article>
  `;
}

function addProjectRow() {
  const project = { id: `project-${crypto.randomUUID()}`, title: "" };
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="project-editor-row" data-project-id="${escapeAttr(project.id)}">
      <span class="row-number"></span>
      <input type="text" value="" aria-label="과제명" placeholder="새 과제명">
      <button class="ghost-button icon-button" type="button" data-remove-project="${escapeAttr(project.id)}">삭제</button>
    </div>
  `;
  const row = wrapper.firstElementChild;
  projectEditorList.append(row);
  row.querySelector("[data-remove-project]").addEventListener("click", () => {
    row.remove();
    renumberProjectRows();
    syncGroupProjectOptions();
  });
  row.querySelector("input").addEventListener("input", syncGroupProjectOptions);
  row.querySelector("input").focus();
  renumberProjectRows();
  syncGroupProjectOptions();
}

function renumberProjectRows() {
  projectEditorList.querySelectorAll(".project-editor-row").forEach((row, index) => {
    row.querySelector(".row-number").textContent = index + 1;
  });
}

function syncGroupProjectOptions() {
  const projects = collectProjects();
  const groups = collectGroups();
  renderGroupSettings(groups, projects);
}

async function saveSettings(options = {}) {
  settingsMessage.textContent = "";
  const projects = options.payload?.projects || collectProjects();
  if (!projects.length) {
    settingsMessage.textContent = "과제는 최소 1개 이상 필요합니다.";
    return;
  }

  const payload = {
    projects,
    groups: options.payload?.groups || collectGroups()
  };

  saveSettingsButton.disabled = true;
  saveSettingsButton.textContent = "저장 중";
  try {
    const response = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.message || "설정을 저장하지 못했습니다.");
    settingsMessage.textContent = options.successMessage || "설정이 저장되었습니다.";
    await loadAll();
  } catch (error) {
    settingsMessage.textContent = error.message || "설정을 저장하지 못했습니다.";
  } finally {
    saveSettingsButton.disabled = false;
    saveSettingsButton.textContent = "설정 저장";
  }
}

async function resetVotes() {
  resetMessage.textContent = "";
  const confirmText = prompt("제출된 모든 평가 정보를 삭제합니다. 계속하려면 '초기화'를 입력하세요.");
  if (confirmText === null) return;

  resetVotesButton.disabled = true;
  resetVotesButton.textContent = "초기화 중";
  try {
    const response = await fetch("/api/admin/reset-votes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmText })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.message || "초기화하지 못했습니다.");
    resetMessage.textContent = "평가 정보가 초기화되었습니다.";
    await loadAll();
  } catch (error) {
    resetMessage.textContent = error.message || "초기화하지 못했습니다.";
  } finally {
    resetVotesButton.disabled = false;
    resetVotesButton.textContent = "처음부터 다시시작";
  }
}

function collectProjects() {
  return [...projectEditorList.querySelectorAll(".project-editor-row")]
    .map((row) => ({
      id: row.dataset.projectId,
      title: row.querySelector("input").value.trim()
    }))
    .filter((project) => project.title);
}

function collectGroups() {
  return [...groupSettingsList.querySelectorAll("[data-group-id]")].map((card) => ({
    id: card.dataset.groupId,
    name: settings.groups.find((group) => group.id === card.dataset.groupId)?.name || card.dataset.groupId,
    excludedProjectIds: [...card.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value)
  }));
}

function renderLinks(data) {
  linkList.innerHTML = data.links.map((link) => {
    const url = `${location.origin}${link.path}`;
    const votes = data.groupVoteCounts[link.id] || 0;
    return `
      <article class="link-row">
        <div>
          <strong>${escapeHtml(link.name)} 투표 링크</strong>
          <a href="${escapeAttr(url)}">${escapeHtml(url)}</a>
          <div class="muted">제출 ${votes}건 · 제외 과제 ${link.excludedProjectCount}개</div>
        </div>
        <button class="ghost-button compact" type="button" data-copy="${escapeAttr(url)}">복사</button>
      </article>
    `;
  }).join("");

  linkList.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = "복사됨";
      setTimeout(() => {
        button.textContent = "복사";
      }, 1200);
    });
  });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
