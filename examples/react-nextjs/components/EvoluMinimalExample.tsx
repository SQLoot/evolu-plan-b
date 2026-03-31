"use client";

import * as Evolu from "@evolu/common";
import { createEvoluBinding } from "@evolu/react";
import { createEvoluDeps, EvoluIdenticon } from "@evolu/react-web";
import { createRun } from "@evolu/web";
import { IconEdit, IconTrash } from "@tabler/icons-react";
import clsx from "clsx";
import {
  Component,
  type ErrorInfo,
  type FC,
  type ReactNode,
  Suspense,
  use,
  useState,
} from "react";

const TodoId = Evolu.id("Todo");

const Schema = {
  todo: {
    id: TodoId,
    title: Evolu.NonEmptyTrimmedString100,
    isCompleted: Evolu.nullOr(Evolu.SqliteBoolean),
  },
};

const appName = Evolu.AppName.orThrow("react-nextjs-minimal");
const evoluDeps = createEvoluDeps();
const run = createRun(evoluDeps);
const evoluPromise: Promise<Evolu.Evolu<typeof Schema>> = run.orThrow(
  Evolu.createEvolu(Schema, {
    appName,
    appOwner: Evolu.testAppOwner,
  }),
);

const { EvoluContext, useEvolu, useQuery } = createEvoluBinding(Schema);

const createQuery = Evolu.createQueryBuilder(Schema);
const todosQuery = createQuery((db) =>
  db
    .selectFrom("todo")
    .select(["id", "title", "isCompleted"])
    .where("isDeleted", "is not", Evolu.sqliteTrue)
    .where("title", "is not", null)
    .$narrowType<{ title: Evolu.KyselyNotNull }>()
    .orderBy("createdAt"),
);

type TodosRow = typeof todosQuery.Row;

class EvoluInitErrorBoundary extends Component<
  { readonly children: ReactNode },
  { readonly hasError: boolean }
> {
  override state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    console.error("Failed to initialize Evolu", error, errorInfo);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg bg-red-50 p-6 text-sm text-red-700 ring-1 ring-red-200">
          Failed to initialize Evolu.
        </div>
      );
    }

    return this.props.children;
  }
}

void evoluPromise.catch((error: unknown) => {
  console.error(error);
});

evoluDeps.evoluError.subscribe(() => {
  const error = evoluDeps.evoluError.get();
  if (!error) return;
  window.alert("🚨 Evolu error occurred. Check the console.");
  console.error(error);
});

export const EvoluMinimalExample: FC = () => {
  return (
    <div className="min-h-screen px-8 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-2 flex items-center justify-between pb-4">
          <h1 className="w-full text-center text-xl font-semibold text-gray-900">
            Minimal Todo App
          </h1>
        </div>

        <Suspense
          fallback={
            <div className="rounded-lg bg-white p-6 text-sm text-gray-600 shadow-sm ring-1 ring-gray-200">
              Opening app...
            </div>
          }
        >
          <EvoluInitErrorBoundary>
            <App />
          </EvoluInitErrorBoundary>
        </Suspense>
      </div>
    </div>
  );
};

const App: FC = () => {
  const evolu = use(evoluPromise);

  return (
    <EvoluContext value={evolu}>
      <Todos />
      <OwnerActions />
    </EvoluContext>
  );
};

const parseTodoTitle = (value: string) =>
  Evolu.NonEmptyTrimmedString100.from(value.trim());

const Todos: FC = () => {
  const todos = useQuery(todosQuery);
  const { insert } = useEvolu();
  const [newTodoTitle, setNewTodoTitle] = useState("");

  const addTodo = () => {
    const title = parseTodoTitle(newTodoTitle);
    if (!title.ok) {
      window.alert(formatTypeError(title.error));
      return;
    }

    insert(
      "todo",
      { title: title.value },
      {
        onComplete: () => {
          setNewTodoTitle("");
        },
      },
    );
  };

  return (
    <div className="rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
      <ol className="mb-6 space-y-2">
        {todos.map((todo) => (
          <TodoItem key={todo.id} row={todo} />
        ))}
      </ol>

      <div className="flex gap-2">
        <input
          type="text"
          value={newTodoTitle}
          onChange={(e) => {
            setNewTodoTitle(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") addTodo();
          }}
          placeholder="Add a new todo..."
          className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6"
        />
        <Button title="Add" onClick={addTodo} variant="primary" />
      </div>
    </div>
  );
};

const TodoItem: FC<{
  row: TodosRow;
}> = ({ row: { id, title, isCompleted } }) => {
  const { update } = useEvolu();

  const handleToggleCompletedClick = () => {
    update("todo", {
      id,
      isCompleted: Evolu.booleanToSqliteBoolean(!isCompleted),
    });
  };

  const handleRenameClick = () => {
    const newTitle = window.prompt("Edit todo", title);
    if (newTitle == null) return;

    const parsedTitle = parseTodoTitle(newTitle);
    if (!parsedTitle.ok) {
      window.alert(formatTypeError(parsedTitle.error));
      return;
    }

    update("todo", { id, title: parsedTitle.value });
  };

  const handleDeleteClick = () => {
    update("todo", {
      id,
      isDeleted: Evolu.sqliteTrue,
    });
  };

  return (
    <li className="-mx-2 flex items-center gap-3 px-2 py-2 hover:bg-gray-50">
      <label className="flex flex-1 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={Boolean(isCompleted)}
          onChange={handleToggleCompletedClick}
          className="col-start-1 row-start-1 appearance-none rounded-sm border border-gray-300 bg-white checked:border-blue-600 checked:bg-blue-600 indeterminate:border-blue-600 indeterminate:bg-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:border-gray-300 disabled:bg-gray-100 disabled:checked:bg-gray-100 forced-colors:appearance-auto"
        />
        <span
          className={clsx(
            "flex-1 text-sm",
            isCompleted ? "text-gray-500 line-through" : "text-gray-900",
          )}
        >
          {title}
        </span>
      </label>
      <div className="flex gap-1">
        <button
          onClick={handleRenameClick}
          className="p-1 text-gray-400 transition-colors hover:text-blue-600"
          title="Edit"
        >
          <IconEdit className="size-4" />
        </button>
        <button
          onClick={handleDeleteClick}
          className="p-1 text-gray-400 transition-colors hover:text-red-600"
          title="Delete"
        >
          <IconTrash className="size-4" />
        </button>
      </div>
    </li>
  );
};

const OwnerActions: FC = () => {
  const evolu = useEvolu();
  const [showMnemonic, setShowMnemonic] = useState(false);

  const handleDownloadDatabaseClick = async () => {
    let url: string | undefined;

    try {
      const array = await evolu.exportDatabase();
      const blob = new Blob([array], { type: "application/x-sqlite3" });
      url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${appName}.sqlite3`;
      anchor.click();
    } catch (error) {
      console.error("Failed to export database", error);
      window.alert(
        error instanceof Error ? error.message : "Database export failed.",
      );
    } finally {
      if (url) window.URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="mt-6 rounded-lg bg-white p-6 shadow-sm ring-1 ring-gray-200">
      <div className="mb-4 flex items-center gap-3">
        <EvoluIdenticon id={evolu.appOwner.id} size={40} />
        <div>
          <div className="text-sm font-medium text-gray-900">App Owner</div>
          <div className="text-xs text-gray-500">{evolu.appOwner.id}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          title={showMnemonic ? "Hide Mnemonic" : "Show Mnemonic"}
          onClick={() => {
            setShowMnemonic((value) => !value);
          }}
        />
        <Button title="Download DB" onClick={handleDownloadDatabaseClick} />
      </div>

      {showMnemonic ? (
        <pre className="mt-4 overflow-x-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
          {evolu.appOwner.mnemonic}
        </pre>
      ) : null}
    </div>
  );
};

const Button: FC<{
  title: string;
  className?: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
}> = ({ title, className, onClick, variant = "secondary" }) => {
  const baseClasses =
    "rounded-lg px-3 py-2 text-sm font-medium transition-colors";
  const variantClasses =
    variant === "primary"
      ? "bg-blue-600 text-white hover:bg-blue-700"
      : "bg-gray-100 text-gray-700 hover:bg-gray-200";

  return (
    <button
      className={clsx(baseClasses, variantClasses, className)}
      onClick={onClick}
    >
      {title}
    </button>
  );
};

const formatTypeError = Evolu.createFormatTypeError<
  Evolu.MinLengthError | Evolu.MaxLengthError
>((error): string => {
  switch (error.type) {
    case "MinLength":
      return `Text must be at least ${error.min} character${error.min === 1 ? "" : "s"} long`;
    case "MaxLength":
      return `Text is too long (maximum ${error.max} characters)`;
  }
});
