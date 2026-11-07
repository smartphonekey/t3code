import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import { type AuthCloudflareAccessIdentityRepositoryError, PersistenceSqlError } from "./Errors.ts";

export const AuthCloudflareAccessIdentityRecord = Schema.Struct({
  identityKey: Schema.String,
  subject: Schema.String,
  email: Schema.NullOr(Schema.String),
  pairedAt: Schema.DateTimeUtcFromString,
});
export type AuthCloudflareAccessIdentityRecord = typeof AuthCloudflareAccessIdentityRecord.Type;

export const UpsertAuthCloudflareAccessIdentityInput = Schema.Struct({
  identityKey: Schema.String,
  subject: Schema.String,
  email: Schema.NullOr(Schema.String),
  pairedAt: Schema.DateTimeUtcFromString,
});
export type UpsertAuthCloudflareAccessIdentityInput =
  typeof UpsertAuthCloudflareAccessIdentityInput.Type;

export const GetAuthCloudflareAccessIdentityInput = Schema.Struct({
  key: Schema.String,
});
export type GetAuthCloudflareAccessIdentityInput = typeof GetAuthCloudflareAccessIdentityInput.Type;

export const DeleteAuthCloudflareAccessIdentityInput = Schema.Struct({
  key: Schema.String,
});
export type DeleteAuthCloudflareAccessIdentityInput =
  typeof DeleteAuthCloudflareAccessIdentityInput.Type;

export class AuthCloudflareAccessIdentityRepository extends Context.Service<
  AuthCloudflareAccessIdentityRepository,
  {
    readonly getByIdentityKey: (
      input: GetAuthCloudflareAccessIdentityInput,
    ) => Effect.Effect<
      Option.Option<AuthCloudflareAccessIdentityRecord>,
      AuthCloudflareAccessIdentityRepositoryError
    >;
    readonly upsert: (
      input: UpsertAuthCloudflareAccessIdentityInput,
    ) => Effect.Effect<void, AuthCloudflareAccessIdentityRepositoryError>;
    readonly deleteByIdentityKey: (
      input: DeleteAuthCloudflareAccessIdentityInput,
    ) => Effect.Effect<boolean, AuthCloudflareAccessIdentityRepositoryError>;
  }
>()("t3/persistence/AuthCloudflareAccessIdentities/AuthCloudflareAccessIdentityRepository") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getIdentityRow = SqlSchema.findOneOption({
    Request: GetAuthCloudflareAccessIdentityInput,
    Result: AuthCloudflareAccessIdentityRecord,
    execute: (input) =>
      sql`
        SELECT
          identity_key AS identityKey,
          subject,
          email,
          paired_at AS pairedAt
        FROM auth_cloudflare_access_identities
        WHERE identity_key = ${input.key}
      `,
  });

  const deleteIdentityRow = SqlSchema.void({
    Request: DeleteAuthCloudflareAccessIdentityInput,
    execute: (input) =>
      sql`
        DELETE FROM auth_cloudflare_access_identities
        WHERE identity_key = ${input.key}
      `,
  });

  const upsertIdentity = SqlSchema.void({
    Request: UpsertAuthCloudflareAccessIdentityInput,
    execute: (input) =>
      sql`
        INSERT INTO auth_cloudflare_access_identities (
          identity_key,
          subject,
          email,
          paired_at
        ) VALUES (
          ${input.identityKey},
          ${input.subject},
          ${input.email},
          ${input.pairedAt}
        )
        ON CONFLICT(identity_key) DO UPDATE SET
          subject = excluded.subject,
          email = excluded.email,
          paired_at = excluded.paired_at
      `,
  });

  const getByIdentityKey: AuthCloudflareAccessIdentityRepository["Service"]["getByIdentityKey"] =
    Effect.fn("AuthCloudflareAccessIdentityRepository.getByIdentityKey")(function* (input) {
      return yield* getIdentityRow(input).pipe(
        Effect.mapError(
          (cause) =>
            new PersistenceSqlError({ operation: "get-cloudflare-access-identity", cause }),
        ),
      );
    });

  const upsert: AuthCloudflareAccessIdentityRepository["Service"]["upsert"] = Effect.fn(
    "AuthCloudflareAccessIdentityRepository.upsert",
  )(function* (input) {
    yield* upsertIdentity(input).pipe(
      Effect.mapError(
        (cause) =>
          new PersistenceSqlError({ operation: "upsert-cloudflare-access-identity", cause }),
      ),
    );
  });

  const deleteByIdentityKey: AuthCloudflareAccessIdentityRepository["Service"]["deleteByIdentityKey"] =
    Effect.fn("AuthCloudflareAccessIdentityRepository.deleteByIdentityKey")(function* (input) {
      const existing = yield* getIdentityRow(input).pipe(
        Effect.mapError(
          (cause) =>
            new PersistenceSqlError({ operation: "get-cloudflare-access-identity", cause }),
        ),
      );
      if (Option.isNone(existing)) {
        return false;
      }
      yield* deleteIdentityRow(input).pipe(
        Effect.mapError(
          (cause) =>
            new PersistenceSqlError({ operation: "delete-cloudflare-access-identity", cause }),
        ),
      );
      return true;
    });

  return AuthCloudflareAccessIdentityRepository.of({
    getByIdentityKey,
    upsert,
    deleteByIdentityKey,
  });
});

export const layer = Layer.effect(AuthCloudflareAccessIdentityRepository, make);
