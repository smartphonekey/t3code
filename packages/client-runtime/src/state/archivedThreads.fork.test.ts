import { EnvironmentId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";

import { managedRelaySessionAtom } from "../relay/managedRelayState.ts";
import {
  createArchivedThreadSnapshotsAtomFamily,
  makeArchivedThreadsEnvironmentKey,
} from "./archivedThreads.ts";
import { v2ThreadShell } from "./orchestrationV2TestFixtures.ts";
import { threadOwnershipScopeAtom } from "./threadOwnership.ts";

it("filters archived ownership while preserving access through All chats", () => {
  const environmentId = EnvironmentId.make("archive:ownership");
  const snapshotsAtom = createArchivedThreadSnapshotsAtomFamily({
    getSnapshotAtom: () =>
      Atom.make(
        AsyncResult.success({
          schemaVersion: 1 as const,
          snapshotSequence: 1,
          projects: [],
          threads: ["alice", "bob", undefined].map((ownerUserId, index) => ({
            ...v2ThreadShell,
            id: ThreadId.make(`archive:${index}`),
            ...(ownerUserId === undefined ? {} : { ownerUserId }),
          })),
        }),
      ),
    hiddenThreadTagsAtom: () => Atom.make(null),
    hiddenThreadKeysAtom: Atom.make((): ReadonlySet<string> => new Set()),
    liveThreadRefsAtom: Atom.make((): ReadonlyArray<ScopedThreadRef> => []),
    anyEnvironmentHidingAtom: Atom.make(false),
    labelPrefix: "test:archive-ownership",
  });
  const registry = AtomRegistry.make();
  registry.set(managedRelaySessionAtom, {
    accountId: "alice",
    readClerkToken: () => Effect.succeed(null),
  });
  const atom = snapshotsAtom(makeArchivedThreadsEnvironmentKey([environmentId]));
  const dispose = registry.mount(atom);
  expect(registry.get(atom).snapshots[0]?.snapshot.threads.map((thread) => thread.id)).toEqual([
    "archive:0",
  ]);
  registry.set(threadOwnershipScopeAtom("alice"), "all");
  expect(registry.get(atom).snapshots[0]?.snapshot.threads).toHaveLength(3);
  dispose();
  registry.dispose();
});
