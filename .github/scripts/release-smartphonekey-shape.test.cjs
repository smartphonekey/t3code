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
  assert.match(
    workflow,
    /needs:\s*\n\s*\[\s*\n\s*preflight,\s*\n\s*desktop_linux_x64,/s,
    "release job must wait on the four desktop CLI jobs only",
  );
  assert.doesNotMatch(workflow, /needs\.desktop_mac_arm64/);
});
