import { GAME_CATALOG } from "../games/catalog";
import { createFeaturedGameHero, createGameLauncherHeader, createLauncherGameCard } from "../components/gameLauncher";
import { navigate } from "../networking/router";
import type { CleanupFn, RouteContext } from "../networking/router";

export function renderHostGameSelectPage({ container }: RouteContext): CleanupFn | void {
  container.innerHTML = `
    <section class="launcher-page">
      <div class="launcher-bg" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <div class="launcher-shell">
        <div id="launcher-header"></div>
        <main>
          <div id="featured-game"></div>
          <section class="launcher-secondary">
            <div class="launcher-secondary-heading">
              <p class="launcher-section-label">More Games</p>
              <span>Choose a sport, scan a phone, and jump in.</span>
            </div>
            <div class="launcher-game-grid" id="game-grid"></div>
          </section>
        </main>
      </div>
    </section>
  `;
  container.querySelector<HTMLDivElement>("#launcher-header")!.appendChild(createGameLauncherHeader());

  const racing = GAME_CATALOG.find((entry) => entry.id === "racing");
  if (racing) {
    container
      .querySelector<HTMLDivElement>("#featured-game")!
      .appendChild(createFeaturedGameHero(racing, () => navigate(`/host/${racing.id}`)));
  }

  const grid = container.querySelector<HTMLDivElement>("#game-grid")!;
  const secondaryOrder = ["racing", "table-tennis", "bowling", "tennis", "rhythm-battle", "controller-test"];
  for (const id of secondaryOrder) {
    const entry = GAME_CATALOG.find((item) => item.id === id);
    if (entry) grid.appendChild(createLauncherGameCard(entry, () => navigate(`/host/${entry.id}`)));
  }
}
