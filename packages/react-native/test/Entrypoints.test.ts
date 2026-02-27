import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("react-native package entrypoints", () => {
  test("web entrypoint re-exports react package", async () => {
    vi.doMock("@evolu/react", () => ({
      marker: "react-web-export",
      useEvolu: vi.fn(),
    }));

    const web = await import("../src/web.js");
    expect(web.marker).toBe("react-web-export");
  });

  test("index entrypoint re-exports component/task/worker modules", async () => {
    vi.doMock("../src/components/EvoluIdenticon.js", () => ({
      EvoluIdenticon: "EvoluIdenticonExport",
    }));
    vi.doMock("../src/Task.js", () => ({
      createRunner: "createRunnerExport",
    }));
    vi.doMock("../src/Worker.js", () => ({
      createWorker: "createWorkerExport",
    }));

    const index = await import("../src/index.js");
    expect(index).toEqual(
      expect.objectContaining({
        EvoluIdenticon: "EvoluIdenticonExport",
        createRunner: "createRunnerExport",
        createWorker: "createWorkerExport",
      }),
    );
  });
});
