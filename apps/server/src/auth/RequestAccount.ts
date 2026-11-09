import * as Context from "effect/Context";

export class RequestAccount extends Context.Reference<
  { readonly userId: string | null; readonly ownerUserId?: string } | undefined
>("t3/auth/RequestAccount", { defaultValue: () => undefined }) {}
