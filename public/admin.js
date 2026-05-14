const summaryGrid = document.querySelector("#summaryGrid");
const resultHead = document.querySelector("#resultHead");
const resultBody = document.querySelector("#resultBody");
const linkList = document.querySelector("#linkList");
const refreshButton = document.querySelector("#refreshButton");
const logoutButton = document.querySelector("#logoutButton");

refreshButton.addEventListener("click", loadResults);
logoutButton.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  location.href = "/login";
});
await loadResults().catch(showLoadError);

async function loadResults() {
  const response = await fetch("/api/results", { cache: "no-store" });
  if (response.status === 401) {
    location.href = "/login";
    return;
  }
  const data = await response.json();
  if (!data.ok) throw new Error(data.message || "결과를 불러오지 못했습니다.");
  document.title = `${data.contestName} 관리자`;
  renderSummary(data);
  renderResults(data);
  renderLinks(data);
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
  const criteriaHeaders = data.criteria.map((criterion) => `<th>${escapeHtml(criterion.title)}</th>`).join("");
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
