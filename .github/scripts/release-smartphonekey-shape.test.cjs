const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const workflowPath = join(__dirname, "../workflows/release-smartphonekey.yml");
const workflow = readFileSync(workflowPath, "utf8");

test("release-smartphonekey.yml builds four CLI targets without macOS", () => {
  assert.doesNotMatch(workflow, /desktop_mac_arm64/);
  assert.doesNotMatch(workflow, /macos-26/);
  for (const job of [
    "desktop_linux_x64",
    "desktop_linux_arm64",
    "desktop_win_x64",
    "desktop_win_arm64",
  ]) {
    assert.match(workflow, new RegExp(`^  ${job}:`, "m"), `missing job ${job}`);
  }
  const releaseJob = workflow.split("\n  release:")[1];
  assert.ok(releaseJob, "missing release job");
  const releaseNeeds = releaseJob.match(/^    needs: (.+)$/m)?.[1];
  assert.ok(releaseNeeds, "release job needs");
  for (const job of [
    "preflight",
    "desktop_linux_x64",
    "desktop_linux_arm64",
    "desktop_win_x64",
    "desktop_win_arm64",
  ]) {
    assert.match(releaseNeeds, new RegExp(`\\b${job}\\b`), `release job missing need ${job}`);
  }
  assert.doesNotMatch(releaseNeeds, /\bdesktop_mac_arm64\b/);
  assert.doesNotMatch(workflow, /needs\.desktop_mac_arm64/);
});
