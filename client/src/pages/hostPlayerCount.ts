import { GAME_CATALOG } from "../games/catalog";
import { emitWithAck } from "../networking/socket";
import { navigate } from "../networking/router";
import type { CleanupFn, RouteContext } from "../networking/router";
import { SOCKET_EVENTS } from "../../../shared/protocol";
import type { CreateRoomRequest, CreateRoomResponse } from "../../../shared/protocol";
import { createButton } from "../components/button";

export function renderHostPlayerCountPage({ container, params }: RouteContext): CleanupFn | void {
  const entry = GAME_CATALOG.find((g) => g.id === params.gameId);

  if (!entry || !entry.playable) {
    container.innerHTML = `
      <section class="page-section centered">
        <h1>Coming Soon</h1>
        <p>${entry ? entry.title : "This game"} isn't ready to play yet.</p>
        <div id="back-slot"></div>
      </section>
    `;
    container
      .querySelector<HTMLDivElement>("#back-slot")!
      .appendChild(createButton({ label: "Back to Games", variant: "secondary", onClick: () => navigate("/host") }));
    return;
  }

  container.innerHTML = `
    <section class="page-section centered">
      <h1>${entry.title}</h1>
      <p class="hero-copy">How many players?</p>
      <div class="player-count-grid" id="counts"></div>
      <p class="error-text" id="error" hidden></p>
    </section>
  `;

  const counts = container.querySelector<HTMLDivElement>("#counts")!;
  const errorEl = container.querySelector<HTMLParagraphElement>("#error")!;
  let busy = false;

  for (let n = entry.minPlayers; n <= entry.maxPlayers; n++) {
    const btn = createButton({
      label: `${n} Player${n > 1 ? "s" : ""}`,
      variant: "primary",
      onClick: async () => {
        if (busy) return;
        busy = true;
        errorEl.hidden = true;
        try {
          const res = await emitWithAck<CreateRoomResponse>(SOCKET_EVENTS.HOST_CREATE_ROOM, {
            gameType: entry.id,
            maxPlayers: n
          } satisfies CreateRoomRequest);
          sessionStorage.setItem(
            `pocket-arena:host:${res.roomId}`,
            JSON.stringify({ hostToken: res.hostToken, slots: res.slots, room: res.room })
          );
          navigate(`/host/lobby/${res.roomId}`);
        } catch (err) {
          errorEl.textContent = (err as { message?: string }).message ?? "Could not create room.";
          errorEl.hidden = false;
          busy = false;
        }
      }
    });
    counts.appendChild(btn);
  }
}
