import type { MessagePort, SqliteDriver } from "@evolu/common";
import { SimpleName } from "@evolu/common";
import type {
  ExperimentalDbWorkerInput as DbWorkerInput,
  ExperimentalDbWorkerLeaderInput as DbWorkerLeaderInput,
  ExperimentalDbWorkerLeaderOutput as DbWorkerLeaderOutput,
  ExperimentalDbWorkerOutput as DbWorkerOutput,
} from "@evolu/common/local-first";
import { describe, expect, test, vi } from "vitest";
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
  timeoutMs = 300,
): Promise<DbWorkerLeaderOutput | null> =>
  new Promise((resolve) => {
    const previous = port.onMessage;
    const timeout = setTimeout(() => {
      port.onMessage = previous;
      resolve(null);
    }, timeoutMs);

    port.onMessage = (message) => {
      clearTimeout(timeout);
      port.onMessage = previous;
      resolve(message);
    };
  });

const waitForRequiredLeader = async (
  port: MessagePort<DbWorkerLeaderInput, DbWorkerLeaderOutput>,
  timeoutMs = 2_000,
): Promise<DbWorkerLeaderOutput> => {
  const output = await waitForLeader(port, timeoutMs);
  if (output != null) return output;
  throw new Error("Timed out waiting for LeaderAcquired");
};

const waitForLeaderBurst = (
  ports: ReadonlyArray<MessagePort<DbWorkerLeaderInput, DbWorkerLeaderOutput>>,
  timeoutMs = 2_000,
  settleMs = 30,
): Promise<ReadonlyArray<DbWorkerLeaderOutput>> =>
  new Promise((resolve, reject) => {
    const previousHandlers = ports.map((port) => port.onMessage);
    const outputs: Array<DbWorkerLeaderOutput> = [];
    let settledTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

    const cleanup = (): void => {
      clearTimeout(timeoutId);
      if (settledTimer != null) clearTimeout(settledTimer);
      for (const [index, port] of ports.entries()) {
        port.onMessage = previousHandlers[index];
      }
    };

    const timeoutId = globalThis.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for leader output"));
    }, timeoutMs);

    const settle = (): void => {
      if (settledTimer != null) clearTimeout(settledTimer);
      settledTimer = globalThis.setTimeout(() => {
        cleanup();
        resolve(outputs);
      }, settleMs);
    };

    for (const [index, port] of ports.entries()) {
      const previous = previousHandlers[index];
      port.onMessage = (message) => {
        outputs.push(message);
        if (previous != null) previous(message);
        settle();
      };
    }
  });

const flushAsync = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, ms));

const createManualClock = () => {
  let currentTimeMs = 0;
  let nextId = 1;
  const intervals = new Map<
    number,
    { callback: () => void; intervalMs: number; nextTickMs: number }
  >();

  return {
    now: (): number => currentTimeMs,
    setInterval: (
      callback: () => void,
      timeoutMs: number,
    ): ReturnType<typeof globalThis.setInterval> => {
      const id = nextId++;
      const intervalMs = Math.max(1, timeoutMs);
      intervals.set(id, {
        callback,
        intervalMs,
        nextTickMs: currentTimeMs + intervalMs,
      });
      return id as unknown as ReturnType<typeof globalThis.setInterval>;
    },
    clearInterval: (id: ReturnType<typeof globalThis.setInterval>): void => {
      intervals.delete(id as unknown as number);
    },
    advance: (ms: number): void => {
      const targetTimeMs = currentTimeMs + ms;

      while (true) {
        let nextIntervalId: number | null = null;
        let nextTickMs = Number.POSITIVE_INFINITY;

        for (const [id, interval] of intervals) {
          if (interval.nextTickMs < nextTickMs) {
            nextTickMs = interval.nextTickMs;
            nextIntervalId = id;
          }
        }

        if (nextIntervalId == null || nextTickMs > targetTimeMs) break;

        currentTimeMs = nextTickMs;
        const interval = intervals.get(nextIntervalId);
        if (!interval) continue;

        interval.callback();

        const currentInterval = intervals.get(nextIntervalId);
        if (currentInterval) {
          currentInterval.nextTickMs += currentInterval.intervalMs;
        }
      }

      currentTimeMs = targetTimeMs;
    },
  };
};

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
};

const createMockDriver = (): SqliteDriver => ({
  exec: (query) => {
    if (query.sql.includes("select 1 as value")) {
      return { rows: [{ value: 1 }], changes: 0 };
    }
    return { rows: [], changes: 0 };
  },
  export: () => new Uint8Array([1, 2, 3]),
  [Symbol.dispose]: () => {},
});

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

    const leadersPromise = waitForLeaderBurst([broker1.port2, broker2.port2]);

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

    const leaders = await leadersPromise;
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
    const clock = createManualClock();

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
        now: clock.now,
        setInterval: clock.setInterval,
        clearInterval: clock.clearInterval,
      },
    );

    const leader1 = waitForRequiredLeader(broker1.port2);
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

    clock.advance(220);
    await flushAsync();

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
        now: clock.now,
        setInterval: clock.setInterval,
        clearInterval: clock.clearInterval,
      },
    );

    const leader2 = waitForRequiredLeader(broker2.port2);
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

    const leader1 = waitForRequiredLeader(broker1.port2);
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

    const leader2 = waitForLeader(broker2.port2, 25);
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

    const close = waitForOutput(channel.port2);
    channel.port2.postMessage({ type: "DbWorkerClose", requestId: 9 });
    expect(await close).toMatchObject({ type: "DbWorkerCloseResponse" });
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

    const close = waitForOutput(channel.port2);
    channel.port2.postMessage({ type: "DbWorkerClose", requestId: 2 });
    expect(await close).toMatchObject({ type: "DbWorkerCloseResponse" });
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

    const close = waitForOutput(channel.port2);
    channel.port2.postMessage({ type: "DbWorkerClose", requestId: 3 });
    expect(await close).toMatchObject({ type: "DbWorkerCloseResponse" });
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

    const close = waitForOutput(channel.port2);
    channel.port2.postMessage({ type: "DbWorkerClose", requestId: 4 });
    expect(await close).toMatchObject({ type: "DbWorkerCloseResponse" });
  });

  test("returns init response for non-memory db names", async () => {
    const name = SimpleName.orThrow("DbWorkerFileDb");
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
      dbName: "dbworker-file-db",
      schemaVersion: 1,
    });
    const output = await init;
    expect(output.type).toBe("DbWorkerInitResponse");
    if (output.type === "DbWorkerInitResponse") {
      expect(output.success).toBe(false);
    }
  });

  test("supports query calls without params field", async () => {
    const name = SimpleName.orThrow("DbWorkerQueryDefaultParams");
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

    const query = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerQuery",
      requestId: 1,
      sql: "select 1 as value",
    } as DbWorkerInput);
    const queryOutput = await query;
    expect(queryOutput.type).toBe("DbWorkerQueryResponse");
    if (queryOutput.type === "DbWorkerQueryResponse") {
      expect(queryOutput.rows).toEqual([{ value: 1 }]);
    }

    const close = waitForOutput(channel.port2);
    channel.port2.postMessage({ type: "DbWorkerClose", requestId: 2 });
    expect(await close).toMatchObject({ type: "DbWorkerCloseResponse" });
  });

  test("reacquires shared db after watchdog releases stale leader", async () => {
    const name = SimpleName.orThrow("DbWorkerReacquireAfterWatchdog");
    const dbName = ":memory:";
    const clock = createManualClock();
    const channel = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker.port2.onMessage = () => {};

    runWebDbWorkerPortWithOptions(
      {
        name,
        port: channel.port1,
        brokerPort: broker.port1,
      },
      {
        heartbeatTimeoutMs: 80,
        heartbeatCheckIntervalMs: 20,
        now: clock.now,
        setInterval: clock.setInterval,
        clearInterval: clock.clearInterval,
      },
    );

    const leader1 = waitForLeader(broker.port2, 2_000);
    const init = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerInit",
      dbName,
      schemaVersion: 1,
    });
    expect(await init).toMatchObject({
      type: "DbWorkerInitResponse",
      success: true,
    });
    expect(await leader1).toMatchObject({
      type: "LeaderAcquired",
      name,
    });

    clock.advance(220);
    await flushAsync();

    const leader2 = waitForLeader(broker.port2, 120);
    const query = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerQuery",
      requestId: 3,
      sql: "select 1 as value",
      params: [],
    });

    const [leaderOutput, queryOutput] = await Promise.all([leader2, query]);
    expect(
      leaderOutput === null || leaderOutput.type === "LeaderAcquired",
    ).toBe(true);
    expect(queryOutput.type).toBe("DbWorkerQueryResponse");
    if (queryOutput.type === "DbWorkerQueryResponse") {
      expect(queryOutput.rows).toEqual([{ value: 1 }]);
    }

    const close = waitForOutput(channel.port2);
    channel.port2.postMessage({ type: "DbWorkerClose", requestId: 4 });
    expect(await close).toMatchObject({ type: "DbWorkerCloseResponse" });
  });

  test("returns init error for invalid db name", async () => {
    const name = SimpleName.orThrow("DbWorkerInvalidDbName");
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
      dbName: "invalid db name",
      schemaVersion: 1,
    });
    const output = await init;
    expect(output.type).toBe("DbWorkerInitResponse");
    if (output.type === "DbWorkerInitResponse") {
      expect(output.success).toBe(false);
      expect(output.error).toBeTruthy();
    }
  });

  test("returns null appOwner when metadata is missing", async () => {
    const name = SimpleName.orThrow("DbWorkerMissingOwner");
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

    const getOwner = waitForOutput(channel.port2);
    channel.port2.postMessage({ type: "DbWorkerGetAppOwner" });
    expect(await getOwner).toEqual({
      type: "DbWorkerAppOwner",
      appOwner: null,
    });

    const close = waitForOutput(channel.port2);
    channel.port2.postMessage({ type: "DbWorkerClose", requestId: 7 });
    expect(await close).toMatchObject({ type: "DbWorkerCloseResponse" });
  });

  test("handles concurrent failing init attempts for invalid shared db", async () => {
    const name = SimpleName.orThrow("DbWorkerConcurrentInvalidInit");
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
    const init2 = waitForOutput(channel2.port2);
    channel1.port2.postMessage({
      type: "DbWorkerInit",
      dbName: "invalid db name",
      schemaVersion: 1,
    });
    channel2.port2.postMessage({
      type: "DbWorkerInit",
      dbName: "invalid db name",
      schemaVersion: 1,
    });

    const [out1, out2] = await Promise.all([init1, init2]);
    expect(out1).toMatchObject({
      type: "DbWorkerInitResponse",
      success: false,
    });
    expect(out2).toMatchObject({
      type: "DbWorkerInitResponse",
      success: false,
    });
  });

  test("follower waits for shared initPromise and succeeds after leader init resolves", async () => {
    const name = SimpleName.orThrow("DbWorkerFollowerInitPromiseSuccess");
    const dbName = ":memory:";
    const firstDriver = createDeferred<SqliteDriver>();
    const firstCreateDriverCall = createDeferred<void>();
    let firstCreateDriverCallResolved = false;
    let createDriverCalls = 0;
    const createDriver = vi.fn(async (_dbName: string) => {
      createDriverCalls += 1;
      if (createDriverCalls === 1) {
        if (!firstCreateDriverCallResolved) {
          firstCreateDriverCallResolved = true;
          firstCreateDriverCall.resolve();
        }
        return await firstDriver.promise;
      }
      return createMockDriver();
    });

    const channel1 = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker1 = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker1.port2.onMessage = () => {};
    runWebDbWorkerPortWithOptions(
      { name, port: channel1.port1, brokerPort: broker1.port1 },
      { createDriver },
    );

    const channel2 = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker2 = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker2.port2.onMessage = () => {};
    runWebDbWorkerPortWithOptions(
      { name, port: channel2.port1, brokerPort: broker2.port1 },
      { createDriver },
    );

    const init1 = waitForOutput(channel1.port2);
    channel1.port2.postMessage({
      type: "DbWorkerInit",
      dbName,
      schemaVersion: 1,
    });

    await Promise.race([
      firstCreateDriverCall.promise,
      wait(2_000).then(() => {
        throw new Error("Timed out waiting for first createDriver call");
      }),
    ]);

    const init2 = waitForOutput(channel2.port2);
    let init2Settled = false;
    void init2.then(() => {
      init2Settled = true;
    });
    channel2.port2.postMessage({
      type: "DbWorkerInit",
      dbName,
      schemaVersion: 1,
    });

    await wait(20);
    expect(init2Settled).toBe(false);

    firstDriver.resolve(createMockDriver());

    const [init1Output, init2Output] = await Promise.all([init1, init2]);
    expect(init1Output).toMatchObject({
      type: "DbWorkerInitResponse",
      success: true,
    });
    expect(init2Output).toMatchObject({
      type: "DbWorkerInitResponse",
      success: true,
    });
    expect(createDriverCalls).toBe(1);

    const close1 = waitForOutput(channel1.port2);
    channel1.port2.postMessage({ type: "DbWorkerClose", requestId: 401 });
    expect(await close1).toMatchObject({ type: "DbWorkerCloseResponse" });

    const close2 = waitForOutput(channel2.port2);
    channel2.port2.postMessage({ type: "DbWorkerClose", requestId: 402 });
    expect(await close2).toMatchObject({ type: "DbWorkerCloseResponse" });
  });

  test("cleans shared init state when follower waits on failing initPromise", async () => {
    const name = SimpleName.orThrow("DbWorkerInitPromiseCleanup");
    const dbName = ":memory:";
    const firstDriver = createDeferred<SqliteDriver>();
    void firstDriver.promise.catch(() => undefined);
    const firstCreateDriverCall = createDeferred<void>();
    let firstCreateDriverCallResolved = false;
    let createDriverCalls = 0;
    const createDriver = vi.fn(async (_dbName: string) => {
      createDriverCalls += 1;
      if (createDriverCalls === 1) {
        if (!firstCreateDriverCallResolved) {
          firstCreateDriverCallResolved = true;
          firstCreateDriverCall.resolve();
        }
        return await firstDriver.promise;
      }
      return createMockDriver();
    });

    const channel1 = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker1 = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker1.port2.onMessage = () => {};
    runWebDbWorkerPortWithOptions(
      { name, port: channel1.port1, brokerPort: broker1.port1 },
      { createDriver },
    );

    const channel2 = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker2 = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker2.port2.onMessage = () => {};
    runWebDbWorkerPortWithOptions(
      { name, port: channel2.port1, brokerPort: broker2.port1 },
      { createDriver },
    );

    const init1 = waitForOutput(channel1.port2);
    channel1.port2.postMessage({
      type: "DbWorkerInit",
      dbName,
      schemaVersion: 1,
    });

    await Promise.race([
      firstCreateDriverCall.promise,
      wait(2_000).then(() => {
        throw new Error("Timed out waiting for first createDriver call");
      }),
    ]);

    const init2 = waitForOutput(channel2.port2);
    channel2.port2.postMessage({
      type: "DbWorkerInit",
      dbName,
      schemaVersion: 1,
    });

    await wait(20);
    firstDriver.reject(new Error("simulated shared init failure"));

    const [init1Output, init2Output] = await Promise.all([init1, init2]);
    expect(init1Output).toMatchObject({
      type: "DbWorkerInitResponse",
      success: false,
    });
    expect(init2Output).toMatchObject({
      type: "DbWorkerInitResponse",
      success: false,
    });
    if (init1Output.type === "DbWorkerInitResponse") {
      expect(init1Output.error).toContain("simulated shared init failure");
    }
    if (init2Output.type === "DbWorkerInitResponse") {
      expect(init2Output.error).toContain("simulated shared init failure");
    }
    expect(createDriverCalls).toBe(1);

    const channel3 = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker3 = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker3.port2.onMessage = () => {};
    runWebDbWorkerPortWithOptions(
      { name, port: channel3.port1, brokerPort: broker3.port1 },
      { createDriver },
    );

    const init3 = waitForOutput(channel3.port2);
    channel3.port2.postMessage({
      type: "DbWorkerInit",
      dbName,
      schemaVersion: 1,
    });
    expect(await init3).toMatchObject({
      type: "DbWorkerInitResponse",
      success: true,
    });
    expect(createDriverCalls).toBe(2);

    const query3 = waitForOutput(channel3.port2);
    channel3.port2.postMessage({
      type: "DbWorkerQuery",
      requestId: 301,
      sql: "select 1 as value",
      params: [],
    });
    expect(await query3).toMatchObject({
      type: "DbWorkerQueryResponse",
      requestId: 301,
      rows: [{ value: 1 }],
    });

    const close1 = waitForOutput(channel1.port2);
    channel1.port2.postMessage({ type: "DbWorkerClose", requestId: 302 });
    expect(await close1).toMatchObject({ type: "DbWorkerCloseResponse" });

    const close2 = waitForOutput(channel2.port2);
    channel2.port2.postMessage({ type: "DbWorkerClose", requestId: 303 });
    expect(await close2).toMatchObject({ type: "DbWorkerCloseResponse" });

    const close3 = waitForOutput(channel3.port2);
    channel3.port2.postMessage({ type: "DbWorkerClose", requestId: 304 });
    expect(await close3).toMatchObject({ type: "DbWorkerCloseResponse" });
  });

  test("close is idempotent for already released shared db", async () => {
    const name = SimpleName.orThrow("DbWorkerCloseTwice");
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

    const close1 = waitForOutput(channel.port2);
    channel.port2.postMessage({ type: "DbWorkerClose", requestId: 8 });
    expect(await close1).toMatchObject({ type: "DbWorkerCloseResponse" });

    const close2 = waitForOutput(channel.port2);
    channel.port2.postMessage({ type: "DbWorkerClose", requestId: 9 });
    expect(await close2).toMatchObject({ type: "DbWorkerCloseResponse" });
  });

  test("stale worker rejects re-init with changed dbName", async () => {
    const name = SimpleName.orThrow("DbWorkerStaleReinitMismatch");
    const clock = createManualClock();
    const channel = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker.port2.onMessage = () => {};

    runWebDbWorkerPortWithOptions(
      {
        name,
        port: channel.port1,
        brokerPort: broker.port1,
      },
      {
        heartbeatTimeoutMs: 80,
        heartbeatCheckIntervalMs: 20,
        now: clock.now,
        setInterval: clock.setInterval,
        clearInterval: clock.clearInterval,
      },
    );

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

    clock.advance(220);
    await flushAsync();

    const reinitDbName = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerInit",
      dbName: "changed-db",
      schemaVersion: 1,
    });
    const dbNameOutput = await reinitDbName;
    expect(dbNameOutput).toMatchObject({
      type: "DbWorkerInitResponse",
      success: false,
    });

    const close = waitForOutput(channel.port2);
    channel.port2.postMessage({ type: "DbWorkerClose", requestId: 12 });
    expect(await close).toMatchObject({ type: "DbWorkerCloseResponse" });
  });

  test("stale worker rejects re-init with changed schemaVersion", async () => {
    const name = SimpleName.orThrow("DbWorkerStaleReinitSchemaMismatch");
    const clock = createManualClock();
    const channel = createMessageChannel<DbWorkerOutput, DbWorkerInput>();
    const broker = createMessageChannel<
      DbWorkerLeaderOutput,
      DbWorkerLeaderInput
    >();
    broker.port2.onMessage = () => {};

    runWebDbWorkerPortWithOptions(
      {
        name,
        port: channel.port1,
        brokerPort: broker.port1,
      },
      {
        heartbeatTimeoutMs: 80,
        heartbeatCheckIntervalMs: 20,
        now: clock.now,
        setInterval: clock.setInterval,
        clearInterval: clock.clearInterval,
      },
    );

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

    clock.advance(220);
    await flushAsync();

    const reinitSchema = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerInit",
      dbName: ":memory:",
      schemaVersion: 2,
    });
    expect(await reinitSchema).toMatchObject({
      type: "DbWorkerInitResponse",
      success: false,
    });

    const close = waitForOutput(channel.port2);
    channel.port2.postMessage({ type: "DbWorkerClose", requestId: 13 });
    expect(await close).toMatchObject({ type: "DbWorkerCloseResponse" });
  });

  test("ignores unrelated leader heartbeat messages", async () => {
    const name = SimpleName.orThrow("DbWorkerHeartbeatFilter");
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

    broker.port2.postMessage({
      type: "LeaderHeartbeat",
      name: SimpleName.orThrow("OtherLeader"),
    });

    const query = waitForOutput(channel.port2);
    channel.port2.postMessage({
      type: "DbWorkerQuery",
      requestId: 10,
      sql: "select 1 as value",
      params: [],
    });
    const queryOutput = await query;
    expect(queryOutput.type).toBe("DbWorkerQueryResponse");

    const close = waitForOutput(channel.port2);
    channel.port2.postMessage({ type: "DbWorkerClose", requestId: 11 });
    expect(await close).toMatchObject({ type: "DbWorkerCloseResponse" });
  });

  test("handles concurrent shared db initialization requests", async () => {
    const name = SimpleName.orThrow("DbWorkerConcurrentInit");
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
    const init2 = waitForOutput(channel2.port2);
    channel1.port2.postMessage({
      type: "DbWorkerInit",
      dbName,
      schemaVersion: 1,
    });
    channel2.port2.postMessage({
      type: "DbWorkerInit",
      dbName,
      schemaVersion: 1,
    });

    const [output1, output2] = await Promise.all([init1, init2]);
    expect(output1).toMatchObject({
      type: "DbWorkerInitResponse",
      success: true,
    });
    expect(output2).toMatchObject({
      type: "DbWorkerInitResponse",
      success: true,
    });

    const close1 = waitForOutput(channel1.port2);
    channel1.port2.postMessage({ type: "DbWorkerClose", requestId: 5 });
    expect(await close1).toMatchObject({ type: "DbWorkerCloseResponse" });

    const close2 = waitForOutput(channel2.port2);
    channel2.port2.postMessage({ type: "DbWorkerClose", requestId: 6 });
    expect(await close2).toMatchObject({ type: "DbWorkerCloseResponse" });
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
