import type { GameType } from "../../../shared/protocol";

export interface GameCatalogEntry {
  id: GameType;
  title: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  playable: boolean;
  icon: string;
}

export const GAME_CATALOG: GameCatalogEntry[] = [
  {
    id: "controller-test",
    title: "Controller Test",
    description: "Jump and dodge with your phone as a controller — the proving ground for every game to come.",
    minPlayers: 1,
    maxPlayers: 4,
    playable: true,
    icon: "🎮"
  },
  {
    id: "rhythm-battle",
    title: "Rhythm Battle",
    description: "Hit the beat before your rivals do.",
    minPlayers: 2,
    maxPlayers: 4,
    playable: false,
    icon: "🎵"
  },
  {
    id: "table-tennis",
    title: "Table Tennis",
    description: "Quick reflexes, one paddle each.",
    minPlayers: 2,
    maxPlayers: 2,
    playable: false,
    icon: "🏓"
  },
  {
    id: "bowling",
    title: "Bowling",
    description: "Line up the perfect strike.",
    minPlayers: 1,
    maxPlayers: 4,
    playable: false,
    icon: "🎳"
  },
  {
    id: "tennis",
    title: "Tennis",
    description: "Rally it out, best of five.",
    minPlayers: 2,
    maxPlayers: 2,
    playable: false,
    icon: "🎾"
  },
  {
    id: "racing",
    title: "Racing",
    description: "Steer with your phone like a wheel, tilt to throttle and brake — real motion control, real turning physics.",
    minPlayers: 1,
    maxPlayers: 4,
    playable: true,
    icon: "🏎️"
  }
];
