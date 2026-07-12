import { createButton } from "../components/button";
import { navigate } from "../networking/router";
import type { CleanupFn, RouteContext } from "../networking/router";

const STEPS = [
  "Open Pocket Arena on a laptop",
  "Choose a game",
  "Friends scan the QR code",
  "Phones become controllers",
  "Start playing"
];

export function renderLandingPage({ container }: RouteContext): CleanupFn | void {
  container.innerHTML = `
    <section class="hero">
      <p class="eyebrow">POCKET ARENA</p>
      <h1 class="hero-title">Turn Every Phone Into a <span class="glow-text">Controller</span></h1>
      <p class="hero-copy">
        One laptop hosts the shared screen. Friends scan a QR code with their phones
        to join instantly as controllers — no apps, no accounts.
      </p>
      <div class="hero-actions" id="hero-actions"></div>
    </section>
    <section class="how-it-works" id="how-it-works">
      <h2>How It Works</h2>
      <ol class="steps"></ol>
    </section>
  `;

  const actions = container.querySelector<HTMLDivElement>("#hero-actions")!;
  actions.appendChild(createButton({ label: "Host a Game", variant: "primary", onClick: () => navigate("/host") }));
  actions.appendChild(
    createButton({
      label: "How It Works",
      variant: "secondary",
      onClick: () => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })
    })
  );

  const list = container.querySelector<HTMLOListElement>(".steps")!;
  STEPS.forEach((step, index) => {
    const li = document.createElement("li");
    li.className = "step-card";
    li.innerHTML = `<span class="step-index">${index + 1}</span><span>${step}</span>`;
    list.appendChild(li);
  });
}
