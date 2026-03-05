import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";
import { createGlobalErrorScope } from "../src/Error.js";

const createTestProcess = (): NodeJS.Process =>
  new EventEmitter() as NodeJS.Process;

describe("createGlobalErrorScope", () => {
  test("forwards process errors to onError", () => {
    const nativeProcess = createTestProcess();
    const scope = createGlobalErrorScope(nativeProcess);
    const onError = vi.fn();
    scope.onError = onError;

    const uncaught = new Error("uncaught");
    const rejected = new Error("rejected");
    nativeProcess.emit("uncaughtException", uncaught);
    nativeProcess.emit("unhandledRejection", rejected, Promise.resolve());

    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      type: "UnknownError",
      error: expect.objectContaining({ message: "uncaught" }),
    });
    expect(onError.mock.calls[1]?.[0]).toMatchObject({
      type: "UnknownError",
      error: expect.objectContaining({ message: "rejected" }),
    });

    scope[Symbol.dispose]();
  });

  test("detaches listeners on dispose", () => {
    const nativeProcess = createTestProcess();
    const scope = createGlobalErrorScope(nativeProcess);

    expect(nativeProcess.listenerCount("uncaughtException")).toBe(1);
    expect(nativeProcess.listenerCount("unhandledRejection")).toBe(1);

    scope[Symbol.dispose]();

    expect(nativeProcess.listenerCount("uncaughtException")).toBe(0);
    expect(nativeProcess.listenerCount("unhandledRejection")).toBe(0);
  });
});
