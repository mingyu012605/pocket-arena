import { emitWithAck, getSocket } from "../networking/socket";
import type { CleanupFn, RouteContext } from "../networking/router";
import { SOCKET_EVENTS } from "../../../shared/protocol";
import type {
  ControllerJoinRequest,
  ControllerJoinResponse,
  CountdownTickPayload,
  PublicRoomState,
  ValidateTokenRequest,
  ValidateTokenResponse
} from "../../../shared/protocol";
import { createButton } from "../components/button";
import { mountControllerView } from "../controller/controllerView";
import "../styles/controller.css";

function tokenKey(roomId: string, playerNumber: string): string {
  return `pocket-arena:player:${roomId}:${playerNumber}`;
}

export function renderJoinPage({ container, params, query }: RouteContext): CleanupFn | void {
  const roomId = params.roomCode!;
  const playerNumber = params.playerNumber!;
  const queryToken = query.get("token");

  if (queryToken) {
    sessionStorage.setItem(tokenKey(roomId, playerNumber), queryToken);
    window.history.replaceState({}, "", `/join/${roomId}/${playerNumber}`);
  }
  const token = queryToken ?? sessionStorage.getItem(tokenKey(roomId, playerNumber));

  container.innerHTML = `<section class="page-section centered join-page"><p>Checking your invite…</p></section>`;
  const section = container.querySelector<HTMLElement>(".join-page")!;

  if (!token) {
    section.innerHTML = `<h1>Invalid Link</h1><p>This join link is missing its access token. Ask your host for a fresh QR code.</p>`;
    return;
  }

  let cancelled = false;
  let controllerCleanup: CleanupFn | null = null;
  let lastStatus: PublicRoomState["status"] | null = null;
  const socket = getSocket();

  const onCountdownTick = (payload: CountdownTickPayload) => {
    const el = document.getElementById("phone-countdown");
    if (el) el.textContent = String(payload.value);
  };
  socket.on(SOCKET_EVENTS.GAME_COUNTDOWN_TICK, onCountdownTick);

  function renderReadyScreen(room: PublicRoomState, color: string): void {
    const self = room.players.find((p) => p.playerNumber === Number(playerNumber));
    section.style.setProperty("--player-color", color);
    section.innerHTML = `
      <p class="eyebrow">PLAYER ${playerNumber}</p>
      <h1 class="glow-text">${self?.nickname ?? ""}</h1>
      <div id="ready-slot"></div>
      <p id="waiting-text" class="hero-copy" hidden>Waiting for host…</p>
    `;
    const readySlot = section.querySelector<HTMLDivElement>("#ready-slot")!;
    const waitingText = section.querySelector<HTMLParagraphElement>("#waiting-text")!;
    let ready = self?.ready ?? false;
    waitingText.hidden = !ready;
    const readyButton = createButton({
      label: ready ? "Cancel Ready" : "Ready",
      variant: "primary",
      onClick: async () => {
        ready = !ready;
        readyButton.disabled = true;
        try {
          await emitWithAck(SOCKET_EVENTS.PLAYER_READY, { ready } satisfies { ready: boolean });
          readyButton.textContent = ready ? "Cancel Ready" : "Ready";
          waitingText.hidden = !ready;
        } finally {
          readyButton.disabled = false;
        }
      }
    });
    readySlot.appendChild(readyButton);
  }

  function onRoomState(room: PublicRoomState): void {
    const self = room.players.find((p) => p.playerNumber === Number(playerNumber));
    if (!self) {
      lastStatus = room.status;
      return;
    }

    // "countdown" and "in-progress" share one mounted controller view: a room's
    // roundId is assigned once in game:start and stays fixed through both statuses,
    // so remounting on that specific edge would tear down a player's actively-held
    // button mid-hold (the new DOM element never receives the ongoing pointer contact)
    // right at the "go" instant — exactly when a pre-emptive hold is most likely.
    const isPlaying = room.status === "countdown" || room.status === "in-progress";
    const wasPlaying = lastStatus === "countdown" || lastStatus === "in-progress";
    if (room.status === lastStatus || (isPlaying && wasPlaying)) {
      lastStatus = room.status;
      return;
    }

    controllerCleanup?.();
    controllerCleanup = null;

    if (room.status === "host-disconnected") {
      section.innerHTML = `<h1>Reconnecting to Host…</h1><p class="hero-copy">Sit tight — your slot is saved.</p>`;
    } else if (isPlaying) {
      section.innerHTML = `<div class="countdown-overlay" id="phone-countdown"></div><div id="controller-mount"></div>`;
      controllerCleanup = mountControllerView(section.querySelector("#controller-mount")!, {
        nickname: self.nickname ?? "Player",
        color: self.color,
        roundId: room.roundId ?? ""
      });
    } else {
      renderReadyScreen(room, self.color);
    }
    lastStatus = room.status;
  }
  socket.on(SOCKET_EVENTS.ROOM_STATE, onRoomState);

  emitWithAck<ValidateTokenResponse>(SOCKET_EVENTS.CONTROLLER_VALIDATE_TOKEN, {
    roomId,
    playerNumber: Number(playerNumber),
    token
  } satisfies ValidateTokenRequest)
    .then((validated) => {
      if (!cancelled) renderNicknameForm(validated);
    })
    .catch((err: { message?: string }) => {
      if (cancelled) return;
      section.innerHTML = `<h1>Invalid or Expired Link</h1><p>${err.message ?? "This QR code is no longer valid."}</p>`;
    });

  function renderNicknameForm(validated: ValidateTokenResponse): void {
    section.style.setProperty("--player-color", validated.color);
    section.innerHTML = `
      <p class="eyebrow">PLAYER ${playerNumber}</p>
      <h1 class="glow-text">Join the Arena</h1>
      <form id="nickname-form" class="nickname-form">
        <input id="nickname-input" type="text" maxlength="20" placeholder="Your nickname" autocomplete="off" value="${validated.nickname ?? ""}" required />
        <div id="nickname-submit"></div>
      </form>
      <p class="error-text" id="join-error" hidden></p>
    `;
    const form = section.querySelector<HTMLFormElement>("#nickname-form")!;
    const input = section.querySelector<HTMLInputElement>("#nickname-input")!;
    const submitSlot = section.querySelector<HTMLDivElement>("#nickname-submit")!;
    const errorEl = section.querySelector<HTMLParagraphElement>("#join-error")!;
    const submitButton = createButton({ label: "Join Game", variant: "primary" });
    submitButton.type = "submit";
    submitSlot.appendChild(submitButton);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorEl.hidden = true;
      submitButton.disabled = true;
      try {
        const joined = await emitWithAck<ControllerJoinResponse>(SOCKET_EVENTS.CONTROLLER_JOIN, {
          roomId,
          playerNumber: Number(playerNumber),
          // `token` is narrowed to `string` by the `if (!token) return;` check above, but that
          // narrowing isn't carried into this nested `function renderNicknameForm` declaration
          // (TS can't prove a hoisted function declaration only runs after the check), so a
          // non-null assertion is used here instead of `token as string`.
          token: token!,
          nickname: input.value
        } satisfies ControllerJoinRequest);
        lastStatus = null;
        onRoomState(joined.room);
      } catch (err) {
        errorEl.textContent = (err as { message?: string }).message ?? "Could not join the room.";
        errorEl.hidden = false;
        submitButton.disabled = false;
      }
    });
  }

  return () => {
    cancelled = true;
    controllerCleanup?.();
    socket.off(SOCKET_EVENTS.ROOM_STATE, onRoomState);
    socket.off(SOCKET_EVENTS.GAME_COUNTDOWN_TICK, onCountdownTick);
  };
}
