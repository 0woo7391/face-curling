// DOM HUD. 글자는 최소로: 단계 칩, 다음 입력 표시(마우스 버튼 / 스와이프 화살표), 짧은 힌트 한 줄.
// 나머지 피드백은 화면 속(렌더러)과 소리로 전달한다.
// 상태가 바뀔 때만 DOM을 다시 쓰도록 값을 캐시한다.
import { partError, partScore } from '../core/scoring.js';

const $ = (id) => document.getElementById(id);
const STEPS = ['AIM', 'SPIN', 'POWER'];
const LEARN_STROKES = 3; // 유효 스트로크를 이만큼 하면 스위핑 힌트를 숨긴다

export class Hud {
  constructor(game, actions) {
    this.game = game;
    this.actions = actions;
    this.cache = {};
    this.partButtons = new Map();
    this.learned = 0;

    $('mode').addEventListener('change', (e) => actions.setMode(e.target.value));
    $('restart').addEventListener('click', () => actions.restart());
    $('mute').addEventListener('click', () => actions.toggleMute());
    $('face-btn').addEventListener('click', () => actions.openMaker());
    $('tune').addEventListener('click', () => actions.toggleTuning());
    $('back').addEventListener('click', () => game.back());
    $('next').addEventListener('click', () => game.next());
    $('undo').addEventListener('click', () => game.undoLastThrow());
    $('help-btn').addEventListener('click', () => $('help').classList.toggle('open'));
    $('help').addEventListener('click', () => $('help').classList.remove('open'));
    this.buildParts();
  }

  buildParts() {
    const box = $('parts');
    box.innerHTML = '';
    this.partButtons.clear();
    this.cache = {};
    for (const p of this.game.parts) {
      const b = document.createElement('button');
      b.className = 'part';
      b.innerHTML = `<i style="background:${p.color}"></i><span class="name">${p.label}</span><span class="sc"></span>`;
      b.addEventListener('click', () => this.game.selectPart(p.id));
      box.appendChild(b);
      this.partButtons.set(p.id, b);
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

  update(input, renderer, muted) {
    const g = this.game;
    const st = g.state;
    const touch = input.touchMode;
    const hud = $('hud');
    hud.dataset.state = st;
    hud.dataset.input = touch ? 'touch' : 'mouse';

    this.set('status', $('status'), `${g.mode === 'record' ? '기록' : '연습'} · ${g.throwIndex}/6`);
    this.set('modeSel', $('mode'), g.mode, 'value');
    this.set('mute', $('mute'), muted ? '🔇' : '🔊');

    // 부위: 색 점 + 이름 + 점수(던진 뒤). 번드·이탈은 빨간 0
    for (const p of g.parts) {
      const b = this.partButtons.get(p.id);
      const s = g.sim.stones.get(p.id);
      const score = s && p.status !== 'pending' ? partScore(partError(s, p.q, g.board, g.faceDiagonal), g.cfg.allowedError) : null;
      const sc = p.status === 'burned' || p.status === 'out' ? '0' : score == null ? '' : score.toFixed(0);
      this.set(`pc-${p.id}`, b.querySelector('.sc'), sc);
      this.set(`pd-${p.id}`, b, !(st === 'PART_SELECT' && p.status === 'pending'), 'disabled');
      b.classList.toggle('current', p.id === g.currentPartId);
      b.dataset.status = p.status;
    }

    // 투구 단계 칩
    const stepIdx = STEPS.indexOf(st);
    $('steps').hidden = stepIdx < 0;
    [...$('steps').children].forEach((c, i) => {
      c.classList.toggle('on', i === stepIdx);
      c.classList.toggle('done', i < stepIdx);
    });

    this.set('hint', $('hint'), this.hint(touch));
    $('back').hidden = stepIdx < 0;
    $('next').hidden = !(st === 'AIM' || st === 'SPIN');
    this.set('backLabel', $('back'), st === 'POWER' ? '✕' : '◀');
    $('undo').hidden = !(g.mode === 'practice' && g.checkpoint && (st === 'PART_SELECT' || st === 'RESULT'));

    // 다음 입력: 마우스는 버튼 그림, 터치는 스와이프 판의 화살표가 밝아진다
    const sweeping = st === 'SWEEP';
    $('next-key').hidden = !sweeping || touch;
    $('next-key').dataset.expect = g.sweep.expect;
    $('touch-swipe').dataset.expect = g.sweep.expect;

    $('minimap-frame').style.visibility = renderer.minimapVisible ? 'visible' : 'hidden';
    $('lock-overlay').hidden = !input.needsLock;
    this.updateOffscreen(renderer);
    this.updateResult();
  }

  /**
   * HUD가 화면 가장자리에서 차지하는 폭. 렌더러는 이 안쪽 영역 가운데에 장면을 놓는다.
   * - 아래: 가운데 세로띠에 걸친 아래쪽 요소(단계·힌트·버튼·다음 입력·세로 화면의 부위 목록·결과 시트)
   * - 좌/우: 키 큰 옆 패널(가로 화면의 결과·부위 목록)
   */
  insets() {
    const S = $('stage').getBoundingClientRect();
    const W = S.width;
    const H = S.height;
    const top = $('topbar').getBoundingClientRect().bottom - S.top;
    let bottomEdge = H;
    let left = 0;
    let right = 0;
    for (const id of ['steps', 'hint', 'controls', 'next-key', 'touch-swipe', 'parts', 'result']) {
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
    return { top, bottom: H - bottomEdge, left, right };
  }

  hint(touch) {
    switch (this.game.state) {
      case 'PART_SELECT':
        return this.game.face ? '던질 부위를 고르세요' : '던질 부위를 고르세요 · 📷 내 사진으로 얼굴 만들기';
      case 'AIM':
        return touch ? '레인을 끌어서 방향' : '레인을 드래그해서 방향';
      case 'SPIN':
        return '스톤 주위를 빙글 돌려 회전';
      case 'POWER':
        return '아래로 당겼다 놓기';
      case 'SWEEP':
        if (this.learned >= LEARN_STROKES) return '';
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
    box.innerHTML = `<p class="big"><b>${r.mean.toFixed(0)}</b><small>점</small></p>${rows}
      <div class="actions"><button id="again">다시 하기</button></div>`;
    box.querySelector('#again').addEventListener('click', () => this.actions.restart());
  }
}
