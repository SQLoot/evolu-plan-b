import { expect, test } from "vitest";
import { createIdenticon } from "../src/index.js";
import { testAppOwner, testAppOwner2 } from "./local-first/_fixtures.js";

test("createIdenticon returns deterministic SVG for each style", () => {
  const styles = ["github", "quadrant", "gradient", "sutnar"] as const;

  for (const style of styles) {
    const svgA = createIdenticon(testAppOwner.id, style);
    const svgB = createIdenticon(testAppOwner.id, style);

    expect(svgA).toBe(svgB);
    expect(svgA.startsWith("<svg")).toBe(true);
    expect(svgA.includes("</svg>")).toBe(true);
  }
});

test("createIdenticon output changes for different ids", () => {
  const styles = ["github", "quadrant", "gradient", "sutnar"] as const;
  if (testAppOwner.id === testAppOwner2.id) {
    throw new Error(
      "Fixture collision: testAppOwner.id and testAppOwner2.id must differ.",
    );
  }

  for (const style of styles) {
    const svgA = createIdenticon(testAppOwner.id, style);
    const svgB = createIdenticon(testAppOwner2.id, style);

    expect(svgA).not.toBe(svgB);
  }
});
