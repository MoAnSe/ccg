import express from "express";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { GameManager } from "./gameManager.js";
import { activateCardAction, applyAttack, createInitialGameState, createPlayerView } from "./gameState.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const clientBuildDir = path.join(rootDir, "client", "dist");
const clientPublicDir = path.join(rootDir, "client", "public");
const clientSrcDir = path.join(rootDir, "client", "src");
const clientStaticDir = existsSync(clientBuildDir) ? clientBuildDir : clientPublicDir;
const cardDefinitionsPath = path.join(__dirname, "cards", "card_definitions.json");
const cardDefinitions = JSON.parse(readFileSync(cardDefinitionsPath, "utf-8"));

const app = express();
const httpServer = createServer(app);
const gameManager = new GameManager();
const io = new Server(httpServer, {
  cors: {
    origin: true
  }
});

app.use(express.static(clientStaticDir));

if (!existsSync(clientBuildDir)) {
  // Local development fallback while the client has no dedicated build step.
  app.use("/src", express.static(clientSrcDir));
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(clientStaticDir, "index.html"));
});

app.get("/api/card-definitions", (_req, res) => {
  res.json(cardDefinitions);
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
    const result = gameManager.savePlacedCards(socket.id, cards);
    if (!result?.ok) {
      socket.emit("setup_error", {
        message: result?.error || "Invalid setup payload."
      });
      return;
    }

    console.log(`[socket] setup_place_cards from ${socket.id} in ${result.session.roomId}`);
    socket.emit("setup_saved", {
      roomId: result.session.roomId
    });
  });

  socket.on("setup_confirm", () => {
    const result = gameManager.confirmSetup(socket.id);
    if (!result?.ok) {
      socket.emit("setup_error", {
        message: result?.error || "Unable to confirm setup."
      });
      return;
    }

    const { session } = result;
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

    session.gameState = createInitialGameState(session, cardDefinitions);
    session.players.forEach((player) => {
      const playerSocket = io.sockets.sockets.get(player.socketId);
      if (!playerSocket) {
        return;
      }

      playerSocket.emit("game_start", createPlayerView(session.gameState, player.playerIndex));
    });
  });

  socket.on("attack", ({ attackerSlot, targetSlot }) => {
    const lookup = gameManager.getPlayerBySocket(socket.id);
    if (!lookup) {
      socket.emit("action_error", { message: "Player session not found." });
      return;
    }

    const { session, player } = lookup;
    if (!session.gameState) {
      socket.emit("action_error", { message: "Game has not started yet." });
      return;
    }

    if (session.gameState.turnPlayerIndex !== player.playerIndex) {
      socket.emit("action_error", { message: "It is not your turn." });
      return;
    }

    const result = applyAttack(session.gameState, attackerSlot, targetSlot);
    if (!result.ok) {
      socket.emit("action_error", { message: result.error || "Attack failed." });
      return;
    }

    session.players.forEach((entry) => {
      const playerSocket = io.sockets.sockets.get(entry.socketId);
      if (!playerSocket) {
        return;
      }

      playerSocket.emit("state_update", createPlayerView(session.gameState, entry.playerIndex));
    });
  });

  socket.on("activate_card_action", ({ slotIndex }) => {
    const lookup = gameManager.getPlayerBySocket(socket.id);
    if (!lookup) {
      socket.emit("action_error", { message: "Player session not found." });
      return;
    }

    const { session, player } = lookup;
    if (!session.gameState) {
      socket.emit("action_error", { message: "Game has not started yet." });
      return;
    }

    if (session.gameState.turnPlayerIndex !== player.playerIndex) {
      socket.emit("action_error", { message: "It is not your turn." });
      return;
    }

    const result = activateCardAction(session.gameState, slotIndex);
    if (!result.ok) {
      socket.emit("action_error", { message: result.error || "Card action failed." });
      return;
    }

    session.players.forEach((entry) => {
      const playerSocket = io.sockets.sockets.get(entry.socketId);
      if (!playerSocket) {
        return;
      }

      playerSocket.emit("state_update", createPlayerView(session.gameState, entry.playerIndex));
    });
  });

  socket.on("selection_update", ({ attackerSlot, targetSlot }) => {
    const lookup = gameManager.getPlayerBySocket(socket.id);
    if (!lookup) {
      return;
    }

    const { session, player } = lookup;
    io.to(session.roomId).emit("selection_update", {
      playerIndex: player.playerIndex,
      attackerSlot,
      targetSlot
    });
  });

  socket.on("restart_match", () => {
    const lookup = gameManager.getPlayerBySocket(socket.id);
    if (!lookup) {
      socket.emit("action_error", { message: "Player session not found." });
      return;
    }

    const { session } = lookup;
    gameManager.resetSession(session.roomId);
    io.to(session.roomId).emit("return_to_setup", {
      roomId: session.roomId,
      players: session.players.map((player) => ({
        playerIndex: player.playerIndex,
        ready: player.ready
      }))
    });
  });

  socket.on("disconnect", (reason) => {
    console.log(`[socket] disconnected ${socket.id}: ${reason}`);
    gameManager.removeSocket(socket.id);
  });
});

const PORT = Number(process.env.PORT) || 3000;
httpServer.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});
