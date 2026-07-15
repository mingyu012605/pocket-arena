import QRCode from "qrcode";
import type { CreateRoomSlot } from "../shared/protocol";
import type { InternalRoom } from "./types";

export async function buildSlotQrData(room: InternalRoom, baseUrl: string): Promise<CreateRoomSlot[]> {
  const slots: CreateRoomSlot[] = [];
  const joinUrl = `${baseUrl}/join/${room.id}`;
  console.info("[qr] generated join URL", { roomId: room.id, joinUrl });
  const qrDataUrl = await QRCode.toDataURL(joinUrl, { margin: 1, width: 256 });
  for (const player of room.players) {
    slots.push({ playerNumber: player.playerNumber, joinUrl, qrDataUrl, token: player.token });
  }
  return slots;
}
