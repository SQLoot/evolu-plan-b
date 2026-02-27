import type { MessagePort } from "@evolu/common";
import { SimpleName } from "@evolu/common";
import type {
  ExperimentalDbWorkerInput as DbWorkerInput,
  ExperimentalDbWorkerLeaderInput as DbWorkerLeaderInput,
  ExperimentalDbWorkerLeaderOutput as DbWorkerLeaderOutput,
  ExperimentalDbWorkerOutput as DbWorkerOutput,
} from "@evolu/common/local-first";
import { describe, expect, test } from "vitest";
import {
  runWebDbWorkerPort,
  runWebDbWorkerPortWithOptions,
} from "../src/local-first/DbWorker.js";
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
  port: MessagePort<DbWorkerLeaderInput, DbWorkerLeaderOutput>,
  timeoutMs = 2_000,
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

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, ms));

describe("runWebDbWorkerPort", () => {
  test("same dbName can initialize from multiple ports without blocking", async () => {
    const name = SimpleName.orThrow("DbWorkerTest");
    const dbName = ":memory:";

    const channel1 = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker1 = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker1.port2.onMessage = () => {};
    runWebDbWorkerPort({
      name,
      port: channel1.port1,
      brokerPort: broker1.port1,
    });

    const channel2 = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker2 = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
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
    const broker1 = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker1.port2.onMessage = () => {};
    runWebDbWorkerPort({
      name,
      port: channel1.port1,
      brokerPort: broker1.port1,
    });

    const channel2 = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker2 = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
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

  test("releases stale leader when no heartbeat arrives", async () => {
    const name = SimpleName.orThrow("DbWorkerStaleLeader");
    const dbName = ":memory:";

    const channel1 = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker1 = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    runWebDbWorkerPortWithOptions(
      {
        name,
        port: channel1.port1,
        brokerPort: broker1.port1,
      },
      {
        heartbeatTimeoutMs: 80,
        heartbeatCheckIntervalMs: 20,
      },
    );

    const leader1 = waitForLeader(broker1.port2);
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
    expect(await leader1).toMatchObject({ type: "LeaderAcquired", name });

    await wait(220);

    const channel2 = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker2 = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker2.port2.onMessage = () => {};
    runWebDbWorkerPortWithOptions(
      {
        name,
        port: channel2.port1,
        brokerPort: broker2.port1,
      },
      {
        heartbeatTimeoutMs: 80,
        heartbeatCheckIntervalMs: 20,
      },
    );

    const leader2 = waitForLeader(broker2.port2);
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
    expect(await leader2).toMatchObject({ type: "LeaderAcquired", name });

    const close1 = waitForOutput(channel1.port2);
    channel1.port2.postMessage({ type: "DbWorkerClose", requestId: 1 });
    const close1Output = await close1;
    expect(close1Output.type).toBe("DbWorkerCloseResponse");

    const close2 = waitForOutput(channel2.port2);
    channel2.port2.postMessage({ type: "DbWorkerClose", requestId: 1 });
    const close2Output = await close2;
    expect(close2Output.type).toBe("DbWorkerCloseResponse");
  });

  test("keeps leader alive when heartbeats are delivered", async () => {
    const name = SimpleName.orThrow("DbWorkerLiveLeader");
    const dbName = ":memory:";

    const channel1 = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker1 = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    runWebDbWorkerPortWithOptions(
      {
        name,
        port: channel1.port1,
        brokerPort: broker1.port1,
      },
      {
        heartbeatTimeoutMs: 120,
        heartbeatCheckIntervalMs: 30,
      },
    );

    const leader1 = waitForLeader(broker1.port2);
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
    expect(await leader1).toMatchObject({ type: "LeaderAcquired", name });

    const heartbeatId = globalThis.setInterval(() => {
      broker1.port2.postMessage({ type: "LeaderHeartbeat", name });
    }, 20);

    await wait(260);
    globalThis.clearInterval(heartbeatId);

    const channel2 = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker2 = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    runWebDbWorkerPortWithOptions(
      {
        name,
        port: channel2.port1,
        brokerPort: broker2.port1,
      },
      {
        heartbeatTimeoutMs: 120,
        heartbeatCheckIntervalMs: 30,
      },
    );

    const leader2 = waitForLeader(broker2.port2, 200);
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
    expect(await leader2).toBeNull();

    const close1 = waitForOutput(channel1.port2);
    channel1.port2.postMessage({ type: "DbWorkerClose", requestId: 1 });
    const close1Output = await close1;
    expect(close1Output.type).toBe("DbWorkerCloseResponse");

    const close2 = waitForOutput(channel2.port2);
    channel2.port2.postMessage({ type: "DbWorkerClose", requestId: 1 });
    const close2Output = await close2;
    expect(close2Output.type).toBe("DbWorkerCloseResponse");
  });

  test("returns DbWorkerError when request arrives before initialization", async () => {
    const name = SimpleName.orThrow("DbWorkerNotInitialized");
    const channel = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker.port2.onMessage = () => {};

    runWebDbWorkerPort({
      name,
      port: channel.port1,
      brokerPort: broker.port1,
    });

    const output = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerQuery",
      requestId: 1,
      sql: "select 1 as value",
      params: [],
    });

    const errorOutput = await output;
    expect(errorOutput.type).toBe("DbWorkerError");
    if (errorOutput.type === "DbWorkerError") {
      expect(errorOutput.requestId).toBe(1);
      expect(errorOutput.error).toContain("not initialized");
    }
  });

  test("supports getAppOwner, mutate, query, export and reset", async () => {
    const name = SimpleName.orThrow("DbWorkerApiSurface");
    const dbName = ":memory:";
    const channel = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker.port2.onMessage = () => {};

    runWebDbWorkerPort({
      name,
      port: channel.port1,
      brokerPort: broker.port1,
    });

    const init = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerInit",
      dbName,
      schemaVersion: 1,
    });
    const initOutput = await init;
    expect(initOutput.type).toBe("DbWorkerInitResponse");
    if (initOutput.type === "DbWorkerInitResponse") {
      expect(initOutput.success).toBe(true);
    }

    const mutateCreate = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerMutate",
      requestId: 2,
      sql: "create table custom_table (id integer primary key, title text)",
      params: [],
    });
    const mutateCreateOutput = await mutateCreate;
    expect(mutateCreateOutput.type).toBe("DbWorkerMutateResponse");

    const mutateInsert = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerMutate",
      requestId: 3,
      sql: "insert into custom_table (title) values (?)",
      params: ["hello"],
    });
    const mutateInsertOutput = await mutateInsert;
    expect(mutateInsertOutput.type).toBe("DbWorkerMutateResponse");
    if (mutateInsertOutput.type === "DbWorkerMutateResponse") {
      expect(mutateInsertOutput.changes).toBe(1);
    }

    const query = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerQuery",
      requestId: 4,
      sql: "select title from custom_table",
      params: [],
    });
    const queryOutput = await query;
    expect(queryOutput.type).toBe("DbWorkerQueryResponse");
    if (queryOutput.type === "DbWorkerQueryResponse") {
      expect(queryOutput.rows).toEqual([{ title: "hello" }]);
    }

    const setOwner = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerMutate",
      requestId: 5,
      sql: "insert into __evolu_meta (key, value) values ('appOwner', ?)",
      params: [JSON.stringify({ id: "owner-1" })],
    });
    const setOwnerOutput = await setOwner;
    expect(setOwnerOutput.type).toBe("DbWorkerMutateResponse");

    const getOwner = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerGetAppOwner",
    });
    const getOwnerOutput = await getOwner;
    expect(getOwnerOutput.type).toBe("DbWorkerAppOwner");
    if (getOwnerOutput.type === "DbWorkerAppOwner") {
      expect(getOwnerOutput.appOwner).not.toBeNull();
      expect(getOwnerOutput.appOwner?.id).toBe("owner-1");
    }

    const exportDb = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerExport",
      requestId: 6,
    });
    const exportOutput = await exportDb;
    expect(exportOutput.type).toBe("DbWorkerExportResponse");
    if (exportOutput.type === "DbWorkerExportResponse") {
      expect(exportOutput.data).toBeInstanceOf(Uint8Array);
      expect(exportOutput.data.length).toBeGreaterThan(0);
    }

    const reset = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerReset",
      requestId: 7,
    });
    const resetOutput = await reset;
    expect(resetOutput.type).toBe("DbWorkerResetResponse");

    const queryAfterReset = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerQuery",
      requestId: 8,
      sql: "select count(*) as count from sqlite_master where type='table' and name='custom_table'",
      params: [],
    });
    const queryAfterResetOutput = await queryAfterReset;
    expect(queryAfterResetOutput.type).toBe("DbWorkerQueryResponse");
    if (queryAfterResetOutput.type === "DbWorkerQueryResponse") {
      expect(queryAfterResetOutput.rows).toEqual([{ count: 0 }]);
    }
  });

  test("returns null appOwner for invalid JSON metadata", async () => {
    const name = SimpleName.orThrow("DbWorkerInvalidOwnerJson");
    const channel = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker.port2.onMessage = () => {};

    runWebDbWorkerPort({
      name,
      port: channel.port1,
      brokerPort: broker.port1,
    });

    const init = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerInit",
      dbName: ":memory:",
      schemaVersion: 1,
    });
    expect(await init).toMatchObject({
      type: "DbWorkerInitResponse",
      success: true,
    });

    const setOwner = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerMutate",
      requestId: 1,
      sql: "insert into __evolu_meta (key, value) values ('appOwner', ?)",
      params: ["{not-json"],
    });
    expect(await setOwner).toMatchObject({ type: "DbWorkerMutateResponse" });

    const getOwner = waitForOutput(channel.port2);
    channel.port2.postMessage({ type: "DbWorkerGetAppOwner" });
    const ownerOutput = await getOwner;
    expect(ownerOutput).toEqual({ type: "DbWorkerAppOwner", appOwner: null });
  });

  test("rejects re-init on same worker with different dbName", async () => {
    const name = SimpleName.orThrow("DbWorkerReinitDbName");
    const channel = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker.port2.onMessage = () => {};

    runWebDbWorkerPort({
      name,
      port: channel.port1,
      brokerPort: broker.port1,
    });

    const initA = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerInit",
      dbName: ":memory:",
      schemaVersion: 1,
    });
    expect(await initA).toMatchObject({
      type: "DbWorkerInitResponse",
      success: true,
    });

    const initB = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerInit",
      dbName: "another-db",
      schemaVersion: 1,
    });
    const output = await initB;
    expect(output.type).toBe("DbWorkerInitResponse");
    if (output.type === "DbWorkerInitResponse") {
      expect(output.success).toBe(false);
      expect(output.error).toContain("cannot switch");
    }
  });

  test("rejects re-init on same worker with different schema version", async () => {
    const name = SimpleName.orThrow("DbWorkerReinitSchema");
    const channel = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker.port2.onMessage = () => {};

    runWebDbWorkerPort({
      name,
      port: channel.port1,
      brokerPort: broker.port1,
    });

    const initA = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerInit",
      dbName: ":memory:",
      schemaVersion: 1,
    });
    expect(await initA).toMatchObject({
      type: "DbWorkerInitResponse",
      success: true,
    });

    const initB = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerInit",
      dbName: ":memory:",
      schemaVersion: 2,
    });
    const output = await initB;
    expect(output.type).toBe("DbWorkerInitResponse");
    if (output.type === "DbWorkerInitResponse") {
      expect(output.success).toBe(false);
      expect(output.error).toContain("schema version");
    }
  });

  test("returns DbWorkerError for unknown message type", async () => {
    const name = SimpleName.orThrow("DbWorkerUnknownMessage");
    const channel = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker.port2.onMessage = () => {};

    runWebDbWorkerPort({
      name,
      port: channel.port1,
      brokerPort: broker.port1,
    });

    const output = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerUnknown",
      requestId: 42,
    } as unknown as DbWorkerInput);

    const errorOutput = await output;
    expect(errorOutput.type).toBe("DbWorkerError");
    if (errorOutput.type === "DbWorkerError") {
      expect(errorOutput.requestId).toBe(42);
      expect(errorOutput.error).toContain("Unknown message type");
    }
  });
});
