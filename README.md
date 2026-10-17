# Austin's Fantasy DD's

An online table game for up to 6 players. Each player has a wing-nut launcher on the rim of a round arena. It sweeps back and forth; tap to fire a harpoon arrow, lead your shot, and reel DD's home. DD's are worth 1, 2, 3 or 5 points, and power-ups give triple shot (5s) or no reload (4s).

## Play

- **Online:** one person taps *Create online game* and shares the 4-letter room code (or the link). Friends join from their own phones. The host can fill empty seats with CPU players.
- **On one device:** *Play on this device*, up to 6 seats, each Player / CPU / Off.

## How it's built

- `public/index.html`: the game client (menus, rendering, input).
- `public/sim.js`: the game rules, shared by the browser (local play) and the server (online play).
- `server.js`: serves `public/` and runs game rooms over WebSockets at `/ws`. The server owns the game state and sends snapshots 30 times a second.
- `minews.js`: a small built-in WebSocket implementation, so there are no npm dependencies.

Run locally with `npm start` (port 3000).

## Hosting

Render web service `austins-fantasy-dds-live` (Node, `npm start`). Pushing to `main` redeploys it. The older static site `austins-fantasy-dds` serves the same page and connects to the live server for online games.
