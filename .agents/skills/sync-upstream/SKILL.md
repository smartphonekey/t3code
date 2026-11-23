---
name: sync-upstream
description: Rebase the smartphonekey fork's patch stack onto a newer upstream T3 Code (pingdotgg/t3code) and keep that stack cheap to rebase. Use when asked to sync, rebase or update the fork from upstream, when adding fork-only code to a file upstream owns, or when a fork follow-up commit needs folding into its feature commit.
---

# Sync the fork with upstream

`smartphonekey/t3code` is `pingdotgg/t3code` plus a short stack of fork commits. Upstream does not
take feature PRs ([CONTRIBUTING.md](../../../CONTRIBUTING.md)), so the stack is permanent and is
rebased often. Upstream moves fast (about 200 commits landed in the day before this was written):
sync daily or close to it, because conflicts grow faster than the gap.

## The stack

`main` is upstream's `main` plus one commit per fork feature, in this order:

1. `feat(auth)`: Cloudflare Access identity pairing, per-account chats, provider subscriptions
2. `feat(mobile)`: Cloudflare Access WebView login
3. `feat(release)`: smartphonekey release CI and configurable updater feed
4. `feat(source-control)`: GitHub repository search across orgs
5. `fix(codex)`: catalog agents disabled for ChatGPT sharing
6. `chore(ci)`: Linux x64 jobs on spk-aws runners
7. `chore(i18n)`: generated catalogs. Always last, never rebased: dropped and recreated.

List it with `git log --oneline upstream/main..main`. Commits after the i18n commit are follow-ups
merged since the last sync; each says in its message which feature it folds into.

## Sync

Work on a branch, never on `main`. `rerere` does not survive a cloud session, so do not rely on it.

```sh
git remote add upstream https://github.com/pingdotgg/t3code   # once per clone
git fetch upstream main && git fetch origin main
git checkout -B sync origin/main
```

1. **Rebuild the stack** on `upstream/main` with `git cherry-pick`, oldest first, leaving out the
   i18n commit. Fold each follow-up into its feature as you go: `git cherry-pick -n <follow-up>`
   then `git commit --amend --no-edit`. A new fork feature becomes its own commit before i18n.

   ```sh
   git checkout -B sync-next upstream/main
   git cherry-pick <feature>          # then -n <follow-up> && git commit --amend --no-edit
   ```

2. **Resolve conflicts by regenerating, not merging**, wherever the table below has a recipe.
   During a cherry-pick `--ours` is upstream and `--theirs` is the fork commit.

   | Conflict in                                    | Do this                                                                                                         |
   | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
   | `pnpm-lock.yaml`                               | `git checkout --ours pnpm-lock.yaml && vp i --lockfile-only`                                                    |
   | a workflow whose only fork edit is `runs-on`   | `git checkout --ours <file>`, then `node .agents/skills/sync-upstream/scripts/route-ci-runners.mjs`             |
   | `ci.yml`, `release.yml`, `release-desktop.yml` | merge the bootstrap and timeout edits by hand, then run the same script for the `runs-on` lines                 |
   | `release-smartphonekey.yml`                  | keep the fork copy (`--theirs`); it builds four CLI targets and must not gain macOS jobs from upstream `release.yml` |
   | `apps/*/src/i18n/translations/*.json`          | should not happen: only the last commit touches them. Take `--ours`; step 3 recreates them.                     |
   | anything else                                  | by hand. Keep upstream's new behavior and re-apply the fork's intent; read both sides' commits before choosing. |

3. **Recreate the i18n commit.** The fork's strings are not translated (every locale holds the
   English text), so regenerating loses nothing. If someone has since translated fork strings by
   hand, copy those keys back from `origin/main` afterwards: a key is a hash of its English text.

   ```sh
   (cd apps/web && vp run i18n:generate) && (cd apps/mobile && vp run i18n:generate)
   vp fmt apps/web/src/i18n/translations apps/mobile/src/i18n/translations
   vp run i18n:check
   git commit -am "chore(i18n): generated catalogs for the fork's UI copy"
   ```

4. **Verify.** Use the Node version in `package.json`; older ones fail unrelated tests.

   ```sh
   node .agents/skills/sync-upstream/scripts/route-ci-runners.mjs --check
   vp i --frozen-lockfile && vp run check:changed
   git range-diff origin/main~<n>..origin/main upstream/main..sync-next   # n = old stack length
   ```

   `route-ci-runners.mjs --check` fails when a routed job was renamed or removed upstream and
   notes Linux jobs that are not routed to spk-aws; update `ROUTED` in the script to match.
   `range-diff` should show every feature present and only the changes you made on purpose.
   Then confirm the invariants below.

5. **Publish.** Replacing `main` is a force-push: get the maintainer's go-ahead for that push,
   every time. Tag the old tip first with a name that is not `v*.*.*` (those tags start a release),
   push with `--force-with-lease`, and list the open PRs that now need a rebase onto the new `main`.

   ```sh
   git tag spk-sync/$(date +%F) origin/main && git push origin spk-sync/$(date +%F)
   git push --force-with-lease=main:origin/main origin sync-next:main
   ```

## Invariants to confirm after every sync

- `release-smartphonekey.yml` publishes four CLI archives (Linux x64/arm64, Windows x64/arm64) and
  must not call `release-desktop.yml` for macOS. Fork deploys use the Linux x64 asset from
  `SHA256SUMS`; omitting `darwin-arm64` there is fine. Do not copy upstream `release.yml`'s macOS
  jobs into the fork workflow during a sync.
- `RpcAuthorization.layer(` has one non-test call site, in `apps/server/src/ws.ts`, and it is
  piped through `RequestAccount.bindRpc`. That wrapper is what gives an RPC its account and runs
  the provider subscription guard; an RPC route without it is unguarded.
- `ProviderSubscriptions.test.ts` passes. It fails when upstream adds an RPC that names a provider
  account: add the RPC to `RPC_GUARDS` or to the test's open list, on purpose.
- Fork migrations stay in `apps/server/src/persistence/ForkMigrations/`, never in upstream's
  migration list, so upstream's numbering cannot collide with ours.

## Writing fork code so it rebases

Every line the fork changes in a file upstream owns is a future conflict. When adding fork behavior:

- Put the logic in a file the fork owns and call it from the upstream file in one line. A table
  applied at one choke point beats the same edit in many handlers.
- Add an import inside the import block, after a single-line `import * as …`, not above line 1:
  the first import is usually a wide `@t3tools/contracts` list upstream edits constantly.
- Put a fork test in its own `<name>.fork.test.ts` when it needs nothing the upstream test file
  defines privately. When it does need that file's fixtures, add it there; do not copy fixtures.
- Never edit a locale catalog or `pnpm-lock.yaml` by hand in a feature commit.
- Commit follow-ups normally and name the feature they belong to in the message. They are folded
  at the next sync, so the stack stays one commit per feature.
