import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createWebEvoluDeps: vi.fn(),
  flushSync: vi.fn(),
}));

vi.mock("@evolu/web", () => ({
  createEvoluDeps: mocks.createWebEvoluDeps,
}));

vi.mock("react-dom", () => ({
  flushSync: mocks.flushSync,
}));

import { createEvoluDeps } from "../../src/local-first/Evolu.js";

describe("createEvoluDeps (react-web)", () => {
  test("merges web deps with react flushSync", () => {
    const webDeps = { marker: "web-deps" };
    mocks.createWebEvoluDeps.mockReturnValue(webDeps);

    const result = createEvoluDeps({ custom: true } as never);

    expect(mocks.createWebEvoluDeps).toHaveBeenCalledWith({
      custom: true,
    });
    expect(result).toEqual({ ...webDeps, flushSync: mocks.flushSync });
  });

  test("supports default deps argument", () => {
    const webDeps = { marker: "defaults" };
    mocks.createWebEvoluDeps.mockReturnValue(webDeps);

    const result = createEvoluDeps();

    expect(mocks.createWebEvoluDeps).toHaveBeenCalledWith({});
    expect(result).toEqual({ ...webDeps, flushSync: mocks.flushSync });
  });
});
