// DOM HUD. 화면 구조:
//   홈(#home)  → 시작/연습 → 게임(상단: ⏸ + 부위 진행 칸, 하단: 단계·힌트·버튼) → 결과(하단 시트)
//   게임 중 ⏸ → 일시정지(#pause): 계속 / 처음부터 / 홈 / 소리 / 조작법 / 튜닝
// 글자는 최소로. 되돌릴 수 없는 행동(처음부터·홈)은 진행 중일 때 두 번 눌러 확인한다.
// 상태가 바뀔 때만 DOM을 다시 쓰도록 값을 캐시한다.
import { partError, partScore } from '../core/scoring.js';

const $ = (id) => document.getElementById(id);
const SPIN_LEVELS = [0.5, 1]; // 칩을 누를 때마다 0.5 → 1 → 끔
const LEARN_STROKES = 3; // 유효 스트로크를 이만큼 하면 스위핑 힌트를 숨긴다
const CONFIRM_MS = 2500;

export class Hud {
  constructor(game, actions) {
    this.game = game;
    this.actions = actions;
    this.cache = {};
    this.partButtons = new Map();
    this.slots = new Map();
    this.learned = 0;
    this.confirming = null;

    const on = (id, fn) => $(id).addEventListener('click', fn);
    // 게임
    on('pause-btn', () => actions.pause());
    on('back', () => game.back());
    // 회전 칩: 같은 쪽을 누를 때마다 세기 0.5 → 1 → 끔, 반대쪽을 누르면 그쪽 0.5부터
    const cycleSpin = (sign) => {
      const cur = game.spin * sign;
      const i = SPIN_LEVELS.findIndex((v) => Math.abs(v - cur) < 1e-6);
      game.setSpin(cur <= 0 ? sign * SPIN_LEVELS[0] : i >= 0 && i < SPIN_LEVELS.length - 1 ? sign * SPIN_LEVELS[i + 1] : 0);
    };
    on('spin-l', () => cycleSpin(-1));
    on('spin-r', () => cycleSpin(1));
    on('undo', () => game.undoLastThrow());
    // 홈
    on('home-start', () => actions.start('record'));
    on('home-practice', () => actions.start('practice'));
    on('home-face', () => actions.openMaker());
    on('home-help', () => this.toggleHelp());
    on('home-sound', () => actions.toggleMute());
    on('home-tune', () => actions.toggleTuning());
    // 일시정지
    on('p-resume', () => actions.resume());
    on('p-restart', () => this.confirm('p-restart', '정말 처음부터? 한 번 더', () => actions.restartGame()));
    on('p-home', () => this.confirm('p-home', '진행 중인 게임을 그만둘까요? 한 번 더', () => actions.goHome()));
    on('p-sound', () => actions.toggleMute());
    on('p-assist', () => actions.toggleAssist());
    on('p-help', () => this.toggleHelp());
    on('p-tune', () => actions.toggleTuning());
    $('help').addEventListener('click', () => $('help').classList.remove('open'));
    this.buildParts();
  }

  toggleHelp() {
    $('help').classList.toggle('open');
  }

  /** 진행 중인 게임이 있으면 두 번 눌러야 실행 */
  confirm(id, label, fn) {
    const inProgress = this.game.throwIndex > 0 && this.game.state !== 'RESULT';
    if (!inProgress || this.confirming === id) {
      this.resetConfirm();
      fn();
      return;
    }
    this.resetConfirm();
    this.confirming = id;
    const b = $(id);
    b.dataset.label = b.textContent;
    b.textContent = label;
    b.classList.add('danger');
    this.confirmTimer = setTimeout(() => this.resetConfirm(), CONFIRM_MS);
  }

  resetConfirm() {
    clearTimeout(this.confirmTimer);
    if (!this.confirming) return;
    const b = $(this.confirming);
    b.textContent = b.dataset.label;
    b.classList.remove('danger');
    this.confirming = null;
  }

  /** 부위 버튼과 상단 진행 칸. 사진 얼굴이면 부위 스티커 그림을 쓴다 */
  buildParts() {
    const box = $('parts');
    const bar = $('progress');
    box.innerHTML = '';
    bar.innerHTML = '';
    this.partButtons.clear();
    this.slots.clear();
    this.cache = {};
    const fp = this.game.face?.parts ?? {};
    for (const p of this.game.parts) {
      const thumb = fp[p.id] ? `<img src="${fp[p.id].canvas.toDataURL()}" alt="" />` : `<i style="background:${p.color}"></i>`;
      const b = document.createElement('button');
      b.className = 'part';
      b.innerHTML = `${thumb}<span class="name">${p.label}</span><span class="sc"></span>`;
      b.addEventListener('click', () => this.game.selectPart(p.id));
      box.appendChild(b);
      this.partButtons.set(p.id, b);

      const s = document.createElement('span');
      s.className = 'slot';
      s.style.setProperty('--c', p.color);
      s.title = p.label;
      s.innerHTML = `${fp[p.id] ? `<img src="${fp[p.id].canvas.toDataURL()}" alt="" />` : ''}<b></b>`;
      bar.appendChild(s);
      this.slots.set(p.id, s);
    }
  }

  set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  /** 짧게 재생되는 CSS 애니메이션 (클래스를 뗐다 붙여 다시 시작) */
  pulse(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  handle(events) {
    for (const e of events) {
      if (e.type === 'reject') this.pulse($('next-key'), 'shake');
      if (e.type === 'stroke' && e.valid) {
        this.learned++;
        this.pulse($('next-key'), 'hit');
      }
      if (e.type === 'burn') {
        this.pulse($('stamp'), 'show');
        this.pulse($('vignette'), 'show');
      }
    }
  }

  /** @param app {screen:'home'|'game', paused, muted} */
  update(input, renderer, app) {
    const g = this.game;
    const st = g.state;
    const touch = input.touchMode;
    const hud = $('hud');
    hud.dataset.screen = app.screen;
    hud.dataset.state = st;
    hud.dataset.input = touch ? 'touch' : 'mouse';
    $('pause').hidden = !app.paused;
    hud.dataset.paused = app.paused ? '1' : '';
    if (!app.paused) this.resetConfirm();

    const sound = app.muted ? '🔇' : '🔊';
    this.set('hs', $('home-sound'), sound);
    this.set('ps', $('p-sound'), `${sound} 소리`);
    this.set('pa', $('p-assist'), g.cfg.sweepAssist ? '🧹 스위핑: 자동 따라가기 (쉬움)' : '🧹 스위핑: 직접 이동 (어려움)');
    if (app.screen === 'home') this.updateHome();
    $('mode-badge').hidden = g.mode !== 'practice';

    // 부위 버튼 + 진행 칸: 던진 부위는 점수, 번드·이탈은 빨간 ✕
    for (const p of g.parts) {
      const s = g.sim.stones.get(p.id);
      const score = s && p.status === 'stopped' ? partScore(partError(s, p.q, g.board, g.faceDiagonal), g.cfg.allowedError) : null;
      const lost = p.status === 'burned' || p.status === 'out';
      const sc = lost ? '0' : score == null ? '' : score.toFixed(0);
      const b = this.partButtons.get(p.id);
      this.set(`pc-${p.id}`, b.querySelector('.sc'), sc);
      this.set(`pd-${p.id}`, b, !(st === 'PART_SELECT' && p.status === 'pending'), 'disabled');
      b.dataset.status = p.status;
      const slot = this.slots.get(p.id);
      slot.dataset.status = p.status;
      slot.classList.toggle('current', p.id === g.currentPartId);
      this.set(`sl-${p.id}`, slot.querySelector('b'), lost ? '✕' : sc);
      if (score != null && !lost) slot.style.setProperty('--score', `hsl(${Math.round((score / 100) * 120)} 75% 45%)`);
    }

    // 투구: ◀(부위 다시) + 회전 칩. 당기는 중에는 숨겨 화면을 비운다
    const throwing = st === 'THROW';
    const pulling = throwing && g.power > 0;
    $('back').hidden = !throwing || pulling;
    $('spin').hidden = !throwing || pulling;
    const lvl = (sign) => (g.spin * sign > 0 ? (Math.abs(g.spin) > 0.75 ? '●●' : '●') : '');
    this.set('spinL', $('spin-l').querySelector('i'), lvl(-1));
    this.set('spinR', $('spin-r').querySelector('i'), lvl(1));
    $('spin-l').classList.toggle('on', g.spin < 0);
    $('spin-r').classList.toggle('on', g.spin > 0);

    this.set('hint', $('hint'), this.hint(touch));
    const assist = !!g.cfg.sweepAssist;
    hud.dataset.assist = assist ? '1' : '';
    this.set('nkL', $('next-key').querySelector('.l'), assist ? '▲ 밀기' : '좌클릭 밀기');
    this.set('nkR', $('next-key').querySelector('.r'), assist ? '▼ 당기기' : '우클릭 당기기');
    $('undo').hidden = !(g.mode === 'practice' && g.checkpoint && st === 'PART_SELECT');

    // 다음 입력: 마우스는 버튼 그림, 터치는 스와이프 판의 화살표가 밝아진다
    $('next-key').hidden = st !== 'SWEEP' || touch;
    $('next-key').dataset.expect = g.sweep.expect;
    $('touch-swipe').dataset.expect = g.sweep.expect;

    $('minimap-frame').style.visibility = renderer.minimapVisible && app.screen === 'game' ? 'visible' : 'hidden';
    $('lock-overlay').hidden = !input.needsLock;
    this.updateOffscreen(renderer);
    this.updateResult();
  }

  /** 홈의 얼굴 카드: 사진 얼굴이 없으면 만들기를 권한다 (명세 3.1: 첫 실행은 얼굴 만들기가 주 행동) */
  updateHome() {
    const face = this.game.face ?? null;
    if ('homeFace' in this.cache && this.cache.homeFace === face) return;
    this.cache.homeFace = face;
    $('face-card').classList.toggle('empty', !face);
    $('face-title').textContent = face ? '내가 만든 얼굴' : '기본 얼굴';
    $('face-sub').textContent = face ? '이 얼굴로 플레이해요' : '친구 사진으로 만들면 훨씬 웃겨요';
    $('home-face').textContent = face ? '바꾸기' : '📷 만들기';
    $('home-face').classList.toggle('primary', !face);
    const c = $('face-thumb');
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    if (face) {
      g.drawImage(face.crop, 0, 0, c.width, c.height);
    } else {
      g.fillStyle = '#efc7a2';
      g.beginPath();
      g.ellipse(64, 70, 38, 48, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#4e342e';
      g.beginPath();
      g.ellipse(64, 46, 40, 26, 0, Math.PI, Math.PI * 2);
      g.fill();
      g.font = '28px system-ui';
      g.textAlign = 'center';
      g.fillText('?', 64, 82);
    }
  }

  /**
   * HUD가 화면 가장자리에서 차지하는 폭. 렌더러는 이 안쪽 영역 가운데에 장면을 놓는다.
   * - 위: 상단 막대(게임) 또는 로고(홈)
   * - 아래: 가운데 세로띠에 걸친 아래쪽 요소(단계·힌트·버튼·다음 입력·부위 목록·결과·홈 패널·일시정지)
   */
  insets() {
    const S = $('stage').getBoundingClientRect();
    const W = S.width;
    const H = S.height;
    let top = 0;
    for (const id of ['topbar', 'home-logo-anchor']) {
      const el = id === 'home-logo-anchor' ? document.querySelector('#home .home-logo') : $(id);
      const b = el?.getBoundingClientRect();
      if (b && b.height > 0) top = Math.max(top, b.bottom - S.top);
    }
    let bottomEdge = H;
    let left = 0;
    let right = 0;
    for (const id of ['hint', 'controls', 'next-key', 'touch-swipe', 'parts', 'result', 'pause']) {
      const el = $(id);
      const b = el.getBoundingClientRect();
      if (b.height === 0 || (id === 'hint' && !el.textContent)) continue;
      const r = { left: b.left - S.left, right: b.right - S.left, top: b.top - S.top, height: b.height };
      const centered = r.left < W * 0.65 && r.right > W * 0.35;
      if (centered && r.top > H * 0.4) bottomEdge = Math.min(bottomEdge, r.top);
      else if (r.height > H * 0.25) {
        if (r.right < W * 0.6) left = Math.max(left, r.right);
        else if (r.left > W * 0.4) right = Math.max(right, W - r.left);
      }
    }
    const panel = document.querySelector('#home .home-panel').getBoundingClientRect();
    if (panel.height > 0) bottomEdge = Math.min(bottomEdge, panel.top - S.top);
    return { top, bottom: H - bottomEdge, left, right };
  }

  hint(touch) {
    const g = this.game;
    switch (g.state) {
      case 'PART_SELECT':
        return '던질 부위를 고르세요';
      case 'THROW':
        return g.power > 0 ? '놓으면 발사 · 위로 올리면 취소' : '아무 데나 누른 채 아래로 당겼다 놓기';
      case 'SWEEP':
        if (this.learned >= LEARN_STROKES) return '';
        if (g.cfg.sweepAssist) return touch ? '화면을 위아래로 문질러 쓸기' : '버튼 누른 채 위아래로 문질러 쓸기';
        return touch ? '왼쪽 = 이동 · 오른쪽 = 위아래로 문지르기' : '빗자루를 스톤 앞에 대고 좌·우 번갈아 클릭';
      default:
        return '';
    }
  }

  /** 캐릭터가 화면 밖이면 가장자리에 방향과 거리 표시 */
  updateOffscreen(renderer) {
    const g = this.game;
    const el = $('offscreen');
    const show = (g.state === 'SWEEP' || g.state === 'SETTLING') && !renderer.options.laneTop && !renderer.fallback;
    const info = show ? renderer.screenInfo(g.character.pos.x, g.character.pos.y) : null;
    el.hidden = !info || info.inside;
    if (el.hidden) return;
    const k = 1 / Math.max(Math.abs(info.nx), Math.abs(info.ny), 1e-6);
    const S = $('stage').getBoundingClientRect();
    el.style.left = `${(0.5 + info.nx * k * 0.44) * S.width}px`;
    el.style.top = `${(0.5 - info.ny * k * 0.42) * S.height}px`;
    const ref = g.currentStone ?? g.character.target;
    const d = Math.hypot(ref.x - g.character.pos.x, ref.y - g.character.pos.y);
    const arrow = Math.abs(info.nx) > Math.abs(info.ny) ? (info.nx > 0 ? '▶' : '◀') : info.ny > 0 ? '▲' : '▼';
    this.set('offscreen', el, `${arrow} ${d.toFixed(0)} m`);
  }

  updateResult() {
    const g = this.game;
    const box = $('result');
    box.hidden = g.state !== 'RESULT';
    if (g.state !== 'RESULT' || this.cache.result === g.result) return;
    this.cache.result = g.result;
    const r = g.result;
    const rows = r.rows
      .map((row) => {
        const part = g.parts.find((p) => p.id === row.id);
        const tag = row.status === 'burned' ? '<em>BURNED</em>' : row.status === 'out' ? '<em>이탈</em>' : '';
        const hue = Math.round((row.score / 100) * 120); // 0 빨강 → 120 초록
        return `<div class="row"><i style="background:${part.color}"></i><span>${row.label}</span>
          <div class="bar"><b style="width:${row.score}%;background:hsl(${hue} 75% 50%)"></b>${tag}</div>
          <strong>${row.score.toFixed(0)}</strong></div>`;
      })
      .join('');
    box.innerHTML = `<p class="big"><b>${r.mean.toFixed(0)}</b><small>점</small>${g.mode === 'practice' ? '<span class="badge">연습</span>' : ''}</p>${rows}
      <div class="actions">${g.mode === 'practice' && g.checkpoint ? '<button id="r-undo">↶ 마지막 투구 다시</button>' : ''}<button id="r-home">홈</button><button id="r-again" class="primary">다시 하기</button></div>`;
    box.querySelector('#r-again').addEventListener('click', () => this.actions.restartGame());
    box.querySelector('#r-home').addEventListener('click', () => this.actions.goHome());
    box.querySelector('#r-undo')?.addEventListener('click', () => g.undoLastThrow());
  }
}
