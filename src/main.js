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
import { buildShapes, defaultOutline } from './core/shape.js';
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

  // 앱 화면: 홈 → 게임. 게임 중 일시정지
  const app = { screen: 'home', paused: false, get muted() { return sound.muted; } };

  const actions = {
    /** 장면을 현재 게임 상태로 다시 구성 */
    restart() {
      game.restart();
      renderer.build(game);
      hud.buildParts();
      debug.updateLayout(game);
    },
    start(mode) {
      game.mode = mode;
      actions.restart();
      app.screen = 'game';
      app.paused = false;
    },
    restartGame() {
      actions.restart();
      app.paused = false;
    },
    goHome() {
      actions.restart();
      app.screen = 'home';
      app.paused = false;
    },
    pause() {
      if (app.screen !== 'game') return;
      app.paused = true;
      if (document.pointerLockElement) document.exitPointerLock();
    },
    resume() {
      app.paused = false;
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
          // 정답 자리끼리 스톤 모양이 겹치면 동시에 놓을 수 없어 전체를 줄인다 (명세 5.3). 많이 줄어든 경우만 알린다
          const src = game.parts.map((p) => {
            const f = face.parts[p.id];
            return f?.outline ? { id: p.id, q: f.anchor, outline: f.outline, rect: f.rect } : { id: p.id, q: p.q, outline: defaultOutline(p) };
          });
          const { scale } = buildShapes(src, game.board, cfg);
          const missing = game.parts.filter((p) => !face.parts[p.id]).map((p) => p.label);
          return [
            ...(missing.length ? [`찾지 못한 부위: ${missing.join('·')} (기본 위치 사용)`] : []),
            ...(scale < 0.8 ? [`부위끼리 너무 붙어 있어 일부 스톤을 ${Math.round(scale * 100)}% 크기까지 줄였어요.`] : []),
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
  // 튜닝 패널 버튼은 개발용 — 주소에 ?debug가 있을 때만 보인다
  document.body.classList.toggle('debug', new URLSearchParams(location.search).has('debug'));
  debug.updateLayout(game);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyT') renderer.options.laneTop = !renderer.options.laneTop;
    // Esc는 마우스 잠금 중이면 브라우저가 잠금 해제에 쓴다. 잠금이 없을 때만 일시정지
    if ((e.code === 'Escape' && !document.pointerLockElement) || e.code === 'KeyP') {
      if (app.paused) actions.resume();
      else actions.pause();
    }
  });

  let stepper = new FixedStepper(cfg.tickRate);
  let last = performance.now();
  function frame(now) {
    const dt = (now - last) / 1000;
    last = now;
    if (stepper.dt !== 1 / cfg.tickRate) stepper = new FixedStepper(cfg.tickRate);
    const ticks = stepper.advance(dt);
    const running = app.screen === 'game' && !app.paused && !debugHooks.paused;
    if (running) for (let i = 0; i < ticks; i++) game.tick();
    // 일시정지·홈에서는 마우스 잠금 안내·스위핑 입력을 받지 않는다 (디버그 정지는 입력을 막지 않음 — 자동 테스트용)
    input.suspended = touch.suspended = app.screen !== 'game' || app.paused;
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
    hud.update(input, renderer, app);
    renderer.setInsets(hud.insets());
    renderer.render(game, stepper.alpha, Math.min(dt, 0.1));
    debug.update(game);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.getElementById('loading').remove();
  // 브라우저 콘솔·자동 테스트용. paused=true면 루프가 틱을 진행하지 않는다 (렌더는 계속)
  window.__game = game;
  window.__debug = Object.assign(debugHooks, { renderer, input, saveFace, loadFace, app, actions });
}

/** Android만 지원 (iOS Safari는 navigator.vibrate 없음) */
function haptics(events) {
  if (!navigator.vibrate) return;
  for (const e of events) {
    if (e.type === 'stroke' && e.valid) navigator.vibrate(8);
    else if (e.type === 'collision') navigator.vibrate(Math.round(15 + 45 * Math.min(1, (e.mass ?? 0.1) / 0.2)));
    else if (e.type === 'burn') navigator.vibrate([60, 40, 120]);
  }
}

main().catch((err) => {
  document.getElementById('loading').textContent = `초기화 실패: ${err.message}`;
  throw err;
});
