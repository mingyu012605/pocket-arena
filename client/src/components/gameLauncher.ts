import type { GameCatalogEntry } from "../games/catalog";
import type { GameType } from "../../../shared/protocol";
import { createSportArtwork } from "./launcherArtwork";
import { createControlBadge, createPlayerBadge, createStatusBadge } from "./launcherBadges";
import { createPocketArenaLogo } from "./pocketArenaLogo";

export interface LauncherGameView {
  id: GameType;
  title: string;
  heroTitle: string;
  heroAccent: string;
  kicker: string;
  description: string;
  players: string;
  control: string;
  status: "Available Now" | "Coming Soon";
  playable: boolean;
  artwork: GameType;
}

const GAME_INFO: Record<GameType, Omit<LauncherGameView, "playable">> = {
  racing: {
    id: "racing",
    title: "Racing Rally",
    heroTitle: "Racing",
    heroAccent: "Rally!",
    kicker: "Featured Game",
    description: "Tilt, steer, and zoom to the finish!",
    players: "1-4 Players",
    control: "Motion Steering",
    status: "Available Now",
    artwork: "racing"
  },
  "sketch-relay": {
    id: "sketch-relay",
    title: "Sketch Relay",
    heroTitle: "Sketch",
    heroAccent: "Relay!",
    kicker: "Party Drawing",
    description: "Secret prompts become drawings, guesses, and ridiculous reveal chains.",
    players: "3-12 Players",
    control: "Phone Drawing",
    status: "Available Now",
    artwork: "sketch-relay"
  },
  "table-tennis": {
    id: "table-tennis",
    title: "Table Tennis",
    heroTitle: "Table Tennis",
    heroAccent: "Party!",
    kicker: "Quick Rally",
    description: "Quick swings and epic rallies!",
    players: "2 Players",
    control: "Motion Paddle",
    status: "Coming Soon",
    artwork: "table-tennis"
  },
  bowling: {
    id: "bowling",
    title: "Bowling",
    heroTitle: "Bowling",
    heroAccent: "Blast!",
    kicker: "Party Lane",
    description: "Strike up some friendly competition!",
    players: "1-4 Players",
    control: "Motion Throw",
    status: "Coming Soon",
    artwork: "bowling"
  },
  tennis: {
    id: "tennis",
    title: "Tennis",
    heroTitle: "Tennis",
    heroAccent: "Smash!",
    kicker: "Court Game",
    description: "Smash, volley, and score big!",
    players: "2 Players",
    control: "Motion Swing",
    status: "Coming Soon",
    artwork: "tennis"
  },
  "rhythm-battle": {
    id: "rhythm-battle",
    title: "Rhythm Battle",
    heroTitle: "Rhythm",
    heroAccent: "Battle!",
    kicker: "Music Sport",
    description: "Tap, move, and feel the beat!",
    players: "2-4 Players",
    control: "Touch + Motion",
    status: "Coming Soon",
    artwork: "rhythm-battle"
  },
  "controller-test": {
    id: "controller-test",
    title: "Controller Test",
    heroTitle: "Controller",
    heroAccent: "Test!",
    kicker: "Practice",
    description: "Check your connection and get set!",
    players: "1-4 Players",
    control: "Touch Controls",
    status: "Available Now",
    artwork: "controller-test"
  }
};

function createIcon(
  name: "home" | "games" | "play" | "settings" | "sound" | "signal" | "phone" | "trophy" | "friends" | "help" | "gift" | "star" | "arrow"
): string {
  const paths = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M10 20v-6h4v6"/>',
    games:
      '<rect x="3.5" y="8" width="17" height="9.5" rx="4"/><path d="M8 12h4"/><path d="M10 10v4"/><circle cx="16" cy="12" r="1"/><circle cx="18.5" cy="14" r="1"/>',
    play: '<path d="M8 5.5v13l11-6.5z"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.8-1L14.4 3H9.6L9.2 6.1a7 7 0 0 0-1.8 1L5 6.1l-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.8 1l.4 3.1h4.8l.4-3.1a7 7 0 0 0 1.8-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z"/>',
    sound: '<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16 9c1 1.7 1 4.3 0 6"/><path d="M18.5 7c2 2.7 2 7.3 0 10"/>',
    signal: '<path d="M4 17h3"/><path d="M10 17h3V11h-3z"/><path d="M16 17h3V7h-3z"/>',
    phone: '<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M11 18h2"/>',
    trophy: '<path d="M8 4h8v4a4 4 0 0 1-8 0z"/><path d="M6 6H4a3 3 0 0 0 3 3"/><path d="M18 6h2a3 3 0 0 1-3 3"/><path d="M12 12v5"/><path d="M8 21h8"/><path d="M9 17h6"/>',
    friends: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M14 15.5a4.5 4.5 0 0 1 6.5 3.5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.6 2.1c-.8.4-1.4 1-1.4 2.1"/><path d="M12 17h.01"/>',
    gift: '<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M4 13h16"/><path d="M12 9v11"/><path d="M12 9H8.5A2.5 2.5 0 1 1 12 5.5z"/><path d="M12 9h3.5A2.5 2.5 0 1 0 12 5.5z"/>',
    star: '<path d="m12 3 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7L6.8 19l1-5.8-4.2-4.1 5.8-.8z"/>',
    arrow: '<path d="M9 18l6-6-6-6"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

function playableMap(catalog: GameCatalogEntry[]): Map<GameType, boolean> {
  return new Map(catalog.map((entry) => [entry.id, entry.playable]));
}

export function createLauncherGameViews(catalog: GameCatalogEntry[]): LauncherGameView[] {
  const playables = playableMap(catalog);
  const order: GameType[] = ["racing", "sketch-relay", "table-tennis", "bowling", "tennis", "rhythm-battle", "controller-test"];
  return order.map((id) => ({ ...GAME_INFO[id], playable: playables.get(id) ?? false }));
}

export function createGameLauncherHeader(): HTMLElement {
  const header = document.createElement("header");
  header.className = "pa-header";
  header.appendChild(createPocketArenaLogo());

  const nav = document.createElement("nav");
  nav.className = "pa-nav";
  nav.setAttribute("aria-label", "Launcher navigation");
  nav.innerHTML = `
    <a class="is-active" href="/host" data-link>${createIcon("home")}Home</a>
    <a href="/host" data-link>${createIcon("games")}Games</a>
    <a href="#how-to-play">${createIcon("trophy")}Challenges</a>
    <a href="#how-to-play">${createIcon("friends")}Friends</a>
  `;

  const tools = document.createElement("div");
  tools.className = "pa-header-tools";
  tools.innerHTML = `
    <a class="pa-help-pill" href="#how-to-play">${createIcon("help")}How to Play</a>
    <button type="button" aria-label="Player profile" class="pa-profile"><span>PA</span></button>
    <button type="button" aria-label="Open profile menu" class="pa-profile-menu">${createIcon("arrow")}</button>
  `;

  header.append(nav, tools);
  return header;
}

export interface FeaturedCarouselResult {
  element: HTMLElement;
  cleanup: () => void;
}

export function createFeaturedCarousel(slides: LauncherGameView[], onPlay: (id: GameType) => void): FeaturedCarouselResult {
  const hero = document.createElement("section");
  hero.className = "pa-hero";
  hero.setAttribute("aria-label", "Featured games");

  const preferredOrder: GameType[] = ["sketch-relay", "table-tennis", "racing"];
  const slidesToShow = preferredOrder
    .map((id) => slides.find((slide) => slide.id === id))
    .filter((slide): slide is LauncherGameView => Boolean(slide));
  if (slidesToShow.length === 0) {
    slidesToShow.push(...slides.slice(0, 1));
  }
  let active = 0;
  let hover = false;
  let interval: number | undefined;

  const render = (): void => {
    const slide = slidesToShow[active];
    if (!slide) return;
    hero.innerHTML = `
      <div class="pa-confetti" aria-hidden="true">
        <i></i><i></i><i></i><i></i><i></i><i></i>
      </div>
      <div class="pa-hero-copy">
        <p class="pa-kicker">${createIcon("star")}${slide.id === "table-tennis" ? "Featured Game" : slide.kicker}</p>
        <h1><span>${slide.heroTitle}</span><em>${slide.heroAccent}</em></h1>
        <p>${slide.description} Fast living-room sports for phones, friends, and one shared screen.</p>
        <div class="pa-hero-badges"></div>
        <div class="pa-hero-actions"></div>
      </div>
      <div class="pa-hero-art-shell"></div>
      <div class="pa-hero-dots" role="tablist" aria-label="Featured game slides"></div>
      <div class="pa-hero-wave" aria-hidden="true"></div>
    `;

    const badgeSlot = hero.querySelector<HTMLDivElement>(".pa-hero-badges")!;
    badgeSlot.append(createPlayerBadge(slide.players), createControlBadge(slide.control), createStatusBadge(slide.status, slide.playable));

    const actions = hero.querySelector<HTMLDivElement>(".pa-hero-actions")!;
    const play = document.createElement("button");
    play.className = "pa-play-button";
    play.type = "button";
    play.disabled = !slide.playable;
    play.innerHTML = `${createIcon("play")} ${slide.playable ? "Play Now" : "Coming Soon"}`;
    play.addEventListener("click", () => {
      if (slide.playable) onPlay(slide.id);
    });
    actions.appendChild(play);

    hero.querySelector<HTMLDivElement>(".pa-hero-art-shell")!.appendChild(createSportArtwork(slide.id === "table-tennis" ? "hero-table-tennis" : slide.artwork, false));

    const dots = hero.querySelector<HTMLDivElement>(".pa-hero-dots")!;
    slidesToShow.forEach((item, index) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = index === active ? "is-active" : "";
      dot.setAttribute("aria-label", `Show ${item.title}`);
      dot.setAttribute("aria-selected", String(index === active));
      dot.addEventListener("click", () => {
        active = index;
        render();
      });
      dots.appendChild(dot);
    });
  };

  const canAnimate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (canAnimate) {
    interval = window.setInterval(() => {
      if (hover) return;
      active = (active + 1) % slidesToShow.length;
      render();
    }, 7000);
  }
  hero.addEventListener("mouseenter", () => {
    hover = true;
  });
  hero.addEventListener("mouseleave", () => {
    hover = false;
  });

  render();
  return {
    element: hero,
    cleanup: () => {
      if (interval !== undefined) window.clearInterval(interval);
    }
  };
}

export function createLauncherGameCard(game: LauncherGameView, onPlay: (id: GameType) => void): HTMLElement {
  const card = document.createElement("article");
  card.className = `pa-game-card ${game.playable ? "is-playable" : "is-coming-soon"}`;
  card.tabIndex = 0;
  if (game.playable) {
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Play ${game.title}`);
  }
  card.innerHTML = `
    <div class="pa-card-art"></div>
    <div class="pa-card-body">
      <div class="pa-sport-icon" aria-hidden="true">${createIcon(game.id === "controller-test" ? "phone" : "games")}</div>
      <p class="pa-card-kicker">${game.kicker}</p>
      <h3>${game.title}</h3>
      <p>${game.description}</p>
      <div class="pa-card-badges"></div>
      <span class="pa-card-phone" aria-hidden="true">${createIcon("phone")}</span>
      <div class="pa-card-actions"></div>
    </div>
  `;
  const artSlot = card.querySelector<HTMLDivElement>(".pa-card-art")!;
  artSlot.append(createSportArtwork(game.artwork, true), createStatusBadge(game.status, game.playable));

  const badges = card.querySelector<HTMLDivElement>(".pa-card-badges")!;
  badges.append(createPlayerBadge(game.players), createControlBadge(game.control));

  if (game.playable) {
    const play = document.createElement("button");
    play.type = "button";
    play.className = "pa-card-play";
    play.innerHTML = `${createIcon("play")}Play`;
    play.addEventListener("click", (event) => {
      event.stopPropagation();
      onPlay(game.id);
    });
    card.querySelector<HTMLDivElement>(".pa-card-actions")!.appendChild(play);

    card.addEventListener("click", () => {
      onPlay(game.id);
    });
  }

  card.addEventListener("keydown", (event) => {
    if (!game.playable || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onPlay(game.id);
  });
  return card;
}

export function createGameGrid(games: LauncherGameView[], onPlay: (id: GameType) => void): HTMLElement {
  const section = document.createElement("section");
  section.className = "pa-games-section";
  section.innerHTML = `
    <div class="pa-section-heading" id="how-to-play">
      <div>
        <p>Choose a sport, scan a phone, and jump in.</p>
        <h2>Pick a Game & Jump In!</h2>
      </div>
      <button type="button" class="pa-view-all">View All Games ${createIcon("arrow")}</button>
    </div>
    <div class="pa-game-row"></div>
  `;
  const row = section.querySelector<HTMLDivElement>(".pa-game-row")!;
  games.forEach((game) => row.appendChild(createLauncherGameCard(game, onPlay)));
  return section;
}

const ASSET_CREDITS: Array<{ name: string; creator: string; license: string }> = [
  { name: "Racing Kit (car, grandstand, flags, trees, light posts)", creator: "Kenney (kenney.nl)", license: "CC0 1.0" },
  { name: "Racing normal/detail maps", creator: "@pmndrs/assets package", license: "CC0 1.0" }
];

function createAssetCreditsDialog(): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "pa-credits-dialog";
  dialog.innerHTML = `
    <h2>Asset Credits</h2>
    <p>Pocket Arena Racing uses these third-party assets. Full details, sources, and licenses are in <code>THIRD_PARTY_ASSETS.md</code>.</p>
    <ul class="pa-credits-list">
      ${ASSET_CREDITS.map((asset) => `<li><strong>${asset.name}</strong><span>${asset.creator} - ${asset.license}</span></li>`).join("")}
    </ul>
    <button type="button" class="btn" data-close>Close</button>
  `;
  dialog.querySelector<HTMLButtonElement>("[data-close]")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  return dialog;
}

export function createLauncherStatusBar(): HTMLElement {
  const bar = document.createElement("footer");
  bar.className = "pa-status-bar";
  bar.innerHTML = `
    <span class="pa-status-item"><i class="pa-status-icon pa-status-green">${createIcon("signal")}</i><strong>All systems go!</strong><small>Good connection</small></span>
    <span class="pa-status-item"><i class="pa-status-icon pa-status-pink">${createIcon("gift")}</i><strong>Daily Bonus</strong><small>Claim your reward!</small></span>
    <span class="pa-status-item"><i class="pa-status-icon pa-status-blue">${createIcon("friends")}</i><strong>Invite Friends</strong><small>More friends, more fun!</small></span>
    <span class="pa-status-item pa-xp"><i class="pa-status-icon pa-status-yellow">12</i><strong>Arena Rookie</strong><span class="pa-xp-track"><b></b></span><small>1,250 / 2,000 XP</small></span>
    <button type="button" aria-label="Asset Credits" data-credits-trigger>${createIcon("settings")}</button>
  `;
  const dialog = createAssetCreditsDialog();
  bar.appendChild(dialog);
  bar.querySelector<HTMLButtonElement>("[data-credits-trigger]")!.addEventListener("click", () => dialog.showModal());
  return bar;
}
