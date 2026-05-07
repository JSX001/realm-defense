import { Application } from 'pixi.js';
import { Game } from './game/Game';
import { setupHUD } from './ui/HUD';
import { gameStore } from './state/store';
import { unlockAudio } from './utils/sound';

async function main() {
  const app = new Application();
  await app.init({
    canvas: document.getElementById('game-canvas') as HTMLCanvasElement,
    resizeTo: window,
    background: '#2a3818',
    antialias: true,
    // Use the display's pixel ratio. On retina/HiDPI screens this means we
    // render at native resolution rather than upscaling a low-res buffer.
    // `autoDensity: true` then sets the canvas CSS size to match the logical
    // (CSS) viewport, so layout still works as before — only the GPU-side
    // pixel density changes. Capped at 2 because beyond that the GPU cost
    // grows fast for diminishing visual return on game-style art.
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true
  });

  const game = new Game(app);
  setupHUD(game);

  // Browser autoplay policy: AudioContext can only start after a user gesture.
  // Listen for any pointer/key event and call unlockAudio, then remove ourselves.
  const tryUnlock = () => {
    unlockAudio();
    window.removeEventListener('pointerdown', tryUnlock);
    window.removeEventListener('keydown', tryUnlock);
  };
  window.addEventListener('pointerdown', tryUnlock);
  window.addEventListener('keydown', tryUnlock);

  // Start at the map-select screen.
  gameStore.getState().setPhase('menu');
}

main().catch((err) => console.error('Failed to start game:', err));
