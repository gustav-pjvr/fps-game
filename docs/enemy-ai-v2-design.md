# Enemy AI v2 | Architecture design

The design pass for [enemy-ai-v2.md](enemy-ai-v2.md), produced by a Fable architect subagent on
2026-09-15 and checked against the code on the main thread before any build work. The living doc
records what was actually built and any place the build departs from this design.

## Corrections found while checking this design against the code

- `MAX_MATCH_ENTITY_COUNT` (50) lives in `src/core/config.ts:1062`, not `App.ts`.
- There is no `mp5` weapon. The weapon ids are `pistol`, `rifle`, `shotgun`, `sniper`, `knife`,
  `unarmed` and `gooseLauncher` (`src/weapons/definitions.ts`), so the loudness table in section 6
  drops `mp5`.
- Verified as stated: no crouch anywhere in `src`; gunshots reach `EntityManager.notifyGunshot`
  through `onMuzzleFlash(point)` with no weapon id (`Game.ts:666`, `WeaponManager.ts:545` to
  `547`); `HouseFootprint` objects are built inline in `isPointInsideBuilding`
  (`BuildingManager.ts:263` to `271`); `VegetationManager.placeInstance(type, worldX, worldZ, rng)`
  has the position, trunks are cylinders of `VEGETATION_TRUNK_RADIUS` and rocks are cuboids; seed
  offset 13 is used twice and GooseManager uses 311; `waitForGameTime` exists in `e2e/smoke.spec.ts`.

## Where the code differs from the original brief (from the design pass)

## Where the code contradicts the brief

- **Weapon loudness cannot be routed today.** `entityManager.notifyGunshot(point)` is wired from WeaponManager's `onMuzzleFlash(point)` (Game.ts:660 to 667); the weapon id only travels through the separate `onFire(weaponId)` callback (WeaponManager.ts:95, 545 to 547). Fix: extend `onMuzzleFlash` to `(point, weaponId)`; `fireShot` has both at line 547.
- **The player has no crouch** (grep `crouch` across `src`: no matches). The chest-height cover ray describes the enemy's own cover only; player posture is not an input.
- **Hearing and comrade-death cues only reach idle enemies** (Enemy.ts:268 and 278 gate on `state !== 'idle'`), so a searching enemy ignores fresh evidence. The knowledge store removes that gate.
- **HouseFootprint objects are built inline inside `isPointInsideBuilding`** (BuildingManager.ts:263 to 271) and never exposed; a small `getHouseFootprintsNear(x, z, radius)` accessor is needed for corner candidates.
- **Ridge Walker high ground:** tower platforms are only reachable by the stairs, which whisker steering cannot follow. High ground therefore means terrain elevation, plus a tower platform only when the enemy already stands on one (or the director spawns it there).
- **Seed offsets:** 13 is already used twice (WATCH_TOWER_SEED_OFFSET, config.ts:1034, and the vegetation forest-texture noise, VegetationManager.ts:155). Harmless, different consumers, but the brief's "vegetation 2 and 13" hides it. GooseManager uses PATROL_SEED_OFFSET 311.
- **Game.update order:** player and weapon updates run before physics, chunks and `entityManager.update` (Game.ts:1623 to 1643), so a gunshot fired this tick is already in the store when the squad phase runs. No queueing needed.
- **Enemy count cap** is `MAX_MATCH_ENTITY_COUNT` (App.ts:104); I did not open its value, the v3.9.5 revert says 50.


Author: Fable design pass for Gustav, 2026-09-15. Branch `feature/enemy-ai`. Design only.

Geometry facts used throughout (config.ts, Enemy.ts): enemy capsule centre = ground + 0.85 (`ENEMY_HEIGHT` 1.7), head = centre + 0.6025 (`HEAD_OFFSET_Y`, Enemy.ts:50) = ground + 1.45, "chest" = centre + 0.25 = ground + 1.10. Player eye = `position + EYE_OFFSET` (0.75). Fixed step 1/60 s (config.ts:3), `MAX_FRAME_TIME` 0.25.

## 1. Module layout

All new files live under `src/entities/enemies/` unless stated. Line budgets are targets, not caps; 800 is the hard limit.

### Commit 0: behaviour-preserving split (no new behaviour)

| File | Responsibility | Lines |
|---|---|---|
| `Enemy.ts` (changed) | Entity shell: Rapier body + capsule + head colliders, GLTF clone, animation mixer, health and `takeDamage`, `applyPosition`/`groundHeightAt` cache, `faceToward`, `moveTowardWithAvoidance`, `dispose`. Implements `EnemyBody`. Forwards `update`, `onHeardGunshot`, `onNearbyDeath`, damage notifications and debug getters to its brain. | ~300 |
| `EnemyBody.ts` (new) | The interface the brain sees (below). No Rapier types leak through except `excludeRigidBody` for ray helpers. | ~60 |
| `EnemyBrain.ts` (new) | The existing `updateAggroState`, `updateChase`, `updateKiteRetreat`, `updatePatrol`, `updateSearch`, `repath`, stuck detection, LOS throttle, moved verbatim and calling `EnemyBody`. | ~430 (shrinks each step) |
| `enemyCombat.ts` (new) | `updateRangedFiring`, `fireRangedShot`, `updateMelee` as functions over a small `CombatState` object. Takes `castRay` injected so the aim-error maths is unit-testable. | ~170 |

### Step 1: knowledge and awareness

| File | Responsibility | Lines |
|---|---|---|
| `squadKnowledge.ts` | Shared per-match store: last known position, how learned, recent shot origins, decay. Pure (three.js vectors only). | ~170 |
| `perception.ts` | Awareness meter: view cone that narrows with distance, fill/drain, thresholds, hearing loudness. Pure functions plus a small per-enemy state object. | ~160 |
| `threatEvents.ts` | The `ThreatEvent` union and the hearing table (`WEAPON_LOUDNESS_RANGE`). | ~60 |
| `EntityManager.ts` (changed) | Owns `SquadKnowledge`, keeps a typed `enemies: Enemy[]` list beside `entities`, runs the squad phase before the per-enemy loop, new debug getters. | +90 |
| `src/weapons/WeaponManager.ts`, `src/core/Game.ts` (changed) | `onMuzzleFlash(point, weaponId)`. | +6 |

### Step 2: coordinator

| File | Responsibility | Lines |
|---|---|---|
| `combatCoordinator.ts` | Replaces `engagementSlots.ts` (delete it). Role tokens, caps, placement scoring, stealing, Approacher trigger. Pure. | ~260 |
| `skills/skill.ts` | `Skill` interface, `SkillContext`, selector with hysteresis, `modeOf(skill)`. | ~120 |
| `skills/patrolSkill.ts`, `faceThreatSkill.ts`, `holdAndFireSkill.ts`, `approachSkill.ts`, `flankSkill.ts`, `investigateSkill.ts`, `kiteRetreatSkill.ts`, `meleeRushSkill.ts` | One skill per file, each 60 to 120 lines. The first four reproduce today's behaviour exactly; flank and approach are new. | ~700 total |
| `EnemyBrain.ts` (changed) | Becomes perception + selector + skill dispatch; the old state bodies are gone. | ~250 |

### Step 3: position picking

| File | Responsibility | Lines |
|---|---|---|
| `tactics/obstacleRegistry.ts` | Per-chunk registry of cover-relevant obstacles (trunks, rocks, house footprints, towers). Pure data, spatial hash by 16 m cells. | ~160 |
| `tactics/candidateSources.ts` | Ring candidates plus obstacle-derived candidates (corners, trunk-shadow points, rock-shadow points, tower bases). Pure. | ~200 |
| `tactics/considerations.ts` | Each cheap consideration as a named function returning 0 to 1, plus the two ray considerations. Pure. | ~220 |
| `tactics/tacticalQuery.ts` | `sampleCandidates`, `scoreCheap`, `validateWithRays`, `TacticalPick`. Pure. | ~200 |
| `tactics/rayBudget.ts` | `RayBudget` (per tick) and `TacticalScheduler` (round robin by staleness). Pure. | ~140 |
| `tactics/terrainHeightCache.ts` | Quantised memo over `sampleHeight`, seed-keyed, bounded. | ~60 |
| `skills/takeCoverSkill.ts`, `peekAndFireSkill.ts`, `leapfrogSkill.ts` | Cover skills. | ~300 total |
| `src/world/VegetationManager.ts`, `BuildingManager.ts`, `WatchTowerManager.ts` (changed) | Register and unregister obstacles in `placeForChunk`/`removeChunk`; `getHouseFootprintsNear`. | +50 total |
| `src/core/perfStats.ts` (changed) | New counters: tactical rays, budget-exhausted ticks, picks, unreachable picks. | +25 |

### Step 4: search grid

| File | Responsibility | Lines |
|---|---|---|
| `searchGrid.ts` | Probability grid, diffusion, clearing, pair assignment. Pure. | ~260 |
| `skills/searchSweepSkill.ts` | Investigator skill driven by the grid. | ~110 |

### Step 5: readability

| File | Responsibility | Lines |
|---|---|---|
| `intentEvents.ts` | `IntentEvent` union and `IntentSink`. | ~60 |
| `calloutDirector.ts` | Rate limiting per kind and squad-wide, chooses the speaker, maps to sound hooks. Pure except the hook call. | ~140 |
| `src/audio/SoundEngine.ts` (changed) | `playCallout(kind, volumeScale, pan)` and `playGlint(volumeScale, pan)`, procedural. | +60 |
| `skills/staggerSkill.ts` | Interrupt on heavy hits. | ~60 |
| `src/core/Game.ts` (changed) | Wires `EnemyCombatHooks.onIntent`, glint sprite, stagger lurch. | +40 |

### Step 6: director

| File | Responsibility | Lines |
|---|---|---|
| `director/pacingDirector.ts` | Intensity model and phase machine, emits commands. Pure. | ~220 |
| `director/reinforcementSpawner.ts` | Picks out-of-sight spawn points behind the player from injected probes. Pure. | ~150 |
| `src/ui/menu/PlaySetupModal.ts`, `src/core/App.ts`, `src/core/Game.ts` (changed) | `directorMode` flag, checkbox, Game-owned director update after `entityManager.update`. | +80 |

## 2. Interfaces

Types below are the real signatures the implementation should carry. `Vec3` means `THREE.Vector3`; `XZ` means `{ x: number; z: number }`.

### 2.1 EnemyBody (commit 0)

```ts
export interface EnemyBody {
  readonly id: number;
  readonly archetype: EnemyArchetype;
  readonly position: { x: number; y: number; z: number };   // capsule centre, from rigidBody.translation()
  readonly headPosition: Vec3;                              // centre + HEAD_OFFSET_Y
  readonly chestPosition: Vec3;                             // centre + ENEMY_CHEST_OFFSET_Y
  readonly excludeRigidBody: RAPIER.RigidBody;              // for hasLineOfSight / castHitscan
  readonly facingYaw: number;
  moveToward(targetX: number, targetZ: number, speed: number, dt: number): void; // whisker steering, sets isMoving
  faceToward(x: number, z: number): void;
  holdPosition(): void;                                     // applyPosition(current) so the kinematic body stays glued
  setLurch(amount: number): void;                           // stagger visual, 0 clears
}
```

### 2.2 Squad knowledge (step 1)

```ts
export type KnowledgeSource = 'seen' | 'gunshot' | 'damage' | 'comradeDeath' | 'shared';

export type ThreatEvent =
  | { kind: 'seen'; enemyId: number; position: Vec3; at: number }
  | { kind: 'lost'; enemyId: number; lastSeen: Vec3; at: number }
  | { kind: 'gunshot'; origin: Vec3; weaponId: string; at: number }
  | { kind: 'damage'; enemyId: number; sourcePosition: Vec3 | null; amount: number; at: number }
  | { kind: 'comradeDeath'; deathPosition: Vec3; killerPosition: Vec3; at: number };

export interface ThreatBelief {
  readonly position: Vec3;
  readonly at: number;
  readonly source: KnowledgeSource;
  /** 1 when seen this tick, decays with age; gunshot and comrade-death evidence start below 1. */
  readonly confidence: number;
}

export interface SquadKnowledge {
  readonly belief: ThreatBelief | null;
  /** True while at least one enemy currently has line of sight. */
  readonly isThreatVisible: boolean;
  readonly visibleByIds: ReadonlySet<number>;
  report(event: ThreatEvent): void;
  /** Age-decays confidence, prunes shot memory; call once per tick. */
  update(now: number): void;
  /** Unit XZ direction from `from` toward the exponentially weighted mean of recent shot origins, or null. */
  fireDirectionFrom(from: XZ, now: number): XZ | null;
  /** Seconds since the belief was last refreshed by direct sight, Infinity if never. */
  secondsSinceSeen(now: number): number;
  reset(): void;
}

export function createSquadKnowledge(): SquadKnowledge;
```

Rules: `seen` overwrites position and sets confidence 1; `damage` with a source sets a belief at the source plus the existing 5 to 10 m error (kept, drawn from the reporting enemy's seeded tactical rng, not Math.random); `gunshot` sets a belief only if the current one is older than `ENEMY_KNOWLEDGE_GUNSHOT_OVERRIDE_AGE` or has lower confidence; `comradeDeath` sets the killer position at confidence 0.8. Confidence decays linearly to 0 over `ENEMY_KNOWLEDGE_DECAY_TIME`; at 0 the belief is dropped. Shot memory keeps the last 8 origins.

### 2.3 Perception (step 1)

```ts
export interface PerceptionState {
  awareness: number;             // 0..1
  losTimer: number;              // existing 0.15 s throttle, seeded phase offset kept
  hasLineOfSight: boolean;
  lastVisibilityFactor: number;  // for debug
}

export interface PerceptionInput {
  readonly enemyPos: XZ; readonly enemyYaw: number;
  readonly playerPos: XZ; readonly playerMovement: number;   // Player.movementBobStrength
  readonly detectionRange: number; readonly leashRange: number;
  readonly squadKnowsThreat: boolean;                        // knowledge.belief !== null
}

/** Half-angle of the view cone at this distance (degrees). Wide up close, narrow at range. */
export function viewHalfAngleDeg(distance: number, detectionRange: number): number;
/** 0 when out of cone or range; otherwise a 0..1 fill multiplier (distance falloff x movement bonus). */
export function visibilityFactor(input: PerceptionInput, distance: number): number;
/** Whether an LOS ray is worth casting this tick (in leash range, in cone or already suspicious). */
export function shouldCastLosRay(input: PerceptionInput, state: PerceptionState, distance: number): boolean;
/** Pure step: returns the new awareness value. */
export function stepAwareness(awareness: number, hasLos: boolean, factor: number, dt: number): number;
export function awarenessLevel(awareness: number): 'oblivious' | 'suspicious' | 'detected';
/** Hearing: true if the shot is inside the weapon's loudness range of this enemy. */
export function canHearGunshot(enemyPos: XZ, origin: XZ, weaponId: string): boolean;
```

Rules: `viewHalfAngleDeg = lerp(ENEMY_VIEW_HALF_ANGLE_NEAR_DEG, ENEMY_VIEW_HALF_ANGLE_FAR_DEG, clamp(distance / detectionRange))`; inside `ENEMY_PERIPHERAL_RANGE` (3 m) the cone is 180 degrees. `visibilityFactor = distanceTerm * (1 + ENEMY_AWARENESS_MOVEMENT_BONUS * playerMovement)` with `distanceTerm = 1` up to half detection range, falling linearly to `ENEMY_AWARENESS_FAR_FACTOR` at detection range, 0 beyond. Fill: `awareness += factor * dt / ENEMY_AWARENESS_FILL_TIME` while LOS; drain `dt / ENEMY_AWARENESS_DRAIN_TIME` otherwise. If the squad already knows the threat, awareness floors at `ENEMY_AWARENESS_SUSPICIOUS` (0.35): a warned enemy faces the belief and detects faster, but still needs its own sight or a role to enter combat. Thresholds: 0.35 suspicious (mode alert), 1.0 detected (mode chase). Being shot sets awareness to 1 (as today's damage rule). The spawn-ring invariant holds because fill requires distance <= detectionRange (max 20) and the ring is 25.

### 2.4 Coordinator and roles (step 2)

```ts
export type CombatRole = 'shooter' | 'approacher' | 'flanker' | 'investigator' | 'reserve';

export interface RoleCandidate {
  readonly id: number;
  readonly position: XZ;
  readonly archetypeName: string;
  readonly canShoot: boolean;          // rangedRange > 0
  readonly preferredRange: { min: number; max: number };
  readonly hasLineOfSight: boolean;
  readonly distanceToThreat: number;
  readonly awareness: number;
}

export interface CoordinatorSituation {
  readonly now: number;
  readonly belief: ThreatBelief | null;
  readonly isThreatVisible: boolean;
  /** The real player position, used only for the Approacher "moved more than 5 m while hidden" trigger. */
  readonly actualThreat: XZ;
}

export interface RoleAssignment { readonly role: CombatRole; readonly since: number; readonly score: number; }

export interface CombatCoordinator {
  /** Recomputes tokens; call once per tick in the squad phase. Deterministic given inputs and the seeded rng. */
  update(roster: readonly RoleCandidate[], situation: CoordinatorSituation): void;
  roleOf(id: number): CombatRole;
  assignmentOf(id: number): RoleAssignment | undefined;
  release(id: number): void;                     // death, leash, dispose
  readonly counts: Readonly<Record<CombatRole, number>>;
  /** Combat direction: unit XZ from the belief toward the squad centroid, for flank arcs. */
  combatDirection(): XZ | null;
}

export function createCombatCoordinator(caps: RoleCaps, rng: () => number): CombatCoordinator;
export interface RoleCaps { shooter: number; flanker: number; approacher: number; investigator: number; }

/** Pure placement score in 0..1 for holding the Shooter token. */
export function shooterPlacementScore(c: RoleCandidate): number;
```

Rules:
- Roster = enemies with awareness >= detected, or holding a role already, or suspicious with a belief younger than `ENEMY_KNOWLEDGE_DECAY_TIME`.
- `shooterPlacementScore = (hasLineOfSight ? 1 : 0.2) * rangeFit * healthIrrelevant` with `rangeFit = 1 - clamp(|d - mid| / (max - min + eps), 0, 1)`; kiters (Ridge Walker) get `rangeFit` against their own band so a sniper at 25 m outranks a Straggler at 25 m.
- Stealing: a non-holder steals the lowest-scoring Shooter token when `challenger.score >= holder.score + ENEMY_TOKEN_STEAL_MARGIN` and the holder has held for >= `ENEMY_TOKEN_MIN_HOLD`. At most one steal per role per tick.
- Flanker: when the threat is visible and there are >= 2 roster members, the closest non-Shooter with `canShoot` gets Flanker (cap `ENEMY_FLANKER_CAP`, rises to 2 at >= 6 roster).
- Approacher: granted when `secondsSinceSeen > ENEMY_APPROACH_HIDDEN_TIME` and `distance(actualThreat, belief.position) > ENEMY_APPROACH_HIDDEN_DISTANCE`; goes to the roster member nearest the belief. Rush Jobs always prefer Approacher when the threat is visible (their melee rush is an approach).
- Investigator (step 4): cap 2, assigned when nobody sees the threat and the belief is older than 1 s; picks the two members nearest the belief.
- Everyone else is `reserve`: holds a covered position facing the belief and may be promoted.
- Deterministic ordering: sort by score, then id. The rng is only used to break exact ties and to choose which of two flank sides opens first.

### 2.5 Tactical query and ray budget (step 3)

```ts
export type CandidateSource = 'ring' | 'houseCorner' | 'trunk' | 'rock' | 'towerBase' | 'towerPlatform';

export interface TacticalCandidate {
  readonly x: number; readonly z: number; readonly y: number;   // y from terrainHeightCache or explicit
  readonly source: CandidateSource;
  /** For obstacle-derived points: unit XZ from the obstacle centre to the candidate (cover faces the opposite way). */
  readonly coverNormal: XZ | null;
}

export interface TacticalRequest {
  readonly enemyId: number;
  readonly from: XZ;
  readonly threat: XZ;                       // belief position
  readonly preferredRange: { min: number; max: number };
  readonly wantCover: boolean;               // takeCover / peek / reserve
  readonly allowApproach: boolean;           // approacher, flanker, rush job: may move toward the threat
  readonly preferHighGround: boolean;        // Ridge Walker
  readonly flankArc: { centreAngle: number; halfWidthDeg: number } | null;  // flanker only
  readonly allyPositions: readonly XZ[];
  readonly allyFireLines: readonly { from: XZ; to: XZ }[];                   // shooters' lines to the threat
  readonly claimed: readonly XZ[];           // other enemies' current picks
  readonly rng: () => number;
}

export interface ScoredCandidate extends TacticalCandidate { readonly cheapScore: number; }

export interface TacticalPick {
  readonly candidate: TacticalCandidate;
  readonly score: number;
  readonly canHitThreat: boolean;
  readonly isCovered: boolean;
  readonly pickedAt: number;
  readonly expectedTravelTime: number;       // straight-line / speed
}

/** Straight ray from `from` to `to` that passes only if nothing solid intervenes (target collider excluded). */
export type LosProbe = (from: Vec3, to: Vec3) => boolean;

export function sampleCandidates(req: TacticalRequest, obstacles: ObstacleQuery, heightAt: (x: number, z: number) => number): TacticalCandidate[];
export function scoreCheap(req: TacticalRequest, candidates: readonly TacticalCandidate[]): ScoredCandidate[];  // multiplied, zeros dropped, sorted desc
export function validateWithRays(
  req: TacticalRequest, ranked: readonly ScoredCandidate[], probe: LosProbe,
  rayAllowance: number, threatEye: Vec3, threatChest: Vec3, now: number, moveSpeed: number,
): { pick: TacticalPick | null; raysUsed: number };
```

Obstacle registry:

```ts
export type ObstacleKind = 'trunk' | 'rock' | 'house' | 'tower';
export type Obstacle =
  | { kind: 'trunk'; x: number; z: number; radius: number }
  | { kind: 'rock'; x: number; z: number; halfX: number; halfZ: number }
  | { kind: 'house'; footprint: HouseFootprint }
  | { kind: 'tower'; x: number; z: number; platformY: number };

export interface ObstacleQuery { near(x: number, z: number, radius: number): readonly Obstacle[]; }
export class ObstacleRegistry implements ObstacleQuery {
  add(chunkKey: string, obstacle: Obstacle): void;
  removeChunk(chunkKey: string): void;
  near(x: number, z: number, radius: number): readonly Obstacle[];
}
```

Ray budget and scheduler:

```ts
export class RayBudget {
  constructor(perTick: number);
  beginTick(): void;
  /** Reserves up to `wanted` rays, returns how many were granted (may be fewer, may be 0). */
  take(wanted: number): number;
  readonly remaining: number;
  readonly exhaustedThisTick: boolean;
}

export interface TacticalJob { readonly enemyId: number; readonly lastRefreshAt: number; readonly priority: number; }
export class TacticalScheduler {
  constructor(refreshInterval: number, maxRaysPerJob: number);
  register(enemyId: number, priority: number): void;
  unregister(enemyId: number): void;
  /** Runs jobs in staleness order until the budget is empty or every due job ran. */
  update(now: number, budget: RayBudget, run: (enemyId: number, rayAllowance: number) => number): void;
  readonly stats: { readonly ranThisTick: number; readonly skippedThisTick: number };
}
```

### 2.6 Skill layer (step 2 onward)

```ts
export type SkillName =
  | 'patrol' | 'faceThreat' | 'investigate' | 'searchSweep'
  | 'holdAndFire' | 'takeCover' | 'peekAndFire' | 'approach' | 'flank' | 'leapfrog'
  | 'kiteRetreat' | 'meleeRush' | 'stagger';

export type EnemyMode = 'idle' | 'alert' | 'chase' | 'search';   // the existing debugState strings, unchanged

export interface PlayerView {
  readonly position: Vec3; readonly eye: Vec3; readonly chest: Vec3;
  readonly movement: number; readonly isDead: boolean; readonly ownColliderHandle: number;
  takeDamage(amount: number): void;
}

export interface SkillContext {
  readonly dt: number; readonly now: number;
  readonly body: EnemyBody; readonly archetype: EnemyArchetype;
  readonly perception: PerceptionState; readonly knowledge: SquadKnowledge;
  readonly role: CombatRole; readonly coordinator: CombatCoordinator;
  readonly tactical: TacticalService;            // requestPick(req) -> current TacticalPick | null; reportArrived(); reportUnreachable()
  readonly combat: CombatState;                  // burst, aim hold, first-shot flag, cooldowns
  readonly player: PlayerView;
  readonly events: IntentSink;
  readonly rng: () => number;                    // per-enemy seeded tactics stream
  readonly distanceToPlayer: number;
}

export interface Skill {
  readonly name: SkillName;
  readonly mode: EnemyMode;
  /** 0 means cannot run. Higher wins; the running skill keeps control unless beaten by ENEMY_SKILL_SWITCH_MARGIN. */
  priority(ctx: SkillContext): number;
  enter(ctx: SkillContext): void;
  update(ctx: SkillContext): void;
  exit(ctx: SkillContext): void;
}

export function selectSkill(current: Skill | null, skills: readonly Skill[], ctx: SkillContext): Skill | null;
```

Priority bands (fixed numbers, tuned in one table in `skills/skill.ts`): stagger 100 (while timer > 0); meleeRush 90 (distance <= ENEMY_ATTACK_RANGE, or Rush Job with detected threat); kiteRetreat 80 (kiter inside kiteTriggerRange, hysteresis as today); peekAndFire 70 (Shooter with a covered pick, LOS from the peek point); holdAndFire 65 (Shooter with LOS in range); flank 60 (Flanker role); leapfrog 58 (Approacher while a Shooter is firing); approach 55 (Approacher, or detected threat with no LOS and no Shooter token); takeCover 50 (reserve or Shooter without LOS, pick available); searchSweep 40 (Investigator with a grid); investigate 35 (belief exists, not visible); faceThreat 20 (suspicious, or squad belief while oblivious); patrol 10. Leash: any skill with mode chase or search yields to patrol when distance to the belief exceeds leashRange, exactly as today's leash rule.

Debug output, replacing nothing, adding:

```ts
export interface EnemyDebugRecord {
  readonly id: number; readonly archetype: string; readonly mode: EnemyMode; readonly skill: SkillName;
  readonly role: CombatRole; readonly awareness: number; readonly hasLos: boolean;
  readonly pick: { x: number; z: number; source: CandidateSource; covered: boolean } | null;
  readonly position: { x: number; y: number; z: number };
}
// EntityManager.getLiveEnemyDebug(): EnemyDebugRecord[]
// EntityManager.getSquadDebug(): { belief: {x,z,source,confidence,age} | null; roles: Record<CombatRole, number>; rayBudget: {perTick, usedLastTick, exhaustedTicks}; searchGrid: {cells: number, peak: {x,z,p} | null} | null }
// window.__gameDebug gains getLiveEnemyDebug() and getSquadDebug()
```

### 2.7 Search grid (step 4)

```ts
export interface SearchCell { readonly gx: number; readonly gz: number; readonly x: number; readonly z: number; probability: number; }
export class SearchGrid {
  constructor(centre: XZ, cellSize: number, radiusCells: number, rng: () => number);
  /** Diffuses probability into neighbours; call once per tick while active. */
  update(dt: number): void;
  /** Zeroes cells visible from `eye`: cheap cone and distance filter, then up to `rayAllowance` centre rays. Returns rays used. */
  clearVisibleFrom(eye: Vec3, yaw: number, probe: LosProbe, rayAllowance: number): number;
  /** Sums mass; below ENEMY_SEARCH_GRID_GIVE_UP_MASS the search ends. */
  readonly totalProbability: number;
  peakCell(): SearchCell | null;
  /** Pairs go to the top cell and its best neighbour; a third searcher takes the next peak. Deterministic. */
  assignTargets(searcherIds: readonly number[], searcherPositions: readonly XZ[]): ReadonlyMap<number, SearchCell>;
  readonly cells: readonly SearchCell[];
}
```

Diffusion: `p' = p * (1 - k) + k * mean(4-neighbours)` with `k = ENEMY_SEARCH_DIFFUSION_RATE * dt`, then mass renormalised so clearing is the only sink. Initial: 1.0 at the belief cell, 0.15 at its ring-1 neighbours. Cells on registered house footprints or outside `WORLD_SOFT_PUSH_START_RADIUS` are removed at construction.

### 2.8 Intent and callout channel (step 5)

```ts
export type IntentKind = 'spotted' | 'lost' | 'flanking' | 'approaching' | 'takingCover' | 'searching' | 'reinforcing' | 'comradeDown' | 'longShotAim' | 'staggered';
export interface IntentEvent { readonly kind: IntentKind; readonly enemyId: number; readonly position: Vec3; readonly at: number; }
export interface IntentSink { emit(event: IntentEvent): void; }

export interface CalloutHooks {
  playCallout(kind: IntentKind, origin: Vec3): void;      // Game: SoundEngine.playCallout with enemyGunshotVolume falloff and computeStereoPan
  showGlint(origin: Vec3, duration: number): void;
}
export class CalloutDirector implements IntentSink {
  constructor(hooks: CalloutHooks, rng: () => number);
  emit(event: IntentEvent): void;                         // buffers
  flush(now: number, playerPos: Vec3): void;              // once per tick: rate limits, picks one speaker per kind, calls hooks
}
```

`EnemyCombatHooks` (Enemy.ts:45) gains `onIntent(event: IntentEvent): void` so no enemy touches audio directly.

### 2.9 Director (step 6)

```ts
export type DirectorPhase = 'buildUp' | 'peak' | 'fade' | 'relax';
export interface DirectorSignals {
  readonly dt: number; readonly now: number;
  readonly damageTakenThisTick: number; readonly nearbyKillsThisTick: number;
  readonly engagedEnemyCount: number; readonly aliveEnemyCount: number;
}
export type DirectorCommand = { kind: 'spawnWave'; count: number; bias: 'mixed' | 'rusher' | 'sniper' } | { kind: 'none' };
export interface DirectorState { readonly intensity: number; readonly phase: DirectorPhase; readonly phaseElapsed: number; readonly totalSpawned: number; }
export class PacingDirector {
  constructor(rng: () => number);
  update(signals: DirectorSignals): DirectorCommand;
  readonly state: DirectorState;
}

export interface SpawnProbeContext {
  readonly player: { position: Vec3; facingYaw: number };
  readonly isBlocked: SpawnBlockedCheck;                     // Game.isSpawnBlocked (multiplayerSpawn.ts:41)
  readonly hasLosFromEye: (point: Vec3) => boolean;          // castHitscan from player eye to candidate head
  readonly heightAt: (x: number, z: number) => number;
  readonly towerPlatforms: readonly { x: number; z: number; platformY: number }[];
  readonly rng: () => number;
}
export function pickReinforcementSpawns(ctx: SpawnProbeContext, count: number, bias: DirectorCommand extends { bias: infer B } ? B : never, rayAllowance: number): { points: Vec3[]; raysUsed: number };
```

Game wiring: `if (!multiplayer && matchConfig.directorMode)` create the director; `spawnEncountersAsync` runs with `ENEMY_DIRECTOR_INITIAL_COUNT` enemies and 0 targets; after `entityManager.update` in `Game.update`, feed signals (damage taken this tick via a Player `onDamaged` counter, kills via the existing kill callback) and execute commands through `entityManager.spawnEnemy(position, archetypeOverride?)`. `spawnEnemy` gains an optional archetype parameter so a `sniper` bias can place a Ridge Walker on a tower platform (the one legitimate high-ground path today).

## 3. Per-tick data flow inside EntityManager.update(dt, player)

Once per squad, in this order:
1. `now += dt`; `rayBudget.beginTick()`.
2. `knowledge.update(now)`: decay and prune. Gunshot, damage and death events reported earlier in the same tick (weapons update precedes this call, Game.ts:1624 and 1642) are already in.
3. Build the roster snapshot from `enemies` (one `RoleCandidate` per live enemy, reading each brain's perception state from the previous tick).
4. `coordinator.update(roster, situation)`.
5. `searchGrid?.update(dt)`; create a grid when the threat becomes unseen with a belief and none exists; drop it when mass falls below the give-up threshold or the threat is seen again.
6. `scheduler.update(now, rayBudget, run)`: each due enemy's brain builds its `TacticalRequest` and runs `sampleCandidates`, `scoreCheap`, `validateWithRays` within its allowance. Picks are stored on the brain; claims are updated for later jobs in the same tick.
7. Search grid clearing: up to `ENEMY_SEARCH_CLEAR_RAYS_PER_TICK` rays from the budget remainder, one investigator per tick in rotation.

Then the existing per-enemy backward loop, unchanged in shape:
8. `enemy.update(dt, player)` runs the brain: perception step (cone and range prefilter, LOS ray only when due and worthwhile, awareness step, `seen`/`lost` reports), skill selection, skill update (movement, firing, intents to the sink), mixer update.
9. Death handling as today (dispose, splice, kill feed, dying list) plus `knowledge.report({ kind: 'comradeDeath', ... })` and `coordinator.release(id)`.
10. `callouts.flush(now, player.position)`.
11. `updateDying(dt)`.

The director is not inside EntityManager; Game runs it after this call so spawns never mutate the entity list mid-loop.

## 4. Scoring

All cheap considerations return 0 to 1 and multiply; any 0 rejects. Ray considerations run only on the top `ENEMY_TACTICAL_MAX_RAY_CANDIDATES` survivors.

| Consideration | Formula | Default | Why |
|---|---|---|---|
| rangeFit | `1 - clamp((|d - mid| - tolerance) / halfBand, 0, 1)` where `d` = candidate to threat distance, `mid` and `halfBand` from preferredRange, `tolerance = 0.25 * halfBand` | Straggler 6 to 16, Ridge Walker 14 to 30, Rush Job 0 to 3 | A flat top so several spots tie and cover decides, edges fall off so the enemy never picks a spot it cannot shoot from |
| travelCost | `1 - clamp(dist(from, candidate) / ENEMY_TACTICAL_MAX_TRAVEL, 0, 1) * ENEMY_TACTICAL_TRAVEL_WEIGHT` | max 14 m, weight 0.6 | Nearer spots preferred; never a hard reject so a distant good spot beats a bad near one |
| notTowardThreat | if `!allowApproach` and `dot(unit(candidate - from), unit(threat - from)) > cos(ENEMY_TACTICAL_APPROACH_REJECT_DEG)` and candidate is nearer to the threat than `from` by more than 1 m then 0 else 1 | 45 degrees | The plan's "reject if reaching it means running toward the player" |
| notInAllyFire | 0 if the candidate lies within `ENEMY_TACTICAL_FIRE_LINE_CLEARANCE` of any ally fire line segment (point to segment distance) and between the ally and the threat, else 1 | 1.5 m | No enemy walks through a Shooter's line |
| notClaimed | 0 if within `ENEMY_TACTICAL_CLAIM_RADIUS` of another enemy's pick or of an ally's position, else 1 | 2.5 m | Spreads the squad |
| flankArc (flanker only) | `1 - clamp(|angleDiff(candidateAngleAroundThreat, arcCentre)| / halfWidth, 0, 1)` | centre = combatDirection rotated +/-90 degrees (side chosen by rng at role grant), halfWidth 50 degrees | Flank means beside, not behind the squad |
| coverPrior | obstacle-derived candidates 1.0, ring candidates `ENEMY_TACTICAL_RING_PRIOR` when `wantCover`, else 1.0 | 0.55 | Real cover is preferred before rays are spent, but open spots survive when no cover exists |
| highGround (Ridge Walker only) | `0.5 + 0.5 * clamp((candidate.y - threat.y) / ENEMY_TACTICAL_HIGH_GROUND_DELTA, -1, 1)` | 4 m | A gentle bias, never a reject |
| worldBounds | 0 outside `WORLD_SOFT_PUSH_START_RADIUS` or inside a house footprint or tower footprint (`isPointInsideBuilding`, `isPointInsideWatchTower` with margin ENEMY_RADIUS) | | Same rule patrol already obeys |

Ray considerations (2 rays per candidate, in this order, second skipped when the first fails and `wantCover` is false):
- canHitThreat: ray from candidate head (y + 1.45) to threat eye. Score 1 if clear else 0 for shooters and flankers, else 0.3 (a reserve may wait somewhere it cannot shoot from).
- isCovered: ray from threat chest to candidate chest (y + 1.10). Score 1 if blocked, else `ENEMY_TACTICAL_UNCOVERED_SCORE` (0.35) when `wantCover`, 1 otherwise. A spot that hits from head height and is blocked at chest height is a real peek spot.

Final score = cheapScore × rayScores. The pick is the best validated candidate above `ENEMY_TACTICAL_MIN_SCORE` (0.15). Skills use `canHitThreat` and `isCovered` to choose between holdAndFire, takeCover and peekAndFire.

### Candidate sources

- Rings: at 4, 8 and 12 m around the enemy, `ENEMY_TACTICAL_RING_SAMPLES` (8) per ring at seeded angular offsets, y from `terrainHeightCache`. Flankers sample the same rings around the threat instead, restricted to the arc.
- House corners: `BuildingManager.getHouseFootprintsNear(x, z, ENEMY_TACTICAL_OBSTACLE_RADIUS)` (new; builds the same inline `HouseFootprint` objects `isPointInsideBuilding` already constructs at BuildingManager.ts:263 to 271). For each footprint, four corner points pushed `ENEMY_RADIUS + 0.6` outward along the corner diagonal in the footprint's rotated frame; `coverNormal` = the diagonal.
- Trunks and rocks: from the `ObstacleRegistry`. `VegetationManager.placeInstance` (VegetationManager.ts:292) knows `worldX`, `worldZ`, the type and the scaled footprint; it registers `{ kind: 'trunk', radius: VEGETATION_TRUNK_RADIUS }` or `{ kind: 'rock', halfX, halfZ }` under the chunk key, and `removeChunk` unregisters. For a trunk, one candidate at `centre + unit(centre - threat) * (radius + ENEMY_RADIUS + 0.3)`; for a rock, the same with the box's half diagonal. Only obstacles within 14 m of the enemy (or of the threat for flankers) are considered.
- Tower bases: `getWatchTowerPositions()` (WatchTowerManager.ts:197, pure of seed); four points at the shaft faces, `WATCH_TOWER_HALF_WIDTH + WATCH_TOWER_STAIR_WIDTH + ENEMY_RADIUS + 0.3` out, skipping the stair side is not needed since the registry check rejects points inside `isPointInsideWatchTower`.
- Tower platforms: only if the enemy is already within 2 m horizontally of a tower centre and above `platformY - 0.5`; then the platform's four rail midpoints, `y = platformY`.

Why a registry and not `collidersWithAabbIntersectingAabb`: vegetation, buildings and towers never call `registerCollider`, so `getEntity` cannot classify their colliders; rocks, house wall boxes, tower shafts, landings and railings are all `Cuboid`, so shape type cannot either. The registry costs one small object per obstacle at placement, uses data the managers already hold, and is testable without Rapier. Rays still confirm the cover for real.

## 5. Ray budget

Existing spend per enemy (Enemy.ts and enemySteering.ts): one LOS ray every 0.15 s (6.7 per s) while inside leash range; three whisker rays per tick while moving (180 per s); shot rays. A 20-enemy fight with 10 moving enemies is roughly 1900 rays per second before this design adds anything.

Recommended default: `ENEMY_TACTICAL_RAY_BUDGET_PER_TICK = 16` (960 per second), shared by tactical validation, search-grid clearing and reinforcement placement.

Derivation: a Rapier ray against this world (heightfield plus a few hundred convex colliders) is on the order of 5 to 20 microseconds in WASM; 16 rays is at most 0.3 ms of a 16.7 ms tick, which is the price of five extra moving enemies' whiskers. Demand: only enemies holding a combat role or reserve status register jobs; each job refreshes every `ENEMY_TACTICAL_REFRESH_INTERVAL` (0.5 s) and validates at most `ENEMY_TACTICAL_MAX_RAY_CANDIDATES` (6) candidates at 2 rays each, so 24 rays per s per engaged enemy. 40 engaged enemies fit the budget at full cadence; at the 50-enemy worst case (1200 rays per s demanded) the cadence stretches to about 0.63 s, which is invisible in play. The Last of Us spent 160 per frame at 30 Hz (4800 per s) on a PS3; this stays at a fifth of that on top of the existing whisker cost.

Amortisation: the scheduler orders jobs by staleness, then priority (Shooter and Flanker before reserve), and stops when the budget is empty. A job may receive fewer rays than 12; `validateWithRays` validates as many top candidates as it can and returns the best so far. Within one refresh the two rays for a candidate are cast in the order that lets the first reject skip the second.

Graceful degradation, in order: picks keep a TTL (`ENEMY_TACTICAL_PICK_TTL` 3 s) so a skipped refresh does not invalidate a spot; if no valid pick exists the skill falls back to today's behaviour (holdAndFire in place if LOS, else approach directly), which is exactly the v1 system; search-grid clearing uses only leftover rays and otherwise clears cells by distance alone (a searcher standing within 2 m of a cell centre clears it without a ray); the director uses at most `ENEMY_DIRECTOR_SPAWN_RAYS` (6) rays once per spawn decision and defers a tick when the budget is empty.

Perception savings that offset the cost: the cone prefilter skips the 0.15 s LOS ray for oblivious enemies whose player is outside the view cone. In the perf spec's baseline (player standing still at spawn, enemies patrolling) most idle enemies face away most of the time, so the idle-state ray count should drop.

perfStats additions: `perfCounters.tacticalRaycasts`, `perfCounters.rayBudgetExhaustedTicks`, `perfCounters.tacticalPicks`, `perfCounters.tacticalPicksUnreachable`; `PerfLogEntry` gains `tacticalRaysPerSec`, `rayBudgetExhaustedRatio` (exhausted ticks / ticks), `unreachablePickRatio` (cumulative). `formatPerfLine` appends `| tactical rays N/s budget-out X% unreachable Y%`.

## 6. Tuning constants (config.ts)

Step 1
- `ENEMY_VIEW_HALF_ANGLE_NEAR_DEG = 70`: wide near vision, a player at 5 m is hard to miss.
- `ENEMY_VIEW_HALF_ANGLE_FAR_DEG = 30`: at full detection range only a player near the gaze line registers.
- `ENEMY_PERIPHERAL_RANGE = 3`: inside this the cone is 180 degrees, so nobody walks past an enemy's shoulder unseen.
- `ENEMY_AWARENESS_FILL_TIME = 0.6`: seconds of full visibility to go from 0 to detected; replaces the fixed 0.4 s beat and keeps close detection about as fast as today.
- `ENEMY_AWARENESS_DRAIN_TIME = 3`: memory of a glimpse fades in a few seconds, not instantly.
- `ENEMY_AWARENESS_FAR_FACTOR = 0.4`: at detection range it takes 1.5 s of sight, rewarding distance.
- `ENEMY_AWARENESS_MOVEMENT_BONUS = 0.5`: a sprinting player is seen 50 percent faster.
- `ENEMY_AWARENESS_SUSPICIOUS = 0.35`: the alert threshold.
- `ENEMY_KNOWLEDGE_DECAY_TIME = 20`: a belief is dropped after 20 s without new evidence.
- `ENEMY_KNOWLEDGE_GUNSHOT_OVERRIDE_AGE = 2`: a gunshot only moves the belief if the last sighting is older than this.
- `ENEMY_FIRE_MEMORY_HALF_LIFE = 3`: recent shots dominate the fire-direction estimate.
- `ENEMY_WEAPON_LOUDNESS_RANGE`: `{ pistol: 30, mp5: 35, rifle: 40, shotgun: 50, sniper: 60, gooseLauncher: 45, knife: 0, unarmed: 0 }`: the rifle keeps today's 40, quieter and louder weapons scale around it. `ENEMY_HEARING_RANGE` becomes the fallback for unknown ids.

Step 2
- `ENEMY_ROLE_CAPS = { shooter: 2, flanker: 1, approacher: 1, investigator: 2 }`: Shooter cap stays 2 as agreed; one flanker so the flank reads as a move, not a swarm.
- `ENEMY_FLANKER_CAP_LARGE_SQUAD = 2` at roster >= 6.
- `ENEMY_TOKEN_STEAL_MARGIN = 0.25`: a challenger needs a clearly better placement, which stops token ping-pong.
- `ENEMY_TOKEN_MIN_HOLD = 1.5`: a Shooter fires at least one burst before losing the token.
- `ENEMY_APPROACH_HIDDEN_DISTANCE = 5` and `ENEMY_APPROACH_HIDDEN_TIME = 2`: the Last of Us trigger.
- `ENEMY_FLANK_ARC_HALF_WIDTH_DEG = 50`: flank spots sit beside the combat direction.
- `ENEMY_SKILL_SWITCH_MARGIN = 5` (on the 0 to 100 priority scale): prevents skill flicker at equal priorities.

Step 3
- `ENEMY_TACTICAL_RAY_BUDGET_PER_TICK = 16` (see section 5).
- `ENEMY_TACTICAL_REFRESH_INTERVAL = 0.5`: the plan's cadence.
- `ENEMY_TACTICAL_MAX_RAY_CANDIDATES = 6`: bounds per-job rays to 12.
- `ENEMY_TACTICAL_RING_RADII = [4, 8, 12]`, `ENEMY_TACTICAL_RING_SAMPLES = 8`: 24 ring candidates, enough angular resolution at 12 m (4.7 m spacing) for a 0.45 m capsule.
- `ENEMY_TACTICAL_OBSTACLE_RADIUS = 14`: obstacles farther than the outer ring are never reachable in one refresh.
- `ENEMY_TACTICAL_MAX_TRAVEL = 14`, `ENEMY_TACTICAL_TRAVEL_WEIGHT = 0.6`.
- `ENEMY_TACTICAL_APPROACH_REJECT_DEG = 45`.
- `ENEMY_TACTICAL_FIRE_LINE_CLEARANCE = 1.5`: capsule diameter plus margin.
- `ENEMY_TACTICAL_CLAIM_RADIUS = 2.5`.
- `ENEMY_TACTICAL_RING_PRIOR = 0.55`, `ENEMY_TACTICAL_UNCOVERED_SCORE = 0.35`, `ENEMY_TACTICAL_MIN_SCORE = 0.15`.
- `ENEMY_TACTICAL_HIGH_GROUND_DELTA = 4`.
- `ENEMY_TACTICAL_PICK_TTL = 3`.
- `ENEMY_TACTICAL_ARRIVE_DISTANCE = 1.2`: below patrol's 1.5 so cover points are actually reached.
- `ENEMY_TACTICAL_UNREACHABLE_TIME_FACTOR = 2` and `ENEMY_TACTICAL_UNREACHABLE_GRACE = 1`: a pick is logged unreachable when travel exceeds `factor * straightLine / speed + grace` or stuck detection fires en route.
- `ENEMY_CHEST_OFFSET_Y = 0.25`: chest ray height above the capsule centre.
- `ENEMY_PEEK_EXPOSE_TIME = 1.2`, `ENEMY_PEEK_HIDE_TIME = 1.5`: one burst exposed, then hide; matches the Straggler's 3-shot burst at 0.5 s.
- `ENEMY_PEEK_OFFSET = 0.8`: how far the peek steps sideways along the cover normal's perpendicular.
- `ENEMY_LEAPFROG_BOUND = 6`: advance distance per bound while a Shooter suppresses.
- `ENEMY_TERRAIN_HEIGHT_CACHE_QUANTUM = 1` and `ENEMY_TERRAIN_HEIGHT_CACHE_MAX = 4096`: 1 m quantisation is well under the noise period (67 m, Enemy.ts:56 comment).

Step 4
- `ENEMY_SEARCH_GRID_CELL = 4`, `ENEMY_SEARCH_GRID_RADIUS_CELLS = 5`: an 11 by 11 grid, 44 m across, covering the leash range.
- `ENEMY_SEARCH_DIFFUSION_RATE = 0.15` per second: the peak halves in about 5 s, so searchers move outward at a walking pace.
- `ENEMY_SEARCH_GRID_GIVE_UP_MASS = 0.2`: search ends when four fifths of the area is cleared.
- `ENEMY_SEARCH_CLEAR_RAYS_PER_TICK = 4`, `ENEMY_SEARCH_CLEAR_RANGE = 12`: cells beyond this are not cleared by sight.
- `ENEMY_SEARCH_GRID_MAX_DURATION = 30`: a hard stop, replacing the 6 s point search.

Step 5
- `ENEMY_CALLOUT_KIND_COOLDOWN = 4`, `ENEMY_CALLOUT_GLOBAL_COOLDOWN = 1.2`: one voice at a time.
- `ENEMY_CALLOUT_AUDIBLE_RANGE = 45`: reuses the enemy gunshot falloff shape.
- `ENEMY_GLINT_LEAD_TIME = 0.6` and `ENEMY_GLINT_MIN_DISTANCE = 15`: the Ridge Walker telegraphs only long shots.
- `ENEMY_STAGGER_DAMAGE_THRESHOLD = 25` and `ENEMY_STAGGER_DURATION = 0.5`: sniper, shotgun and rifle headshots stagger; pistol body shots do not.

Step 6
- `ENEMY_DIRECTOR_INITIAL_COUNT = 2`.
- `ENEMY_DIRECTOR_INTENSITY_PER_DAMAGE = 0.02` (50 HP lost is a full peak), `ENEMY_DIRECTOR_INTENSITY_PER_KILL = 0.15`, `ENEMY_DIRECTOR_KILL_RADIUS = 20`.
- `ENEMY_DIRECTOR_DECAY_PER_SECOND = 0.08`: only while nothing is engaged.
- `ENEMY_DIRECTOR_PEAK_THRESHOLD = 1.0`, `ENEMY_DIRECTOR_PEAK_MIN = 3`, `ENEMY_DIRECTOR_PEAK_MAX = 5`, `ENEMY_DIRECTOR_FADE_EXIT = 0.3`, `ENEMY_DIRECTOR_RELAX_MIN = 30`, `ENEMY_DIRECTOR_RELAX_MAX = 45`: the Left 4 Dead cycle as agreed.
- `ENEMY_DIRECTOR_MAX_ALIVE = 8`, `ENEMY_DIRECTOR_WAVE_SIZE = 2`, `ENEMY_DIRECTOR_WAVE_INTERVAL = 8`: waves of two every 8 s during build-up until the cap.
- `ENEMY_DIRECTOR_SPAWN_MIN_RADIUS = 18`, `ENEMY_DIRECTOR_SPAWN_MAX_RADIUS = 30`, `ENEMY_DIRECTOR_SPAWN_BEHIND_HALF_ANGLE_DEG = 100`, `ENEMY_DIRECTOR_SPAWN_CANDIDATES = 6`, `ENEMY_DIRECTOR_SPAWN_RAYS = 6`.

Seeds: `COORDINATOR_SEED_OFFSET = 401`, `SEARCH_GRID_SEED_OFFSET = 409`, `DIRECTOR_SEED_OFFSET = 419`, `TACTICS_SEED_OFFSET = 431` (+ spawn index, so 431 to 480).

## 7. Test plan per step

Unit tests run under Vitest with no Rapier; every module above takes `LosProbe`, `heightAt`, `ObstacleQuery`, `isBlocked` and `rng` as parameters.

Commit 0: `enemyCombat.test.ts` (aim error formula: first shot uses max error, settles to min over aimSettleTime, movement adds up to 4 degrees; burst cadence sequence). Playwright: full smoke suite green; perf log within noise of the baseline (aiMs and raycastsPerSec).

Step 1: `perception.test.ts` (cone narrows monotonically; no fill beyond detection range; fill time at half range equals FILL_TIME; drain; suspicious floor when the squad knows; spawn-ring invariant: at 25 m no awareness for any archetype), `squadKnowledge.test.ts` (source precedence, decay, fire direction weighted to recent shots, comradeDeath confidence), `threatEvents.test.ts` (loudness table, fallback). Playwright (`e2e/enemy-ai.spec.ts`, new, not part of smoke): teleport the player 12 m in front of an idle enemy and assert `getLiveEnemyDebug()` shows awareness rising and mode reaching `chase` within 3 s of game time; fire the pistol from 35 m behind a wall and assert at least one enemy's mode becomes `alert` or `search` with the squad belief within 10 m of the player; kill one enemy in view of another and assert the survivor's mode leaves `idle`. Perf log: idle-phase `raycastsPerSec` should fall (cone prefilter) and `aiMs` should not rise more than 10 percent.

Step 2: `combatCoordinator.test.ts` (caps, stealing margin and min hold, Approacher trigger only when hidden and moved > 5 m, deterministic output for a fixed roster and seed, release on death), `skill.test.ts` (selector hysteresis, melee always wins inside attack range, mode derivation). Playwright: 5-enemy match, stand in the open: assert at most 2 enemies hold `shooter` at any sample over 20 s and at least one holds `flanker`; hide behind a house for 6 s and move 8 m: assert an `approacher` appears. `killPlayerByEnemy` still passes 3 of 3 runs. Perf: `aiMs` within 15 percent of baseline.

Step 3: `considerations.test.ts` (each formula at its edges), `candidateSources.test.ts` (corner geometry for a rotated footprint, trunk-shadow point on the far side of the threat, registry near query), `tacticalQuery.test.ts` (with a fake probe: covered peek spot beats open spot; ray allowance respected; returns best-so-far when allowance runs out; claimed spots rejected), `rayBudget.test.ts` (per-tick reset, partial grants, staleness order, no job starves over N ticks), `terrainHeightCache.test.ts`. Playwright: 8 enemies near a town, engage: assert within 10 s at least half of the roster has a `pick` with `covered: true`; assert no enemy's position stays within 0.5 m for the whole fight (they move); perf log: `tactical rays` <= 960 per s, `budget-out` under 5 percent at 20 enemies, and record `unreachable` (this is the step 7 trigger).

Step 4: `searchGrid.test.ts` (mass conservation under diffusion, clearing removes visible cells, peak moves outward over time, pair assignment gives adjacent cells, give-up threshold). Playwright: get seen then break LOS and teleport 15 m sideways behind cover; assert two enemies enter `searchSweep` with targets in different cells and that the squad debug peak cell moves over 10 s.

Step 5: `calloutDirector.test.ts` (cooldowns, one speaker per kind, nearest speaker chosen), `staggerSkill` in `skill.test.ts` (interrupt and resume). Playwright: count `onIntent` events through a debug counter (`getSquadDebug().callouts`) during a fight; assert `spotted` fires once per detection, not per tick; land a sniper hit and assert the enemy's skill reads `stagger` on the next sample. Sound cannot be asserted in the sandbox; assert the hook counts.

Step 6: `pacingDirector.test.ts` (phase sequence, decay only when unengaged, wave cap, deterministic under a seed), `reinforcementSpawner.test.ts` (rejects points in the player's view via the fake probe, rejects blocked points, prefers the behind arc, tower platform for sniper bias). Playwright: start a director-mode match, take damage via `damagePlayer(40)`; assert enemy count rises within 20 s and every new enemy's spawn position was outside the player's view (record spawn positions through the debug API and check the debug `raycastForward`-style probe from the eye at spawn time, exposed as `getSquadDebug().lastSpawnsVisible`); assert the smoke suite is unchanged (default mode never constructs a director).

## 8. Build order and checkpoints

Commit 0 (before step 1): split Enemy.ts. Done when the smoke suite is green, `enemyCombat.test.ts` passes, and a perf run matches the baseline within noise.

Step 1: (a) threatEvents and loudness plumbing (`onMuzzleFlash(point, weaponId)`), (b) SquadKnowledge and EntityManager squad phase, (c) perception replacing `updateAggroState`, (d) tests and the enemy-ai e2e spec. **Checkpoint A**: unit suite, smoke suite, enemy-ai spec step 1 cases, perf run, docs update in `docs/enemy-ai-v2.md`.

Step 2: (a) skill interface and the four legacy skills wired so behaviour is unchanged, (b) coordinator replacing EngagementSlots with Shooter tokens only, (c) flank and approach skills and roles, (d) tests. **Checkpoint B** as above plus `killPlayerByEnemy` three times.

Step 3: (a) obstacle registry and manager registration, (b) candidate sources and cheap considerations, (c) ray budget and scheduler, (d) validation and picks with the unreachable log, (e) takeCover, peekAndFire, leapfrog and archetype preferences, (f) perfStats fields. **Checkpoint C**: as above plus a 30-enemy, 60 s perf fight recording the unreachable ratio (the navmesh decision input).

Step 4: grid, searchSweep, investigator role. Step 5: intent channel, callouts, glint, stagger. **Checkpoint D** after both.

Step 6: director, spawner, setup UI, Game wiring. **Checkpoint E**.

Step 7 decision after checkpoint C data; if taken, recast-navigation-js replaces `moveToward` inside `EnemyBody` only; nothing above the body changes.

## 9. Risks, failure modes, navmesh trigger, cuts

- **Reachability is the dominant risk.** Whisker steering cannot enter a house doorway, round a concave town corner, or climb stairs. Navmesh trigger metric: `tacticalPicksUnreachable / tacticalPicks` over the checkpoint C run. Threshold: above 0.20 means build step 7; below 0.10 means skip it; between, first tighten candidate sources (drop house corners that face into alleys, cap travel at 10 m) and re-measure.
- **Ray budget starvation at 50 enemies.** Bounded by design (cadence stretches). Watch `rayBudgetExhaustedRatio`; above 0.3 in the 50-enemy run, lower `ENEMY_TACTICAL_MAX_RAY_CANDIDATES` to 4 before touching the budget.
- **Token flicker or role churn** reads worse than v1. Guarded by the steal margin and min hold; the e2e role-count assertion catches regressions.
- **Perception regressions on the smoke suite.** The awareness meter must never exceed today's detection reach; the unit test on the 25 m ring invariant is the guard, and `ENEMY_AWARENESS_FILL_TIME` must not drop below 0.4 or close-range detection becomes faster than the current alert beat.
- **Sandbox timing.** All Playwright assertions above are state and position facts sampled through the debug API with game-time waits (`waitForGameTime` exists in smoke.spec.ts), never wall-clock durations.
- **Determinism leak.** Any `Math.random` in the new modules breaks seeded replays; a grep gate in the review (`Math.random` allowed only in `enemyCombat.ts` spread) keeps it honest.
- **Terrain cache growth** is bounded at 4096 entries and cleared on seed change.
- **Director spawn visibility** depends on `hasLosFromEye` at one instant; a player turning around a tick later will see a spawn. Mitigation: prefer the behind arc and require the candidate to also be outside `ENEMY_DIRECTOR_SPAWN_MIN_RADIUS`.
- **Ambiguity noted:** the plan's "stagger on heavy hits" is read here as the enemy staggering when it takes a heavy hit (readability of the player's damage). If Gustav meant the player staggering, that is a Player.ts change and a different feature.

Cut order if cost bites: leapfrog (a Shooter plus an Approacher already reads as it), then tower-base candidates, then the search grid's ray clearing (distance clearing alone still works), then the glint, then Flanker at squads under 4, then the director's sniper bias. The knowledge store, awareness meter, Shooter tokens and cover picking are the core and stay.
