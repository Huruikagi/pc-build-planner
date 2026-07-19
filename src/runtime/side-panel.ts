import { createProductionSidePanelComposition } from "../application-shell/application-composition.js";
import { createSidePanelBootstrap } from "../application-shell/runtime-bootstrap.js";

const host = document.querySelector<HTMLElement>("#application-shell");
if (host === null) throw new Error("Application shell host is missing.");

void createSidePanelBootstrap({
  root: createProductionSidePanelComposition(host),
  document,
  lifecycleTarget: window,
}).start();
