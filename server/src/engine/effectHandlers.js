import { STATUS_IDS } from "./registry.js";

function pushEvent(context, type, payload) {
  context.events.push({ type, ...payload });
}

function consumeQueuedRandom(gameState) {
  if (Array.isArray(gameState.randomQueue) && gameState.randomQueue.length > 0) {
    return gameState.randomQueue.shift();
  }

  return Math.random();
}

function pickRandom(gameState, items) {
  if (!items.length) {
    return null;
  }

  const randomValue = consumeQueuedRandom(gameState);
  const normalized = Math.abs(randomValue) % items.length;
  return items[Math.floor(normalized)];
}

function getAdjacentSlotIndexes(slotIndex) {
  const rowStart = Math.floor(slotIndex / 5) * 5;
  const rowEnd = rowStart + 4;
  const slots = [];

  if (slotIndex - 1 >= rowStart) {
    slots.push(slotIndex - 1);
  }

  if (slotIndex + 1 <= rowEnd) {
    slots.push(slotIndex + 1);
  }

  return slots;
}

export function getStatus(card, statusId) {
  return card?.statuses?.find((status) => status.id === statusId) || null;
}

export function removeStatus(card, statusId) {
  if (!card?.statuses) {
    return;
  }

  card.statuses = card.statuses.filter((status) => status.id !== statusId);
}

export function addStatus(card, status) {
  if (!card) {
    return;
  }

  if (!Array.isArray(card.statuses)) {
    card.statuses = [];
  }

  card.statuses.push(status);
}

export function consumeShieldIfPresent(card, context, reason) {
  if (!card) {
    return false;
  }

  const shield = getStatus(card, STATUS_IDS.SHIELD_ONE);
  if (!shield) {
    return false;
  }

  removeStatus(card, STATUS_IDS.SHIELD_ONE);
  pushEvent(context, "shieldConsumed", {
    owner: card.owner,
    slotIndex: card.slotIndex,
    reason
  });
  return true;
}

function getAllAliveCards(gameState, owner) {
  return gameState.players[owner].cards.filter(Boolean);
}

function resolveWithFallback(effect, context) {
  return resolveSelector(effect, context) || (effect.fallbackTargetSelector
    ? resolveSelector({ targetSelector: effect.fallbackTargetSelector }, context)
    : null);
}

function resolveSelector(effect, context) {
  const { gameState, sourceCard, attackerCard, targetCard } = context;
  const enemyOwner = sourceCard.owner === 0 ? 1 : 0;

  switch (effect.targetSelector) {
    case "self":
      return sourceCard;
    case "target":
      return targetCard;
    case "attacker":
      return attackerCard;
    case "attackerIfAlive":
      return attackerCard && gameState.players[attackerCard.owner].cards[attackerCard.slotIndex] ? attackerCard : null;
    case "attackerIfAliveAndRevealed":
      return attackerCard &&
        attackerCard.revealed &&
        gameState.players[attackerCard.owner].cards[attackerCard.slotIndex]
        ? attackerCard
        : null;
    case "ownRandomAlive":
      return pickRandom(gameState, getAllAliveCards(gameState, sourceCard.owner));
    case "ownRandomAliveExcludingSelf": {
      const allies = getAllAliveCards(gameState, sourceCard.owner).filter(
        (card) => !(card.owner === sourceCard.owner && card.slotIndex === sourceCard.slotIndex)
      );
      return pickRandom(gameState, allies);
    }
    case "ownRandomAdjacent": {
      const adjacent = getAdjacentSlotIndexes(sourceCard.slotIndex)
        .map((slotIndex) => gameState.players[sourceCard.owner].cards[slotIndex])
        .filter(Boolean);
      return pickRandom(gameState, adjacent);
    }
    case "enemyRandomHidden": {
      const hiddenEnemies = getAllAliveCards(gameState, enemyOwner).filter((card) => !card.revealed);
      return pickRandom(gameState, hiddenEnemies);
    }
    case "enemyRandomRevealedExcludingAttacker": {
      const revealedEnemies = getAllAliveCards(gameState, enemyOwner).filter(
        (card) =>
          card.revealed &&
          (!attackerCard || card.owner !== attackerCard.owner || card.slotIndex !== attackerCard.slotIndex)
      );
      return pickRandom(gameState, revealedEnemies);
    }
    case "ownRandomAliveClassCombater": {
      const combattters = getAllAliveCards(gameState, sourceCard.owner).filter(
        (card) =>
          card.class === "Combater" &&
          !(card.owner === sourceCard.owner && card.slotIndex === sourceCard.slotIndex)
      );
      return pickRandom(gameState, combattters);
    }
    default:
      return null;
  }
}

export function createStatus(statusId) {
  switch (statusId) {
    case STATUS_IDS.SHIELD_ONE:
      return { id: STATUS_IDS.SHIELD_ONE };
    case STATUS_IDS.PLAGUE:
      return { id: STATUS_IDS.PLAGUE, turnsRemaining: 3 };
    case STATUS_IDS.POISON:
      return { id: STATUS_IDS.POISON, turnsRemaining: 2 };
    case STATUS_IDS.RANGER_AIM:
      return { id: STATUS_IDS.RANGER_AIM };
    default:
      return { id: statusId };
  }
}

function handleApplyStatus(effect, context) {
  if (effect.skipIfAttackerRanged && context.isRangedAttack) {
    return;
  }

  const targetCard = resolveWithFallback(effect, context);
  if (!targetCard) {
    return;
  }

  if (consumeShieldIfPresent(targetCard, context, effect.statusId)) {
    return;
  }

  addStatus(targetCard, createStatus(effect.statusId));
  pushEvent(context, "statusApplied", {
    owner: targetCard.owner,
    slotIndex: targetCard.slotIndex,
    statusId: effect.statusId
  });
}

function handleBuff(effect, context) {
  const targetCard = resolveWithFallback(effect, context);
  if (!targetCard) {
    return;
  }

  targetCard.atk += effect.atk || 0;
  targetCard.hp += effect.hp || 0;
  targetCard.maxHp += effect.hp || 0;

  pushEvent(context, "buffApplied", {
    owner: targetCard.owner,
    slotIndex: targetCard.slotIndex,
    atk: effect.atk || 0,
    hp: effect.hp || 0
  });
}

function handleDealDamage(effect, context) {
  const targetCard = resolveWithFallback(effect, context);

  if (!targetCard) {
    return;
  }

  const amount = effect.amountFromSourceAtk ? context.sourceCard.atk : effect.amount;
  if (consumeShieldIfPresent(targetCard, context, "damage")) {
    return;
  }

  targetCard.hp = Math.max(0, targetCard.hp - amount);
  pushEvent(context, "effectDamage", {
    owner: targetCard.owner,
    slotIndex: targetCard.slotIndex,
    amount,
    preserveHidden: Boolean(effect.preserveHidden)
  });

  context.pendingDeaths.push({
    card: targetCard,
    suppressAbility: false
  });
}

function handleTransferStats(effect, context) {
  const targetCard = resolveWithFallback(effect, context);
  if (!targetCard) {
    return;
  }

  const atkGain = effect.atk ?? Math.floor((context.sourceCard.atk || 0) * effect.fraction);
  const hpGain = effect.hp ?? Math.floor((context.sourceCard.maxHp || 0) * effect.fraction);
  targetCard.atk += atkGain;
  targetCard.hp += hpGain;
  targetCard.maxHp += hpGain;

  pushEvent(context, "statsTransferred", {
    fromOwner: context.sourceCard.owner,
    fromSlotIndex: context.sourceCard.slotIndex,
    toOwner: targetCard.owner,
    toSlotIndex: targetCard.slotIndex,
    atk: atkGain,
    hp: hpGain
  });
}

function handleMutateTurnBehavior(effect, context) {
  if (effect.mutation === STATUS_IDS.RANGER_AIM) {
    addStatus(context.sourceCard, createStatus(STATUS_IDS.RANGER_AIM));
    pushEvent(context, "turnBehaviorMutated", {
      owner: context.sourceCard.owner,
      slotIndex: context.sourceCard.slotIndex,
      mutation: STATUS_IDS.RANGER_AIM
    });
  }
}

const handlers = {
  applyStatus: handleApplyStatus,
  buff: handleBuff,
  dealDamage: handleDealDamage,
  transferStats: handleTransferStats,
  mutateTurnBehavior: handleMutateTurnBehavior
};

export function executeEffects(effects, context) {
  effects.forEach((effect) => {
    const repeat = effect.repeat || 1;
    for (let index = 0; index < repeat; index += 1) {
      handlers[effect.type]?.(effect, context);
    }
  });
}
