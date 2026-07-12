import QRCode from "qrcode";
import type { CreateRoomSlot } from "../shared/protocol";
import type { InternalRoom } from "./types";

export async function buildSlotQrData(room: InternalRoom, baseUrl: string): Promise<CreateRoomSlot[]> {
  const slots: CreateRoomSlot[] = [];
  for (const player of room.players) {
    const joinUrl = `${baseUrl}/join/${room.id}/${player.playerNumber}?token=${player.token}`;
    const qrDataUrl = await QRCode.toDataURL(joinUrl, { margin: 1, width: 256 });
    slots.push({ playerNumber: player.playerNumber, joinUrl, qrDataUrl });
  }
  return slots;
}
