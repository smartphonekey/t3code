import { useDeadlinePassed, useNowAfter } from "../../lib/clock";
import { useAtomValue } from "@effect/atom-react";
import { managedRelaySessionAtom } from "@t3tools/client-runtime/relay";
import {
  nextWeeklySubscriptionReset,
  type EnvironmentId,
  type ServerProvider,
} from "@t3tools/contracts";
import { useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

export function ProviderSubscriptionControls({
  environmentId,
  provider,
}: {
  environmentId: EnvironmentId;
  provider: ServerProvider;
}) {
  const userId = useAtomValue(managedRelaySessionAtom)?.accountId ?? null;
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  const subscription = settings?.providerSubscriptions[provider.instanceId];
  const update = useAtomCommand(serverEnvironment.updateSettings);
  const canManage = useAtomValue(
    serverEnvironment.updateSettings.permissionAtom(environmentId, {
      patch: {},
      providerSubscriptionMutation: { instanceId: provider.instanceId, action: "claim" },
    }),
  );
  const [pending, setPending] = useState(false);
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
  const expired = useDeadlinePassed(
    subscription?.sharedUntil == null ? null : Date.parse(subscription.sharedUntil),
  );
  const weeklyReset = nextWeeklySubscriptionReset(provider, now);
  const sharing = subscription?.sharedUntil != null && !expired;
  const own = subscription?.ownerUserId === userId && userId !== null;
  const change = async (action: "claim" | "share" | "revoke") => {
    setPending(true);
    await update({
      environmentId,
      input: {
        patch: {},
        providerSubscriptionMutation: { instanceId: provider.instanceId, action },
      },
    });
    setPending(false);
  };
  return (
    <View className="gap-2 p-4">
      <Text className="text-sm text-foreground-muted">
        {sharing
          ? `Shared until ${new Date(subscription.sharedUntil!).toLocaleString()}`
          : own
            ? "Your private subscription"
            : subscription === undefined
              ? "Unassigned subscription"
              : "Private subscription"}
      </Text>
      {subscription === undefined ? (
        <Button
          size="compact"
          tone="secondary"
          label="Use as my subscription"
          disabled={pending || !canManage || userId === null}
          onPress={() => void change("claim")}
        />
      ) : own ? (
        <Button
          size="compact"
          tone="secondary"
          label={sharing ? "Stop sharing" : "Share until weekly reset"}
          disabled={pending || !canManage || (!sharing && weeklyReset === null)}
          onPress={() => void change(sharing ? "revoke" : "share")}
        />
      ) : null}
      {own && !sharing && weeklyReset === null ? (
        <Text className="text-sm text-foreground-muted">
          Weekly reset unavailable. Choose an expiry in web or desktop Settings.
        </Text>
      ) : null}
    </View>
  );
}
