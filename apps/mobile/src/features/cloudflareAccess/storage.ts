import { CloudflareAccessSession } from "@t3tools/client-runtime/cloudflare-access";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as MobileSecureStorage from "../../persistence/mobile-secure-storage";

const storageKey = (origin: string) => `cloudflare-access:${origin}`;

const sessionCodec = Schema.toCodecJson(CloudflareAccessSession);
const decodeSession = Schema.decodeUnknownEffect(sessionCodec);
const encodeSession = Schema.encodeUnknownEffect(Schema.fromJsonString(sessionCodec));
const parseRaw = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

export const loadCloudflareAccessSession = Effect.fn("mobile.cloudflareAccess.load")(function* (
  origin: string,
) {
  const secureStorage = yield* MobileSecureStorage.MobileSecureStorage;
  const raw = yield* secureStorage.getItem(storageKey(origin));
  if (raw === null) {
    return Option.none();
  }
  const parsed = yield* parseRaw(raw);
  return yield* decodeSession(parsed).pipe(Effect.option);
});

export const saveCloudflareAccessSession = Effect.fn("mobile.cloudflareAccess.save")(function* (
  origin: string,
  session: CloudflareAccessSession,
) {
  const secureStorage = yield* MobileSecureStorage.MobileSecureStorage;
  const encoded = yield* encodeSession(session);
  yield* secureStorage.setItem(storageKey(origin), encoded);
});

export const clearCloudflareAccessSessionStorage = Effect.fn("mobile.cloudflareAccess.clear")(
  function* (origin: string) {
    const secureStorage = yield* MobileSecureStorage.MobileSecureStorage;
    yield* secureStorage.removeItem(storageKey(origin));
  },
);
