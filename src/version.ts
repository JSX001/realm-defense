// Bump this each round so we can tell builds apart.
// Format: <feature-bucket>.<round>  e.g. 0.6.0 = pathfinding round
//
// 0.8.0 — AoE2 theme + villagers + freeform map (The Open Field)
// 0.9.0 — Freeform-only: removed corridor maps. The Open Field is now the only map.
// 0.10.0 — Wall tower (cheap obstacle) + wave telegraphing panel during build phase.
// 0.10.1 — Wall economy: walls cost 15 stone (was 5 wood) to limit pre-game packing.
// 0.11.0 — Wood Palisades + Sappers + replan smoothing.
// 0.12.0 — Tower variety: Watchtower (line-fire). Heat/overheat on all towers.
//          Stacking frost slows. Enemy HP reduced ~15% to compensate.
// 0.12.1 — Sapper feedback: slower chew (6 DPS), bigger HP bar, swing animation, hit-flash.
// 0.12.2 — Click affordance: hover turns red and path preview hides when selected tower is unaffordable.
// 0.12.3 — Lore pass: Frost → Caltrops Tower, Lightning → Greek Fire (with flame visuals).
// 0.12.4 — Fix: tower panel and wave preview only re-render on actual change. Village ticks
//          were rebuilding panels every frame, wiping mid-click buttons (sell/upgrade dead).
// 0.13.0 — New map: The Three Roads (3 gates, 18×14, central village, 8 waves, hard).
// 0.13.1 — Timed upgrades (3-12s by target level). Tower keeps firing during construction
//          but at current level. Visible scaffold + progress ring on tower; countdown bar in panel.
// 0.14.0 — Sound: synthesized SFX for shots, hits, deaths, wave start/end, victory/defeat.
//          All audio generated at runtime via Web Audio API (no asset files).
// 0.14.1 — Resource ticker (+5 🪵 floats up from kills) and death puff effect.
// 0.14.2 — Wave-start callout: animated banner slides in/out at each wave start.
// 0.14.3 — Hero panel art: hand-coded SVG of a hilltop village at dusk.
// 0.15.0 — Tile/terrain art: layered painterly grass (tufts, dirt, flowers),
//          stone outcrops as faceted boulders, dense pine-tree forest tiles,
//          gradient water with wave streaks. All deterministic per-tile RNG.
// 0.16.0 — Save/resume: cleared maps persist to localStorage. Reset Progress
//          button on the hero panel (with confirm) for a fresh start.
// 0.17.0 — Enemy silhouettes: militia (footman + club), scoutCavalry (horse + rider),
//          skirmisher (hooded archer + bow), paladin (armored knight + helm + shield).
//          Mangonel and sapper unchanged (already had distinct shapes).
// 0.17.1 — Render at native devicePixelRatio (autoDensity). Crisper visuals on
//          retina/HiDPI screens, especially noticeable when zoomed in.
// 0.18.0 — Tower silhouettes: per-type architectural details (cannon barrel on
//          bombard, brazier flame on Greek Fire, A-frame on trebuchet, plumed
//          watchtower with arrow slits and pennant, archer arrow-slit + thatch,
//          spiked caltrops shed). Stone mortar / wood plank textures + shared
//          left-lit shading. Red flag on roof at L3+.
// 0.19.0 — 8 new maps: Citadel, The Pass, Crossroads, The Marsh, Twin Heights,
//          The Hollow, Four Winds, The Last Stand. 10 maps total.
// 0.19.1 — Abandon Map button: quit a level mid-game and return to map select
//          (with confirm; mid-wave prompt warns the wave will be discarded).
// 0.20.0 — Economy tuning: villager tick 5s → 3s (67% income up). Between-wave
//          bonus scales with wave number (15/12/9/15 base × (1 + 0.4*idx)).
//          Addresses mid-wave starvation that prevented building reactively.
// 0.20.1 — "Know Your Enemy" slideshow now shows hand-coded SVG portraits
//          matching each unit's in-game silhouette. Removes the misleading
//          "Steals" stat row (mechanic was replaced with 1-villager-per-breach).
// 0.21.0 — Flavour text pass: enemy descriptions, tower descriptions, map
//          descriptions, victory/defeat lines, map-select header all rewritten
//          in dry-chronicle voice for AoE2-flavoured tone. README rewritten
//          for public release with a fan-project disclaimer.
// 0.22.0 — Monastery (Faith aura tower): a chapel that increases damage taken
//          by enemies inside its radius (+20% to +40% by level). No projectile;
//          aura is always visible as a cream-coloured glow. Multiple monasteries
//          stack multiplicatively. Damage flows: armor-reduce → multiply.
// 0.23.0 — First-run tutorial overlay: 4-bullet primer on the maze concept,
//          resources, village lose-condition, and Start Wave. Non-blocking panel
//          appears once on first map load. Persisted seen-flag in localStorage;
//          cleared by Reset Progress alongside map progression.
// 0.24.0 — Post-game chronicle: time elapsed, towers raised, enemies slain by
//          type, total resources gathered. Difficulty selector (Easy / Standard
//          / Hard) on map-select; persists to localStorage. Easy = 0.7× HP /
//          1.20× start. Hard = 1.4× HP / 0.90× start.
// 0.24.1 — Diagnostic build: console.log added to difficulty-button click
//          handler to debug a "buttons don't change" report.
// 0.24.2 — Fix: difficulty button visual now updates on click. The handler
//          was calling renderMapSelect to refresh the active class, but that
//          function short-circuits when reason is unchanged (an optimization
//          to preserve slideshow state on the menu). Switched to in-place
//          classList toggling — faster and avoids the early-return.
// 1.0.0  — Public release: GitHub Pages deploy workflow added, Vite base
//          path made configurable via DEPLOY_BASE env var. README updated
//          with Play link + hosting instructions for forks. Build script
//          loosened (removed strict tsc step from build; added separate
//          typecheck script). Renamed package to realm-defense.
export const GAME_VERSION = '1.0.0';

// Injected at build time by Vite (see vite.config.ts).
// Falls back to "dev" if the define hasn't been set up.
declare const __BUILD_DATE__: string | undefined;
export const BUILD_DATE: string =
  typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev';
