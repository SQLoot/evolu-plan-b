import { describe, expect, expectTypeOf, test } from "vitest";
import * as z from "zod";
import type { Brand } from "../../src/Brand.js";
import type {
  MutationValues,
  ValidateColumnTypes,
  ValidateIdColumnType,
  ValidateNoSystemColumns,
  ValidateSchema,
  ValidateSchemaHasId,
} from "../../src/local-first/Schema.js";
import {
  createQueryBuilder,
  ensureSqliteSchema,
  evoluSchemaToSqliteSchema,
  getEvoluSqliteSchema,
} from "../../src/local-first/Schema.js";
import {
  getSqliteSchema,
  sqliteQueryStringToSqliteQuery,
  SqliteBoolean,
  type SqliteSchema,
  sql,
  testCreateRunWithSqlite,
} from "../../src/Sqlite.js";
import {
  Boolean,
  Id,
  type InferType,
  id,
  NonEmptyString100,
  nullOr,
} from "../../src/Type.js";
import { testCreateSqliteDeps } from "../_deps.js";

const TodoId = id("Todo");
type TodoId = typeof TodoId.Type;

describe("ValidateSchema", () => {
  describe("ValidateSchemaHasId", () => {
    test("reports missing id column", () => {
      const _SchemaWithoutId = {
        todo: { title: NonEmptyString100 },
      };

      type Result = ValidateSchemaHasId<typeof _SchemaWithoutId>;
      expectTypeOf<Result>().toEqualTypeOf<'❌ Schema Error: Table "todo" is missing required id column.'>();
    });

    test("passes for valid schema", () => {
      const _Schema = {
        todo: { id: TodoId, title: NonEmptyString100 },
      };

      type Result = ValidateSchemaHasId<typeof _Schema>;
      expectTypeOf<Result>().toEqualTypeOf<never>();
    });
  });

  describe("ValidateIdColumnType", () => {
    test("reports non-Id output type", () => {
      const _SchemaWithBadId = {
        todo: { id: NonEmptyString100, title: NonEmptyString100 },
      };

      type Result = ValidateIdColumnType<typeof _SchemaWithBadId>;
      expectTypeOf<Result>().toEqualTypeOf<'❌ Schema Error: Table "todo" id column output type must extend Id. Use id("todo") from Evolu Type.'>();
    });

    test("passes for branded id", () => {
      const _Schema = {
        todo: { id: TodoId, title: NonEmptyString100 },
      };

      type Result = ValidateIdColumnType<typeof _Schema>;
      expectTypeOf<Result>().toEqualTypeOf<never>();
    });
  });

  describe("ValidateNoSystemColumns", () => {
    test("reports createdAt system column", () => {
      type Result = ValidateNoSystemColumns<{
        todo: { id: typeof TodoId; createdAt: typeof NonEmptyString100 };
      }>;
      expectTypeOf<Result>().toEqualTypeOf<'❌ Schema Error: Table "todo" uses system column name "createdAt". System columns (createdAt, updatedAt, isDeleted, ownerId) are added automatically.'>();
    });

    test("reports updatedAt system column", () => {
      type Result = ValidateNoSystemColumns<{
        todo: { id: typeof TodoId; updatedAt: typeof NonEmptyString100 };
      }>;
      expectTypeOf<Result>().toEqualTypeOf<'❌ Schema Error: Table "todo" uses system column name "updatedAt". System columns (createdAt, updatedAt, isDeleted, ownerId) are added automatically.'>();
    });

    test("reports isDeleted system column", () => {
      type Result = ValidateNoSystemColumns<{
        todo: { id: typeof TodoId; isDeleted: typeof NonEmptyString100 };
      }>;
      expectTypeOf<Result>().toEqualTypeOf<'❌ Schema Error: Table "todo" uses system column name "isDeleted". System columns (createdAt, updatedAt, isDeleted, ownerId) are added automatically.'>();
    });

    test("reports ownerId system column", () => {
      type Result = ValidateNoSystemColumns<{
        todo: { id: typeof TodoId; ownerId: typeof NonEmptyString100 };
      }>;
      expectTypeOf<Result>().toEqualTypeOf<'❌ Schema Error: Table "todo" uses system column name "ownerId". System columns (createdAt, updatedAt, isDeleted, ownerId) are added automatically.'>();
    });

    test("passes for valid schema", () => {
      const _Schema = {
        todo: {
          id: TodoId,
          title: NonEmptyString100,
          isCompleted: nullOr(SqliteBoolean),
        },
      };

      type Result = ValidateNoSystemColumns<typeof _Schema>;
      expectTypeOf<Result>().toEqualTypeOf<never>();
    });
  });

  describe("ValidateColumnTypes", () => {
    test("reports non-SqliteValue column", () => {
      const _SchemaWithBadCol = {
        todo: {
          id: TodoId,
          data: Boolean,
        },
      };

      type Result = ValidateColumnTypes<typeof _SchemaWithBadCol>;
      expectTypeOf<Result>().toEqualTypeOf<'❌ Schema Error: Table "todo" column "data" type is not compatible with SQLite. Column types must extend SqliteValue (string, number, Uint8Array, or null).'>();
    });

    test("passes for valid schema", () => {
      const _Schema = {
        todo: {
          id: TodoId,
          title: NonEmptyString100,
          isCompleted: nullOr(SqliteBoolean),
        },
      };

      type Result = ValidateColumnTypes<typeof _Schema>;
      expectTypeOf<Result>().toEqualTypeOf<never>();
    });
  });
});

describe("Evolu Type", () => {
  const _Schema = {
    todo: {
      id: TodoId,
      title: NonEmptyString100,
      isCompleted: nullOr(SqliteBoolean),
    },
  };

  test("ValidateSchema returns schema type when valid", () => {
    type Result = ValidateSchema<typeof _Schema>;
    expectTypeOf<Result>().toEqualTypeOf<typeof _Schema>();
  });

  describe("mutation value types", () => {
    type TodoTable = typeof _Schema.todo;

    test("InsertValues omits id and makes nullable columns optional", () => {
      type Insert = MutationValues<TodoTable, "insert">;

      expectTypeOf<Insert>().toEqualTypeOf<{
        readonly title: InferType<typeof NonEmptyString100>;
        readonly isCompleted?: SqliteBoolean | null;
      }>();
    });

    test("UpdateValues requires only id, everything else optional", () => {
      type Update = MutationValues<TodoTable, "update">;

      expectTypeOf<Update>().toEqualTypeOf<{
        readonly id: TodoId;
        readonly title?: InferType<typeof NonEmptyString100>;
        readonly isCompleted?: SqliteBoolean | null;
        readonly isDeleted?: SqliteBoolean;
      }>();
    });

    test("UpsertValues requires id and non-nullable columns", () => {
      type Upsert = MutationValues<TodoTable, "upsert">;

      expectTypeOf<Upsert>().toEqualTypeOf<{
        readonly id: TodoId;
        readonly title: InferType<typeof NonEmptyString100>;
        readonly isCompleted?: SqliteBoolean | null;
        readonly isDeleted?: SqliteBoolean;
      }>();
    });
  });
});

describe("Zod", () => {
  // A Zod equivalent of Evolu's id() factory.
  const zodId = <Table extends string>(_table: Table) =>
    z.custom<Id & Brand<Table>>(Id.is);

  // A Zod equivalent of Evolu's SqliteBoolean.
  const ZodSqliteBoolean = z.union([z.literal(0), z.literal(1)]);
  type ZodSqliteBoolean = z.infer<typeof ZodSqliteBoolean>;

  const TodoId = zodId("Todo");
  type TodoId = z.infer<typeof TodoId>;

  const _Schema = {
    todo: {
      id: TodoId,
      title: z.string().min(1).max(100),
      isCompleted: ZodSqliteBoolean.nullable(),
    },
  };

  test("ValidateSchema returns schema type when valid", () => {
    type Result = ValidateSchema<typeof _Schema>;
    expectTypeOf<Result>().toEqualTypeOf<typeof _Schema>();
  });

  describe("mutation value types", () => {
    type TodoTable = typeof _Schema.todo;

    test("InsertValues omits id and makes nullable columns optional", () => {
      type Insert = MutationValues<TodoTable, "insert">;

      expectTypeOf<Insert>().toEqualTypeOf<{
        readonly title: string;
        readonly isCompleted?: 0 | 1 | null;
      }>();
    });

    test("UpdateValues requires only id, everything else optional", () => {
      type Update = MutationValues<TodoTable, "update">;

      expectTypeOf<Update>().toEqualTypeOf<{
        readonly id: TodoId;
        readonly title?: string;
        readonly isCompleted?: 0 | 1 | null;
        readonly isDeleted?: ZodSqliteBoolean;
      }>();
    });

    test("UpsertValues requires id and non-nullable columns", () => {
      type Upsert = MutationValues<TodoTable, "upsert">;

      expectTypeOf<Upsert>().toEqualTypeOf<{
        readonly id: TodoId;
        readonly title: string;
        readonly isCompleted?: 0 | 1 | null;
        readonly isDeleted?: ZodSqliteBoolean;
      }>();
    });
  });
});

describe("ensureSqliteSchema", () => {
  test("creates new tables", async () => {
    await using run = await testCreateRunWithSqlite(testCreateSqliteDeps());

    const newSchema: SqliteSchema = {
      tables: {
        todo: new Set(["title", "isCompleted"]),
      },
      indexes: [],
    };

    ensureSqliteSchema(run.deps)(newSchema);

    const sqliteSchema = getSqliteSchema(run.deps)();
    expect(sqliteSchema.tables.todo).toBeDefined();
    expect(sqliteSchema.tables.todo.has("id")).toBe(true);
    expect(sqliteSchema.tables.todo.has("title")).toBe(true);
    expect(sqliteSchema.tables.todo.has("isCompleted")).toBe(true);
    expect(sqliteSchema.tables.todo.has("createdAt")).toBe(true);
    expect(sqliteSchema.tables.todo.has("updatedAt")).toBe(true);
    expect(sqliteSchema.tables.todo.has("isDeleted")).toBe(true);
    expect(sqliteSchema.tables.todo.has("ownerId")).toBe(true);
  });

  test("adds new columns to existing tables", async () => {
    await using run = await testCreateRunWithSqlite(testCreateSqliteDeps());

    const initialSchema: SqliteSchema = {
      tables: {
        todo: new Set(["title"]),
      },
      indexes: [],
    };

    ensureSqliteSchema(run.deps)(initialSchema);

    const updatedSchema: SqliteSchema = {
      tables: {
        todo: new Set(["title", "isCompleted", "priority"]),
      },
      indexes: [],
    };

    ensureSqliteSchema(run.deps)(updatedSchema);

    const sqliteSchema = getSqliteSchema(run.deps)();
    expect(sqliteSchema.tables.todo.has("title")).toBe(true);
    expect(sqliteSchema.tables.todo.has("isCompleted")).toBe(true);
    expect(sqliteSchema.tables.todo.has("priority")).toBe(true);
  });

  test("creates multiple tables", async () => {
    await using run = await testCreateRunWithSqlite(testCreateSqliteDeps());

    const newSchema: SqliteSchema = {
      tables: {
        todo: new Set(["title"]),
        category: new Set(["name"]),
      },
      indexes: [],
    };

    ensureSqliteSchema(run.deps)(newSchema);

    const sqliteSchema = getSqliteSchema(run.deps)();
    expect(sqliteSchema.tables.todo).toBeDefined();
    expect(sqliteSchema.tables.category).toBeDefined();
    expect(sqliteSchema.tables.todo.has("title")).toBe(true);
    expect(sqliteSchema.tables.category.has("name")).toBe(true);
  });

  test("uses set difference to find new columns", async () => {
    await using run = await testCreateRunWithSqlite(testCreateSqliteDeps());

    const initialSchema: SqliteSchema = {
      tables: {
        todo: new Set(["a", "b", "c"]),
      },
      indexes: [],
    };

    ensureSqliteSchema(run.deps)(initialSchema);

    const updatedSchema: SqliteSchema = {
      tables: {
        todo: new Set(["b", "c", "d", "e"]),
      },
      indexes: [],
    };

    ensureSqliteSchema(run.deps)(updatedSchema);

    const sqliteSchema = getSqliteSchema(run.deps)();
    // Original columns still exist
    expect(sqliteSchema.tables.todo.has("a")).toBe(true);
    expect(sqliteSchema.tables.todo.has("b")).toBe(true);
    expect(sqliteSchema.tables.todo.has("c")).toBe(true);
    // New columns added via difference
    expect(sqliteSchema.tables.todo.has("d")).toBe(true);
    expect(sqliteSchema.tables.todo.has("e")).toBe(true);
  });

  test("with currentSchema parameter skips getSqliteSchema call", async () => {
    await using run = await testCreateRunWithSqlite(testCreateSqliteDeps());

    const currentSchema: SqliteSchema = {
      tables: {
        todo: new Set(["title"]),
      },
      indexes: [],
    };

    // First create the table
    ensureSqliteSchema(run.deps)(currentSchema);

    const newSchema: SqliteSchema = {
      tables: {
        todo: new Set(["title", "description"]),
      },
      indexes: [],
    };

    // Pass currentSchema to skip getSqliteSchema
    ensureSqliteSchema(run.deps)(newSchema, currentSchema);

    const sqliteSchema = getSqliteSchema(run.deps)();
    expect(sqliteSchema.tables.todo.has("description")).toBe(true);
  });

  test("does not drop Evolu-managed indexes when currentSchema is omitted", async () => {
    await using run = await testCreateRunWithSqlite(testCreateSqliteDeps());

    const schema: SqliteSchema = {
      tables: {
        todo: new Set(["title"]),
      },
      indexes: [],
    };

    ensureSqliteSchema(run.deps)(schema);
    run.deps.sqlite.exec(sql`
      create index evolu_internal_test on todo (title);
    `);

    // Re-running ensure without currentSchema must keep evolu_ indexes untouched.
    ensureSqliteSchema(run.deps)(schema);

    const schemaWithInternalIndexes = getSqliteSchema(run.deps)({
      excludeSqliteInternalIndexes: false,
    });

    expect(
      schemaWithInternalIndexes.indexes.some(
        ({ name }) => name === "evolu_internal_test",
      ),
    ).toBe(true);
  });

  test("drops and adds app indexes when currentSchema is provided", async () => {
    await using run = await testCreateRunWithSqlite(testCreateSqliteDeps());

    ensureSqliteSchema(run.deps)({
      tables: { todo: new Set(["title"]) },
      indexes: [],
    });

    run.deps.sqlite.exec(sql`create index app_todo_old on todo (title);`);

    ensureSqliteSchema(run.deps)(
      {
        tables: { todo: new Set(["title"]) },
        indexes: [
          {
            name: "app_todo_new",
            sql: "create index app_todo_new on todo (title)",
          },
        ],
      },
      {
        tables: { todo: new Set(["title"]) },
        indexes: [
          {
            name: "app_todo_old",
            sql: "create index app_todo_old on todo (title)",
          },
        ],
      },
    );

    const sqliteSchema = getSqliteSchema(run.deps)({
      excludeSqliteInternalIndexes: false,
    });
    const indexNames = sqliteSchema.indexes.map((index) => index.name);

    expect(indexNames).toContain("app_todo_new");
    expect(indexNames).not.toContain("app_todo_old");
  });
});

describe("evoluSchemaToSqliteSchema", () => {
  test("creates sqlite schema and excludes id column from table columns", () => {
    const sqliteSchema = evoluSchemaToSqliteSchema({
      todo: {
        id: TodoId,
        title: NonEmptyString100,
        isCompleted: nullOr(SqliteBoolean),
      },
    });

    expect(sqliteSchema.tables.todo).toEqual(new Set(["title", "isCompleted"]));
    expect(sqliteSchema.indexes).toEqual([]);
  });

  test("compiles indexes from indexesConfig", () => {
    const sqliteSchema = evoluSchemaToSqliteSchema(
      {
        todo: {
          id: TodoId,
          title: NonEmptyString100,
        },
      },
      (create) => [create("todo_title").on("todo").column("title")],
    );

    expect(sqliteSchema.indexes).toHaveLength(1);
    expect(sqliteSchema.indexes[0]).toEqual(
      expect.objectContaining({
        name: "todo_title",
      }),
    );
    expect(sqliteSchema.indexes[0]?.sql).toContain("create index");
  });
});

describe("createQueryBuilder", () => {
  const createQuery = createQueryBuilder({
    todo: {
      id: TodoId,
      title: NonEmptyString100,
    },
  });

  test("serializes query with options", () => {
    const query = createQuery(
      (db) => db.selectFrom("todo").select(["id", "title"]),
      { prepare: true },
    );
    const sqliteQuery = sqliteQueryStringToSqliteQuery(query);

    expect(sqliteQuery.sql).toContain('select "id", "title" from "todo"');
    expect(sqliteQuery.parameters).toEqual([]);
    expect(sqliteQuery.options).toEqual({ prepare: true });
  });
});

describe("getEvoluSqliteSchema", () => {
  test("excludes evolu_ prefixed indexes", async () => {
    await using run = await testCreateRunWithSqlite(testCreateSqliteDeps());

    ensureSqliteSchema(run.deps)({
      tables: { todo: new Set(["title"]) },
      indexes: [],
    });

    run.deps.sqlite.exec(sql`create index evolu_internal on todo (title);`);
    run.deps.sqlite.exec(sql`create index app_todo_title on todo (title);`);

    const sqliteSchema = getEvoluSqliteSchema(run.deps)();
    const indexNames = sqliteSchema.indexes.map((index) => index.name);

    expect(indexNames).toContain("app_todo_title");
    expect(indexNames).not.toContain("evolu_internal");
  });
});
