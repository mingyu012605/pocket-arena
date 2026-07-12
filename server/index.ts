import express from "express";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Server } from "socket.io";
import { resolveUrls } from "./network";
import { registerSocketHandlers } from "./socketHandlers";

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: "*" } });

  registerSocketHandlers(io, port);

  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom"
    });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      try {
        const indexPath = path.resolve(process.cwd(), "client/index.html");
        let template = await fs.readFile(indexPath, "utf-8");
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (err) {
        next(err as Error);
      }
    });
  } else {
    const clientDist = path.resolve(process.cwd(), "dist/client");
    app.use(express.static(clientDist));
    app.get(/^(?!\/socket\.io).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  httpServer.listen(port, "0.0.0.0", () => {
    const { localUrl, lanUrl, publicUrl } = resolveUrls(port);
    console.log(`Local:    ${localUrl}`);
    console.log(`Network:  ${lanUrl ?? "(no LAN address detected)"}`);
    console.log(`QR codes will use: ${publicUrl}`);
  });
}

main();
