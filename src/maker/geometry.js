// 랜드마크 → 부위 다각형 (명세 3.3). 브라우저와 무관한 순수 함수라 Node에서 테스트한다.
// 좌표는 모두 1:1 크롭 이미지 기준 정규화 q (0..1, y 아래).

/** MediaPipe 연결 목록 [{start,end}] → 고유 랜드마크 번호 */
export const indicesOf = (connections) => [...new Set(connections.flatMap((c) => [c.start, c.end]))];

// 코는 MediaPipe가 연결 목록을 주지 않아 직접 고른다: 콧망울·콧구멍·코끝 중심, 콧대 위쪽은 제외 (명세 3.4: 코 마스크는 좁게)
export const NOSE_INDICES = [195, 5, 4, 1, 2, 98, 97, 326, 327, 64, 294, 48, 278, 219, 439, 129, 358];

export function convexHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function centroid(poly) {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

/** 중심 기준으로 가로·세로를 늘리고 여백(pad, q 단위)을 더한다 */
export function grow(poly, sx, sy, pad = 0) {
  const c = centroid(poly);
  return poly.map((p) => {
    const dx = (p.x - c.x) * sx;
    const dy = (p.y - c.y) * sy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: c.x + dx + (dx / len) * pad, y: c.y + dy + (dy / len) * pad };
  });
}

export function bbox(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * 6개 부위 다각형. 왼/오른쪽은 MediaPipe 이름(피사체 기준)이 아니라 이미지에서의 x 위치로 정한다 (명세 3.3 [제안]: 이미지 기준).
 * @param lm  랜드마크 [{x,y}] (q 좌표)
 * @param C   { eyeA, eyeB, browA, browB, lips, oval } MediaPipe 연결 목록
 */
export function partPolygons(lm, C) {
  const hull = (idx) => convexHull(idx.map((i) => lm[i]));
  const byX = (a, b) => (centroid(a).x <= centroid(b).x ? [a, b] : [b, a]);
  const [eyeL, eyeR] = byX(hull(indicesOf(C.eyeA)), hull(indicesOf(C.eyeB)));
  const [browL, browR] = byX(hull(indicesOf(C.browA)), hull(indicesOf(C.browB)));
  const face = bbox(indicesOf(C.oval).map((i) => lm[i]));
  const s = face.x1 - face.x0; // 얼굴 폭 기준 여백
  return {
    polygons: {
      left_brow: grow(browL, 1.08, 1.6, s * 0.012),
      right_brow: grow(browR, 1.08, 1.6, s * 0.012),
      left_eye: grow(eyeL, 1.25, 1.9, s * 0.012),
      right_eye: grow(eyeR, 1.25, 1.9, s * 0.012),
      nose: grow(hull(NOSE_INDICES), 1.12, 1.08, s * 0.01),
      mouth: grow(hull(indicesOf(C.lips)), 1.12, 1.25, s * 0.012),
    },
    faceBox: face,
  };
}

/** 원본 이미지 정규화 좌표의 얼굴 테두리 → 정사각 자르기 (원본 픽셀) */
export function autoCrop(ovalPts, srcW, srcH, zoom = 1.4) {
  const b = bbox(ovalPts.map((p) => ({ x: p.x * srcW, y: p.y * srcH })));
  const size = Math.max(b.x1 - b.x0, b.y1 - b.y0) * zoom;
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 - size * 0.03, size };
}
