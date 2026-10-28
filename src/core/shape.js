// 부위 모양 스톤 (실제 크기). 브라우저와 무관한 순수 함수라 Node에서 테스트한다.
//
// 좌표
//   outline: 앵커(채점 기준점) 기준 q 차이 {x, y} — 이미지 방향 (y 아래)
//   shape:   앵커 기준 로컬 월드 좌표(m) {x, y} — 각도 0 = 얼굴이 똑바로 (y+ = 이마 쪽 = 레인 진행 방향)
// 회전 각도는 월드 기준 반시계 +. 스톤의 회전값 spin + (위에서 볼 때 시계)은 각속도 −.
import { convexHull } from '../maker/geometry.js';

export { convexHull };

export const rotate = (p, a) => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** 각도 angle로 놓인 모양이 중심에서 방향 (ux, uy)로 뻗은 거리 (지지 함수) */
export function support(poly, angle, ux, uy) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let best = -Infinity;
  for (const p of poly) best = Math.max(best, (p.x * c - p.y * s) * ux + (p.x * s + p.y * c) * uy);
  return best;
}

/**
 * 스톤 중심에서 방향 (ux, uy)로의 가장자리 거리. 모양이 없는 스톤(테스트용 원형)은 cfg.stoneRadius.
 * 번드·스위핑·이탈 판정이 공용 반지름 대신 쓴다.
 */
export function stoneExtent(stone, ux, uy, cfg) {
  return stone.hull ? support(stone.hull, stone.angle ?? 0, ux, uy) : cfg.stoneRadius;
}

/** 볼록 다각형 두 개(월드 좌표)의 분리 거리. 음수 = 겹침 (분리축 정리) */
export function separation(A, B) {
  let best = -Infinity;
  for (const [P, Q] of [[A, B], [B, A]]) {
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      const b = P[(i + 1) % P.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-9) continue;
      const nx = (b.y - a.y) / len;
      const ny = -(b.x - a.x) / len;
      let pMin = Infinity;
      let pMax = -Infinity;
      let qMin = Infinity;
      let qMax = -Infinity;
      for (const p of P) {
        const d = p.x * nx + p.y * ny;
        pMin = Math.min(pMin, d);
        pMax = Math.max(pMax, d);
      }
      for (const q of Q) {
        const d = q.x * nx + q.y * ny;
        qMin = Math.min(qMin, d);
        qMax = Math.max(qMax, d);
      }
      best = Math.max(best, qMin - pMax, pMin - qMax);
    }
  }
  return best;
}

/**
 * 앵커에서 광선을 쏴서 마스크의 가장 먼 안쪽 점을 잇는 윤곽 (앵커가 마스크 안에 있는 별 모양 가정 — 부위 마스크는 볼록 다각형 기반).
 * @param inside (x, y) => boolean, 픽셀 좌표
 * @returns 앵커 기준 픽셀 차이 [{x, y}], 반시계(이미지에서 보면 시계) 순서
 */
export function radialOutline(inside, cx, cy, maxR, rays = 40) {
  const pts = [];
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let far = 0.5;
    for (let r = 0.5; r <= maxR; r += 0.5) if (inside(cx + dx * r, cy + dy * r)) far = r;
    pts.push({ x: dx * far, y: dy * far });
  }
  return pts;
}

/** 기본(가상) 얼굴의 부위 윤곽 — q 차이. 눈·입 = 타원, 눈썹 = 아치, 코 = 아래가 넓은 물방울 */
export function defaultOutline(part, n = 32) {
  const { kind, w, h } = part.shape;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    let x = (c * w) / 2;
    let y = (s * h) / 2;
    if (kind === 'brow') y -= (h * 0.9 * (1 - (2 * x) / w) * (1 + (2 * x) / w)) / 2; // 가운데가 위로 솟은 아치
    else if (kind === 'nose') x *= 0.35 + 0.65 * ((s + 1) / 2); // 위(콧대)는 좁고 아래(콧망울)는 넓게
    pts.push({ x, y });
  }
  return pts;
}

/**
 * 얼굴 부위들의 실제 크기 스톤 모양을 만든다. 정답 자리끼리 겹치는 부위만 줄인다 (fitShapeScales).
 * @param parts [{id, q, outline}] outline = q 차이
 * @param rect  사진 스티커 사각형 (q) — 윗면 그림의 위치. 없으면 모양의 테두리 상자
 * @returns {scale: 가장 많이 줄인 배율, shapes: Map<id, {shape, hull, radius, texRect, scale}>}
 */
export function buildShapes(parts, board, cfg) {
  const B = board.size;
  const base = parts.map((p) => {
    const shape = p.outline.map((o) => ({ x: o.x * B, y: -o.y * B }));
    return { p, shape, hull: convexHull(shape) };
  });
  const scales = fitShapeScales(base.map((b) => ({ hull: b.hull, at: board.qToWorld(b.p.q) })), cfg.layoutMargin, cfg.minShapeScale);
  const shapes = new Map();
  base.forEach(({ p, shape, hull }, i) => {
    const scale = scales[i];
    const k = (v) => ({ x: v.x * scale, y: v.y * scale });
    const sh = shape.map(k);
    const hu = hull.map(k);
    const radius = Math.max(...hu.map((v) => Math.hypot(v.x, v.y)));
    let texRect;
    if (p.rect) {
      texRect = {
        x0: (p.rect.x - p.q.x) * B * scale,
        y0: -(p.rect.y + p.rect.h - p.q.y) * B * scale,
        w: p.rect.w * B * scale,
        h: p.rect.h * B * scale,
      };
    } else {
      const xs = sh.map((v) => v.x);
      const ys = sh.map((v) => v.y);
      texRect = { x0: Math.min(...xs), y0: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    shapes.set(p.id, { shape: sh, hull: hu, radius, texRect, scale });
  });
  return { scale: Math.min(...scales), shapes };
}

/**
 * 부위별 배율 (1 이하, minScale 이상): 정답 자리에서 margin보다 가까운 쌍만 둘 다 조금씩 줄이기를 반복한다.
 * 안 겹치는 부위(예: 입)는 실제 크기 그대로.
 */
export function fitShapeScales(items, margin, minScale = 0.3) {
  const k = items.map(() => 1);
  const placed = (i) => items[i].hull.map((v) => ({ x: items[i].at.x + v.x * k[i], y: items[i].at.y + v.y * k[i] }));
  for (let iter = 0; iter < 200; iter++) {
    let changed = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (separation(placed(i), placed(j)) >= margin) continue;
        for (const n of [i, j]) {
          if (k[n] > minScale) {
            k[n] = Math.max(minScale, k[n] * 0.98);
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }
  return k;
}

/** 똑바로(0)에서 벗어난 각도 (0..π) */
export function tiltOf(angle) {
  const a = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return a > Math.PI ? 2 * Math.PI - a : a;
}
