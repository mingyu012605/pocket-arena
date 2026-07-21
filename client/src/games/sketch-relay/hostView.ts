import { SOCKET_EVENTS } from "../../../../shared/protocol";
import type { SketchRelayChain, SketchRelayEntry, SketchRelayGameStatePayload, SketchRelayReactionPopPayload, SketchRelayResult } from "../../../../shared/protocol";
import { createButton } from "../../components/button";
import { emitWithAck, getSocket } from "../../networking/socket";
import { renderSketchDrawing } from "./drawing";
import "./sketchRelay.css";

export interface SketchRelayHostView {
  applyState: (state: SketchRelayGameStatePayload) => void;
  destroy: () => void;
}

function phaseLabel(state: SketchRelayGameStatePayload): string {
  if (state.phase === "prompt-entry") return "Secret word";
  if (state.phase === "drawing") return `Player ${state.activePlayerNumber ?? "?"} is drawing`;
  if (state.phase === "guessing") return `Player ${state.activePlayerNumber ?? "?"} is guessing`;
  if (state.phase === "reveal") return "Reveal time";
  return "Finished";
}

function secondsLeft(deadlineAt: number | null): string {
  if (!deadlineAt) return "";
  return String(Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000)));
}

function entryTitle(entry: SketchRelayEntry): string {
  if (entry.phaseIndex === 0) return "secret word:";
  return entry.type === "drawing" ? "drawn by" : "guessed by";
}

function normalizeAnswer(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function finalRelayResult(chain: SketchRelayChain | undefined): SketchRelayResult | null {
  if (!chain) return null;
  const originalWord = chain.entries[0]?.text ?? "";
  const guesses = chain.entries.filter((entry) => entry.type === "text" && entry.phaseIndex > 0 && entry.text);
  const finalGuess = guesses[guesses.length - 1]?.text ?? "";
  if (!originalWord || !finalGuess) return null;
  return {
    originalWord,
    finalGuess,
    success: normalizeAnswer(originalWord) === normalizeAnswer(finalGuess)
  };
}

export function mountSketchRelayHostView(container: HTMLElement): SketchRelayHostView {
  const socket = getSocket();
  let latest: SketchRelayGameStatePayload | null = null;
  let timer: number | null = null;
  container.classList.add("sketch-host-shell");

  function renderActive(state: SketchRelayGameStatePayload): void {
    container.innerHTML = `
      <section class="sketch-host-active">
        <div class="sketch-paper-stack">
          <p class="sketch-kicker">Sketch Relay</p>
          <h1>${phaseLabel(state)}</h1>
          <p class="sketch-host-copy">Turn ${state.turnIndex} of ${state.totalTurns} · ${state.phase === "drawing" ? "Drawing" : "Guessing"}</p>
          <div class="sketch-progress">
            <span style="width:${state.totalCount === 0 ? 0 : (state.submittedCount / state.totalCount) * 100}%"></span>
          </div>
          <strong>${state.submittedCount} / ${state.totalCount} submitted</strong>
          <p class="sketch-timer-big">${secondsLeft(state.deadlineAt)}</p>
        </div>
      </section>
    `;
  }

  function renderEntry(entry: SketchRelayEntry): HTMLElement {
    const card = document.createElement("article");
    card.className = `sketch-reveal-entry is-${entry.type}`;
    const kicker = document.createElement("p");
    kicker.className = "sketch-kicker";
    kicker.textContent = entry.phaseIndex === 0 ? entryTitle(entry) : `${entryTitle(entry)} ${entry.contributorName}`;
    card.appendChild(kicker);
    if (entry.type === "drawing" && entry.drawing) {
      const canvas = document.createElement("canvas");
      canvas.className = "sketch-reveal-canvas";
      card.appendChild(canvas);
      requestAnimationFrame(() => renderSketchDrawing(canvas, entry.drawing!));
    } else {
      const text = document.createElement("h2");
      text.textContent = entry.text ?? "";
      card.appendChild(text);
    }
    return card;
  }

  function currentEntry(state: SketchRelayGameStatePayload): { chain: SketchRelayChain; entry: SketchRelayEntry } | null {
    const chain = state.chains?.[state.revealChainIndex];
    const entry = chain?.entries[state.revealEntryIndex];
    return chain && entry ? { chain, entry } : null;
  }

  function renderReveal(state: SketchRelayGameStatePayload): void {
    const current = currentEntry(state);
    const result = state.result ?? finalRelayResult(current?.chain ?? state.chains?.[0]);
    const isFinished = state.phase === "finished";
    container.innerHTML = `
      <section class="sketch-host-reveal">
        <header>
          <div>
            <p class="sketch-kicker">Sketch Relay reveal</p>
            <h1>${isFinished ? "Final result" : "How it changed"}</h1>
          </div>
          <div class="sketch-reveal-controls" id="sketch-reveal-controls"></div>
        </header>
        <div class="sketch-chain-track" id="sketch-chain-track"></div>
        <div id="sketch-final-result"></div>
        <div class="sketch-reactions-pop" id="sketch-reactions-pop"></div>
      </section>
    `;
    const controls = container.querySelector("#sketch-reveal-controls")!;
    for (const [label, action] of [
      ["Previous", "previous"],
      [isFinished ? "Restart Reveal" : "Next", isFinished ? "restart" : "next"],
      ["Finish", "finish"]
    ] as const) {
      controls.appendChild(
        createButton({
          label,
          variant: action === "finish" ? "danger" : "secondary",
          onClick: () => void emitWithAck(SOCKET_EVENTS.SKETCH_REVEAL_CONTROL, { roundId: state.roundId, action })
        })
      );
    }
    const track = container.querySelector("#sketch-chain-track")!;
    const finalMount = container.querySelector("#sketch-final-result")!;
    if (!current) {
      const empty = document.createElement("p");
      empty.className = "sketch-host-copy";
      empty.textContent = "No chain entries to reveal yet.";
      track.appendChild(empty);
      return;
    }
    const entries = current.chain.entries.slice(0, state.revealEntryIndex + 1);
    entries.forEach((entry, index) => {
      if (index > 0) {
        const became = document.createElement("span");
        became.className = "sketch-became";
        became.textContent = "became...";
        track.appendChild(became);
      }
      track.appendChild(renderEntry(entry));
    });
    if (isFinished && result) {
      const panel = document.createElement("section");
      panel.className = `sketch-final-card ${result.success ? "is-success" : "is-fail"}`;
      panel.innerHTML = `
        <div class="sketch-final-burst" aria-hidden="true">
          ${Array.from({ length: 18 }, (_, index) => `<i style="--i:${index}"></i>`).join("")}
        </div>
        <p class="sketch-kicker">${result.success ? "Perfect match" : "Not quite"}</p>
        <h2>${result.success ? "Congratulations! The word survived!" : "The word changed along the way!"}</h2>
        <dl>
          <div><dt>Original word</dt><dd></dd></div>
          <div><dt>Final guess</dt><dd></dd></div>
        </dl>
      `;
      const values = panel.querySelectorAll("dd");
      values[0]!.textContent = result.originalWord;
      values[1]!.textContent = result.finalGuess;
      finalMount.appendChild(panel);
    }
  }

  function applyState(state: SketchRelayGameStatePayload): void {
    latest = state;
    if (state.phase === "reveal" || state.phase === "finished") renderReveal(state);
    else renderActive(state);
  }

  function onReaction(payload: SketchRelayReactionPopPayload): void {
    const target = container.querySelector<HTMLElement>("#sketch-reactions-pop");
    if (!target) return;
    const pop = document.createElement("span");
    pop.textContent = payload.reaction;
    pop.style.setProperty("--x", `${20 + Math.random() * 60}%`);
    pop.style.setProperty("--player-color", payload.color);
    target.appendChild(pop);
    window.setTimeout(() => pop.remove(), 1200);
  }

  timer = window.setInterval(() => {
    if (latest && latest.phase !== "reveal" && latest.phase !== "finished") {
      const el = container.querySelector<HTMLElement>(".sketch-timer-big");
      if (el) el.textContent = secondsLeft(latest.deadlineAt);
    }
  }, 1000);
  socket.on(SOCKET_EVENTS.SKETCH_REACTION_POP, onReaction);

  return {
    applyState,
    destroy: () => {
      if (timer !== null) window.clearInterval(timer);
      socket.off(SOCKET_EVENTS.SKETCH_REACTION_POP, onReaction);
      container.classList.remove("sketch-host-shell");
    }
  };
}
