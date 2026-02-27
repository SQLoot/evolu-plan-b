import { TodoApp } from "./components/TodoApp";

export const App = () => (
  <main style={{ maxWidth: 880, margin: "0 auto", padding: 24 }}>
    <h1 style={{ fontSize: "1.8rem", marginBottom: "0.5rem" }}>
      Evolu + Tauri Integration
    </h1>
    <p style={{ color: "#555", marginBottom: "1.25rem" }}>
      WebView Todo app with runtime detection, offline indicator, and sync
      state.
    </p>
    <TodoApp />
  </main>
);
