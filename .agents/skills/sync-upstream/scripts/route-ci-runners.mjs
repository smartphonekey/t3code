#!/usr/bin/env node
// Points the fork's Linux x64 CI jobs at the spk-aws self-hosted runners. `--check` only reports.
// A rebase never merges this rewrite by hand: take upstream's side of the workflow, then run this.
// The fork's other workflow edits (bootstrap steps, timeouts) still merge by hand.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

// Upstream workflow -> jobs the fork runs on spk-aws. Fork-owned workflows are written with the
// routed expression already and are not listed.
const ROUTED = {
  "agent-context-budget.yml": "budget",
  "ci.yml": "changes lint build test test_web test_server rust release_smoke check",
  "deploy-relay.yml": "deploy_relay",
  "desktop-macos-preview-publish.yml": "resolve publish",
  "desktop-macos-preview.yml": "build",
  "issue-labels.yml": "sync",
  "mobile-android-apk.yml": "mirror",
  "mobile-eas-preview.yml": "ios",
  "mobile-eas-production.yml": "production",
  "mobile-fingerprint-check.yml": "fingerprint",
  "mobile-fingerprint-label.yml": "label",
  "mobile-showcase-screenshots.yml": "android",
  "publish-aur.yml": "publish",
  "relay-preview-cleanup.yml": "list_closed_previews sweep_pr",
  "relay-preview.yml": "deploy_preview",
  "release.yml":
    "resolve_commit preflight quality test test_web test_server relay_public_config build_bundle release publish_cli build_web deploy_web build_marketing deploy_marketing finalize announce_discord",
  "stale-needs-more-info.yml": "stale",
  "thread-transfer-report.yml": "publish",
  "web-preview.yml": "deploy",
};

const SPK = `fromJSON('["self-hosted","linux","x64","spk-aws"]')`;
const routed = (label) => `\${{ vars.CI_RUNNER == 'hosted' && '${label}' || ${SPK} }}`;
// Only plain Linux x64 labels are rewritten; macOS, Windows, arm and expressions stay as they are.
const LINUX_X64 = /^(ubuntu-[\w.]+|blacksmith-\d+vcpu-ubuntu-\d+)$/;

const check = process.argv.includes("--check");
const root = NodePath.resolve(import.meta.dirname, "../../../..");
const problems = [];
const notes = [];
let rewritten = 0;

for (const [file, jobList] of Object.entries(ROUTED)) {
  const path = NodePath.join(root, ".github/workflows", file);
  if (!NodeFS.existsSync(path)) {
    problems.push(`${file}: workflow is gone upstream; remove it from ROUTED`);
    continue;
  }
  const wanted = new Set(jobList.split(" "));
  const seen = new Set();
  let job;
  let inJobs = false;
  const lines = NodeFS.readFileSync(path, "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    if (/^\S/.test(line)) inJobs = line.startsWith("jobs:");
    if (!inJobs) continue;
    const jobMatch = /^ {2}([\w-]+):\s*$/.exec(line);
    if (jobMatch) job = jobMatch[1];
    const runsOn = /^ {4}runs-on: (.+)$/.exec(line);
    if (!runsOn || job === undefined) continue;
    const label = runsOn[1].trim();
    if (!wanted.has(job)) {
      if (LINUX_X64.test(label)) notes.push(`${file}: job ${job} runs on ${label}, not spk-aws`);
      continue;
    }
    seen.add(job);
    if (label.includes("vars.CI_RUNNER")) continue;
    if (!LINUX_X64.test(label)) {
      problems.push(`${file}: job ${job} now runs on ${label}; route it by hand or drop it`);
      continue;
    }
    if (check) problems.push(`${file}: job ${job} is not routed (runs-on: ${label})`);
    else lines[index] = `    runs-on: ${routed(label)}`;
    rewritten += check ? 0 : 1;
  }
  for (const name of wanted) {
    if (!seen.has(name)) problems.push(`${file}: job ${name} is gone or renamed upstream`);
  }
  if (!check) NodeFS.writeFileSync(path, lines.join("\n"));
}

for (const note of notes) console.log(`note: ${note}`);
for (const problem of problems) console.error(`error: ${problem}`);
console.log(
  check
    ? `${problems.length} problem(s), ${notes.length} unrouted Linux job(s)`
    : `routed ${rewritten} job(s)`,
);
process.exit(problems.length === 0 ? 0 : 1);
