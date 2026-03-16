# Session Handoff

## Current State

- Browser multiplayer card duel scaffold is implemented on `Node.js + Express + Socket.IO + Phaser`.
- Flow already works:
  - `Lobby`
  - `Setup`
  - `Game`
- Two browser tabs can connect, find a match, confirm setup, start a game, and exchange attacks.

## Server

- Server entry: `server/src/index.js`
- Match/session storage: `server/src/gameManager.js`
- Core combat state and rules: `server/src/gameState.js`
- Ability registry: `server/src/engine/registry.js`
- Ability/effect handlers: `server/src/engine/effectHandlers.js`
- Card pool: `server/src/cards/card_definitions.json`

## Client

- Main Phaser client: `client/src/main.js`
- Current scenes are in the same file for now:
  - `LobbyScene`
  - `SetupScene`
  - `GameScene`

## What Already Works

- `join_lobby`
- match creation for 2 players
- `match_found`
- setup placement for 10 slots
- setup validation on server
- `setup_confirm`
- `game_start`
- `attack`
- `state_update`
- draw detection
- hidden/revealed visibility per player view

## Current Gameplay Rules Implemented

- Normal attack reveals both cards.
- Simultaneous combat damage is applied.
- Dead cards are removed.
- Turn passes to the other player.
- Draw is detected when both sides lose their last cards.

## Abilities Implemented

- `aura_hidden_shield`
  - When attacked while hidden, gives `shield-one` to a random alive ally.
- `aura_hidden_blessing`
  - When attacked while hidden, buffs adjacent allies twice with `+2 atk +2 hp`.
- `trap_plague_hidden`
  - When attacked while hidden, applies `plague` to a random hidden enemy card.
- `trap_poison_hidden`
  - When attacked while hidden, applies `poison` to a random hidden enemy card.
- `trap_demolition_hidden`
  - When attacked while hidden, deals `5` damage to a random revealed enemy, otherwise to the attacker if possible.
- `combater_transfer`
  - On death, transfers half attack and half max HP to another alive `Combater`.
- `ranger_aim`
  - Ranger must spend one turn charging before attacking.
  - Charged shot deals ranged damage without return damage to ranger.
  - Charged shot does not reveal ranger or hidden target.
- `specialist_suppression`
  - Suppresses target ability on attack, except against `Ranger`.

## Statuses Implemented

- `shield-one`
- `plague`
- `poison`
- `ranger-aim`

## Client UX Implemented

- Cards can be placed in setup using click-to-place.
- In battle:
  - own cards are visible
  - hidden enemy cards show as hidden
  - statuses are shown as text labels on cards
  - last effects are shown in an effects log
- Ranger usage right now:
  - click your ranger once to select
  - click the same ranger again to charge
  - on the next own turn, attack normally to fire the charged shot

## Tests

- Unit tests file: `server/tests/abilities.test.js`
- Run with:

```bash
cd server
npm test
```

- Current status at handoff:
  - all server ability tests pass

## Next Planned Work

- Add real card visuals with 3:4 aspect ratio.
- Add 20 skins:
  - 10 for player
  - 10 for opponent
- Add two frame styles:
  - player frame
  - opponent frame
- Add hover preview:
  - enlarged animated card
  - semi-transparent description panel under it
- Add better battle animations:
  - hover
  - reveal
  - attack
  - death
  - status feedback

## Important Constraints

- Keep server authoritative.
- Hidden enemy cards must stay hidden until revealed by rules.
- Ranger must not perform normal melee attack without charge.
- Current ability system is intended to stay data-driven through registry/effect handlers.

## How To Resume Tomorrow

Start with a message like:

`Прочитай session_handoff.md, потом прочитай проект и продолжай со следующего шага: ...`

Example:

`Прочитай session_handoff.md и начинай внедрять визуал карт 3:4 и hover preview.`
