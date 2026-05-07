# Realm Defense

An isometric maze-builder tower defense game in the spirit of Age of Empires II.

The realm is being raided. Militia, scout cavalry, paladins, mangonels and sappers come down the roads from many gates, all of them aimed at the village. You hold timber, gold, stone, and grain. With those you raise watchtowers, bombards, palisades, Greek Fire, and trebuchets. **Where you build is the road they walk** — your towers don't just shoot, they shape the battlefield. Hold the village, hold the realm.

> **A fan project.** Not affiliated with, endorsed by, or otherwise connected to Microsoft, Forgotten Empires, or the Age of Empires franchise. Style and naming are tributes, nothing more.

## Play it

**[→ Play in your browser](https://JSX001.github.io/realm-defense/)**

No install required. Best on desktop with a mouse. Progress saves to your browser's localStorage automatically.

## Quick start (run it locally)

Requires Node.js 18+.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (default `http://localhost:5173`).

## How to play

You start each map with four resources: 🪵 wood, 🪙 gold, 🪨 stone, 🌾 grain.

A village of villagers (each tied to one resource) ticks income passively while alive. Enemies that breach the village kill one villager — your income decays. Lose every villager and the realm falls.

Between waves you build. Click a tower button at the bottom of the screen, then click any grass tile to place. Towers cost combinations of resources. Walls and palisades are buildable too — they don't shoot, but enemies must walk around them (sappers chew through them given time).

When you're ready, press **Start Wave**. Enemies spawn from the gate(s) and pathfind toward the village. Whenever you place or sell a tower, all live enemies replan around it.

Towers can be **upgraded in five levels** (timed; they keep firing during construction at their current level). They also **overheat** under sustained fire — a heat bar appears above any tower under stress, and an overheated tower briefly stops shooting. Plan accordingly.

Win by surviving every wave on the map. Lose if every villager dies.

## Controls

| Key | Action |
|---|---|
| Mouse wheel | Zoom in / out (cursor-anchored) |
| Click tile | Place selected tower / open existing tower's panel |
| Esc | Deselect current build or tower |
| P | Pause |
| Space | Cycle game speed (1× / 2× / 4×) during a wave |
| Click "Start Wave" | Begin the next wave |
| Click "Abandon Map" | Quit and return to the map-select screen |

## The roster

### Towers

| Name | Cost (primary) | Notes |
|---|---|---|
| 🏹 Archer Tower | wood + grain | Reliable single-target. Cheap, common. |
| 💣 Bombard | stone + wood | Heavy splash. Punishes grouped foes. |
| 🪤 Caltrops Tower | gold + wood | Low damage, slows. Stacks devastatingly with allies. |
| 🔥 Greek Fire | gold + stone | Sticky liquid fire chains between targets. **Pierces armour.** |
| 🪨 Trebuchet | stone + wood | Long range, heavy damage, hits everything including siege armour. |
| 🗼 Watchtower | wood + stone | Very long range, but only fires along the four cardinal lines from itself. Brilliant on long straight approaches. |
| 🧱 Stone Wall | stone | Slow to destroy. Sappers chew through given time. |
| 🪵 Wood Palisade | wood | Cheap, weak, perfect for shaping the maze. |

### Enemies

| Name | Behaviour |
|---|---|
| Militia | Levy infantry. Cheap fodder; arrives in every wave. |
| Scout Cavalry | Fast and lightly armoured. Probes and exploits weak points. |
| Skirmisher | Light, ranged, in swarms. Splash and chain weapons clean them up; single-target archers struggle. |
| Paladin | Heavily armoured cavalry. Plate. Trebuchets and Bombards are the answer. |
| Mangonel | **Armoured siege engine.** Only Greek Fire and Trebuchets pierce its armour. |
| Sapper | Stops at walls and chews through them with a pickaxe. Fragile in the open. |

## Maps

Ten maps from gentle one-gate keeps to four-gate sieges with mixed terrain — a defile through forest, a marsh with a single bridge, a four-winds crossroads, and the realm's last fortress where every banner you have ever fought comes to claim it.

Difficulty is per-map (easy / medium / hard), shown on each map card. Cleared maps persist across sessions in `localStorage`.

## Hosting your own copy on GitHub Pages

The repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that auto-deploys to GitHub Pages on every push to `main`.

To set it up on a fresh fork:

1. Fork or clone this repo to your GitHub account.
2. In the new repo, open **Settings → Pages**, set **Source** to **GitHub Actions** (not "Deploy from a branch").
3. Edit `.github/workflows/deploy.yml`. Find the line `DEPLOY_BASE: /realm-defense/` and change `realm-defense` to match your repo name.
4. Push any commit to `main`. The Actions tab will show the build running. Within ~2 minutes the site is live at `https://JSX001.github.io/realm-defense/`.

The repo must be public for free GitHub Pages, OR you need a paid GitHub plan for private-repo Pages (and your players will need access to the repo to view it — usually not what you want).

## Tech

Vite, TypeScript, PixiJS v8, Zustand. Audio synthesised at runtime via the Web Audio API — no audio assets are bundled. All artwork is hand-coded SVG and Pixi Graphics primitives — no raster assets either.

```
src/
├── main.ts              # PixiJS bootstrap, audio unlock
├── game/
│   ├── Game.ts          # Main loop, economy, speed, pause, sound integration
│   ├── Grid.ts          # Isometric tile grid + freeform pathfinding
│   ├── WaveManager.ts   # Spawn schedule with per-spawn pathIndex
│   └── Pathfinding.ts   # 8-direction A* with octile heuristic
├── entities/
│   ├── Enemy.ts         # Path-following, slows, hit-flash, sapper chew
│   ├── Tower.ts         # Targeting, heat/overheat, timed upgrades, per-tower silhouette
│   ├── Projectile.ts    # Travel + impact + chain/splash effects
│   └── Village.ts       # Villagers, passive income, breach-kill logic
├── data/
│   ├── resources.ts     # Resources type + helpers
│   ├── towers.ts        # Tower defs and per-level stats
│   ├── enemies.ts       # Enemy defs
│   └── maps.ts          # Ten maps + tile-grid helpers
├── ui/HUD.ts            # HTML overlay (map select, tower panel, wave preview, hero SVG)
├── state/store.ts       # Zustand store
└── utils/
    ├── isometric.ts     # gridToScreen / screenToGrid
    ├── sound.ts         # Web Audio synthesised SFX
    ├── effects.ts       # Resource ticker, death puff
    └── persistence.ts   # localStorage hero progression
```

## Credits

Built as a personal project. All code is original; visual style and unit naming are deliberate tributes to Age of Empires II — a game whose authors deserve all the credit for the era they evoked. No audio, art, or text from any commercial AoE product is used.

If you ship a fork, please keep this disclaimer.

## Licence

MIT.
