import { io } from "https://cdn.socket.io/4.8.1/socket.io.esm.min.js";

const appState = {
  socket: null,
  sessionId: null,
  roomId: null,
  playerIndex: null,
  readyPlayers: [],
  initialGameState: null
};

class LobbyScene extends Phaser.Scene {
  constructor() {
    super("LobbyScene");
    this.statusText = null;
    this.sessionText = null;
    this.matchText = null;
  }

  create() {
    this.add.rectangle(480, 320, 960, 640, 0x121826, 1);
    this.add.text(480, 150, "CCG Lobby", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "40px",
      color: "#ffffff",
      fontStyle: "bold"
    }).setOrigin(0.5);

    this.statusText = this.add.text(480, 260, "Connecting to server...", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "26px",
      color: "#c8d2ea"
    }).setOrigin(0.5);

    this.sessionText = this.add.text(480, 320, "sessionId: pending", {
      fontFamily: "Consolas, monospace",
      fontSize: "22px",
      color: "#9fb2df"
    }).setOrigin(0.5);

    this.matchText = this.add.text(480, 372, "Waiting for second player...", {
      fontFamily: "Consolas, monospace",
      fontSize: "20px",
      color: "#f0d89c"
    }).setOrigin(0.5);

    this.add.text(480, 420, "Open this page in a second tab to verify two clients can connect.", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "18px",
      color: "#97a6c9",
      align: "center",
      wordWrap: { width: 620 }
    }).setOrigin(0.5);

    if (!appState.socket) {
      appState.socket = io({
        transports: ["websocket", "polling"]
      });
    }

    appState.socket.on("connect", () => {
      this.statusText.setText("Connected. Sending join_lobby...");
      console.log("[client] connected", appState.socket.id);
      appState.socket.emit("join_lobby");
    });

    appState.socket.on("lobby_joined", ({ sessionId }) => {
      appState.sessionId = sessionId;
      this.statusText.setText("Lobby joined");
      this.sessionText.setText(`sessionId: ${sessionId}`);
      console.log("[client] lobby_joined", sessionId);
    });

    appState.socket.on("match_found", ({ roomId, yourPlayerIndex }) => {
      appState.roomId = roomId;
      appState.playerIndex = yourPlayerIndex;
      console.log("[client] match_found", roomId, yourPlayerIndex);
      this.scene.start("SetupScene");
    });

    appState.socket.on("disconnect", (reason) => {
      this.statusText.setText(`Disconnected: ${reason}`);
      console.log("[client] disconnected", reason);
    });
  }
}

class SetupScene extends Phaser.Scene {
  constructor() {
    super("SetupScene");
    this.infoText = null;
    this.readyText = null;
  }

  create() {
    this.add.rectangle(480, 320, 960, 640, 0x17202d, 1);
    this.add.text(480, 120, "Setup Scene", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "38px",
      color: "#ffffff",
      fontStyle: "bold"
    }).setOrigin(0.5);

    this.infoText = this.add.text(480, 210, `roomId: ${appState.roomId}\nplayerIndex: ${appState.playerIndex}`, {
      fontFamily: "Consolas, monospace",
      fontSize: "24px",
      color: "#c8d2ea",
      align: "center",
      lineSpacing: 10
    }).setOrigin(0.5);

    this.readyText = this.add.text(480, 320, "Ready state: waiting", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "24px",
      color: "#f0d89c"
    }).setOrigin(0.5);

    this.add.text(480, 410, "This stage sends a dummy 10-card setup to the server.\nPress the button in both tabs to trigger game_start.", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "18px",
      color: "#9fb2df",
      align: "center",
      wordWrap: { width: 700 }
    }).setOrigin(0.5);

    const confirmButton = this.add.rectangle(480, 520, 240, 58, 0x2f6b52, 1).setInteractive({ useHandCursor: true });
    confirmButton.setStrokeStyle(2, 0x9ff3c9, 0.9);
    this.add.text(480, 520, "Send setup_confirm", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "22px",
      color: "#ffffff",
      fontStyle: "bold"
    }).setOrigin(0.5);

    const cards = Array.from({ length: 10 }, (_, index) => ({
      slotIndex: index,
      cardId: `card-${appState.playerIndex}-${index + 1}`
    }));
    appState.socket.emit("setup_place_cards", { cards });

    confirmButton.on("pointerdown", () => {
      appState.socket.emit("setup_confirm");
    });

    appState.socket.off("setup_ready_state");
    appState.socket.off("game_start");

    appState.socket.on("setup_ready_state", ({ players }) => {
      appState.readyPlayers = players;
      const readyLabel = players.map((player) => `P${player.playerIndex}: ${player.ready ? "ready" : "waiting"}`).join(" | ");
      this.readyText.setText(`Ready state: ${readyLabel}`);
      console.log("[client] setup_ready_state", players);
    });

    appState.socket.on("game_start", (initialState) => {
      appState.initialGameState = initialState;
      console.log("[client] game_start", initialState);
      this.scene.start("GameScene");
    });
  }
}

class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");
  }

  create() {
    this.add.rectangle(480, 320, 960, 640, 0x101826, 1);
    this.add.text(480, 140, "Game Scene", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "38px",
      color: "#ffffff",
      fontStyle: "bold"
    }).setOrigin(0.5);

    this.add.text(480, 280, `game_start received\nroomId: ${appState.initialGameState?.roomId ?? "unknown"}`, {
      fontFamily: "Consolas, monospace",
      fontSize: "24px",
      color: "#c8d2ea",
      align: "center",
      lineSpacing: 10
    }).setOrigin(0.5);

    this.add.text(480, 420, JSON.stringify(appState.initialGameState, null, 2), {
      fontFamily: "Consolas, monospace",
      fontSize: "16px",
      color: "#9fb2df",
      align: "center"
    }).setOrigin(0.5);
  }
}

const config = {
  type: Phaser.AUTO,
  width: 960,
  height: 640,
  parent: "game-root",
  backgroundColor: "#10131a",
  scene: [LobbyScene, SetupScene, GameScene]
};

new Phaser.Game(config);
