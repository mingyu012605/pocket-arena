import type { GameCatalogEntry } from "../games/catalog";
import { createButton } from "./button";

interface LauncherMeta {
  eyebrow: string;
  title: string;
  subtitle: string;
  control: string;
  status: string;
  art: string;
}

const META: Record<string, LauncherMeta> = {
  racing: {
    eyebrow: "Featured",
    title: "Pocket Formula",
    subtitle: "Harbor City GP",
    control: "Motion steering",
    status: "Available now",
    art: "formula"
  },
  "rhythm-battle": {
    eyebrow: "Party",
    title: "Rhythm Battle",
    subtitle: "Beat pressure arena",
    control: "Touch + motion",
    status: "Coming soon",
    art: "rhythm"
  },
  "table-tennis": {
    eyebrow: "Duel",
    title: "Table Tennis",
    subtitle: "Quick reaction rallies",
    control: "Motion paddle",
    status: "Coming soon",
    art: "paddle"
  },
  bowling: {
    eyebrow: "Precision",
    title: "Bowling",
    subtitle: "Motion throw lanes",
    control: "Motion throw",
    status: "Coming soon",
    art: "bowling"
  },
  tennis: {
    eyebrow: "Duel",
    title: "Tennis",
    subtitle: "Full-court rallies",
    control: "Motion swing",
    status: "Coming soon",
    art: "tennis"
  },
  "controller-test": {
    eyebrow: "Developer",
    title: "Controller Test",
    subtitle: "Input proving ground",
    control: "Touch controls",
    status: "Developer mode",
    art: "controller"
  }
};

function playersLabel(entry: GameCatalogEntry): string {
  return entry.minPlayers === entry.maxPlayers ? `${entry.maxPlayers} Players` : `${entry.minPlayers}-${entry.maxPlayers} Players`;
}

function metaFor(entry: GameCatalogEntry): LauncherMeta {
  return META[entry.id] ?? {
    eyebrow: "Arena",
    title: entry.title,
    subtitle: entry.description,
    control: "Phone controller",
    status: entry.playable ? "Available now" : "Coming soon",
    art: "controller"
  };
}

function createArtwork(kind: string): HTMLDivElement {
  const art = document.createElement("div");
  art.className = `launcher-art launcher-art-${kind}`;
  art.innerHTML = `
    <span class="art-orbit art-orbit-a"></span>
    <span class="art-orbit art-orbit-b"></span>
    <span class="art-shape art-shape-a"></span>
    <span class="art-shape art-shape-b"></span>
    <span class="art-shape art-shape-c"></span>
  `;
  return art;
}

function createBadge(text: string, tone: "hot" | "cool" | "muted" = "cool"): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = `launcher-badge launcher-badge-${tone}`;
  badge.textContent = text;
  return badge;
}

export function createGameLauncherHeader(): HTMLElement {
  const header = document.createElement("header");
  header.className = "launcher-header";
  header.innerHTML = `
    <div>
      <p class="launcher-kicker">Pocket Arena</p>
      <h1>Turn Every Phone Into a Controller</h1>
    </div>
    <div class="launcher-system">
      <span class="launcher-live-dot"></span>
      <span>Local Host Ready</span>
      <button type="button" aria-label="Settings" title="Settings"></button>
      <button type="button" aria-label="Sound" title="Sound"></button>
    </div>
  `;
  return header;
}

export function createFeaturedGameHero(entry: GameCatalogEntry, onPlay: () => void): HTMLElement {
  const meta = metaFor(entry);
  const hero = document.createElement("article");
  hero.className = "game-card launcher-feature";
  hero.appendChild(createArtwork(meta.art));

  const content = document.createElement("div");
  content.className = "launcher-feature-copy";
  content.innerHTML = `
    <p class="launcher-section-label">${meta.eyebrow}</p>
    <h2>${meta.title}</h2>
    <h3>${meta.subtitle}</h3>
    <p>${entry.description}</p>
  `;

  const badges = document.createElement("div");
  badges.className = "launcher-badges";
  badges.append(createBadge(playersLabel(entry), "cool"), createBadge(meta.control, "cool"), createBadge(meta.status, "hot"));
  content.appendChild(badges);

  const action = createButton({ label: "Play Now", variant: "primary", onClick: onPlay });
  action.classList.add("launcher-hero-action");
  content.appendChild(action);
  hero.appendChild(content);
  return hero;
}

export function createLauncherGameCard(entry: GameCatalogEntry, onPlay: () => void): HTMLElement {
  const meta = metaFor(entry);
  const card = document.createElement("article");
  card.className = `game-card launcher-game-card${entry.playable ? " is-playable" : " is-locked"}`;
  card.tabIndex = 0;

  const art = createArtwork(meta.art);
  const statusTone = entry.playable ? (entry.id === "controller-test" ? "muted" : "hot") : "muted";
  const status = createBadge(meta.status, statusTone);
  status.classList.add("launcher-status-badge");

  const body = document.createElement("div");
  body.className = "launcher-game-card-body";
  body.innerHTML = `
    <p class="launcher-card-eyebrow">${meta.eyebrow}</p>
    <h3>${meta.title}</h3>
    <p>${meta.subtitle}</p>
  `;

  const facts = document.createElement("div");
  facts.className = "launcher-card-facts";
  facts.append(createBadge(playersLabel(entry), "cool"), createBadge(meta.control, "cool"));
  body.appendChild(facts);

  card.append(art, status, body);
  if (entry.playable) {
    const action = createButton({ label: "Play", variant: "secondary", onClick: onPlay });
    action.classList.add("launcher-card-action");
    card.appendChild(action);
  }
  return card;
}
