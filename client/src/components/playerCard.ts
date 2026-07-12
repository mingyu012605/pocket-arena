import type { PublicPlayer } from "../../../shared/protocol";

function statusLabel(player: PublicPlayer): string {
  if (!player.nickname) return "Waiting for player";
  if (!player.connected) return "Disconnected";
  return player.ready ? "Ready" : "Connected";
}

function statusClass(player: PublicPlayer): string {
  if (!player.nickname) return "waiting";
  if (!player.connected) return "disconnected";
  return player.ready ? "ready" : "connected";
}

export function createPlayerCard(player: PublicPlayer): HTMLElement {
  const card = document.createElement("div");
  card.className = `player-card status-${statusClass(player)}`;
  card.innerHTML = `
    <span class="player-number">Player ${player.playerNumber}</span>
    <span class="player-nickname">${player.nickname ?? "Waiting to scan…"}</span>
    <span class="player-status">${statusLabel(player)}</span>
  `;
  return card;
}
