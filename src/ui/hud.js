// DOM HUD (명세 3.6~3.10, 3.8 스위핑 효율 피드백 표).
// 상태가 바뀔 때만 DOM을 다시 쓰도록 값을 캐시한다.
import { predictPath } from '../core/curling.js';
import { partError, partScore } from '../core/scoring.js';

const $ = (id) => document.getElementById(id);

const STATE_LABEL = {
  PART_SELECT: '부위 선택',
  AIM: '방향',
  SPIN: '회전',
  POWER: '파워',
  SWEEP: '스위핑',
  SETTLING: '정지 대기',
  BURN_RESOLVE: '번드 처리',
  RESULT: '결과',
};

const STATUS_LABEL = { pending: '미투구', moving: '이동 중', stopped: '정지', out: '이탈', burned: 'BURNED' };

const REJECT_LABEL = {
  'rejected-order': '순서 틀림',
  'rejected-busy': '너무 빠름',
};

export class Hud {
  constructor(game, actions) {
    this.game = game;
    this.actions = actions;
    this.cache = {};
    this.partButtons = new Map();

    $('mode').addEventListener('change', (e) => actions.setMode(e.target.value));
    $('restart').addEventListener('click', () => actions.restart());
    $('back').addEventListener('click', () => game.back());
    $('next').addEventListener('click', () => game.next());
    $('undo').addEventListener('click', () => game.undoLastThrow());
    $('help-btn').addEventListener('click', () => $('help').classList.toggle('open'));
    $('help').addEventListener('click', () => $('help').classList.remove('open'));
    this.buildParts();
  }

  buildParts() {
    const box = $('parts');
    box.innerHTML = '<h3>부위</h3>';
    this.partButtons.clear();
    this.cache = {};
    for (const p of this.game.parts) {
      const b = document.createElement('button');
      b.className = 'part';
      b.innerHTML = `<i style="background:${p.color}"></i><span class="name">${p.label}</span><span class="st"></span><span class="sc"></span>`;
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

  update(input, renderer) {
    const g = this.game;
    const st = g.state;
    const part = g.currentPart;
    this.set('status', $('status'), `${g.mode === 'record' ? '기록' : '연습'} 모드 · 투구 ${g.throwIndex}/6 · ${STATE_LABEL[st]}${part ? ` · ${part.label}` : ''}`);
    this.set('modeSel', $('mode'), g.mode, 'value');

    // 부위 목록 + 잠정 점수 (명세 3.9: 실시간 점수는 잠정값)
    for (const p of g.parts) {
      const b = this.partButtons.get(p.id);
      const s = g.sim.stones.get(p.id);
      const score = s && p.status !== 'pending' ? partScore(partError(s, p.q, g.board), g.cfg.allowedError) : null;
      this.set(`ps-${p.id}`, b.querySelector('.st'), STATUS_LABEL[p.status]);
      this.set(`pc-${p.id}`, b.querySelector('.sc'), p.status === 'burned' || p.status === 'out' ? '0' : score == null ? '' : score.toFixed(0));
      this.set(`pd-${p.id}`, b, !(st === 'PART_SELECT' && p.status === 'pending'), 'disabled');
      b.classList.toggle('current', p.id === g.currentPartId);
      b.dataset.status = p.status;
    }

    this.set('instr', $('instruction'), this.instruction(input), 'innerHTML');

    const aiming = st === 'AIM' || st === 'SPIN' || st === 'POWER';
    $('back').hidden = !aiming;
    $('next').hidden = !(st === 'AIM' || st === 'SPIN');
    this.set('backLabel', $('back'), st === 'POWER' ? '✕ 취소 (회전으로)' : '◀ 뒤로');
    $('undo').hidden = !(g.mode === 'practice' && g.checkpoint && (st === 'PART_SELECT' || st === 'RESULT'));

    this.updateSweep();
    $('minimap-frame').hidden = !renderer.minimapVisible;
    this.updateOffscreen(renderer);
    this.updateBanner();
    $('lock-overlay').hidden = !input.needsLock;
    this.updateResult();
    this.set('log', $('log'), g.log.slice(-5).map((l) => `<div>${l.text}</div>`).join(''), 'innerHTML');
  }

  instruction(input) {
    const g = this.game;
    switch (g.state) {
      case 'PART_SELECT':
        return '오른쪽 목록에서 던질 부위를 고르세요. <b>턱이 투구자 쪽</b>이라 입·코가 앞을 막습니다 — 먼 쪽(눈썹·눈)부터 던지는 게 유리합니다.';
      case 'AIM':
        return `레인을 <b>클릭·드래그</b>해 방향을 정하세요 (±${g.cfg.maxAimDeg}°). 현재 ${((g.aimAngle * 180) / Math.PI).toFixed(1)}° · 초록 점선 = 스위핑·충돌 없는 예상 경로`;
      case 'SPIN': {
        const dir = g.spin > 0.005 ? '시계 → 오른쪽으로 휨' : g.spin < -0.005 ? '반시계 → 왼쪽으로 휨' : '무회전';
        return `스톤 주위를 <b>원을 그리며 드래그</b>해 회전을 정하세요. 현재 <b>${(Math.abs(g.spin) * 100).toFixed(0)}% · ${dir}</b>`;
      }
      case 'POWER':
        return `아무 곳이나 <b>누른 채 아래로 당기고 놓으면 발사</b>. 거의 안 당기고 놓으면 취소. 파워 <b>${(g.power * 100).toFixed(0)}%</b>`;
      case 'SWEEP':
        return input.fallback
          ? '대체 모드(절대 좌표): 커서 위치 = 캐릭터 목표 · <b>좌클릭 밀기 → 우클릭 당기기</b> 교대'
          : '마우스 이동 = 캐릭터 목표(<b>월드 고정</b>) · <b>좌클릭 밀기 → 우클릭 당기기</b> 교대 · 몸·빗자루가 움직이는 스톤에 닿으면 BURNED · <kbd>T</kbd> 레인 탑다운';
      case 'SETTLING':
        return '모든 스톤이 멈출 때까지 대기합니다. 움직이는 스톤에 닿지 않게 캐릭터를 비켜 세우세요.';
      case 'BURN_RESOLVE':
        return g.mode === 'record' ? '번드: 투구 무효 → 다른 스톤 원위치 → 이 부위는 0점' : '번드: 원위치 후 같은 부위를 다시 던집니다';
      case 'RESULT':
        return '모든 부위를 던졌습니다.';
      default:
        return '';
    }
  }

  updateSweep() {
    const g = this.game;
    const show = g.state === 'SWEEP' || g.state === 'SETTLING';
    $('sweep-panel').hidden = !show;
    if (!show) return;
    const sw = g.sweep;
    bar('bar-s', sw.intensity);
    bar('bar-input', sw.inputEfficiency);
    bar('bar-pos', g.frame.posEff);
    this.set('rhythm', $('rhythm'), sw.history.map((h) => `<b class="${h.valid ? 'ok' : 'no'}">${h.kind === 'push' ? '밀' : '당'}</b>`).join(''), 'innerHTML');
    const reject = REJECT_LABEL[sw.lastResult];
    this.set('nextInput', $('next-input'), `다음: ${sw.expect === 'push' ? '좌클릭 (밀기)' : '우클릭 (당기기)'}${reject ? ` · 직전 입력 ${reject}` : ''}`);
    this.set('rate', $('rate'), `${sw.roundTripsPerSecond().toFixed(1)} 왕복/초`);

    const s = g.currentStone;
    const part = g.currentPart;
    let info = '스톤 정지';
    if (s && part) {
      const target = g.board.qToWorld(part.q);
      const speed = Math.hypot(s.vx, s.vy);
      const dist = Math.hypot(target.x - s.x, target.y - s.y);
      info = `속도 ${speed.toFixed(2)} m/s · 정답까지 ${dist.toFixed(2)} m`;
      if (s.status === 'moving') {
        const end = predictPath(s.x, s.y, s.vx, s.vy, s.spin, g.cfg, 1000).end;
        info += ` · 스위핑 없이 멈출 곳: 정답에서 ${Math.hypot(target.x - end.x, target.y - end.y).toFixed(2)} m`;
      }
    } else if (part && part.status === 'out') info = '경기장 이탈';
    this.set('stoneInfo', $('stone-info'), info);

    const warn = $('warn');
    const ct = g.frame.contactTicks;
    const text = ct > 0 ? `빗자루 접촉 ${ct}/${g.cfg.graceTicks}틱` : g.frame.cushion ? '쿠션 구간 — 너무 가깝습니다' : '';
    this.set('warn', warn, text);
    warn.className = ct > 0 ? 'danger' : g.frame.cushion ? 'caution' : '';
  }

  /** 캐릭터가 화면 밖이면 가장자리에 방향과 거리 표시 (명세 3.8.1) */
  updateOffscreen(renderer) {
    const g = this.game;
    const el = $('offscreen');
    const show = (g.state === 'SWEEP' || g.state === 'SETTLING') && !renderer.options.laneTop && !renderer.fallback;
    const info = show ? renderer.screenInfo(g.character.pos.x, g.character.pos.y) : null;
    el.hidden = !info || info.inside;
    if (el.hidden) return;
    const k = 1 / Math.max(Math.abs(info.nx), Math.abs(info.ny), 1e-6);
    const x = (0.5 + (info.nx * k * 0.46)) * window.innerWidth;
    const y = (0.5 - (info.ny * k * 0.42)) * window.innerHeight;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    const ref = g.currentStone ?? g.character.target;
    const d = Math.hypot(ref.x - g.character.pos.x, ref.y - g.character.pos.y);
    const arrow = Math.abs(info.nx) > Math.abs(info.ny) ? (info.nx > 0 ? '▶' : '◀') : info.ny > 0 ? '▲' : '▼';
    this.set('offscreen', el, `${arrow} 캐릭터 · 스톤에서 ${d.toFixed(1)} m`);
  }

  updateBanner() {
    const g = this.game;
    const b = $('banner');
    const text = g.state === 'BURN_RESOLVE' ? `BURNED · ${g.burn.cause === 'body' ? '몸' : '빗자루'} 접촉` : '';
    this.set('banner', b, text);
    b.hidden = !text;
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
        const status = row.status === 'burned' ? `BURNED (${row.burnCause === 'body' ? '몸' : '빗자루'})` : STATUS_LABEL[row.status];
        return `<tr><td>${row.label}</td><td>${status}</td><td>${row.err == null ? '–' : row.err.toFixed(3)}</td><td>${row.score.toFixed(1)}</td></tr>`;
      })
      .join('');
    box.innerHTML = `<h2>결과</h2>
      <p class="big">평균 <b>${r.mean.toFixed(1)}</b> <small>총점 ${r.total.toFixed(1)} / 600</small></p>
      <table><thead><tr><th>부위</th><th>상태</th><th>정규화 오차</th><th>점수</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="note">오차 = 얼굴 기준 박스 대각선 대비 거리, 허용 오차 ${g.cfg.allowedError} (미결 값)</p>
      <div class="row"><button id="again">다시 하기</button></div>`;
    box.querySelector('#again').addEventListener('click', () => this.actions.restart());
  }
}

function bar(id, v) {
  document.getElementById(id).style.setProperty('--v', Math.max(0, Math.min(1, v)).toFixed(3));
}
