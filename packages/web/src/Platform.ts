import type { ReloadApp } from "@evolu/common";

export const reloadApp: ReloadApp = (url) => {
  /* istanbul ignore next -- browser runner always has `document`; fallback is exercised in worker tests */
  if (typeof document === "undefined") {
    return;
  }

  location.replace(url ?? "/");
};
