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
import { TEST_OVAL_TRACK } from "../../../shared/racingTrack";
import type { RacingGameStatePayload, RacingPlayerState } from "../../../shared/protocol";
import type { RacingRenderer } from "../games/racing/renderer";

type MountedRenderer = ControllerTestRenderer | RacingRenderer;

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

  const pageSectionEl = container.querySelector<HTMLElement>(".page-section")!;
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

  let renderer: MountedRenderer | null = null;
  let rafHandle: number | null = null;
  let gameViewGeneration = 0;
  let lastStatus: PublicRoomState["status"] | null = null;
  let lastRoom: PublicRoomState = session.room;
  let lastRacingState: RacingGameStatePayload | null = null;
  let focusedRacingPlayer: number | null = null;
  let racingCameraMode = "chase";
  let racingRendererControls: RacingRenderer | null = null;
  let lastRacingHudAt = 0;

  function renderLobbyFooter(): void {
    footerEl.innerHTML = "";
    footerEl.appendChild(startButton);
    footerEl.appendChild(leaveButton);
  }

  async function startGameView(room: PublicRoomState): Promise<void> {
    const generation = ++gameViewGeneration;
    pageSectionEl.classList.add("is-game-active");
    gridEl.hidden = true;
    footerEl.hidden = true;
    gameSectionEl.hidden = false;
    gameSectionEl.classList.toggle("race-viewport", room.gameType === "racing");
    gameSectionEl.innerHTML = `
      <div class="countdown-overlay" id="countdown"></div>
      <div class="racing-hud" id="racing-hud" hidden></div>
      <div class="race-results-overlay" id="race-results-overlay" hidden></div>
      <p class="race-loading" id="race-loading" hidden>Loading Racing...</p>
      <p class="race-error" id="race-error" hidden></p>
    `;
    const loadingEl = gameSectionEl.querySelector<HTMLParagraphElement>("#race-loading");
    const errorEl = gameSectionEl.querySelector<HTMLParagraphElement>("#race-error");
    if (room.gameType === "racing") loadingEl!.hidden = false;
    try {
      if (room.gameType === "racing") {
        const { RacingRenderer: LoadedRacingRenderer } = await import("../games/racing/renderer");
        if (generation !== gameViewGeneration) return;
        const racingRenderer = new LoadedRacingRenderer(room);
        renderer = racingRenderer;
        racingRendererControls = racingRenderer;
      } else {
        renderer = new ControllerTestRenderer(room);
        racingRendererControls = null;
      }
    } catch (err) {
      if (generation !== gameViewGeneration) return;
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = "Racing failed to load. Refresh the host screen and try again.";
      }
      console.error("Failed to load racing renderer", err);
      return;
    } finally {
      if (generation === gameViewGeneration && loadingEl) loadingEl.hidden = true;
    }
    if (generation !== gameViewGeneration || !renderer) return;
    renderer.mount(gameSectionEl);
    if (racingRendererControls && lastRacingState) {
      racingRendererControls.applyState(lastRacingState);
      updateRacingHud(lastRacingState);
    }
    const loop = (t: number) => {
      renderer?.render(t);
      rafHandle = requestAnimationFrame(loop);
    };
    rafHandle = requestAnimationFrame(loop);
  }

  function stopGameView(): void {
    gameViewGeneration += 1;
    if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    rafHandle = null;
    renderer?.destroy();
    renderer = null;
    racingRendererControls = null;
    pageSectionEl.classList.remove("is-game-active");
    gameSectionEl.classList.remove("race-viewport");
    gameSectionEl.hidden = true;
    gridEl.hidden = false;
    footerEl.hidden = false;
  }

  function playerLabel(playerNumber: number): string {
    return lastRoom.players.find((player) => player.playerNumber === playerNumber)?.nickname ?? `Player ${playerNumber}`;
  }

  function updateRacingHud(state: RacingGameStatePayload): void {
    const now = performance.now();
    if (state.raceStatus === "racing" && now - lastRacingHudAt < 250) return;
    lastRacingHudAt = now;
    const hud = gameSectionEl.querySelector<HTMLDivElement>("#racing-hud");
    if (!hud) return;
    const ranked = [...state.players].sort((a, b) => a.rank - b.rank);
    const leader = ranked[0] ?? null;
    const focused = ranked.find((player) => player.playerNumber === focusedRacingPlayer) ?? leader;
    hud.hidden = ranked.length === 0;
    hud.innerHTML = "";
    if (!focused) return;
    const roomPlayer = lastRoom.players.find((player) => player.playerNumber === focused.playerNumber);
    const color = roomPlayer?.color ?? "#22d3ee";
    const progressPercent = Math.min(100, Math.max(0, (focused.progress / TEST_OVAL_TRACK.trackLength) * 100));

    const summary = document.createElement("section");
    summary.className = "race-hud-panel race-hud-leaderboard";
    const position = document.createElement("p");
    position.className = "race-position";
    position.textContent = `${focused.rank} / ${ranked.length}`;
    const title = document.createElement("p");
    title.className = "racing-hud-title";
    title.textContent = playerLabel(focused.playerNumber);
    title.style.setProperty("--player-color", color);
    summary.append(position, title);

    const list = document.createElement("ol");
    list.className = "racing-leaderboard";
    for (const player of ranked) {
      const row = document.createElement("li");
      const focusButton = document.createElement("button");
      focusButton.type = "button";
      focusButton.className = "racing-leaderboard-row";
      if (player.playerNumber === focused.playerNumber) focusButton.classList.add("is-focused");
      focusButton.textContent = `#${player.rank} ${playerLabel(player.playerNumber)} ${Math.round(player.speed * 3.6)} km/h`;
      focusButton.addEventListener("click", () => {
        focusedRacingPlayer = player.playerNumber;
        racingRendererControls?.setFocusedPlayer(focusedRacingPlayer);
        updateRacingHud(state);
      });
      row.appendChild(focusButton);
      list.appendChild(row);
    }
    summary.appendChild(list);
    hud.appendChild(summary);

    const status = document.createElement("section");
    status.className = "race-hud-panel race-hud-status";
    status.textContent = state.raceStatus === "countdown" ? "Pocket Formula" : state.raceStatus === "finished" ? "Finish" : "Harbor City GP";
    hud.appendChild(status);

    const speed = document.createElement("section");
    speed.className = "race-hud-panel race-speedometer";
    speed.innerHTML = `<strong>${Math.round(focused.speed * 3.6)}</strong><span>km/h</span><small>${Math.abs(focused.lateralOffset) > 6 ? "OFF TRACK" : "THROTTLE"}</small>`;
    hud.appendChild(speed);

    const progress = document.createElement("section");
    progress.className = "race-hud-panel race-progress";
    progress.innerHTML = `<span style="--player-color:${color}"></span><p>${playerLabel(focused.playerNumber)}</p>`;
    progress.querySelector<HTMLSpanElement>("span")!.style.width = `${progressPercent}%`;
    hud.appendChild(progress);

    const controls = document.createElement("section");
    controls.className = "race-hud-panel race-controls";
    controls.appendChild(
      createButton({
        label: `Camera: ${racingCameraMode}`,
        variant: "secondary",
        onClick: () => {
          if (racingRendererControls) {
            racingCameraMode = racingRendererControls.cycleCameraMode();
            updateRacingHud(state);
          }
        }
      })
    );
    controls.appendChild(
      createButton({
        label: "End",
        variant: "danger",
        onClick: async () => {
          await emitWithAck(SOCKET_EVENTS.GAME_END, {});
        }
      })
    );
    hud.appendChild(controls);
  }

  function renderResultsScreen(room: PublicRoomState): void {
    const players: RacingPlayerState[] = lastRacingState?.players ?? [];
    const ranked = [...players].sort((a, b) => a.rank - b.rank);
    const mount = room.gameType === "racing" ? gameSectionEl.querySelector<HTMLDivElement>("#race-results-overlay") : footerEl;
    if (!mount) return;
    mount.innerHTML = "";
    mount.hidden = false;

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
    mount.appendChild(panel);
    footerEl.hidden = room.gameType === "racing";
  }

  function renderRoom(room: PublicRoomState): void {
    lastRoom = room;
    const isRaceResults = room.gameType === "racing" && room.status === "results";
    const isPlaying = room.status === "countdown" || room.status === "in-progress" || isRaceResults;
    const wasPlaying =
      lastStatus === "countdown" || lastStatus === "in-progress" || (room.gameType === "racing" && lastStatus === "results");

    if (room.status === "results") {
      if (room.gameType === "racing" && !wasPlaying) void startGameView(room);
      gridEl.hidden = true;
      gameSectionEl.hidden = room.gameType !== "racing";
      reconnectingEl.hidden = true;
      renderResultsScreen(room);
      lastStatus = room.status;
      return;
    }
    if (room.status === "host-disconnected") {
      if (wasPlaying) stopGameView();
      gridEl.hidden = true;
      footerEl.hidden = true;
      gameSectionEl.hidden = true;
      reconnectingEl.hidden = false;
      lastStatus = room.status;
      return;
    }
    reconnectingEl.hidden = true;

    if (isPlaying && !wasPlaying) void startGameView(room);
    if (!isPlaying && wasPlaying) stopGameView();
    if (isPlaying) {
      gridEl.hidden = true;
      footerEl.hidden = true;
      const countdownEl = gameSectionEl.querySelector<HTMLDivElement>("#countdown");
      if (countdownEl && room.status === "in-progress") countdownEl.textContent = "";
      const resultsEl = gameSectionEl.querySelector<HTMLDivElement>("#race-results-overlay");
      if (resultsEl) resultsEl.hidden = true;
    } else {
      footerEl.hidden = false;
    }
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
    if (el) {
      const value = String(payload.value).toUpperCase();
      if (payload.value === "go") {
        el.innerHTML = `<div class="countdown-lights is-go"><span>GO</span></div>`;
        window.setTimeout(() => (el.textContent = ""), 650);
      } else {
        const active = 4 - Number(payload.value);
        el.innerHTML = `<div class="countdown-lights">${[1, 2, 3]
          .map((light) => `<i class="${light <= active ? "is-active" : ""}"></i>`)
          .join("")}</div>`;
      }
    }
  };
  const onGameState = (payload: GameStatePayload) => {
    if (payload.gameType === "controller-test" && renderer instanceof ControllerTestRenderer) {
      renderer.applyState(payload);
    } else if (payload.gameType === "racing") {
      lastRacingState = payload;
      if (racingRendererControls) racingRendererControls.applyState(payload);
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
