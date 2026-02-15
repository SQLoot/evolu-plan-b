import type { MessagePort } from "@evolu/common";
import { SimpleName } from "@evolu/common";
import type {
  DbWorkerInput,
  DbWorkerLeaderOutput,
  DbWorkerOutput,
} from "@evolu/common/local-first";
import { describe, expect, test } from "vitest";
import { runWebDbWorkerPort } from "../src/local-first/DbWorker.js";
import { createMessageChannel } from "../src/Worker.js";

const waitForOutput = (
  port: MessagePort<DbWorkerInput, DbWorkerOutput>,
  timeoutMs = 2_000,
): Promise<DbWorkerOutput> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for DbWorker output"));
    }, timeoutMs);

    const previous = port.onMessage;
    port.onMessage = (message) => {
      clearTimeout(timeout);
      port.onMessage = previous;
      resolve(message);
    };
  });

const waitForLeader = (
  port: MessagePort<never, DbWorkerLeaderOutput>,
  timeoutMs = 500,
): Promise<DbWorkerLeaderOutput | null> =>
  new Promise((resolve) => {
    const timeout = setTimeout(() => {
      port.onMessage = null;
      resolve(null);
    }, timeoutMs);

    port.onMessage = (message) => {
      clearTimeout(timeout);
      port.onMessage = null;
      resolve(message);
    };
  });

describe("runWebDbWorkerPort", () => {
  test("same dbName can initialize from multiple ports without blocking", async () => {
    const name = SimpleName.orThrow("DbWorkerTest");
    const dbName = ":memory:";

    const channel1 = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker1 = createMessageChannel<DbWorkerLeaderOutput>();
    broker1.port2.onMessage = () => {};
    runWebDbWorkerPort({
      name,
      port: channel1.port1,
      brokerPort: broker1.port1,
    });

    const channel2 = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker2 = createMessageChannel<DbWorkerLeaderOutput>();
    broker2.port2.onMessage = () => {};
    runWebDbWorkerPort({
      name,
      port: channel2.port1,
      brokerPort: broker2.port1,
    });

    const leader1 = waitForLeader(broker1.port2);
    const leader2 = waitForLeader(broker2.port2);

    const init1 = waitForOutput(channel1.port2);
    channel1.port2.postMessage({
      type: "DbWorkerInit",
      dbName,
      schemaVersion: 1,
    });
    const init1Output = await init1;
    expect(init1Output.type).toBe("DbWorkerInitResponse");
    if (init1Output.type === "DbWorkerInitResponse") {
      expect(init1Output.success).toBe(true);
    }

    const init2 = waitForOutput(channel2.port2);
    channel2.port2.postMessage({
      type: "DbWorkerInit",
      dbName,
      schemaVersion: 1,
    });
    const init2Output = await init2;
    expect(init2Output.type).toBe("DbWorkerInitResponse");
    if (init2Output.type === "DbWorkerInitResponse") {
      expect(init2Output.success).toBe(true);
    }

    const leaders = (await Promise.all([leader1, leader2])).filter(
      (output): output is DbWorkerLeaderOutput => output !== null,
    );
    expect(leaders).toHaveLength(1);
    expect(leaders[0].type).toBe("LeaderAcquired");
    expect(leaders[0].name).toBe(name);

    const close1 = waitForOutput(channel1.port2);
    channel1.port2.postMessage({ type: "DbWorkerClose", requestId: 1 });
    const close1Output = await close1;
    expect(close1Output.type).toBe("DbWorkerCloseResponse");

    const close2 = waitForOutput(channel2.port2);
    channel2.port2.postMessage({ type: "DbWorkerClose", requestId: 1 });
    const close2Output = await close2;
    expect(close2Output.type).toBe("DbWorkerCloseResponse");
  });

  test("rejects init when same dbName uses a different schema version", async () => {
    const name = SimpleName.orThrow("DbWorkerSchemaMismatch");
    const dbName = ":memory:";

    const channel1 = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker1 = createMessageChannel<DbWorkerLeaderOutput>();
    broker1.port2.onMessage = () => {};
    runWebDbWorkerPort({
      name,
      port: channel1.port1,
      brokerPort: broker1.port1,
    });

    const channel2 = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker2 = createMessageChannel<DbWorkerLeaderOutput>();
    broker2.port2.onMessage = () => {};
    runWebDbWorkerPort({
      name,
      port: channel2.port1,
      brokerPort: broker2.port1,
    });

    const init1 = waitForOutput(channel1.port2);
    channel1.port2.postMessage({
      type: "DbWorkerInit",
      dbName,
      schemaVersion: 1,
    });
    const init1Output = await init1;
    expect(init1Output.type).toBe("DbWorkerInitResponse");
    if (init1Output.type === "DbWorkerInitResponse") {
      expect(init1Output.success).toBe(true);
    }

    const init2 = waitForOutput(channel2.port2);
    channel2.port2.postMessage({
      type: "DbWorkerInit",
      dbName,
      schemaVersion: 2,
    });
    const init2Output = await init2;
    expect(init2Output.type).toBe("DbWorkerInitResponse");
    if (init2Output.type === "DbWorkerInitResponse") {
      expect(init2Output.success).toBe(false);
      expect(init2Output.error).toContain("Schema version mismatch");
    }

    const close1 = waitForOutput(channel1.port2);
    channel1.port2.postMessage({ type: "DbWorkerClose", requestId: 1 });
    const close1Output = await close1;
    expect(close1Output.type).toBe("DbWorkerCloseResponse");

    const close2 = waitForOutput(channel2.port2);
    channel2.port2.postMessage({ type: "DbWorkerClose", requestId: 1 });
    const close2Output = await close2;
    expect(close2Output.type).toBe("DbWorkerCloseResponse");
  });
});
