import { performance } from "node:perf_hooks";
import { onRequest } from "../functions/api/[[path]].js";

const EXPECTED_PARALLEL_VOTERS = 500;
const SAME_DEVICE_BURST = 20;

async function runUniqueDeviceBurst() {
  const env = testEnv();
  const groupConfigs = await loadGroupConfigs(env);
  const requests = Array.from({ length: EXPECTED_PARALLEL_VOTERS }, (_, index) => {
    const groupId = `group${(index % 6) + 1}`;
    return submitVote(env, {
      group: groupConfigs[groupId],
      deviceId: `unique-device-${index + 1}`,
      ip: `10.10.${Math.floor(index / 250)}.${(index % 250) + 1}`
    });
  });

  const responses = await Promise.all(requests);
  assertStatusCounts(responses, { 201: EXPECTED_PARALLEL_VOTERS });
  assertEqual(env.DB.submissions.length, EXPECTED_PARALLEL_VOTERS, "stored submission count");

  return responseSummary(responses, env);
}
runUniqueDeviceBurst.scenarioName = "500 parallel final submits from unique devices";

async function runSharedIpUniqueDeviceBurst() {
  const env = testEnv();
  const groupConfigs = await loadGroupConfigs(env);
  const requests = Array.from({ length: EXPECTED_PARALLEL_VOTERS }, (_, index) => {
    const groupId = `group${(index % 6) + 1}`;
    return submitVote(env, {
      group: groupConfigs[groupId],
      deviceId: `shared-ip-device-${index + 1}`,
      ip: "10.99.1.10"
    });
  });

  const responses = await Promise.all(requests);
  assertStatusCounts(responses, { 201: EXPECTED_PARALLEL_VOTERS });
  assertEqual(env.DB.submissions.length, EXPECTED_PARALLEL_VOTERS, "shared IP stored submission count");

  return responseSummary(responses, env);
}
runSharedIpUniqueDeviceBurst.scenarioName = "500 parallel final submits behind one shared IP";

async function runSameDeviceBurst() {
  const env = testEnv({ selectDelayMs: 8, insertDelayMs: 8 });
  const groupConfigs = await loadGroupConfigs(env);
  const group = groupConfigs.group6;
  const requests = Array.from({ length: SAME_DEVICE_BURST }, () => (
    submitVote(env, {
      group,
      deviceId: "same-device-double-tap",
      ip: "10.20.30.40"
    })
  ));

  const responses = await Promise.all(requests);
  assertStatusCounts(responses, { 201: 1, 409: SAME_DEVICE_BURST - 1 });
  assertEqual(env.DB.submissions.length, 1, "same-device stored submission count");

  return responseSummary(responses, env);
}
runSameDeviceBurst.scenarioName = "same-device double-tap burst is deduplicated";

async function runAdminAggregateAfterLoad() {
  const env = testEnv();
  const groupConfigs = await loadGroupConfigs(env);
  const requests = Array.from({ length: EXPECTED_PARALLEL_VOTERS }, (_, index) => {
    const groupId = `group${(index % 6) + 1}`;
    return submitVote(env, {
      group: groupConfigs[groupId],
      deviceId: `aggregate-device-${index + 1}`,
      ip: `172.16.${Math.floor(index / 250)}.${(index % 250) + 1}`,
      score: (index % 5) + 1
    });
  });
  const responses = await Promise.all(requests);
  assertStatusCounts(responses, { 201: EXPECTED_PARALLEL_VOTERS });

  const login = await api(env, jsonRequest("/api/admin/login", {
    password: "z1"
  }));
  const cookie = login.response.headers.get("set-cookie").split(";")[0];
  const results = await api(env, new Request("https://test.local/api/results", {
    headers: { cookie }
  }));

  assertEqual(results.body.rows.length, groupConfigs.group6.projects.length, "aggregate row count");
  assertEqual(results.body.submissionCount, EXPECTED_PARALLEL_VOTERS, "aggregate submission count");

  return {
    rows: results.body.rows.length,
    submissionCount: results.body.submissionCount
  };
}
runAdminAggregateAfterLoad.scenarioName = "admin aggregate works after 500 parallel submits";

async function runInvalidSubmissionRejection() {
  const env = testEnv();
  const groupConfigs = await loadGroupConfigs(env);
  const group = groupConfigs.group6;
  const scores = fullScores(group, 5);
  delete scores[group.projects[0].id];

  const response = await api(env, jsonRequest("/api/submit", {
    groupId: group.group.id,
    finalSubmit: true,
    deviceId: "invalid-missing-one-project",
    scores
  }));

  assertEqual(response.status, 400, "invalid submission status");
  assertEqual(env.DB.submissions.length, 0, "invalid submission stored count");

  return {
    status: response.status,
    message: response.body.message
  };
}
runInvalidSubmissionRejection.scenarioName = "incomplete final submit is rejected";

async function runResetClearsDeviceLocks() {
  const env = testEnv();
  const groupConfigs = await loadGroupConfigs(env);
  const group = groupConfigs.group6;
  const first = await submitVote(env, {
    group,
    deviceId: "reset-device",
    ip: "10.50.60.70"
  });
  assertEqual(first.status, 201, "first reset-device submit status");

  const login = await api(env, jsonRequest("/api/admin/login", {
    password: "z1"
  }));
  const cookie = login.response.headers.get("set-cookie").split(";")[0];
  const reset = await api(env, new Request("https://test.local/api/admin/reset-votes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie
    },
    body: JSON.stringify({ confirmText: "초기화" })
  }));
  assertEqual(reset.status, 200, "reset status");
  assertEqual(env.DB.submissions.length, 0, "submissions after reset");
  assertEqual(env.DB.deviceLocks.size, 0, "device locks after reset");

  const second = await submitVote(env, {
    group,
    deviceId: "reset-device",
    ip: "10.50.60.70"
  });
  assertEqual(second.status, 201, "second reset-device submit status");

  return {
    firstStatus: first.status,
    resetStatus: reset.status,
    secondStatus: second.status,
    storedSubmissions: env.DB.submissions.length,
    storedDeviceLocks: env.DB.deviceLocks.size
  };
}
runResetClearsDeviceLocks.scenarioName = "reset clears duplicate-submission device locks";

async function loadGroupConfigs(env) {
  const entries = await Promise.all(
    [1, 2, 3, 4, 5, 6].map(async (groupNumber) => {
      const groupId = `group${groupNumber}`;
      const response = await api(env, new Request(`https://test.local/api/config?group=${groupId}`));
      assertEqual(response.status, 200, `${groupId} config status`);
      return [groupId, response.body];
    })
  );
  return Object.fromEntries(entries);
}

function testEnv(options = {}) {
  return {
    DB: new MockD1(options),
    ADMIN_PASSWORD: "z1",
    SESSION_SECRET: "test-secret"
  };
}

async function submitVote(env, { group, deviceId, ip, score = 5 }) {
  return api(env, jsonRequest("/api/submit", {
    groupId: group.group.id,
    finalSubmit: true,
    deviceId,
    fingerprint: `${deviceId}-fingerprint`,
    scores: fullScores(group, score)
  }, {
    "cf-connecting-ip": ip,
    "user-agent": `ConcurrencyTest/${deviceId}`
  }));
}

function fullScores(group, score) {
  return Object.fromEntries(group.projects.map((project) => [
    project.id,
    Object.fromEntries(group.criteria.map((criterion) => [criterion.id, score]))
  ]));
}

function jsonRequest(path, body, headers = {}) {
  return new Request(`https://test.local${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

async function api(env, request) {
  const response = await onRequest({ request, env, ctx: {} });
  let body = null;
  try {
    body = await response.clone().json();
  } catch {
    body = await response.text();
  }
  return { response, status: response.status, body };
}

function assertStatusCounts(responses, expected) {
  const actual = {};
  for (const response of responses) {
    actual[response.status] = (actual[response.status] || 0) + 1;
  }
  for (const [status, count] of Object.entries(expected)) {
    assertEqual(actual[status] || 0, count, `HTTP ${status} count`);
  }
  const unexpected = Object.keys(actual).filter((status) => !(status in expected));
  if (unexpected.length) {
    throw new Error(`Unexpected statuses: ${JSON.stringify(actual)}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function responseSummary(responses, env) {
  const statuses = {};
  for (const response of responses) {
    statuses[response.status] = (statuses[response.status] || 0) + 1;
  }
  return {
    statuses,
    storedSubmissions: env.DB.submissions.length,
    deviceLockTable: env.DB.deviceLockTableEnabled,
    storedDeviceLocks: env.DB.deviceLocks.size
  };
}

function compactResult(result) {
  const copy = { ...result };
  delete copy.name;
  delete copy.pass;
  delete copy.durationMs;
  return copy;
}

class MockD1 {
  constructor({ selectDelayMs = 0, insertDelayMs = 0 } = {}) {
    this.appSettings = new Map();
    this.submissions = [];
    this.deviceLocks = new Map();
    this.selectDelayMs = selectDelayMs;
    this.insertDelayMs = insertDelayMs;
    this.deviceLockTableEnabled = false;
  }

  prepare(sql) {
    return new MockStatement(this, sql);
  }

  async batch(statements) {
    for (const statement of statements) {
      if (/CREATE TABLE IF NOT EXISTS submission_devices/i.test(statement.sql)) {
        this.deviceLockTableEnabled = true;
      }
      await statement.run();
    }
    return [];
  }
}

class MockStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.bindings = [];
  }

  bind(...bindings) {
    this.bindings = bindings;
    return this;
  }

  async first() {
    if (/SELECT value FROM app_settings/i.test(this.sql)) {
      const value = this.db.appSettings.get(this.bindings[0]);
      return value ? { value } : null;
    }

    if (/SELECT \* FROM submissions WHERE/i.test(this.sql)) {
      await delay(this.db.selectDelayMs);
      const deviceHash = this.bindings[0];
      return this.db.submissions.find((submission) => submission.device_hash === deviceHash) || null;
    }

    return null;
  }

  async run() {
    if (/INSERT INTO app_settings/i.test(this.sql)) {
      this.db.appSettings.set(this.bindings[0], this.bindings[1]);
      return { success: true };
    }

    if (/DELETE FROM submissions/i.test(this.sql)) {
      this.db.submissions = [];
      return { success: true };
    }

    if (/DELETE FROM submission_devices/i.test(this.sql)) {
      this.db.deviceLocks.clear();
      return { success: true };
    }

    if (/INSERT INTO submission_devices/i.test(this.sql)) {
      await delay(this.db.insertDelayMs);
      const [deviceHash, submissionId, createdAt] = this.bindings;
      if (this.db.deviceLocks.has(deviceHash)) {
        throw new Error("UNIQUE constraint failed: submission_devices.device_hash");
      }
      this.db.deviceLocks.set(deviceHash, {
        device_hash: deviceHash,
        submission_id: submissionId,
        created_at: createdAt
      });
      return { success: true };
    }

    if (/INSERT INTO submissions/i.test(this.sql)) {
      await delay(this.db.insertDelayMs);
      const [
        id,
        created_at,
        group_id,
        group_name,
        ip,
        user_agent,
        device_hash,
        fingerprint_hash,
        scores_json
      ] = this.bindings;

      this.db.submissions.push({
        id,
        created_at,
        group_id,
        group_name,
        ip,
        user_agent,
        device_hash,
        fingerprint_hash,
        scores_json
      });
      return { success: true };
    }

    return { success: true };
  }

  async all() {
    if (/SELECT \* FROM submissions ORDER BY created_at ASC/i.test(this.sql)) {
      return {
        results: [...this.db.submissions].sort((a, b) => a.created_at.localeCompare(b.created_at))
      };
    }
    return { results: [] };
  }
}

function delay(ms) {
  return ms ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

const scenarios = [
  runUniqueDeviceBurst,
  runSharedIpUniqueDeviceBurst,
  runSameDeviceBurst,
  runAdminAggregateAfterLoad,
  runInvalidSubmissionRejection,
  runResetClearsDeviceLocks
];

const results = [];
for (const scenario of scenarios) {
  const startedAt = performance.now();
  try {
    const details = await scenario();
    results.push({
      name: scenario.scenarioName,
      pass: true,
      durationMs: Math.round(performance.now() - startedAt),
      ...details
    });
  } catch (error) {
    results.push({
      name: scenario.scenarioName,
      pass: false,
      durationMs: Math.round(performance.now() - startedAt),
      error: error.message
    });
  }
}

for (const result of results) {
  const status = result.pass ? "PASS" : "FAIL";
  console.log(`${status} ${result.name} (${result.durationMs}ms)`);
  if (!result.pass) {
    console.log(`  ${result.error}`);
  } else {
    console.log(`  ${JSON.stringify(compactResult(result))}`);
  }
}

const failed = results.filter((result) => !result.pass);
if (failed.length) {
  console.error(`\n${failed.length} concurrency scenario(s) failed.`);
  process.exit(1);
}

console.log("\nAll concurrency scenarios passed.");
