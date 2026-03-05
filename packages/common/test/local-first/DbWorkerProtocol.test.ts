import { describe, expect, test } from "vitest";
import {
  dbWorkerLeaderHeartbeatIntervalMs,
  dbWorkerLeaderHeartbeatTimeoutMs,
} from "../../src/local-first/DbWorkerProtocol.js";

describe("DbWorkerProtocol", () => {
  test("exports deterministic heartbeat timing constants", () => {
    expect(dbWorkerLeaderHeartbeatIntervalMs).toBe(5_000);
    expect(dbWorkerLeaderHeartbeatTimeoutMs).toBe(30_000);
    expect(dbWorkerLeaderHeartbeatTimeoutMs).toBeGreaterThan(
      dbWorkerLeaderHeartbeatIntervalMs,
    );
    expect(
      dbWorkerLeaderHeartbeatTimeoutMs % dbWorkerLeaderHeartbeatIntervalMs,
    ).toBe(0);
  });
});
