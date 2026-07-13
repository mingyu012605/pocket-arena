import "./styles/global.css";
import "./styles/components.css";
import "./styles/animations.css";
import { registerRoute, startRouter } from "./networking/router";
import { renderHostGameSelectPage } from "./pages/hostGameSelect";
import { renderHostPlayerCountPage } from "./pages/hostPlayerCount";
import { renderHostLobbyPage } from "./pages/hostLobby";
import { renderJoinPage } from "./pages/join";
import { renderMotionDebugPage } from "./pages/motionDebug";

registerRoute("/", renderHostGameSelectPage);
registerRoute("/host", renderHostGameSelectPage);
registerRoute("/host/:gameId", renderHostPlayerCountPage);
registerRoute("/host/lobby/:roomCode", renderHostLobbyPage);
registerRoute("/join/:roomCode", renderJoinPage);
registerRoute("/join/:roomCode/:playerNumber", renderJoinPage);
registerRoute("/dev/motion-debug", renderMotionDebugPage);

const app = document.querySelector<HTMLDivElement>("#app");
if (app) startRouter(app);
