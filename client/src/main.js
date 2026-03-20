const GAME_WIDTH = 1440;
const GAME_HEIGHT = 900;
const CARD_WIDTH = 132;
const CARD_HEIGHT = 176;
const PREVIEW_SCALE = 1.2;
const PREVIEW_DELAY = 1000;
const SERVER_URL = window.location.origin;

const CARD_META = {
  aura_shield: {
    assetBase: "aura_shield",
    description: "When revealed, grants a shield to a living ally."
  },
  aura_blessing: {
    assetBase: "aura_blessing",
    description: "When revealed, blesses an adjacent ally. Triggers twice."
  },
  trap_plague: {
    assetBase: "trap_plague",
    description: "When revealed, infects a hidden enemy card. The infected card dies if not attacked."
  },
  trap_poison: {
    assetBase: "trap_poison",
    description: "When revealed, applies bleeding to the attacker for 2 turns."
  },
  demolition: {
    assetBase: "trap_demolition",
    description: "When revealed, throws an explosive projectile at an exposed enemy card."
  },
  combater_alpha: {
    assetBase: "combater",
    description: "On death, grants half of its base stats to another Combater-class card."
  },
  combater_beta: {
    assetBase: "combater",
    description: "On death, grants half of its base stats to another Combater-class card."
  },
  combater_gamma: {
    assetBase: "combater",
    description: "On death, grants half of its base stats to another Combater-class card."
  },
  ranger: {
    assetBase: "ranger",
    description: "On first activation, charges the weapon. On second activation, fires without revealing itself."
  },
  specialist: {
    assetBase: "specialist",
    description: "On attack, disables any effect on the target."
  }
};

const STATUS_ICON_KEYS = {
  "shield-one": "shield_icon",
  plague: "plague_icon",
  poison: "poison_icon"
};

const appState = {
  socket: null,
  sessionId: null,
  roomId: null,
  playerIndex: null,
  readyPlayers: [false, false],
  gameState: null,
  cardDefinitions: null,
  setupCards: [],
  selection: null,
  deadSlots: {},
  effectFeed: [],
  message: "",
  scenes: {}
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function shuffle(array) {
  const copy = [...array];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

async function loadCardDefinitions() {
  if (appState.cardDefinitions) {
    return appState.cardDefinitions;
  }

  const response = await fetch("/api/card-definitions");
  const payload = await response.json();
  appState.cardDefinitions = payload.cards;
  return appState.cardDefinitions;
}

function getAssetBase(cardId) {
  return CARD_META[cardId]?.assetBase || cardId;
}

function getPlayerCardKey(card) {
  return `${getAssetBase(card.cardId)}_player${card.owner + 1}`;
}

function getDeadCardKey(cardId) {
  return `${getAssetBase(cardId)}_dead`;
}

function getPreviewCardKey(cardId) {
  return `${getAssetBase(cardId)}_preview`;
}

function getCardDescription(cardId) {
  return CARD_META[cardId]?.description || "No description.";
}

function statusLabel(status) {
  if (status.id === "poison" && typeof status.turnsRemaining === "number") {
    return `Poison ${status.turnsRemaining}`;
  }
  if (status.id === "ranger-aim") {
    return "Aiming";
  }
  if (status.id === "shield-one") {
    return "Shield";
  }
  if (status.id === "plague") {
    return "Plague";
  }
  return status.id;
}

function slotKey(owner, slotIndex) {
  return `${owner}-${slotIndex}`;
}

function buildEffectFeed(events = []) {
  return events.slice(-8).map((event) => {
    switch (event.type) {
      case "revealed":
        return `Reveal P${event.owner + 1}:${event.slotIndex + 1}`;
      case "damage":
        return "Combat damage resolved";
      case "statusApplied":
        return `${event.statusId} -> P${event.owner + 1}:${event.slotIndex + 1}`;
      case "shieldConsumed":
        return `Shield broken P${event.owner + 1}:${event.slotIndex + 1}`;
      case "buffApplied":
        return `Buff +${event.atk}/+${event.hp} on P${event.owner + 1}:${event.slotIndex + 1}`;
      case "statsTransferred":
        return `Transfer to P${event.toOwner + 1}:${event.toSlotIndex + 1}`;
      case "turnBehaviorMutated":
        return `Ranger aiming P${event.owner + 1}:${event.slotIndex + 1}`;
      case "rangerShot":
        return `Ranger shot -> P${event.targetOwner + 1}:${event.targetSlotIndex + 1}`;
      case "effectDamage":
        return `Effect damage ${event.amount} -> P${event.owner + 1}:${event.slotIndex + 1}`;
      case "plagueIntercept":
        return `Plague intercept`;
      case "statusTick":
        return `${event.statusId} tick P${event.owner + 1}:${event.slotIndex + 1}`;
      case "died":
        return `Dead ${event.cardId}`;
      default:
        return event.type;
    }
  });
}

function registerSocketHandlers(game) {
  const socket = appState.socket;
  if (!socket || socket.__handlersRegistered) {
    return;
  }

  socket.__handlersRegistered = true;

  socket.on("connect", () => {
    appState.message = "Connected. Joining lobby...";
    socket.emit("join_lobby");
  });

  socket.on("lobby_joined", ({ sessionId }) => {
    appState.sessionId = sessionId;
    appState.message = `Lobby joined: ${sessionId}`;
  });

  socket.on("match_found", async ({ roomId, yourPlayerIndex }) => {
    appState.roomId = roomId;
    appState.playerIndex = yourPlayerIndex;
    appState.readyPlayers = [false, false];
    appState.selection = null;
    appState.deadSlots = {};
    await loadCardDefinitions();
    game.scene.start("SetupScene");
  });

  socket.on("setup_ready_state", ({ players }) => {
    appState.readyPlayers = players.map((player) => player.ready);
    const scene = appState.scenes.SetupScene;
    scene?.refreshReadyState?.();
  });

  socket.on("setup_saved", () => {
    appState.message = "Setup saved. Waiting for confirm sync...";
    appState.scenes.SetupScene?.setStatus?.("Cards sent. Waiting for both players...");
  });

  socket.on("setup_error", ({ message }) => {
    appState.message = message;
    appState.scenes.SetupScene?.setStatus?.(message);
  });

  socket.on("game_start", (state) => {
    appState.gameState = state;
    appState.selection = null;
    appState.deadSlots = {};
    appState.effectFeed = buildEffectFeed(state.lastEvents);
    game.scene.start("GameScene");
  });

  socket.on("state_update", (state) => {
    appState.gameState = state;
    appState.selection = null;
    appState.effectFeed = buildEffectFeed(state.lastEvents);
    for (const event of state.lastEvents || []) {
      if (event.type === "died") {
        appState.deadSlots[slotKey(event.owner, event.slotIndex)] = event.cardId;
      }
    }
    appState.scenes.GameScene?.handleStateUpdate?.(state);
  });

  socket.on("selection_update", (selection) => {
    appState.selection = selection;
    appState.scenes.GameScene?.refreshBoard?.();
  });

  socket.on("action_error", ({ message }) => {
    appState.message = message;
    appState.scenes.GameScene?.setStatus?.(message);
  });
}

function createSocket(game) {
  if (!appState.socket) {
    appState.socket = io(SERVER_URL);
    registerSocketHandlers(game);
  }
  return appState.socket;
}

function createText(scene, x, y, text, style = {}) {
  return scene.add.text(x, y, text, {
    fontFamily: "Trebuchet MS, Arial, sans-serif",
    fontSize: "22px",
    color: "#f7f2e8",
    stroke: "#000000",
    strokeThickness: 3,
    ...style
  });
}

function getStatColor(current, base) {
  if (current > base) {
    return "#8cf18f";
  }
  if (current < base) {
    return "#ff8f96";
  }
  return "#f7f2e8";
}

function createButton(scene, x, y, width, height, label, onClick) {
  const background = scene.add.rectangle(x, y, width, height, 0x122032, 0.92).setStrokeStyle(2, 0xe9d9b3, 1);
  const text = createText(scene, x, y, label, { fontSize: "20px" }).setOrigin(0.5);
  const container = scene.add.container(0, 0, [background, text]);

  background.setInteractive({ useHandCursor: true });
  background.on("pointerover", () => background.setFillStyle(0x1a3453, 1));
  background.on("pointerout", () => background.setFillStyle(0x122032, 0.92));
  background.on("pointerdown", onClick);
  return container;
}

function normalizeStatuses(statuses = []) {
  return statuses.filter((status) => status.id !== "ranger-aim");
}

function getBoardPosition(viewerIndex, owner, slotIndex) {
  const col = slotIndex % 5;
  const rowInSide = Math.floor(slotIndex / 5);
  const isSelf = owner === viewerIndex;
  const row = (isSelf ? 2 : 0) + rowInSide;
  const x = 400 + col * 165;
  const rowY = [150, 340, 560, 750];
  const y = rowY[row];
  return { x, y };
}

function getHalfCenterPosition(viewerIndex, owner) {
  const isSelf = owner === viewerIndex;
  return {
    x: GAME_WIDTH / 2,
    y: isSelf ? 655 : 245
  };
}

function createCardContainer(scene, card, options = {}) {
  const {
    x,
    y,
    hidden = false,
    deadCardId = null,
    selected = false,
    targeted = false,
    hovered = false,
    charged = false,
    interactive = false,
    onClick = null,
    onHoverStart = null,
    onHoverEnd = null
  } = options;

  const lift = selected || targeted ? -18 : 0;
  const container = scene.add.container(x, y + lift);
  const outlineColor = charged ? 0xffd85f : targeted ? 0xf58888 : hovered ? 0xc9f0ff : 0x000000;
  const outlineAlpha = charged || targeted || hovered ? 0.95 : 0.35;
  const outline = scene.add.rectangle(0, 0, CARD_WIDTH + 10, CARD_HEIGHT + 10, 0x000000, 0.25);
  outline.setStrokeStyle(4, outlineColor, outlineAlpha);

  let textureKey = "card_back";
  if (deadCardId) {
    textureKey = getDeadCardKey(deadCardId);
  } else if (!hidden && card?.cardId) {
    textureKey = getPlayerCardKey(card);
  }

  const image = scene.add.image(0, 0, textureKey);
  image.setDisplaySize(CARD_WIDTH, CARD_HEIGHT);
  image.setOrigin(0.5);

  container.add([outline, image]);

  if (card && !hidden && !deadCardId) {
    const statuses = Array.isArray(card.statuses) ? card.statuses : [];
    const attackText = createText(scene, -CARD_WIDTH / 2 + 8, -CARD_HEIGHT / 2 + 8, String(card.atk), {
      fontSize: "24px",
      color: getStatColor(card.atk, card.baseAtk ?? card.atk)
    }).setOrigin(0, 0);
    const hpText = createText(scene, CARD_WIDTH / 2 - 8, -CARD_HEIGHT / 2 + 8, String(card.hp), {
      fontSize: "24px",
      color: getStatColor(card.hp, card.baseHp ?? card.maxHp ?? card.hp)
    }).setOrigin(1, 0);
    const classText = createText(scene, 0, CARD_HEIGHT / 2 - 3, card.class, {
      fontSize: "16px"
    }).setOrigin(0.5, 1);

    const visibleStatuses = normalizeStatuses(statuses);
    visibleStatuses.forEach((status, index) => {
      const iconKey = STATUS_ICON_KEYS[status.id];
      if (iconKey) {
        const icon = scene.add.image(0, 0, iconKey);
        icon.setDisplaySize(CARD_WIDTH, CARD_HEIGHT);
        icon.setAlpha(index === 0 ? 1 : 0.9);
        container.add(icon);
      } else {
        const label = createText(scene, -CARD_WIDTH / 2 + 12, CARD_HEIGHT / 2 - 26 - index * 20, statusLabel(status), {
          fontSize: "12px",
          color: "#f8bed4"
        });
        container.add(label);
      }
    });

    container.add([attackText, hpText, classText]);

    if (statuses.some((status) => status.id === "ranger-aim")) {
      const aimText = createText(scene, 0, CARD_HEIGHT / 2 - 24, "AIM", {
        fontSize: "16px",
        color: "#ffe37d"
      }).setOrigin(0.5);
      container.add(aimText);
    }
  }

  if (interactive) {
    image.setInteractive({ useHandCursor: true });
    image.on("pointerdown", () => onClick?.(card));
    image.on("pointerover", (pointer) => onHoverStart?.(pointer, card, image));
    image.on("pointerout", () => onHoverEnd?.());
  }

  return container;
}

class LobbyScene extends Phaser.Scene {
  constructor() {
    super("LobbyScene");
  }

  preload() {
    this.load.image("main_bg", "/assets/game/main_bg.jpg");
    this.load.image("game_bg", "/assets/game/game_bg.jpg");
    this.load.image("card_back", "/assets/game/card_back.png");
    this.load.image("shield_icon", "/assets/game/shield.png");
    this.load.image("plague_icon", "/assets/game/plague.png");
    this.load.image("poison_icon", "/assets/game/poison_drop.png");
    this.load.image("bullet_fx", "/assets/game/bullet.png");
    this.load.image("grenade_fx", "/assets/game/grenade.png");

    const loaded = new Set();
    Object.values(CARD_META).forEach((entry) => {
      const base = entry.assetBase;
      if (loaded.has(base)) {
        return;
      }
      loaded.add(base);
      this.load.image(`${base}_player1`, `/assets/game/${base}_player1.png`);
      this.load.image(`${base}_player2`, `/assets/game/${base}_player2.png`);
      this.load.image(`${base}_dead`, `/assets/game/${base}_dead.png`);
      this.load.image(`${base}_preview`, `/assets/game/${base}_preview.png`);
    });
  }

  create() {
    appState.scenes.LobbyScene = this;
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, "main_bg").setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    createText(this, 72, 56, "Network Duel", { fontSize: "42px" });
    this.statusText = createText(this, 72, 128, "Connecting...", { fontSize: "24px" });
    this.infoText = createText(this, 72, 176, "Open a second tab to start a match.", { fontSize: "20px" });

    createSocket(this.game);

    this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => {
        const role = appState.playerIndex === null ? "-" : `Player ${appState.playerIndex + 1}`;
        this.statusText.setText([
          appState.message || "Waiting...",
          `Session: ${appState.sessionId || "-"}`,
          `Room: ${appState.roomId || "-"}`,
          `Role: ${role}`
        ]);
      }
    });
  }
}

class SetupScene extends Phaser.Scene {
  constructor() {
    super("SetupScene");
  }

  async create() {
    appState.scenes.SetupScene = this;
    this.input.setTopOnly(true);
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, "main_bg").setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    createText(this, 56, 36, `Setup: Player ${appState.playerIndex + 1}`, { fontSize: "36px" });
    this.statusText = createText(this, 56, 84, "Place all 10 cards, then confirm.", { fontSize: "22px" });
    this.readyText = createText(this, 56, 120, "", { fontSize: "18px", color: "#b7d9ff" });
    this.bankTitle = createText(this, 56, 520, "Card Pool", { fontSize: "28px" });
    this.confirmMark = createText(this, GAME_WIDTH - 48, 68, "", {
      fontSize: "30px",
      color: "#8cf18f"
    }).setOrigin(0.5);

    const definitions = await loadCardDefinitions();
    appState.setupCards = shuffle(definitions).map((definition, index) => ({
      instanceId: `${definition.id}-${index}`,
      cardId: definition.id,
      name: definition.name,
      class: definition.class,
      atk: definition.atk,
      hp: definition.hp,
      slotIndex: null
    }));

    this.selectedInstanceId = null;
    this.slotViews = [];
    this.cardViews = [];
    this.drawSetupBoard();

    createButton(this, GAME_WIDTH - 430, 68, 220, 52, "Random Setup", () => this.randomizeSetup());
    createButton(this, GAME_WIDTH - 170, 68, 220, 52, "Confirm Setup", () => this.confirmSetup());
    this.refreshReadyState();
  }

  setStatus(message) {
    this.statusText.setText(message);
  }

  refreshReadyState() {
    this.readyText.setText(
      `Ready: P1 ${appState.readyPlayers[0] ? "YES" : "NO"} | P2 ${appState.readyPlayers[1] ? "YES" : "NO"}`
    );
    this.confirmMark.setText(appState.readyPlayers[appState.playerIndex] ? "✓" : "");
  }

  drawSetupBoard() {
    this.slotViews.forEach((view) => view.destroy());
    this.cardViews.forEach((view) => view.destroy());
    this.slotViews = [];
    this.cardViews = [];

    for (let slotIndex = 0; slotIndex < 10; slotIndex += 1) {
      const { x, y } = this.getSetupSlotPosition(slotIndex);
      const border = this.add.rectangle(x, y, CARD_WIDTH + 18, CARD_HEIGHT + 18, 0x0b1220, 0.45);
      border.setStrokeStyle(2, 0x8daac9, 0.9);
      border.setInteractive({ useHandCursor: true });
      border.on("pointerdown", () => this.placeSelectedCard(slotIndex));
      this.slotViews.push(border);

      const placedCard = appState.setupCards.find((card) => card.slotIndex === slotIndex);
      if (placedCard) {
        const view = createCardContainer(this, { ...placedCard, owner: appState.playerIndex }, {
          x,
          y,
          selected: this.selectedInstanceId === placedCard.instanceId,
          hovered: this.selectedInstanceId === placedCard.instanceId
        });
        this.enableSetupCardInteraction(view, placedCard);
        this.cardViews.push(view);
      }
    }

    const unplacedCards = appState.setupCards.filter((card) => card.slotIndex === null);
    unplacedCards.forEach((card, index) => {
      const x = 360 + (index % 5) * 170;
      const y = 620 + Math.floor(index / 5) * 190;
      const view = createCardContainer(this, { ...card, owner: appState.playerIndex }, {
        x,
        y,
        selected: this.selectedInstanceId === card.instanceId,
        hovered: this.selectedInstanceId === card.instanceId
      });
      this.enableSetupCardInteraction(view, card);
      this.cardViews.push(view);
    });
  }

  getSetupSlotPosition(slotIndex) {
    return {
      x: 360 + (slotIndex % 5) * 170,
      y: 180 + Math.floor(slotIndex / 5) * 215
    };
  }

  getNearestSlotIndex(x, y) {
    let nearestSlotIndex = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let slotIndex = 0; slotIndex < 10; slotIndex += 1) {
      const position = this.getSetupSlotPosition(slotIndex);
      const distance = Phaser.Math.Distance.Between(x, y, position.x, position.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestSlotIndex = slotIndex;
      }
    }

    return nearestDistance <= 90 ? nearestSlotIndex : null;
  }

  enableSetupCardInteraction(view, card) {
    view.setSize(CARD_WIDTH, CARD_HEIGHT);
    view.setInteractive(
      new Phaser.Geom.Rectangle(-CARD_WIDTH / 2, -CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT),
      Phaser.Geom.Rectangle.Contains
    );

    this.input.setDraggable(view);

    view.on("pointerdown", () => {
      view.__wasDragged = false;
      this.selectedInstanceId = card.instanceId;
    });

    view.on("pointerup", () => {
      if (!view.__wasDragged) {
        this.selectedInstanceId = card.instanceId;
        this.drawSetupBoard();
      }
      view.__wasDragged = false;
    });

    view.on("dragstart", () => {
      view.__wasDragged = true;
      this.selectedInstanceId = card.instanceId;
      view.setDepth(40);
      view.setScale(1.04);
    });

    view.on("drag", (_pointer, dragX, dragY) => {
      view.x = dragX;
      view.y = dragY;
    });

    view.on("dragend", (pointer) => {
      view.setScale(1);
      const slotIndex = this.getNearestSlotIndex(pointer.worldX, pointer.worldY);
      if (slotIndex !== null) {
        this.moveCardToSlot(card.instanceId, slotIndex);
      } else {
        this.selectedInstanceId = card.instanceId;
        this.drawSetupBoard();
      }
    });
  }

  randomizeSetup() {
    const randomizedSlots = shuffle([...Array(10).keys()]);
    appState.setupCards.forEach((card, index) => {
      card.slotIndex = randomizedSlots[index];
    });
    appState.readyPlayers[appState.playerIndex] = false;
    this.selectedInstanceId = null;
    this.refreshReadyState();
    this.drawSetupBoard();
    this.setStatus("Cards placed randomly. You can still adjust them.");
  }

  moveCardToSlot(instanceId, slotIndex) {
    const selectedCard = appState.setupCards.find((card) => card.instanceId === instanceId);
    if (!selectedCard) {
      return;
    }

    const occupyingCard = appState.setupCards.find(
      (card) => card.slotIndex === slotIndex && card.instanceId !== instanceId
    );

    if (occupyingCard) {
      occupyingCard.slotIndex = selectedCard.slotIndex;
    }

    selectedCard.slotIndex = slotIndex;
    this.selectedInstanceId = null;
    this.drawSetupBoard();
  }

  placeSelectedCard(slotIndex) {
    if (!this.selectedInstanceId) {
      return;
    }
    this.moveCardToSlot(this.selectedInstanceId, slotIndex);
  }

  confirmSetup() {
    const payload = appState.setupCards.map((card) => ({
      cardId: card.cardId,
      slotIndex: card.slotIndex
    }));

    if (payload.some((card) => card.slotIndex === null)) {
      this.setStatus("Place all 10 cards before confirming.");
      return;
    }

    appState.socket.emit("setup_place_cards", { cards: payload });
    appState.socket.emit("setup_confirm");
    appState.readyPlayers[appState.playerIndex] = true;
    this.refreshReadyState();
    this.setStatus("Setup submitted. Waiting for both players...");
  }
}

class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");
  }

  create() {
    appState.scenes.GameScene = this;
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, "game_bg").setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    this.boardLayer = this.add.layer();
    this.fxLayer = this.add.layer();
    this.overlayLayer = this.add.layer();
    this.turnText = createText(this, 40, 24, "", { fontSize: "30px" });
    this.statusText = createText(this, 40, 60, "", { fontSize: "18px", color: "#ffd2db" });
    this.logText = createText(this, 40, 120, "", { fontSize: "16px", lineSpacing: 6, color: "#cbe5ff" });
    this.hoveredKey = null;
    this.previewDelay = null;
    this.previewElements = [];
    this.cardViews = new Map();
    this.handleStateUpdate(appState.gameState);
  }

  setStatus(message) {
    this.statusText.setText(message);
  }

  clearPreview() {
    if (this.previewDelay) {
      this.previewDelay.remove(false);
      this.previewDelay = null;
    }
    this.previewElements.forEach((element) => element.destroy());
    this.previewElements = [];
  }

  showPreview(card, x, y) {
    this.clearPreview();
    if (!card || card.hidden || !card.cardId) {
      return;
    }

    const previewKey = getPreviewCardKey(card.cardId);
    const px = clamp(x + 190, 250, GAME_WIDTH - 250);
    const py = clamp(y, 220, GAME_HEIGHT - 220);
    const image = this.add.image(px, py - 38, previewKey).setDisplaySize(CARD_WIDTH * 2 * PREVIEW_SCALE, CARD_HEIGHT * 2 * PREVIEW_SCALE);
    const background = this.add.rectangle(px, py + 170, 340, 110, 0x08101a, 0.72).setStrokeStyle(2, 0xd7c8a0, 0.8);
    const description = createText(this, px - 154, py + 128, getCardDescription(card.cardId), {
      fontSize: "18px",
      wordWrap: { width: 308 }
    });
    image.setDepth(50);
    background.setDepth(50);
    description.setDepth(50);
    this.previewElements = [image, background, description];
  }

  queuePreview(card, x, y) {
    this.clearPreview();
    this.previewDelay = this.time.delayedCall(PREVIEW_DELAY, () => this.showPreview(card, x, y));
  }

  handleStateUpdate(state) {
    this.pendingEvents = state?.lastEvents || [];
    this.refreshBoard();
    this.playEventAnimations(this.pendingEvents);
  }

  refreshBoard() {
    this.clearPreview();
    this.boardLayer.removeAll(true);
    this.fxLayer.removeAll(true);
    this.cardViews.clear();
    const state = appState.gameState;
    if (!state) {
      return;
    }

    const isMyTurn = state.turnPlayerIndex === appState.playerIndex;
    this.turnText.setText(`Turn: Player ${state.turnPlayerIndex + 1}${isMyTurn ? " (your move)" : ""}`);
    this.logText.setText(appState.effectFeed.join("\n"));

    for (let owner = 0; owner < 2; owner += 1) {
      for (let slotIndex = 0; slotIndex < 10; slotIndex += 1) {
        const { x, y } = getBoardPosition(appState.playerIndex, owner, slotIndex);
        const slotRect = this.add.rectangle(x, y, CARD_WIDTH + 18, CARD_HEIGHT + 18, 0x08101a, 0.3);
        slotRect.setStrokeStyle(2, owner === appState.playerIndex ? 0x7cc5a7 : 0xc37f7f, 0.8);
        this.boardLayer.add(slotRect);

        const card = state.players[owner].cards[slotIndex];
        const deadCardId = !card ? appState.deadSlots[slotKey(owner, slotIndex)] || null : null;
        if (!card && !deadCardId) {
          continue;
        }

        const selection = appState.selection;
        const selected = Boolean(selection && selection.playerIndex === owner && selection.attackerSlot === slotIndex);
        const targeted = Boolean(selection && selection.targetSlot === slotIndex && owner !== selection.playerIndex);
        const charged = Boolean(card?.statuses?.some((status) => status.id === "ranger-aim") && owner === appState.playerIndex);
        const interactive = Boolean(card && (owner === appState.playerIndex || card.hidden) && state.phase !== "ended");

        const container = createCardContainer(this, card, {
          x,
          y,
          hidden: Boolean(card?.hidden),
          deadCardId,
          selected,
          targeted,
          charged,
          interactive,
          onClick: () => this.onCardClick(owner, slotIndex, card),
          onHoverStart: (pointer) => {
            this.hoveredKey = slotKey(owner, slotIndex);
            this.refreshBoard();
            this.queuePreview(card, pointer.worldX, pointer.worldY);
          },
          onHoverEnd: () => {
            this.hoveredKey = null;
            this.refreshBoard();
          },
          hovered: this.hoveredKey === slotKey(owner, slotIndex)
        });

        container.setDepth(selected || targeted ? 15 : charged ? 12 : 10);
        this.boardLayer.add(container);
        this.cardViews.set(slotKey(owner, slotIndex), container);
      }
    }

    if (state.phase === "ended") {
      const result =
        state.winner === "draw"
          ? "DRAW"
          : state.winner === appState.playerIndex
            ? "YOU WIN"
            : "YOU LOSE";
      const panel = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 420, 190, 0x061019, 0.82).setStrokeStyle(3, 0xe7dcb7, 1);
      const text = createText(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 16, result, { fontSize: "48px" }).setOrigin(0.5);
      const note = createText(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 42, "Refresh the tabs to start a fresh match.", {
        fontSize: "20px"
      }).setOrigin(0.5);
      this.overlayLayer.removeAll(true);
      this.overlayLayer.add([panel, text, note]);
    }
  }

  onCardClick(owner, slotIndex, card) {
    const state = appState.gameState;
    if (!state || state.phase === "ended") {
      return;
    }

    if (state.turnPlayerIndex !== appState.playerIndex) {
      this.setStatus("Opponent turn.");
      return;
    }

    const currentSelection = appState.selection;
    if (owner === appState.playerIndex) {
      if (card?.class === "Ranger" && currentSelection?.attackerSlot === slotIndex) {
        appState.socket.emit("activate_card_action", { slotIndex });
        return;
      }

      appState.selection = { playerIndex: owner, attackerSlot: slotIndex, targetSlot: null };
      appState.socket.emit("selection_update", { attackerSlot: slotIndex, targetSlot: null });
      this.refreshBoard();
      return;
    }

    if (!currentSelection || currentSelection.playerIndex !== appState.playerIndex) {
      return;
    }

    appState.selection = {
      playerIndex: appState.playerIndex,
      attackerSlot: currentSelection.attackerSlot,
      targetSlot: slotIndex
    };
    appState.socket.emit("selection_update", {
      attackerSlot: currentSelection.attackerSlot,
      targetSlot: slotIndex
    });
    this.refreshBoard();

    this.time.delayedCall(220, () => {
      appState.socket.emit("attack", {
        attackerSlot: currentSelection.attackerSlot,
        targetSlot: slotIndex
      });
    });
  }

  pulseCard(key, tint = 0xfff1a6) {
    const cardView = this.cardViews.get(key);
    if (!cardView) {
      return;
    }

    this.tweens.add({
      targets: cardView,
      scaleX: 1.08,
      scaleY: 1.08,
      duration: 120,
      yoyo: true,
      repeat: 0
    });

    const flash = this.add.rectangle(cardView.x, cardView.y, CARD_WIDTH + 18, CARD_HEIGHT + 18, tint, 0.3);
    flash.setDepth(40);
    this.fxLayer.add(flash);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 300,
      onComplete: () => flash.destroy()
    });
  }

  playProjectile(texture, fromX, fromY, toX, toY) {
    const projectile = this.add.image(fromX, fromY, texture).setDepth(40);
    projectile.setDisplaySize(texture === "bullet_fx" ? 44 : 52, texture === "bullet_fx" ? 18 : 30);
    this.fxLayer.add(projectile);
    this.tweens.add({
      targets: projectile,
      x: toX,
      y: toY,
      duration: 320,
      onComplete: () => projectile.destroy()
    });
  }

  playEventAnimations(events) {
    if (!events?.length) {
      return;
    }

    events.forEach((event, index) => {
      const delay = index * 90;
      if (event.type === "revealed") {
        this.time.delayedCall(delay, () => this.pulseCard(slotKey(event.owner, event.slotIndex), 0xcaf0ff));
      }

      if (event.type === "buffApplied") {
        this.time.delayedCall(delay, () => this.pulseCard(slotKey(event.owner, event.slotIndex), 0x9effb3));
      }

      if (event.type === "statusApplied") {
        this.time.delayedCall(delay, () => this.pulseCard(slotKey(event.owner, event.slotIndex), 0x9fc4ff));
      }

      if (event.type === "statsTransferred") {
        this.time.delayedCall(delay, () => this.pulseCard(slotKey(event.toOwner, event.toSlotIndex), 0x9effb3));
      }

      if (event.type === "damage") {
        const attackerView = this.cardViews.get(slotKey(event.attacker.owner, event.attacker.slotIndex));
        const targetView = this.cardViews.get(slotKey(event.target.owner, event.target.slotIndex));
        if (attackerView && targetView) {
          const direction = targetView.x > attackerView.x ? 16 : -16;
          this.time.delayedCall(delay, () => {
            this.tweens.add({
              targets: attackerView,
              x: attackerView.x + direction,
              duration: 90,
              yoyo: true
            });
          });
        }
        if (targetView) {
          this.time.delayedCall(delay, () => {
            this.tweens.add({
              targets: targetView,
              x: targetView.x + 8,
              duration: 50,
              yoyo: true,
              repeat: 3
            });
          });
        }
      }

      if (event.type === "statusTick") {
        const view = this.cardViews.get(slotKey(event.owner, event.slotIndex));
        if (view) {
          this.time.delayedCall(delay, () => {
            this.tweens.add({
              targets: view,
              x: view.x + 6,
              duration: 45,
              yoyo: true,
              repeat: 2
            });
          });
        }
      }

      if (event.type === "rangerShot") {
        const targetPos = getBoardPosition(appState.playerIndex, event.targetOwner, event.targetSlotIndex);
        const sourceView = this.cardViews.get(slotKey(event.attackerOwner, event.attackerSlotIndex));
        const hiddenForViewer = !event.attackerRevealed && event.attackerOwner !== appState.playerIndex;
        const halfCenter = getHalfCenterPosition(appState.playerIndex, event.attackerOwner);
        const startX = hiddenForViewer ? halfCenter.x : sourceView ? sourceView.x : halfCenter.x;
        const startY = hiddenForViewer ? halfCenter.y : sourceView ? sourceView.y : halfCenter.y;
        this.time.delayedCall(delay, () => this.playProjectile("bullet_fx", startX, startY, targetPos.x, targetPos.y));
        const targetView = this.cardViews.get(slotKey(event.targetOwner, event.targetSlotIndex));
        if (targetView) {
          this.time.delayedCall(delay, () => {
            this.tweens.add({
              targets: targetView,
              x: targetView.x + 8,
              duration: 50,
              yoyo: true,
              repeat: 2
            });
          });
        }
      }

      if (event.type === "effectDamage") {
        const targetPos = getBoardPosition(appState.playerIndex, event.owner, event.slotIndex);
        this.time.delayedCall(delay, () => {
          this.playProjectile("grenade_fx", targetPos.x, targetPos.y - 120, targetPos.x, targetPos.y);
        });
        const targetView = this.cardViews.get(slotKey(event.owner, event.slotIndex));
        if (targetView) {
          this.time.delayedCall(delay, () => {
            this.tweens.add({
              targets: targetView,
              y: targetView.y - 10,
              duration: 80,
              yoyo: true
            });
          });
        }
      }
    });
  }
}

const config = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: "game-root",
  backgroundColor: "#050b12",
  scene: [LobbyScene, SetupScene, GameScene]
};

new Phaser.Game(config);
