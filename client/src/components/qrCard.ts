export function createQrCard(playerNumber: number, qrDataUrl: string, joinUrl: string, color: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "qr-card";
  wrapper.style.setProperty("--player-color", color);
  wrapper.innerHTML = `
    <img class="qr-card-image" src="${qrDataUrl}" alt="QR code to join as player ${playerNumber}" />
    <p class="qr-card-url"></p>
  `;
  wrapper.querySelector<HTMLParagraphElement>(".qr-card-url")!.textContent = joinUrl;
  return wrapper;
}
