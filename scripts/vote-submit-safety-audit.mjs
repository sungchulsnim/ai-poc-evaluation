import { readFileSync } from "node:fs";

const voteHtml = readFileSync("public/vote.html", "utf8");
const voteJs = readFileSync("public/vote.js", "utf8");
const apiJs = readFileSync("functions/api/[[path]].js", "utf8");

const draftClickHandler = sliceBetween(
  voteJs,
  'draftButton.addEventListener("click"',
  'findMissingButton.addEventListener("click"'
);
const saveDraftFunction = extractFunction(voteJs, "saveDraft");
const handleScoreChangeFunction = extractFunction(voteJs, "handleScoreChange");
const dynamicChecks = await runDynamicApiChecks();

const checks = [
  {
    name: "draft button is not a submit button",
    pass: /id="draftButton"[^>]*type="button"/.test(voteHtml)
  },
  {
    name: "missing-item button is not a submit button",
    pass: /id="findMissingButton"[^>]*type="button"/.test(voteHtml)
  },
  {
    name: "only the final button can start submit intent",
    pass: /let submitIntent = false;/.test(voteJs)
      && /submitButton\.addEventListener\("click"[\s\S]*?submitIntent = true;/.test(voteJs)
      && /if \(!isFinalSubmitClick\)/.test(voteJs)
  },
  {
    name: "duplicate form submits are blocked while submitting",
    pass: /let isSubmitting = false;/.test(voteJs)
      && /if \(isSubmitting\) return;/.test(voteJs)
      && /isSubmitting = true;/.test(voteJs)
  },
  {
    name: "draft save never calls submit endpoint",
    pass: !draftClickHandler.includes("/api/submit")
      && !saveDraftFunction.includes("/api/submit")
  },
  {
    name: "score changes only save a draft",
    pass: handleScoreChangeFunction.includes("saveDraft();")
      && handleScoreChangeFunction.includes("updateProgress();")
      && !handleScoreChangeFunction.includes("/api/submit")
  },
  {
    name: "submit payload explicitly marks final submission",
    pass: /finalSubmit: true/.test(voteJs)
  },
  {
    name: "server rejects non-final submit calls",
    pass: /body\.finalSubmit !== true/.test(apiJs)
  },
  {
    name: "server requires a device id before accepting a submit",
    pass: /body\.deviceId/.test(apiJs) && /단말 식별 정보/.test(apiJs)
  },
  {
    name: "duplicate detection does not use shared IP or generic fingerprint",
    pass: /device_hash = \?/.test(apiJs)
      && !/ip = \?/.test(apiJs)
      && !/fingerprint_hash = \?/.test(apiJs)
  },
  ...dynamicChecks
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? "PASS" : "FAIL"} ${check.name}`);
}

if (failed.length) {
  console.error(`\n${failed.length} vote submit safety check(s) failed.`);
  process.exit(1);
}

console.log("\nAll vote submit safety checks passed.");

function sliceBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  if (start === -1 || end === -1) return "";
  return source.slice(start, end);
}

function extractFunction(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  if (start === -1) return "";
  const openBrace = source.indexOf("{", start);
  if (openBrace === -1) return "";

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  return "";
}

async function runDynamicApiChecks() {
  const { onRequest } = await import("../functions/api/[[path]].js");
  const env = {
    DB: createMockD1(),
    ADMIN_PASSWORD: "z1",
    SESSION_SECRET: "test-secret"
  };

  const draftLikeResponse = await onRequest({
    request: jsonRequest("/api/submit", {
      groupId: "group6",
      deviceId: "device-for-draft-test",
      scores: {}
    }),
    env
  });
  const draftLikeBody = await draftLikeResponse.json();

  const missingDeviceResponse = await onRequest({
    request: jsonRequest("/api/submit", {
      groupId: "group6",
      finalSubmit: true,
      scores: {}
    }),
    env
  });
  const missingDeviceBody = await missingDeviceResponse.json();

  return [
    {
      name: "server rejects draft-shaped submit requests at runtime",
      pass: draftLikeResponse.status === 400
        && draftLikeBody.ok === false
        && /최종제출/.test(draftLikeBody.message || "")
    },
    {
      name: "server rejects final submit requests without device id at runtime",
      pass: missingDeviceResponse.status === 400
        && missingDeviceBody.ok === false
        && /단말/.test(missingDeviceBody.message || "")
    }
  ];
}

function jsonRequest(path, body) {
  return new Request(`https://test.local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function createMockD1() {
  const statement = {
    bind() {
      return this;
    },
    async first() {
      return null;
    },
    async run() {
      return { success: true };
    },
    async all() {
      return { results: [] };
    }
  };

  return {
    prepare() {
      return statement;
    },
    async batch() {
      return [];
    }
  };
}
