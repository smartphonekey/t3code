import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Re-runs on databases that recorded this migration in the upstream ledger as 83.
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(scheduled_tasks)`;
  if (columns.some((column) => column.name === "billing_user_id")) return;
  yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN billing_user_id TEXT`;
});
