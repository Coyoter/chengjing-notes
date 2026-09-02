import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import dayjs from "dayjs";
import "dayjs/locale/zh-tw";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { App } from "./App";
import { QuickCaptureWindow } from "./components/QuickCaptureWindow";

dayjs.locale("zh-tw");

const quickCapture = new URLSearchParams(window.location.search).has("quick-capture");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {quickCapture ? <QuickCaptureWindow /> : <App />}
  </StrictMode>,
);
