import { describe, expect, test, vi } from "vitest";
import { EvoluIdenticon } from "../src/components/EvoluIdenticon.js";

const createIdenticon = vi.hoisted(() => vi.fn(() => "<svg />"));

vi.mock("@evolu/common", () => ({
  createIdenticon,
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useMemo: (factory: () => unknown) => factory(),
  };
});

vi.mock("react-native", () => ({
  View: "View",
}));

vi.mock("react-native-svg", () => ({
  SvgXml: "SvgXml",
}));

describe("EvoluIdenticon", () => {
  test("renders SvgXml wrapper for valid id", () => {
    const style = { background: "black" } as any;
    const output = EvoluIdenticon({
      borderRadius: 8,
      id: "owner-1" as any,
      size: 40,
      style,
    }) as any;

    expect(createIdenticon).toHaveBeenCalledWith("owner-1", style);
    expect(output).not.toBeNull();
    expect(output.props.style).toEqual({
      width: 40,
      height: 40,
      borderRadius: 8,
      overflow: "hidden",
    });
    expect(output.props.children.props).toEqual({
      xml: "<svg />",
      width: 40,
      height: 40,
    });
  });

  test("returns null for falsy id", () => {
    expect(EvoluIdenticon({ id: "" as any })).toBeNull();
  });
});
