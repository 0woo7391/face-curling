// 게임 상태 기계 (명세 8장). 렌더링·DOM과 무관하므로 Node에서 헤드리스로 돌릴 수 있다.
//
// PART_SELECT → AIM → SPIN → POWER → SWEEP → SETTLING → PART_SELECT … → RESULT
//                                       └──────┴→ BURN_RESOLVE → (기록) PART_SELECT/RESULT, (연습) AIM
//
// 입력 이벤트는 enqueue()로 쌓이고, 다음 고정 틱 시작 시 그 틱 번호에 귀속된다 (명세 5.2 틱 양자화).
// 게임은 발사·스트로크·충돌·번드 등을 타입 있는 이벤트로 내보내고(drainEvents), 이펙트·소리는 그것만 구독한다.
// 이벤트는 표현 전용이며 게임 로직은 이벤트를 읽지 않는다.
import { FACE_PARTS, makeBoard } from './board.js';
import { launchVelocity, predictPath } from './curling.js';
import { Simulation } from './simulation.js';
import { SweepController, sweepPositionEfficiency } from './sweep.js';
import { BurnMonitor, updateAssist } from './burn.js';
import { Character } from './character.js';
import { partError, partScore, checkLayout } from './scoring.js';

export const LAUNCH = Object.freeze({ x: 0, y: 0 });

export class Game {
  constructor(R, cfg, mode = 'record') {
    this.R = R;
    this.cfg = cfg;
    this.mode = mode;
    this.restart();
  }

  restart() {
    this.sim?.free();
    this.sim = new Simulation(this.R, this.cfg);
    this.board = makeBoard(this.cfg);
    this.parts = FACE_PARTS.map((p) => ({ ...p, status: 'pending', burnCause: null }));
    this.state = 'PART_SELECT';
    this.tickCount = 0;
    this.currentPartId = null;
    this.aimAngle = 0;
    this.spin = 0;
    this.power = 0;
    this.character = new Character(this.cfg);
    this.resetCharacter();
    this.broom = this.character.broomBase();
    this.broomPrev = { ...this.broom };
    this.sweep = new SweepController(this.cfg);
    this.burnMon = new BurnMonitor(this.cfg);
    this.queue = [];
    this.joy = { x: 0, y: 0 }; // 터치 조이스틱 기울기 (-1..1, y+ = 진행 방향)
    this.checkpoint = null;
    this.burn = null;
    this.burnTimer = 0;
    this.result = null;
    this.frame = { cushion: false, contactTicks: 0, posEff: 0 };
    this.stats = { throws: 0, burnsBody: 0, burnsBroom: 0, lastThrow: null };
    this.log = []; // 텍스트 로그 (디버그용)
    this.events = [];
  }

  push(ev) {
    this.events.push({ tick: this.tickCount, ...ev });
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  setMode(mode) {
    this.mode = mode;
    this.restart();
  }

  get bounds() {
    const h = this.cfg.laneWidth / 2 - 0.2;
    return { x0: -h, x1: h, y0: this.cfg.backLimitY + 0.5, y1: this.cfg.laneLength };
  }

  get currentPart() {
    return this.parts.find((p) => p.id === this.currentPartId) ?? null;
  }

  get currentStone() {
    return this.currentPartId ? this.sim.stones.get(this.currentPartId) ?? null : null;
  }

  get throwIndex() {
    return this.parts.filter((p) => p.status !== 'pending').length;
  }

  resetCharacter() {
    // 스톤 왼쪽 앞, 빗자루가 스톤 경로에 닿지 않는 위치에서 출발
    this.character.reset(LAUNCH.x - this.cfg.broomReach - 0.45, LAUNCH.y + this.cfg.charStartAhead);
  }

  emit(text) {
    this.log.push({ tick: this.tickCount, text });
    if (this.log.length > 30) this.log.shift();
  }

  // ── 투구 준비 (3.7) ──

  selectPart(id) {
    const part = this.parts.find((p) => p.id === id);
    if (this.state !== 'PART_SELECT' || !part || part.status !== 'pending') return false;
    this.currentPartId = id;
    this.aimAngle = 0;
    this.spin = 0;
    this.power = 0;
    this.state = 'AIM';
    this.push({ type: 'select', partId: id });
    return true;
  }

  setAimFromPoint(p) {
    if (this.state !== 'AIM') return;
    const max = (this.cfg.maxAimDeg * Math.PI) / 180;
    const a = Math.atan2(p.x - LAUNCH.x, Math.max(0.5, p.y - LAUNCH.y));
    this.aimAngle = Math.max(-max, Math.min(max, a));
  }

  setSpin(v) {
    if (this.state === 'SPIN') this.spin = Math.max(-1, Math.min(1, v));
  }

  setPower(v) {
    if (this.state === 'POWER') this.power = Math.max(0, Math.min(1, v));
  }

  next() {
    if (this.state === 'AIM') this.state = 'SPIN';
    else if (this.state === 'SPIN') this.state = 'POWER';
  }

  back() {
    if (this.state === 'POWER') {
      this.power = 0;
      this.state = 'SPIN';
    } else if (this.state === 'SPIN') this.state = 'AIM';
    else if (this.state === 'AIM') {
      this.currentPartId = null;
      this.state = 'PART_SELECT';
    }
  }

  /** 파워 드래그를 놓음. 발사하면 true (명세 8장: 발사 입력은 한 번만) */
  release() {
    if (this.state !== 'POWER') return false;
    if (this.power < this.cfg.minPower) {
      this.power = 0;
      return false;
    }
    this.throwStone();
    return true;
  }

  predictedPath() {
    const power = this.state === 'POWER' && this.power > 0 ? this.power : this.cfg.defaultPreviewPower;
    const v = launchVelocity(this.aimAngle, power, this.cfg);
    return predictPath(LAUNCH.x, LAUNCH.y, v.x, v.y, this.spin, this.cfg);
  }

  throwStone() {
    this.checkpoint = {
      stones: this.sim.snapshot(),
      parts: this.parts.map((p) => ({ id: p.id, status: p.status, burnCause: p.burnCause })),
      partId: this.currentPartId,
    };
    const v = launchVelocity(this.aimAngle, this.power, this.cfg);
    this.sim.placeStone(this.currentPartId, LAUNCH.x, LAUNCH.y, v.x, v.y, this.spin);
    this.currentPart.status = 'moving';
    this.stats.throws++;
    this.throwInfo = { partId: this.currentPartId, power: this.power, spin: this.spin, aim: this.aimAngle, sweepTicks: 0, sweepSum: 0 };
    this.sweep.reset();
    this.burnMon.reset();
    this.resetCharacter();
    this.queue.length = 0;
    this.joy = { x: 0, y: 0 };
    this.state = 'SWEEP';
    this.push({ type: 'launch', partId: this.currentPartId, speed: Math.hypot(v.x, v.y), spin: this.spin, x: LAUNCH.x, y: LAUNCH.y });
  }

  // ── 고정 틱 ──

  enqueue(ev) {
    this.queue.push(ev);
  }

  tick() {
    this.tickCount++;
    const events = this.queue;
    this.queue = [];
    const dt = 1 / this.cfg.tickRate;

    if (this.state === 'BURN_RESOLVE') {
      if (--this.burnTimer <= 0) this.resolveBurn();
      return;
    }
    if (this.state !== 'SWEEP' && this.state !== 'SETTLING') return;

    const sens = this.cfg.mouseSensitivity;
    for (const ev of events) {
      if (ev.type === 'move') this.character.moveTargetBy(ev.dx * sens, -ev.dy * sens * this.cfg.forwardSensitivityScale, this.bounds);
      else if (ev.type === 'moveAbs') this.character.setTarget(ev.x, ev.y, this.bounds);
      else if (ev.type === 'joy') this.joy = { x: ev.x, y: ev.y };
      else if (ev.type === 'press' && this.state === 'SWEEP') {
        const r = this.sweep.press(ev.button, this.tickCount);
        if (r === 'rejected-order' || r === 'rejected-busy') this.push({ type: 'reject', reason: r });
      }
    }

    // 조이스틱: 기울이는 동안만 목표점이 움직이고, 놓으면 그 자리(월드 고정)에 멈춘다. 틱 단위로 적분.
    const jm = Math.min(1, Math.hypot(this.joy.x, this.joy.y));
    if (jm > 0) {
      const k = (Math.pow(jm, this.cfg.joyCurve) / jm) * this.cfg.joyMaxSpeed * dt;
      this.character.moveTargetBy(this.joy.x * k, this.joy.y * k, this.bounds);
    }

    const moving = this.sim.movingStones();
    const cur = this.currentStone;
    const ref = cur && cur.status === 'moving' ? cur : nearest(moving, this.character.pos);
    this.character.update(dt, ref ? ref.x : null);

    // 빗자루 = 몸 기준 위치 + 스트로크 왕복 + 자동 회피 보조
    const base = this.character.broomBase();
    const raw = { x: base.x, y: base.y + this.sweep.strokeOffset(this.tickCount) * this.cfg.strokeAmp };
    this.character.assist = updateAssist(this.character.assist, raw, nearest(moving, raw), this.cfg, dt);
    this.broomPrev = this.broom;
    this.broom = { x: raw.x + this.character.assist.x, y: raw.y + this.character.assist.y };

    const bm = this.burnMon.update(this.character.pos, this.broom, moving);
    if (bm.cushion && !this.frame.cushion) this.push({ type: 'cushion', x: this.broom.x, y: this.broom.y });
    this.frame.cushion = bm.cushion;
    this.frame.contactTicks = bm.contactTicks;
    if (bm.burn) {
      this.startBurn(bm.burn);
      return;
    }
    if (bm.contactStarted) {
      this.sweep.penalize(this.tickCount);
      this.emit('빗자루 스침 — 스위핑 일시 중단');
      this.push({ type: 'contact', x: this.broom.x, y: this.broom.y });
    }

    let posEff = 0;
    let speedFactor = 0;
    if (this.state === 'SWEEP' && cur && cur.status === 'moving') {
      posEff = sweepPositionEfficiency(this.broom, cur, this.cfg);
      speedFactor = Math.min(1, Math.hypot(cur.vx, cur.vy) / this.cfg.sweepMinSpeed);
    }
    this.frame.posEff = posEff;
    const s = this.sweep.update(this.tickCount, posEff, speedFactor);
    if (this.sweep.completed) {
      this.push({ type: 'stroke', ...this.sweep.completed, intensity: s, x: this.broom.x, y: this.broom.y });
    }
    if (this.state === 'SWEEP' && s > 0) {
      this.throwInfo.sweepTicks++;
      this.throwInfo.sweepSum += s;
    }

    const { out, hits, stops } = this.sim.step(this.state === 'SWEEP' && cur ? { id: cur.id, s } : null);
    for (const h of hits) this.push({ type: 'collision', ...h });
    for (const id of stops) {
      const st = this.sim.stones.get(id);
      this.push({ type: 'stop', id, x: st.x, y: st.y });
    }
    for (const id of out) {
      this.parts.find((p) => p.id === id).status = 'out';
      this.emit(`${labelOf(id)} 경기장 이탈`);
      this.push({ type: 'out', id });
    }

    if (this.state === 'SWEEP') {
      const c = this.currentStone;
      if (!c || c.status === 'stopped') {
        this.stats.lastThrow = {
          ...this.throwInfo,
          stopY: c ? c.y : null,
          avgSweep: this.throwInfo.sweepTicks ? this.throwInfo.sweepSum / this.throwInfo.sweepTicks : 0,
        };
        this.state = 'SETTLING';
      }
    }
    if (this.state === 'SETTLING' && this.sim.isSettled()) this.finishTurn();
  }

  finishTurn() {
    for (const p of this.parts) if (p.status === 'moving') p.status = this.sim.stones.has(p.id) ? 'stopped' : 'out';
    this.currentPartId = null;
    this.toNextTurn();
  }

  toNextTurn() {
    if (this.parts.every((p) => p.status !== 'pending')) {
      this.result = this.computeScores();
      this.state = 'RESULT';
      this.push({ type: 'result', mean: this.result.mean });
    } else {
      this.state = 'PART_SELECT';
      this.push({ type: 'turnEnd' });
    }
  }

  // ── 번드 (3.9, v1.1/v1.2) ──

  startBurn(burn) {
    this.burn = { ...burn, partId: this.currentPartId };
    this.burnTimer = this.cfg.burnFreezeTicks;
    if (burn.cause === 'body') this.stats.burnsBody++;
    else this.stats.burnsBroom++;
    this.emit(`BURNED (${burn.cause === 'body' ? '몸' : '빗자루'} → ${labelOf(burn.stoneId)})`);
    const st = this.sim.stones.get(burn.stoneId);
    this.push({ type: 'burn', cause: burn.cause, x: st.x, y: st.y });
    this.state = 'BURN_RESOLVE';
  }

  resolveBurn() {
    const { checkpoint } = this;
    this.sim.restore(checkpoint.stones);
    for (const saved of checkpoint.parts) Object.assign(this.parts.find((p) => p.id === saved.id), saved);
    const part = this.parts.find((p) => p.id === checkpoint.partId);
    this.joy = { x: 0, y: 0 };
    this.sweep.reset();
    this.burnMon.reset();
    this.resetCharacter();
    if (this.mode === 'record') {
      // 투구 무효 + 다른 스톤 체크포인트 복원 + 던진 부위 제거(0점, 재투구 불가)
      part.status = 'burned';
      part.burnCause = this.burn.cause;
      this.currentPartId = null;
      this.toNextTurn();
    } else {
      // 연습: 복원 후 같은 부위 재투구 (조준·회전 값 유지)
      part.status = 'pending';
      this.currentPartId = part.id;
      this.power = 0;
      this.state = 'AIM';
    }
    this.burn = null;
  }

  /** 연습 모드: 직전 투구를 되돌린다 */
  undoLastThrow() {
    if (this.mode !== 'practice' || !this.checkpoint) return false;
    if (this.state !== 'PART_SELECT' && this.state !== 'RESULT') return false;
    this.sim.restore(this.checkpoint.stones);
    for (const saved of this.checkpoint.parts) Object.assign(this.parts.find((p) => p.id === saved.id), saved);
    this.checkpoint = null;
    this.result = null;
    this.state = 'PART_SELECT';
    return true;
  }

  // ── 채점 (6.3) ──

  computeScores() {
    const rows = this.parts.map((p) => {
      const s = this.sim.stones.get(p.id);
      const placed = s && (p.status === 'stopped' || p.status === 'moving');
      const err = placed ? partError(s, p.q, this.board) : null;
      return { id: p.id, label: p.label, status: p.status, burnCause: p.burnCause, err, score: placed ? partScore(err, this.cfg.allowedError) : 0 };
    });
    const total = rows.reduce((a, r) => a + r.score, 0);
    return { rows, total, mean: total / rows.length };
  }

  layoutReport() {
    return checkLayout(this.parts, this.board, this.cfg, LAUNCH);
  }
}

function nearest(stones, p) {
  let best = null;
  let bd = Infinity;
  for (const s of stones) {
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

const labelOf = (id) => FACE_PARTS.find((p) => p.id === id)?.label ?? id;
