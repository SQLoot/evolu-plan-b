import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";

const app = mount(App, {
  // biome-ignore lint/style/noNonNullAssertion: Context
  target: document.getElementById("app")!,
});

export default app;
