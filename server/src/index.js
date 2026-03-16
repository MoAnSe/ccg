import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { GameManager } from "./gameManager.js";
import { createInitialGameState } from "./gameState.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const clientPublicDir = path.join(rootDir, "client", "public");
const clientSrcDir = path.join(rootDir, "client", "src");

const app = express();
const httpServer = createServer(app);
const gameManager = new GameManager();
const io = new Server(httpServer, {
  cors: {
    origin: true
  }
});

app.use(express.static(clientPublicDir));

// Expose the frontend source entry so the static index can load the Phaser bootstrap.
app.use("/src", express.static(clientSrcDir));

app.get("/", (_req, res) => {
  res.sendFile(path.join(clientPublicDir, "index.html"));
});

io.on("connection", (socket) => {
  console.log(`[socket] connected ${socket.id}`);

  socket.on("join_lobby", () => {
    const sessionId = socket.id;
    console.log(`[socket] join_lobby from ${socket.id}`);
    socket.emit("lobby_joined", { sessionId });

    const session = gameManager.addPlayerToLobby(socket);
    if (!session) {
      return;
    }

    session.players.forEach((player) => {
      const playerSocket = io.sockets.sockets.get(player.socketId);
      if (!playerSocket) {
        return;
      }

      playerSocket.join(session.roomId);
      playerSocket.emit("match_found", {
        roomId: session.roomId,
        yourPlayerIndex: player.playerIndex
      });
    });
  });

  socket.on("setup_place_cards", ({ cards }) => {
    const session = gameManager.savePlacedCards(socket.id, cards);
    if (!session) {
      return;
    }

    console.log(`[socket] setup_place_cards from ${socket.id} in ${session.roomId}`);
  });

  socket.on("setup_confirm", () => {
    const session = gameManager.confirmSetup(socket.id);
    if (!session) {
      return;
    }

    console.log(`[socket] setup_confirm from ${socket.id} in ${session.roomId}`);

    io.to(session.roomId).emit("setup_ready_state", {
      roomId: session.roomId,
      players: session.players.map((player) => ({
        playerIndex: player.playerIndex,
        ready: player.ready
      }))
    });

    if (!gameManager.areAllPlayersReady(session.roomId)) {
      return;
    }

    const initialState = createInitialGameState(session);
    io.to(session.roomId).emit("game_start", initialState);
  });

  socket.on("disconnect", (reason) => {
    console.log(`[socket] disconnected ${socket.id}: ${reason}`);
    gameManager.removeSocket(socket.id);
  });
});

const PORT = 3000;
httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
