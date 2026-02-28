import { describe, expect, test, vi } from "vitest";
import {
  assertTauriRuntime,
  getTauriRuntimeInfo,
  isTauriRuntime,
} from "../src/index.js";

describe("@evolu/tauri", () => {
  test("defaults to web runtime in node test environment", () => {
    expect(isTauriRuntime()).toBe(false);
    expect(getTauriRuntimeInfo()).toEqual({
      kind: "web",
      hasTauriBridge: false,
    });
  });

  test("throws when tauri runtime is required", () => {
    expect(() => assertTauriRuntime()).toThrowError(/tauri webview runtime/i);
  });

  test("detects tauri bridge when available", () => {
    vi.stubGlobal("window", { __TAURI__: {} });
    expect(isTauriRuntime()).toBe(true);
    expect(getTauriRuntimeInfo().kind).toBe("tauri");
    vi.unstubAllGlobals();
  });
});
