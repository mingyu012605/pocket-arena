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
  it("prefers PUBLIC_BASE_URL when it is configured", async () => {
    process.env.PUBLIC_BASE_URL = "https://pocket-arena.onrender.com/";
    const { resolvePublicBaseUrl } = await import("./network");

    expect(resolvePublicBaseUrl({ requestOrigin: "https://browser.example", fallbackPort: 3000 })).toBe(
      "https://pocket-arena.onrender.com"
    );
  });

  it("uses the host browser origin for QR links", async () => {
    const { resolvePublicBaseUrl } = await import("./network");

    expect(resolvePublicBaseUrl({ requestOrigin: "https://live-pocket-arena.example", fallbackPort: 3000 })).toBe(
      "https://live-pocket-arena.example"
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
