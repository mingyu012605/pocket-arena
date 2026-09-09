import type { GameType } from "../../../shared/protocol";

export interface GameCatalogEntry {
  id: GameType;
  title: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  playable: boolean;
  successScore: number;
  icon: string;
}

export const GAME_CATALOG: GameCatalogEntry[] = [
  {
    id: "rhythm-battle",
    title: "Rhythm Battle",
    description: "Hit the beat before your rivals do.",
    minPlayers: 2,
    maxPlayers: 4,
    playable: false,
    successScore: 0,
    icon: "🎵"
  },
  {
    id: "table-tennis",
    title: "Table Tennis",
    description: "Quick reflexes, one paddle each.",
    minPlayers: 2,
    maxPlayers: 2,
    playable: false,
    successScore: 0,
    icon: "🏓"
  },
  {
    id: "bowling",
    title: "Bowling",
    description: "Line up the perfect strike.",
    minPlayers: 1,
    maxPlayers: 4,
    playable: false,
    successScore: 0,
    icon: "🎳"
  },
  {
    id: "tennis",
    title: "Tennis",
    description: "Rally it out, best of five.",
    minPlayers: 2,
    maxPlayers: 2,
    playable: false,
    successScore: 0,
    icon: "🎾"
  },
  {
    id: "racing",
    title: "Racing",
    description: "Steer with your phone like a wheel, tilt to throttle and brake — real motion control, real turning physics.",
    minPlayers: 1,
    maxPlayers: 4,
    playable: true,
    successScore: 98,
    icon: "🏎️"
  },
  {
    id: "pocket-golf",
    title: "Pocket Golf",
    description: "Swing your phone like a short golf club through Cloudshore Golf Resort.",
    minPlayers: 1,
    maxPlayers: 4,
    playable: true,
    successScore: 91,
    icon: "G"
  },
  {
    id: "sketch-relay",
    title: "Sketch Relay",
    description: "Draw, guess, and reveal hilarious chains using phones as private sketch pads.",
    minPlayers: 3,
    maxPlayers: 12,
    playable: true,
    successScore: 86,
    icon: "✏️"
  }
];
