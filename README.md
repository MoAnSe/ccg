# CCG Project

Minimal `Express + Socket.IO + Phaser` scaffold.

## Run

```bash
cd server
npm install
npm start
```

Open:

```text
http://localhost:3000
```

Expected result:

- server logs `join_lobby`
- client logs `lobby_joined`
- opening a second tab creates a second independent connection

## Render Deploy

This project is ready to deploy as one Render Web Service. The Node server serves the client files directly.

Render settings:

- Environment: `Node`
- Root Directory: repo root
- Build Command: `cd server && npm install`
- Start Command: `cd server && npm start`

Production behavior:

- The server listens on `process.env.PORT || 3000`
- The client connects to `window.location.origin`
- If `client/dist` exists later, the server serves it automatically
- Otherwise it serves `client/public` and exposes `/src` for the current Phaser entry

## Render Steps

1. Push this project to GitHub.
2. Log in to Render.
3. Click `New +` -> `Web Service`.
4. Connect your GitHub repo.
5. Choose the settings above.
6. Create the service and wait for deploy.
7. Open the Render URL and test with two browser tabs.

## Free Plan

As of March 20, 2026, Render documents a free tier for hobby-style web services, but it has limits:

- free services can spin down after inactivity
- there are usage limits
- free hosting is fine for testing and demos, but not for stable always-on play

Official docs:

- https://render.com/docs/deploy-node-express-app
- https://render.com/docs/web-services
- https://render.com/docs/free
