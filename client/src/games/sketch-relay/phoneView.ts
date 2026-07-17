import { SOCKET_EVENTS } from "../../../../shared/protocol";
import type { GameStatePayload, SketchDrawing, SketchRelayAssignmentPayload, SketchRelayGameStatePayload, SketchStroke } from "../../../../shared/protocol";
import { createButton } from "../../components/button";
import { emitWithAck, getSocket } from "../../networking/socket";
import { drawingIsBlank, renderSketchDrawing, SKETCH_COLORS } from "./drawing";
import "./sketchRelay.css";

interface PhoneOptions {
  nickname: string;
  color: string;
  playerNumber: number;
}

function secondsLeft(deadlineAt: number | null): string {
  if (!deadlineAt) return "";
  return String(Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000)));
}

function storageKey(assignment: SketchRelayAssignmentPayload): string {
  return `pocket-arena:sketch:${assignment.roundId}:${assignment.chainId}:${assignment.phaseIndex}`;
}

function sameAssignment(a: SketchRelayAssignmentPayload | null, b: SketchRelayAssignmentPayload): boolean {
  return Boolean(a && a.roundId === b.roundId && a.chainId === b.chainId && a.phaseIndex === b.phaseIndex);
}

export function mountSketchRelayView(container: HTMLElement, opts: PhoneOptions): () => void {
  const socket = getSocket();
  let assignment: SketchRelayAssignmentPayload | null = null;
  let state: SketchRelayGameStatePayload | null = null;
  let timer: number | null = null;
  let cleanupDrawing: (() => void) | null = null;

  container.innerHTML = `<section class="sketch-phone" style="--player-color:${opts.color}"></section>`;
  const root = container.querySelector<HTMLElement>(".sketch-phone")!;

  function vibrate(ms: number): void {
    navigator.vibrate?.(ms);
  }

  function renderWaiting(): void {
    cleanupDrawing?.();
    cleanupDrawing = null;
    const submitted = assignment?.submitted ?? false;
    root.innerHTML = `
      <header class="sketch-phone-header">
        <strong>${opts.nickname}</strong>
        <span>${state?.phase === "reveal" || state?.phase === "finished" ? "Reveal" : submitted ? "Submitted" : "Sketch Relay"}</span>
      </header>
      <div class="sketch-waiting">
        <h1>${state?.phase === "reveal" || state?.phase === "finished" ? "React to the reveal!" : "Nice. Waiting..."}</h1>
        <p>${state ? `${state.submittedCount} / ${state.totalCount} submitted` : "Waiting for the next assignment."}</p>
        <div class="sketch-reactions">
          ${["😂", "❤️", "😱", "👏"].map((reaction) => `<button type="button" data-reaction="${reaction}">${reaction}</button>`).join("")}
        </div>
      </div>
    `;
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-reaction]")) {
      button.addEventListener("click", () => {
        if (!state) return;
        socket.emit(SOCKET_EVENTS.SKETCH_REACTION, { roundId: state.roundId, reaction: button.dataset.reaction });
        vibrate(20);
      });
    }
  }

  function renderTextAssignment(current: SketchRelayAssignmentPayload): void {
    cleanupDrawing?.();
    cleanupDrawing = null;
    const isGuess = current.phase === "guessing";
    root.innerHTML = `
      <header class="sketch-phone-header">
        <strong>${opts.nickname}</strong>
        <span id="sketch-timer">${secondsLeft(current.deadlineAt)}</span>
      </header>
      <main class="sketch-text-task">
        <p class="sketch-kicker">${isGuess ? "What is this drawing?" : "Type the word"}</p>
        <div id="sketch-reference"></div>
        <textarea id="sketch-text-input" maxlength="80" placeholder="${isGuess ? "Type your guess..." : "Type the word..." }"></textarea>
        <div id="sketch-submit-slot"></div>
      </main>
    `;
    if (isGuess && current.drawing) {
      const canvas = document.createElement("canvas");
      canvas.className = "sketch-reference-canvas";
      root.querySelector("#sketch-reference")!.appendChild(canvas);
      renderSketchDrawing(canvas, current.drawing);
    }
    const input = root.querySelector<HTMLTextAreaElement>("#sketch-text-input")!;
    const saved = localStorage.getItem(storageKey(current));
    if (saved) input.value = saved;
    input.addEventListener("input", () => localStorage.setItem(storageKey(current), input.value));
    root.querySelector("#sketch-submit-slot")!.appendChild(
      createButton({
        label: "Submit",
        variant: "primary",
        onClick: async () => {
          await emitWithAck(SOCKET_EVENTS.SKETCH_SUBMIT_TEXT, { roundId: current.roundId, text: input.value });
          localStorage.removeItem(storageKey(current));
          vibrate(35);
          if (sameAssignment(assignment, current)) {
            assignment = { ...current, submitted: true };
            renderWaiting();
          }
        }
      })
    );
  }

  function renderDrawingAssignment(current: SketchRelayAssignmentPayload): void {
    cleanupDrawing?.();
    const saved = localStorage.getItem(storageKey(current));
    let strokes: SketchStroke[] = saved ? (JSON.parse(saved) as SketchDrawing).strokes ?? [] : [];
    let redo: SketchStroke[] = [];
    let brushColor: string = SKETCH_COLORS[0];
    let brushSize = 6;
    let eraser = false;
    let activeStroke: SketchStroke | null = null;

    root.innerHTML = `
      <header class="sketch-phone-header">
        <strong>${opts.nickname}</strong>
        <span id="sketch-timer">${secondsLeft(current.deadlineAt)}</span>
      </header>
      <main class="sketch-draw-task">
        <p class="sketch-prompt">${current.prompt ?? "Draw this!"}</p>
        <canvas id="sketch-canvas" class="sketch-canvas"></canvas>
        <div class="sketch-tools">
          <div class="sketch-palette">${SKETCH_COLORS.map((color) => `<button type="button" data-color="${color}" style="--swatch:${color}"></button>`).join("")}</div>
          <label>Size <input id="brush-size" type="range" min="2" max="28" value="${brushSize}"></label>
          <button type="button" id="eraser">Eraser</button>
          <button type="button" id="undo">Undo</button>
          <button type="button" id="redo">Redo</button>
          <button type="button" id="clear">Clear</button>
          <div id="sketch-submit-slot"></div>
        </div>
      </main>
    `;
    const canvas = root.querySelector<HTMLCanvasElement>("#sketch-canvas")!;

    function persist(): void {
      localStorage.setItem(storageKey(current), JSON.stringify({ strokes }));
    }
    function render(): void {
      renderSketchDrawing(canvas, { strokes });
    }
    const resize = () => render();
    window.addEventListener("resize", resize);
    render();

    const pointFromClient = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
      };
    };
    const pointerPoint = (event: PointerEvent) => pointFromClient(event.clientX, event.clientY);
    const touchPoint = (event: TouchEvent) => {
      const touch = event.touches[0] ?? event.changedTouches[0];
      return touch ? pointFromClient(touch.clientX, touch.clientY) : null;
    };
    let activePointerId: number | null = null;
    const start = (event: PointerEvent) => {
      event.preventDefault();
      activePointerId = event.pointerId;
      canvas.setPointerCapture?.(event.pointerId);
      redo = [];
      activeStroke = { color: brushColor, width: brushSize, eraser, points: [pointerPoint(event)] };
      strokes.push(activeStroke);
      render();
    };
    const move = (event: PointerEvent) => {
      if (!activeStroke || (activePointerId !== null && event.pointerId !== activePointerId)) return;
      event.preventDefault();
      activeStroke.points.push(pointerPoint(event));
      render();
    };
    const end = (event: PointerEvent) => {
      if (!activeStroke || (activePointerId !== null && event.pointerId !== activePointerId)) return;
      event.preventDefault();
      activePointerId = null;
      activeStroke = null;
      persist();
    };
    const touchStart = (event: TouchEvent) => {
      if (activePointerId !== null || activeStroke) return;
      event.preventDefault();
      const point = touchPoint(event);
      if (!point) return;
      redo = [];
      activeStroke = { color: brushColor, width: brushSize, eraser, points: [point] };
      strokes.push(activeStroke);
      render();
    };
    const touchMove = (event: TouchEvent) => {
      if (activePointerId !== null || !activeStroke) return;
      event.preventDefault();
      const point = touchPoint(event);
      if (!point) return;
      activeStroke.points.push(point);
      render();
    };
    const touchEnd = (event: TouchEvent) => {
      if (activePointerId !== null || !activeStroke) return;
      event.preventDefault();
      activeStroke = null;
      persist();
    };
    canvas.addEventListener("pointerdown", start);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("touchstart", touchStart, { passive: false });
    canvas.addEventListener("touchmove", touchMove, { passive: false });
    canvas.addEventListener("touchend", touchEnd, { passive: false });
    canvas.addEventListener("touchcancel", touchEnd, { passive: false });

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-color]")) {
      button.addEventListener("click", () => {
        brushColor = button.dataset.color ?? SKETCH_COLORS[0];
        eraser = false;
      });
    }
    root.querySelector<HTMLInputElement>("#brush-size")!.addEventListener("input", (event) => {
      brushSize = Number((event.target as HTMLInputElement).value);
    });
    root.querySelector<HTMLButtonElement>("#eraser")!.addEventListener("click", () => (eraser = !eraser));
    root.querySelector<HTMLButtonElement>("#undo")!.addEventListener("click", () => {
      const stroke = strokes.pop();
      if (stroke) redo.push(stroke);
      persist();
      render();
    });
    root.querySelector<HTMLButtonElement>("#redo")!.addEventListener("click", () => {
      const stroke = redo.pop();
      if (stroke) strokes.push(stroke);
      persist();
      render();
    });
    root.querySelector<HTMLButtonElement>("#clear")!.addEventListener("click", () => {
      if (!drawingIsBlank({ strokes }) && !confirm("Clear your drawing?")) return;
      redo = strokes;
      strokes = [];
      persist();
      render();
    });
    root.querySelector("#sketch-submit-slot")!.appendChild(
      createButton({
        label: "Submit",
        variant: "primary",
        onClick: async () => {
          const drawing: SketchDrawing = { strokes };
          if (drawingIsBlank(drawing) && !confirm("Submit a blank drawing?")) return;
          await emitWithAck(SOCKET_EVENTS.SKETCH_SUBMIT_DRAWING, { roundId: current.roundId, drawing });
          localStorage.removeItem(storageKey(current));
          vibrate(35);
          if (sameAssignment(assignment, current)) {
            assignment = { ...current, submitted: true };
            renderWaiting();
          }
        }
      })
    );

    cleanupDrawing = () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", start);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", end);
      canvas.removeEventListener("pointercancel", end);
      canvas.removeEventListener("touchstart", touchStart);
      canvas.removeEventListener("touchmove", touchMove);
      canvas.removeEventListener("touchend", touchEnd);
      canvas.removeEventListener("touchcancel", touchEnd);
    };
  }

  function render(): void {
    if (state?.phase === "reveal" || state?.phase === "finished") return renderWaiting();
    if (!assignment || assignment.submitted) return renderWaiting();
    if (assignment.entryType === "drawing") renderDrawingAssignment(assignment);
    else renderTextAssignment(assignment);
  }

  const tick = () => {
    const timerEl = root.querySelector<HTMLElement>("#sketch-timer");
    if (timerEl) {
      const left = Number(secondsLeft(assignment?.deadlineAt ?? state?.deadlineAt ?? null));
      timerEl.textContent = String(left);
      if (left === 5) vibrate(30);
    }
  };
  timer = window.setInterval(tick, 1000);

  const onAssignment = (payload: SketchRelayAssignmentPayload) => {
    assignment = payload;
    vibrate(25);
    render();
  };
  const onGameState = (payload: GameStatePayload) => {
    if (payload.gameType !== "sketch-relay") return;
    state = payload;
    if (assignment && assignment.roundId === payload.roundId) {
      assignment = {
        ...assignment,
        submitted: payload.submittedCount > 0 && assignment.submitted,
        submittedCount: payload.submittedCount,
        totalCount: payload.totalCount
      };
    }
    if (payload.phase === "reveal" || payload.phase === "finished" || assignment?.submitted) renderWaiting();
    else tick();
  };

  socket.on(SOCKET_EVENTS.SKETCH_ASSIGNMENT, onAssignment);
  socket.on(SOCKET_EVENTS.GAME_STATE, onGameState);
  void emitWithAck(SOCKET_EVENTS.SKETCH_REQUEST_ASSIGNMENT, {});
  renderWaiting();

  return () => {
    if (timer !== null) window.clearInterval(timer);
    cleanupDrawing?.();
    socket.off(SOCKET_EVENTS.SKETCH_ASSIGNMENT, onAssignment);
    socket.off(SOCKET_EVENTS.GAME_STATE, onGameState);
  };
}
