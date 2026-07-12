import { getSocket, emitWithAck } from "../networking/socket";
import { navigate } from "../networking/router";
import type { CleanupFn, RouteContext } from "../networking/router";
import { SOCKET_EVENTS } from "../../../shared/protocol";
import type { CreateRoomSlot, PublicRoomState, RoomClosedPayload } from "../../../shared/protocol";
import type { CountdownTickPayload, GameStatePayload } from "../../../shared/protocol";
import { createQrCard } from "../components/qrCard";
import { createPlayerCard } from "../components/playerCard";
import { createButton } from "../components/button";
import { ControllerTestRenderer } from "../games/controller-test/renderer";

interface StoredHostSession {
  hostToken: string;
  slots: CreateRoomSlot[];
  room: PublicRoomState;
}

export function renderHostLobbyPage({ container, params }: RouteContext): CleanupFn | void {
  const roomId = params.roomCode!;
  const raw = sessionStorage.getItem(`pocket-arena:host:${roomId}`);
  if (!raw) {
    navigate("/host");
    return;
  }
  const session: StoredHostSession = JSON.parse(raw);

  container.innerHTML = `
    <section class="page-section">
      <header class="lobby-header">
        <div>
          <p class="eyebrow">ROOM CODE</p>
          <h1 class="room-code">${roomId}</h1>
        </div>
      </header>
      <div class="lobby-grid" id="lobby-grid"></div>
      <div class="lobby-footer" id="lobby-footer"></div>
    </section>
  `;

  const gridEl = container.querySelector<HTMLDivElement>("#lobby-grid")!;
  const footerEl = container.querySelector<HTMLDivElement>("#lobby-footer")!;

  const startButton = createButton({
    label: "Start Game",
    variant: "primary",
    disabled: true,
    onClick: async () => {
      try {
        await emitWithAck(SOCKET_EVENTS.GAME_START, {});
      } catch (err) {
        alert((err as { message?: string }).message ?? "Could not start the game.");
      }
    }
  });
  const leaveButton = createButton({
    label: "Leave Room",
    variant: "danger",
    onClick: async () => {
      await emitWithAck(SOCKET_EVENTS.HOST_LEAVE_ROOM, {});
      sessionStorage.removeItem(`pocket-arena:host:${roomId}`);
      navigate("/");
    }
  });
  footerEl.appendChild(startButton);
  footerEl.appendChild(leaveButton);

  const gameSectionEl = document.createElement("div");
  gameSectionEl.className = "game-section";
  gameSectionEl.hidden = true;
  container.querySelector(".page-section")!.appendChild(gameSectionEl);

  let renderer: ControllerTestRenderer | null = null;
  let rafHandle: number | null = null;
  let lastStatus: PublicRoomState["status"] | null = null;

  function startGameView(room: PublicRoomState): void {
    gridEl.hidden = true;
    footerEl.hidden = true;
    gameSectionEl.hidden = false;
    gameSectionEl.innerHTML = `<div class="countdown-overlay" id="countdown"></div>`;
    renderer = new ControllerTestRenderer(room);
    renderer.mount(gameSectionEl);
    const loop = (t: number) => {
      renderer?.render(t);
      rafHandle = requestAnimationFrame(loop);
    };
    rafHandle = requestAnimationFrame(loop);
  }

  function stopGameView(): void {
    if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    rafHandle = null;
    renderer?.destroy();
    renderer = null;
    gameSectionEl.hidden = true;
    gridEl.hidden = false;
    footerEl.hidden = false;
  }

  function renderRoom(room: PublicRoomState): void {
    const isPlaying = room.status === "countdown" || room.status === "in-progress";
    const wasPlaying = lastStatus === "countdown" || lastStatus === "in-progress";
    if (isPlaying && !wasPlaying) startGameView(room);
    if (!isPlaying && wasPlaying) stopGameView();
    lastStatus = room.status;

    if (room.status !== "lobby") return;

    gridEl.innerHTML = "";
    for (const player of room.players) {
      const slot = session.slots.find((s) => s.playerNumber === player.playerNumber);
      const wrapper = document.createElement("div");
      wrapper.className = "lobby-slot";
      wrapper.style.setProperty("--player-color", player.color);
      if (slot) wrapper.appendChild(createQrCard(slot.playerNumber, slot.qrDataUrl, player.color));
      wrapper.appendChild(createPlayerCard(player));
      gridEl.appendChild(wrapper);
    }
    const allReady = room.players.length === room.maxPlayers && room.players.every((p) => p.connected && p.ready);
    startButton.disabled = !allReady;
  }

  renderRoom(session.room);

  const socket = getSocket();
  const onRoomState = (room: PublicRoomState) => renderRoom(room);
  const onRoomClosed = (payload: RoomClosedPayload) => {
    alert(payload.reason);
    sessionStorage.removeItem(`pocket-arena:host:${roomId}`);
    navigate("/");
  };
  const onCountdownTick = (payload: CountdownTickPayload) => {
    const el = document.getElementById("countdown");
    if (el) el.textContent = String(payload.value);
  };
  const onGameState = (payload: GameStatePayload) => {
    renderer?.applyState(payload);
  };
  socket.on(SOCKET_EVENTS.GAME_COUNTDOWN_TICK, onCountdownTick);
  socket.on(SOCKET_EVENTS.GAME_STATE, onGameState);
  socket.on(SOCKET_EVENTS.ROOM_STATE, onRoomState);
  socket.on(SOCKET_EVENTS.ROOM_CLOSED, onRoomClosed);

  return () => {
    socket.off(SOCKET_EVENTS.ROOM_STATE, onRoomState);
    socket.off(SOCKET_EVENTS.ROOM_CLOSED, onRoomClosed);
    socket.off(SOCKET_EVENTS.GAME_COUNTDOWN_TICK, onCountdownTick);
    socket.off(SOCKET_EVENTS.GAME_STATE, onGameState);
    stopGameView();
  };
}
