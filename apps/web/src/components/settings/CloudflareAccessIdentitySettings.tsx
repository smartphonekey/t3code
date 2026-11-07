import type { ServerSettings } from "@t3tools/contracts";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import type { ScopedSettingsPatch } from "./scopedSettings";
import { Switch } from "../ui/switch";
import { searchableSetting } from "./settingsSearch";

interface CloudflareAccessIdentitySettingsProps {
  readonly settings: ServerSettings;
  readonly updateSettings: (
    patch: ScopedSettingsPatch,
    options?: { readonly onFailed?: () => void },
  ) => void;
}

export function CloudflareAccessIdentitySettings({
  settings,
  updateSettings,
}: CloudflareAccessIdentitySettingsProps) {
  const enabled = settings.enableCloudflareAccessIdentityPairing;
  const pairingSetting = searchableSetting("cloudflare-access-identity-pairing");
  return (
    <SettingsSection title="Cloudflare Access">
      <SettingsRow
        {...pairingSetting}
        description="When this server sits behind Cloudflare Access, require pairing once per human Access user, then skip pairing on later browsers after the Access JWT is verified."
        control={
          <Switch
            checked={enabled}
            onCheckedChange={(checked) =>
              updateSettings({ enableCloudflareAccessIdentityPairing: Boolean(checked) })
            }
          />
        }
        settingKeys={["enableCloudflareAccessIdentityPairing"]}
      />
      {enabled ? (
        <>
          <SettingsRow
            title="Team domain"
            description="Your Zero Trust team domain, such as acme.cloudflareaccess.com."
            settingKeys={["cloudflareAccessTeamDomain"]}
          >
            <Input
              value={settings.cloudflareAccessTeamDomain}
              onChange={(event) =>
                updateSettings({ cloudflareAccessTeamDomain: event.currentTarget.value })
              }
              placeholder="acme.cloudflareaccess.com"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </SettingsRow>
          <SettingsRow
            title="Application audience (AUD)"
            description="The Access application AUD tag for this T3 Code app."
            settingKeys={["cloudflareAccessApplicationAudience"]}
          >
            <Input
              value={settings.cloudflareAccessApplicationAudience}
              onChange={(event) =>
                updateSettings({ cloudflareAccessApplicationAudience: event.currentTarget.value })
              }
              placeholder="access application audience"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </SettingsRow>
        </>
      ) : null}
    </SettingsSection>
  );
}
