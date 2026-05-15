const DEFAULT_CONFIG = {
  contestName: "AI POC 산출물 평가",
  expectedVoters: 110,
  scoreMultiplier: 5,
  duplicatePolicy: "deviceOnly",
  criteria: [
    {
      id: "businessEffect",
      title: "업무 효과성",
      question: "시간 절감, 비용 절감, 반복업무 감소, 오류 감소 등 실제 업무 개선 효과가 큰가?"
    },
    {
      id: "workFit",
      title: "현업 적용성",
      question: "현업 담당자가 이해하기 쉽고, 실제 업무에 바로 적용하기 쉬운가?"
    },
    {
      id: "aiQuality",
      title: "AI 활용 품질",
      question: "AI를 문제 해결에 의미 있게 활용했으며, 결과를 신뢰할 수 있는가?"
    },
    {
      id: "scalability",
      title: "확산 가능성",
      question: "다른 부서나 유사 업무에도 적용할 수 있는가?"
    }
  ],
  groups: [
    { id: "group1", name: "1그룹", excludedProjectIds: [] },
    { id: "group2", name: "2그룹", excludedProjectIds: [] },
    { id: "group3", name: "3그룹", excludedProjectIds: [] },
    { id: "group4", name: "4그룹", excludedProjectIds: [] },
    { id: "group5", name: "5그룹", excludedProjectIds: [] },
    { id: "group6", name: "6그룹", excludedProjectIds: [] }
  ],
  projects: [
    { id: "project01", title: "손익분석 대시보드" },
    { id: "project02", title: "출시 신모델의 실적 손익 분석" },
    { id: "project03", title: "보조부 분석 (SAP 자동화)" },
    { id: "project04", title: "영수증 자동 인식 에이전트" },
    { id: "project05", title: "사업지원실用 보고서 작성 프로그램" },
    { id: "project06", title: "주요 부서 액션아이템 대쉬보드" },
    { id: "project07", title: "경쟁사 외신 보도 대쉬보드" },
    { id: "project08", title: "생산법인별 도착지 원가경쟁력 대시보드" },
    { id: "project09", title: "생산법인 본사 재수출 이체가 자동화 Web" },
    { id: "project10", title: "판매법인 TIM 지표 관리 및 자동화 분석" },
    { id: "project11", title: "물류비 경영/실행 계획 시뮬레이션 TOOL" },
    { id: "project12", title: "WOS 정기 메일 대시보드 자동 생성 및 송부" },
    { id: "project13", title: "AI 기반 자연어 ASAP 분석" }
  ]
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const apiPath = url.pathname.replace(/^\/api\/?/, "");

  try {
    if (request.method === "GET" && apiPath === "health") {
      return json({ ok: true, service: DEFAULT_CONFIG.contestName });
    }

    if (request.method === "POST" && apiPath === "admin/login") {
      const body = await readJson(request);
      const password = env.ADMIN_PASSWORD || "";
      if (!password || body.password !== password) {
        return json({ ok: false, message: "비밀번호가 올바르지 않습니다." }, 401);
      }
      const cookie = await createAdminCookie(env);
      return json({ ok: true }, 200, { "set-cookie": cookie });
    }

    if (request.method === "POST" && apiPath === "admin/logout") {
      return json({ ok: true }, 200, {
        "set-cookie": "admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
      });
    }

    requireDb(env);
    await initDb(env.DB);

    if (request.method === "GET" && apiPath === "config") {
      const appConfig = await getAppConfig(env.DB);
      const groupId = url.searchParams.get("group") || "";
      if (!getGroup(appConfig, groupId)) {
        return json({ ok: false, message: "유효하지 않은 그룹 링크입니다." }, 404);
      }
      return json({ ok: true, ...publicConfig(appConfig, groupId) });
    }

    if (request.method === "GET" && apiPath === "check") {
      const appConfig = await getAppConfig(env.DB);
      const clientKey = await getClientKey(request, {
        deviceId: url.searchParams.get("deviceId") || "",
        fingerprint: url.searchParams.get("fingerprint") || ""
      });
      const duplicate = await findDuplicate(env.DB, appConfig, clientKey);
      return json({
        ok: true,
        alreadyVoted: Boolean(duplicate),
        votedAt: duplicate?.created_at || null,
        votedGroupId: duplicate?.group_id || null
      });
    }

    if (request.method === "POST" && apiPath === "submit") {
      const appConfig = await getAppConfig(env.DB);
      const body = await readJson(request);
      const validation = validateSubmission(appConfig, body);
      if (!validation.ok) return json({ ok: false, message: validation.message }, 400);

      const clientKey = await getClientKey(request, body);
      const duplicate = await findDuplicate(env.DB, appConfig, clientKey);
      if (duplicate) {
        return json({
          ok: false,
          message: "이미 이 단말에서 투표가 완료되었습니다.",
          votedAt: duplicate.created_at
        }, 409);
      }

      const normalizedScores = {};
      for (const project of validation.eligibleProjects) {
        normalizedScores[project.id] = {};
        for (const criterion of appConfig.criteria) {
          normalizedScores[project.id][criterion.id] = Number(body.scores[project.id][criterion.id]);
        }
      }

      const submission = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        groupId: validation.group.id,
        groupName: validation.group.name,
        ip: clientKey.ip,
        userAgent: clientKey.userAgent,
        deviceHash: clientKey.deviceHash,
        fingerprintHash: clientKey.fingerprintHash,
        scoresJson: JSON.stringify(normalizedScores)
      };

      await env.DB.prepare(`
        INSERT INTO submissions (
          id, created_at, group_id, group_name, ip, user_agent, device_hash, fingerprint_hash, scores_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        submission.id,
        submission.createdAt,
        submission.groupId,
        submission.groupName,
        submission.ip,
        submission.userAgent,
        submission.deviceHash,
        submission.fingerprintHash,
        submission.scoresJson
      ).run();

      return json({ ok: true, submissionId: submission.id, createdAt: submission.createdAt }, 201);
    }

    if (request.method === "GET" && apiPath === "results") {
      if (!(await isAdminAuthenticated(request, env))) {
        return json({ ok: false, message: "관리자 로그인이 필요합니다." }, 401);
      }
      const appConfig = await getAppConfig(env.DB);
      return json({ ok: true, ...(await aggregateResults(env.DB, appConfig)) });
    }

    if (request.method === "GET" && apiPath === "export.csv") {
      if (!(await isAdminAuthenticated(request, env))) {
        return json({ ok: false, message: "관리자 로그인이 필요합니다." }, 401);
      }
      const appConfig = await getAppConfig(env.DB);
      return text(await resultsCsv(env.DB, appConfig), "text/csv; charset=utf-8");
    }

    if (request.method === "GET" && apiPath === "admin/settings") {
      if (!(await isAdminAuthenticated(request, env))) {
        return json({ ok: false, message: "관리자 로그인이 필요합니다." }, 401);
      }
      return json({ ok: true, ...(await getAppConfig(env.DB)) });
    }

    if (request.method === "POST" && apiPath === "admin/settings") {
      if (!(await isAdminAuthenticated(request, env))) {
        return json({ ok: false, message: "관리자 로그인이 필요합니다." }, 401);
      }
      const currentConfig = await getAppConfig(env.DB);
      const body = await readJson(request);
      const nextConfig = normalizeSubmittedConfig(currentConfig, body);
      await saveAppConfig(env.DB, nextConfig);
      return json({ ok: true, ...nextConfig });
    }

    if (request.method === "POST" && apiPath === "admin/reset-votes") {
      if (!(await isAdminAuthenticated(request, env))) {
        return json({ ok: false, message: "관리자 로그인이 필요합니다." }, 401);
      }
      const body = await readJson(request);
      if (body.confirmText !== "초기화") {
        return json({ ok: false, message: "초기화를 확인하려면 '초기화'를 입력해야 합니다." }, 400);
      }
      await env.DB.prepare("DELETE FROM submissions").run();
      return json({ ok: true, message: "평가 정보가 초기화되었습니다." });
    }

    return json({ ok: false, message: "지원하지 않는 요청입니다." }, 404);
  } catch (error) {
    return json({ ok: false, message: error.message || "서버 오류가 발생했습니다." }, 500);
  }
}

async function initDb(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        group_id TEXT NOT NULL,
        group_name TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        device_hash TEXT,
        fingerprint_hash TEXT,
        scores_json TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_submissions_ip ON submissions(ip)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_submissions_device ON submissions(device_hash)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_submissions_fingerprint ON submissions(fingerprint_hash)")
  ]);
}

function requireDb(env) {
  if (!env.DB) throw new Error("Cloudflare D1 DB 바인딩이 필요합니다. 바인딩 이름은 DB로 설정해 주세요.");
}

async function getAppConfig(db) {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind("app_config").first();
  if (!row?.value) {
    const initialConfig = normalizeConfig(DEFAULT_CONFIG);
    await saveAppConfig(db, initialConfig);
    return initialConfig;
  }

  try {
    return normalizeConfig(JSON.parse(row.value));
  } catch {
    const fallbackConfig = normalizeConfig(DEFAULT_CONFIG);
    await saveAppConfig(db, fallbackConfig);
    return fallbackConfig;
  }
}

async function saveAppConfig(db, appConfig) {
  await db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind("app_config", JSON.stringify(normalizeConfig(appConfig)), new Date().toISOString()).run();
}

function normalizeConfig(appConfig) {
  const projectIds = new Set();
  const projects = Array.isArray(appConfig.projects) && appConfig.projects.length
    ? appConfig.projects
    : DEFAULT_CONFIG.projects;

  const normalizedProjects = projects
    .map((project, index) => ({
      id: safeId(project.id) || `project${String(index + 1).padStart(2, "0")}`,
      title: String(project.title || "").trim(),
      order: index + 1
    }))
    .filter((project) => project.title)
    .filter((project) => {
      if (projectIds.has(project.id)) return false;
      projectIds.add(project.id);
      return true;
    });

  const validProjectIds = new Set(normalizedProjects.map((project) => project.id));
  const inputGroups = Array.isArray(appConfig.groups) ? appConfig.groups : DEFAULT_CONFIG.groups;
  const normalizedGroups = DEFAULT_CONFIG.groups.map((defaultGroup, index) => {
    const source = inputGroups.find((group) => group.id === defaultGroup.id) || defaultGroup;
    const excludedProjectIds = Array.isArray(source.excludedProjectIds) ? source.excludedProjectIds : [];
    return {
      id: defaultGroup.id,
      name: String(source.name || defaultGroup.name).trim() || defaultGroup.name,
      excludedProjectIds: [...new Set(excludedProjectIds.filter((projectId) => validProjectIds.has(projectId)))],
      order: index + 1
    };
  });

  return {
    contestName: String(appConfig.contestName || DEFAULT_CONFIG.contestName),
    expectedVoters: Number(appConfig.expectedVoters || DEFAULT_CONFIG.expectedVoters),
    scoreMultiplier: Number(appConfig.scoreMultiplier || DEFAULT_CONFIG.scoreMultiplier),
    duplicatePolicy: DEFAULT_CONFIG.duplicatePolicy,
    criteria: DEFAULT_CONFIG.criteria,
    groups: normalizedGroups,
    projects: normalizedProjects
  };
}

function normalizeSubmittedConfig(currentConfig, body) {
  const currentByTitle = new Map(currentConfig.projects.map((project) => [normalizeTitle(project.title), project.id]));
  const currentIds = new Set(currentConfig.projects.map((project) => project.id));
  const seenIds = new Set();

  const submittedProjects = Array.isArray(body.projects) ? body.projects : [];
  const projects = submittedProjects
    .map((project) => {
      const title = String(project.title || "").trim();
      if (!title) return null;

      let id = safeId(project.id);
      if (!id || !currentIds.has(id)) {
        id = currentByTitle.get(normalizeTitle(title)) || `project-${crypto.randomUUID()}`;
      }
      if (seenIds.has(id)) id = `project-${crypto.randomUUID()}`;
      seenIds.add(id);

      return { id, title };
    })
    .filter(Boolean);

  if (!projects.length) throw new Error("과제는 최소 1개 이상 필요합니다.");

  const validProjectIds = new Set(projects.map((project) => project.id));
  const submittedGroups = Array.isArray(body.groups) ? body.groups : [];
  const currentGroupMap = new Map(currentConfig.groups.map((group) => [group.id, group]));

  const groups = DEFAULT_CONFIG.groups.map((defaultGroup) => {
    const submittedGroup = submittedGroups.find((group) => group.id === defaultGroup.id);
    const currentGroup = currentGroupMap.get(defaultGroup.id) || defaultGroup;
    const excludedProjectIds = Array.isArray(submittedGroup?.excludedProjectIds)
      ? submittedGroup.excludedProjectIds
      : currentGroup.excludedProjectIds;

    return {
      id: defaultGroup.id,
      name: String(submittedGroup?.name || currentGroup.name || defaultGroup.name).trim() || defaultGroup.name,
      excludedProjectIds: [...new Set(excludedProjectIds.filter((projectId) => validProjectIds.has(projectId)))]
    };
  });

  return normalizeConfig({
    ...currentConfig,
    projects,
    groups
  });
}

function safeId(value) {
  const textValue = String(value || "").trim();
  return /^[a-zA-Z0-9_-]+$/.test(textValue) ? textValue : "";
}

function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function getGroup(appConfig, groupId) {
  return appConfig.groups.find((group) => group.id === groupId);
}

function publicConfig(appConfig, groupId) {
  const group = getGroup(appConfig, groupId);
  const excludedIds = new Set(group.excludedProjectIds || []);
  const eligibleProjects = appConfig.projects.filter((project) => !excludedIds.has(project.id));
  const excludedProjects = appConfig.projects.filter((project) => excludedIds.has(project.id));

  return {
    contestName: appConfig.contestName,
    expectedVoters: appConfig.expectedVoters,
    scoreMultiplier: appConfig.scoreMultiplier,
    scoreRange: { min: 1, max: 5 },
    rawScoreRange: { min: appConfig.criteria.length, max: appConfig.criteria.length * 5 },
    finalScoreRange: {
      min: appConfig.criteria.length * appConfig.scoreMultiplier,
      max: appConfig.criteria.length * 5 * appConfig.scoreMultiplier
    },
    criteria: appConfig.criteria,
    group,
    excludedProjects,
    projects: eligibleProjects,
    allProjects: appConfig.projects,
    groupCount: appConfig.groups.length
  };
}

function validateSubmission(appConfig, body) {
  const group = getGroup(appConfig, body.groupId);
  if (!group) return { ok: false, message: "유효하지 않은 그룹 링크입니다." };
  if (body.finalSubmit !== true) {
    return { ok: false, message: "최종제출 요청이 확인되지 않았습니다." };
  }
  if (!String(body.deviceId || "").trim()) {
    return { ok: false, message: "단말 식별 정보가 없어 제출할 수 없습니다." };
  }
  if (!body.scores || typeof body.scores !== "object") {
    return { ok: false, message: "평가 점수가 없습니다." };
  }

  const excludedIds = new Set(group.excludedProjectIds || []);
  const eligibleProjects = appConfig.projects.filter((project) => !excludedIds.has(project.id));
  const eligibleIds = new Set(eligibleProjects.map((project) => project.id));
  const submittedIds = Object.keys(body.scores);

  if (submittedIds.length !== eligibleProjects.length) {
    return { ok: false, message: "모든 과제의 평가 항목을 입력해야 합니다." };
  }

  for (const projectId of submittedIds) {
    if (!eligibleIds.has(projectId)) {
      return { ok: false, message: "평가 대상이 아닌 과제가 포함되어 있습니다." };
    }
    const row = body.scores[projectId];
    for (const criterion of appConfig.criteria) {
      const value = Number(row?.[criterion.id]);
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        return { ok: false, message: `${projectId}의 ${criterion.title} 점수가 올바르지 않습니다.` };
      }
    }
  }

  return { ok: true, group, eligibleProjects };
}

async function aggregateResults(db, appConfig) {
  const rows = await db.prepare("SELECT * FROM submissions ORDER BY created_at ASC").all();
  const submissions = rows.results || [];
  const byProject = new Map(
    appConfig.projects.map((project) => [
      project.id,
      {
        ...project,
        voteCount: 0,
        rawTotalSum: 0,
        finalScoreSum: 0,
        criteriaSums: Object.fromEntries(appConfig.criteria.map((criterion) => [criterion.id, 0]))
      }
    ])
  );
  const groupVoteCounts = Object.fromEntries(appConfig.groups.map((group) => [group.id, 0]));

  for (const submission of submissions) {
    if (groupVoteCounts[submission.group_id] !== undefined) {
      groupVoteCounts[submission.group_id] += 1;
    }

    let scores = {};
    try {
      scores = JSON.parse(submission.scores_json || "{}");
    } catch {
      scores = {};
    }

    for (const [projectId, scoreRow] of Object.entries(scores)) {
      const row = byProject.get(projectId);
      if (!row) continue;
      const rawTotal = appConfig.criteria.reduce((sum, criterion) => {
        const value = Number(scoreRow[criterion.id] || 0);
        row.criteriaSums[criterion.id] += value;
        return sum + value;
      }, 0);
      row.voteCount += 1;
      row.rawTotalSum += rawTotal;
      row.finalScoreSum += rawTotal * appConfig.scoreMultiplier;
    }
  }

  const resultRows = [...byProject.values()].map((row) => ({
    projectId: row.id,
    title: row.title,
    order: row.order,
    voteCount: row.voteCount,
    rawAverage: row.voteCount ? round(row.rawTotalSum / row.voteCount, 2) : 0,
    finalAverage: row.voteCount ? round(row.finalScoreSum / row.voteCount, 2) : 0,
    criteriaAverage: Object.fromEntries(
      appConfig.criteria.map((criterion) => [
        criterion.id,
        row.voteCount ? round(row.criteriaSums[criterion.id] / row.voteCount, 2) : 0
      ])
    )
  }));

  resultRows.sort((a, b) => b.finalAverage - a.finalAverage || b.voteCount - a.voteCount || a.order - b.order);
  resultRows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return {
    contestName: appConfig.contestName,
    expectedVoters: appConfig.expectedVoters,
    groupCount: appConfig.groups.length,
    projectCount: appConfig.projects.length,
    criteria: appConfig.criteria,
    scoreMultiplier: appConfig.scoreMultiplier,
    submissionCount: submissions.length,
    groupVoteCounts,
    rows: resultRows,
    links: appConfig.groups.map((group) => ({
      id: group.id,
      name: group.name,
      excludedProjectCount: group.excludedProjectIds?.length || 0,
      path: `/group${group.order}.html`
    }))
  };
}

async function resultsCsv(db, appConfig) {
  const results = await aggregateResults(db, appConfig);
  const headers = [
    "순위",
    "과제명",
    "투표수",
    "최종 평균(100점)",
    "원점수 평균(20점)",
    ...appConfig.criteria.map((criterion) => `${criterion.title} 평균(5점)`)
  ];
  const lines = [headers];
  for (const row of results.rows) {
    lines.push([
      row.rank,
      row.title,
      row.voteCount,
      row.finalAverage,
      row.rawAverage,
      ...appConfig.criteria.map((criterion) => row.criteriaAverage[criterion.id])
    ]);
  }
  return `\uFEFF${lines.map((line) => line.map(escapeCsv).join(",")).join("\r\n")}`;
}

async function findDuplicate(db, appConfig, clientKey) {
  const clauses = [];
  const bindings = [];

  if (clientKey.deviceHash) {
    clauses.push("device_hash = ?");
    bindings.push(clientKey.deviceHash);
  }

  if (!clauses.length) return null;
  return db.prepare(`SELECT * FROM submissions WHERE ${clauses.join(" OR ")} LIMIT 1`).bind(...bindings).first();
}

async function getClientKey(request, body = {}) {
  const ip = normalizeIp(request);
  const userAgent = request.headers.get("user-agent") || "";
  const deviceHash = await hashValue(body.deviceId || "");
  const fingerprintHash = await hashValue(body.fingerprint || "");
  return { ip, userAgent, deviceHash, fingerprintHash };
}

function normalizeIp(request) {
  const raw = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]
    || "";
  return raw.replace(/^::ffff:/, "").replace(/^::1$/, "127.0.0.1").trim();
}

async function hashValue(value) {
  if (!value) return "";
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createAdminCookie(env) {
  const expires = Date.now() + 8 * 60 * 60 * 1000;
  const payload = `admin:${expires}`;
  const signature = await sign(payload, env);
  return `admin_session=${encodeURIComponent(`${payload}.${signature}`)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`;
}

async function isAdminAuthenticated(request, env) {
  const password = env.ADMIN_PASSWORD || "";
  if (!password) return false;
  const cookie = parseCookies(request).admin_session;
  if (!cookie) return false;
  const dotIndex = cookie.lastIndexOf(".");
  if (dotIndex === -1) return false;
  const payload = cookie.slice(0, dotIndex);
  const signature = cookie.slice(dotIndex + 1);
  const [role, expires] = payload.split(":");
  if (role !== "admin" || !expires || !signature || Number(expires) < Date.now()) return false;
  const expected = await sign(payload, env);
  return timingSafeEqual(signature, expected);
}

async function sign(payload, env) {
  const secret = env.SESSION_SECRET || env.ADMIN_PASSWORD || "change-me";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        if (index === -1) return [item, ""];
        return [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
      })
  );
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

function text(body, contentType) {
  return new Response(body, {
    headers: {
      "content-type": contentType,
      "cache-control": "no-store"
    }
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function escapeCsv(value) {
  const textValue = String(value ?? "");
  if (/[",\n\r]/.test(textValue)) return `"${textValue.replace(/"/g, '""')}"`;
  return textValue;
}
