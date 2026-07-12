import { getSocket } from "../../networking/socket";
import { SOCKET_EVENTS } from "../../../../shared/protocol";
import type { ControllerAction, InputActionPayload } from "../../../../shared/protocol";

export class ButtonInputSource {
  private sequence = 0;
  private roundId: string;
  private heldDirection: "left" | "right" | null = null;

  constructor(roundId: string) {
    this.roundId = roundId;
  }

  private send(action: ControllerAction): void {
    const socket = getSocket();
    if (!socket.connected) return;
    this.sequence += 1;
    socket.emit(SOCKET_EVENTS.INPUT_ACTION, {
      action,
      sequence: this.sequence,
      roundId: this.roundId
    } satisfies InputActionPayload);
  }

  pressLeft(): void {
    this.heldDirection = "left";
    this.send("left-start");
  }
  releaseLeft(): void {
    if (this.heldDirection === "left") {
      this.heldDirection = null;
      this.send("left-end");
    }
  }
  pressRight(): void {
    this.heldDirection = "right";
    this.send("right-start");
  }
  releaseRight(): void {
    if (this.heldDirection === "right") {
      this.heldDirection = null;
      this.send("right-end");
    }
  }
  jump(): void {
    this.send("jump");
  }

  releaseAll(): void {
    if (this.heldDirection === "left") this.send("left-end");
    if (this.heldDirection === "right") this.send("right-end");
    this.heldDirection = null;
  }
}

export function bindHoldButton(element: HTMLElement, onPress: () => void, onRelease: () => void): () => void {
  const down = (event: PointerEvent) => {
    event.preventDefault();
    // Touch pointers are implicitly captured by the element that received
    // pointerdown, so pointerleave never fires while dragging off the button
    // unless capture is explicitly released here — without this, "release by
    // sliding a finger off the button" silently only works for mouse input.
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    onPress();
  };
  const up = (event: Event) => {
    event.preventDefault();
    onRelease();
  };
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", up);
  element.addEventListener("pointerleave", up);
  return () => {
    element.removeEventListener("pointerdown", down);
    element.removeEventListener("pointerup", up);
    element.removeEventListener("pointercancel", up);
    element.removeEventListener("pointerleave", up);
  };
}
