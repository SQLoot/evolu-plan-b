import { WebSocket } from "ws";

// Polyfill WebSocket for Node.js tests
// @ts-expect-error: WebSocket from 'ws' is not exactly compatible with global WebSocket, but sufficient for tests
globalThis.WebSocket = WebSocket;
