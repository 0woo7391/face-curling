// 채점·레이아웃 검사 (명세 6.3, 5.3, 3.5).
// 보드가 1:1이므로 q 공간 = (u,v). 거리는 q 공간에서 계산한다.
import { FACE_DIAGONAL } from './board.js';

/** @param diagonal 얼굴 기준 박스 대각선 (q). 사진 얼굴은 얼굴 윤곽에서, 기본 얼굴은 FACE_DIAGONAL */
export function partError(worldPos, anchorQ, board, diagonal = FACE_DIAGONAL) {
  const q = board.worldToQ(worldPos);
  return Math.hypot(q.x - anchorQ.x, q.y - anchorQ.y) / diagonal;
}

export function partScore(err, allowedError) {
  return Math.min(100, Math.max(0, 100 * (1 - err / allowedError)));
}

function segmentPointDistance(a, b, p) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y);
}

/**
 * ① 정답 동시 배치 가능 여부: r_i + r_j + margin <= d_ij (위반 시 제작 완료 거부 대상)
 * ② 도달 가능성 근사: 발사 지점→목표 직선이 다른 정답 위치의 퍽에 막히는지 (경고만)
 */
export function checkLayout(parts, board, cfg, launch = { x: 0, y: 0 }) {
  const r = cfg.stoneRadius;
  const pts = parts.map((p) => ({ id: p.id, label: p.label, ...board.qToWorld(p.q) }));
  const conflicts = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (2 * r + cfg.layoutMargin > d) conflicts.push({ a: pts[i].id, b: pts[j].id, d });
    }
  }
  const blocked = [];
  for (const t of pts) {
    const by = pts.filter((o) => o !== t && segmentPointDistance(launch, t, o) < 2 * r).map((o) => o.id);
    if (by.length) blocked.push({ target: t.id, by });
  }
  return { conflicts, blocked };
}
