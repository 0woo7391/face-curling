// 번드 스톤 판정 (명세 3.8.2, v1.2).
// 몸: 움직이는 스톤과 겹치면 즉시 번드.
// 빗자루: 세 겹 쿠션 — ① 축소 판정 원 + 쿠션 구간(경고만) ② 자동 회피 보조 ③ 연속 graceTicks 겹침 시에만 번드.
// 정지한 스톤은 판정하지 않는다.
import { broomJudgeRadius } from './sweep.js';
import { stoneExtent } from './shape.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** 스톤 중심에서 점 p 쪽 가장자리까지의 거리 (모양 스톤은 방향마다 다르다) */
function edgeToward(st, p, cfg) {
  const d = dist(st, p) || 1;
  return stoneExtent(st, (p.x - st.x) / d, (p.y - st.y) / d, cfg);
}

export class BurnMonitor {
  constructor(cfg) {
    this.cfg = cfg;
    this.overlap = new Map(); // stoneId → 연속 겹침 틱
  }

  reset() {
    this.overlap.clear();
  }

  /**
   * @param movingStones [{id,x,y}]
   * @returns {{burn: null|{cause:'body'|'broom', stoneId:string}, cushion:boolean, contactStarted:boolean, contactTicks:number}}
   */
  update(body, broom, movingStones) {
    const { cfg } = this;
    const res = { burn: null, cushion: false, contactStarted: false, contactTicks: 0 };
    const seen = new Set();

    for (const st of movingStones) {
      seen.add(st.id);
      if (dist(body, st) < cfg.bodyJudgeRadius + edgeToward(st, body, cfg)) res.burn ??= { cause: 'body', stoneId: st.id };

      const d = dist(broom, st);
      const contact = edgeToward(st, broom, cfg) + broomJudgeRadius(cfg);
      if (d < contact) {
        const n = (this.overlap.get(st.id) ?? 0) + 1;
        this.overlap.set(st.id, n);
        if (n === 1) res.contactStarted = true;
        res.contactTicks = Math.max(res.contactTicks, n);
        if (n >= cfg.graceTicks) res.burn ??= { cause: 'broom', stoneId: st.id };
      } else {
        this.overlap.delete(st.id); // 겹침이 끊기면 즉시 리셋
      }
      if (d < contact + cfg.cushionWidth) res.cushion = true;
    }
    for (const id of this.overlap.keys()) if (!seen.has(id)) this.overlap.delete(id);
    return res;
  }
}

/**
 * 자동 회피 보조: 빗자루가 쿠션에 들어오면 빗자루 접촉점만 스톤 바깥으로 밀어낸다.
 * 속도·변위에 상한이 있어서 빠르게 달려들면 막지 못한다 (완전 클램프 아님).
 * @param assist   현재 보조 변위 {x,y}
 * @param broomRaw 보조 적용 전 빗자루 위치
 * @param stone    가장 가까운 움직이는 스톤 또는 null
 */
export function updateAssist(assist, broomRaw, stone, cfg, dt) {
  const outer = stone ? edgeToward(stone, broomRaw, cfg) + broomJudgeRadius(cfg) + cfg.cushionWidth : 0;
  const step = cfg.assistSpeed * dt;
  let ax = assist.x;
  let ay = assist.y;

  if (stone) {
    const bx = broomRaw.x + ax - stone.x;
    const by = broomRaw.y + ay - stone.y;
    const d = Math.hypot(bx, by);
    if (d < outer && d > 1e-6) {
      const push = Math.min(outer - d, step);
      ax += (bx / d) * push;
      ay += (by / d) * push;
      const len = Math.hypot(ax, ay);
      if (len > cfg.assistMax) {
        ax *= cfg.assistMax / len;
        ay *= cfg.assistMax / len;
      }
      return { x: ax, y: ay };
    }
    // 보조 없이도 쿠션 안이면 현재 변위 유지 (경계에서 떨림 방지)
    if (Math.hypot(broomRaw.x - stone.x, broomRaw.y - stone.y) < outer) return { x: ax, y: ay };
  }
  const len = Math.hypot(ax, ay);
  if (len <= step) return { x: 0, y: 0 };
  return { x: ax * (1 - step / len), y: ay * (1 - step / len) };
}
