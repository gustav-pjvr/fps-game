export interface EnemyArchetype {
  readonly name: string;
  readonly flavor: string;
}

/**
 * All five came out of the Fable pilot task (PLAN.md Section 8). Only ACTIVE_ENEMY_ARCHETYPE is
 * wired into gameplay right now - there's only one enemy behavior (wander/chase/attack) to
 * attach an identity to. "Rush Job" was picked because its flavor line actually matches that
 * behavior (closes distance aggressively once it detects the player). The other four are kept
 * here, unused, for whenever enemy AI variety (PLAN.md's "moderate" future extension - a real
 * state-machine/behavior difference per type, not just a name swap) actually gets built.
 */
export const ENEMY_ARCHETYPES: readonly EnemyArchetype[] = [
  { name: 'Ridge Walker', flavor: 'Patrols the high ground, silhouetted against the sky. Tactics were never the appeal.' },
  { name: 'The Straggler', flavor: 'Separated from a column that no longer exists. Takes it out on whoever’s nearest.' },
  { name: 'Rush Job', flavor: 'Closes distance like the distance insulted him.' },
  { name: 'Grass Sitter', flavor: 'Waits in the tall stuff until you’ve walked past. Patient isn’t the same as smart.' },
  { name: 'The Other One', flavor: 'You spotted the first guy. He’s why that felt easy.' },
];

export const ACTIVE_ENEMY_ARCHETYPE: EnemyArchetype = {
  name: 'Rush Job',
  flavor: 'Closes distance like the distance insulted him.',
};
