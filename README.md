# Pocket Arena

Turn every phone into a game controller. One laptop hosts the shared screen;
players join by scanning a QR code with their phones.

## Install

npm install

## Run (development)

npm run dev

This starts a single server on http://localhost:3000 that serves the
website and the Socket.IO game server together, with hot reload. On
startup the terminal prints:

Local:    http://localhost:3000
Network:  http://<your-lan-ip>:3000
QR codes will use: http://<your-lan-ip>:3000

Open the **Local** URL on the laptop that will host the game.

## Join from a phone on the same Wi-Fi

Phones do not type a URL — they scan the QR codes shown in the host lobby,
which are already generated against the printed **Network** URL. If you
need to override the address used for QR codes (e.g. a reverse proxy or a
non-standard network setup), set `PUBLIC_BASE_URL` before starting the
server:

PUBLIC_BASE_URL=http://192.168.1.50:3000 npm run dev

Both the laptop and the phones must be on the same Wi-Fi network, and any
firewall must allow inbound connections on the chosen port (3000 by
default).

## Build and run (production)

npm run build
NODE_ENV=production npm start

`npm run build` compiles the client with Vite and bundles the server with
esbuild into `dist/`. `npm start` runs the bundled `dist/server/index.js` —
one process, one port, the same `Local`/`Network`/`QR codes will use:`
banner as `npm run dev`. `NODE_ENV=production` matters: with it set, the
server serves the pre-built static files in `dist/client/` (with an SPA
fallback to `index.html` for client-side routes); without it, the server
falls back to the same Vite dev middleware `npm run dev` uses. Always set
`NODE_ENV=production` when running the built output.

## Type-checking and tests

npm run typecheck
npm test
