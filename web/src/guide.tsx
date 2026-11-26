// The guide page. Its words are static HTML in guide.html, so they read without scripts.
// This adds the styles of the app, the theme choice and the tooltips of that choice.

import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/app.css";
import { ThemeSwitch } from "./ui/controls.tsx";
import { startTooltips } from "./ui/tooltip.ts";

startTooltips();
createRoot(document.getElementById("bar-tools")!).render(<ThemeSwitch />);
