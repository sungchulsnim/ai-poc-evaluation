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
const submitHint = document.querySelector("#submitHint");
const findMissingButton = document.querySelector("#findMissingButton");

let config;
let answers = {};

try {
  config = await loadConfig();
  const duplicate = await checkDuplicate();
  renderHeader();

  if (duplicate.alreadyVoted) {
    showDone(duplicate.votedAt);
  } else {
    restoreDraft();
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
  pageTitle.textContent = "AI 산출물 평가";
  if (config.excludedProjects.length) {
    showNotice(`해당 그룹 과제는 평가 대상에서 제외됩니다. 제외 과제: ${config.excludedProjects.map((project) => project.title).join(", ")}`, false);
  } else {
    showNotice("각 과제별 4개 항목을 1점부터 5점까지 평가해 주세요.", false);
  }
}

function renderForm() {
  voteForm.hidden = false;
  projectList.innerHTML = config.projects.map((project, index) => renderProject(project, index)).join("");
  projectList.addEventListener("change", handleScoreChange);
  voteForm.addEventListener("submit", submitVote);
  findMissingButton.addEventListener("click", scrollToFirstMissing);
  updateProgress();
}

function renderProject(project, index) {
  const criteriaHtml = config.criteria.map((criterion) => {
    const currentValue = answers[project.id]?.[criterion.id] || "";
    const options = [1, 2, 3, 4, 5].map((score) => {
      const inputId = `${project.id}-${criterion.id}-${score}`;
      const checked = Number(currentValue) === score ? "checked" : "";
      return `
        <label>
          <input type="radio" name="${project.id}-${criterion.id}" value="${score}" data-project="${project.id}" data-criterion="${criterion.id}" ${checked}>
          <span class="score-option">${score}</span>
        </label>
      `;
    }).join("");

    return `
      <fieldset class="criterion">
        <legend>
          <span class="criterion-title">${escapeHtml(criterion.title)}</span>
          <span class="criterion-question">${escapeHtml(criterion.question)}</span>
        </legend>
        <div class="score-options">${options}</div>
      </fieldset>
    `;
  }).join("");

  return `
    <article class="project-card" data-project-card="${project.id}">
      <header>
        <p class="eyebrow">${index + 1} / ${config.projects.length}</p>
        <h3>${escapeHtml(project.title)}</h3>
      </header>
      <div class="criteria-list">${criteriaHtml}</div>
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

  progressText.textContent = `${answered} / ${total}`;
  progressDetail.textContent = `${completedProjects}개 과제 완료`;
  submitButton.disabled = answered !== total;
  submitHint.textContent = answered === total
    ? `원점수 ${config.rawScoreRange.min}-${config.rawScoreRange.max}점, 최종점수 ${config.finalScoreRange.min}-${config.finalScoreRange.max}점으로 환산됩니다.`
    : "모든 항목을 입력하면 제출할 수 있습니다.";

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
  updateProgress();
  if (submitButton.disabled) {
    scrollToFirstMissing();
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "제출 중";

  const response = await fetch("/api/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      groupId,
      deviceId,
      fingerprint,
      scores: answers
    })
  });
  const data = await response.json();

  if (!data.ok) {
    showNotice(data.message || "제출하지 못했습니다.", true);
    submitButton.textContent = "평가 제출";
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
    : "이미 이 IP 또는 단말에서 평가가 제출되었습니다.";
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
  localStorage.setItem(draftKey(), JSON.stringify(answers));
}

function restoreDraft() {
  try {
    answers = JSON.parse(localStorage.getItem(draftKey()) || "{}");
  } catch {
    answers = {};
  }
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
