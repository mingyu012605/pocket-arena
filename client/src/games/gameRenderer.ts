export interface GameRenderer<TState> {
  mount(container: HTMLElement): void;
  applyState(state: TState): void;
  render(timestamp: number): void;
  destroy(): void;
}
