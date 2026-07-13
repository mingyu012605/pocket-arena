import { GAME_CATALOG } from "../games/catalog";
import {
  createFeaturedCarousel,
  createGameGrid,
  createGameLauncherHeader,
  createLauncherGameViews,
  createLauncherStatusBar
} from "../components/gameLauncher";
import { navigate } from "../networking/router";
import type { GameType } from "../../../shared/protocol";
import type { CleanupFn, RouteContext } from "../networking/router";

export function renderHostGameSelectPage({ container }: RouteContext): CleanupFn | void {
  container.innerHTML = `
    <section class="pa-launcher-page">
      <div class="pa-sky-grid" aria-hidden="true"></div>
      <div class="pa-background-balls" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <div class="pa-shell">
        <div id="pa-header"></div>
        <main class="pa-main">
          <div id="pa-featured"></div>
          <div id="pa-games"></div>
        </main>
        <div id="pa-status"></div>
      </div>
    </section>
  `;

  const games = createLauncherGameViews(GAME_CATALOG);
  const play = (id: GameType): void => navigate(`/host/${id}`);
  const carousel = createFeaturedCarousel(games, play);

  container.querySelector<HTMLDivElement>("#pa-header")!.appendChild(createGameLauncherHeader());
  container.querySelector<HTMLDivElement>("#pa-featured")!.appendChild(carousel.element);
  container.querySelector<HTMLDivElement>("#pa-games")!.appendChild(createGameGrid(games, play));
  container.querySelector<HTMLDivElement>("#pa-status")!.appendChild(createLauncherStatusBar());

  return carousel.cleanup;
}
