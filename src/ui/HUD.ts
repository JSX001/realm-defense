import { gameStore } from '../state/store';
import { TOWER_LIST, TOWERS, totalSpent, SELL_REFUND, getLevelStats } from '../data/towers';
import { MAP_LIST, MAPS } from '../data/maps';
import { ENEMIES } from '../data/enemies';
import { Game } from '../game/Game';
import { GAME_VERSION, BUILD_DATE } from '../version';
import {
  Resources,
  RESOURCE_KEYS,
  RESOURCE_ICONS,
  RESOURCE_LABELS,
  formatCost,
  scaleCost,
  canAfford
} from '../data/resources';
import { isTutorialSeen, markTutorialSeen, loadDifficulty, saveDifficulty, DIFFICULTY_TUNING, Difficulty } from '../utils/persistence';

export function setupHUD(game: Game): void {
  const resourcesEl = document.getElementById('resources-display')!;
  const waveEl = document.getElementById('wave-display')!;
  const mapNameEl = document.getElementById('map-name')!;
  const towerMenuEl = document.getElementById('tower-menu')!;
  const towerPanelEl = document.getElementById('tower-panel')!;
  const startWaveBtn = document.getElementById('start-wave-btn') as HTMLButtonElement;
  const speedBtn = document.getElementById('speed-btn') as HTMLButtonElement;
  const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
  const pausedBanner = document.getElementById('paused-banner')!;
  const overlayEl = document.getElementById('overlay')!;
  const overlayInner = document.getElementById('overlay-inner')!;
  const hudEl = document.getElementById('hud')!;
  const wavesEl = document.getElementById('wave-controls')!;
  const hudVersionEl = document.getElementById('hud-version')!;
  hudVersionEl.textContent = `v${GAME_VERSION} · ${BUILD_DATE}`;

  // Build the four-resource display once; we update text content in render().
  function buildResourceDisplay(): void {
    resourcesEl.innerHTML = '';
    for (const k of RESOURCE_KEYS) {
      const el = document.createElement('div');
      el.className = 'resource-stat';
      el.dataset.resource = k;
      el.innerHTML = `<span class="icon">${RESOURCE_ICONS[k]}</span><span class="value" data-r="${k}">0</span>`;
      el.title = RESOURCE_LABELS[k];
      resourcesEl.appendChild(el);
    }
  }
  buildResourceDisplay();

  function buildTowerMenu(): void {
    towerMenuEl.innerHTML = '';
    for (const t of TOWER_LIST) {
      const btn = document.createElement('button');
      btn.className = 'tower-btn';
      btn.dataset.towerId = t.id;
      const stats = t.levels[0];
      const costStr = formatCost(stats.cost);
      if (t.id === 'wall' || t.id === 'palisade') {
        btn.title = `${t.name}\n${t.description}\n\nCost: ${costStr}`;
      } else if (t.id === 'monastery') {
        const auraPct = stats.faithMultiplier ? Math.round((stats.faithMultiplier - 1) * 100) : 0;
        btn.title = `${t.name}\n${t.description}\n\nCost: ${costStr}\nFaith aura: +${auraPct}% damage taken within ${stats.range} tiles`;
      } else {
        const targetingStr = t.targetsArmored && t.targetsGround
          ? 'Hits all units (armor-piercing)'
          : t.targetsArmored ? 'Heavy armor only' : 'Light & medium units only';
        btn.title = `${t.name}\n${t.description}\n\nCost: ${costStr}\nDamage: ${stats.damage}  Range: ${stats.range}  Rate: ${stats.fireRate}/s\n${targetingStr}`;
      }
      btn.innerHTML = `
        <span class="icon">${t.icon}</span>
        <span class="name">${t.name.split(' ')[0]}</span>
        <span class="cost">${costStr}</span>
      `;
      btn.addEventListener('click', () => {
        const cur = gameStore.getState().selectedBuildId;
        gameStore.getState().selectBuild(cur === t.id ? null : t.id);
      });
      towerMenuEl.appendChild(btn);
    }
  }
  buildTowerMenu();

  startWaveBtn.addEventListener('click', () => game.startWave());
  speedBtn.addEventListener('click', () => game.cycleSpeed());
  pauseBtn.addEventListener('click', () => game.togglePause());

  // Abandon Map: confirm before tearing down. The phase check defends against
  // the (currently impossible) case of a stale click reaching us on the menu.
  const quitBtn = document.getElementById('quit-to-menu-btn');
  if (quitBtn) {
    quitBtn.addEventListener('click', () => {
      const phase = gameStore.getState().phase;
      if (phase !== 'building' && phase !== 'wave') return;
      // Slightly different prompt mid-wave to underline the cost.
      const msg = phase === 'wave'
        ? 'Abandon this map? The current wave will be discarded. Map progress is not saved.'
        : 'Abandon this map and return to map select?';
      if (window.confirm(msg)) game.quitToMenu();
    });
  }

  // First-run tutorial dismiss buttons. The overlay itself is shown by the
  // render() phase-transition logic, not here.
  const tutorialEl = document.getElementById('tutorial-overlay');
  const dismissTutorial = () => {
    if (!tutorialEl) return;
    tutorialEl.classList.remove('active');
    tutorialEl.setAttribute('aria-hidden', 'true');
    markTutorialSeen();
  };
  document.getElementById('tut-got-it-btn')?.addEventListener('click', dismissTutorial);
  document.getElementById('tut-close-btn')?.addEventListener('click', dismissTutorial);

  window.addEventListener('keydown', (e) => {
    const phase = gameStore.getState().phase;
    const inGame = phase === 'building' || phase === 'wave';
    if (e.key === 'Escape') {
      gameStore.getState().selectBuild(null);
      gameStore.getState().selectTower(null);
    } else if ((e.key === 'p' || e.key === 'P') && inGame) {
      e.preventDefault();
      game.togglePause();
    } else if (e.key === ' ' && phase === 'wave') {
      e.preventDefault();
      game.cycleSpeed();
    }
  });

  /**
   * Build the end-of-map summary block: per-resource final / earned with %.
   */
  function endOfMapSummary(s: ReturnType<typeof gameStore.getState>): string {
    const final = s.resources;
    const villageStats = s.villageStats;

    let html = '<div class="resource-summary">';

    // Lead with villagers — the actual measure of success.
    if (villageStats) {
      const survived = villageStats.alive;
      const total = villageStats.total;
      const pct = total > 0 ? Math.round((survived / total) * 100) : 0;
      const cls = pct >= 70 ? 'good' : pct >= 40 ? 'mid' : 'bad';
      html += `
        <div class="rs-row villager-row">
          <span class="rs-icon">🏘️</span>
          <span class="rs-label">Villagers saved</span>
          <span class="rs-final">${survived} / ${total}</span>
          <span class="rs-pct ${cls}">${pct}%</span>
        </div>
      `;
    }

    // Then the resources still on hand.
    for (const k of RESOURCE_KEYS) {
      html += `
        <div class="rs-row">
          <span class="rs-icon">${RESOURCE_ICONS[k]}</span>
          <span class="rs-label">${RESOURCE_LABELS[k]}</span>
          <span class="rs-final">${final[k]}</span>
          <span class="rs-pct"></span>
        </div>
      `;
    }
    html += '</div>';

    // Chronicle: time, total earned, towers raised, enemies slain by type.
    // This panel is what AoE2 players come to a TD looking for — the receipt.
    html += chronicleSummary(s);

    return html;
  }

  /**
   * Post-game "chronicle" — total earned, time elapsed, towers raised, and the
   * full enemy-kill ledger sorted by count. Reads stat fields the store
   * accumulates during the run.
   */
  function chronicleSummary(s: ReturnType<typeof gameStore.getState>): string {
    const elapsedMs = Math.max(0, s.mapEndedAt - s.mapStartedAt);
    const elapsedTotal = Math.floor(elapsedMs / 1000);
    const mins = Math.floor(elapsedTotal / 60);
    const secs = elapsedTotal % 60;
    const elapsedStr = `${mins}m ${secs.toString().padStart(2, '0')}s`;

    const totalEarned = s.totalEarned;
    const earnedStr = RESOURCE_KEYS.map(k => `${RESOURCE_ICONS[k]}${totalEarned[k]}`).join('  ');

    // Enemy kills sorted descending by count, then alphabetically for stability.
    const killEntries = Object.entries(s.enemiesKilledByType)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const totalKills = killEntries.reduce((acc, [, n]) => acc + n, 0);

    const killRowsHtml = killEntries.length === 0
      ? '<div class="ch-empty">No enemies fell.</div>'
      : killEntries.map(([id, count]) => {
          const def = ENEMIES[id];
          const name = def?.name ?? id;
          return `
            <div class="ch-kill-row">
              <span class="ch-kill-name">${name}</span>
              <span class="ch-kill-count">${count}</span>
            </div>
          `;
        }).join('');

    return `
      <div class="chronicle">
        <h3 class="ch-title">Chronicle of the Defence</h3>
        <div class="ch-grid">
          <div class="ch-stat">
            <span class="ch-stat-label">Time elapsed</span>
            <span class="ch-stat-value">${elapsedStr}</span>
          </div>
          <div class="ch-stat">
            <span class="ch-stat-label">Towers raised</span>
            <span class="ch-stat-value">${s.totalTowersBuilt}</span>
          </div>
          <div class="ch-stat">
            <span class="ch-stat-label">Enemies slain</span>
            <span class="ch-stat-value">${totalKills}</span>
          </div>
          <div class="ch-stat ch-stat-wide">
            <span class="ch-stat-label">Total resources gathered</span>
            <span class="ch-stat-value ch-earned">${earnedStr}</span>
          </div>
        </div>
        <div class="ch-killboard">
          <div class="ch-killboard-title">Enemy ledger</div>
          ${killRowsHtml}
        </div>
      </div>
    `;
  }

  // Slideshow state (module-level closure variables, scoped to setupHUD).
  // When the home screen is built, we (re)attach the slideshow to its DOM nodes.
  let slideshowIndex = 0;
  let slideshowTimer: ReturnType<typeof setInterval> | null = null;
  let slideshowHovered = false;
  const SLIDESHOW_INTERVAL_MS = 6500;
  const enemyList = Object.values(ENEMIES);

  /** Tracks which overlay is currently rendered, so we don't rebuild on every store tick. */
  let currentOverlayReason: 'initial' | 'won' | 'lost' | null = null;

  /**
   * HTML caches: only call innerHTML= when the new HTML differs from the last
   * write. Otherwise we'd rebuild the panel ~60 times/sec because village
   * income ticks change resources every frame. That rebuild was wiping mid-click
   * buttons and breaking interactivity.
   */
  let lastTowerPanelHtml = '';
  let lastWavePreviewHtml = '';
  /** Track phase across renders so we can detect transitions (e.g., to fire the wave-start banner). */
  let lastPhase: ReturnType<typeof gameStore.getState>['phase'] = 'menu';

  function stopSlideshow(): void {
    if (slideshowTimer !== null) {
      clearInterval(slideshowTimer);
      slideshowTimer = null;
    }
  }

  function startSlideshow(): void {
    stopSlideshow();
    slideshowTimer = setInterval(() => {
      if (slideshowHovered) return;
      slideshowIndex = (slideshowIndex + 1) % enemyList.length;
      renderSlide();
    }, SLIDESHOW_INTERVAL_MS);
  }

  /** Restart the auto-advance timer from zero (used after a manual nav). */
  function resetSlideshowTimer(): void {
    if (slideshowTimer === null) return;
    stopSlideshow();
    startSlideshow();
  }

  function renderSlide(): void {
    const slideEl = document.getElementById('slide-content');
    const dotsEl = document.getElementById('slideshow-dots');
    if (!slideEl || !dotsEl) return;

    const enemy = enemyList[slideshowIndex];
    const layer = enemy.layer === 'armored' ? '🛡️ Heavy Armor' : '🚶 Ground';
    const armor = enemy.armor ? ` &nbsp;•&nbsp; Armor ${enemy.armor}` : '';
    const colorHex = '#' + enemy.color.toString(16).padStart(6, '0');
    const rewardStr = formatCost(enemy.reward);
    const portraitSvg = enemyPortraitSvg(enemy.id, enemy.color);

    slideEl.innerHTML = `
      <div class="slide-portrait" style="--enemy-color:${colorHex}">${portraitSvg}</div>
      <div class="slide-title-row">
        <div class="slide-icon" style="color:${colorHex}">●</div>
        <div class="slide-titles">
          <div class="slide-name">${enemy.name}</div>
          <div class="slide-meta">${layer} &nbsp;•&nbsp; HP ${enemy.hp} &nbsp;•&nbsp; Speed ${enemy.speed}${armor}</div>
        </div>
      </div>
      <div class="slide-desc">${enemy.description}</div>
      <div class="slide-stats">
        <div class="row"><span class="l">Drops on kill</span><span class="v">${rewardStr}</span></div>
      </div>
      <div class="slide-counter"><strong>Counter:</strong> ${enemy.counterTip}</div>
    `;

    // Re-render dots to update active state.
    dotsEl.innerHTML = enemyList.map((_, i) =>
      `<button class="slideshow-dot${i === slideshowIndex ? ' active' : ''}" data-slide="${i}" aria-label="Show enemy ${i + 1}"></button>`
    ).join('');
  }

  function setSlide(i: number): void {
    slideshowIndex = ((i % enemyList.length) + enemyList.length) % enemyList.length;
    renderSlide();
    resetSlideshowTimer();
  }

  function renderMapSelect(reason: 'initial' | 'won' | 'lost'): void {
    // If we're already showing this screen, skip rebuild — preserves slideshow state
    // and any animations in progress.
    if (currentOverlayReason === reason) {
      overlayEl.classList.add('active');
      return;
    }
    currentOverlayReason = reason;
    slideshowHovered = false; // reset stale hover state from previous mount

    const s = gameStore.getState();
    const completedCount = s.completedMapIds.size;

    // ─── Top of overlay ──────────────────────────────────────────────
    // Initial: show hero panel.
    // Won/Lost: show end-of-map banner + resource summary, then hero panel below.
    let topHtml = '';
    if (reason === 'won') {
      const mapName = s.currentMapId ? MAPS[s.currentMapId].name : '';
      const allClear = completedCount === MAP_LIST.length;
      topHtml += `
        <div class="end-banner">
          <h1>VICTORY</h1>
          <div class="subtitle">The host is broken. ${mapName} stands. ${allClear && MAP_LIST.length > 1 ? 'Every realm has been defended — the chronicles will remember the watchman.' : ''}</div>
        </div>
        ${endOfMapSummary(s)}
      `;
    } else if (reason === 'lost') {
      const mapName = s.currentMapId ? MAPS[s.currentMapId].name : '';
      topHtml += `
        <div class="end-banner">
          <h1 class="defeat">DEFEAT</h1>
          <div class="subtitle">The village of ${mapName} has fallen. The last villager lies dead in the smoke.</div>
        </div>
        ${endOfMapSummary(s)}
      `;
    }

    // ─── Hero + Slideshow ───────────────────────────────────────────
    const heroStatsHtml = MAP_LIST.length > 1
      ? `
        <div class="hero-stats">
          <div class="stat">
            <span class="stat-label">Maps Cleared</span>
            <span class="stat-value">${completedCount} / ${MAP_LIST.length}</span>
          </div>
        </div>
      `
      : '';
    // Reset Progress button: only shown when there's something to reset.
    // Confirms before wiping (small accident-protection).
    const resetBtnHtml = completedCount > 0
      ? `<button class="reset-progress-btn" id="reset-progress-btn" type="button">Reset Progress</button>`
      : '';
    const heroHtml = `
      <div class="home-hero">
        <div class="hero-image">
          ${heroSvg()}
          <div class="hero-title">REALM DEFENSE</div>
          <div class="hero-tagline">Hold the four resources. Hold the realm.</div>
          ${heroStatsHtml}
          <div class="hero-version">v${GAME_VERSION} &nbsp;·&nbsp; ${BUILD_DATE}</div>
          ${resetBtnHtml}
        </div>
        <div class="enemy-slideshow" id="enemy-slideshow">
          <div class="slideshow-header">
            <h2>Know Your Enemy</h2>
            <div class="slideshow-arrows">
              <button id="slide-prev" aria-label="Previous">◀</button>
              <button id="slide-next" aria-label="Next">▶</button>
            </div>
          </div>
          <div class="slide-content" id="slide-content"></div>
          <div class="slideshow-dots" id="slideshow-dots"></div>
        </div>
      </div>
    `;

    // ─── Maps Panel ─────────────────────────────────────────────────
    const isSingleMap = MAP_LIST.length === 1;
    const cardsHtml = MAP_LIST.map((m) => {
      const completed = s.completedMapIds.has(m.id);
      const badge = completed ? '<span class="completed-badge">Cleared</span>' : '';
      const startStr = RESOURCE_KEYS.map(k => `${RESOURCE_ICONS[k]}${m.startResources[k]}`).join(' ');
      return `
        <div class="map-card" data-map-id="${m.id}">
          <div class="map-card-header">
            <h3>${m.name}${badge}</h3>
            <span class="difficulty ${m.difficulty}">${m.difficulty}</span>
          </div>
          <p>${m.description}</p>
          <div class="stats">${m.cols}×${m.rows} • ${m.waves.length} waves<br>${startStr}</div>
        </div>
      `;
    }).join('');

    const headerLabel = isSingleMap
      ? (reason === 'initial' ? 'Begin' : 'Play Again')
      : (reason === 'initial' ? 'Choose the realm to defend' : 'Choose the next realm');
    const progressPill = isSingleMap
      ? ''
      : `<div class="progress-pill">Progress: <span class="num">${completedCount}</span> / ${MAP_LIST.length}</div>`;

    // Difficulty selector. Three buttons; the active one is highlighted.
    // Persists to localStorage and applies at next map-load (Game.loadMap).
    const currentDifficulty = loadDifficulty();
    const difficultyHtml = `
      <div class="difficulty-selector" title="Affects enemy HP and starting resources. Persists across sessions.">
        <span class="diff-label">Difficulty:</span>
        ${(['easy', 'standard', 'hard'] as Difficulty[]).map(d => {
          const t = DIFFICULTY_TUNING[d];
          const active = d === currentDifficulty ? ' active' : '';
          return `<button class="diff-btn${active}" data-diff="${d}" type="button" title="${t.description}">${t.label}</button>`;
        }).join('')}
      </div>
    `;

    const mapsHtml = `
      <div class="maps-panel">
        <div class="maps-panel-header">
          <h2>${headerLabel}</h2>
          <div class="maps-header-right">
            ${difficultyHtml}
            ${progressPill}
          </div>
        </div>
        <div class="map-grid">${cardsHtml}</div>
      </div>
    `;

    overlayInner.innerHTML = topHtml + heroHtml + mapsHtml;

    // Wire map cards
    overlayInner.querySelectorAll<HTMLElement>('.map-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.mapId!;
        stopSlideshow();
        game.loadMap(id);
        overlayEl.classList.remove('active');
      });
    });

    // Reset Progress: only present if user has cleared at least one map.
    // Confirm before wiping to prevent accidental clicks.
    const resetBtn = document.getElementById('reset-progress-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.confirm('Reset all map progress? This cannot be undone.')) {
          gameStore.getState().resetProgress();
          // Re-render the map select so the cleared badges update immediately.
          renderMapSelect(reason);
        }
      });
    }

    // Difficulty buttons. Saving + toggling the active class in-place keeps
    // the visual in sync. We deliberately do NOT call renderMapSelect to
    // refresh — that function short-circuits when the reason is unchanged
    // (an optimization to preserve slideshow state on the menu screen).
    // In-place class toggling is also faster and preserves DOM state.
    overlayInner.querySelectorAll<HTMLElement>('.diff-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const d = btn.dataset.diff as Difficulty;
        if (d !== 'easy' && d !== 'standard' && d !== 'hard') return;
        saveDifficulty(d);
        // Update active class on all sibling buttons.
        overlayInner.querySelectorAll<HTMLElement>('.diff-btn').forEach((b) => {
          if (b.dataset.diff === d) b.classList.add('active');
          else b.classList.remove('active');
        });
      });
    });

    // Wire slideshow controls
    const slideshowEl = document.getElementById('enemy-slideshow');
    if (slideshowEl) {
      slideshowEl.addEventListener('mouseenter', () => { slideshowHovered = true; });
      slideshowEl.addEventListener('mouseleave', () => { slideshowHovered = false; });
    }
    document.getElementById('slide-prev')?.addEventListener('click', () => setSlide(slideshowIndex - 1));
    document.getElementById('slide-next')?.addEventListener('click', () => setSlide(slideshowIndex + 1));
    document.getElementById('slideshow-dots')?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const idx = target.dataset.slide;
      if (idx !== undefined) setSlide(parseInt(idx, 10));
    });

    // Initial slide render and start auto-advance.
    renderSlide();
    startSlideshow();

    overlayEl.classList.add('active');
  }

  function renderTowerPanel(): void {
    const tower = game.getSelectedTower();
    const s = gameStore.getState();
    if (!tower || !s.selectedTower) {
      towerPanelEl.style.display = 'none';
      lastTowerPanelHtml = ''; // invalidate so reopening rebuilds even if same HTML
      return;
    }
    const def = tower.def;
    const level = tower.level;
    const stats = getLevelStats(def, level);
    const next = tower.canUpgrade() ? getLevelStats(def, level + 1) : null;
    const nextCost = tower.nextUpgradeCost();
    const spent = totalSpent(def, level);
    const refund = scaleCost(spent, SELL_REFUND);

    const statRow = (label: string, val: string | number, nextVal?: string | number) => {
      const delta = nextVal !== undefined && nextVal !== val
        ? `<span class="delta">→ ${nextVal}</span>` : '';
      return `<div class="stat-row"><span class="label">${label}</span><span class="value">${val}${delta}</span></div>`;
    };

    const isWall = def.id === 'wall' || def.id === 'palisade';
    const isMonastery = def.id === 'monastery';

    let html = `
      <h2>${def.icon} ${def.name}</h2>
    `;
    if (isWall) {
      html += `<div class="level-line">Obstacle — no attack</div>`;
    } else if (isMonastery) {
      // Faith aura: damage/rate are unused. Show the multiplier and radius
      // instead. The format mirrors statRow so the visual rhythm is consistent.
      const cur = stats.faithMultiplier ?? 1;
      const nxt = next?.faithMultiplier;
      const curPct = `+${Math.round((cur - 1) * 100)}%`;
      const nxtPct = nxt !== undefined ? `+${Math.round((nxt - 1) * 100)}%` : undefined;
      html += `
        <div class="level-line">Level ${level + 1} / ${def.levels.length}</div>
        ${statRow('Faith aura', curPct, nxtPct)}
        ${statRow('Radius', stats.range.toFixed(1), next?.range.toFixed(1))}
      `;
    } else {
      html += `
        <div class="level-line">Level ${level + 1} / ${def.levels.length}</div>
        ${statRow('Damage', stats.damage, next?.damage)}
        ${statRow('Range', stats.range.toFixed(1), next?.range.toFixed(1))}
        ${statRow('Fire rate', `${stats.fireRate.toFixed(2)}/s`, next ? `${next.fireRate.toFixed(2)}/s` : undefined)}
      `;
    }
    if (stats.splashRadius !== undefined) {
      html += statRow('Splash', stats.splashRadius.toFixed(2), next?.splashRadius?.toFixed(2));
    }
    if (stats.slowFactor !== undefined) {
      html += statRow('Slow', `${Math.round((1 - stats.slowFactor) * 100)}%`, next?.slowFactor !== undefined ? `${Math.round((1 - next.slowFactor) * 100)}%` : undefined);
      html += statRow('Slow time', `${stats.slowDuration?.toFixed(1)}s`, next?.slowDuration !== undefined ? `${next.slowDuration.toFixed(1)}s` : undefined);
    }
    if (stats.chainTargets !== undefined) {
      html += statRow('Chain jumps', stats.chainTargets, next?.chainTargets);
      html += statRow('Chain range', stats.chainRange?.toFixed(1) ?? '-', next?.chainRange?.toFixed(1));
    }

    if (isWall) {
      html += `<div class="actions">
        <button class="btn-sell" id="btn-sell" style="flex: 1">
          <span>Sell</span><span class="cost">${formatCost(refund)}</span>
        </button>
      </div>`;
    } else if (tower.isUpgrading()) {
      // Tower is mid-upgrade: show construction status + countdown. Sell still
      // available (panic move). Upgrade button hidden — can't queue another.
      html += `<div class="upgrade-progress">
        <div class="upgrade-label">Constructing… <span id="upgrade-countdown"></span></div>
        <div class="upgrade-bar"><div class="upgrade-bar-fill" id="upgrade-bar-fill"></div></div>
      </div>
      <div class="actions">
        <button class="btn-sell" id="btn-sell" style="flex: 1">
          <span>Sell</span><span class="cost">${formatCost(refund)}</span>
        </button>
      </div>`;
    } else if (next && nextCost) {
      const canPay = canAfford(s.resources, nextCost);
      html += `<div class="actions">
        <button class="btn-upgrade" id="btn-upgrade" ${canPay ? '' : 'disabled'}>
          <span>Upgrade</span><span class="cost">${formatCost(nextCost)}</span>
        </button>
        <button class="btn-sell" id="btn-sell">
          <span>Sell</span><span class="cost">${formatCost(refund)}</span>
        </button>
      </div>`;
    } else {
      html += `<div class="max-msg">Maximum level</div>
        <div class="actions">
          <button class="btn-sell" id="btn-sell" style="flex: 1">
            <span>Sell</span><span class="cost">${formatCost(refund)}</span>
          </button>
        </div>`;
    }

    // Only rewrite + reattach listeners if the HTML actually changed. Without
    // this guard, village income ticks (every frame) would rebuild this panel
    // ~60 times/sec, wiping the buttons mid-click and breaking interactivity.
    towerPanelEl.style.display = 'block';
    if (html !== lastTowerPanelHtml) {
      lastTowerPanelHtml = html;
      towerPanelEl.innerHTML = html;

      const upgradeBtn = document.getElementById('btn-upgrade') as HTMLButtonElement | null;
      const sellBtn = document.getElementById('btn-sell') as HTMLButtonElement | null;
      if (upgradeBtn) upgradeBtn.addEventListener('click', () => game.upgradeSelectedTower());
      if (sellBtn) sellBtn.addEventListener('click', () => game.sellSelectedTower());
    }

    // Update upgrade-in-progress live elements every frame (don't trigger an
    // innerHTML rebuild — those would wipe the sell button mid-click).
    if (tower.isUpgrading()) {
      const countdownEl = document.getElementById('upgrade-countdown');
      const barEl = document.getElementById('upgrade-bar-fill');
      if (countdownEl) countdownEl.textContent = `${tower.upgradeSecondsRemaining().toFixed(1)}s`;
      if (barEl) barEl.style.width = `${(tower.upgradeProgress() * 100).toFixed(0)}%`;
    }
  }

  /**
   * Slide-in wave banner. Plays a CSS animation. The animation runs in real
   * time (not game time) so it stays readable at speed 4×. Re-triggering: we
   * remove the .active class, force a reflow, then re-add it so the animation
   * restarts cleanly even on rapid wave changes.
   */
  function showWaveBanner(current: number, total: number): void {
    const banner = document.getElementById('wave-banner');
    const cur = document.getElementById('wb-current');
    const tot = document.getElementById('wb-total');
    if (!banner || !cur || !tot) return;
    cur.textContent = String(current);
    tot.textContent = String(total);
    banner.classList.remove('active');
    // Force reflow so the next add restarts the animation cleanly.
    void banner.offsetWidth;
    banner.classList.add('active');
  }

  const render = () => {
    const s = gameStore.getState();

    // Detect phase transition: anything → 'wave' triggers the wave-start banner.
    if (s.phase === 'wave' && lastPhase !== 'wave') {
      showWaveBanner(s.currentWave + 1, s.totalWaves);
    }
    // First-run tutorial: show on the menu → building transition, but only
    // if the player hasn't dismissed it before. isTutorialSeen guards against
    // re-showing on every map load. The panel is non-blocking so even if
    // a player skips reading it, gameplay isn't gated.
    if (s.phase === 'building' && lastPhase === 'menu' && !isTutorialSeen()) {
      const tutEl = document.getElementById('tutorial-overlay');
      if (tutEl) {
        tutEl.classList.add('active');
        tutEl.setAttribute('aria-hidden', 'false');
      }
    }
    // If the player abandons or completes a map, hide the tutorial too — it
    // shouldn't bleed into the menu screen.
    if (s.phase === 'menu') {
      const tutEl = document.getElementById('tutorial-overlay');
      if (tutEl) {
        tutEl.classList.remove('active');
        tutEl.setAttribute('aria-hidden', 'true');
      }
    }
    lastPhase = s.phase;

    const inGame = s.phase === 'building' || s.phase === 'wave';
    hudEl.style.display = inGame ? 'flex' : 'none';
    towerMenuEl.style.display = inGame ? 'flex' : 'none';
    wavesEl.style.display = inGame ? 'flex' : 'none';

    if (s.phase === 'menu') {
      renderMapSelect('initial');
      towerPanelEl.style.display = 'none';
      pausedBanner.classList.remove('active');
      return;
    }
    if (s.phase === 'won') {
      renderMapSelect('won');
      towerPanelEl.style.display = 'none';
      pausedBanner.classList.remove('active');
      return;
    }
    if (s.phase === 'lost') {
      renderMapSelect('lost');
      towerPanelEl.style.display = 'none';
      pausedBanner.classList.remove('active');
      return;
    }

    overlayEl.classList.remove('active');
    stopSlideshow();
    currentOverlayReason = null;

    // Update each resource value display.
    for (const k of RESOURCE_KEYS) {
      const el = resourcesEl.querySelector(`[data-r="${k}"]`) as HTMLElement | null;
      if (el) {
        el.textContent = String((s.resources as Resources)[k]);
        el.classList.toggle('low', (s.resources as Resources)[k] <= 5);
        el.classList.toggle('zero', (s.resources as Resources)[k] === 0);
      }
    }

    const displayedWave = s.currentWave === -1 ? 0 : s.currentWave + 1;
    waveEl.textContent = `${displayedWave} / ${s.totalWaves}`;
    mapNameEl.textContent = s.currentMapId ? MAPS[s.currentMapId].name : '—';

    // Villager display.
    const villagerEl = document.getElementById('villager-display');
    if (villagerEl) {
      if (s.villageStats) {
        villagerEl.textContent = `${s.villageStats.alive} / ${s.villageStats.total}`;
        const ratio = s.villageStats.total > 0 ? s.villageStats.alive / s.villageStats.total : 1;
        villagerEl.classList.toggle('villager-low', ratio > 0 && ratio <= 0.4);
        villagerEl.classList.toggle('villager-critical', ratio > 0 && ratio <= 0.2);
      } else {
        villagerEl.textContent = '— / —';
      }
    }

    // Tower button enabled state needs to check ALL resources.
    const buttons = towerMenuEl.querySelectorAll<HTMLButtonElement>('.tower-btn');
    buttons.forEach((b) => {
      const id = b.dataset.towerId!;
      const def = TOWERS[id];
      if (!def) return;
      const cost = def.levels[0].cost;
      b.disabled = !canAfford(s.resources, cost);
      b.classList.toggle('selected', s.selectedBuildId === id);
    });

    startWaveBtn.disabled = s.phase !== 'building';
    startWaveBtn.textContent = s.currentWave === -1 && s.phase === 'building'
      ? 'Start First Wave'
      : s.phase === 'building' ? `Start Wave ${s.currentWave + 2}` : 'Wave In Progress';

    speedBtn.textContent = `${s.speed}×`;
    speedBtn.classList.toggle('boosted', s.speed > 1);

    pauseBtn.textContent = s.paused ? '▶' : '⏸';
    pauseBtn.classList.toggle('paused-active', s.paused);
    pauseBtn.title = s.paused ? 'Resume (P)' : 'Pause (P)';
    pausedBanner.classList.toggle('active', s.paused);

    renderWavePreview();
    renderTowerPanel();
  };

  /** Show a summary of the upcoming wave during the building phase. */
  function renderWavePreview(): void {
    const previewEl = document.getElementById('wave-preview');
    if (!previewEl) return;
    const s = gameStore.getState();
    if (s.phase !== 'building') {
      previewEl.classList.remove('visible');
      lastWavePreviewHtml = '';
      return;
    }
    const spawns = game.getNextWaveSpawns();
    if (!spawns || spawns.length === 0) {
      previewEl.classList.remove('visible');
      lastWavePreviewHtml = '';
      return;
    }
    // Group spawn entries by enemy id and sum the counts. Multiple spawn
    // groups for the same enemy across paths are folded together.
    const totals = new Map<string, number>();
    for (const sp of spawns) {
      totals.set(sp.enemyId, (totals.get(sp.enemyId) ?? 0) + sp.count);
    }
    // Sort: armored first (the scary ones), then by count desc.
    const rows: string[] = [];
    const sorted = Array.from(totals.entries()).sort((a, b) => {
      const da = ENEMIES[a[0]];
      const db = ENEMIES[b[0]];
      const aArm = da?.layer === 'armored' ? 1 : 0;
      const bArm = db?.layer === 'armored' ? 1 : 0;
      if (aArm !== bArm) return bArm - aArm;
      return b[1] - a[1];
    });
    for (const [id, count] of sorted) {
      const def = ENEMIES[id];
      if (!def) continue;
      const colorHex = '#' + def.color.toString(16).padStart(6, '0');
      const armored = def.layer === 'armored';
      const iconCls = `wp-icon ${armored ? 'wp-armored' : ''}`;
      const tag = armored ? '<span class="wp-tag">armored</span>' : '';
      rows.push(`
        <div class="wp-row">
          <span class="${iconCls}" style="background:${colorHex}"></span>
          <span class="wp-name">${def.name}${tag}</span>
          <span class="wp-count">×${count}</span>
        </div>
      `);
    }
    const waveNum = s.currentWave + 2;
    const totalWaves = s.totalWaves;
    const titleText = waveNum > totalWaves ? 'Final Wave' : `Next: Wave ${waveNum} / ${totalWaves}`;
    const newHtml = `<div class="wp-title">${titleText}</div>${rows.join('')}`;
    if (newHtml !== lastWavePreviewHtml) {
      lastWavePreviewHtml = newHtml;
      previewEl.innerHTML = newHtml;
    }
    previewEl.classList.add('visible');
  }

  gameStore.subscribe(render);
  render();
}


/**
 * Hand-coded SVG for the home-screen hero panel. Painterly silhouette of
 * mountains and a hilltop village at sunset/dusk — sets a "the realm is
 * threatened" tone before any text is read. Uses no external assets; viewBox
 * scales to whatever the .hero-image container is sized to.
 */
function heroSvg(): string {
  return `
    <svg class="hero-svg" viewBox="0 0 480 320" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <!-- Sky gradient: deep navy at top fading down to warm amber at horizon -->
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0"   stop-color="#0e1024"/>
          <stop offset="0.45" stop-color="#3a2828"/>
          <stop offset="0.78" stop-color="#a06028"/>
          <stop offset="1"   stop-color="#e8a050"/>
        </linearGradient>
        <!-- Sun glow: warm radial behind the mountains -->
        <radialGradient id="sunGlow" cx="0.32" cy="0.78" r="0.25">
          <stop offset="0"   stop-color="#ffd070" stop-opacity="0.95"/>
          <stop offset="0.45" stop-color="#e08030" stop-opacity="0.55"/>
          <stop offset="1"   stop-color="#a04020" stop-opacity="0"/>
        </radialGradient>
        <!-- Vignette: darkens edges to focus eye on the village -->
        <radialGradient id="vignette" cx="0.5" cy="0.55" r="0.7">
          <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
          <stop offset="1"   stop-color="#000" stop-opacity="0.55"/>
        </radialGradient>
        <!-- Soft warm window light -->
        <radialGradient id="windowGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#ffd070" stop-opacity="1"/>
          <stop offset="1" stop-color="#ffd070" stop-opacity="0"/>
        </radialGradient>
      </defs>

      <!-- Sky -->
      <rect width="480" height="320" fill="url(#sky)"/>
      <!-- Setting sun glow behind the distant mountains -->
      <rect width="480" height="320" fill="url(#sunGlow)"/>
      <!-- Sun disc -->
      <circle cx="154" cy="248" r="22" fill="#ffd470" opacity="0.85"/>

      <!-- Distant mountain range (lightest, most transparent) -->
      <path d="M0,225 L40,205 L75,215 L110,180 L150,200 L195,170 L240,195 L290,165 L340,190 L385,175 L430,200 L480,185 L480,260 L0,260 Z"
            fill="#3a3a52" opacity="0.55"/>

      <!-- Closer mountain range -->
      <path d="M0,250 L35,235 L80,245 L120,215 L165,235 L215,210 L260,232 L310,215 L360,235 L410,222 L450,240 L480,230 L480,290 L0,290 Z"
            fill="#221c2c" opacity="0.85"/>

      <!-- Mid-ground hill with the village on top -->
      <path d="M0,300 Q120,250 240,255 Q360,260 480,295 L480,320 L0,320 Z"
            fill="#1a1810"/>

      <!-- Village structures on the hilltop, centered around x=240 -->
      <g>
        <!-- Outer wall left -->
        <rect x="180" y="240" width="22" height="20" fill="#0a0808"/>
        <rect x="180" y="236" width="3" height="4" fill="#0a0808"/>
        <rect x="186" y="236" width="3" height="4" fill="#0a0808"/>
        <rect x="192" y="236" width="3" height="4" fill="#0a0808"/>
        <rect x="198" y="236" width="3" height="4" fill="#0a0808"/>

        <!-- Outer wall right -->
        <rect x="280" y="240" width="22" height="20" fill="#0a0808"/>
        <rect x="281" y="236" width="3" height="4" fill="#0a0808"/>
        <rect x="287" y="236" width="3" height="4" fill="#0a0808"/>
        <rect x="293" y="236" width="3" height="4" fill="#0a0808"/>
        <rect x="299" y="236" width="3" height="4" fill="#0a0808"/>

        <!-- Central keep -->
        <rect x="216" y="220" width="48" height="40" fill="#0a0808"/>
        <!-- Keep crenellations -->
        <rect x="216" y="216" width="5" height="5" fill="#0a0808"/>
        <rect x="226" y="216" width="5" height="5" fill="#0a0808"/>
        <rect x="236" y="216" width="5" height="5" fill="#0a0808"/>
        <rect x="246" y="216" width="5" height="5" fill="#0a0808"/>
        <rect x="256" y="216" width="5" height="5" fill="#0a0808"/>
        <!-- Lit window in keep -->
        <ellipse cx="228" cy="240" rx="8" ry="9" fill="url(#windowGlow)"/>
        <rect x="226" y="236" width="4" height="8" fill="#ffc060"/>
        <ellipse cx="252" cy="240" rx="8" ry="9" fill="url(#windowGlow)"/>
        <rect x="250" y="236" width="4" height="8" fill="#ffc060"/>

        <!-- Pennant pole and flag -->
        <line x1="240" y1="216" x2="240" y2="196" stroke="#0a0808" stroke-width="1.5"/>
        <path d="M240,196 L256,200 L240,205 Z" fill="#a02020"/>

        <!-- Side towers (taller than walls, shorter than keep) -->
        <rect x="200" y="226" width="14" height="34" fill="#0a0808"/>
        <rect x="200" y="222" width="3" height="5" fill="#0a0808"/>
        <rect x="206" y="222" width="3" height="5" fill="#0a0808"/>
        <rect x="211" y="222" width="3" height="5" fill="#0a0808"/>
        <ellipse cx="207" cy="240" rx="3" ry="4" fill="#ffc060" opacity="0.9"/>

        <rect x="266" y="226" width="14" height="34" fill="#0a0808"/>
        <rect x="266" y="222" width="3" height="5" fill="#0a0808"/>
        <rect x="272" y="222" width="3" height="5" fill="#0a0808"/>
        <rect x="277" y="222" width="3" height="5" fill="#0a0808"/>
        <ellipse cx="273" cy="240" rx="3" ry="4" fill="#ffc060" opacity="0.9"/>
      </g>

      <!-- Foreground: dark hill silhouette in front of everything -->
      <path d="M0,320 L0,290 Q60,275 130,285 Q200,295 260,283 Q330,272 400,288 Q450,298 480,288 L480,320 Z"
            fill="#06060a"/>

      <!-- Foreground tree silhouettes for depth -->
      <g fill="#06060a">
        <polygon points="60,310 65,288 72,310"/>
        <polygon points="72,308 78,282 86,308"/>
        <polygon points="408,309 414,287 422,309"/>
        <polygon points="420,310 425,290 432,310"/>
      </g>

      <!-- Floating embers / battle sparks rising from behind the village -->
      <g fill="#ff8030" opacity="0.85">
        <circle cx="185" cy="200" r="1.2"/>
        <circle cx="225" cy="180" r="0.9"/>
        <circle cx="265" cy="195" r="1.4"/>
        <circle cx="295" cy="170" r="1.0"/>
        <circle cx="320" cy="190" r="0.8"/>
        <circle cx="170" cy="170" r="0.7"/>
      </g>

      <!-- Vignette overlay last so it darkens edges over everything -->
      <rect width="480" height="320" fill="url(#vignette)"/>
    </svg>
  `;
}

/**
 * Hand-coded SVG portraits of each enemy, matching their in-game silhouette.
 * Helps players recognise the unit they're reading about on the battlefield —
 * the slideshow's old colored-dot was decorative but uninformative.
 *
 * Conventions: each portrait fits in a 200×160 viewBox. The unit's "feet" are
 * roughly at y=120, body extends upward. Backdrop is a subtle radial tint.
 *
 * Note: this duplicates the Pixi drawing in Enemy.ts. Kept in sync by hand —
 * fine for six enemies, would warrant abstraction if the roster grew.
 */
function enemyPortraitSvg(enemyId: string, color: number): string {
  const colorHex = '#' + color.toString(16).padStart(6, '0');
  const inner = enemyPortraitInner(enemyId);
  return `
    <svg class="enemy-portrait-svg" viewBox="0 0 200 160" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <radialGradient id="bg-${enemyId}" cx="0.5" cy="0.55" r="0.65">
          <stop offset="0"   stop-color="${colorHex}" stop-opacity="0.35"/>
          <stop offset="0.6" stop-color="${colorHex}" stop-opacity="0.10"/>
          <stop offset="1"   stop-color="${colorHex}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="200" height="160" fill="url(#bg-${enemyId})"/>
      <!-- Ground shadow ellipse beneath the unit's feet for grounding -->
      <ellipse cx="100" cy="135" rx="44" ry="6" fill="#000" opacity="0.35"/>
      ${inner}
    </svg>
  `;
}

/** Just the unit silhouette, centered around (100, 80) with feet near y=130. */
function enemyPortraitInner(enemyId: string): string {
  // Each portrait is drawn at an enlarged "size" for legibility on the panel.
  // Coordinates here are absolute SVG units (200×160 viewBox).
  switch (enemyId) {
    case 'militia': return svgMilitia();
    case 'scoutCavalry': return svgScoutCavalry();
    case 'skirmisher': return svgSkirmisher();
    case 'paladin': return svgPaladin();
    case 'mangonel': return svgMangonel();
    case 'sapper': return svgSapper();
    default: return '';
  }
}

// All silhouettes anchor "feet" around y=130, body extending upward.

function svgMilitia(): string {
  // size analog: 32 (4× in-game size 8)
  const cx = 100, feetY = 130;
  const s = 32;
  const cy = feetY - s * 0.6;
  return `
    <!-- Body torso -->
    <ellipse cx="${cx}" cy="${cy + 4}" rx="${s * 0.95}" ry="${s * 1.05}" fill="#a05030" stroke="#000" stroke-width="2"/>
    <!-- Lower-half shadow -->
    <ellipse cx="${cx}" cy="${cy + s * 0.4}" rx="${s * 0.85}" ry="${s * 0.45}" fill="#602010" opacity="0.55"/>
    <!-- Head -->
    <circle cx="${cx}" cy="${cy - s * 0.85}" r="${s * 0.45}" fill="#d0a070" stroke="#000" stroke-width="1.6"/>
    <!-- Club shaft -->
    <line x1="${cx + s * 0.6}" y1="${cy + s * 0.3}" x2="${cx + s * 1.2}" y2="${cy - s * 0.4}" stroke="#4a2810" stroke-width="4.5" stroke-linecap="round"/>
    <!-- Club head -->
    <circle cx="${cx + s * 1.2}" cy="${cy - s * 0.4}" r="3.5" fill="#6a3818" stroke="#000" stroke-width="1"/>
  `;
}

function svgScoutCavalry(): string {
  const cx = 100, feetY = 130;
  const s = 28; // 4× in-game 7
  const cy = feetY - s * 0.6;
  return `
    <!-- Horse body (horizontal oval) -->
    <ellipse cx="${cx}" cy="${cy + 4}" rx="${s * 1.4}" ry="${s * 0.7}" fill="#c0a060" stroke="#000" stroke-width="2"/>
    <!-- Belly shadow -->
    <ellipse cx="${cx}" cy="${cy + s * 0.35}" rx="${s * 1.15}" ry="${s * 0.28}" fill="#806030" opacity="0.55"/>
    <!-- Horse head leaning forward (right) -->
    <ellipse cx="${cx + s * 0.8}" cy="${cy - s * 0.2}" rx="${s * 0.4}" ry="${s * 0.55}" fill="#c0a060" stroke="#000" stroke-width="1.6"/>
    <!-- Snout -->
    <circle cx="${cx + s * 1.05}" cy="${cy - s * 0.05}" r="2.6" fill="#806030"/>
    <!-- Rider blob (back-center) -->
    <circle cx="${cx - s * 0.15}" cy="${cy - s * 0.55}" r="${s * 0.45}" fill="#504028" stroke="#000" stroke-width="1.2"/>
    <!-- Helmet glint -->
    <circle cx="${cx - s * 0.2}" cy="${cy - s * 0.7}" r="2" fill="#9a8050"/>
    <!-- Two leg dashes -->
    <rect x="${cx - s * 0.7}" y="${cy + s * 0.55}" width="4" height="6" fill="#402818"/>
    <rect x="${cx + s * 0.5}" y="${cy + s * 0.55}" width="4" height="6" fill="#402818"/>
  `;
}

function svgSkirmisher(): string {
  const cx = 100, feetY = 130;
  const s = 26; // 4.3× in-game 6
  const cy = feetY - s * 0.7;
  return `
    <!-- Body -->
    <circle cx="${cx}" cy="${cy}" r="${s}" fill="#60a040" stroke="#000" stroke-width="2"/>
    <!-- Lower-half shadow -->
    <ellipse cx="${cx}" cy="${cy + s * 0.4}" rx="${s * 0.9}" ry="${s * 0.45}" fill="#305020" opacity="0.6"/>
    <!-- Pointed hood -->
    <polygon points="${cx - s * 0.5},${cy - s * 0.5} ${cx},${cy - s * 1.6} ${cx + s * 0.5},${cy - s * 0.5}" fill="#405028" stroke="#000" stroke-width="1.2"/>
    <!-- Bow (curved) -->
    <path d="M ${cx - s * 1.1},${cy - s * 0.4} Q ${cx - s * 1.6},${cy + s * 0.1} ${cx - s * 1.0},${cy + s * 0.6}" stroke="#6a4828" stroke-width="3" fill="none"/>
    <!-- Bowstring -->
    <line x1="${cx - s * 1.1}" y1="${cy - s * 0.4}" x2="${cx - s * 1.0}" y2="${cy + s * 0.6}" stroke="#d8c898" stroke-width="1.2"/>
  `;
}

function svgPaladin(): string {
  const cx = 100, feetY = 132;
  const s = 26; // 2.4× in-game 11 — the largest silhouette already, scale moderate
  const cy = feetY - s * 0.6;
  const bw = s * 1.4;
  const bh = s * 1.7;
  const bodyTop = cy - bh / 2 + s * 0.2;
  return `
    <!-- Body (rounded rect) -->
    <rect x="${cx - bw / 2}" y="${bodyTop}" width="${bw}" height="${bh}" rx="6" ry="6" fill="#b0b0c0" stroke="#000" stroke-width="2"/>
    <!-- Lit top half -->
    <rect x="${cx - bw / 2 + 2}" y="${bodyTop + 2}" width="${bw - 4}" height="${bh * 0.45}" rx="4" ry="4" fill="#e0e0f0" opacity="0.45"/>
    <!-- Shadow bottom half -->
    <rect x="${cx - bw / 2 + 2}" y="${cy + s * 0.1}" width="${bw - 4}" height="${bh * 0.4}" rx="4" ry="4" fill="#404858" opacity="0.45"/>
    <!-- Helm -->
    <ellipse cx="${cx}" cy="${bodyTop + s * 0.1}" rx="${s * 0.55}" ry="${s * 0.5}" fill="#8a8aa0" stroke="#000" stroke-width="1.6"/>
    <!-- Visor slit -->
    <rect x="${cx - s * 0.3}" y="${bodyTop - s * 0.1}" width="${s * 0.6}" height="3" fill="#101018"/>
    <!-- Plume crest -->
    <path d="M ${cx - s * 0.15},${bodyTop - s * 0.1} Q ${cx + s * 0.4},${bodyTop - s * 1.1} ${cx + s * 0.5},${bodyTop - s * 0.6} Q ${cx + s * 0.2},${bodyTop - s * 0.4} ${cx},${bodyTop - s * 0.05} Z" fill="#c02020" stroke="#500808" stroke-width="1"/>
    <!-- Shield -->
    <polygon points="${cx - bw / 2 - 2},${cy - s * 0.2} ${cx - bw / 2 + s * 0.4},${cy - s * 0.4} ${cx - bw / 2 + s * 0.4},${cy + s * 0.5} ${cx - bw / 2 - 2},${cy + s * 0.2}" fill="#8a3030" stroke="#000" stroke-width="1.2"/>
    <!-- Cross on shield (vertical) -->
    <rect x="${cx - bw / 2 + 0}" y="${cy - s * 0.05}" width="2.5" height="${s * 0.4}" fill="#d8c898"/>
    <!-- Cross on shield (horizontal) -->
    <rect x="${cx - bw / 2 - s * 0.15}" y="${cy + s * 0.1}" width="${s * 0.5}" height="2.5" fill="#d8c898"/>
  `;
}

function svgMangonel(): string {
  const cx = 100, feetY = 130;
  const s = 32; // 3.2× in-game 10
  const cy = feetY - s * 0.6;
  const w = s * 1.6;
  const h = s * 1.3;
  return `
    <!-- Box body -->
    <rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" fill="#8030c0" stroke="#301050" stroke-width="3"/>
    <!-- Diagonal beam -->
    <line x1="${cx - w / 2 + 4}" y1="${cy - h / 2 - 4}" x2="${cx + w / 2 - 8}" y2="${cy - h / 2 - 20}" stroke="#402048" stroke-width="4" stroke-linecap="round"/>
    <!-- Sling stone at the tip of the beam -->
    <circle cx="${cx + w / 2 - 8}" cy="${cy - h / 2 - 20}" r="3" fill="#404048"/>
    <!-- Wheels -->
    <circle cx="${cx - w / 2 + 8}" cy="${cy + h / 2 - 2}" r="8" fill="#201018" stroke="#000" stroke-width="2"/>
    <circle cx="${cx + w / 2 - 8}" cy="${cy + h / 2 - 2}" r="8" fill="#201018" stroke="#000" stroke-width="2"/>
    <!-- Wheel spokes -->
    <line x1="${cx - w / 2 + 8 - 6}" y1="${cy + h / 2 - 2}" x2="${cx - w / 2 + 8 + 6}" y2="${cy + h / 2 - 2}" stroke="#605078" stroke-width="1.5"/>
    <line x1="${cx - w / 2 + 8}" y1="${cy + h / 2 - 8}" x2="${cx - w / 2 + 8}" y2="${cy + h / 2 + 4}" stroke="#605078" stroke-width="1.5"/>
    <line x1="${cx + w / 2 - 8 - 6}" y1="${cy + h / 2 - 2}" x2="${cx + w / 2 - 8 + 6}" y2="${cy + h / 2 - 2}" stroke="#605078" stroke-width="1.5"/>
    <line x1="${cx + w / 2 - 8}" y1="${cy + h / 2 - 8}" x2="${cx + w / 2 - 8}" y2="${cy + h / 2 + 4}" stroke="#605078" stroke-width="1.5"/>
  `;
}

function svgSapper(): string {
  const cx = 100, feetY = 130;
  const s = 30; // 3.75× in-game 8
  const cy = feetY - s * 0.6;
  return `
    <!-- Body -->
    <circle cx="${cx}" cy="${cy}" r="${s}" fill="#705038" stroke="#000" stroke-width="2"/>
    <!-- Lower shadow -->
    <ellipse cx="${cx}" cy="${cy + s * 0.4}" rx="${s * 0.9}" ry="${s * 0.45}" fill="#402818" opacity="0.55"/>
    <!-- A small face hint: two darker dots for eyes -->
    <circle cx="${cx - 5}" cy="${cy - 6}" r="1.8" fill="#1a1008"/>
    <circle cx="${cx + 5}" cy="${cy - 6}" r="1.8" fill="#1a1008"/>
    <!-- Pickaxe handle -->
    <line x1="${cx + s - 3}" y1="${cy - s + 6}" x2="${cx + s + 18}" y2="${cy + s - 12}" stroke="#402810" stroke-width="5" stroke-linecap="round"/>
    <!-- Pickaxe head: angular triangle/spike at the top of the handle -->
    <polygon points="${cx + s - 8},${cy - s + 4} ${cx + s + 10},${cy - s - 8} ${cx + s + 4},${cy - s + 16}" fill="#808890" stroke="#000" stroke-width="1.5"/>
    <!-- Highlight on pickaxe -->
    <line x1="${cx + s - 5}" y1="${cy - s + 2}" x2="${cx + s + 6}" y2="${cy - s - 4}" stroke="#c0c8d0" stroke-width="1.2"/>
  `;
}
