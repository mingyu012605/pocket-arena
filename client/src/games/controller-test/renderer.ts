import type { GameRenderer } from "../gameRenderer";
import { ARENA } from "../../../../shared/protocol";
import type { GameStatePayload, PublicRoomState } from "../../../../shared/protocol";

interface Snapshot {
  time: number;
  players: Map<number, { x: number; y: number }>;
}

export class ControllerTestRenderer implements GameRenderer<GameStatePayload> {
  // Server ticks at 20Hz (50ms). Rendering `now - RENDER_DELAY_MS` keeps the
  // render time inside the [prev.time, next.time] window in steady state, so
  // interpolate() blends between two known snapshots instead of racing ahead
  // of the latest one (see amendment note in the plan for the bug this fixes).
  private static readonly RENDER_DELAY_MS = 60;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private snapshots: Snapshot[] = [];
  private colors = new Map<number, string>();

  constructor(room: PublicRoomState) {
    for (const player of room.players) this.colors.set(player.playerNumber, player.color);
  }

  mount(container: HTMLElement): void {
    this.canvas = document.createElement("canvas");
    this.canvas.width = ARENA.width;
    this.canvas.height = ARENA.groundY + 60;
    this.canvas.className = "game-canvas";
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
  }

  applyState(state: GameStatePayload): void {
    const players = new Map(state.players.map((p) => [p.playerNumber, { x: p.x, y: p.y }]));
    this.snapshots.push({ time: performance.now(), players });
    if (this.snapshots.length > 2) this.snapshots.shift();
  }

  render(_timestamp: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "#0b0f1e";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "#232a45";
    ctx.fillRect(0, ARENA.groundY + 24, this.canvas.width, 4);

    for (const [playerNumber, pos] of this.interpolate()) {
      ctx.beginPath();
      ctx.fillStyle = this.colors.get(playerNumber) ?? "#22d3ee";
      ctx.arc(pos.x, pos.y, ARENA.playerRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private interpolate(): Map<number, { x: number; y: number }> {
    if (this.snapshots.length === 0) return new Map();
    if (this.snapshots.length === 1) return this.snapshots[0]!.players;
    const [prev, next] = this.snapshots as [Snapshot, Snapshot];
    const renderTime = performance.now() - ControllerTestRenderer.RENDER_DELAY_MS;
    const span = next.time - prev.time || 1;
    const t = Math.min(1, Math.max(0, (renderTime - prev.time) / span));
    const result = new Map<number, { x: number; y: number }>();
    for (const [playerNumber, nextPos] of next.players) {
      const prevPos = prev.players.get(playerNumber) ?? nextPos;
      result.set(playerNumber, {
        x: prevPos.x + (nextPos.x - prevPos.x) * t,
        y: prevPos.y + (nextPos.y - prevPos.y) * t
      });
    }
    return result;
  }

  destroy(): void {
    this.canvas?.remove();
    this.canvas = null;
    this.ctx = null;
  }
}
