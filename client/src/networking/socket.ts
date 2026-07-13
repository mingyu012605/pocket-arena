import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const dev = new URLSearchParams(window.location.search).get("dev") === "1" ? "1" : "0";
    socket = io({ transports: ["websocket"], autoConnect: true, query: { dev } });
  }
  return socket;
}

export function emitWithAck<TResponse>(event: string, payload: unknown): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    getSocket().emit(event, payload, (response: TResponse) => {
      if (response && typeof response === "object" && "ok" in response && (response as { ok: boolean }).ok === false) {
        reject((response as unknown as { error: { message: string } }).error);
      } else {
        resolve(response);
      }
    });
  });
}
