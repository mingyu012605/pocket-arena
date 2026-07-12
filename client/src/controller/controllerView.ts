import { ButtonInputSource, bindHoldButton } from "./inputs/buttons";
import { getSocket } from "../networking/socket";
import type { CleanupFn } from "../networking/router";

export function mountControllerView(
  container: HTMLElement,
  opts: { nickname: string; color: string; roundId: string }
): CleanupFn {
  container.innerHTML = `
    <div class="controller-screen" style="--player-color:${opts.color}">
      <header class="controller-header">
        <span class="controller-nickname"></span>
        <span class="controller-status" id="conn-indicator">●</span>
      </header>
      <button class="jump-button" id="btn-jump">JUMP</button>
      <div class="dpad-row">
        <button class="dpad-button" id="btn-left">◀ LEFT</button>
        <button class="dpad-button" id="btn-right">RIGHT ▶</button>
      </div>
    </div>
  `;

  const input = new ButtonInputSource(opts.roundId);
  const jumpBtn = container.querySelector<HTMLButtonElement>("#btn-jump")!;
  const leftBtn = container.querySelector<HTMLButtonElement>("#btn-left")!;
  const rightBtn = container.querySelector<HTMLButtonElement>("#btn-right")!;
  const indicator = container.querySelector<HTMLSpanElement>("#conn-indicator")!;
  container.querySelector<HTMLSpanElement>(".controller-nickname")!.textContent = opts.nickname;

  const unbindLeft = bindHoldButton(
    leftBtn,
    () => input.pressLeft(),
    () => input.releaseLeft()
  );
  const unbindRight = bindHoldButton(
    rightBtn,
    () => input.pressRight(),
    () => input.releaseRight()
  );
  const onJumpDown = (event: Event) => {
    event.preventDefault();
    input.jump();
  };
  jumpBtn.addEventListener("pointerdown", onJumpDown);

  const releaseAll = () => input.releaseAll();
  const onVisibility = () => {
    if (document.hidden) releaseAll();
  };
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", onVisibility);

  const socket = getSocket();
  const onDisconnect = () => {
    releaseAll();
    indicator.classList.add("offline");
  };
  const onConnect = () => indicator.classList.remove("offline");
  socket.on("disconnect", onDisconnect);
  socket.on("connect", onConnect);

  return () => {
    unbindLeft();
    unbindRight();
    jumpBtn.removeEventListener("pointerdown", onJumpDown);
    window.removeEventListener("blur", releaseAll);
    document.removeEventListener("visibilitychange", onVisibility);
    socket.off("disconnect", onDisconnect);
    socket.off("connect", onConnect);
    releaseAll();
  };
}
