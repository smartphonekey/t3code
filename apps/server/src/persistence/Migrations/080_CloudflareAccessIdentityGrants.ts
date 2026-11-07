import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS auth_cloudflare_access_grants (
      identity_sub TEXT PRIMARY KEY,
      email TEXT,
      scopes TEXT NOT NULL,
      session_subject TEXT NOT NULL,
      paired_at TEXT NOT NULL,
      last_seen_at TEXT
    )
  `;
});
