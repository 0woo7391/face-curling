// Rapier 2D 래퍼 (명세 5.1). 충돌·반발은 Rapier, 감속·곡률·스위핑은 curling.js.
// Rapier 설정 원칙: 중력 0, 선형 감쇠 0, 마찰 0.
// 스톤은 부위 모양(볼록 껍질 충돌체)이고 자유롭게 돈다. 던질 때 준 회전은 첫 충돌 전까지 진행 거리에 비례해 돌리고,
// 충돌 뒤에는 Rapier가 준 회전을 각 감쇠로 줄인다. 모양이 없으면(테스트) 반지름 cfg.stoneRadius 원.
import { stepStoneVelocity } from './curling.js';
import { support } from './shape.js';

export class Simulation {
  /** @param shapes Map<id, {hull, radius}> — 없으면 모두 원 */
  constructor(R, cfg, shapes = new Map()) {
    this.R = R;
    this.cfg = cfg;
    this.shapes = shapes;
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

  placeStone(id, x, y, vx = 0, vy = 0, spin = 0, angle = 0) {
    if (this.stones.has(id)) this.removeStone(id);
    const { R, cfg } = this;
    const sh = this.shapes.get(id);
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(x, y)
        .setRotation(angle)
        .setLinvel(vx, vy)
        .setCcdEnabled(true)
        .setLinearDamping(0)
        .setAngularDamping(cfg.angularDamping),
    );
    const hullDesc = sh ? R.ColliderDesc.convexHull(new Float32Array(sh.hull.flatMap((v) => [v.x, v.y]))) : null;
    const collider = this.world.createCollider(
      (hullDesc ?? R.ColliderDesc.ball(cfg.stoneRadius))
        .setRestitution(cfg.restitution)
        .setRestitutionCombineRule(R.CoefficientCombineRule.Max)
        .setFriction(0)
        .setFrictionCombineRule(R.CoefficientCombineRule.Min)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    const moving = vx !== 0 || vy !== 0;
    // driven: 던진 회전대로 도는 중 (첫 충돌 전까지)
    const stone = { id, body, collider, spin, driven: spin !== 0, angle, prevAngle: angle, hull: sh?.hull ?? null, radius: sh?.radius ?? cfg.stoneRadius, status: moving ? 'moving' : 'stopped', idle: 0, x, y, prevX: x, prevY: y, vx, vy };
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
    for (const e of snap) this.placeStone(e.id, e.x, e.y, 0, 0, 0, e.angle);
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
    const ext = (ux, uy) => (s.hull ? support(s.hull, s.angle, ux, uy) : cfg.stoneRadius);
    return s.x + ext(1, 0) > cfg.laneWidth / 2 || s.x - ext(-1, 0) < -cfg.laneWidth / 2 || s.y - ext(0, -1) > cfg.laneLength || s.y < cfg.backLimitY;
  }

  /**
   * 한 고정 틱. @param sweep {id, s, steer} — 스위핑 중인 스톤과 강도·좌우 유도, 없으면 null
   * @returns {{out: string[], hits: {a,b,x,y,impulse}[], stops: string[]}}
   *   out: 경기장을 벗어나 제거된 스톤, hits: 스톤끼리 충돌(접근 상대속도), stops: 이번 틱에 정지한 스톤
   */
  step(sweep) {
    const { cfg } = this;
    const dt = 1 / cfg.tickRate;
    const before = new Map();
    for (const s of this.stones.values()) {
      before.set(s.id, { x: s.vx, y: s.vy });
      s.prevX = s.x;
      s.prevY = s.y;
      s.prevAngle = s.angle;
      const v = s.body.linvel();
      if (v.x === 0 && v.y === 0) continue;
      const mine = sweep && sweep.id === s.id;
      s.body.setLinvel(stepStoneVelocity(v.x, v.y, s.spin, mine ? sweep.s : 0, cfg, dt, mine ? sweep.steer ?? 0 : 0), true);
      // 시계(+spin) = 각속도 −. 진행 거리에 비례하므로 같은 거리를 가면 같은 각도만큼 돈다
      if (s.driven) s.body.setAngvel(-s.spin * cfg.spinTurnRate * Math.hypot(v.x, v.y), true);
    }

    this.world.step(this.events);
    const pairs = [];
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (started && this.byHandle.has(h1) && this.byHandle.has(h2)) {
        this.collisions++;
        const pair = [this.byHandle.get(h1), this.byHandle.get(h2)];
        for (const id of pair) this.stones.get(id).driven = false;
        pairs.push(pair);
      }
    });

    const out = [];
    const stops = [];
    for (const s of this.stones.values()) {
      const t = s.body.translation();
      const v = s.body.linvel();
      s.x = t.x;
      s.y = t.y;
      s.vx = v.x;
      s.vy = v.y;
      s.angle = s.body.rotation();
      const speed = Math.hypot(v.x, v.y);
      if (speed >= cfg.stopSpeed) {
        s.status = 'moving';
        s.idle = 0;
      } else {
        if (speed > 0 || s.body.angvel() !== 0) {
          s.body.setAngvel(0, false);
          s.body.setLinvel({ x: 0, y: 0 }, false);
          s.vx = 0;
          s.vy = 0;
        }
        s.idle++;
        if (s.status === 'moving' && s.idle >= cfg.stopHoldTicks) {
          s.status = 'stopped';
          s.spin = 0;
          s.driven = false;
          stops.push(s.id);
        }
      }
      if (this.isOut(s)) out.push(s.id);
    }
    const hits = pairs.map(([a, b]) => {
      const A = this.stones.get(a);
      const B = this.stones.get(b);
      const va = before.get(a);
      const vb = before.get(b);
      // mass: 환산 질량 (두 스톤 질량의 조화 평균의 절반) — 큰 스톤끼리 부딪힐수록 크다
      const ma = A.body.mass();
      const mb = B.body.mass();
      return { a, b, x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, impulse: Math.hypot(va.x - vb.x, va.y - vb.y), mass: (ma * mb) / (ma + mb) };
    });
    for (const id of out) this.removeStone(id);
    return { out, hits, stops };
  }
}
