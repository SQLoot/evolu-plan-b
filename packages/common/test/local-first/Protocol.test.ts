import { compress, init } from "@bokuweb/zstd-wasm";
import * as fc from "fast-check";
import { assert, beforeAll, describe, expect, it, test } from "vitest";
import { createBuffer } from "../../src/Buffer.js";
import { lazyFalse, lazyTrue } from "../../src/Function.js";
import type { NonEmptyReadonlyArray, RunDeps } from "../../src/index.js";
import { assertNonEmptyArray, EncryptionKey } from "../../src/index.js";
import {
  type OwnerIdBytes,
  ownerIdToOwnerIdBytes,
} from "../../src/local-first/Owner.js";
import type { TimestampsRangeWithTimestampsBuffer } from "../../src/local-first/Protocol.js";
import {
  applyProtocolMessageAsClient,
  applyProtocolMessageAsRelay,
  createProtocolMessageBuffer,
  createProtocolMessageForSync,
  createProtocolMessageFromCrdtMessages,
  createTimestampsBuffer,
  decodeFlags,
  decodeLength,
  decodeNodeId,
  decodeNonNegativeInt,
  decodeNumber,
  decodeRle,
  decodeSqliteValue,
  decodeString,
  decryptAndDecodeDbChange,
  defaultProtocolMessageRangesMaxSize,
  encodeAndEncryptDbChange,
  encodeFlags,
  encodeLength,
  encodeNodeId,
  encodeNonNegativeInt,
  encodeNumber,
  encodeSqliteValue,
  encodeString,
  MessageType,
  type ProtocolMessageMaxSize,
  ProtocolMessageRangesMaxSize,
  ProtocolValueType,
  parseProtocolHeader,
  protocolVersion,
  SubscriptionFlags,
} from "../../src/local-first/Protocol.js";
import type {
  CrdtMessage,
  EncryptedCrdtMessage,
  EncryptedDbChange,
  Storage,
  StorageDep,
} from "../../src/local-first/Storage.js";
import {
  DbChange,
  InfiniteUpperBound,
  RangeType,
  timestampBytesToFingerprint,
} from "../../src/local-first/Storage.js";
import {
  createInitialTimestamp,
  timestampBytesToTimestamp,
  timestampToTimestampBytes,
} from "../../src/local-first/Timestamp.js";
import { err, getOrThrow, ok } from "../../src/Result.js";
import type { SqliteValue } from "../../src/Sqlite.js";
import type { TestDeps } from "../../src/Test.js";
import { testCreateDeps, testCreateRun } from "../../src/Test.js";
import {
  createId,
  dateToDateIso,
  NonNegativeInt,
  PositiveInt,
  zeroNonNegativeInt,
} from "../../src/Type.js";
import { setupSqliteAndRelayStorage } from "../_deps.js";
import {
  maxTimestamp,
  testAppOwner,
  testAppOwnerIdBytes,
  testTimestampsAsc,
  testTimestampsRandom,
} from "./_fixtures.js";

beforeAll(async () => {
  await init();
});

/** Returns uncompressed and compressed sizes. */
const getUncompressedAndCompressedSizes = (array: Uint8Array) =>
  `${array.byteLength} ${compress(array as never).length}`;

test("encodeNumber/decodeNumber", () => {
  const testCases = [
    0,
    42,
    -123,
    Math.PI,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    Infinity,
    -Infinity,
    NaN,
  ];

  const buffer = createBuffer();

  testCases.forEach((value) => {
    encodeNumber(buffer, value);
    const encoded = createBuffer();
    encodeNumber(encoded, value);
    expect(decodeNumber(encoded)).toBe(value);
    expect(encoded.getLength()).toBe(0);
  });

  expect(buffer.unwrap()).toMatchInlineSnapshot(
    `uint8:[0,42,208,133,203,64,9,33,251,84,68,45,24,203,67,63,255,255,255,255,255,255,203,195,63,255,255,255,255,255,255,203,127,240,0,0,0,0,0,0,203,255,240,0,0,0,0,0,0,203,127,248,0,0,0,0,0,0]`,
  );
});

test("encodeFlags/decodeFlags", () => {
  const testCases: Array<{
    flags: ReadonlyArray<boolean>;
    expected: number;
  }> = [
    { flags: [true], expected: 1 },
    { flags: [false], expected: 0 },
    { flags: [true, false], expected: 1 },
    { flags: [false, true], expected: 2 },
    { flags: [true, true], expected: 3 },
    {
      flags: [true, false, true, false, true],
      expected: 0b10101,
    },
    {
      flags: [true, true, true, true, true, true, true, true],
      expected: 0xff,
    },
  ];

  testCases.forEach(({ flags, expected }) => {
    const buffer = createBuffer();
    encodeFlags(buffer, flags);
    expect(buffer.unwrap()[0]).toBe(expected);

    const decodedFlags = decodeFlags(
      createBuffer(buffer.unwrap()),
      PositiveInt.orThrow(flags.length),
    );
    expect(Array.from(decodedFlags)).toEqual(Array.from(flags));
  });
});

test("encodeNonNegativeInt/decodeNonNegativeInt", () => {
  const testCases: Array<{ input: NonNegativeInt; expected: Array<number> }> = [
    { input: 0 as NonNegativeInt, expected: [0] },
    { input: 1 as NonNegativeInt, expected: [1] },
    { input: 127 as NonNegativeInt, expected: [127] },

    { input: 128 as NonNegativeInt, expected: [128, 1] },
    { input: 129 as NonNegativeInt, expected: [129, 1] },
    { input: 255 as NonNegativeInt, expected: [255, 1] },

    { input: 16383 as NonNegativeInt, expected: [255, 127] },
    { input: 16384 as NonNegativeInt, expected: [128, 128, 1] },
    { input: 32767 as NonNegativeInt, expected: [255, 255, 1] },

    { input: 2097151 as NonNegativeInt, expected: [255, 255, 127] },
    { input: 2097152 as NonNegativeInt, expected: [128, 128, 128, 1] },
    { input: 268435455 as NonNegativeInt, expected: [255, 255, 255, 127] },

    {
      input: Number.MAX_SAFE_INTEGER as NonNegativeInt,
      expected: [255, 255, 255, 255, 255, 255, 255, 15],
    },

    {
      input: (Number.MAX_SAFE_INTEGER - 1) as NonNegativeInt,
      expected: [254, 255, 255, 255, 255, 255, 255, 15],
    },
  ];

  testCases.forEach(({ input, expected }) => {
    const encoded = createBuffer();
    encodeNonNegativeInt(encoded, input);
    expect(encoded.unwrap()).toEqual(new Uint8Array(expected));
    expect(decodeNonNegativeInt(encoded)).toBe(input);
  });

  expect(() => {
    const buffer = createBuffer();
    encodeNonNegativeInt(
      buffer,
      (Number.MAX_SAFE_INTEGER + 1) as NonNegativeInt,
    );
    decodeNonNegativeInt(buffer);
  }).toThrow("Int");

  const malformedData = new globalThis.Array(8).fill(0xff);
  expect(() => decodeNonNegativeInt(createBuffer(malformedData))).toThrow(
    "Int",
  );

  const truncatedBuffer = createBuffer([128]);
  expect(() => decodeNonNegativeInt(truncatedBuffer)).toThrow(
    "Buffer parse ended prematurely",
  );
});

test("protocolVersion", () => {
  expect(protocolVersion).toBe(1);
});

test("encodeLength/decodeLength", () => {
  let buffer = createBuffer();
  encodeLength(buffer, []);
  expect(decodeLength(buffer)).toBe(0);
  buffer = createBuffer();
  encodeLength(buffer, [1, 2, 3]);
  expect(decodeLength(buffer)).toBe(3);
});

test("encodeString/decodeString", () => {
  const string = "Hello, world!";
  const buffer = createBuffer();
  encodeString(buffer, string);
  expect(buffer.unwrap()).toMatchInlineSnapshot(
    `uint8:[13,72,101,108,108,111,44,32,119,111,114,108,100,33]`,
  );
  expect(decodeString(buffer)).toBe(string);
});

test("encodeNodeId/decodeNodeId", () => {
  const deps = testCreateDeps();
  const testCases = Array.from({ length: 100 }).map(
    () => createInitialTimestamp(deps).nodeId,
  );

  testCases.forEach((id) => {
    const buffer = createBuffer();
    encodeNodeId(buffer, id);
    expect(decodeNodeId(buffer)).toBe(id);
  });
});

test("ProtocolValueType", () => {
  expect(ProtocolValueType).toMatchInlineSnapshot(`
    {
      "Base64Url": 32,
      "Bytes": 23,
      "DateIsoWithNegativeTime": 36,
      "DateIsoWithNonNegativeTime": 35,
      "EmptyString": 31,
      "Id": 33,
      "Json": 34,
      "NonNegativeInt": 30,
      "Null": 22,
      "Number": 21,
      "String": 20,
    }
  `);
});

test("encodeSqliteValue/decodeSqliteValue", () => {
  const deps = testCreateDeps();
  const testCasesSuccess: Array<[SqliteValue, number]> = [
    ["", 1], // empty string optimization - 1 byte vs 2 bytes (50% reduction)
    [123.5, 10], // encodeNumber
    [-123, 3], // encodeNumber
    [null, 1],
    [new Uint8Array([1, 2, 3]), 5],
    [createId(deps), 17],
    [0, 1], // small ints 0-19
    [19, 1], // small ints 0-19
    [123, 2], // NonNegativeInt
    [16383, 3], // NonNegativeInt
    ['{"compact":true,"schema":0}', 20], // 18 bytes msgpackr + 2 bytes protocol overhead
    // Protocol encoding ensures 6 bytes till the year 2108.
    [getOrThrow(dateToDateIso(new Date("0000-01-01T00:00:00.000Z"))), 10],
    [getOrThrow(dateToDateIso(new Date("2024-10-31T00:00:00.000Z"))), 7],
    [getOrThrow(dateToDateIso(new Date("2108-10-31T00:00:00.000Z"))), 7],
    [getOrThrow(dateToDateIso(new Date("2109-10-31T00:00:00.000Z"))), 8],
    [getOrThrow(dateToDateIso(new Date("9999-12-31T23:59:59.999Z"))), 8],
  ];

  const buffer = createBuffer();
  testCasesSuccess.forEach(([value, bytesLength]) => {
    const encoded = createBuffer();
    encodeSqliteValue(encoded, value);
    buffer.extend(encoded.unwrap());

    expect(encoded.getLength()).toBe(bytesLength);
    expect(decodeSqliteValue(encoded)).toStrictEqual(value);
  });
  expect(buffer.unwrap()).toMatchInlineSnapshot(
    `uint8:[31,21,203,64,94,224,0,0,0,0,0,21,208,133,22,23,3,1,2,3,33,92,226,70,213,118,197,194,43,252,142,193,248,114,213,66,235,0,19,30,123,30,255,127,34,18,130,167,99,111,109,112,97,99,116,195,166,115,99,104,101,109,97,0,36,203,194,204,69,55,130,48,0,0,35,128,232,252,254,173,50,35,128,168,131,232,192,127,35,128,128,200,165,182,128,1,35,255,183,255,144,253,206,57]`,
  );
});

test("encodeSqliteValue/decodeSqliteValue property tests", () => {
  const deps = testCreateDeps();
  // Property test: round-trip encoding/decoding should preserve the value
  fc.assert(
    fc.property(
      fc.oneof(
        // Test all SqliteValue types
        fc.constant(null),
        fc.string(), // Regular strings
        fc.double().filter((n) => !Number.isNaN(n)), // Numbers (exclude NaN)
        fc.uint8Array(), // Binary data

        // Special number cases
        fc.constantFrom(Infinity, -Infinity, NaN),
        fc.integer({ min: 0, max: 19 }), // Small ints (0-19) - special encoding
        fc.integer({ min: 20, max: Number.MAX_SAFE_INTEGER }), // Non-negative ints
        fc.integer({ min: Number.MIN_SAFE_INTEGER, max: -1 }), // Negative numbers
        fc.float({ min: -1000, max: 1000 }), // Regular floats

        // Id optimization cases
        fc.constantFrom(createId(deps)), // Valid Id
        fc
          .string({ minLength: 21, maxLength: 21 })
          .map((s) => s.replace(/[^A-Za-z0-9_-]/g, "a")), // Id-like strings

        // URL-safe strings with length % 4 === 0 (Base64Url optimization)
        fc
          .stringMatching(/^[A-Za-z0-9_-]*$/)
          .filter((s) => s.length % 4 === 0 && s.length > 0),
        // URL-safe strings with length % 4 !== 0 (should use regular string encoding)
        fc
          .stringMatching(/^[A-Za-z0-9_-]*$/)
          .filter((s) => s.length % 4 !== 0 && s.length > 0),

        // Base64Url edge cases
        fc.constant(""), // Empty string (optimization)
        fc
          .stringMatching(/^[A-Za-z0-9_-]{4,}$/)
          .filter((s) => s.length % 4 === 0), // Valid Base64Url
        fc.string().filter((s) => /[^A-Za-z0-9_-]/.test(s)), // Invalid Base64Url chars

        // JSON optimization cases
        fc
          .record({
            name: fc.string(),
            value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
          })
          .map((obj) => JSON.stringify(obj)),
        fc
          .array(fc.oneof(fc.string(), fc.integer(), fc.boolean()))
          .map((arr) => JSON.stringify(arr)),
        fc.constantFrom('{"a":1}', "[]", "null", "true", "false", '"string"'), // Simple JSON
        fc.string().filter((s) => {
          try {
            JSON.parse(s);
            return false;
          } catch {
            return true;
          }
        }), // Non-JSON strings

        // Date ISO strings - both valid and invalid
        fc
          .date({ min: new Date("1970-01-01"), max: new Date("2100-01-01") })
          .filter((d) => !Number.isNaN(d.getTime()))
          .map((d) => d.toISOString()),
        fc
          .date({ min: new Date("0000-01-01"), max: new Date("9999-12-31") })
          .filter((d) => !Number.isNaN(d.getTime()))
          .map((d) => d.toISOString()),
        fc.constantFrom(
          "0000-01-01T00:00:00.000Z",
          "9999-12-31T23:59:59.999Z",
          "not-a-date-2024-01-01T00:00:00.000Z", // Invalid date format
          "2024-13-01T00:00:00.000Z", // Invalid month
        ),

        // Binary data edge cases
        fc.constant(new Uint8Array(0)), // Empty binary
        fc.uint8Array({ minLength: 1, maxLength: 1000 }), // Variable size binary
        fc.constant(new Uint8Array(1000).fill(255)), // Large binary with pattern
        fc.constant(new Uint8Array([0, 1, 2, 3, 4, 5])), // Small binary pattern
      ),
      (value) => {
        const buffer = createBuffer();
        encodeSqliteValue(buffer, value);
        const decoded = decodeSqliteValue(buffer);

        // Handle special cases for comparison
        if (value instanceof Uint8Array && decoded instanceof Uint8Array) {
          return (
            value.length === decoded.length &&
            value.every((byte, i) => byte === decoded[i])
          );
        }

        // Handle NaN specially since NaN !== NaN
        if (typeof value === "number" && typeof decoded === "number") {
          if (Number.isNaN(value)) {
            return Number.isNaN(decoded);
          }
        }

        return decoded === value;
      },
    ),
    { numRuns: 10000 },
  );
});

test("encodeSqliteValue/decodeSqliteValue specific failing case from property tests", () => {
  // This was the specific failing case from property tests before the DateIsoString fix
  const failingInput = `["0 (      ",-100000000]`;

  const buffer = createBuffer();
  encodeSqliteValue(buffer, failingInput);
  const decoded = decodeSqliteValue(buffer);

  // After the DateIsoString round-trip fix, this should now work correctly
  // The input should be treated as a regular string (not DateIso) and round-trip properly
  expect(decoded).toBe(failingInput);
});

const createDbChange = (deps: RunDeps) =>
  DbChange.orThrow({
    table: "employee",
    id: createId(deps),
    values: {
      name: "Victoria",
      hiredAt: getOrThrow(dateToDateIso(new Date("2024-10-31"))),
      officeId: createId(deps),
    },
    isInsert: true,
    isDelete: null,
  });

const createTestCrdtMessage = (deps: TestDeps): CrdtMessage => ({
  timestamp: createInitialTimestamp(deps),
  change: createDbChange(deps),
});

const createEncryptedDbChange = (
  deps: RunDeps,
  message: CrdtMessage,
): EncryptedDbChange =>
  encodeAndEncryptDbChange(deps)(message, testAppOwner.encryptionKey);

const createEncryptedCrdtMessage = (
  deps: RunDeps,
  message: CrdtMessage,
): EncryptedCrdtMessage => ({
  timestamp: message.timestamp,
  change: createEncryptedDbChange(deps, message),
});

test("encodeAndEncryptDbChange/decryptAndDecodeDbChange", () => {
  const deps = testCreateDeps();
  const crdtMessage = createTestCrdtMessage(deps);
  const encryptedMessage = createEncryptedCrdtMessage(deps, crdtMessage);
  expect(encryptedMessage.change).toMatchInlineSnapshot(
    `uint8:[50,49,238,42,82,178,39,187,240,23,233,222,230,153,81,31,125,209,168,228,214,108,214,84,120,79,230,186,139,235,148,152,83,149,78,152,77,10,222,6,181,230,231,147,24,104,23,8,44,207,176,63,237,93,216,139,95,233,116,6,91,113,84,155,198,114,169,42,195,225,79,228,208,228,56,113,238,151,127,230,65,76,17,1,119,31,189,55,199,101,138,153,112,122,138,67,228,81,116,0,151,249,207,112,235,143,251,91,238,253,221,229,173,170,100,158,22,21,26,113,46,15,221,32,252,155,214,119,178,234,202,48,53,222,99,115,118,233,248,37,22,80,214,193,249]`,
  );
  const decrypted = getOrThrow(
    decryptAndDecodeDbChange(encryptedMessage, testAppOwner.encryptionKey),
  );
  expect(decrypted).toEqual(crdtMessage.change);

  const wrongKey = EncryptionKey.orThrow(new Uint8Array(32).fill(42));
  const decryptedWithWrongKey = decryptAndDecodeDbChange(
    encryptedMessage,
    wrongKey,
  );
  assert(!decryptedWithWrongKey.ok);
  expect(decryptedWithWrongKey.error.type).toBe(
    "DecryptWithXChaCha20Poly1305Error",
  );

  const corruptedCiphertext = new Uint8Array(
    encryptedMessage.change,
  ) as EncryptedDbChange;
  if (corruptedCiphertext.length > 10) {
    corruptedCiphertext[10] = (corruptedCiphertext[10] + 1) % 256; // Modify a byte
  }
  const corruptedMessage: EncryptedCrdtMessage = {
    timestamp: encryptedMessage.timestamp,
    change: corruptedCiphertext,
  };
  const decryptedCorrupted = decryptAndDecodeDbChange(
    corruptedMessage,
    testAppOwner.encryptionKey,
  );
  assert(!decryptedCorrupted.ok);
  expect(decryptedCorrupted.error.type).toBe(
    "DecryptWithXChaCha20Poly1305Error",
  );
});

test("decryptAndDecodeDbChange timestamp tamper-proofing", () => {
  const deps = testCreateDeps();
  const crdtMessage = createTestCrdtMessage(deps);
  const encryptedMessage = createEncryptedCrdtMessage(deps, crdtMessage);

  // Create a different timestamp
  const wrongTimestamp = createInitialTimestamp(deps);

  // Create a message with the wrong timestamp but same encrypted change
  const tamperedMessage: EncryptedCrdtMessage = {
    timestamp: wrongTimestamp,
    change: encryptedMessage.change,
  };

  // Attempt to decrypt with wrong timestamp should fail with ProtocolTimestampMismatchError
  const decryptedWithWrongTimestamp = decryptAndDecodeDbChange(
    tamperedMessage,
    testAppOwner.encryptionKey,
  );

  expect(decryptedWithWrongTimestamp).toEqual(
    err({
      type: "ProtocolTimestampMismatchError",
      expected: wrongTimestamp,
      timestamp: crdtMessage.timestamp,
    }),
  );
});

const shouldNotBeCalled = () => {
  throw new Error("should not be called");
};

const shouldNotBeCalledStorageDep: StorageDep = {
  storage: {
    getSize: shouldNotBeCalled,
    fingerprint: shouldNotBeCalled,
    fingerprintRanges: shouldNotBeCalled,
    findLowerBound: shouldNotBeCalled,
    iterate: shouldNotBeCalled,
    validateWriteKey: shouldNotBeCalled,
    setWriteKey: shouldNotBeCalled,
    writeMessages: shouldNotBeCalled,
    readDbChange: shouldNotBeCalled,
    deleteOwner: shouldNotBeCalled,
  },
};

test("createTimestampsBuffer maxTimestamp", () => {
  const buffer = createTimestampsBuffer();
  buffer.add(timestampBytesToTimestamp(maxTimestamp));
  expect(buffer.getLength()).toBe(21);
});

describe("decodeRle", () => {
  test("rejects runLength exceeding remaining", () => {
    const buffer = createBuffer();
    // value=1, runLength=100000 (malicious: exceeds expected length of 2)
    encodeNonNegativeInt(buffer, NonNegativeInt.orThrow(1));
    encodeNonNegativeInt(buffer, NonNegativeInt.orThrow(100000));

    expect(() =>
      decodeRle(buffer, NonNegativeInt.orThrow(2), () =>
        decodeNonNegativeInt(buffer),
      ),
    ).toThrow("Invalid RLE encoding: runLength 100000 exceeds remaining 2");
  });

  test("rejects zero runLength", () => {
    const buffer = createBuffer();
    // value=1, runLength=0 (malicious: would infinite-loop)
    encodeNonNegativeInt(buffer, NonNegativeInt.orThrow(1));
    encodeNonNegativeInt(buffer, zeroNonNegativeInt);

    expect(() =>
      decodeRle(buffer, NonNegativeInt.orThrow(1), () =>
        decodeNonNegativeInt(buffer),
      ),
    ).toThrow("Invalid RLE encoding: runLength must be positive");
  });

  test("accepts valid RLE encoding", () => {
    const buffer = createBuffer();
    // [5 x 3]
    encodeNonNegativeInt(buffer, NonNegativeInt.orThrow(5));
    encodeNonNegativeInt(buffer, NonNegativeInt.orThrow(3));

    const values = decodeRle(buffer, NonNegativeInt.orThrow(3), () =>
      decodeNonNegativeInt(buffer),
    );
    expect(values).toEqual([5, 5, 5]);
    expect(buffer.getLength()).toBe(0);
  });

  test("supports non-int values (NodeId)", () => {
    const buffer = createBuffer();
    encodeNodeId(buffer, "0123456789abcdef" as any);
    encodeNonNegativeInt(buffer, NonNegativeInt.orThrow(2));

    const values = decodeRle(buffer, NonNegativeInt.orThrow(2), () =>
      decodeNodeId(buffer),
    );
    expect(values).toEqual(["0123456789abcdef", "0123456789abcdef"]);
    expect(buffer.getLength()).toBe(0);
  });
});

describe("createProtocolMessageBuffer", () => {
  it("should allow no ranges", () => {
    const buffer = createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Request,
    });
    expect(buffer.unwrap()).toMatchInlineSnapshot(
      `uint8:[1,213,187,31,214,138,191,248,80,138,181,64,156,48,57,155,184,0,0,0,0]`,
    );
  });

  it("should allow single range with InfiniteUpperBound", () => {
    const buffer = createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Request,
    });
    buffer.addRange({
      type: RangeType.Skip,
      upperBound: InfiniteUpperBound,
    });
    expect(() => buffer.unwrap()).not.toThrow();
  });

  it("should reject single range without InfiniteUpperBound", () => {
    const buffer = createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Request,
    });
    buffer.addRange({
      type: RangeType.Skip,
      upperBound: testTimestampsAsc[0],
    });
    expect(() => buffer.unwrap()).toThrow(
      "The last range's upperBound must be InfiniteUpperBound",
    );
  });

  it("should allow multiple ranges with only last InfiniteUpperBound", () => {
    const buffer = createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Request,
    });
    buffer.addRange({
      type: RangeType.Skip,
      upperBound: testTimestampsAsc[0],
    });
    buffer.addRange({
      type: RangeType.Skip,
      upperBound: testTimestampsAsc[1],
    });
    buffer.addRange({
      type: RangeType.Skip,
      upperBound: InfiniteUpperBound,
    });
    expect(() => buffer.unwrap()).not.toThrow();
  });

  it("should reject range added after InfiniteUpperBound", () => {
    const buffer = createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Request,
    });
    buffer.addRange({
      type: RangeType.Skip,
      upperBound: InfiniteUpperBound,
    });
    expect(() => {
      buffer.addRange({
        type: RangeType.Skip,
        upperBound: testTimestampsAsc[0],
      });
    }).toThrow("Cannot add a range after an InfiniteUpperBound range");
  });

  it("should reject multiple InfiniteUpperBounds", () => {
    const buffer = createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Request,
    });
    buffer.addRange({
      type: RangeType.Skip,
      upperBound: testTimestampsAsc[0],
    });
    buffer.addRange({
      type: RangeType.Skip,
      upperBound: InfiniteUpperBound,
    });
    expect(() => {
      buffer.addRange({
        type: RangeType.Skip,
        upperBound: InfiniteUpperBound,
      });
    }).toThrow("Cannot add a range after an InfiniteUpperBound range");
  });
});

test("createProtocolMessageForSync", async () => {
  await using setup = await setupSqliteAndRelayStorage();
  const { run, storage } = setup;

  // Empty DB: version, ownerId, 0 messages, one empty TimestampsRange.
  expect(
    createProtocolMessageForSync(run.deps)(testAppOwner.id),
  ).toMatchInlineSnapshot(
    `uint8:[1,213,187,31,214,138,191,248,80,138,181,64,156,48,57,155,184,0,0,0,0,1,2,0]`,
  );

  const messages31 = testTimestampsAsc.slice(0, 31).map(
    (t): EncryptedCrdtMessage => ({
      timestamp: timestampBytesToTimestamp(t),
      change: createEncryptedDbChange(run.deps, {
        timestamp: timestampBytesToTimestamp(t),
        change: createDbChange(run.deps),
      }),
    }),
  );
  assertNonEmptyArray(messages31);
  await run(storage.writeMessages(testAppOwnerIdBytes, messages31));

  // DB with 31 timestamps: version, ownerId, 0 messages, one full (31) TimestampsRange.
  expect(
    createProtocolMessageForSync(run.deps)(testAppOwner.id),
  ).toMatchInlineSnapshot(
    `uint8:[1,213,187,31,214,138,191,248,80,138,181,64,156,48,57,155,184,0,0,0,0,1,2,31,0,250,249,195,1,168,184,125,195,131,34,174,141,103,155,214,209,1,249,185,24,252,240,230,1,223,254,172,8,148,205,26,150,248,240,4,163,204,109,149,170,141,2,228,161,145,2,179,220,186,3,146,218,156,4,155,140,140,3,248,138,143,1,227,155,149,1,245,252,193,5,249,137,78,250,243,249,3,254,253,238,1,248,202,15,139,139,37,213,158,69,140,219,189,1,242,244,157,4,141,229,170,1,142,166,98,245,168,150,5,0,31,0,0,0,0,0,0,0,0,1,104,162,167,191,63,133,160,150,1,153,201,144,40,214,99,106,145,1,104,162,167,191,63,133,160,150,6,153,201,144,40,214,99,106,145,1,104,162,167,191,63,133,160,150,21]`,
  );

  const message32 = testTimestampsAsc.slice(32, 33).map(
    (t): EncryptedCrdtMessage => ({
      timestamp: timestampBytesToTimestamp(t),
      change: createEncryptedDbChange(run.deps, {
        timestamp: timestampBytesToTimestamp(t),
        change: createDbChange(run.deps),
      }),
    }),
  );
  assertNonEmptyArray(message32);
  await run(storage.writeMessages(testAppOwnerIdBytes, message32));

  // DB with 32 timestamps: version, ownerId, 0 messages, 16x FingerprintRange.
  expect(
    createProtocolMessageForSync(run.deps)(testAppOwner.id),
  ).toMatchInlineSnapshot(
    `uint8:[1,213,187,31,214,138,191,248,80,138,181,64,156,48,57,155,184,0,0,0,0,16,162,178,193,2,241,144,137,1,148,144,234,1,219,239,147,10,170,197,139,5,184,246,250,2,151,254,203,5,173,230,168,7,219,166,164,2,238,134,144,6,248,241,232,5,131,214,52,225,249,130,2,255,217,200,5,131,207,248,5,0,15,153,201,144,40,214,99,106,145,1,104,162,167,191,63,133,160,150,14,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,60,106,74,42,243,6,138,90,152,175,169,243,198,137,32,142,62,136,182,76,215,87,6,29,65,11,3,85,126,25,160,146,235,32,205,134,143,79,91,185,175,62,1,162,208,7,116,171,199,85,83,43,126,39,69,165,170,12,19,180,187,199,84,93,30,79,57,195,122,179,50,19,29,19,139,243,231,210,235,131,37,146,165,19,167,174,209,62,68,194,21,205,135,80,178,40,89,225,171,174,199,109,83,198,243,42,203,80,204,17,102,182,8,183,197,20,233,154,227,181,12,169,211,212,39,118,68,169,60,197,16,9,208,73,252,173,54,118,13,116,78,124,68,80,108,124,188,251,29,98,215,49,229,232,196,245,195,68,106,82,90,177,24,91,11,233,28,194,104,48,118,82,240,64,197,180,63,100,32,173,112,238,15,70,223,191,197,114,34,162,106,76]`,
  );
});

test("parseProtocolHeader parses supported headers and rejects malformed ones", () => {
  const requestHeader = parseProtocolHeader(
    createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Request,
      subscriptionFlag: SubscriptionFlags.Subscribe,
    }).unwrap(),
  );
  expect(requestHeader).toEqual(
    ok({
      type: "ProtocolHeader",
      version: 1,
      ownerId: testAppOwner.id,
      messageType: MessageType.Request,
    }),
  );

  const responseHeader = parseProtocolHeader(
    createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Response,
      errorCode: 0,
    }).unwrap(),
  );
  expect(responseHeader).toEqual(
    ok({
      type: "ProtocolHeader",
      version: 1,
      ownerId: testAppOwner.id,
      messageType: MessageType.Response,
    }),
  );

  const broadcastHeader = parseProtocolHeader(
    createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Broadcast,
    }).unwrap(),
  );
  expect(broadcastHeader).toEqual(
    ok({
      type: "ProtocolHeader",
      version: 1,
      ownerId: testAppOwner.id,
      messageType: MessageType.Broadcast,
    }),
  );

  const invalidVersionMessage = createProtocolMessageBuffer(testAppOwner.id, {
    version: PositiveInt.orThrow(2),
    messageType: MessageType.Request,
  }).unwrap();
  const invalidVersion = parseProtocolHeader(invalidVersionMessage);
  expect(invalidVersion.ok).toBe(false);
  if (!invalidVersion.ok) {
    expect(invalidVersion.error.type).toBe("ProtocolInvalidDataError");
    expect(invalidVersion.error.error).toBeInstanceOf(Error);
  }

  const invalidTypeMessage = createBuffer();
  encodeNonNegativeInt(invalidTypeMessage, protocolVersion);
  invalidTypeMessage.extend(ownerIdToOwnerIdBytes(testAppOwner.id));
  invalidTypeMessage.extend([255]);

  const invalidType = parseProtocolHeader(invalidTypeMessage.unwrap());
  expect(invalidType.ok).toBe(false);
  if (!invalidType.ok) {
    expect(invalidType.error.type).toBe("ProtocolInvalidDataError");
    expect(invalidType.error.error).toBeInstanceOf(Error);
  }
});

describe("E2E versioning", () => {
  test("same versions", async () => {
    await using run = testCreateRun(shouldNotBeCalledStorageDep);
    const v0 = 0 as NonNegativeInt;

    const clientMessage = createProtocolMessageBuffer(testAppOwner.id, {
      version: v0,
      messageType: MessageType.Request,
    }).unwrap();

    const relayResponse = await run.orThrow(
      applyProtocolMessageAsRelay(clientMessage, {}, v0),
    );
    expect(relayResponse.message.length).toMatchInlineSnapshot(`20`);
  });

  test("non-initiator version is higher", async () => {
    await using run = testCreateRun(shouldNotBeCalledStorageDep);
    const v0 = 0 as NonNegativeInt;
    const v1 = 1 as NonNegativeInt;

    const clientMessage = createProtocolMessageBuffer(testAppOwner.id, {
      version: v0,
      messageType: MessageType.Request,
    }).unwrap();

    const relayResponse = await run.orThrow(
      applyProtocolMessageAsRelay(clientMessage, {}, v1),
    );

    const clientResult = await run(
      applyProtocolMessageAsClient(relayResponse.message, {
        version: v0,
      }),
    );
    expect(clientResult).toEqual(
      err({
        type: "ProtocolVersionError",
        version: 1,
        isInitiator: true,
        ownerId: testAppOwner.id,
      }),
    );
  });

  test("initiator version is higher", async () => {
    await using run = testCreateRun(shouldNotBeCalledStorageDep);
    const v0 = 0 as NonNegativeInt;
    const v1 = 1 as NonNegativeInt;

    const clientMessage = createProtocolMessageBuffer(testAppOwner.id, {
      version: v1,
      messageType: MessageType.Request,
    }).unwrap();

    const relayResponse = await run.orThrow(
      applyProtocolMessageAsRelay(clientMessage, {}, v0),
    );

    const clientResult = await run(
      applyProtocolMessageAsClient(relayResponse.message, {
        version: v1,
      }),
    );
    expect(clientResult).toEqual(
      err({
        type: "ProtocolVersionError",
        version: 0,
        isInitiator: false,
        ownerId: testAppOwner.id,
      }),
    );
  });
});

describe("E2E errors", () => {
  test("ProtocolInvalidDataError", async () => {
    await using run = testCreateRun(shouldNotBeCalledStorageDep);
    const malformedMessage = createBuffer();
    encodeNonNegativeInt(malformedMessage, 1 as NonNegativeInt); // Only version, no ownerId

    const clientResult = await run(
      applyProtocolMessageAsClient(malformedMessage.unwrap(), {
        version: 0 as NonNegativeInt,
      }),
    );

    assert(!clientResult.ok);
    expect(clientResult.error.type).toBe("ProtocolInvalidDataError");
  });

  test("ProtocolWriteKeyError", async () => {
    const deps = testCreateDeps();
    const timestamp = timestampBytesToTimestamp(testTimestampsAsc[0]);
    const dbChange = createDbChange(deps);

    const messages: NonEmptyReadonlyArray<CrdtMessage> = [
      { timestamp, change: dbChange },
    ];

    const initiatorMessage = createProtocolMessageFromCrdtMessages(deps)(
      testAppOwner,
      messages,
    );

    let responseMessage: Uint8Array;
    {
      await using run = testCreateRun({
        storage: {
          ...shouldNotBeCalledStorageDep.storage,
          validateWriteKey: lazyFalse,
        },
      });
      const response = await run.orThrow(
        applyProtocolMessageAsRelay(initiatorMessage),
      );
      expect(response.message).toMatchInlineSnapshot(
        `uint8:[1,213,187,31,214,138,191,248,80,138,181,64,156,48,57,155,184,1,1,0]`,
      );
      responseMessage = response.message;
    }

    await using run = testCreateRun(shouldNotBeCalledStorageDep);
    const clientResult = await run(
      applyProtocolMessageAsClient(responseMessage),
    );
    expect(clientResult).toEqual(
      err({ type: "ProtocolWriteKeyError", ownerId: testAppOwner.id }),
    );
  });
});

describe("E2E relay options", () => {
  test("subscribe", async () => {
    await using run = testCreateRun(shouldNotBeCalledStorageDep);
    const message = createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Request,
      subscriptionFlag: SubscriptionFlags.Subscribe,
    }).unwrap();
    let subscribeCalledWithOwnerId: string | null = null;

    await run(
      applyProtocolMessageAsRelay(message, {
        subscribe: (ownerId) => {
          subscribeCalledWithOwnerId = ownerId;
          return true;
        },
      }),
    );

    expect(subscribeCalledWithOwnerId).toBe(testAppOwner.id);
  });

  test("unsubscribe", async () => {
    await using run = testCreateRun(shouldNotBeCalledStorageDep);
    const message = createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Request,
      subscriptionFlag: SubscriptionFlags.Unsubscribe,
    }).unwrap();
    let unsubscribeCalledWithOwnerId: string | null = null;

    await run(
      applyProtocolMessageAsRelay(message, {
        unsubscribe: (ownerId) => {
          unsubscribeCalledWithOwnerId = ownerId;
        },
      }),
    );

    expect(unsubscribeCalledWithOwnerId).toBe(testAppOwner.id);
  });

  test("no subscription flag (None)", async () => {
    await using run = testCreateRun(shouldNotBeCalledStorageDep);
    const message = createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Request,
      subscriptionFlag: SubscriptionFlags.None,
    }).unwrap();
    let subscribeWasCalled = false;
    let unsubscribeWasCalled = false;

    await run(
      applyProtocolMessageAsRelay(message, {
        subscribe: () => {
          subscribeWasCalled = true;
          return true;
        },
        unsubscribe: () => {
          unsubscribeWasCalled = true;
        },
      }),
    );

    expect(subscribeWasCalled).toBe(false);
    expect(unsubscribeWasCalled).toBe(false);
  });

  test("default subscription flag (undefined)", async () => {
    await using run = testCreateRun(shouldNotBeCalledStorageDep);
    const message = createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Request,
      // No subscriptionFlag provided, should default to None
    }).unwrap();
    let subscribeWasCalled = false;
    let unsubscribeWasCalled = false;

    await run(
      applyProtocolMessageAsRelay(message, {
        subscribe: () => {
          subscribeWasCalled = true;
          return true;
        },
        unsubscribe: () => {
          unsubscribeWasCalled = true;
        },
      }),
    );

    expect(subscribeWasCalled).toBe(false);
    expect(unsubscribeWasCalled).toBe(false);
  });

  test("broadcast message", async () => {
    const deps = testCreateDeps();
    const timestamp = timestampBytesToTimestamp(testTimestampsAsc[0]);
    const dbChange = createDbChange(deps);
    const messages: NonEmptyReadonlyArray<CrdtMessage> = [
      { timestamp, change: dbChange },
    ];

    const initiatorMessage = createProtocolMessageFromCrdtMessages(deps)(
      testAppOwner,
      messages,
    );

    expect(initiatorMessage).toMatchInlineSnapshot(
      `uint8:[1,213,187,31,214,138,191,248,80,138,181,64,156,48,57,155,184,0,1,8,97,115,32,4,146,212,2,160,230,45,93,39,195,30,196,0,1,0,0,1,0,0,0,0,0,0,0,0,1,145,1,67,218,186,186,65,186,231,56,50,49,238,42,82,178,39,187,240,23,233,222,230,153,81,31,120,120,128,203,247,216,21,41,229,115,67,144,79,66,18,121,233,239,71,127,21,138,87,161,148,125,181,82,20,211,96,143,23,115,5,199,197,65,188,25,25,136,159,10,162,120,64,255,225,188,91,249,16,104,222,200,226,248,113,190,40,142,233,172,80,90,97,72,226,24,55,108,171,167,165,236,208,52,6,254,41,250,7,21,72,9,7,120,154,245,226,31,110,45,28,198,1,189,29,28,200,198,28,95,252,17,196,15,152,86,56,157,85,235,159,171,179,189,28,15,91]`,
    );

    let broadcastedMessage = null as Uint8Array | null;

    await using run = testCreateRun({
      storage: {
        ...shouldNotBeCalledStorageDep.storage,
        validateWriteKey: lazyTrue,
        writeMessages: () => () => ok(),
      },
    });
    await run(
      applyProtocolMessageAsRelay(initiatorMessage, {
        broadcast: (ownerId, message) => {
          expect(ownerId).toBe(testAppOwner.id);
          broadcastedMessage = message;
        },
      }),
    );

    assert(broadcastedMessage);
    // Added error and removed writeKey, added subscription flag
    expect(broadcastedMessage).toMatchInlineSnapshot(
      `uint8:[1,213,187,31,214,138,191,248,80,138,181,64,156,48,57,155,184,2,1,0,0,1,0,0,0,0,0,0,0,0,1,145,1,67,218,186,186,65,186,231,56,50,49,238,42,82,178,39,187,240,23,233,222,230,153,81,31,120,120,128,203,247,216,21,41,229,115,67,144,79,66,18,121,233,239,71,127,21,138,87,161,148,125,181,82,20,211,96,143,23,115,5,199,197,65,188,25,25,136,159,10,162,120,64,255,225,188,91,249,16,104,222,200,226,248,113,190,40,142,233,172,80,90,97,72,226,24,55,108,171,167,165,236,208,52,6,254,41,250,7,21,72,9,7,120,154,245,226,31,110,45,28,198,1,189,29,28,200,198,28,95,252,17,196,15,152,86,56,157,85,235,159,171,179,189,28,15,91]`,
    );

    let writeMessagesCalled = false;
    {
      await using run = testCreateRun({
        storage: {
          ...shouldNotBeCalledStorageDep.storage,
          writeMessages:
            (
              _ownerId: OwnerIdBytes,
              encryptedMessages: NonEmptyReadonlyArray<EncryptedCrdtMessage>,
            ) =>
            () => {
              writeMessagesCalled = true;
              expect(encryptedMessages.length).toBe(messages.length);
              return ok();
            },
        },
      });
      const result = await run(
        applyProtocolMessageAsClient(broadcastedMessage),
      );
      expect(result.ok).toBe(true);
    }
    expect(writeMessagesCalled).toBe(true);
  });
});

describe("E2E sync", { timeout: 15_000 }, () => {
  const deps = testCreateDeps();

  const messages = testTimestampsAsc.map(
    (t): EncryptedCrdtMessage => ({
      timestamp: timestampBytesToTimestamp(t),
      change: createEncryptedDbChange(deps, {
        timestamp: timestampBytesToTimestamp(t),
        change: DbChange.orThrow({
          table: "foo",
          id: createId(deps),
          values: {
            bar: "x".repeat(deps.randomLib.int(1, 500)),
          },
          isInsert: true,
          isDelete: null,
        }),
      }),
    }),
  );
  assertNonEmptyArray(messages);

  const createStorages = async () => {
    await using stack = new AsyncDisposableStack();
    const client = stack.use(await setupSqliteAndRelayStorage());
    const relay = stack.use(await setupSqliteAndRelayStorage());
    const moved = stack.move();

    return {
      clientStorage: client.storage,
      relayStorage: relay.storage,
      [Symbol.asyncDispose]: () => moved.disposeAsync(),
    };
  };

  const reconcile = async (
    clientStorage: Storage,
    relayStorage: Storage,
    rangesMaxSize = defaultProtocolMessageRangesMaxSize,
  ) => {
    const clientStorageDep = { storage: clientStorage, console: deps.console };
    const relayStorageDep = { storage: relayStorage };

    let message = createProtocolMessageForSync(clientStorageDep)(
      testAppOwner.id,
    );
    assert(message);

    let result;
    let turn = "relay";
    let syncSteps = 0;
    const syncSizes: Array<number> = [message.length];

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (message) {
      syncSteps++;

      if (syncSteps > 100) {
        throw new Error(syncSteps.toString());
      }

      if (turn === "relay") {
        await using run = testCreateRun(relayStorageDep);
        result = await run(
          applyProtocolMessageAsRelay(message, { rangesMaxSize }),
        );
      } else {
        await using run = testCreateRun(clientStorageDep);
        result = await run(
          applyProtocolMessageAsClient(message, {
            writeKey: testAppOwner.writeKey,
            rangesMaxSize,
          }),
        );
      }

      if (!result.ok || result.value.type === "NoResponse") break;
      assert(result.value.type !== "Broadcast");
      message = result.value.message;

      turn = turn === "relay" ? "client" : "relay";
      syncSizes.push(result.value.message.length);
    }

    for (const message of messages) {
      expect(
        clientStorage
          .readDbChange(
            testAppOwnerIdBytes,
            timestampToTimestampBytes(message.timestamp),
          )
          .join(),
      ).toBe(message.change.join());

      expect(
        relayStorage
          .readDbChange(
            testAppOwnerIdBytes,
            timestampToTimestampBytes(message.timestamp),
          )
          .join(),
      ).toBe(message.change.join());
    }

    // Ensure number of sync steps is even (relay/client turns alternate)
    expect(syncSteps % 2).toBe(0);

    return { syncSteps, syncSizes };
  };

  it("client and relay have all data", async () => {
    await using run = testCreateRun();
    await using storages = await createStorages();
    const { clientStorage, relayStorage } = storages;
    await run(clientStorage.writeMessages(testAppOwnerIdBytes, messages));
    await run(relayStorage.writeMessages(testAppOwnerIdBytes, messages));

    const syncSteps = await reconcile(clientStorage, relayStorage);
    expect(syncSteps).toMatchInlineSnapshot(`
      {
        "syncSizes": [
          361,
          20,
        ],
        "syncSteps": 2,
      }
    `);
  });

  it("client has all data", async () => {
    await using run = testCreateRun();
    await using storages = await createStorages();
    const { clientStorage, relayStorage } = storages;
    await run(clientStorage.writeMessages(testAppOwnerIdBytes, messages));

    const syncSteps = await reconcile(clientStorage, relayStorage);
    expect(syncSteps).toMatchInlineSnapshot(`
      {
        "syncSizes": [
          361,
          184,
          999935,
          40,
          680985,
          20,
        ],
        "syncSteps": 6,
      }
    `);
  });

  it("client has all data - many steps", async () => {
    await using run = testCreateRun();
    await using storages = await createStorages();
    const { clientStorage, relayStorage } = storages;
    await run(clientStorage.writeMessages(testAppOwnerIdBytes, messages));

    const syncSteps = await reconcile(
      clientStorage,
      relayStorage,
      ProtocolMessageRangesMaxSize.orThrow(3000),
    );
    expect(syncSteps).toMatchInlineSnapshot(`
      {
        "syncSizes": [
          361,
          184,
          999935,
          40,
          147798,
          40,
          158575,
          40,
          148007,
          40,
          138024,
          40,
          100753,
          20,
        ],
        "syncSteps": 14,
      }
    `);
  });

  it("relay has all data", async () => {
    await using run = testCreateRun();
    await using storages = await createStorages();
    const { clientStorage, relayStorage } = storages;
    await run(relayStorage.writeMessages(testAppOwnerIdBytes, messages));

    const syncSteps = await reconcile(clientStorage, relayStorage);
    expect(syncSteps).toMatchInlineSnapshot(`
      {
        "syncSizes": [
          24,
          999738,
          57,
          698838,
        ],
        "syncSteps": 4,
      }
    `);
  });

  it("relay has all data - many steps", async () => {
    await using run = testCreateRun();
    await using storages = await createStorages();
    const { clientStorage, relayStorage } = storages;
    await run(relayStorage.writeMessages(testAppOwnerIdBytes, messages));

    const syncSteps = await reconcile(
      clientStorage,
      relayStorage,
      ProtocolMessageRangesMaxSize.orThrow(3000),
    );
    expect(syncSteps).toMatchInlineSnapshot(`
      {
        "syncSizes": [
          24,
          156500,
          57,
          162913,
          57,
          154918,
          57,
          157668,
          57,
          157685,
          57,
          155905,
          57,
          158064,
          57,
          156825,
          57,
          152168,
          57,
          141022,
          57,
          150780,
          57,
          8779,
        ],
        "syncSteps": 24,
      }
    `);
  });

  it("client and relay each have a random half of the data", async () => {
    await using run = testCreateRun();
    await using storages = await createStorages();
    const { clientStorage, relayStorage } = storages;

    const shuffledMessages = deps.randomLib.shuffle(messages);
    const middle = Math.floor(shuffledMessages.length / 2);
    const firstHalf = shuffledMessages.slice(0, middle);
    const secondHalf = shuffledMessages.slice(middle);

    assertNonEmptyArray(firstHalf);
    assertNonEmptyArray(secondHalf);

    await run(clientStorage.writeMessages(testAppOwnerIdBytes, firstHalf));
    await run(relayStorage.writeMessages(testAppOwnerIdBytes, secondHalf));

    const syncSteps = await reconcile(clientStorage, relayStorage);
    expect(syncSteps).toMatchInlineSnapshot(`
      {
        "syncSizes": [
          379,
          5120,
          22678,
          857744,
          844045,
          20,
        ],
        "syncSteps": 6,
      }
    `);
  });

  it("client and relay each have a random half of the data - many steps", async () => {
    await using run = testCreateRun();
    await using storages = await createStorages();
    const { clientStorage, relayStorage } = storages;

    const shuffledMessages = deps.randomLib.shuffle(messages);
    const middle = Math.floor(shuffledMessages.length / 2);
    const firstHalf = shuffledMessages.slice(0, middle);
    const secondHalf = shuffledMessages.slice(middle);

    assertNonEmptyArray(firstHalf);
    assertNonEmptyArray(secondHalf);

    await run(clientStorage.writeMessages(testAppOwnerIdBytes, firstHalf));
    await run(relayStorage.writeMessages(testAppOwnerIdBytes, secondHalf));

    const syncSteps = await reconcile(
      clientStorage,
      relayStorage,
      ProtocolMessageRangesMaxSize.orThrow(3000),
    );
    expect(syncSteps).toMatchInlineSnapshot(`
      {
        "syncSizes": [
          334,
          2309,
          2239,
          118617,
          110353,
          2234,
          2256,
          88179,
          80860,
          2324,
          2238,
          87301,
          78090,
          2232,
          77187,
          74380,
          2246,
          59569,
          74972,
          2231,
          58666,
          67513,
          2232,
          55158,
          66338,
          2228,
          45900,
          61053,
          2243,
          50885,
          55541,
          15901,
          49487,
          46070,
          90077,
          105083,
          20901,
          45106,
          48626,
          20,
        ],
        "syncSteps": 40,
      }
    `);
  });

  it("starts sync from createProtocolMessageFromCrdtMessages", async () => {
    const owner = testAppOwner;
    const crdtMessages = testTimestampsAsc.map(
      (t): CrdtMessage => ({
        timestamp: timestampBytesToTimestamp(t),
        change: DbChange.orThrow({
          table: "foo",
          id: createId(deps),
          values: { bar: "baz" },
          isInsert: true,
          isDelete: null,
        }),
      }),
    );
    assertNonEmptyArray(crdtMessages);

    const protocolMessage = createProtocolMessageFromCrdtMessages(deps)(
      owner,
      crdtMessages,
      // This is technically invalid, we use it to enforce a sync.
      1000 as ProtocolMessageMaxSize,
    );

    await using setup = await setupSqliteAndRelayStorage();
    const { run } = setup;
    const relayResult = await run.orThrow(
      applyProtocolMessageAsRelay(protocolMessage),
    );

    expect(relayResult.message).toMatchInlineSnapshot(
      `uint8:[1,213,187,31,214,138,191,248,80,138,181,64,156,48,57,155,184,1,0,0,1,2,9,0,250,249,195,1,168,184,125,195,131,34,174,141,103,155,214,209,1,249,185,24,252,240,230,1,223,254,172,8,0,9,0,0,0,0,0,0,0,0,1,104,162,167,191,63,133,160,150,1,153,201,144,40,214,99,106,145,1,104,162,167,191,63,133,160,150,6]`,
    );
    // Sync continue
    expect(relayResult).not.toBe(null);
  });
});

describe("ranges sizes", () => {
  it("31 timestamps", () => {
    const buffer = createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Request,
    });
    const range: TimestampsRangeWithTimestampsBuffer = {
      type: RangeType.Timestamps,
      upperBound: InfiniteUpperBound,
      timestamps: createTimestampsBuffer(),
    };
    testTimestampsAsc.slice(0, 31).forEach((t) => {
      range.timestamps.add(timestampBytesToTimestamp(t));
    });

    buffer.addRange(range);

    expect(
      getUncompressedAndCompressedSizes(buffer.unwrap()),
    ).toMatchInlineSnapshot(`"190 178"`);
  });

  it("testTimestampsAsc", () => {
    const buffer = createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Request,
    });

    const range: TimestampsRangeWithTimestampsBuffer = {
      type: RangeType.Timestamps,
      upperBound: InfiniteUpperBound,
      timestamps: createTimestampsBuffer(),
    };
    testTimestampsAsc.forEach((t) => {
      range.timestamps.add(timestampBytesToTimestamp(t));
    });

    buffer.addRange(range);

    expect(
      getUncompressedAndCompressedSizes(buffer.unwrap()),
    ).toMatchInlineSnapshot(`"32552 17788"`);
  });

  it("fingerprints", () => {
    const buffer = createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Request,
    });

    testTimestampsAsc.slice(0, 16).forEach((timestamp, i) => {
      buffer.addRange({
        type: RangeType.Fingerprint,
        upperBound: i === 15 ? InfiniteUpperBound : timestamp,
        fingerprint: timestampBytesToFingerprint(testTimestampsRandom[i]),
      });
    });

    expect(
      getUncompressedAndCompressedSizes(buffer.unwrap()),
    ).toMatchInlineSnapshot(`"337 313"`);
  });
});
