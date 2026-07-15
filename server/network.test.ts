import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:os", () => ({
  networkInterfaces: () => ({
    "vEthernet (WSL (Hyper-V firewall))": [
      { family: "IPv4", internal: false, address: "172.29.64.1" }
    ],
    "Wi-Fi": [
      { family: "IPv4", internal: false, address: "10.0.0.24" }
    ]
  })
}));

afterEach(() => {
  delete process.env.PUBLIC_BASE_URL;
});

describe("detectLanAddress", () => {
  it("prefers reachable Wi-Fi addresses over WSL virtual adapters", async () => {
    const { detectLanAddress } = await import("./network");

    expect(detectLanAddress()).toBe("10.0.0.24");
  });
});

describe("resolvePublicBaseUrl", () => {
  it("uses PUBLIC_BASE_URL when no browser origin is available", async () => {
    process.env.PUBLIC_BASE_URL = "https://pocket-arena.onrender.com/";
    const { resolvePublicBaseUrl } = await import("./network");

    expect(resolvePublicBaseUrl({ fallbackPort: 3000 })).toBe("https://pocket-arena.onrender.com");
  });

  it("keeps the live HTTPS browser origin over PUBLIC_BASE_URL", async () => {
    process.env.PUBLIC_BASE_URL = "https://pocket-arena.onrender.com/";
    const { resolvePublicBaseUrl } = await import("./network");

    expect(resolvePublicBaseUrl({ requestOrigin: "https://fine-weeks-travel.trycloudflare.com", fallbackPort: 3000 })).toBe(
      "https://fine-weeks-travel.trycloudflare.com"
    );
  });

  it("does not let a local PUBLIC_BASE_URL override a phone-safe tunnel origin", async () => {
    process.env.PUBLIC_BASE_URL = "http://127.0.0.1:3000/";
    const { resolvePublicBaseUrl } = await import("./network");

    expect(resolvePublicBaseUrl({ requestOrigin: "https://demo.trycloudflare.com", fallbackPort: 3000 })).toBe(
      "https://demo.trycloudflare.com"
    );
  });

  it("uses the host browser origin for QR links", async () => {
    const { resolvePublicBaseUrl } = await import("./network");

    expect(resolvePublicBaseUrl({ requestOrigin: "https://live-pocket-arena.example", fallbackPort: 3000 })).toBe(
      "https://live-pocket-arena.example"
    );
  });

  it("keeps a published HTTPS browser origin even when proxy headers are present", async () => {
    const { resolvePublicBaseUrl } = await import("./network");

    expect(
      resolvePublicBaseUrl({
        requestOrigin: "https://pocketarena.app",
        forwardedProto: "https",
        forwardedHost: "internal-proxy.example",
        fallbackPort: 3000
      })
    ).toBe("https://pocketarena.app");
  });

  it("uses forwarded HTTPS instead of accidental localhost QR origins", async () => {
    const { resolvePublicBaseUrl } = await import("./network");

    expect(
      resolvePublicBaseUrl({
        requestOrigin: "http://localhost:3000",
        forwardedProto: "https",
        forwardedHost: "demo.trycloudflare.com",
        fallbackPort: 3000
      })
    ).toBe("https://demo.trycloudflare.com");
  });

  it("does not encode localhost into phone QR links when a LAN fallback exists", async () => {
    const { resolvePublicBaseUrl } = await import("./network");

    expect(resolvePublicBaseUrl({ requestOrigin: "http://127.0.0.1:3000", fallbackPort: 3000 })).toBe(
      "http://10.0.0.24:3000"
    );
  });

  it("falls back to reverse proxy headers when no origin is available", async () => {
    const { resolvePublicBaseUrl } = await import("./network");

    expect(
      resolvePublicBaseUrl({
        forwardedProto: "https",
        forwardedHost: "render-proxy.example",
        host: "internal:3000",
        fallbackPort: 3000
      })
    ).toBe("https://render-proxy.example");
  });
});
