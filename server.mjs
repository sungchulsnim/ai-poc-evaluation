import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const votesFile = path.join(dataDir, "votes.json");
const configFile = path.join(__dirname, "config.json");
const port = Number(process.env.PORT || 8090);
const adminPassword = process.env.ADMIN_PASSWORD || "";
const adminSessionToken = crypto.randomBytes(32).toString("hex");

const config = JSON.parse(await readFile(configFile, "utf8"));
const groups = config.groups.map((group, index) => ({
  ...group,
  order: index + 1
}));
const projects = config.projects.map((project, index) => ({
  ...project,
  order: index + 1
}));

let store = { submissions: [] };
let writeQueue = Promise.resolve();

await mkdir(dataDir, { recursive: true });
if (existsSync(votesFile)) {
  try {
    store = JSON.parse(await readFile(votesFile, "utf8"));
    if (!Array.isArray(store.submissions)) store.submissions = [];
  } catch {
    store = { submissions: [] };
  }
}

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"]
]);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendRedirect(res, location) {
  res.writeHead(302, {
    location,
    "cache-control": "no-store"
  });
  res.end();
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  res.end(body);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
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

function isAdminAuthenticated(req) {
  if (!adminPassword) return true;
  return parseCookies(req).admin_session === adminSessionToken;
}

function requireAdmin(req, res) {
  if (isAdminAuthenticated(req)) return true;
  if (req.url?.startsWith("/api/")) {
    sendJson(res, 401, { ok: false, message: "관리자 로그인이 필요합니다." });
  } else {
    sendRedirect(res, "/login");
  }
  return false;
}

function normalizeIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return (raw || req.socket.remoteAddress || "")
    .replace(/^::ffff:/, "")
    .replace(/^::1$/, "127.0.0.1")
    .trim();
}

function hashValue(value) {
  if (!value) return "";
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function getClientKey(req, body = {}) {
  const ip = normalizeIp(req);
  const userAgent = req.headers["user-agent"] || "";
  const deviceHash = hashValue(body.deviceId || "");
  const fingerprintHash = hashValue(body.fingerprint || "");
  return { ip, userAgent, deviceHash, fingerprintHash };
}

function findDuplicate(clientKey) {
  return store.submissions.find((submission) => {
    const policy = config.duplicatePolicy || "deviceOrIp";
    const sameDevice = Boolean(clientKey.deviceHash && submission.deviceHash === clientKey.deviceHash)
      || Boolean(clientKey.fingerprintHash && submission.fingerprintHash === clientKey.fingerprintHash);
    const sameIp = Boolean(clientKey.ip && submission.ip === clientKey.ip);
    if (policy === "deviceOnly") return sameDevice;
    if (policy === "ipOnly") return sameIp;
    if (sameDevice || sameIp) return true;
    return false;
  });
}

function queueWrite() {
  const snapshot = JSON.stringify(store, null, 2);
  writeQueue = writeQueue.then(() => writeFile(votesFile, snapshot, "utf8"));
  return writeQueue;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("요청 데이터가 너무 큽니다."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON 형식이 올바르지 않습니다."));
      }
    });
    req.on("error", reject);
  });
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
    rawScoreRange: {
      min: config.criteria.length,
      max: config.criteria.length * 5
    },
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

function aggregateResults() {
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

  for (const submission of store.submissions) {
    if (groupVoteCounts[submission.groupId] !== undefined) {
      groupVoteCounts[submission.groupId] += 1;
    }

    for (const [projectId, scoreRow] of Object.entries(submission.scores || {})) {
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

  const rows = [...byProject.values()].map((row) => ({
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

  rows.sort((a, b) => b.finalAverage - a.finalAverage || b.voteCount - a.voteCount || a.order - b.order);
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return {
    contestName: config.contestName,
    expectedVoters: config.expectedVoters,
    groupCount: groups.length,
    projectCount: projects.length,
    criteria: config.criteria,
    scoreMultiplier: config.scoreMultiplier,
    submissionCount: store.submissions.length,
    groupVoteCounts,
    rows,
    links: groups.map((group) => ({
      id: group.id,
      name: group.name,
      excludedProjectCount: group.excludedProjectIds?.length || 0,
      path: `/${group.id}.html`
    }))
  };
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function resultsCsv() {
  const results = aggregateResults();
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

async function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? path.join(publicDir, "admin.html") : path.join(publicDir, pathname);
  if (pathname === "/admin") filePath = path.join(publicDir, "admin.html");
  if (pathname === "/login") filePath = path.join(publicDir, "login.html");
  if (pathname.startsWith("/vote/")) filePath = path.join(publicDir, "vote.html");
  if (/^\/group[1-5]$/.test(pathname)) filePath = path.join(publicDir, "vote.html");

  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  if (!existsSync(normalized)) {
    sendText(res, 404, "Not found");
    return;
  }

  const extension = path.extname(normalized).toLowerCase();
  res.writeHead(200, {
    "content-type": mimeTypes.get(extension) || "application/octet-stream",
    "cache-control": extension === ".html" ? "no-store" : "public, max-age=3600"
  });
  createReadStream(normalized).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  try {
    if (req.method === "GET" && pathname === "/api/config") {
      const groupId = requestUrl.searchParams.get("group") || "";
      if (!getGroup(groupId)) {
        sendJson(res, 404, { ok: false, message: "유효하지 않은 그룹 링크입니다." });
        return;
      }
      sendJson(res, 200, { ok: true, ...publicConfig(groupId) });
      return;
    }

    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, { ok: true, service: config.contestName });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/login") {
      if (!adminPassword) {
        sendJson(res, 200, { ok: true });
        return;
      }
      const body = await readRequestBody(req);
      if (body.password !== adminPassword) {
        sendJson(res, 401, { ok: false, message: "비밀번호가 올바르지 않습니다." });
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": `admin_session=${encodeURIComponent(adminSessionToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/logout") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": "admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "GET" && pathname === "/api/check") {
      const clientKey = getClientKey(req, {
        deviceId: requestUrl.searchParams.get("deviceId") || "",
        fingerprint: requestUrl.searchParams.get("fingerprint") || ""
      });
      const duplicate = findDuplicate(clientKey);
      sendJson(res, 200, {
        ok: true,
        alreadyVoted: Boolean(duplicate),
        votedAt: duplicate?.createdAt || null,
        votedGroupId: duplicate?.groupId || null
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/submit") {
      const body = await readRequestBody(req);
      const validation = validateSubmission(body);
      if (!validation.ok) {
        sendJson(res, 400, { ok: false, message: validation.message });
        return;
      }

      const clientKey = getClientKey(req, body);
      const duplicate = findDuplicate(clientKey);
      if (duplicate) {
        sendJson(res, 409, {
          ok: false,
          message: "이미 이 IP 또는 단말에서 투표가 완료되었습니다.",
          votedAt: duplicate.createdAt
        });
        return;
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
        scores: normalizedScores
      };
      store.submissions.push(submission);
      await queueWrite();

      sendJson(res, 201, {
        ok: true,
        submissionId: submission.id,
        createdAt: submission.createdAt
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/results") {
      if (!requireAdmin(req, res)) return;
      sendJson(res, 200, { ok: true, ...aggregateResults() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/export.csv") {
      if (!requireAdmin(req, res)) return;
      sendText(res, 200, resultsCsv(), "text/csv; charset=utf-8");
      return;
    }

    if (req.method === "GET") {
      if ((pathname === "/" || pathname === "/admin") && !requireAdmin(req, res)) return;
      await serveStatic(req, res, pathname);
      return;
    }

    sendJson(res, 405, { ok: false, message: "지원하지 않는 요청입니다." });
  } catch (error) {
    sendJson(res, 500, { ok: false, message: error.message || "서버 오류가 발생했습니다." });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`${config.contestName} server running`);
  console.log(`Local:   http://127.0.0.1:${port}/admin`);
  for (const address of getLanAddresses()) {
    console.log(`Mobile:  http://${address}:${port}/admin`);
  }
});

function getLanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address && address.family === "IPv4" && !address.internal)
    .map((address) => address.address);
}
