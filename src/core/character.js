// 스위핑 캐릭터 (명세 3.8.1). 목표점은 월드 고정 [확정 v1.1] — 마우스를 움직일 때만 바뀐다.
// 캐릭터는 제한 속도·가속도로 목표점을 향해 달린다 (순간이동 없음).
// 빗자루 머리는 몸에서 스톤 쪽 가로 방향으로 broomReach만큼 떨어져 있다.

export class Character {
  constructor(cfg) {
    this.cfg = cfg;
    this.reset(0, 0);
  }

  reset(x, y) {
    this.pos = { x, y };
    this.prev = { x, y };
    this.vel = { x: 0, y: 0 };
    this.target = { x, y };
    this.side = -1; // -1: 몸이 스톤 왼쪽 → 빗자루는 몸 오른쪽
    this.assist = { x: 0, y: 0 };
  }

  setTarget(x, y, bounds) {
    this.target.x = Math.min(bounds.x1, Math.max(bounds.x0, x));
    this.target.y = Math.min(bounds.y1, Math.max(bounds.y0, y));
  }

  moveTargetBy(dx, dy, bounds) {
    this.setTarget(this.target.x + dx, this.target.y + dy, bounds);
  }

  /** @param refX 기준 스톤의 x (빗자루 방향 결정), 없으면 null */
  update(dt, refX) {
    const { cfg } = this;
    this.prev = { ...this.pos };
    const tx = this.target.x - this.pos.x;
    const ty = this.target.y - this.pos.y;
    const d = Math.hypot(tx, ty);
    const desiredSpeed = Math.min(cfg.charSpeed, d * 6);
    const dvx = (d > 1e-6 ? (tx / d) * desiredSpeed : 0) - this.vel.x;
    const dvy = (d > 1e-6 ? (ty / d) * desiredSpeed : 0) - this.vel.y;
    const dv = Math.hypot(dvx, dvy);
    const maxDv = cfg.charAccel * dt;
    const k = dv > maxDv ? maxDv / dv : 1;
    this.vel.x += dvx * k;
    this.vel.y += dvy * k;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    if (refX != null) {
      const rel = this.pos.x - refX;
      if (Math.abs(rel) > 0.15 && Math.sign(rel) !== this.side) this.side = Math.sign(rel);
    }
  }

  broomBase() {
    return { x: this.pos.x - this.side * this.cfg.broomReach, y: this.pos.y };
  }
}
