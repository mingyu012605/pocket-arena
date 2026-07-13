import { networkInterfaces } from "node:os";

export interface ResolvedUrls {
  localUrl: string;
  lanUrl: string | null;
  publicUrl: string;
}

export function detectLanAddress(): string | null {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

export function resolveUrls(port: number, protocol = "http"): ResolvedUrls {
  const localUrl = `${protocol}://localhost:${port}`;
  const lanAddress = detectLanAddress();
  const lanUrl = lanAddress ? `${protocol}://${lanAddress}:${port}` : null;
  const override = process.env.PUBLIC_BASE_URL?.trim();
  const publicUrl = override && override.length > 0 ? override.replace(/\/$/, "") : (lanUrl ?? localUrl);
  return { localUrl, lanUrl, publicUrl };
}
