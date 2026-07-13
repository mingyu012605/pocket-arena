import { networkInterfaces } from "node:os";

type HeaderValue = string | string[] | undefined;

export interface ResolvedUrls {
  localUrl: string;
  lanUrl: string | null;
  publicUrl: string;
}

export function detectLanAddress(): string | null {
  const interfaces = networkInterfaces();
  const candidates: Array<{ name: string; address: string; score: number }> = [];
  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase();
    for (const iface of interfaces[name] ?? []) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      if (iface.address.startsWith("169.254.")) continue;
      let score = 0;
      if (/\b(wi-?fi|wlan|wireless|ethernet|en\d|eth\d)\b/i.test(name)) score += 20;
      if (iface.address !== "0.0.0.0") score += 5;
      if (lowerName.includes("vethernet") || lowerName.includes("wsl") || lowerName.includes("hyper-v")) score -= 50;
      if (lowerName.includes("virtual") || lowerName.includes("vmware") || lowerName.includes("virtualbox")) score -= 40;
      if (lowerName.includes("docker") || lowerName.includes("loopback")) score -= 40;
      candidates.push({ name, address: iface.address, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return candidates[0]?.address ?? null;
}

export function resolveUrls(port: number, protocol = "http"): ResolvedUrls {
  const localUrl = `${protocol}://localhost:${port}`;
  const lanAddress = detectLanAddress();
  const lanUrl = lanAddress ? `${protocol}://${lanAddress}:${port}` : null;
  const publicUrl = normalizeBaseUrl(process.env.PUBLIC_BASE_URL) ?? lanUrl ?? localUrl;
  return { localUrl, lanUrl, publicUrl };
}

export function normalizeBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function firstHeader(value: HeaderValue): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",")[0]?.trim() || null;
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "::1" ||
    lower.startsWith("192.168.") ||
    lower.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)
  );
}

function shouldPreferForwardedHttps(origin: string | null, forwarded: string | null): boolean {
  if (!origin || !forwarded) return false;
  try {
    const originUrl = new URL(origin);
    const forwardedUrl = new URL(forwarded);
    return forwardedUrl.protocol === "https:" && (originUrl.protocol !== "https:" || isLocalOrPrivateHost(originUrl.hostname));
  } catch {
    return false;
  }
}

export function resolvePublicBaseUrl(options: {
  requestOrigin?: string | null;
  forwardedProto?: HeaderValue;
  forwardedHost?: HeaderValue;
  host?: HeaderValue;
  fallbackPort: number;
  fallbackProtocol?: string;
}): string {
  const override = normalizeBaseUrl(process.env.PUBLIC_BASE_URL);
  if (override) return override;

  const origin = normalizeBaseUrl(options.requestOrigin);

  const forwardedProto = firstHeader(options.forwardedProto);
  const forwardedHost = firstHeader(options.forwardedHost);
  let fromProxy: string | null = null;
  if (forwardedProto && forwardedHost) {
    fromProxy = normalizeBaseUrl(`${forwardedProto}://${forwardedHost}`);
  }
  if (shouldPreferForwardedHttps(origin, fromProxy)) return fromProxy!;
  if (origin) return origin;
  if (fromProxy) return fromProxy;

  const host = firstHeader(options.host);
  if (host) {
    const protocol = options.fallbackProtocol ?? "http";
    const fromHost = normalizeBaseUrl(`${protocol}://${host}`);
    if (fromHost) return fromHost;
  }

  return resolveUrls(options.fallbackPort, options.fallbackProtocol ?? "http").publicUrl;
}
