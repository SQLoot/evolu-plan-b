import type { Expression, SelectQueryNode } from "kysely";
import {
  AliasNode,
  ColumnNode,
  IdentifierNode,
  ReferenceNode,
  type SelectionNode,
  SelectQueryNode as SelectQueryNodeType,
  TableNode,
  ValueNode,
} from "kysely";
import { describe, expect, test } from "vitest";
import {
  getJsonObjectArgs,
  evoluJsonArrayFrom as jsonArrayFrom,
  evoluJsonBuildObject as jsonBuildObject,
  evoluJsonObjectFrom as jsonObjectFrom,
  kyselyJsonIdentifier,
  kyselySql as sql,
} from "../../src/local-first/Query.js";

const createSelectQueryNode = (
  selections: ReadonlyArray<
    Readonly<{
      readonly selection: unknown;
    }>
  >,
): SelectQueryNode =>
  SelectQueryNodeType.cloneWithSelections(
    SelectQueryNodeType.create(),
    selections as ReadonlyArray<SelectionNode>,
  );

const createSelectExpression = (node: SelectQueryNode): unknown =>
  ({
    isSelectQueryBuilder: true as const,
    toOperationNode: () => node,
  }) as unknown;

const toValueNodeValue = (expression: Expression<unknown>): unknown => {
  const node = expression.toOperationNode();
  if (!ValueNode.is(node)) return undefined;
  return node.value;
};

describe("Kysely helpers", () => {
  test("getJsonObjectArgs supports ReferenceNode, ColumnNode, and AliasNode", () => {
    const node = createSelectQueryNode([
      {
        selection: ReferenceNode.create(
          ColumnNode.create("id"),
          TableNode.create("person"),
        ),
      },
      { selection: ColumnNode.create("title") },
      {
        selection: AliasNode.create(
          ColumnNode.create("name"),
          IdentifierNode.create("person_name"),
        ),
      },
    ]);

    const args = getJsonObjectArgs(node, "agg");
    expect(args).toHaveLength(6);

    expect(toValueNodeValue(args[0] as Expression<unknown>)).toBe("id");
    expect(toValueNodeValue(args[2] as Expression<unknown>)).toBe("title");
    expect(toValueNodeValue(args[4] as Expression<unknown>)).toBe(
      "person_name",
    );

    const idRef = (args[1] as Expression<unknown>).toOperationNode();
    const titleRef = (args[3] as Expression<unknown>).toOperationNode();
    const aliasRef = (args[5] as Expression<unknown>).toOperationNode();

    expect(ReferenceNode.is(idRef)).toBe(true);
    expect(ReferenceNode.is(titleRef)).toBe(true);
    expect(ReferenceNode.is(aliasRef)).toBe(true);
  });

  test("getJsonObjectArgs throws for unsupported select nodes", () => {
    const node = createSelectQueryNode([
      {
        selection: AliasNode.create(
          ColumnNode.create("name"),
          ColumnNode.create("invalid_alias"),
        ),
      },
    ]);

    expect(() => getJsonObjectArgs(node, "agg")).toThrow(
      "can't extract column names from the select query node",
    );
  });

  test("jsonArrayFrom and jsonObjectFrom throw descriptive error for unsupported subqueries", () => {
    const invalidNode = createSelectQueryNode([
      {
        selection: AliasNode.create(
          ColumnNode.create("name"),
          ColumnNode.create("invalid_alias"),
        ),
      },
    ]);

    expect(() =>
      jsonArrayFrom(createSelectExpression(invalidNode) as never),
    ).toThrow(/can only handle explicit selections/);
    expect(() =>
      jsonObjectFrom(createSelectExpression(invalidNode) as never),
    ).toThrow(/can only handle explicit selections/);
  });

  test("jsonArrayFrom, jsonObjectFrom, and jsonBuildObject include Evolu JSON prefix", () => {
    const validNode = createSelectQueryNode([
      {
        selection: ReferenceNode.create(
          ColumnNode.create("id"),
          TableNode.create("person"),
        ),
      },
    ]);

    const arrayNode = jsonArrayFrom(
      createSelectExpression(validNode) as never,
    ).toOperationNode();
    const objectNode = jsonObjectFrom(
      createSelectExpression(validNode) as never,
    ).toOperationNode();
    const buildNode = jsonBuildObject({
      id: sql.lit(1),
      name: sql.lit("Ada"),
    }).toOperationNode();

    const serializedNodes = JSON.stringify([arrayNode, objectNode, buildNode]);
    expect(serializedNodes).toContain(kyselyJsonIdentifier);
  });
});
