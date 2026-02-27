interface MaybeTauriWindow extends Window {
  readonly __TAURI__?: unknown;
  readonly __TAURI_INTERNALS__?: unknown;
}

const getWindow = (): MaybeTauriWindow | undefined => {
  if (typeof window === "undefined") return undefined;
  return window as MaybeTauriWindow;
};

export const isTauriRuntime = (): boolean => {
  const currentWindow = getWindow();
  if (!currentWindow) return false;

  return (
    currentWindow.__TAURI__ != null || currentWindow.__TAURI_INTERNALS__ != null
  );
};

export interface TauriRuntimeInfo {
  readonly kind: "tauri" | "web";
  readonly hasTauriBridge: boolean;
}

export const getTauriRuntimeInfo = (): TauriRuntimeInfo => {
  const hasTauriBridge = isTauriRuntime();
  return {
    kind: hasTauriBridge ? "tauri" : "web",
    hasTauriBridge,
  };
};

export interface TauriRuntimeError extends Error {
  code: "TAURI_RUNTIME_REQUIRED";
}

export const assertTauriRuntime = (): void => {
  if (isTauriRuntime()) return;

  const error = new Error(
    "Tauri integration helper requires a Tauri WebView runtime.",
  ) as TauriRuntimeError;
  error.name = "TauriRuntimeError";
  error.code = "TAURI_RUNTIME_REQUIRED";
  throw error;
};
