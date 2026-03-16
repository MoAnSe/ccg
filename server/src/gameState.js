// Pure state shaping for the initial game payload.

export function createInitialGameState(session) {
  return {
    roomId: session.roomId,
    phase: "game",
    players: session.players.map((player) => ({
      playerIndex: player.playerIndex,
      ready: player.ready,
      cards: player.placedCards
    }))
  };
}
