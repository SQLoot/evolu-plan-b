import { installPolyfills } from "../polyfills";

installPolyfills();

const isNodeRuntime =
  typeof process !== "undefined" && typeof process.versions?.node === "string";
const isBrowserRuntime = typeof document !== "undefined";

if (!isNodeRuntime && !isBrowserRuntime) {
  void import("react-native-quick-crypto")
    .then(({ install }) => {
      install();
    })
    .catch(() => {
      // Optional native crypto bridge is not available in all runtimes.
    });
}

import { Stack } from "expo-router";

export default function RootLayout(): React.ReactNode {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
