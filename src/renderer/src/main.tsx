import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "flexlayout-react/style/light.css";
import "katex/dist/katex.min.css";
import "./styles.css";
import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
