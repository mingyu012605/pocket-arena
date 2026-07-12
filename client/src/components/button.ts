export interface ButtonOptions {
  label: string;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  onClick?: () => void;
}

export function createButton(options: ButtonOptions): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = `btn btn-${options.variant ?? "primary"}`;
  button.textContent = options.label;
  button.disabled = Boolean(options.disabled);
  if (options.onClick) button.addEventListener("click", options.onClick);
  return button;
}
