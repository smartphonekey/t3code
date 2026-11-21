import * as Schema from "effect/Schema";

/** Cloudflare Access session material extracted after a WebView login. */
export class CloudflareAccessSession extends Schema.Class<CloudflareAccessSession>(
  "CloudflareAccessSession",
)({
  cfAuthorization: Schema.String,
  cfAccessJwtAssertion: Schema.optionalKey(Schema.String),
}) {}
