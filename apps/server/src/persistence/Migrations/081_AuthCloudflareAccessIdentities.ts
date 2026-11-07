import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS auth_cloudflare_access_identities (
      identity_key TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      email TEXT,
      paired_at TEXT NOT NULL
    )
  `;
});
