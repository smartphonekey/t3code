import { AuthAccessWriteScope } from "@t3tools/contracts";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import { useEnvironmentSessionState } from "~/state/session";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import type { EnvironmentId } from "@t3tools/contracts";

export function CloudflareAccessIdentitySettings({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const session = useEnvironmentSessionState(environmentId);
  const canWrite =
    session.data?.authenticated === true &&
    (session.data.permissions ?? session.data.scopes)?.includes(AuthAccessWriteScope) === true;

  return (
    <SettingsSection title="Cloudflare Access identity pairing">
      <SettingsRow
        serverScoped
        title="Cloudflare Access identity pairing"
        settingKeys={[
          "enableCloudflareAccessIdentityPairing",
          "cloudflareAccessTeamDomain",
          "cloudflareAccessApplicationAud",
        ]}
        description={
          <>
            Remember verified Cloudflare Access identities after first pair so other browsers can
            reconnect without a new code. Requires{" "}
            <code className="text-xs">Cf-Access-Jwt-Assertion</code>; email headers are not trusted.
            Off by default.
          </>
        }
        control={
          <Switch
            checked={settings.enableCloudflareAccessIdentityPairing}
            disabled={!canWrite}
            onCheckedChange={(checked) =>
              updateSettings({ enableCloudflareAccessIdentityPairing: Boolean(checked) })
            }
            aria-label="Cloudflare Access identity pairing"
          />
        }
      />
      {settings.enableCloudflareAccessIdentityPairing ? (
        <>
          <SettingsRow
            serverScoped
            title="Access team domain"
            description="Your Cloudflare Access team hostname, for example myteam.cloudflareaccess.com."
            control={
              <Input
                className="max-w-md"
                value={settings.cloudflareAccessTeamDomain}
                disabled={!canWrite}
                onChange={(event) =>
                  updateSettings({ cloudflareAccessTeamDomain: event.currentTarget.value })
                }
                placeholder="myteam.cloudflareaccess.com"
              />
            }
          />
          <SettingsRow
            serverScoped
            title="Application AUD"
            description="The audience tag of the Cloudflare Access application in front of this server."
            control={
              <Input
                className="max-w-md"
                value={settings.cloudflareAccessApplicationAud}
                disabled={!canWrite}
                onChange={(event) =>
                  updateSettings({ cloudflareAccessApplicationAud: event.currentTarget.value })
                }
                placeholder="Access application AUD"
              />
            }
          />
        </>
      ) : null}
    </SettingsSection>
  );
}
