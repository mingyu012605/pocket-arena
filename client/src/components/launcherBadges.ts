export function createStatusBadge(text: string, available: boolean): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = `pa-badge pa-status-badge ${available ? "is-available" : "is-soon"}`;
  badge.textContent = text;
  return badge;
}

export function createPlayerBadge(text: string): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = "pa-badge pa-player-badge";
  badge.innerHTML = `<span class="pa-badge-icon" aria-hidden="true"></span>${text}`;
  return badge;
}

export function createControlBadge(text: string): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = "pa-badge pa-control-badge";
  badge.innerHTML = `<span class="pa-control-icon" aria-hidden="true"></span>${text}`;
  return badge;
}
