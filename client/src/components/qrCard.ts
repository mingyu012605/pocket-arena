export function createQrCard(playerNumber: number, qrDataUrl: string, joinUrl: string, color: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "qr-card";
  wrapper.style.setProperty("--player-color", color);
  wrapper.innerHTML = `
    <img class="qr-card-image" src="${qrDataUrl}" alt="QR code to join as player ${playerNumber}" />
    <p class="qr-card-url"></p>
  `;
  wrapper.dataset.joinUrl = joinUrl;
  wrapper.querySelector<HTMLParagraphElement>(".qr-card-url")!.textContent = joinUrl;
  console.info("[Pocket Arena] QR join URL", { playerNumber, joinUrl });
  return wrapper;
}
