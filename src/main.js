import R from '@dimforge/rapier2d-compat';
import { createConfig } from './config.js';
import { Game } from './core/game.js';
import { FixedStepper } from './core/stepper.js';
import { Renderer } from './render/renderer.js';
import { MouseInput } from './input/mouse.js';
import { TouchInput } from './input/touch.js';
import { Hud } from './ui/hud.js';
import { createDebugPanel, loadSavedConfig } from './ui/debug.js';

const debugHooks = { paused: false };

async function main() {
  await R.init();
  const cfg = createConfig(loadSavedConfig());
  const game = new Game(R, cfg);
  const renderer = new Renderer(document.getElementById('app'));
  renderer.build(game);
  const input = new MouseInput(renderer.canvas, game, renderer);
  const touch = new TouchInput(renderer.canvas, game, {
    joyBase: document.getElementById('touch-joy'),
    joyKnob: document.getElementById('touch-knob'),
    swipeZone: document.getElementById('touch-swipe'),
  });
  renderer.minimapEl = document.getElementById('minimap-frame');

  const actions = {
    restart() {
      game.restart();
      renderer.build(game);
      hud.buildParts();
      debug.updateLayout(game);
    },
    setMode(mode) {
      game.mode = mode;
      actions.restart();
    },
  };
  const hud = new Hud(game, actions);
  const debug = createDebugPanel(cfg, renderer, input, actions);
  debug.updateLayout(game);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyT') renderer.options.laneTop = !renderer.options.laneTop;
  });

  let stepper = new FixedStepper(cfg.tickRate);
  let last = performance.now();
  function frame(now) {
    const dt = (now - last) / 1000;
    last = now;
    if (stepper.dt !== 1 / cfg.tickRate) stepper = new FixedStepper(cfg.tickRate);
    const ticks = stepper.advance(dt);
    if (!debugHooks.paused) for (let i = 0; i < ticks; i++) game.tick();
    input.update();
    touch.update();
    renderer.fallback = input.fallback;
    renderer.render(game, stepper.alpha, Math.min(dt, 0.1));
    hud.update(input, renderer);
    debug.update(game);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.getElementById('loading').remove();
  // 브라우저 콘솔·자동 테스트용. paused=true면 루프가 틱을 진행하지 않는다 (렌더는 계속)
  window.__game = game;
  window.__debug = debugHooks;
}

main().catch((err) => {
  document.getElementById('loading').textContent = `초기화 실패: ${err.message}`;
  throw err;
});
