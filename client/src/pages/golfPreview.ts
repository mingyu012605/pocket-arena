import type { CleanupFn, RouteContext } from "../networking/router";
import type { GameRenderer } from "../games/gameRenderer";
import type { PocketGolfGameStatePayload, PublicRoomState } from "../../../shared/protocol";

const previewRoom: PublicRoomState = {
  id: "GOLF0",
  gameType: "pocket-golf",
  maxPlayers: 1,
  status: "in-progress",
  roundId: "preview-round",
  countdownEndsAt: null,
  players: [
    {
      playerNumber: 1,
      nickname: "Player 1",
      color: "#22d3ee",
      connected: true,
      ready: true,
      controllerType: "golf-swing"
    }
  ]
};

const previewState: PocketGolfGameStatePayload = {
  gameType: "pocket-golf",
  roundId: "preview-round",
  phase: "shot-setup",
  turnId: "preview-turn",
  holeNumber: 1,
  holeName: "Warmup Garden",
  holeDifficulty: "Easy",
  par: 3,
  holeDistance: 112,
  activePlayerNumber: 1,
  aimDegrees: 0,
  clubId: "7-iron",
  recommendedClubId: "7-iron",
  wind: { speed: 2, directionDegrees: 40 },
  elevationMetres: 0,
  players: [
    {
      playerNumber: 1,
      displayName: "Player 1",
      color: "#22d3ee",
      strokes: 0,
      scoreRelativeToPar: 0,
      distanceToHole: 112,
      lie: "tee",
      finished: false,
      active: true,
      ball: { x: 0, y: 0.042, z: 0 }
    }
  ],
  lastShot: null,
  clubPose: {
    roundId: "preview-round",
    turnId: "preview-turn",
    playerNumber: 1,
    timestamp: Date.now(),
    aimDegrees: 14,
    pitch: -0.4,
    roll: 0.15,
    yaw: 0.2,
    swing: -0.7,
    velocity: 0.18,
    armed: true,
    handedness: "right",
    source: "orientation"
  }
};

export function renderGolfPreviewPage({ container }: RouteContext): CleanupFn {
  container.innerHTML = `<section class="game-section golf-preview-page"><p class="race-loading">Loading Golf Preview...</p></section>`;
  const mount = container.querySelector<HTMLElement>(".golf-preview-page")!;
  let renderer: GameRenderer<PocketGolfGameStatePayload> | null = null;
  let raf = 0;
  let disposed = false;
  void import("../games/pocket-golf/renderer").then(({ PocketGolfRenderer }) => {
    if (disposed) return;
    renderer = new PocketGolfRenderer(previewRoom);
    renderer.mount(mount);
    renderer.applyState(previewState);
    const loop = (timestamp: number) => {
      renderer?.render(timestamp);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  });
  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    renderer?.destroy();
  };
}
