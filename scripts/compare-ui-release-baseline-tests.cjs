#!/usr/bin/env node
// Compare known pre-release suite failures with the release candidate.
// A UI-only release must introduce ZERO new failures relative to pinned production.
const fs = require("node:fs");

const [candidateFile, baselineFile] = process.argv.slice(2);
if (!candidateFile || !baselineFile) {
  console.error("Usage: node scripts/compare-ui-release-baseline-tests.cjs candidate.log baseline.log");
  process.exit(2);
}
function names(file) {
  const output = fs.readFileSync(file, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
  const tests = [...output.matchAll(/^not ok\s+\d+\s+-\s+(.+)$/gm)].map((m) => m[1].trim());
  const declared = output.match(/^# tests\s+(\d+)$/m);
  const failed = output.match(/^# fail\s+(\d+)$/m);
  if (!declared || !failed) throw new Error("Missing complete TAP summary in " + file);
  return { tests, count: Number(declared[1]), failures: Number(failed[1]) };
}
const candidate = names(candidateFile);
const baseline = names(baselineFile);
const remaining = [...candidate.tests];
for (const known of baseline.tests) {
  const index = remaining.indexOf(known);
  if (index >= 0) remaining.splice(index, 1);
}
console.log("Pinned production baseline:", baseline.count, "tests,", baseline.failures, "existing failures");
console.log("UI-v2 candidate:", candidate.count, "tests,", candidate.failures, "failures");
if (remaining.length) {
  console.error("New candidate regressions:", remaining.join("; "));
  process.exit(1);
}
if (candidate.tests.length < baseline.tests.length && candidate.count < baseline.count) {
  console.error("Candidate ran fewer tests than the production baseline");
  process.exit(1);
}
console.log("PASS: no new failed tests relative to pinned production");
