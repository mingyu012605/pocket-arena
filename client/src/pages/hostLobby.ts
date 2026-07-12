import { getSocket, emitWithAck } from "../networking/socket";
import { navigate } from "../networking/router";
import type { CleanupFn, RouteContext } from "../networking/router";
import { SOCKET_EVENTS } from "../../../shared/protocol";
import type { CreateRoomSlot, PublicRoomState, RoomClosedPayload } from "../../../shared/protocol";
import type { CountdownTickPayload, GameStatePayload } from "../../../shared/protocol";
import type { HostReconnectResponse } from "../../../shared/protocol";
import { createQrCard } from "../components/qrCard";
import { createPlayerCard } from "../components/playerCard";
import { createButton } from "../components/button";
import { ControllerTestRenderer } from "../games/controller-test/renderer";
import { RacingRenderer } from "../games/racing/renderer";
import type { RacingGameStatePayload, RacingPlayerState } from "../../../shared/protocol";

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
      <p class="reconnecting-banner" id="reconnecting" hidden>Reconnecting…</p>
      <div class="lobby-footer" id="lobby-footer"></div>
    </section>
  `;

  const gridEl = container.querySelector<HTMLDivElement>("#lobby-grid")!;
  const footerEl = container.querySelector<HTMLDivElement>("#lobby-footer")!;
  const reconnectingEl = container.querySelector<HTMLParagraphElement>("#reconnecting")!;

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

  let renderer: ControllerTestRenderer | RacingRenderer | null = null;
  let rafHandle: number | null = null;
  let lastStatus: PublicRoomState["status"] | null = null;
  let lastRoom: PublicRoomState = session.room;
  let lastRacingState: RacingGameStatePayload | null = null;
  let focusedRacingPlayer: number | null = null;

  function renderLobbyFooter(): void {
    footerEl.innerHTML = "";
    footerEl.appendChild(startButton);
    footerEl.appendChild(leaveButton);
  }

  function startGameView(room: PublicRoomState): void {
    gridEl.hidden = true;
    footerEl.hidden = true;
    gameSectionEl.hidden = false;
    gameSectionEl.innerHTML = `
      <div class="countdown-overlay" id="countdown"></div>
      <div class="racing-hud" id="racing-hud" hidden></div>
    `;
    renderer = room.gameType === "racing" ? new RacingRenderer(room) : new ControllerTestRenderer(room);
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

  function playerLabel(playerNumber: number): string {
    return lastRoom.players.find((player) => player.playerNumber === playerNumber)?.nickname ?? `Player ${playerNumber}`;
  }

  function updateRacingHud(state: RacingGameStatePayload): void {
    const hud = gameSectionEl.querySelector<HTMLDivElement>("#racing-hud");
    if (!hud) return;
    const ranked = [...state.players].sort((a, b) => a.rank - b.rank);
    const leader = ranked[0] ?? null;
    const focused = ranked.find((player) => player.playerNumber === focusedRacingPlayer) ?? leader;
    hud.hidden = ranked.length === 0;
    hud.innerHTML = "";
    if (!focused) return;

    const summary = document.createElement("div");
    summary.className = "racing-hud-summary";
    const title = document.createElement("p");
    title.className = "racing-hud-title";
    title.textContent = playerLabel(focused.playerNumber);
    const telemetry = document.createElement("p");
    telemetry.className = "racing-hud-telemetry";
    telemetry.textContent = `${Math.round(focused.speed * 3.6)} km/h | ${Math.round(focused.progress)} m`;
    summary.append(title, telemetry);

    const cycleButton = createButton({
      label: "Cycle Camera",
      variant: "secondary",
      onClick: () => {
        const currentIndex = Math.max(
          0,
          ranked.findIndex((player) => player.playerNumber === (focusedRacingPlayer ?? leader?.playerNumber))
        );
        const next = ranked[(currentIndex + 1) % ranked.length];
        focusedRacingPlayer = next?.playerNumber ?? null;
        if (renderer instanceof RacingRenderer) renderer.setFocusedPlayer(focusedRacingPlayer);
        updateRacingHud(state);
      }
    });
    summary.appendChild(cycleButton);
    hud.appendChild(summary);

    const list = document.createElement("ol");
    list.className = "racing-leaderboard";
    for (const player of ranked) {
      const row = document.createElement("li");
      const focusButton = document.createElement("button");
      focusButton.type = "button";
      focusButton.className = "racing-leaderboard-row";
      if (player.playerNumber === focused.playerNumber) focusButton.classList.add("is-focused");
      focusButton.textContent = `#${player.rank} ${playerLabel(player.playerNumber)} - ${Math.round(player.speed * 3.6)} km/h`;
      focusButton.addEventListener("click", () => {
        focusedRacingPlayer = player.playerNumber;
        if (renderer instanceof RacingRenderer) renderer.setFocusedPlayer(focusedRacingPlayer);
        updateRacingHud(state);
      });
      row.appendChild(focusButton);
      list.appendChild(row);
    }
    hud.appendChild(list);
  }

  function renderResultsScreen(room: PublicRoomState): void {
    footerEl.innerHTML = "";
    const players: RacingPlayerState[] = lastRacingState?.players ?? [];
    const ranked = [...players].sort((a, b) => a.rank - b.rank);

    const panel = document.createElement("div");
    panel.className = "results-panel";
    const title = document.createElement("h2");
    title.textContent = "Results";
    panel.appendChild(title);

    const list = document.createElement("ol");
    list.className = "results-list";
    if (ranked.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "No results received yet.";
      list.appendChild(empty);
    } else {
      for (const player of ranked) {
        const row = document.createElement("li");
        const time = player.finishTime !== null ? `${(player.finishTime / 1000).toFixed(2)}s` : "DNF";
        row.textContent = `#${player.rank} - ${playerLabel(player.playerNumber)} - ${time}`;
        list.appendChild(row);
      }
    }
    panel.appendChild(list);

    const actions = document.createElement("div");
    actions.className = "results-actions";
    actions.appendChild(
      createButton({
        label: "Rematch",
        variant: "primary",
        onClick: async () => {
          await emitWithAck(SOCKET_EVENTS.GAME_END, {});
        }
      })
    );
    actions.appendChild(
      createButton({
        label: "Change Game",
        variant: "secondary",
        onClick: async () => {
          await emitWithAck(SOCKET_EVENTS.GAME_END, {});
          navigate("/host");
        }
      })
    );
    panel.appendChild(actions);
    footerEl.appendChild(panel);
    footerEl.hidden = false;
  }

  function renderRoom(room: PublicRoomState): void {
    lastRoom = room;
    if (room.status === "results") {
      const wasPlaying = lastStatus === "countdown" || lastStatus === "in-progress";
      if (wasPlaying) stopGameView();
      gridEl.hidden = true;
      gameSectionEl.hidden = true;
      reconnectingEl.hidden = true;
      renderResultsScreen(room);
      lastStatus = room.status;
      return;
    }
    footerEl.hidden = false;
    if (room.status === "host-disconnected") {
      const wasPlaying = lastStatus === "countdown" || lastStatus === "in-progress";
      if (wasPlaying) stopGameView();
      gridEl.hidden = true;
      footerEl.hidden = true;
      gameSectionEl.hidden = true;
      reconnectingEl.hidden = false;
      lastStatus = room.status;
      return;
    }
    reconnectingEl.hidden = true;

    const isPlaying = room.status === "countdown" || room.status === "in-progress";
    const wasPlaying = lastStatus === "countdown" || lastStatus === "in-progress";
    if (isPlaying && !wasPlaying) startGameView(room);
    if (!isPlaying && wasPlaying) stopGameView();
    lastStatus = room.status;

    if (room.status !== "lobby") return;

    renderLobbyFooter();
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

  emitWithAck<HostReconnectResponse>(SOCKET_EVENTS.HOST_RECONNECT, {
    roomId,
    hostToken: session.hostToken
  }).then(
    ({ room }) => renderRoom(room),
    () => {
      sessionStorage.removeItem(`pocket-arena:host:${roomId}`);
      navigate("/");
    }
  );

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
    if (payload.gameType === "controller-test" && renderer instanceof ControllerTestRenderer) {
      renderer.applyState(payload);
    } else if (payload.gameType === "racing") {
      lastRacingState = payload;
      if (renderer instanceof RacingRenderer) renderer.applyState(payload);
      updateRacingHud(payload);
    }
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
