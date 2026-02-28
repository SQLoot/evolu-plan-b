import { assertTanStackClientRuntime } from "@evolu/tanstack-start";
import { type FC, useEffect, useState } from "react";

interface Todo {
  readonly id: number;
  readonly title: string;
  readonly done: boolean;
}

const useOnlineStatus = (): boolean => {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return isOnline;
};

export const TodoApp: FC = () => {
  assertTanStackClientRuntime();

  const [todos, setTodos] = useState<ReadonlyArray<Todo>>([]);
  const [title, setTitle] = useState("");
  const isOnline = useOnlineStatus();

  const addTodo = () => {
    const nextTitle = title.trim();
    if (nextTitle === "") return;

    setTodos((current) => [
      ...current,
      { id: Date.now(), title: nextTitle, done: false },
    ]);
    setTitle("");
  };

  const toggleTodo = (id: number) => {
    setTodos((current) =>
      current.map((todo) =>
        todo.id === id ? { ...todo, done: !todo.done } : todo,
      ),
    );
  };

  const removeTodo = (id: number) => {
    setTodos((current) => current.filter((todo) => todo.id !== id));
  };

  return (
    <section
      style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}
    >
      <div
        style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}
      >
        <StatusBadge
          label="Runtime"
          value="TanStack client route"
          color="#1565c0"
        />
        <StatusBadge
          label="Offline"
          value={isOnline ? "No" : "Yes"}
          color={isOnline ? "#2e7d32" : "#c62828"}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a todo"
          style={{
            flex: 1,
            padding: 8,
            borderRadius: 8,
            border: "1px solid #bbb",
          }}
        />
        <button type="button" onClick={addTodo} style={buttonPrimaryStyle}>
          Add
        </button>
      </div>

      <ul style={{ paddingLeft: 0, listStyle: "none", margin: 0 }}>
        {todos.map((todo) => (
          <li
            key={todo.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 0",
              borderBottom: "1px solid #eee",
            }}
          >
            <input
              type="checkbox"
              checked={todo.done}
              onChange={() => toggleTodo(todo.id)}
            />
            <span
              style={{
                flex: 1,
                textDecoration: todo.done ? "line-through" : "none",
              }}
            >
              {todo.title}
            </span>
            <button
              type="button"
              onClick={() => removeTodo(todo.id)}
              style={buttonDangerStyle}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

const StatusBadge: FC<{ label: string; value: string; color: string }> = ({
  label,
  value,
  color,
}) => (
  <span
    style={{
      border: `1px solid ${color}`,
      color,
      borderRadius: 999,
      padding: "4px 10px",
      fontSize: 12,
      fontWeight: 600,
    }}
  >
    {label}: {value}
  </span>
);

const buttonPrimaryStyle = {
  background: "#1565c0",
  border: "none",
  color: "#fff",
  borderRadius: 8,
  padding: "8px 12px",
  cursor: "pointer",
} as const;

const buttonDangerStyle = {
  background: "#c62828",
  border: "none",
  color: "#fff",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
} as const;
