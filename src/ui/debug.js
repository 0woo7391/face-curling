// 튜닝 디버그 패널 (명세 12장 POC A-4: 쿠션 수치를 실시간으로 바꿔 보는 패널).
// 설정은 localStorage에 저장한다 (명세 7.2: 경량 설정). 저장 실패는 무시한다.
import GUI from 'lil-gui';
import { DEFAULTS, STRUCTURAL_KEYS } from '../config.js';

const STORAGE_KEY = 'face-curling-poc-a-config';

export function loadSavedConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return Object.fromEntries(Object.entries(saved).filter(([k]) => k in DEFAULTS));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  const diff = Object.fromEntries(Object.entries(cfg).filter(([k, v]) => DEFAULTS[k] !== v));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(diff));
  } catch {
    /* 비공개 창 등 */
  }
  return diff;
}

const FOLDERS = [
  ['물리', [
    ['friction', 0.05, 1, 0.01], ['sweepFrictionReduction', 0, 0.6, 0.01], ['curlK', 0, 0.2, 0.002],
    ['curlSpeedRef', 0.2, 4, 0.05], ['sweepCurlReduction', 0, 1, 0.01], ['restitution', 0.3, 1, 0.01],
    ['stopSpeed', 0.005, 0.1, 0.005],
  ]],
  ['투구', [['minLaunchSpeed', 0.5, 4, 0.05], ['maxLaunchSpeed', 2, 7, 0.05], ['maxAimDeg', 2, 30, 0.5]]],
  ['캐릭터·스위핑', [
    ['charSpeed', 2, 12, 0.1], ['charAccel', 5, 80, 1], ['charStartAhead', 0, 5, 0.1],
    ['mouseSensitivity', 0.003, 0.06, 0.001], ['forwardSensitivityScale', 0.5, 4, 0.1],
    ['bodyJudgeRadius', 0.05, 0.5, 0.01], ['broomReach', 0.3, 1.5, 0.01],
    ['strokeAmp', 0, 0.3, 0.01], ['strokeDurationMs', 40, 300, 5], ['strokeWindowMs', 200, 2000, 50],
    ['strokesForFullInput', 2, 16, 1], ['sweepZoneLength', 0.2, 2, 0.05], ['sweepZoneHalfWidth', 0.05, 0.6, 0.01],
    ['sweepSmoothingMs', 0, 600, 10],
  ]],
  ['번드 쿠션 (v1.2)', [
    ['broomJudgeScale', 0.2, 1, 0.01], ['cushionWidth', 0, 0.4, 0.01], ['cushionEfficiency', 0, 1, 0.01],
    ['assistSpeed', 0, 3, 0.05], ['assistMax', 0, 0.4, 0.01], ['graceTicks', 1, 20, 1],
    ['shortContactPenaltyMs', 0, 1000, 10],
  ]],
  ['레이아웃 (변경 시 재시작)', [
    ['stoneRadius', 0.05, 0.3, 0.005], ['boardSize', 2, 5, 0.1], ['boardCenterY', 10, 28, 0.5], ['laneWidth', 3, 8, 0.1],
  ]],
  ['채점', [['allowedError', 0.05, 0.6, 0.01]]],
];

export function createDebugPanel(cfg, renderer, input, actions) {
  const narrow = window.matchMedia('(orientation: portrait)').matches;
  const gui = new GUI({ title: '디버그 · 튜닝', width: narrow ? 230 : 260 });
  gui.hide(); // 상단 ⚙ 버튼으로 연다
  const stats = {
    상태: '', 틱: 0, 충돌수: 0, 번드_몸: 0, 번드_빗자루: 0, 투구수: 0,
    직전_정지y: '', 직전_평균스위핑: '', 스위핑_s: '', 입력효율: '', 위치효율: '',
    정답간섭: '', 직선경로_막힘: '',
  };

  const sf = gui.addFolder('통계');
  sf.close();
  for (const k of Object.keys(stats)) sf.add(stats, k).listen().disable();

  const vf = gui.addFolder('보기');
  vf.add(renderer.options, 'showSensors').name('판정 원·유효 영역 (디버그)');
  vf.add(renderer.options, 'showGhosts').name('정답 위치 (디버그)');
  vf.add(renderer.options, 'showMinimap').name('보드 미니맵');
  vf.add(renderer.options, 'laneTop').name('레인 탑다운 (T)').listen();
  vf.add(input, 'forceAbsolute').name('대체 모드 강제 (절대 좌표)');

  for (const [title, items] of FOLDERS) {
    const f = gui.addFolder(title);
    f.close();
    for (const [key, min, max, step] of items) {
      const c = f.add(cfg, key, min, max, step);
      c.onFinishChange(() => {
        saveConfig(cfg);
        if (STRUCTURAL_KEYS.has(key)) actions.restart();
      });
    }
  }

  const tools = {
    재시작: () => actions.restart(),
    기본값_복원: () => {
      Object.assign(cfg, DEFAULTS);
      saveConfig(cfg);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      actions.restart();
    },
    변경값_복사: () => {
      const json = JSON.stringify(saveConfig(cfg), null, 2);
      navigator.clipboard?.writeText(json).catch(() => {});
      console.log(json);
    },
  };
  for (const k of Object.keys(tools)) gui.add(tools, k);

  return {
    toggle() {
      if (gui._hidden) gui.show();
      else gui.hide();
    },
    update(game) {
      const last = game.stats.lastThrow;
      Object.assign(stats, {
        상태: game.state,
        틱: game.tickCount,
        충돌수: game.sim.collisions,
        번드_몸: game.stats.burnsBody,
        번드_빗자루: game.stats.burnsBroom,
        투구수: game.stats.throws,
        직전_정지y: last?.stopY != null ? last.stopY.toFixed(2) : '–',
        직전_평균스위핑: last ? last.avgSweep.toFixed(2) : '–',
        스위핑_s: game.sweep.intensity.toFixed(2),
        입력효율: game.sweep.inputEfficiency.toFixed(2),
        위치효율: game.frame.posEff.toFixed(2),
      });
    },
    updateLayout(game) {
      const rep = game.layoutReport();
      stats.정답간섭 = rep.conflicts.length ? rep.conflicts.map((c) => `${c.a}/${c.b}`).join(', ') : '없음';
      stats.직선경로_막힘 = rep.blocked.length ? rep.blocked.map((b) => `${b.target}←${b.by.join('+')}`).join(', ') : '없음';
    },
  };
}
