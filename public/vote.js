const groupId = normalizeGroupId(location.pathname.split("/").filter(Boolean).pop() || "");
const deviceId = getOrCreateDeviceId();
const fingerprint = await buildFingerprint();
const pageTitle = document.querySelector("#pageTitle");
const teamName = document.querySelector("#teamName");
const notice = document.querySelector("#notice");
const doneState = document.querySelector("#doneState");
const voteForm = document.querySelector("#voteForm");
const projectList = document.querySelector("#projectList");
const progressText = document.querySelector("#progressText");
const progressDetail = document.querySelector("#progressDetail");
const submitButton = document.querySelector("#submitButton");
const draftButton = document.querySelector("#draftButton");
const findMissingButton = document.querySelector("#findMissingButton");

let config;
let answers = {};
let submitIntent = false;
let isSubmitting = false;

try {
  config = await loadConfig();
  const duplicate = await checkDuplicate();
  renderHeader();

  if (duplicate.alreadyVoted) {
    showDone(duplicate.votedAt);
  } else {
    restoreDraft();
    pruneAnswers();
    renderForm();
  }
} catch (error) {
  showNotice(error.message || "페이지를 불러오지 못했습니다.", true);
}

async function loadConfig() {
  const response = await fetch(`/api/config?group=${encodeURIComponent(groupId)}`, { cache: "no-store" });
  const data = await response.json();
  if (!data.ok) throw new Error(data.message || "유효하지 않은 링크입니다.");
  return data;
}

async function checkDuplicate() {
  const params = new URLSearchParams({ deviceId, fingerprint });
  const response = await fetch(`/api/check?${params.toString()}`, { cache: "no-store" });
  const data = await response.json();
  if (!data.ok) return { alreadyVoted: false };
  return data;
}

function renderHeader() {
  document.title = config.contestName;
  teamName.textContent = `${config.group.name} 평가 링크`;
  pageTitle.replaceChildren(
    document.createTextNode("MX 지원팀"),
    document.createElement("br"),
    document.createTextNode("2차 Work-shop 과제 평가")
  );
  showNotice("각 과제별 4개 항목을 5점부터 1점까지 평가해 주세요.", false);
}

function renderForm() {
  voteForm.hidden = false;
  projectList.innerHTML = config.projects.map((project, index) => renderProject(project, index)).join("");
  projectList.addEventListener("change", handleScoreChange);
  voteForm.addEventListener("submit", submitVote);
  submitButton.addEventListener("click", () => {
    submitIntent = true;
  });
  draftButton.addEventListener("click", () => {
    submitIntent = false;
    saveDraft();
    const message = "임시저장되었습니다. 최종제출 전까지 이 기기에서 다시 열면 이어서 입력할 수 있습니다.";
    showNotice(message, false);
    alert(message);
  });
  findMissingButton.addEventListener("click", scrollToFirstMissing);
  updateProgress();
}

function renderProject(project, index) {
  const criteriaHtml = config.criteria.map((criterion) => {
    const currentValue = answers[project.id]?.[criterion.id] || "";
    const options = [5, 4, 3, 2, 1].map((score) => {
      const checked = Number(currentValue) === score ? "checked" : "";
      return `
        <label class="score-label">
          <input type="radio" name="${project.id}-${criterion.id}" value="${score}" data-project="${project.id}" data-criterion="${criterion.id}" ${checked}>
          <span class="score-option">${score}</span>
        </label>
      `;
    }).join("");

    return `
      <div class="score-row">
        <div class="score-criterion">${escapeHtml(criterion.title)}</div>
        <div class="score-options compact-options">${options}</div>
      </div>
    `;
  }).join("");

  return `
    <article class="project-card compact-project" data-project-card="${project.id}">
      <header>
        <p class="eyebrow">${index + 1} / ${config.projects.length}</p>
        <h3>${escapeHtml(project.title)}</h3>
      </header>
      <div class="criteria-list compact-list">
        <div class="score-header" aria-hidden="true">
          <span></span><span>우수</span><span></span><span></span><span></span><span>미흡</span>
        </div>
        ${criteriaHtml}
      </div>
    </article>
  `;
}

function handleScoreChange(event) {
  const input = event.target;
  if (!input.matches("input[type='radio'][data-project]")) return;
  const projectId = input.dataset.project;
  const criterionId = input.dataset.criterion;
  answers[projectId] ||= {};
  answers[projectId][criterionId] = Number(input.value);
  saveDraft();
  updateProgress();
}

function updateProgress() {
  const total = config.projects.length * config.criteria.length;
  const answered = config.projects.reduce((sum, project) => {
    return sum + config.criteria.filter((criterion) => answers[project.id]?.[criterion.id]).length;
  }, 0);
  const completedProjects = config.projects.filter((project) => isProjectComplete(project.id)).length;

  progressText.textContent = `${answered} / ${total} 항목 완료`;
  progressDetail.textContent = `${completedProjects}개 과제 완료`;
  submitButton.disabled = answered !== total;

  document.querySelectorAll("[data-project-card]").forEach((card) => {
    card.classList.toggle("incomplete", !isProjectComplete(card.dataset.projectCard));
  });
}

function isProjectComplete(projectId) {
  return config.criteria.every((criterion) => answers[projectId]?.[criterion.id]);
}

function scrollToFirstMissing() {
  const missing = [...document.querySelectorAll("[data-project-card]")].find((card) => {
    return !isProjectComplete(card.dataset.projectCard);
  });
  missing?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function submitVote(event) {
  event.preventDefault();
  const isFinalSubmitClick = submitIntent;
  submitIntent = false;
  updateProgress();

  if (!isFinalSubmitClick) {
    showNotice("최종제출은 아래 최종제출 버튼을 눌러야 진행됩니다.", false);
    return;
  }
  if (isSubmitting) return;
  if (submitButton.disabled) {
    scrollToFirstMissing();
    return;
  }

  const confirmed = confirm("최종제출 후에는 수정할 수 없습니다. 제출하시겠습니까?");
  if (!confirmed) return;

  isSubmitting = true;
  submitButton.disabled = true;
  submitButton.textContent = "제출 중";

  let data;
  try {
    const response = await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        groupId,
        deviceId,
        fingerprint,
        finalSubmit: true,
        scores: answers
      })
    });
    data = await response.json();
  } catch {
    showNotice("네트워크 오류로 제출하지 못했습니다. 다시 시도해 주세요.", true);
    isSubmitting = false;
    submitButton.textContent = "최종제출";
    updateProgress();
    return;
  }

  if (!data.ok) {
    showNotice(data.message || "제출하지 못했습니다.", true);
    isSubmitting = false;
    submitButton.textContent = "최종제출";
    updateProgress();
    return;
  }

  localStorage.removeItem(draftKey());
  showDone(data.createdAt);
}

function showDone(votedAt) {
  voteForm.hidden = true;
  doneState.hidden = false;
  const time = votedAt ? new Date(votedAt).toLocaleString("ko-KR") : "";
  doneState.querySelector("p:last-child").textContent = time
    ? `${time}에 제출된 기록이 있습니다.`
    : "이미 이 단말에서 평가가 제출되었습니다.";
}

function showNotice(message, isError) {
  notice.hidden = false;
  notice.textContent = message;
  notice.style.borderColor = isError ? "rgba(204, 63, 74, 0.58)" : "";
  notice.style.color = isError ? "#991b1b" : "";
}

function getOrCreateDeviceId() {
  const key = "aiPocEvaluationDeviceId";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  localStorage.setItem(key, value);
  return value;
}

async function buildFingerprint() {
  const raw = [
    navigator.userAgent,
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen.width,
    screen.height,
    window.devicePixelRatio,
    navigator.platform
  ].join("|");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function saveDraft() {
  localStorage.setItem(draftKey(), JSON.stringify({ answers, savedAt: new Date().toISOString() }));
}

function restoreDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey()) || "{}");
    answers = saved.answers || saved || {};
  } catch {
    answers = {};
  }
}

function pruneAnswers() {
  const validProjectIds = new Set(config.projects.map((project) => project.id));
  const validCriterionIds = new Set(config.criteria.map((criterion) => criterion.id));
  answers = Object.fromEntries(
    Object.entries(answers)
      .filter(([projectId]) => validProjectIds.has(projectId))
      .map(([projectId, scoreRow]) => [
        projectId,
        Object.fromEntries(
          Object.entries(scoreRow || {}).filter(([criterionId]) => validCriterionIds.has(criterionId))
        )
      ])
  );
}

function draftKey() {
  return `aiPocEvaluationDraft:${groupId}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeGroupId(value) {
  return value
    .replace(/\.html$/i, "")
    .replace(/^vote$/i, "");
}
