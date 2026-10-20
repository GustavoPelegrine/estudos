import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installStaleBuildHandler } from "./lib/stale-build";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";

installStaleBuildHandler();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
