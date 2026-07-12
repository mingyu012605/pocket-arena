import type { InternalRoom, RacingCarState, RacingGameState } from "../types";

export const DEFAULT_TRACK_ID = "test-oval";

export function createRacingGameState(room: InternalRoom): RacingGameState {
  const cars = new Map<number, RacingCarState>();
  for (const player of room.players) {
    cars.set(player.playerNumber, {
      progress: 0,
      lateralOffset: 0,
      headingError: 0,
      speed: 0,
      yawRate: 0,
      steering: 0,
      throttle: 0,
      brake: 0,
      lastInputAt: Date.now(),
      lastSequence: -1,
      rank: player.playerNumber,
      lap: 1,
      finished: false,
      finishTime: null
    });
  }
  return {
    gameType: "racing",
    trackId: DEFAULT_TRACK_ID,
    cars,
    finishOrder: [],
    focusedPlayerNumber: room.players[0]?.playerNumber ?? null,
    startedAt: null,
    endedAt: null
  };
}
