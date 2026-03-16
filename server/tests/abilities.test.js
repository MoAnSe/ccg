import test from "node:test";
import assert from "node:assert/strict";
import cardDefinitions from "../src/cards/card_definitions.json" with { type: "json" };
import { STATUS_IDS } from "../src/engine/registry.js";
import { activateCardAction, applyAttack, createInitialGameState, nextTurn } from "../src/gameState.js";

function createSession(player0Cards, player1Cards) {
  return {
    roomId: "test-room",
    players: [
      {
        playerIndex: 0,
        ready: true,
        placedCards: player0Cards.map((cardId, slotIndex) => ({ cardId, slotIndex }))
      },
      {
        playerIndex: 1,
        ready: true,
        placedCards: player1Cards.map((cardId, slotIndex) => ({ cardId, slotIndex }))
      }
    ]
  };
}

function buildState(player0Cards, player1Cards, options = {}) {
  const state = createInitialGameState(createSession(player0Cards, player1Cards), cardDefinitions);
  state.turnPlayerIndex = options.turnPlayerIndex ?? 0;
  state.randomQueue = [...(options.randomQueue || [])];
  return state;
}

function getCard(state, owner, slotIndex) {
  return state.players[owner].cards[slotIndex];
}

test("aura shield applies shield-one to a random alive ally when revealed by attack", () => {
  const state = buildState(
    ["combater_alpha", "aura_shield", "combater_beta", "combater_gamma", "specialist", "ranger", "trap_plague", "trap_poison", "aura_blessing", "demolition"],
    ["combater_alpha", "combater_beta", "combater_gamma", "ranger", "specialist", "trap_plague", "trap_poison", "aura_blessing", "demolition", "aura_shield"],
    { turnPlayerIndex: 1, randomQueue: [0] }
  );

  applyAttack(state, 0, 1);
  assert.equal(getCard(state, 0, 0).statuses.some((status) => status.id === STATUS_IDS.SHIELD_ONE), true);
});

test("aura blessing buffs adjacent allies twice when revealed from hidden defense", () => {
  const state = buildState(
    ["combater_alpha", "aura_blessing", "combater_beta", "combater_gamma", "specialist", "ranger", "trap_plague", "trap_poison", "aura_shield", "demolition"],
    ["combater_alpha", "combater_beta", "combater_gamma", "ranger", "specialist", "trap_plague", "trap_poison", "aura_shield", "demolition", "aura_blessing"],
    { turnPlayerIndex: 1, randomQueue: [0, 1] }
  );

  applyAttack(state, 0, 1);
  assert.equal(getCard(state, 0, 0).atk, 6);
  assert.equal(getCard(state, 0, 0).hp, 8);
  assert.equal(getCard(state, 0, 2).atk, 6);
  assert.equal(getCard(state, 0, 2).hp, 8);
});

test("trap plague applies plague to a random hidden enemy card", () => {
  const state = buildState(
    ["trap_plague", "combater_alpha", "combater_beta", "combater_gamma", "specialist", "ranger", "trap_poison", "aura_shield", "aura_blessing", "demolition"],
    ["combater_alpha", "combater_beta", "combater_gamma", "ranger", "specialist", "trap_poison", "aura_shield", "aura_blessing", "demolition", "trap_plague"],
    { turnPlayerIndex: 1, randomQueue: [0] }
  );

  applyAttack(state, 0, 0);
  assert.equal(getCard(state, 1, 1).statuses.some((status) => status.id === STATUS_IDS.PLAGUE), true);
});

test("plague kills attacker immediately and preserves target when attacking infected card", () => {
  const state = buildState(
    ["combater_alpha", "combater_beta", "combater_gamma", "ranger", "specialist", "trap_plague", "trap_poison", "aura_shield", "aura_blessing", "demolition"],
    ["combater_alpha", "combater_beta", "combater_gamma", "ranger", "specialist", "trap_poison", "aura_shield", "aura_blessing", "demolition", "trap_plague"],
    { turnPlayerIndex: 0 }
  );

  getCard(state, 1, 0).statuses.push({ id: STATUS_IDS.PLAGUE, turnsRemaining: 1 });
  const targetBefore = getCard(state, 1, 0).hp;
  applyAttack(state, 0, 0);

  assert.equal(getCard(state, 0, 0), null);
  assert.equal(getCard(state, 1, 0).hp, targetBefore);
  assert.equal(getCard(state, 1, 0).statuses.some((status) => status.id === STATUS_IDS.PLAGUE), false);
});

test("trap poison applies poison and poison ticks for two turns", () => {
  const state = buildState(
    ["trap_poison", "combater_alpha", "combater_beta", "combater_gamma", "specialist", "ranger", "trap_plague", "aura_shield", "aura_blessing", "demolition"],
    ["combater_alpha", "combater_beta", "combater_gamma", "ranger", "specialist", "trap_plague", "aura_shield", "aura_blessing", "demolition", "trap_poison"],
    { turnPlayerIndex: 1, randomQueue: [0] }
  );

  applyAttack(state, 0, 0);
  const poisoned = getCard(state, 1, 1);
  assert.equal(poisoned.statuses.some((status) => status.id === STATUS_IDS.POISON), true);

  nextTurn(state, []);
  assert.equal(poisoned.atk, 2);
  assert.equal(poisoned.hp, 4);
  nextTurn(state, []);
  nextTurn(state, []);
  assert.equal(poisoned.atk, 0);
  assert.equal(poisoned.hp, 2);
  assert.equal(poisoned.statuses.some((status) => status.id === STATUS_IDS.POISON), false);
});

test("demolition deals 5 damage to a random revealed enemy, otherwise hits attacker", () => {
  const state = buildState(
    ["demolition", "combater_alpha", "combater_beta", "combater_gamma", "specialist", "ranger", "trap_plague", "trap_poison", "aura_shield", "aura_blessing"],
    ["combater_alpha", "combater_beta", "combater_gamma", "ranger", "specialist", "trap_plague", "trap_poison", "aura_shield", "aura_blessing", "demolition"],
    { turnPlayerIndex: 1, randomQueue: [0] }
  );

  getCard(state, 1, 1).revealed = true;
  applyAttack(state, 0, 0);
  assert.equal(getCard(state, 1, 1).hp, 1);
});

test("combater transfer moves half attack and half max hp to another alive combater on death", () => {
  const state = buildState(
    ["combater_alpha", "combater_beta", "specialist", "ranger", "aura_shield", "aura_blessing", "trap_plague", "trap_poison", "demolition", "combater_gamma"],
    ["ranger", "specialist", "aura_shield", "aura_blessing", "trap_plague", "trap_poison", "demolition", "combater_alpha", "combater_beta", "combater_gamma"],
    { turnPlayerIndex: 1, randomQueue: [0] }
  );

  getCard(state, 0, 0).hp = 1;
  getCard(state, 1, 7).atk = 10;
  applyAttack(state, 7, 0);

  assert.equal(getCard(state, 0, 0), null);
  assert.equal(getCard(state, 0, 1).atk, 6);
  assert.equal(getCard(state, 0, 1).hp, 9);
  assert.equal(getCard(state, 0, 1).maxHp, 9);
});

test("ranger can aim, skip turn, and then fire without revealing itself or hidden target", () => {
  const state = buildState(
    ["ranger", "combater_alpha", "combater_beta", "combater_gamma", "specialist", "aura_shield", "aura_blessing", "trap_plague", "trap_poison", "demolition"],
    ["combater_alpha", "combater_beta", "combater_gamma", "specialist", "aura_shield", "aura_blessing", "trap_plague", "trap_poison", "demolition", "ranger"],
    { turnPlayerIndex: 0 }
  );

  const ranger = getCard(state, 0, 0);
  const target = getCard(state, 1, 0);

  activateCardAction(state, 0);
  assert.equal(ranger.statuses.some((status) => status.id === STATUS_IDS.RANGER_AIM), true);
  assert.equal(state.turnPlayerIndex, 1);

  nextTurn(state, []);
  applyAttack(state, 0, 0);

  assert.equal(ranger.revealed, false);
  assert.equal(target.revealed, false);
  assert.equal(target.hp, 1);
  assert.equal(ranger.statuses.some((status) => status.id === STATUS_IDS.RANGER_AIM), false);
});

test("ranger cannot perform a normal attack before spending a turn aiming", () => {
  const state = buildState(
    ["ranger", "combater_alpha", "combater_beta", "combater_gamma", "specialist", "aura_shield", "aura_blessing", "trap_plague", "trap_poison", "demolition"],
    ["combater_alpha", "combater_beta", "combater_gamma", "specialist", "aura_shield", "aura_blessing", "trap_plague", "trap_poison", "demolition", "ranger"],
    { turnPlayerIndex: 0 }
  );

  const result = applyAttack(state, 0, 0);
  assert.equal(result.ok, false);
  assert.equal(result.error, "Ranger must spend one turn aiming before attacking.");
  assert.equal(getCard(state, 0, 0).hp, 4);
  assert.equal(getCard(state, 1, 0).hp, 6);
});

test("specialist suppresses target abilities on attack against non-ranger cards", () => {
  const state = buildState(
    ["specialist", "combater_alpha", "combater_beta", "combater_gamma", "ranger", "aura_shield", "aura_blessing", "trap_plague", "trap_poison", "demolition"],
    ["trap_plague", "combater_alpha", "combater_beta", "combater_gamma", "ranger", "aura_shield", "aura_blessing", "trap_poison", "demolition", "specialist"],
    { turnPlayerIndex: 0, randomQueue: [0] }
  );

  applyAttack(state, 0, 0);
  assert.equal(getCard(state, 0, 1).statuses.some((status) => status.id === STATUS_IDS.PLAGUE), false);
});
