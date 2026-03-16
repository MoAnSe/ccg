import { io } from "https://cdn.socket.io/4.8.1/socket.io.esm.min.js";

const appState = {
  socket: null,
  sessionId: null,
  roomId: null,
  playerIndex: null,
  readyPlayers: [],
  initialGameState: null,
  currentGameState: null,
  cardDefinitions: []
};

function shuffleArray(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function formatStatusLabel(status) {
  if (!status) {
    return "";
  }

  switch (status.id) {
    case "shield-one":
      return "Shield";
    case "plague":
      return "Plague";
    case "poison":
      return `Poison ${status.turnsRemaining ?? ""}`.trim();
    case "ranger-aim":
      return "Aiming";
    default:
      return status.id;
  }
}

function formatEventLabel(event) {
  switch (event.type) {
    case "revealed":
      return `Reveal P${event.owner} S${event.slotIndex + 1}`;
    case "damage":
      return `Hit P${event.attacker.owner} S${event.attacker.slotIndex + 1} / P${event.target.owner} S${event.target.slotIndex + 1}`;
    case "died":
      return `Dead P${event.owner} S${event.slotIndex + 1}`;
    case "statusApplied":
      return `${formatStatusLabel({ id: event.statusId })} -> P${event.owner} S${event.slotIndex + 1}`;
    case "statusTick":
      return `${formatStatusLabel({ id: event.statusId, turnsRemaining: event.turnsRemaining })} tick P${event.owner} S${event.slotIndex + 1}`;
    case "buffApplied":
      return `Buff P${event.owner} S${event.slotIndex + 1} +${event.atk}/+${event.hp}`;
    case "effectDamage":
      return `Effect ${event.amount} dmg P${event.owner} S${event.slotIndex + 1}`;
    case "statsTransferred":
      return `Transfer -> P${event.toOwner} S${event.toSlotIndex + 1}`;
    case "turnBehaviorMutated":
      return `Aiming P${event.owner} S${event.slotIndex + 1}`;
    case "plagueIntercept":
      return `Plague kill P${event.attackerOwner} S${event.attackerSlotIndex + 1}`;
    case "shieldConsumed":
      return `Shield block P${event.owner} S${event.slotIndex + 1}`;
    case "rangerShot":
      return `Shot P${event.attackerOwner} S${event.attackerSlotIndex + 1} -> S${event.targetSlotIndex + 1}`;
    default:
      return event.type;
  }
}

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
    this.statusText = null;
    this.selectedCardView = null;
    this.slotViews = [];
    this.cardViews = [];
    this.currentLayout = [];
  }

  async create() {
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

    this.readyText = this.add.text(480, 92, "Ready state: waiting", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "20px",
      color: "#f0d89c"
    }).setOrigin(0.5);

    this.statusText = this.add.text(480, 560, "Loading cards...", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "18px",
      color: "#9ff3c9",
      align: "center",
      wordWrap: { width: 700 }
    }).setOrigin(0.5);

    this.add.text(480, 590, "Click a card, then click a slot to place it. Reclick another slot to move it.", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "16px",
      color: "#9fb2df",
      align: "center"
    }).setOrigin(0.5);

    const confirmButton = this.add.rectangle(780, 560, 240, 58, 0x2f6b52, 1).setInteractive({ useHandCursor: true });
    confirmButton.setStrokeStyle(2, 0x9ff3c9, 0.9);
    this.add.text(780, 560, "Confirm", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "22px",
      color: "#ffffff",
      fontStyle: "bold"
    }).setOrigin(0.5);

    confirmButton.on("pointerdown", () => {
      const cards = this.buildPlacementPayload();
      if (!cards) {
        this.statusText.setText("Place all 10 cards into unique slots before confirming.");
        this.statusText.setColor("#ffb0b0");
        return;
      }

      appState.socket.emit("setup_place_cards", { cards });
      appState.socket.emit("setup_confirm");
    });

    appState.socket.off("setup_ready_state");
    appState.socket.off("game_start");
    appState.socket.off("setup_error");
    appState.socket.off("setup_saved");

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

    appState.socket.on("setup_saved", () => {
      this.statusText.setText("Setup sent to server. Waiting for confirmations.");
      this.statusText.setColor("#9ff3c9");
    });

    appState.socket.on("setup_error", ({ message }) => {
      this.statusText.setText(message);
      this.statusText.setColor("#ffb0b0");
      console.log("[client] setup_error", message);
    });

    if (!appState.cardDefinitions.length) {
      const response = await fetch("/api/card-definitions");
      const payload = await response.json();
      appState.cardDefinitions = payload.cards;
    }

    this.createSlots();
    this.createCards();
    this.statusText.setText("Arrange your 10 cards, then press Confirm.");
  }

  createSlots() {
    const startX = 220;
    const startY = 180;
    const gapX = 110;
    const gapY = 130;

    for (let slotIndex = 0; slotIndex < 10; slotIndex += 1) {
      const row = Math.floor(slotIndex / 5);
      const col = slotIndex % 5;
      const x = startX + col * gapX;
      const y = startY + row * gapY;
      const slot = this.add.rectangle(x, y, 92, 112, 0x20283a, 0.95)
        .setStrokeStyle(2, 0x6d85ba, 0.9)
        .setInteractive({ useHandCursor: true });
      const label = this.add.text(x, y + 68, `Slot ${slotIndex + 1}`, {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: "14px",
        color: "#c8d2ea"
      }).setOrigin(0.5);

      slot.on("pointerdown", () => {
        if (!this.selectedCardView) {
          return;
        }
        this.placeCardInSlot(this.selectedCardView, slotIndex);
      });

      this.slotViews.push({ slotIndex, x, y, slot, label });
    }
  }

  createCards() {
    const selectedCards = shuffleArray(appState.cardDefinitions).slice(0, 10).map((card, index) => ({
      ...card,
      runtimeId: `${card.id}-${index}`,
      slotIndex: null
    }));
    this.currentLayout = selectedCards;

    const startX = 120;
    const y = 430;
    const gapX = 82;

    selectedCards.forEach((card, index) => {
      const x = startX + index * gapX;
      const view = this.createCardView(card, x, y);
      this.cardViews.push(view);
    });
  }

  createCardView(card, x, y) {
    const container = this.add.container(x, y);
    const body = this.add.rectangle(0, 0, 72, 96, 0x456286, 0.98);
    body.setStrokeStyle(2, 0xe8edf9, 0.9);
    const name = this.add.text(0, -22, card.name, {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "11px",
      color: "#ffffff",
      align: "center",
      wordWrap: { width: 62 }
    }).setOrigin(0.5);
    const klass = this.add.text(0, 10, card.class, {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "12px",
      color: "#f2d79b"
    }).setOrigin(0.5);
    const stats = this.add.text(0, 34, `${card.atk}/${card.hp}`, {
      fontFamily: "Consolas, monospace",
      fontSize: "14px",
      color: "#ffffff"
    }).setOrigin(0.5);

    container.add([body, name, klass, stats]);
    container.setSize(72, 96);
    container.setInteractive(new Phaser.Geom.Rectangle(-36, -48, 72, 96), Phaser.Geom.Rectangle.Contains);
    container.on("pointerdown", () => this.selectCardView(view));

    const view = {
      card,
      container,
      body,
      homeX: x,
      homeY: y
    };

    return view;
  }

  selectCardView(view) {
    if (this.selectedCardView) {
      this.selectedCardView.body.setStrokeStyle(2, 0xe8edf9, 0.9);
    }

    this.selectedCardView = view;
    view.body.setStrokeStyle(3, 0xffe16d, 1);
    this.statusText.setText(`Selected ${view.card.name}. Click a slot to place it.`);
    this.statusText.setColor("#9ff3c9");
  }

  placeCardInSlot(view, slotIndex) {
    const slotData = this.slotViews.find((slot) => slot.slotIndex === slotIndex);
    const occupyingView = this.cardViews.find((cardView) => cardView !== view && cardView.card.slotIndex === slotIndex);

    if (occupyingView) {
      occupyingView.card.slotIndex = null;
      this.tweens.add({
        targets: occupyingView.container,
        x: occupyingView.homeX,
        y: occupyingView.homeY,
        duration: 150
      });
      occupyingView.body.setStrokeStyle(2, 0xe8edf9, 0.9);
    }

    view.card.slotIndex = slotIndex;
    this.tweens.add({
      targets: view.container,
      x: slotData.x,
      y: slotData.y - 10,
      duration: 150
    });
    view.body.setStrokeStyle(2, 0x9ff3c9, 1);
    this.selectedCardView = null;
    this.statusText.setText(`Placed ${view.card.name} into Slot ${slotIndex + 1}.`);
    this.statusText.setColor("#9ff3c9");
  }

  buildPlacementPayload() {
    if (this.currentLayout.some((card) => card.slotIndex === null || card.slotIndex === undefined)) {
      return null;
    }

    return this.currentLayout.map((card) => ({
      cardId: card.id,
      slotIndex: card.slotIndex
    }));
  }
}

class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");
    this.selectedAttackerSlot = null;
    this.statusText = null;
    this.turnText = null;
    this.logText = null;
    this.cardViews = [];
  }

  create() {
    this.add.rectangle(480, 320, 960, 640, 0x101826, 1);
    this.add.text(480, 40, "Game Scene", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "34px",
      color: "#ffffff",
      fontStyle: "bold"
    }).setOrigin(0.5);

    this.turnText = this.add.text(480, 86, "", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "22px",
      color: "#f0d89c"
    }).setOrigin(0.5);

    this.statusText = this.add.text(480, 118, "", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "18px",
      color: "#c8d2ea"
    }).setOrigin(0.5);

    this.logText = this.add.text(24, 74, "", {
      fontFamily: "Consolas, monospace",
      fontSize: "14px",
      color: "#9fd2ff",
      lineSpacing: 4,
      wordWrap: { width: 250 }
    });

    this.add.text(480, 154, "Opponent", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "20px",
      color: "#f0b6d4"
    }).setOrigin(0.5);

    this.add.text(480, 478, "Your side", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "20px",
      color: "#9fd2ff"
    }).setOrigin(0.5);

    this.add.text(140, 46, "Effects Log", {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "18px",
      color: "#f0d89c"
    }).setOrigin(0.5);

    appState.currentGameState = appState.initialGameState;
    appState.socket.off("state_update");
    appState.socket.off("action_error");

    appState.socket.on("state_update", (gameState) => {
      appState.currentGameState = gameState;
      this.selectedAttackerSlot = null;
      this.renderState("State updated");
      console.log("[client] state_update", gameState);
    });

    appState.socket.on("action_error", ({ message }) => {
      this.statusText.setText(message);
      this.statusText.setColor("#ffb0b0");
      console.log("[client] action_error", message);
    });

    this.renderState("Select one of your cards, then click an enemy card.");
  }

  renderState(statusMessage) {
    this.cardViews.forEach((view) => view.destroy());
    this.cardViews = [];

    const gameState = appState.currentGameState;
    const isMyTurn = gameState.turnPlayerIndex === appState.playerIndex;
    const turnLabel = gameState.phase === "ended"
      ? this.getEndLabel(gameState)
      : `Turn: Player ${gameState.turnPlayerIndex}`;

    this.turnText.setText(turnLabel);
    this.statusText.setText(statusMessage);
    this.statusText.setColor("#c8d2ea");

    if (gameState.lastEvents?.length) {
      const eventSummary = gameState.lastEvents.map((event) => formatEventLabel(event)).join(" | ");
      this.statusText.setText(`${statusMessage} Last events: ${eventSummary}`);
    }

    const eventLines = (gameState.lastEvents || []).slice(-8).map((event) => `- ${formatEventLabel(event)}`);
    this.logText.setText(eventLines.length ? eventLines.join("\n") : "No effects yet.");

    const myState = gameState.players.find((player) => player.playerIndex === appState.playerIndex);
    const enemyState = gameState.players.find((player) => player.playerIndex !== appState.playerIndex);

    this.renderPlayerRow(enemyState, true);
    this.renderPlayerRow(myState, false);

    if (gameState.phase === "ended") {
      this.selectedAttackerSlot = null;
    } else if (!isMyTurn) {
      this.statusText.setText("Opponent's turn.");
    }
  }

  renderPlayerRow(playerState, isTopSide) {
    const startX = 120;
    const startY = isTopSide ? 210 : 360;
    const gapX = 160;
    const viewerIsOwner = playerState.playerIndex === appState.playerIndex;

    playerState.cards.forEach((card, slotIndex) => {
      const row = Math.floor(slotIndex / 5);
      const col = slotIndex % 5;
      const x = startX + col * gapX;
      const y = startY + row * 96;
      const empty = !card;
      const fill = empty ? 0x1c2434 : viewerIsOwner ? 0x365d84 : 0x7b5179;
      const body = this.add.rectangle(x, y, 124, 80, fill, 0.96);
      body.setStrokeStyle(2, 0x9eaed1, 0.8);

      if (empty) {
        const placeholder = this.add.text(x, y, `Empty\n${slotIndex + 1}`, {
          fontFamily: "Segoe UI, sans-serif",
          fontSize: "14px",
          color: "#7f8cad",
          align: "center"
        }).setOrigin(0.5);
        this.cardViews.push(body, placeholder);
        return;
      }

      const isSelected = viewerIsOwner && this.selectedAttackerSlot === slotIndex;
      if (isSelected) {
        body.setStrokeStyle(3, 0xffe16d, 1);
      }

      const isHidden = card.hidden;
      const title = this.add.text(x, y - 18, isHidden ? "HIDDEN" : card.name, {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: "14px",
        color: "#ffffff",
        align: "center",
        wordWrap: { width: 110 }
      }).setOrigin(0.5);
      const details = this.add.text(
        x,
        y + 10,
        isHidden ? "??/??" : `${card.class}\n${card.atk}/${card.hp}`,
        {
          fontFamily: "Consolas, monospace",
          fontSize: "13px",
          color: isHidden ? "#c8d2ea" : "#ffffff",
          align: "center"
        }
      ).setOrigin(0.5);

      const statuses = Array.isArray(card.statuses) ? card.statuses.map(formatStatusLabel).filter(Boolean) : [];
      const statusText = this.add.text(
        x,
        y + 38,
        isHidden ? "" : statuses.join(" | "),
        {
          fontFamily: "Segoe UI, sans-serif",
          fontSize: "11px",
          color: "#ffb7d5",
          align: "center",
          wordWrap: { width: 112 }
        }
      ).setOrigin(0.5);

      if (!isHidden && card.class === "Ranger" && statuses.includes("Aiming")) {
        body.setStrokeStyle(3, 0xff9f6d, 1);
      }

      body.setInteractive({ useHandCursor: true });
      body.on("pointerdown", () => this.onCardClicked(playerState.playerIndex, slotIndex, card));

      this.cardViews.push(body, title, details, statusText);
    });
  }

  onCardClicked(ownerIndex, slotIndex, card) {
    const gameState = appState.currentGameState;
    if (gameState.phase === "ended") {
      return;
    }

    if (gameState.turnPlayerIndex !== appState.playerIndex) {
      this.statusText.setText("It is not your turn.");
      this.statusText.setColor("#ffb0b0");
      return;
    }

    if (ownerIndex === appState.playerIndex) {
      if (!card) {
        return;
      }
      if (this.selectedAttackerSlot === slotIndex) {
        appState.socket.emit("activate_card_action", { slotIndex });
        if (card.class === "Ranger") {
          this.statusText.setText("Ranger is charging. This spends the turn.");
        } else {
          this.statusText.setText("Activated card action.");
        }
        this.statusText.setColor("#9ff3c9");
        return;
      }
      if (card.class === "Ranger" && !(card.statuses || []).some((status) => status.id === "ranger-aim")) {
        this.statusText.setText("Ranger cannot attack yet. Click the same card again to charge for one turn.");
        this.statusText.setColor("#f0d89c");
      }
      this.selectedAttackerSlot = slotIndex;
      this.renderState(`Selected your slot ${slotIndex + 1}. Now choose an enemy card.`);
      return;
    }

    if (this.selectedAttackerSlot === null || !card) {
      return;
    }

    appState.socket.emit("attack", {
      attackerSlot: this.selectedAttackerSlot,
      targetSlot: slotIndex
    });
  }

  getEndLabel(gameState) {
    if (gameState.winner === "draw") {
      return "Result: DRAW";
    }

    return gameState.winner === appState.playerIndex ? "Result: YOU WIN" : "Result: YOU LOSE";
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
