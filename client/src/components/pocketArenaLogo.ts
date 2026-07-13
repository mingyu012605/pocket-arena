export function createPocketArenaLogo(): HTMLAnchorElement {
  const logo = document.createElement("a");
  logo.href = "/host";
  logo.dataset.link = "true";
  logo.className = "pa-logo";
  logo.setAttribute("aria-label", "Pocket Arena home");
  logo.innerHTML = `
    <span class="pa-logo-trail" aria-hidden="true"></span>
    <span class="pa-logo-star" aria-hidden="true"></span>
    <span class="pa-logo-text">
      <span>POCKET</span>
      <span>ARENA</span>
    </span>
  `;
  return logo;
}
