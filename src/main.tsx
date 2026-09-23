import React from "react";
import ReactDOM from "react-dom/client";
// Self-hosted fonts (bundled locally — no CDN, work offline in Tauri).
// Inter for all UI text; JetBrains Mono only for the SQL editor.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import { initializeSecureRepositories } from "./lib/secureRepository";
import "./features/ai/aiConfigRepository";
import "./features/scheduler/connectionRepository";
import "./styles.css";
/* 动效与玻璃层 —— 放在设计系统之后,变量能覆盖 */
import "./motion.css";
import "./features/dashboard/dashboard.css";

// Load/migrate settings before stores initialize; never connect to a database
// as part of credential migration.
void initializeSecureRepositories().then(async () => {
  const { default: App } = await import("./App");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode><App /></React.StrictMode>,
  );
});
