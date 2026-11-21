import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import Migration0001 from "./ForkMigrations/001_AuthCloudflareAccessIdentities.ts";
import Migration0002 from "./ForkMigrations/002_AuthSessionCloudflareAccessIdentity.ts";
import Migration0003 from "./ForkMigrations/003_ScheduledTaskBillingUser.ts";
import Migration0004 from "./ForkMigrations/004_CloudflareAccessIdentityScopes.ts";

// Fork-only schema keeps its own ledger, so upstream migration ids never collide with the fork's.
// Add fork migrations here, never to Migrations.ts.
export const FORK_MIGRATIONS_TABLE = "fork_sql_migrations";

const forkMigrationEntries = [
  [1, "AuthCloudflareAccessIdentities", Migration0001],
  [2, "AuthSessionCloudflareAccessIdentity", Migration0002],
  [3, "ScheduledTaskBillingUser", Migration0003],
  [4, "CloudflareAccessIdentityScopes", Migration0004],
] as const;

type MigrationRow = { readonly id: number; readonly name: string };

// Older fork builds recorded these in upstream's ledger as 81–84, ids upstream now uses.
const LEGACY_UPSTREAM_LEDGER_ROWS: ReadonlyArray<MigrationRow> = forkMigrationEntries.map(
  ([id, name]) => ({ id: id + 80, name }),
);

/** Upstream's ledger as startup leaves it once it forgets the fork's legacy rows. */
export function withoutLegacyForkMigrations(
  history: ReadonlyArray<MigrationRow>,
): ReadonlyArray<MigrationRow> {
  return history.filter(
    (row) =>
      !LEGACY_UPSTREAM_LEDGER_ROWS.some((legacy) => legacy.id === row.id && legacy.name === row.name),
  );
}

/** Lets upstream's 81+ run on an older fork database; the fork ledger then re-runs the fork's
 * migrations, which skip schema already in place. */
export const forgetLegacyForkMigrations = Effect.fn("forgetLegacyForkMigrations")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length === 0) return;
  yield* sql.withTransaction(
    Effect.forEach(
      LEGACY_UPSTREAM_LEDGER_ROWS,
      ({ id, name }) =>
        sql`DELETE FROM effect_sql_migrations WHERE migration_id = ${id} AND name = ${name}`,
      { discard: true },
    ),
  );
});

const LATEST_FORK_MIGRATION_ID = Math.max(...forkMigrationEntries.map(([id]) => id));

/** Read-only, like upstream's check: with nothing pending, startup must write nothing. */
export const hasPendingForkMigrations = Effect.fn("hasPendingForkMigrations")(function* (
  throughId?: number,
) {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${FORK_MIGRATIONS_TABLE}
  `;
  if (tables.length === 0) return true;
  const rows = yield* sql<{
    readonly latestId: number | null;
  }>`SELECT MAX(migration_id) AS latestId FROM fork_sql_migrations`;
  return (rows[0]?.latestId ?? 0) < (throughId ?? LATEST_FORK_MIGRATION_ID);
});

const run = Migrator.make({});

export const runForkMigrations = Effect.fn("runForkMigrations")(function* (throughId?: number) {
  if (!(yield* hasPendingForkMigrations(throughId))) return [];
  const executed = yield* run({
    loader: Migrator.fromRecord(
      Object.fromEntries(
        forkMigrationEntries
          .filter(([id]) => throughId === undefined || id <= throughId)
          .map(([id, name, migration]) => [`${id}_${name}`, migration]),
      ),
    ),
    table: FORK_MIGRATIONS_TABLE,
  });
  if (executed.length > 0) {
    yield* Effect.log("Fork database migrations finished").pipe(
      Effect.annotateLogs({ migrations: executed.map(([id, name]) => `${id}_${name}`) }),
    );
  }
  return executed;
});
