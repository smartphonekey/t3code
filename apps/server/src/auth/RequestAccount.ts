import * as Context from "effect/Context";

export class RequestAccount extends Context.Reference<
  { readonly userId: string | null } | undefined
>("t3/auth/RequestAccount", { defaultValue: () => undefined }) {}
