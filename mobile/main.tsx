import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";

const runtimeWindow = window as Window & {
  Capacitor?: { isNativePlatform?: () => boolean };
  webkit?: { messageHandlers?: { xingjiStorage?: unknown } };
};

if (runtimeWindow.Capacitor?.isNativePlatform?.() || runtimeWindow.webkit?.messageHandlers?.xingjiStorage) {
  document.documentElement.classList.add("native-app");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
