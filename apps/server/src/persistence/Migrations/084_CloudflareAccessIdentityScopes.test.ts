import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

it.effect("keeps the original paired browser's scopes when upgrading stored identities", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 83 });
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
