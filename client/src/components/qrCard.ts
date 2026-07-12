export function createQrCard(playerNumber: number, qrDataUrl: string, color: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "qr-card";
  wrapper.style.setProperty("--player-color", color);
  wrapper.innerHTML = `<img class="qr-card-image" src="${qrDataUrl}" alt="QR code to join as player ${playerNumber}" />`;
  return wrapper;
}
