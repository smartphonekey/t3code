import { useAtomValue } from "@effect/atom-react";
import { managedRelaySessionAtom } from "@t3tools/client-runtime/relay";
import {
  nextWeeklySubscriptionReset,
  type EnvironmentId,
  type ProviderSubscriptionMutation,
  type ServerProvider,
} from "@t3tools/contracts";
import { useState } from "react";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useDeadlinePassed, useNowAfter } from "../../hooks/useDeadline";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function ProviderSubscriptionControls({
  environmentId,
  provider,
}: {
  environmentId: EnvironmentId;
  provider: ServerProvider;
}) {
  const userId = useAtomValue(managedRelaySessionAtom)?.accountId ?? null;
  const subscription = useEnvironmentSettings(
    environmentId,
    (settings) => settings.providerSubscriptions[provider.instanceId],
  );
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const canManage = useAtomValue(
    serverEnvironment.updateSettings.permissionAtom(environmentId, {
      patch: {},
      providerSubscriptionMutation: { instanceId: provider.instanceId, action: "claim" },
    }),
  );
  const [pending, setPending] = useState(false);
  const [expiry, setExpiry] = useState("");
  const expired = useDeadlinePassed(
    subscription?.sharedUntil == null ? null : Date.parse(subscription.sharedUntil),
  );
  const weeklyDeadline = provider.usageLimits?.windows.find(
    (window) => window.kind === "weekly" && window.resetsAt !== undefined,
  )?.resetsAt;
  const now = useNowAfter(
    subscription?.sharedUntil != null
      ? Date.parse(subscription.sharedUntil)
      : weeklyDeadline !== undefined
        ? Date.parse(weeklyDeadline)
        : null,
  );
  const weeklyReset = nextWeeklySubscriptionReset(provider, now);
  const sharing = subscription?.sharedUntil != null && !expired;
  const own = subscription?.ownerUserId === userId && userId !== null;
  const explicitExpiry = Date.parse(expiry);
  const change = async (action: ProviderSubscriptionMutation["action"]) => {
    setPending(true);
    await update({
      environmentId,
      input: {
        patch: {},
        providerSubscriptionMutation: {
          instanceId: provider.instanceId,
          action,
          ...(action === "share" && weeklyReset === null && Number.isFinite(explicitExpiry)
            ? { expiresAt: new Date(explicitExpiry).toISOString() }
            : {}),
        },
      },
    });
    setPending(false);
  };
  return (
    <SettingsSection title="Subscription access">
      <SettingsRow
        title={
          own
            ? "Your subscription"
            : subscription === undefined
              ? "Unassigned subscription"
              : "Another person's subscription"
        }
        description={
          sharing
            ? `Shared until ${new Date(subscription.sharedUntil!).toLocaleString()}. Sharing will not renew automatically.`
            : subscription === undefined
              ? "Claim this account to prefer it for your new chats and control sharing."
              : "Private. Only its owner can use it."
        }
        control={
          subscription === undefined ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !canManage || userId === null}
              onClick={() => void change("claim")}
            >
              Use as my subscription
            </Button>
          ) : own && sharing ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !canManage}
              onClick={() => void change("revoke")}
            >
              Stop sharing
            </Button>
          ) : own ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !canManage || (weeklyReset === null && !(explicitExpiry > now))}
              onClick={() => void change("share")}
            >
              {weeklyReset === null ? "Share until selected time" : "Share until weekly reset"}
            </Button>
          ) : undefined
        }
      />
      {own && !sharing && weeklyReset === null ? (
        <SettingsRow
          title="Sharing expiry"
          description="This provider does not report its weekly reset. Choose when sharing should end."
          control={
            <Input
              type="datetime-local"
              aria-label="Subscription sharing expiry"
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
            />
          }
        />
      ) : null}
      {userId === null ? (
        <p className="text-sm text-muted-foreground">
          Sign in to T3 Connect to claim a subscription.
        </p>
      ) : null}
    </SettingsSection>
  );
}
