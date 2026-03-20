export const STATUS_IDS = Object.freeze({
  PLAGUE: "plague",
  POISON: "poison",
  SHIELD_ONE: "shield-one",
  RANGER_AIM: "ranger-aim"
});

export const abilityRegistry = Object.freeze({
  aura_hidden_shield: {
    id: "aura_hidden_shield",
    trigger: "onRevealedByAttack",
    requireHiddenBeforeReveal: true,
    defenderOnly: true,
    effects: [
      {
        type: "applyStatus",
        targetSelector: "ownRandomAlive",
        statusId: STATUS_IDS.SHIELD_ONE
      }
    ]
  },
  aura_hidden_blessing: {
    id: "aura_hidden_blessing",
    trigger: "onRevealedByAttack",
    requireHiddenBeforeReveal: true,
    defenderOnly: true,
    effects: [
      {
        type: "buff",
        targetSelector: "ownRandomAdjacent",
        repeat: 2,
        atk: 2,
        hp: 2
      }
    ]
  },
  trap_plague_hidden: {
    id: "trap_plague_hidden",
    trigger: "onRevealedByAttack",
    requireHiddenBeforeReveal: true,
    defenderOnly: true,
    effects: [
      {
        type: "applyStatus",
        targetSelector: "enemyRandomHidden",
        statusId: STATUS_IDS.PLAGUE
      }
    ]
  },
  trap_poison_hidden: {
    id: "trap_poison_hidden",
    trigger: "onRevealedByAttack",
    requireHiddenBeforeReveal: true,
    defenderOnly: true,
    effects: [
      {
        type: "applyStatus",
        targetSelector: "attacker",
        statusId: STATUS_IDS.POISON,
        skipIfAttackerRanged: true
      }
    ]
  },
  trap_demolition_hidden: {
    id: "trap_demolition_hidden",
    trigger: "onRevealedByAttack",
    requireHiddenBeforeReveal: true,
    defenderOnly: true,
    effects: [
      {
        type: "dealDamage",
        targetSelector: "enemyRandomRevealedExcludingAttacker",
        fallbackTargetSelector: "attackerIfAliveAndRevealed",
        amount: 5
      }
    ]
  },
  combater_transfer: {
    id: "combater_transfer",
    trigger: "onCardDied",
    effects: [
      {
        type: "transferStats",
        targetSelector: "ownRandomAliveClassCombater",
        atk: 2,
        hp: 3
      }
    ]
  },
  ranger_aim: {
    id: "ranger_aim",
    actions: {
      activateAim: [
        {
          type: "mutateTurnBehavior",
          mutation: STATUS_IDS.RANGER_AIM
        }
      ],
      fireAimedShot: [
        {
          type: "dealDamage",
          targetSelector: "target",
          amountFromSourceAtk: true,
          preserveHidden: true
        }
      ]
    }
  },
  specialist_suppression: {
    id: "specialist_suppression",
    suppressTargetAbilities: true,
    suppressExceptClass: "Ranger"
  }
});

export function getAbilityDefinition(abilityId) {
  return abilityRegistry[abilityId] || null;
}
