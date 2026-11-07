import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const sessionColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(auth_sessions)
  `;
  if (!sessionColumns.some((column) => column.name === "cloudflare_access_identity_key")) {
    yield* sql`
      ALTER TABLE auth_sessions
      ADD COLUMN cloudflare_access_identity_key TEXT
    `;
    yield* sql`
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_cloudflare_access_identity_key
      ON auth_sessions(cloudflare_access_identity_key)
      WHERE cloudflare_access_identity_key IS NOT NULL
        AND revoked_at IS NULL
    `;
  }
});
