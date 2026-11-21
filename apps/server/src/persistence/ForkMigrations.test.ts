import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runForkMigrations } from "./ForkMigrations.ts";
import Migration0001 from "./ForkMigrations/001_AuthCloudflareAccessIdentities.ts";
import Migration0002 from "./ForkMigrations/002_AuthSessionCloudflareAccessIdentity.ts";
import Migration0003 from "./ForkMigrations/003_ScheduledTaskBillingUser.ts";
import Migration0004 from "./ForkMigrations/004_CloudflareAccessIdentityScopes.ts";
import { migrationManifest, runMigrations } from "./Migrations.ts";

const UPSTREAM_HEAD = Math.max(...migrationManifest.map(([id]) => id));

it.effect("keeps the original paired browser's scopes when upgrading stored identities", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: UPSTREAM_HEAD });
    yield* runForkMigrations(3);
    yield* sql`INSERT INTO auth_cloudflare_access_identities
      (identity_key, subject, paired_at) VALUES ('paired', 'human', '2026-01-01'), ('orphan', 'other', '2026-01-01')`;
    for (const [id, subject, scopes, issuedAt] of [
      ["original", "one-time-token", '["orchestration:read"]', "2026-01-01T00:00:00Z"],
      [
        "resumed",
        "cloudflare-access-identity",
        '["orchestration:read","access:write"]',
        "2026-01-02T00:00:00Z",
      ],
    ] as const) {
      yield* sql`INSERT INTO auth_sessions
        (session_id, subject, scopes, method, client_device_type, cloudflare_access_identity_key, issued_at, expires_at)
        VALUES (${id}, ${subject}, ${scopes}, 'browser-session-cookie', 'desktop', 'paired', ${issuedAt}, '2100-01-01T00:00:00Z')`;
    }
    yield* runMigrations();
    assert.deepStrictEqual(
      yield* sql`SELECT identity_key, scopes_json, session_subject FROM auth_cloudflare_access_identities ORDER BY identity_key`,
      [
        {
          identity_key: "orphan",
          scopes_json: "[]",
          session_subject: "cloudflare-access-identity",
        },
        {
          identity_key: "paired",
          scopes_json: '["orchestration:read"]',
          session_subject: "one-time-token",
        },
      ],
    );
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("upgrades a database that recorded fork migrations as upstream ids 81-84", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 80 });
    for (const migration of [Migration0001, Migration0002, Migration0003, Migration0004]) {
      yield* migration;
    }
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES
      (81, 'AuthCloudflareAccessIdentities'), (82, 'AuthSessionCloudflareAccessIdentity'),
      (83, 'ScheduledTaskBillingUser'), (84, 'CloudflareAccessIdentityScopes')`;
    yield* sql`INSERT INTO auth_cloudflare_access_identities
      (identity_key, subject, paired_at, scopes_json, session_subject)
      VALUES ('paired', 'human', '2026-01-01', '["access:write"]', 'one-time-token')`;

    yield* runMigrations();

    const upstream = yield* sql<{
      readonly migration_id: number;
      readonly name: string;
    }>`SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id > 80 ORDER BY migration_id`;
    assert.deepStrictEqual(
      upstream.map((row) => [row.migration_id, row.name]),
      migrationManifest.filter(([id]) => id > 80).map(([id, name]) => [id, name]),
    );
    const fork = yield* sql<{
      readonly migration_id: number;
      readonly name: string;
    }>`SELECT migration_id, name FROM fork_sql_migrations ORDER BY migration_id`;
    assert.deepStrictEqual(
      fork.map((row) => [row.migration_id, row.name]),
      [
        [1, "AuthCloudflareAccessIdentities"],
        [2, "AuthSessionCloudflareAccessIdentity"],
        [3, "ScheduledTaskBillingUser"],
        [4, "CloudflareAccessIdentityScopes"],
      ],
    );
    assert.deepStrictEqual(
      yield* sql`SELECT identity_key, scopes_json, session_subject FROM auth_cloudflare_access_identities`,
      [
        {
          identity_key: "paired",
          scopes_json: '["access:write"]',
          session_subject: "one-time-token",
        },
      ],
    );
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
