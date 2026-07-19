import { mountRuntimeBaseline } from "../application-shell/runtime-baseline.js";

const host = document.querySelector<HTMLElement>("#application-shell");

if (host === null) {
  throw new Error("Application shell host is missing.");
}

mountRuntimeBaseline(host, "PC Build Planner");
host.dataset.runtimeState = "started";
