// Rapier 2D 래퍼 (명세 5.1). 충돌·반발은 Rapier, 감속·곡률·스위핑은 curling.js.
// Rapier 설정 원칙: 중력 0, 감쇠 0, 회전 잠금(시각 회전은 spin에서 따로 계산), 마찰 0.
import { stepStoneVelocity } from './curling.js';

export class Simulation {
  constructor(R, cfg) {
    this.R = R;
    this.cfg = cfg;
    this.world = new R.World({ x: 0, y: 0 });
    this.world.timestep = 1 / cfg.tickRate;
    this.events = new R.EventQueue(true);
    this.stones = new Map();
    this.byHandle = new Map();
    this.collisions = 0;
  }

  free() {
    this.events.free();
    this.world.free();
  }

  placeStone(id, x, y, vx = 0, vy = 0, spin = 0) {
    if (this.stones.has(id)) this.removeStone(id);
    const { R, cfg } = this;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(x, y)
        .setLinvel(vx, vy)
        .lockRotations()
        .setCcdEnabled(true)
        .setLinearDamping(0)
        .setAngularDamping(0),
    );
    const collider = this.world.createCollider(
      R.ColliderDesc.ball(cfg.stoneRadius)
        .setRestitution(cfg.restitution)
        .setRestitutionCombineRule(R.CoefficientCombineRule.Max)
        .setFriction(0)
        .setFrictionCombineRule(R.CoefficientCombineRule.Min)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    const moving = vx !== 0 || vy !== 0;
    const stone = { id, body, collider, spin, angle: 0, status: moving ? 'moving' : 'stopped', idle: 0, x, y, prevX: x, prevY: y, vx, vy };
    this.stones.set(id, stone);
    this.byHandle.set(collider.handle, id);
    return stone;
  }

  removeStone(id) {
    const s = this.stones.get(id);
    if (!s) return;
    this.byHandle.delete(s.collider.handle);
    this.world.removeRigidBody(s.body);
    this.stones.delete(id);
  }

  /** 전체 정지 상태에서만 호출 (체크포인트, 명세 2.5) */
  snapshot() {
    return [...this.stones.values()].map((s) => ({ id: s.id, x: s.x, y: s.y, angle: s.angle }));
  }

  restore(snap) {
    for (const id of [...this.stones.keys()]) this.removeStone(id);
    for (const e of snap) this.placeStone(e.id, e.x, e.y).angle = e.angle;
  }

  movingStones() {
    return [...this.stones.values()].filter((s) => s.status === 'moving');
  }

  isSettled() {
    for (const s of this.stones.values()) if (s.status === 'moving') return false;
    return true;
  }

  isOut(s) {
    const { cfg } = this;
    const r = cfg.stoneRadius;
    return Math.abs(s.x) + r > cfg.laneWidth / 2 || s.y - r > cfg.laneLength || s.y < cfg.backLimitY;
  }

  /**
   * 한 고정 틱. @param sweep {id, s} — 스위핑 중인 스톤과 강도, 없으면 null
   * @returns {{out: string[]}} 이번 틱에 경기장을 벗어나 제거된 스톤
   */
  step(sweep) {
    const { cfg } = this;
    const dt = 1 / cfg.tickRate;
    for (const s of this.stones.values()) {
      s.prevX = s.x;
      s.prevY = s.y;
      const v = s.body.linvel();
      if (v.x === 0 && v.y === 0) continue;
      const si = sweep && sweep.id === s.id ? sweep.s : 0;
      s.body.setLinvel(stepStoneVelocity(v.x, v.y, s.spin, si, cfg, dt), true);
    }

    this.world.step(this.events);
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (started && this.byHandle.has(h1) && this.byHandle.has(h2)) this.collisions++;
    });

    const out = [];
    for (const s of this.stones.values()) {
      const t = s.body.translation();
      const v = s.body.linvel();
      s.x = t.x;
      s.y = t.y;
      s.vx = v.x;
      s.vy = v.y;
      const speed = Math.hypot(v.x, v.y);
      if (speed >= cfg.stopSpeed) {
        s.status = 'moving';
        s.idle = 0;
        s.angle += s.spin * cfg.spinVisualRate * Math.min(1, speed) * dt;
      } else {
        if (speed > 0) {
          s.body.setLinvel({ x: 0, y: 0 }, false);
          s.vx = 0;
          s.vy = 0;
        }
        s.idle++;
        if (s.status === 'moving' && s.idle >= cfg.stopHoldTicks) {
          s.status = 'stopped';
          s.spin = 0;
        }
      }
      if (this.isOut(s)) out.push(s.id);
    }
    for (const id of out) this.removeStone(id);
    return { out };
  }
}
