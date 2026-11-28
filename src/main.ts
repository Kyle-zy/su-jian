import "./styles/main.css";
import "./styles/markdown.css";
import { applyTheme } from "./core/theme";
import { App } from "./core/app";

// 尽早应用主题，避免亮色闪屏。
applyTheme();

const app = new App();
void app.start();
