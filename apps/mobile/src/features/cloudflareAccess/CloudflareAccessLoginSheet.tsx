import { CloudflareAccessSession } from "@t3tools/client-runtime/cloudflare-access";
import CookieManager from "@react-native-cookies/cookies";
import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import type { CloudflareAccessLoginRequest } from "./loginBridge";
import { wellKnownPollScript } from "./wellKnownPollScript";

export function CloudflareAccessLoginSheet(props: {
  readonly request: CloudflareAccessLoginRequest | null;
  readonly onComplete: (session: CloudflareAccessSession) => void;
  readonly onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [extracting, setExtracting] = useState(false);
  const pollScript = useMemo(
    () => (props.request === null ? undefined : wellKnownPollScript(props.request.origin)),
    [props.request],
  );

  const extractSession = useCallback(() => {
    if (props.request === null || extracting) {
      return;
    }
    setExtracting(true);
    void CookieManager.get(props.request.origin)
      .then((cookies) => {
        const cfAuthorization =
          cookies.CF_Authorization?.value ??
          cookies.cf_authorization?.value ??
          cookies["CF_Authorization"]?.value;
        if (cfAuthorization === undefined || cfAuthorization.length === 0) {
          props.onCancel();
          return;
        }
        const jwt =
          cookies["Cf-Access-Jwt-Assertion"]?.value ?? cookies["cf-access-jwt-assertion"]?.value;
        props.onComplete(
          new CloudflareAccessSession({
            cfAuthorization,
            ...(jwt === undefined ? {} : { cfAccessJwtAssertion: jwt }),
          }),
        );
      })
      .catch(() => {
        props.onCancel();
      })
      .finally(() => {
        setExtracting(false);
      });
  }, [extracting, props]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (event.nativeEvent.data !== JSON.stringify({ type: "t3-environment-ready" })) {
        return;
      }
      void extractSession();
    },
    [extractSession],
  );

  if (props.request === null) {
    return null;
  }

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onCancel}
    >
      <View
        className="flex-1 bg-sheet"
        style={{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }}
      >
        <View className="flex-row items-center justify-between px-4 pb-3 pt-2">
          <Text className="text-lg font-semibold text-label">Cloudflare Access</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel Cloudflare Access sign-in"
            onPress={props.onCancel}
            className="h-9 w-9 items-center justify-center"
          >
            <SymbolView name="xmark" size={18} tintColor="var(--color-icon)" />
          </Pressable>
        </View>
        <Text className="px-4 pb-3 text-sm text-secondary-label">
          Sign in to reach this environment. This is separate from pairing T3 Code.
        </Text>
        <View className="min-h-0 flex-1 overflow-hidden rounded-t-2xl border-t border-separator">
          <WebView
            source={{ uri: props.request.startUrl }}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            injectedJavaScript={pollScript}
            onMessage={onMessage}
            startInLoadingState
          />
        </View>
      </View>
    </Modal>
  );
}
