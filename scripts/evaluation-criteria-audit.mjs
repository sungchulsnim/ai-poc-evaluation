import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const expectedCriteria = [
  {
    id: "immediateUse",
    title: "즉시활용성",
    weight: 50,
    question: "법인이 바로 사용할 수 있는 완성도, 실사용 가능성, 입력/출력 흐름의 명확성"
  },
  {
    id: "businessEffect",
    title: "업무효과성",
    weight: 30,
    question: "시간 절감, 반복업무 감소, 업무 품질 개선, 의사결정 지원 효과"
  },
  {
    id: "usability",
    title: "사용편의성",
    weight: 20,
    question: "법인에서 쉽게 이해하고 사용할 수 있는지, AI 결과 확인·수정이 쉬운지 등"
  }
];

const config = JSON.parse(read("config.json"));
assert.deepEqual(config.criteria, expectedCriteria, "config.json criteria must match the approved rubric");

const api = read("functions/api/[[path]].js");
for (const criterion of expectedCriteria) {
  assert.match(api, new RegExp(`${criterion.id}: ${criterion.weight}`), `API weight missing: ${criterion.id}`);
  assert.ok(api.includes(`id: "${criterion.id}"`), `API criterion ID missing: ${criterion.id}`);
  assert.ok(api.includes(`weight: ${criterion.weight}`), `API criterion weight missing: ${criterion.id}`);
  assert.ok(api.includes(`question: "${criterion.question}"`), `API criterion description missing: ${criterion.id}`);
}
assert.ok(api.includes("rawScoreRange: { min: 4, max: 20 }"), "API raw score range must be 4..20");
assert.ok(api.includes("finalScoreRange: { min: 20, max: 100 }"), "API final score range must be 20..100");

const admin = read("public/admin.js");
for (const criterion of expectedCriteria) {
  assert.match(admin, new RegExp(`${criterion.id}: ${criterion.weight}`), `admin weight missing: ${criterion.id}`);
}

const vote = read("public/vote.js");
for (const token of [
  "각 과제별 3개 항목을 5점부터 1점까지 평가해 주세요.",
  "data-criterion-info=",
  "ensureCriterionDialog()",
  "handleCriterionInfoClick",
  'document.createElement("dialog")',
  "showModal()"
]) {
  assert.ok(vote.includes(token), `vote popup token missing: ${token}`);
}

const css = read("public/app.css");
for (const selector of [".criterion-info-button", ".criterion-dialog", ".criterion-dialog::backdrop"]) {
  assert.ok(css.includes(selector), `popup style missing: ${selector}`);
}

console.log("PASS evaluation criteria and popup audit");
