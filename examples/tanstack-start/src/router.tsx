import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { TodoApp } from "./components/TodoApp";

const rootRoute = createRootRoute({
  component: () => (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: "1.8rem", marginBottom: "0.5rem" }}>
        Evolu + TanStack Start-style Integration
      </h1>
      <p style={{ color: "#555", marginBottom: "1.25rem" }}>
        Client-boundary Todo app with offline and sync state indicators.
      </p>
      <Outlet />
    </main>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: TodoApp,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
