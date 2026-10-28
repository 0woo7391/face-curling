// 게임 상태 기계 (명세 8장). 렌더링·DOM과 무관하므로 Node에서 헤드리스로 돌릴 수 있다.
//
// PART_SELECT → THROW → SWEEP → SETTLING → PART_SELECT … → RESULT
//                        └──────┴→ BURN_RESOLVE → (기록) PART_SELECT/RESULT, (연습) THROW
//
// THROW: 새총처럼 한 번 당겼다 놓으면 방향·파워가 함께 정해진다. 회전은 그 전에 칩으로 고른다.
// 스위핑 보조(cfg.sweepAssist, 기본 켬): 캐릭터가 스톤 앞에 알아서 붙고, 플레이어는 문지르기만 한다.
//   이때는 위치를 플레이어가 잡지 않으므로 번드 판정을 하지 않는다. 끄면 v1.2 규칙(직접 이동 + 번드) 그대로.
//
// 입력 이벤트는 enqueue()로 쌓이고, 다음 고정 틱 시작 시 그 틱 번호에 귀속된다 (명세 5.2 틱 양자화).
// 게임은 발사·스트로크·충돌·번드 등을 타입 있는 이벤트로 내보내고(drainEvents), 이펙트·소리는 그것만 구독한다.
// 이벤트는 표현 전용이며 게임 로직은 이벤트를 읽지 않는다.
import { FACE_PARTS, FACE_DIAGONAL, makeBoard } from './board.js';
import { launchVelocity, predictPath } from './curling.js';
import { Simulation } from './simulation.js';
import { SweepController, sweepPositionEfficiency, broomJudgeRadius } from './sweep.js';
import { BurnMonitor, updateAssist } from './burn.js';
import { Character, ARRIVE_GAIN } from './character.js';
import { partError, partScore, checkLayout } from './scoring.js';
import { buildShapes, defaultOutline, stoneExtent, tiltOf } from './shape.js';

export const LAUNCH = Object.freeze({ x: 0, y: 0 });

export class Game {
  constructor(R, cfg, mode = 'record') {
    this.R = R;
    this.baseCfg = cfg; // 튜닝 패널이 바꾸는 설정. this.cfg는 이 얼굴에 맞춘 값만 덮어쓴 파생 설정
    this.mode = mode;
    this.restart();
  }

  /** 사진으로 만든 얼굴 적용 (null = 기본 가상 얼굴). 정답 위치·채점 기준이 바뀐다 */
  setFace(face) {
    this.face = face;
    this.restart();
  }

  restart() {
    this.sim?.free();
    // this.cfg는 튜닝 패널 값을 그대로 따라가는 파생 설정 (프로토타입 상속)
    this.cfg = Object.create(this.baseCfg);
    this.board = makeBoard(this.cfg);
    const fp = this.face?.parts ?? {};
    // 스톤 = 부위 모양 실제 크기. 사진 부위는 스티커 윤곽, 없으면 기본 도형
    const src = FACE_PARTS.map((p) => {
      const f = fp[p.id];
      return f?.outline ? { id: p.id, q: f.anchor, outline: f.outline, rect: f.rect } : { id: p.id, q: f?.anchor ?? p.q, outline: defaultOutline(p) };
    });
    const { scale, shapes } = buildShapes(src, this.board, this.cfg);
    this.shapeScale = scale; // 가장 많이 줄인 부위의 배율 (부위별 배율은 part.scale)
    this.parts = FACE_PARTS.map((p, i) => ({ ...p, q: src[i].q, ...shapes.get(p.id), status: 'pending', burnCause: null }));
    this.sim = new Simulation(this.R, this.cfg, shapes);
    const fb = this.face?.faceBox;
    this.faceDiagonal = fb ? Math.hypot(fb.x1 - fb.x0, fb.y1 - fb.y0) : FACE_DIAGONAL;
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
    this.hand = 0; // 흔드는 손의 좌우 위치 (-1..1) — 흔들기 모드에서 빗자루가 따라간다
    this.steerTarget = 0; // 흔드는 자리 (-1..1, 화면 왼쪽 = -) — 스톤을 그쪽으로 끈다
    this.steer = 0; // steerTarget을 부드럽게 따라간 값
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
    // 스톤 왼쪽 앞, 빗자루가 스톤 경로에 닿지 않는 위치에서 출발 (큰 스톤일수록 더 옆으로)
    const extra = Math.max(0, (this.currentPart?.radius ?? 0) - this.cfg.stoneRadius);
    this.character.reset(LAUNCH.x - this.cfg.broomReach - 0.45 - extra, LAUNCH.y + this.cfg.charStartAhead + extra);
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
    this.power = 0;
    this.state = 'THROW';
    this.push({ type: 'select', partId: id });
    return true;
  }

  /** 새총 당기기: 방향(라디안, ±maxAimDeg로 제한)과 파워(0..1)를 함께 */
  setThrow(aimAngle, power) {
    if (this.state !== 'THROW') return;
    const max = (this.cfg.maxAimDeg * Math.PI) / 180;
    this.aimAngle = Math.max(-max, Math.min(max, aimAngle));
    this.power = Math.max(0, Math.min(1, power));
  }

  /** 회전 (-1..1, + = 시계 = 오른쪽으로 휨) */
  setSpin(v) {
    if (this.state === 'THROW') this.spin = Math.max(-1, Math.min(1, v));
  }

  back() {
    if (this.state !== 'THROW') return;
    this.power = 0;
    this.currentPartId = null;
    this.state = 'PART_SELECT';
  }

  /** 당긴 것을 놓음. 충분히 당겼으면 발사하고 true (명세 8장: 발사 입력은 한 번만) */
  release() {
    if (this.state !== 'THROW') return false;
    if (this.power < this.cfg.minPower) {
      this.power = 0;
      return false;
    }
    this.throwStone();
    return true;
  }

  predictedPath() {
    const power = this.power > 0 ? this.power : this.cfg.defaultPreviewPower;
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
    this.hand = 0;
    this.steerTarget = 0;
    this.steer = 0;
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
      else if (ev.type === 'hand') this.hand = Math.max(-1, Math.min(1, ev.x));
      else if (ev.type === 'steer') this.steerTarget = Math.max(-1, Math.min(1, ev.x));
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
    const assist = this.cfg.sweepAssist;
    this.steer = assist ? this.steer + (this.steerTarget - this.steer) * Math.min(1, dt * 8) : 0;
    if (assist && cur && cur.status === 'moving') this.autoFollow(cur);
    const ref = cur && cur.status === 'moving' ? cur : nearest(moving, this.character.pos);
    this.character.update(dt, ref ? ref.x : null);

    // 빗자루 = 몸 기준 위치 + 왕복 + 자동 회피 보조
    //   흔들기(보조) 모드: 손의 좌우 위치대로 스톤 진행 방향에 가로로, 흔드는 자리(steer) 쪽으로 비켜서 / 직접 이동: 스트로크 애니메이션대로 진행 방향 앞뒤로
    const base = this.character.broomBase();
    let raw;
    if (assist && cur && cur.status === 'moving') {
      const sp = Math.hypot(cur.vx, cur.vy) || 1;
      const sw = this.hand * this.cfg.sweepSwing + this.steer * this.cfg.steerReach;
      raw = { x: base.x + (cur.vy / sp) * sw, y: base.y - (cur.vx / sp) * sw };
    } else raw = { x: base.x, y: base.y + this.sweep.strokeOffset(this.tickCount) * this.cfg.strokeAmp };
    this.character.assist = updateAssist(this.character.assist, raw, nearest(moving, raw), this.cfg, dt);
    this.broomPrev = this.broom;
    this.broom = { x: raw.x + this.character.assist.x, y: raw.y + this.character.assist.y };

    const bm = assist ? NO_BURN : this.burnMon.update(this.character.pos, this.broom, moving);
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
      // 흔들기 모드에서는 좌우 흔들림 자체가 쓸기 동작이므로, 흔들림의 중심(몸 기준 빗자루 위치)으로 효율을 잰다
      posEff = sweepPositionEfficiency(assist ? base : this.broom, cur, this.cfg);
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

    const { out, hits, stops } = this.sim.step(this.state === 'SWEEP' && cur ? { id: cur.id, s, steer: this.steer } : null);
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

  /**
   * 스위핑 보조: 빗자루가 스톤 바로 앞 효율 최고점에 오도록 캐릭터 목표를 매 틱 정한다 (결정론).
   * 아직 스톤 앞에 있지 않으면 경로 옆으로 비켜서 먼저 앞지른 뒤 들어간다.
   */
  autoFollow(s) {
    const { cfg } = this;
    const sp = Math.hypot(s.vx, s.vy);
    if (sp < 1e-3) return;
    const dx = s.vx / sp;
    const dy = s.vy / sp;
    const best = stoneExtent(s, dx, dy, cfg) + broomJudgeRadius(cfg) + cfg.cushionWidth + 0.12;
    const b = this.broom;
    const along = (b.x - s.x) * dx + (b.y - s.y) * dy;
    // 캐릭터는 움직이는 목표를 v / ARRIVE_GAIN만큼 뒤따르므로 그만큼 앞을 겨냥한다
    const bx = s.x + dx * best + s.vx / ARRIVE_GAIN;
    const by = s.y + dy * best + s.vy / ARRIVE_GAIN;
    const side = this.character.side; // 빗자루 = 몸 x - side × reach
    if (along < best - 0.05) this.character.setTarget(bx + side * (cfg.broomReach + 0.5), by + 0.8, this.bounds);
    else this.character.setTarget(bx + side * cfg.broomReach, by, this.bounds);
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
      // 연습: 복원 후 같은 부위 재투구 (회전 값 유지)
      part.status = 'pending';
      this.currentPartId = part.id;
      this.power = 0;
      this.state = 'THROW';
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

  /** 지금 놓인 자리 기준 한 부위의 점수 (보드에 없으면 null). 진행 칸·멈춤 표시·결과가 모두 이것을 쓴다 */
  scoreOf(p) {
    const s = this.sim.stones.get(p.id);
    if (!s) return null;
    const err = partError(s, p.q, this.board, this.faceDiagonal);
    // 기울기: 똑바로에서 90°마다 tiltPenalty만큼 감점 (180° = 2배)
    const tilt = tiltOf(s.angle);
    return { err, tilt, score: partScore(err, this.cfg.allowedError) * (1 - (this.cfg.tiltPenalty * tilt) / (Math.PI / 2)) };
  }

  computeScores() {
    const rows = this.parts.map((p) => {
      const placed = p.status === 'stopped' || p.status === 'moving';
      const r = placed ? this.scoreOf(p) : null;
      return { id: p.id, label: p.label, status: p.status, burnCause: p.burnCause, err: r?.err ?? null, tilt: r?.tilt ?? null, score: r?.score ?? 0 };
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

const NO_BURN = Object.freeze({ burn: null, cushion: false, contactStarted: false, contactTicks: 0 });

const labelOf = (id) => FACE_PARTS.find((p) => p.id === id)?.label ?? id;
