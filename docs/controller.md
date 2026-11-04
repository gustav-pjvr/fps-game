# Controller support (as built, v4.5.0)

Gamepad play through the browser Gamepad API, as the code does it now. The plan was section 2 of
`docs/squad-arsenal-night.md`; where they differ, this file is right. Shipped in v4.4.0.

Only pads that report `mapping === 'standard'` count (`GamepadInput.poll`); any other is ignored.

Files: `src/input/GamepadInput.ts` (sampling, map, hints, vibration), `src/input/InputManager.ts`
(merge with keyboard, look, pause), `src/input/actions.ts`, `src/ui/gamepadFocus.ts` (menus).

## 1. Button map

Button numbers are the standard mapping indexes (`GAMEPAD_ACTIONS` in `GamepadInput.ts`). Menu
behaviour is in `gamepadFocus.ts` (section 5).

| Button | Xbox / PlayStation | In play | In menus |
|---|---|---|---|
| 0 | A / Cross | `jump` | Activate the focused control |
| 1 | B / Circle | `interact` (default key E) | Back (section 5) |
| 2 | X / Square | `reload` | none |
| 3 | Y / Triangle | `weaponNext` | none |
| 4 | LB / L1 | unbound | none |
| 5 | RB / R1 | `grenade`: hold to cook, release to throw | none |
| 6 | LT / L2 | `aim` (held) | none |
| 7 | RT / R2 | `fire` (held, so automatics keep firing) | none |
| 8 | View / Share | `resetPlay` (restart in solo, respawn on the death screen) | none |
| 9 | Start / Options | Pause. Handled in `InputManager.update`, not as an action. | Resume from the pause menu, else back |
| 10 | L3 | Sprint, latched (below). Not in `GAMEPAD_ACTIONS`. | none |
| 11 | R3 | unbound | none |
| 12 | D-pad up | `flashlight` (the torch) | Focus up |
| 13 | D-pad down | unbound | Focus down |
| 14 | D-pad left | `weaponPrev` | Focus left, or lower a select or slider |
| 15 | D-pad right | `weaponNext` | Focus right, or raise a select or slider |
| Axes 0, 1 | Left stick | Move | Focus (past 0.45) |
| Axes 2, 3 | Right stick | Look | none |

- **Sprint** is latched in `GamepadInput.poll`: pressing L3 while the stick is pushed forward
  (`move.y < 0`) turns `sprint` on, and it stays on until the stick is no longer pushed forward.
- **Weapon slots 1 to 5** have no pad button; Y and the D-pad cycle. The hotbar
  (`src/ui/hotbar.ts`) shows "Y / Triangle" under every slot.
- `GrenadeSystem.ts` reads `consumeJustPressed('grenade') || isActionActive('grenade')`, so a held
  RB cooks and a release throws (`src/combat/grenades/GrenadeSystem.ts`).

## 2. Sticks

All in `src/input/GamepadInput.ts` and `InputManager.update`.

Move dead zone 0.15 and look dead zone 0.12, both radial (`radialDeadZone`). Look curve `v * abs(v)`
(`lookResponse`). Look rate 220 degrees per second yaw and 150 pitch, times the controller
sensitivity (`InputManager.update`). Keys and stick are added and clamped to length 1
(`mergeMoveVectors`).

`radialDeadZone` zeroes the vector inside the dead zone and rescales the rest to run 0 to 1, so a
half-pushed stick walks at half speed (`Player.applyMovement` reads `InputManager.getMoveVector`).

The look rate is turned into mouse units (`/ (MOUSE_SENSITIVITY * mouse sensitivity)`) and added to
the same delta the mouse feeds, so `Player.applyLook` scales it by zoom exactly as it does for the
mouse. The result does not depend on the mouse sensitivity setting.

## 3. Active device, engagement and pausing

`gamepadInput.activeDevice` is `'mouse'` or `'gamepad'`. `setActiveDevice` also sets
`document.documentElement.dataset.inputDevice` and rewrites the hints (section 7).

- **Pad takes over** when a button goes down or a stick moves past 0.02 and changes by more than
  0.02 since the last sample (`GamepadInput.poll`). Stick drift inside the dead zone does nothing.
- **Mouse takes over** on a mouse move with real movement, a mouse press, a wheel turn, or a key
  press (`InputManager.useMouse`). The lobby listeners in `startGamepadMenus` count only trusted
  key and mouse-press events, so a scripted event cannot flip the device there. A disconnected pad
  also drops back to `'mouse'`.
- **`isEngaged`** (`InputManager`) is `!paused && (locked || activeDevice === 'gamepad')`. It is
  the "the player is playing" test. `Game.ts` computes `isPaused = !input.isEngaged &&
  !deathScreenVisible`, so a pad needs no pointer lock.
- **Start** (button 9): when engaged it pauses (`pause()` clears every action and releases pointer
  lock). When not engaged it resumes if the pause menu is showing (`[data-testid="pause-menu"]`),
  otherwise it acts as back. `resume()` does not request pointer lock while a pad is active.
- **Window blur** pauses during pad play (`onWindowBlur`), as does a hidden tab.
- **Held buttons do not leak.** Actions held while a menu, the death screen or the briefing is up
  stay in `blockedPadActions` until released, so a held jump does not fire when play resumes.

### Which pad is in use

`choosePad` follows the pad touched most recently, not the first one listed, because Steam Input
and DS4Windows add a virtual pad. The pad in use keeps the seat until it has been idle for
`PAD_SWITCH_IDLE_SAMPLES` (30) samples. A virtual mirror reports each press a sample late, and
switching on that would deliver the press twice.

`beginFrame()` (called each display frame) makes `poll()` cache one sample: the fixed-step loop may
update several times per frame, and only the first update sees button edges. Held actions stay
visible to every step.

## 4. Aim slowdown ("aim assist") and vibration

**Aim assist is a slowdown only, with no pull.** While `Settings.getControllerAimAssist()` is on
and the crosshair is over a living `Enemy` or `RemotePlayer`, look speed is multiplied by 0.55
(`InputManager.update`). The test is `Game.crosshairOverEnemy` (`src/core/Game.ts`): a hitscan from
the camera, 60 m long, ignoring the player's own collider. It runs on every second pad sample at
most (`assistFrame % 2`, once per `sampleId`). It never runs for mouse play.

**Vibration** (`GamepadInput.vibrate`): only while the pad is the active device and
`getControllerVibration()` is on, and the pad has a `vibrationActuator` (`dual-rumble`):

| Kind | Magnitude (weak and strong) | Duration | Caller in `src/core/Game.ts` |
|---|---|---|---|
| `automatic` | 0.2 | 55 ms | firing an automatic weapon |
| `fire` | 0.4 | 55 ms | firing any other weapon |
| `damage` | 0.85 | 160 ms | the player taking damage |
| `explosion` | 0.85 | 160 ms | an explosion within 10 m of the player (several call sites) |

## 5. Menu focus

`GamepadFocus.update` (`src/ui/gamepadFocus.ts`) runs from `InputManager.update` while a match has
menus up, and from the `startGamepadMenus` frame tick when no match owns input (the lobby).

- **Which controls.** `menuControls()` lists visible buttons, selects, inputs and
  `[role="button"][tabindex]` under the topmost positioned, z-indexed overlay, minus disabled ones.
- **Moving.** D-pad, or the left stick past 0.45 on its dominant axis. `nearestFocus` picks the
  control whose centre is nearest in that direction (a pure function over rectangles, never wraps).
  The first press repeats after 0.35 s, then every 0.12 s.
- **Changing values.** Left and right on a focused select, range or number input call
  `changeControl` (steps the value and fires `input` and `change`) instead of moving focus.
- **A.** Activates the focused control. On a text, search or email field it opens an on-screen
  keyboard (A to Z, 0 to 9, Space, Delete, Done); on a select it steps to the next option.
- **B.** Calls `gamepadBack()`: fires a cancelable `gamepadback` event on the overlay root (the
  Settings panel uses it to cancel a key rebind), then clicks the control labelled Back, Cancel,
  Close, Done or Resume (`backControl`). Return to Lobby is never matched, so B cannot leave a
  match from the death or match-end screen.
- **`MENU_PRESS_GRACE` (0.3 s).** After a menu takes focus, A and B do nothing for 0.3 s. A button
  already held when the menu appeared must also be released first (`heldAtFocus`). Both stop a
  reflexive jump or interact from pressing the first button of a freshly shown screen (Respawn on a
  results screen, Return to Lobby at a guest's match end).
- **Focus ring.** `startGamepadMenus` injects a 3 px outline in `#a7ffe0` on `:focus`, scoped to
  `[data-input-device="gamepad"]`, so it shows for pad users only.

## 6. Settings

`src/settings/Settings.ts` (`localStorage` key `fps-game-settings-v1`), shown in `SettingsPanel.ts`.

| Setting | Default | Range | Used by |
|---|---|---|---|
| Controller Sensitivity | 1 | 0.3 to 3 (slider step 0.05) | look rate multiplier |
| Controller Invert Y | off | on or off | flips the pitch sign |
| Controller Aim Assist | on | on or off | the 0.55 slowdown |
| Controller Vibration | on | on or off | `GamepadInput.vibrate` |

The panel also prints `GAMEPAD_MAPPING` (`GamepadInput.ts`) as "Controller Mapping". Edit that
array when the map changes.

## 7. Button prompts

`setDeviceHint(element, mouseText, padText)` (`GamepadInput.ts`) stores both texts in
`data-mouse-hint` and `data-gamepad-hint` and shows the one for the active device.
`setActiveDevice` swaps every such element on a device change. Users of it:

- HUD prompt (`Hud.setPrompt` in `src/ui/hud.ts`): the key from the player's bindings
  (`keyHint`), the pad text from `gamepadHint(action)`. The prompt is the interact prompt (doors and
  breakers through `src/core/facilityInteraction.ts`, the Uplink prompt in `Game.ts`).
- Hotbar (`src/ui/hotbar.ts`), main menu key hints (`MainMenu.ts`: Left stick, LT / RT, L3,
  X), the death screen (`deathScreen.ts`), and the Loadout grenade key cap (`LoadoutScreen.ts`).

`gamepadHint(action)` names the button from `BUTTON_NAMES`; a missing entry reads "Button N".

## 8. How to add a bound action

1. Add the name to the `Action` union and an entry in `ACTION_LABELS` (`src/input/actions.ts`; the
   record type forces it).
2. Give it a default key in `DEFAULT_KEY_BINDINGS` and, if the player may rebind it, add it to
   `REBINDABLE_ACTIONS`. `mergeKeyBindings` (`Settings.ts`) then gives old saves the default key
   when it is free.
3. Bind a free button in `GAMEPAD_ACTIONS` (`GamepadInput.ts`). Free today: 4, 11, 13.
4. Add the button to `BUTTON_NAMES` so prompts read well, and a line to `GAMEPAD_MAPPING` for the
   Settings list.
5. Read it in game code with `input.isActionActive(action)` (held) or
   `input.consumeJustPressed(action)` (one edge per press).
6. If it needs an on-screen hint, call `hud.setPrompt(action, text)` or `setDeviceHint`.
7. Tests: add the new button to the held list in "maps buttons with one edge per press" in
   `src/input/GamepadInput.test.ts` (the expected set comes from `GAMEPAD_ACTIONS`).

## 9. Testing without a pad

All pad logic is tested with fake `Gamepad` objects. Run:

```
npx vitest run src/input src/ui/gamepadFocus.test.ts
```

- **`GamepadInput`** takes pads as an argument: `new GamepadInput().poll([pad(axes, down, index)])`,
  where the fake is `{ index, connected: true, mapping: 'standard', axes, buttons }` with 17
  buttons of `{ pressed, value }` (helper at the top of `src/input/GamepadInput.test.ts`). Call
  `poll` once per simulated sample. `setActiveDevice('mouse')` resets the device between steps.
- **`InputManager`**: `src/input/InputManager.test.ts` stubs `document`, `window` and
  `navigator.getGamepads` with `vi.stubGlobal`, mocks `gamepadFocus`, and feeds `setPad(axes, down)`
  then `input.update(dt)`. Use it to check pause on Start, look rates, the 0.55 slowdown and held
  button blocking.
- **Menu focus**: `nearestFocus` takes plain rectangles. `GamepadFocus` takes a function returning
  fake controls (`FakeControl` in `src/ui/gamepadFocus.test.ts`), and a `frame(down, pressed)`
  builder stands in for a pad sample.
- **Browser**: no e2e spec injects a pad today. To try the real UI, define
  `navigator.getGamepads` in a page init script (Playwright `addInitScript`) to return an object
  of the same shape, with `mapping: 'standard'` and `connected: true`.
