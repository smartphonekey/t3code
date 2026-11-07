import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE auth_cloudflare_access_identities ADD COLUMN scopes_json TEXT NOT NULL DEFAULT '[]'`;
  yield* sql`ALTER TABLE auth_cloudflare_access_identities ADD COLUMN session_subject TEXT NOT NULL DEFAULT 'cloudflare-access-identity'`;
  // The oldest bound browser is the original pairing, before automatic resumes.
  yield* sql`
    UPDATE auth_cloudflare_access_identities
    SET scopes_json = COALESCE((
      SELECT scopes FROM auth_sessions WHERE cloudflare_access_identity_key = identity_key
      ORDER BY issued_at, session_id LIMIT 1
    ), '[]'), session_subject = COALESCE((
      SELECT subject FROM auth_sessions WHERE cloudflare_access_identity_key = identity_key
      ORDER BY issued_at, session_id LIMIT 1
    ), 'cloudflare-access-identity')
  `;
});
