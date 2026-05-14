const config = {
  contestName: "AI POC 산출물 평가",
  expectedVoters: 110,
  scoreMultiplier: 5,
  duplicatePolicy: "deviceOrIp",
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
    { id: "group5", name: "5그룹", excludedProjectIds: [] }
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

const groups = config.groups.map((group, index) => ({ ...group, order: index + 1 }));
const projects = config.projects.map((project, index) => ({ ...project, order: index + 1 }));

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const apiPath = url.pathname.replace(/^\/api\/?/, "");

  try {
    if (request.method === "GET" && apiPath === "health") {
      return json({ ok: true, service: config.contestName });
    }

    if (request.method === "GET" && apiPath === "config") {
      const groupId = url.searchParams.get("group") || "";
      if (!getGroup(groupId)) return json({ ok: false, message: "유효하지 않은 그룹 링크입니다." }, 404);
      return json({ ok: true, ...publicConfig(groupId) });
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

    if (request.method === "GET" && apiPath === "check") {
      requireDb(env);
      await initDb(env.DB);
      const clientKey = await getClientKey(request, {
        deviceId: url.searchParams.get("deviceId") || "",
        fingerprint: url.searchParams.get("fingerprint") || ""
      });
      const duplicate = await findDuplicate(env.DB, clientKey);
      return json({
        ok: true,
        alreadyVoted: Boolean(duplicate),
        votedAt: duplicate?.created_at || null,
        votedGroupId: duplicate?.group_id || null
      });
    }

    if (request.method === "POST" && apiPath === "submit") {
      requireDb(env);
      await initDb(env.DB);
      const body = await readJson(request);
      const validation = validateSubmission(body);
      if (!validation.ok) return json({ ok: false, message: validation.message }, 400);

      const clientKey = await getClientKey(request, body);
      const duplicate = await findDuplicate(env.DB, clientKey);
      if (duplicate) {
        return json({
          ok: false,
          message: "이미 이 IP 또는 단말에서 투표가 완료되었습니다.",
          votedAt: duplicate.created_at
        }, 409);
      }

      const normalizedScores = {};
      for (const project of validation.eligibleProjects) {
        normalizedScores[project.id] = {};
        for (const criterion of config.criteria) {
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
      requireDb(env);
      await initDb(env.DB);
      return json({ ok: true, ...(await aggregateResults(env.DB)) });
    }

    if (request.method === "GET" && apiPath === "export.csv") {
      if (!(await isAdminAuthenticated(request, env))) {
        return json({ ok: false, message: "관리자 로그인이 필요합니다." }, 401);
      }
      requireDb(env);
      await initDb(env.DB);
      return text(await resultsCsv(env.DB), "text/csv; charset=utf-8");
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
    db.prepare("CREATE INDEX IF NOT EXISTS idx_submissions_ip ON submissions(ip)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_submissions_device ON submissions(device_hash)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_submissions_fingerprint ON submissions(fingerprint_hash)")
  ]);
}

function requireDb(env) {
  if (!env.DB) throw new Error("Cloudflare D1 DB 바인딩이 필요합니다. 바인딩 이름은 DB로 설정해 주세요.");
}

function getGroup(groupId) {
  return groups.find((group) => group.id === groupId);
}

function publicConfig(groupId) {
  const group = getGroup(groupId);
  const excludedIds = new Set(group.excludedProjectIds || []);
  const eligibleProjects = projects.filter((project) => !excludedIds.has(project.id));
  const excludedProjects = projects.filter((project) => excludedIds.has(project.id));

  return {
    contestName: config.contestName,
    expectedVoters: config.expectedVoters,
    scoreMultiplier: config.scoreMultiplier,
    scoreRange: { min: 1, max: 5 },
    rawScoreRange: { min: config.criteria.length, max: config.criteria.length * 5 },
    finalScoreRange: {
      min: config.criteria.length * config.scoreMultiplier,
      max: config.criteria.length * 5 * config.scoreMultiplier
    },
    criteria: config.criteria,
    group,
    excludedProjects,
    projects: eligibleProjects,
    allProjects: projects,
    groupCount: groups.length
  };
}

function validateSubmission(body) {
  const group = getGroup(body.groupId);
  if (!group) return { ok: false, message: "유효하지 않은 그룹 링크입니다." };
  if (!body.scores || typeof body.scores !== "object") {
    return { ok: false, message: "평가 점수가 없습니다." };
  }

  const excludedIds = new Set(group.excludedProjectIds || []);
  const eligibleProjects = projects.filter((project) => !excludedIds.has(project.id));
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
    for (const criterion of config.criteria) {
      const value = Number(row?.[criterion.id]);
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        return { ok: false, message: `${projectId}의 ${criterion.title} 점수가 올바르지 않습니다.` };
      }
    }
  }

  return { ok: true, group, eligibleProjects };
}

async function aggregateResults(db) {
  const rows = await db.prepare("SELECT * FROM submissions ORDER BY created_at ASC").all();
  const submissions = rows.results || [];
  const byProject = new Map(
    projects.map((project) => [
      project.id,
      {
        ...project,
        voteCount: 0,
        rawTotalSum: 0,
        finalScoreSum: 0,
        criteriaSums: Object.fromEntries(config.criteria.map((criterion) => [criterion.id, 0]))
      }
    ])
  );
  const groupVoteCounts = Object.fromEntries(groups.map((group) => [group.id, 0]));

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
      const rawTotal = config.criteria.reduce((sum, criterion) => {
        const value = Number(scoreRow[criterion.id] || 0);
        row.criteriaSums[criterion.id] += value;
        return sum + value;
      }, 0);
      row.voteCount += 1;
      row.rawTotalSum += rawTotal;
      row.finalScoreSum += rawTotal * config.scoreMultiplier;
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
      config.criteria.map((criterion) => [
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
    contestName: config.contestName,
    expectedVoters: config.expectedVoters,
    groupCount: groups.length,
    projectCount: projects.length,
    criteria: config.criteria,
    scoreMultiplier: config.scoreMultiplier,
    submissionCount: submissions.length,
    groupVoteCounts,
    rows: resultRows,
    links: groups.map((group) => ({
      id: group.id,
      name: group.name,
      excludedProjectCount: group.excludedProjectIds?.length || 0,
      path: `/group${group.order}.html`
    }))
  };
}

async function resultsCsv(db) {
  const results = await aggregateResults(db);
  const headers = [
    "순위",
    "과제명",
    "투표수",
    "최종 평균(100점)",
    "원점수 평균(20점)",
    ...config.criteria.map((criterion) => `${criterion.title} 평균(5점)`)
  ];
  const lines = [headers];
  for (const row of results.rows) {
    lines.push([
      row.rank,
      row.title,
      row.voteCount,
      row.finalAverage,
      row.rawAverage,
      ...config.criteria.map((criterion) => row.criteriaAverage[criterion.id])
    ]);
  }
  return `\uFEFF${lines.map((line) => line.map(escapeCsv).join(",")).join("\r\n")}`;
}

async function findDuplicate(db, clientKey) {
  const policy = config.duplicatePolicy || "deviceOrIp";
  const clauses = [];
  const bindings = [];

  if (policy !== "deviceOnly" && clientKey.ip) {
    clauses.push("ip = ?");
    bindings.push(clientKey.ip);
  }
  if (policy !== "ipOnly" && clientKey.deviceHash) {
    clauses.push("device_hash = ?");
    bindings.push(clientKey.deviceHash);
  }
  if (policy !== "ipOnly" && clientKey.fingerprintHash) {
    clauses.push("fingerprint_hash = ?");
    bindings.push(clientKey.fingerprintHash);
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
  const [role, expires, signature] = cookie.split(".");
  if (role !== "admin" || !expires || !signature || Number(expires) < Date.now()) return false;
  const expected = await sign(`${role}:${expires}`, env);
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
