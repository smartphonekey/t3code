import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ConnectionAttemptError } from "../connection/model.ts";
import { ConnectionBlockedError } from "../connection/model.ts";
import type { CloudflareAccessGateway } from "../platform/capabilities.ts";
import type { CloudflareAccessSession } from "./credentials.ts";
import { cloudflareAccessLoginStartUrl, isCloudflareAccessChallengeResponse } from "./challenge.ts";
import { cloudflareAccessRequestHeaders } from "./headers.ts";

function requestUrl(input: RequestInfo | URL): string {
  return String(input instanceof Request ? input.url : input);
}

function withAccessHeaders(init: RequestInit | undefined, session: CloudflareAccessSession) {
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(cloudflareAccessRequestHeaders(session))) {
    if (name === "Cookie") {
      const existing = headers.get("cookie");
      headers.set("cookie", existing === null ? value : `${existing}; ${value}`);
      continue;
    }
    headers.set(name, value);
  }
  return { ...init, headers } satisfies RequestInit;
}

const reauthenticate = Effect.fn("clientRuntime.cloudflareAccess.reauthenticate")(function* (
  gateway: CloudflareAccessGateway["Service"],
  origin: string,
  startUrl: string,
) {
  yield* gateway.clear(origin);
  return yield* gateway.authenticate({ origin, startUrl });
});

export function makeCloudflareAccessAwareFetch(
  baseFetch: typeof fetch,
  run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>,
  gateway: CloudflareAccessGateway["Service"],
): typeof fetch {
  return async (input, init) => {
    const url = requestUrl(input);
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      return baseFetch(input, init);
    }

    const readSession = () =>
      run(gateway.read(origin)).then((session) => (Option.isSome(session) ? session.value : null));

    let session = await readSession();
    let response = await baseFetch(
      input,
      session === null ? init : withAccessHeaders(init, session),
    );

    if (!isCloudflareAccessChallengeResponse(response, url)) {
      return response;
    }

    const startUrl = cloudflareAccessLoginStartUrl(response, url);
    session = await run(
      reauthenticate(gateway, origin, startUrl).pipe(
        Effect.mapError((error): ConnectionAttemptError =>
          error._tag === "ConnectionBlockedError" || error._tag === "ConnectionTransientError"
            ? error
            : new ConnectionBlockedError({
                reason: "authentication",
                detail: "Cloudflare Access sign-in was cancelled or failed.",
              }),
        ),
      ),
    );

    response = await baseFetch(input, withAccessHeaders(init, session));
    if (isCloudflareAccessChallengeResponse(response, url)) {
      await run(gateway.clear(origin));
    }
    return response;
  };
}
