import R from '@dimforge/rapier2d-compat';
import { createConfig } from './config.js';
import { Game } from './core/game.js';
import { FixedStepper } from './core/stepper.js';
import { Renderer } from './render/renderer.js';
import { MouseInput } from './input/mouse.js';
import { TouchInput } from './input/touch.js';
import { Hud } from './ui/hud.js';
import { Sound } from './audio/sound.js';
import { loadFace, saveFace, clearFace } from './maker/store.js';
import { checkLayout, fitStoneRadius } from './core/scoring.js';
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
  const sound = new Sound();

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
    toggleMute() {
      sound.setMuted(!sound.muted);
    },
    toggleTuning() {
      debug.toggle();
    },
    async openMaker() {
      // 얼굴 만들기(MediaPipe 포함)는 처음 열 때만 불러온다
      const { FaceMaker } = await import('./maker/maker.js');
      maker ??= new FaceMaker(document.getElementById('maker'), {
        hasFace: () => !!game.face,
        onDone(face) {
          game.setFace(face);
          actions.restart();
          saveFace(face);
        },
        onReset() {
          game.setFace(null);
          actions.restart();
          clearFace();
        },
        layoutWarnings(face) {
          // 정답 위치끼리 퍽이 겹치면 동시에 놓을 수 없다 (명세 5.3)
          // 퍽 크기를 자동으로 줄인 뒤에도 겹치는 경우만 알린다
          const parts = game.parts.map((p) => ({ ...p, q: face.parts[p.id]?.anchor ?? p.q }));
          const fitted = Object.create(cfg);
          fitted.stoneRadius = fitStoneRadius(parts, game.board, cfg);
          const { conflicts } = checkLayout(parts, game.board, fitted);
          const name = (id) => game.parts.find((p) => p.id === id).label;
          const missing = game.parts.filter((p) => !face.parts[p.id]).map((p) => p.label);
          return [
            ...(missing.length ? [`찾지 못한 부위: ${missing.join('·')} (기본 위치 사용)`] : []),
            ...conflicts.map((c) => `${name(c.a)}·${name(c.b)} 정답이 너무 붙어 있어요.`),
          ];
        },
      });
      maker.open();
    },
  };
  let maker = null;
  const hud = new Hud(game, actions);
  // 지난번에 만든 얼굴이 있으면 그 얼굴로 시작
  loadFace().then((face) => {
    if (face) {
      game.setFace(face);
      actions.restart();
    }
  });
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

    // 게임 이벤트 → 이펙트·소리·HUD·진동 (표현 전용, 게임 로직은 읽지 않음)
    const events = game.drainEvents();
    renderer.handleEvents(events, game);
    sound.handle(events);
    hud.handle(events);
    if (input.touchMode) haptics(events);
    sound.update(game);

    renderer.fallback = input.fallback;
    hud.update(input, renderer, sound.muted);
    renderer.setInsets(hud.insets());
    renderer.render(game, stepper.alpha, Math.min(dt, 0.1));
    debug.update(game);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.getElementById('loading').remove();
  // 브라우저 콘솔·자동 테스트용. paused=true면 루프가 틱을 진행하지 않는다 (렌더는 계속)
  window.__game = game;
  window.__debug = Object.assign(debugHooks, { renderer, input, saveFace, loadFace });
}

/** Android만 지원 (iOS Safari는 navigator.vibrate 없음) */
function haptics(events) {
  if (!navigator.vibrate) return;
  for (const e of events) {
    if (e.type === 'stroke' && e.valid) navigator.vibrate(8);
    else if (e.type === 'collision') navigator.vibrate(20);
    else if (e.type === 'burn') navigator.vibrate([60, 40, 120]);
  }
}

main().catch((err) => {
  document.getElementById('loading').textContent = `초기화 실패: ${err.message}`;
  throw err;
});
