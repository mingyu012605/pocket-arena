import { getSocket } from "../../networking/socket";
import { SOCKET_EVENTS } from "../../../../shared/protocol";
import type { RacingInputPayload } from "../../../../shared/protocol";
import type { MotionReading } from "./motion";

export class RacingInputSource {
  private sequence = 0;
  private roundId: string;

  constructor(roundId: string) {
    this.roundId = roundId;
  }

  send(reading: MotionReading): void {
    const socket = getSocket();
    if (!socket.connected) return;
    this.sequence += 1;
    socket.emit(SOCKET_EVENTS.RACING_INPUT, {
      steering: reading.steering,
      throttle: reading.throttle,
      brake: reading.brake,
      sequence: this.sequence,
      roundId: this.roundId
    } satisfies RacingInputPayload);
  }

  sendNeutral(): void {
    this.send({ steering: 0, throttle: 0, brake: 0 });
  }
}
