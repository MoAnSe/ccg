function createRoomId(sequence) {
  return `room-${sequence}`;
}

export class GameManager {
  constructor() {
    this.waitingQueue = [];
    this.sessions = new Map();
    this.socketToRoom = new Map();
    this.nextRoomSequence = 1;
  }

  addPlayerToLobby(socket) {
    if (!this.waitingQueue.includes(socket.id) && !this.socketToRoom.has(socket.id)) {
      this.waitingQueue.push(socket.id);
    }

    if (this.waitingQueue.length < 2) {
      return null;
    }

    const playerOneSocketId = this.waitingQueue.shift();
    const playerTwoSocketId = this.waitingQueue.shift();
    const roomId = createRoomId(this.nextRoomSequence);
    this.nextRoomSequence += 1;

    const session = {
      roomId,
      phase: "setup",
      players: [
        { socketId: playerOneSocketId, playerIndex: 0, ready: false, placedCards: [] },
        { socketId: playerTwoSocketId, playerIndex: 1, ready: false, placedCards: [] }
      ]
    };

    this.sessions.set(roomId, session);
    this.socketToRoom.set(playerOneSocketId, roomId);
    this.socketToRoom.set(playerTwoSocketId, roomId);

    return session;
  }

  getRoomIdBySocket(socketId) {
    return this.socketToRoom.get(socketId) || null;
  }

  getSessionBySocket(socketId) {
    const roomId = this.getRoomIdBySocket(socketId);
    return roomId ? this.sessions.get(roomId) || null : null;
  }

  getPlayerBySocket(socketId) {
    const session = this.getSessionBySocket(socketId);
    if (!session) {
      return null;
    }

    const player = session.players.find((entry) => entry.socketId === socketId);
    return player ? { session, player } : null;
  }

  getPlayerBySocket(socketId) {
    const session = this.getSessionBySocket(socketId);
    if (!session) {
      return null;
    }

    const player = session.players.find((entry) => entry.socketId === socketId);
    return player ? { session, player } : null;
  }

  validatePlacedCards(cards) {
    if (!Array.isArray(cards) || cards.length !== 10) {
      return { ok: false, error: "Expected exactly 10 cards." };
    }

    const slotIndexes = cards.map((card) => card.slotIndex);
    if (slotIndexes.some((slotIndex) => !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 9)) {
      return { ok: false, error: "Slot indexes must be integers from 0 to 9." };
    }

    const uniqueSlots = new Set(slotIndexes);
    if (uniqueSlots.size !== 10) {
      return { ok: false, error: "All 10 slot indexes must be unique." };
    }

    if (cards.some((card) => typeof card.cardId !== "string" || !card.cardId)) {
      return { ok: false, error: "Each card must have a cardId." };
    }

    return { ok: true };
  }

  savePlacedCards(socketId, cards) {
    const session = this.getSessionBySocket(socketId);
    if (!session) {
      return { ok: false, error: "Session not found." };
    }

    const player = session.players.find((entry) => entry.socketId === socketId);
    if (!player) {
      return { ok: false, error: "Player not found." };
    }

    const validation = this.validatePlacedCards(cards);
    if (!validation.ok) {
      return validation;
    }

    player.placedCards = cards.map((card) => ({
      cardId: card.cardId,
      slotIndex: card.slotIndex
    }));
    player.ready = false;

    return { ok: true, session };
  }

  confirmSetup(socketId) {
    const session = this.getSessionBySocket(socketId);
    if (!session) {
      return { ok: false, error: "Session not found." };
    }

    const player = session.players.find((entry) => entry.socketId === socketId);
    if (!player) {
      return { ok: false, error: "Player not found." };
    }

    const validation = this.validatePlacedCards(player.placedCards);
    if (!validation.ok) {
      return validation;
    }

    player.ready = true;
    return { ok: true, session };
  }

  areAllPlayersReady(roomId) {
    const session = this.sessions.get(roomId);
    return Boolean(session) && session.players.every((player) => player.ready);
  }

  removeSocket(socketId) {
    this.waitingQueue = this.waitingQueue.filter((queuedSocketId) => queuedSocketId !== socketId);

    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) {
      return null;
    }

    this.socketToRoom.delete(socketId);
    const session = this.sessions.get(roomId);
    if (!session) {
      return null;
    }

    session.players = session.players.filter((player) => player.socketId !== socketId);
    session.players.forEach((player, index) => {
      player.playerIndex = index;
    });

    if (session.players.length === 0) {
      this.sessions.delete(roomId);
      return null;
    }

    return session;
  }
}
