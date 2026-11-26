import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/figures.css";
import "./styles/app.css";
import { startTooltips } from "./ui/tooltip.ts";

startTooltips();
createRoot(document.getElementById("root")!).render(<App />);
