import { GAME_CATALOG } from "../games/catalog";
import { createGameCard } from "../components/gameCard";
import { navigate } from "../networking/router";
import type { CleanupFn, RouteContext } from "../networking/router";

export function renderHostGameSelectPage({ container }: RouteContext): CleanupFn | void {
  container.innerHTML = `
    <section class="page-section">
      <h1>Choose a Game</h1>
      <div class="game-grid" id="game-grid"></div>
    </section>
  `;
  const grid = container.querySelector<HTMLDivElement>("#game-grid")!;
  for (const entry of GAME_CATALOG) {
    grid.appendChild(createGameCard(entry, () => navigate(`/host/${entry.id}`)));
  }
}
