import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import { AuthEnvironmentScopes } from "@t3tools/contracts";

import {
  type AuthCloudflareAccessGrantRepositoryError,
  PersistenceSqlError,
  toPersistenceDecodeError,
} from "./Errors.ts";

export const AuthCloudflareAccessGrantRecord = Schema.Struct({
  identitySub: Schema.String,
  email: Schema.NullOr(Schema.String),
  scopes: Schema.fromJsonString(AuthEnvironmentScopes),
  sessionSubject: Schema.String,
  pairedAt: Schema.DateTimeUtcFromString,
  lastSeenAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type AuthCloudflareAccessGrantRecord = typeof AuthCloudflareAccessGrantRecord.Type;

const decodeAuthCloudflareAccessGrantRecord = Schema.decodeEffect(AuthCloudflareAccessGrantRecord);

export const UpsertAuthCloudflareAccessGrantInput = Schema.Struct({
  identitySub: Schema.String,
  email: Schema.NullOr(Schema.String),
  scopes: AuthEnvironmentScopes,
  sessionSubject: Schema.String,
  pairedAt: Schema.DateTimeUtcFromString,
});
export type UpsertAuthCloudflareAccessGrantInput = typeof UpsertAuthCloudflareAccessGrantInput.Type;

const AuthCloudflareAccessGrantDbRow = Schema.Struct({
  identitySub: Schema.String,
  email: Schema.NullOr(Schema.String),
  scopes: Schema.String,
  sessionSubject: Schema.String,
  pairedAt: Schema.String,
  lastSeenAt: Schema.NullOr(Schema.String),
});
type AuthCloudflareAccessGrantDbRow = typeof AuthCloudflareAccessGrantDbRow.Type;

export class AuthCloudflareAccessGrantRepository extends Context.Service<
  AuthCloudflareAccessGrantRepository,
  {
    readonly upsert: (
      input: UpsertAuthCloudflareAccessGrantInput,
    ) => Effect.Effect<void, AuthCloudflareAccessGrantRepositoryError>;
    readonly findByIdentitySub: (
      identitySub: string,
    ) => Effect.Effect<
      Option.Option<AuthCloudflareAccessGrantRecord>,
      AuthCloudflareAccessGrantRepositoryError
    >;
    readonly touchLastSeen: (
      identitySub: string,
      seenAt: string,
    ) => Effect.Effect<void, AuthCloudflareAccessGrantRepositoryError>;
  }
>()("t3/persistence/AuthCloudflareAccessGrants/AuthCloudflareAccessGrantRepository") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsert = SqlSchema.void({
    Request: UpsertAuthCloudflareAccessGrantInput,
    execute: (input) =>
      sql`
        INSERT INTO auth_cloudflare_access_grants (
          identity_sub,
          email,
          scopes,
          session_subject,
          paired_at
        ) VALUES (
          ${input.identitySub},
          ${input.email},
          ${JSON.stringify(input.scopes)},
          ${input.sessionSubject},
          ${input.pairedAt}
        )
        ON CONFLICT(identity_sub) DO UPDATE SET
          email = excluded.email,
          scopes = excluded.scopes,
          session_subject = excluded.session_subject,
          paired_at = excluded.paired_at
      `,
  });

  const findByIdentitySub: AuthCloudflareAccessGrantRepository["Service"]["findByIdentitySub"] =
    Effect.fn("AuthCloudflareAccessGrantRepository.findByIdentitySub")(function* (identitySub) {
      const rows = yield* sql<AuthCloudflareAccessGrantDbRow>`
        SELECT
          identity_sub AS identitySub,
          email AS email,
          scopes AS scopes,
          session_subject AS sessionSubject,
          paired_at AS pairedAt,
          last_seen_at AS lastSeenAt
        FROM auth_cloudflare_access_grants
        WHERE identity_sub = ${identitySub}
        LIMIT 1
      `.pipe(
        Effect.mapError(
          (cause): AuthCloudflareAccessGrantRepositoryError =>
            new PersistenceSqlError({
              operation: "find_cloudflare_access_grant",
              cause,
            }),
        ),
      );
      const row = rows[0];
      if (row === undefined) {
        return Option.none();
      }
      return yield* decodeAuthCloudflareAccessGrantRecord(row).pipe(
        Effect.mapError(
          toPersistenceDecodeError(
            "AuthCloudflareAccessGrantRepository.findByIdentitySub:decodeRow",
          ),
        ),
        Effect.asSome,
      );
    });

  const touchLastSeen = (identitySub: string, seenAt: string) =>
    sql`
      UPDATE auth_cloudflare_access_grants
      SET last_seen_at = ${seenAt}
      WHERE identity_sub = ${identitySub}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(
        (cause): AuthCloudflareAccessGrantRepositoryError =>
          new PersistenceSqlError({
            operation: "touch_cloudflare_access_grant",
            cause,
          }),
      ),
    );

  return AuthCloudflareAccessGrantRepository.of({
    upsert: Effect.fn("AuthCloudflareAccessGrantRepository.upsert")((input) =>
      upsert(input).pipe(
        Effect.mapError(
          (cause): AuthCloudflareAccessGrantRepositoryError =>
            new PersistenceSqlError({
              operation: "upsert_cloudflare_access_grant",
              cause,
            }),
        ),
      ),
    ),
    findByIdentitySub,
    touchLastSeen,
  });
});

export const layer = Layer.effect(AuthCloudflareAccessGrantRepository, make);
