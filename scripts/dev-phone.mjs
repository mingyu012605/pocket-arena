import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 3000);
const ORIGIN = `http://localhost:${PORT}`;
const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

let tunnelProcess = null;
let serverProcess = null;
let stopping = false;
let publicUrl = "";
let logBuffer = "";

function findRecursively(root, filename) {
  if (!root || !fs.existsSync(root)) return null;

  const directories = [root];

  while (directories.length > 0) {
    const current = directories.pop();

    try {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);

        if (entry.isDirectory()) {
          directories.push(fullPath);
        } else if (entry.name.toLowerCase() === filename.toLowerCase()) {
          return fullPath;
        }
      }
    } catch {
      // Ignore folders that cannot be read.
    }
  }

  return null;
}

function findCloudflared() {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const located = spawnSync(locator, ["cloudflared"], {
    encoding: "utf8",
    windowsHide: true
  });

  if (located.status === 0 && located.stdout.trim()) {
    const result = located.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    if (result && fs.existsSync(result)) return result;
  }

  if (process.platform === "win32") {
    const candidates = [
      path.join(
        process.env.LOCALAPPDATA ?? "",
        "Microsoft",
        "WinGet",
        "Links",
        "cloudflared.exe"
      ),
      path.join(
        process.env.ProgramFiles ?? "",
        "cloudflared",
        "cloudflared.exe"
      )
    ];

    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) return candidate;
    }

    return findRecursively(
      path.join(
        process.env.LOCALAPPDATA ?? "",
        "Microsoft",
        "WinGet",
        "Packages"
      ),
      "cloudflared.exe"
    );
  }

  return null;
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(value);
    };

    const socket = net.createConnection({
      host: "127.0.0.1",
      port
    });

    socket.setTimeout(800);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function killProcessTree(child) {
  if (!child?.pid) return;

  if (process.platform === "win32") {
    spawnSync(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true }
    );
  } else {
    try {
      child.kill("SIGTERM");
    } catch {
      // Process already stopped.
    }
  }
}

function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;

  killProcessTree(serverProcess);
  killProcessTree(tunnelProcess);

  setTimeout(() => process.exit(exitCode), 100);
}

function inspectOutput(chunk, output) {
  const text = chunk.toString();
  output.write(text);

  logBuffer = `${logBuffer}${text}`.slice(-20000);

  const match = logBuffer.match(URL_PATTERN);

  if (!publicUrl && match) {
    publicUrl = match[0];

    console.log("\n==========================================");
    console.log(`Laptop: http://localhost:${PORT}`);
    console.log(`Phone:  ${publicUrl}`);
    console.log("QR codes will use the HTTPS phone address.");
    console.log("==========================================\n");

    const npmCommand =
      process.platform === "win32"
        ? (process.env.ComSpec ?? "cmd.exe")
        : "npm";

    const npmArgs =
      process.platform === "win32"
        ? ["/d", "/s", "/c", "npm run dev"]
        : ["run", "dev"];

    serverProcess = spawn(npmCommand, npmArgs, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PUBLIC_BASE_URL: publicUrl
      },
      stdio: "inherit",
      windowsHide: false
    });

    serverProcess.on("exit", (code) => {
      if (!stopping) shutdown(code ?? 0);
    });
  }
}

if (await isPortInUse(PORT)) {
  console.error(`Port ${PORT} is already in use.`);
  console.error("Stop the old npm server with Ctrl+C, then run this again.");
  process.exit(1);
}

const cloudflaredPath = findCloudflared();

if (!cloudflaredPath) {
  console.error("cloudflared is installed but could not be located.");
  console.error("Close PowerShell, reopen it, and run: where.exe cloudflared");
  process.exit(1);
}

console.log(`Using cloudflared: ${cloudflaredPath}`);
console.log(`Starting HTTPS tunnel to ${ORIGIN}...`);

tunnelProcess = spawn(
  cloudflaredPath,
  ["tunnel", "--url", ORIGIN, "--no-autoupdate"],
  {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  }
);

tunnelProcess.stdout.on("data", (chunk) => {
  inspectOutput(chunk, process.stdout);
});

tunnelProcess.stderr.on("data", (chunk) => {
  inspectOutput(chunk, process.stderr);
});

tunnelProcess.on("exit", (code) => {
  if (!stopping) {
    console.error(`Cloudflare tunnel stopped with code ${code ?? "unknown"}.`);
    shutdown(code ?? 1);
  }
});

const timeout = setTimeout(() => {
  if (!publicUrl) {
    console.error("Timed out waiting for the Cloudflare HTTPS URL.");
    shutdown(1);
  }
}, 60000);

timeout.unref();

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGHUP", () => shutdown(0));

