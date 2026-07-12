import "./styles/global.css";
import "./styles/components.css";
import { registerRoute, startRouter } from "./networking/router";
import { renderLandingPage } from "./pages/landing";

registerRoute("/", renderLandingPage);

const app = document.querySelector<HTMLDivElement>("#app");
if (app) startRouter(app);
