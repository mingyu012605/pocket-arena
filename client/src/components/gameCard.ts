import type { GameCatalogEntry } from "../games/catalog";
import { createButton } from "./button";

export function createGameCard(entry: GameCatalogEntry, onPlay: () => void): HTMLElement {
  const card = document.createElement("article");
  card.className = `card game-card${entry.playable ? "" : " game-card-disabled"}`;
  card.innerHTML = `
    <div class="game-icon">${entry.icon}</div>
    <h3>${entry.title}</h3>
    <p class="game-desc">${entry.description}</p>
    <p class="game-players">${
      entry.minPlayers === entry.maxPlayers
        ? `${entry.maxPlayers} players`
        : `${entry.minPlayers}-${entry.maxPlayers} players`
    }</p>
  `;
  const actions = document.createElement("div");
  actions.className = "game-card-actions";
  actions.appendChild(
    entry.playable
      ? createButton({ label: "Play", variant: "primary", onClick: onPlay })
      : createButton({ label: "Coming Soon", variant: "secondary", disabled: true })
  );
  card.appendChild(actions);
  return card;
}
