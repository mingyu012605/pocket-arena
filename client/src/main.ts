import "./styles/global.css";
import "./styles/components.css";
import { registerRoute, startRouter } from "./networking/router";
import { renderLandingPage } from "./pages/landing";
import { renderHostGameSelectPage } from "./pages/hostGameSelect";
import { renderHostPlayerCountPage } from "./pages/hostPlayerCount";
import { renderHostLobbyPage } from "./pages/hostLobby";
import { renderJoinPage } from "./pages/join";

registerRoute("/", renderLandingPage);
registerRoute("/host", renderHostGameSelectPage);
registerRoute("/host/:gameId", renderHostPlayerCountPage);
registerRoute("/host/lobby/:roomCode", renderHostLobbyPage);
registerRoute("/join/:roomCode/:playerNumber", renderJoinPage);

const app = document.querySelector<HTMLDivElement>("#app");
if (app) startRouter(app);
