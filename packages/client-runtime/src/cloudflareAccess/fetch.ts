import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { ConnectionAttemptError } from "../connection/model.ts";
import { ConnectionBlockedError } from "../connection/model.ts";
import type { CloudflareAccessGateway } from "../platform/capabilities.ts";
import type { CloudflareAccessSession } from "./credentials.ts";
import { cloudflareAccessLoginStartUrl, isCloudflareAccessChallengeResponse } from "./challenge.ts";
import { cloudflareAccessRequestHeaders } from "./headers.ts";

class CloudflareAccessFetchError extends Schema.TaggedError<CloudflareAccessFetchError>()(
  "CloudflareAccessFetchError",
  { cause: Schema.Defect() },
) {}
const isFetchError = Schema.is(CloudflareAccessFetchError);

function requestOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function withAccessHeaders(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  session: CloudflareAccessSession,
) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  for (const [name, value] of Object.entries(cloudflareAccessRequestHeaders(session))) {
    if (name === "Cookie") {
      const existing = headers.get("cookie");
      headers.set("cookie", existing === null ? value : `${existing}; ${value}`);
    } else headers.set(name, value);
  }
  return { ...init, headers } satisfies RequestInit;
}
const request = Effect.fn("clientRuntime.cloudflareAccess.request")(
  (baseFetch: typeof fetch, input: RequestInfo | URL, init?: RequestInit) =>
    Effect.tryPromise({
      try: () => baseFetch(input, init),
      catch: (cause) => new CloudflareAccessFetchError({ cause }),
    }),
);

export const fetchWithCloudflareAccess = Effect.fn("clientRuntime.cloudflareAccess.fetch")(
  function* (
    baseFetch: typeof fetch,
    gateway: CloudflareAccessGateway["Service"],
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    const url = String(input instanceof Request ? input.url : input);
    const origin = requestOrigin(url);
    if (origin === null) return yield* request(baseFetch, input, init);
    const firstInput = input instanceof Request ? input.clone() : input;
    let session = Option.getOrNull(yield* gateway.read(origin));
    let response = yield* request(
      baseFetch,
      firstInput,
      session === null ? init : withAccessHeaders(input, init, session),
    );
    if (!isCloudflareAccessChallengeResponse(response, url)) return response;
    yield* gateway.clear(origin);
    session = yield* gateway
      .authenticate({ origin, startUrl: cloudflareAccessLoginStartUrl(response, url) })
      .pipe(
        Effect.mapError((error): ConnectionAttemptError =>
          error._tag === "ConnectionBlockedError" || error._tag === "ConnectionTransientError"
            ? error
            : new ConnectionBlockedError({
                reason: "authentication",
                detail: "Cloudflare Access sign-in was cancelled or failed.",
              }),
        ),
      );
    response = yield* request(baseFetch, input, withAccessHeaders(input, init, session));
    if (isCloudflareAccessChallengeResponse(response, url)) yield* gateway.clear(origin);
    return response;
  },
);

export function makeCloudflareAccessAwareFetch(
  baseFetch: typeof fetch,
  run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>,
  gateway: CloudflareAccessGateway["Service"],
): typeof fetch {
  return (input, init) =>
    run(fetchWithCloudflareAccess(baseFetch, gateway, input, init)).catch((error: unknown) =>
      Promise.reject(isFetchError(error) ? error.cause : error),
    );
}
