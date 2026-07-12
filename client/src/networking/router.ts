export type CleanupFn = () => void;

export interface RouteContext {
  container: HTMLElement;
  params: Record<string, string>;
  query: URLSearchParams;
}

export type RouteHandler = (ctx: RouteContext) => CleanupFn | void;

interface Route {
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
}

const routes: Route[] = [];
let activeCleanup: CleanupFn | null = null;
let container: HTMLElement | null = null;

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const pattern = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        keys.push(segment.slice(1));
        return "/([^/]+)";
      }
      return segment ? `/${segment}` : "";
    })
    .join("");
  return { pattern: new RegExp(`^${pattern || "/"}$`), keys };
}

export function registerRoute(path: string, handler: RouteHandler): void {
  const { pattern, keys } = compile(path);
  routes.push({ pattern, keys, handler });
}

function render(): void {
  if (!container) return;
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
  const url = new URL(window.location.href);
  for (const route of routes) {
    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((key, i) => {
      const value = match[i + 1];
      if (value !== undefined) params[key] = value;
    });
    container.innerHTML = "";
    const cleanup = route.handler({ container, params, query: url.searchParams });
    activeCleanup = cleanup ?? null;
    return;
  }
  container.innerHTML = `<div class="page-section centered"><h1>Page Not Found</h1><a href="/" data-link>Back to Pocket Arena</a></div>`;
}

export function navigate(path: string): void {
  window.history.pushState({}, "", path);
  render();
}

export function startRouter(rootElement: HTMLElement): void {
  container = rootElement;
  window.addEventListener("popstate", render);
  document.addEventListener("click", (event) => {
    const anchor = (event.target as HTMLElement).closest("a[data-link]");
    if (anchor instanceof HTMLAnchorElement) {
      event.preventDefault();
      navigate(anchor.getAttribute("href") ?? "/");
    }
  });
  render();
}
