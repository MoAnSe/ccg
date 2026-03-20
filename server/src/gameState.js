import { executeEffects, consumeShieldIfPresent, getStatus, removeStatus } from "./engine/effectHandlers.js";
import { STATUS_IDS, getAbilityDefinition } from "./engine/registry.js";

function cloneCard(card) {
  return card
    ? {
        ...card,
        statuses: Array.isArray(card.statuses) ? card.statuses.map((status) => ({ ...status })) : []
      }
    : null;
}

function createEffectContext(gameState, sourceCard, extra = {}) {
  return {
    gameState,
    sourceCard,
    attackerCard: extra.attackerCard || null,
    targetCard: extra.targetCard || null,
    events: extra.events || [],
    pendingDeaths: extra.pendingDeaths || [],
    isRangedAttack: Boolean(extra.isRangedAttack)
  };
}

function pushEvent(events, type, payload) {
  events.push({ type, ...payload });
}

function removeCard(gameState, card) {
  if (gameState.players[card.owner].cards[card.slotIndex] === card) {
    gameState.players[card.owner].cards[card.slotIndex] = null;
  }
}

function evaluateWinner(gameState) {
  const aliveCounts = gameState.players.map((player) => player.cards.filter(Boolean).length);

  if (aliveCounts[0] === 0 && aliveCounts[1] === 0) {
    gameState.phase = "ended";
    gameState.winner = "draw";
    return;
  }

  if (aliveCounts[0] === 0) {
    gameState.phase = "ended";
    gameState.winner = 1;
    return;
  }

  if (aliveCounts[1] === 0) {
    gameState.phase = "ended";
    gameState.winner = 0;
  }
}

function triggerAbility(gameState, trigger, sourceCard, extra = {}) {
  const ability = getAbilityDefinition(sourceCard.abilityId);
  if (!ability || ability.trigger !== trigger) {
    return;
  }

  if (ability.requireHiddenBeforeReveal && !extra.wasHiddenBeforeReveal) {
    return;
  }

  if (ability.defenderOnly && extra.targetCard?.owner !== sourceCard.owner) {
    return;
  }

  const context = createEffectContext(gameState, sourceCard, extra);
  executeEffects(ability.effects || [], context);
}

function resolvePendingDeaths(gameState, events, options = {}) {
  const queue = [...(options.pendingDeaths || [])];
  while (queue.length) {
    const pending = queue.shift();
    const currentCard = gameState.players[pending.card.owner].cards[pending.card.slotIndex];
    if (!currentCard || currentCard.hp > 0) {
      continue;
    }

    const snapshot = cloneCard(currentCard);
    removeCard(gameState, currentCard);
    pushEvent(events, "died", {
      owner: snapshot.owner,
      slotIndex: snapshot.slotIndex,
      cardId: snapshot.cardId
    });

    if (!pending.suppressAbility) {
      triggerAbility(gameState, "onCardDied", snapshot, {
        attackerCard: options.attackerCard || null,
        targetCard: options.targetCard || null,
        events,
        pendingDeaths: queue
      });
    }
  }
}

function revealCard(card, events) {
  if (!card || card.revealed) {
    return;
  }

  card.revealed = true;
  pushEvent(events, "revealed", {
    owner: card.owner,
    slotIndex: card.slotIndex,
    cardId: card.cardId
  });
}

function applyCombatDamage(attacker, target, events) {
  const attackerShielded = consumeShieldIfPresent(attacker, { events }, "damage");
  const targetShielded = consumeShieldIfPresent(target, { events }, "damage");
  const damageToAttacker = attackerShielded ? 0 : target.atk;
  const damageToTarget = targetShielded ? 0 : attacker.atk;

  target.hp = Math.max(0, target.hp - damageToTarget);
  attacker.hp = Math.max(0, attacker.hp - damageToAttacker);

  pushEvent(events, "damage", {
    attacker: {
      owner: attacker.owner,
      slotIndex: attacker.slotIndex,
      hp: attacker.hp
    },
    target: {
      owner: target.owner,
      slotIndex: target.slotIndex,
      hp: target.hp
    }
  });
}

function processStartOfTurn(gameState, events) {
  const currentPlayer = gameState.players[gameState.turnPlayerIndex];
  const pendingDeaths = [];

  currentPlayer.cards.forEach((card) => {
    if (!card) {
      return;
    }

    const plague = getStatus(card, STATUS_IDS.PLAGUE);
    if (plague) {
      if (consumeShieldIfPresent(card, { events }, STATUS_IDS.PLAGUE)) {
        removeStatus(card, STATUS_IDS.PLAGUE);
        pushEvent(events, "statusTick", {
          owner: card.owner,
          slotIndex: card.slotIndex,
          statusId: STATUS_IDS.PLAGUE,
          turnsRemaining: 0
        });
        return;
      }

      pushEvent(events, "statusTick", {
        owner: card.owner,
        slotIndex: card.slotIndex,
        statusId: STATUS_IDS.PLAGUE,
        turnsRemaining: plague.turnsRemaining - 1
      });
      plague.turnsRemaining -= 1;
      if (plague.turnsRemaining <= 0) {
        removeStatus(card, STATUS_IDS.PLAGUE);
        card.hp = 0;
        pendingDeaths.push({ card, suppressAbility: false });
        return;
      }
    }

    const poison = getStatus(card, STATUS_IDS.POISON);
    if (poison) {
      card.atk = Math.max(0, card.atk - 2);
      if (!consumeShieldIfPresent(card, { events }, STATUS_IDS.POISON)) {
        card.hp = Math.max(0, card.hp - 2);
      }
      poison.turnsRemaining -= 1;
      pushEvent(events, "statusTick", {
        owner: card.owner,
        slotIndex: card.slotIndex,
        statusId: STATUS_IDS.POISON,
        turnsRemaining: poison.turnsRemaining
      });
      if (poison.turnsRemaining <= 0) {
        removeStatus(card, STATUS_IDS.POISON);
      }
      if (card.hp <= 0) {
        pendingDeaths.push({ card, suppressAbility: false });
      }
    }
  });

  resolvePendingDeaths(gameState, events, { pendingDeaths });
  evaluateWinner(gameState);
}

export function createInitialGameState(session, cardDefinitions) {
  const definitionsById = new Map(cardDefinitions.cards.map((card) => [card.id, card]));

  return {
    roomId: session.roomId,
    phase: "game",
    turnPlayerIndex: Math.random() < 0.5 ? 0 : 1,
    winner: null,
    lastEvents: [],
    players: session.players.map((player) => {
      const cards = Array.from({ length: 10 }, () => null);

      player.placedCards.forEach((placedCard) => {
        const definition = definitionsById.get(placedCard.cardId);
        if (!definition) {
          return;
        }

        cards[placedCard.slotIndex] = {
          cardId: definition.id,
          name: definition.name,
          class: definition.class,
          atk: definition.atk,
          baseAtk: definition.atk,
          hp: definition.hp,
          baseHp: definition.hp,
          maxHp: definition.hp,
          owner: player.playerIndex,
          slotIndex: placedCard.slotIndex,
          revealed: false,
          abilityId: definition.abilityId || null,
          statuses: []
        };
      });

      return {
        playerIndex: player.playerIndex,
        ready: player.ready,
        cards
      };
    }),
    randomQueue: []
  };
}

export function nextTurn(gameState, carriedEvents = []) {
  if (gameState.phase === "ended") {
    gameState.lastEvents = carriedEvents;
    return gameState;
  }

  gameState.turnPlayerIndex = gameState.turnPlayerIndex === 0 ? 1 : 0;
  processStartOfTurn(gameState, carriedEvents);
  gameState.lastEvents = carriedEvents;
  return gameState;
}

export function activateCardAction(gameState, slotIndex) {
  if (gameState.phase === "ended") {
    return { ok: false, error: "Game already ended." };
  }

  const playerIndex = gameState.turnPlayerIndex;
  const card = gameState.players[playerIndex]?.cards?.[slotIndex] || null;
  if (!card) {
    return { ok: false, error: "Card slot is empty." };
  }

  const ability = getAbilityDefinition(card.abilityId);
  if (!ability?.actions?.activateAim) {
    return { ok: false, error: "Card has no activatable action." };
  }

  if (getStatus(card, STATUS_IDS.RANGER_AIM)) {
    return { ok: false, error: "Ranger is already aiming." };
  }

  const events = [];
  const context = createEffectContext(gameState, card, { events, pendingDeaths: [] });
  executeEffects(ability.actions.activateAim, context);
  nextTurn(gameState, events);
  return { ok: true, gameState };
}

function resolvePlagueIntercept(gameState, attacker, target, events) {
  const plague = getStatus(target, STATUS_IDS.PLAGUE);
  if (!plague) {
    return false;
  }

  removeStatus(target, STATUS_IDS.PLAGUE);
  attacker.hp = 0;
  pushEvent(events, "plagueIntercept", {
    attackerOwner: attacker.owner,
    attackerSlotIndex: attacker.slotIndex,
    targetOwner: target.owner,
    targetSlotIndex: target.slotIndex
  });
  resolvePendingDeaths(gameState, events, {
    pendingDeaths: [{ card: attacker, suppressAbility: false }],
    attackerCard: attacker,
    targetCard: target
  });
  evaluateWinner(gameState);
  if (gameState.phase !== "ended") {
    nextTurn(gameState, events);
  } else {
    gameState.lastEvents = events;
  }
  return true;
}

function fireRangerShot(gameState, attacker, target) {
  const events = [];
  const pendingDeaths = [];
  removeStatus(attacker, STATUS_IDS.RANGER_AIM);

  const targetWasHidden = !target.revealed;
  revealCard(target, events);
  triggerAbility(gameState, "onRevealedByAttack", target, {
    wasHiddenBeforeReveal: targetWasHidden,
    attackerCard: attacker,
    targetCard: target,
    events,
    pendingDeaths,
    isRangedAttack: true
  });

  if (!consumeShieldIfPresent(target, { events }, "damage")) {
    target.hp = Math.max(0, target.hp - attacker.atk);
    pushEvent(events, "rangerShot", {
      attackerOwner: attacker.owner,
      attackerSlotIndex: attacker.slotIndex,
      attackerRevealed: attacker.revealed,
      targetOwner: target.owner,
      targetSlotIndex: target.slotIndex,
      targetHp: target.hp
    });
  }

  resolvePendingDeaths(gameState, events, {
    pendingDeaths: target.hp <= 0 ? [...pendingDeaths, { card: target, suppressAbility: false }] : pendingDeaths
  });
  evaluateWinner(gameState);
  if (gameState.phase !== "ended") {
    nextTurn(gameState, events);
  } else {
    gameState.lastEvents = events;
  }

  return { ok: true, gameState };
}

export function applyAttack(gameState, attackerSlot, targetSlot) {
  if (gameState.phase === "ended") {
    return { ok: false, error: "Game already ended." };
  }

  const attackerOwner = gameState.turnPlayerIndex;
  const targetOwner = attackerOwner === 0 ? 1 : 0;
  const attacker = gameState.players[attackerOwner]?.cards?.[attackerSlot] || null;
  const target = gameState.players[targetOwner]?.cards?.[targetSlot] || null;

  if (!attacker) {
    return { ok: false, error: "Attacker slot is empty." };
  }

  if (!target) {
    return { ok: false, error: "Target slot is empty." };
  }

  if (getStatus(attacker, STATUS_IDS.PLAGUE)) {
    return { ok: false, error: "Plague-infected cards cannot attack." };
  }

  if (getStatus(attacker, STATUS_IDS.RANGER_AIM)) {
    return fireRangerShot(gameState, attacker, target);
  }

  if (resolvePlagueIntercept(gameState, attacker, target, [])) {
    return { ok: true, gameState };
  }

  if (attacker.class === "Ranger") {
    return { ok: false, error: "Ranger must spend one turn aiming before attacking." };
  }

  const events = [];
  const pendingDeaths = [];
  const attackerWasHidden = !attacker.revealed;
  const targetWasHidden = !target.revealed;
  const attackerAbility = getAbilityDefinition(attacker.abilityId);
  const suppressTargetAbilities = Boolean(
    attackerAbility?.suppressTargetAbilities && target.class !== attackerAbility.suppressExceptClass
  );

  revealCard(attacker, events);
  revealCard(target, events);

  triggerAbility(gameState, "onRevealedByAttack", attacker, {
    wasHiddenBeforeReveal: attackerWasHidden,
    attackerCard: attacker,
    targetCard: target,
    events,
    pendingDeaths
  });

  if (!suppressTargetAbilities) {
    triggerAbility(gameState, "onRevealedByAttack", target, {
      wasHiddenBeforeReveal: targetWasHidden,
      attackerCard: attacker,
      targetCard: target,
      events,
      pendingDeaths
    });
  }

  applyCombatDamage(attacker, target, events);

  if (attacker.hp <= 0) {
    pendingDeaths.push({ card: attacker, suppressAbility: false });
  }
  if (target.hp <= 0) {
    pendingDeaths.push({ card: target, suppressAbility: suppressTargetAbilities });
  }

  resolvePendingDeaths(gameState, events, {
    pendingDeaths,
    attackerCard: attacker,
    targetCard: target
  });

  evaluateWinner(gameState);

  if (gameState.phase !== "ended") {
    nextTurn(gameState, events);
  } else {
    gameState.lastEvents = events;
  }

  return { ok: true, gameState };
}

export function createPlayerView(gameState, viewerPlayerIndex) {
  const canViewerSeeCard = (owner, slotIndex) => {
    const card = gameState.players[owner]?.cards?.[slotIndex] || null;
    return Boolean(card) && (card.owner === viewerPlayerIndex || card.revealed);
  };

  const sanitizeEvent = (event) => {
    if (event.type === "statusApplied" && event.statusId === STATUS_IDS.SHIELD_ONE && event.owner !== viewerPlayerIndex) {
      return null;
    }

    if (event.type === "statusApplied" && event.statusId === STATUS_IDS.PLAGUE && event.owner !== viewerPlayerIndex) {
      return null;
    }

    if (
      event.type === "statusApplied" ||
      event.type === "shieldConsumed" ||
      event.type === "buffApplied" ||
      event.type === "statusTick"
    ) {
      if (!canViewerSeeCard(event.owner, event.slotIndex)) {
        return null;
      }
    }

    if (event.type === "statsTransferred") {
      if (!canViewerSeeCard(event.toOwner, event.toSlotIndex)) {
        return null;
      }
    }

    return event;
  };

  return {
    roomId: gameState.roomId,
    phase: gameState.phase,
    turnPlayerIndex: gameState.turnPlayerIndex,
    winner: gameState.winner,
    lastEvents: gameState.lastEvents.map(sanitizeEvent).filter(Boolean),
    players: gameState.players.map((player) => ({
      playerIndex: player.playerIndex,
      ready: player.ready,
      cards: player.cards.map((card) => {
        if (!card) {
          return null;
        }

        const isVisible = card.revealed || card.owner === viewerPlayerIndex;
        if (isVisible) {
          return cloneCard(card);
        }

        return {
          owner: card.owner,
          slotIndex: card.slotIndex,
          revealed: false,
          hidden: true,
          statuses: []
        };
      })
    }))
  };
}
