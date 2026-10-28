import { describe, it, expect } from 'vitest';
import { convexHull, grow, centroid, partPolygons, autoCrop, indicesOf } from '../src/maker/geometry.js';
import { boxBlur, dilate, alphaStats, inpaint } from '../src/maker/imageops.js';
import { polygonArea } from '../src/core/shape.js';

describe('geometry', () => {
  it('볼록 껍질은 안쪽 점을 버린다', () => {
    const h = convexHull([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0.5, y: 0.5 }]);
    expect(h).toHaveLength(4);
  });
  it('grow는 중심을 유지하며 커진다', () => {
    const sq = [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 0.6 }, { x: 0.4, y: 0.6 }];
    const g = grow(sq, 2, 1);
    expect(centroid(g)).toEqual(centroid(sq));
    expect(g[1].x - g[0].x).toBeCloseTo(0.4);
    expect(g[2].y - g[1].y).toBeCloseTo(0.2);
  });
  it('왼/오른쪽은 이미지에서의 x 위치로 정한다', () => {
    // 가짜 랜드마크: A 눈은 오른쪽(x 0.7), B 눈은 왼쪽(x 0.3)
    const lm = Array.from({ length: 500 }, () => ({ x: 0.5, y: 0.5 }));
    const ring = (cx, cy, ids) => ids.forEach((id, k) => (lm[id] = { x: cx + 0.03 * Math.cos(k), y: cy + 0.01 * Math.sin(k) }));
    const conn = (ids) => ids.map((id, k) => ({ start: id, end: ids[(k + 1) % ids.length] }));
    ring(0.7, 0.45, [10, 11, 12, 13]);
    ring(0.3, 0.45, [20, 21, 22, 23]);
    ring(0.7, 0.38, [30, 31, 32]);
    ring(0.3, 0.38, [40, 41, 42]);
    ring(0.5, 0.7, [50, 51, 52, 53]);
    ring(0.5, 0.5, [60, 61, 62, 63, 64, 65]);
    lm[60] = { x: 0.2, y: 0.15 };
    lm[61] = { x: 0.8, y: 0.15 };
    lm[62] = { x: 0.8, y: 0.9 };
    lm[63] = { x: 0.2, y: 0.9 };
    const { polygons, tight, faceBox } = partPolygons(lm, {
      eyeA: conn([10, 11, 12, 13]), eyeB: conn([20, 21, 22, 23]),
      browA: conn([30, 31, 32]), browB: conn([40, 41, 42]),
      lips: conn([50, 51, 52, 53]), oval: conn([60, 61, 62, 63]),
    });
    expect(centroid(polygons.left_eye).x).toBeLessThan(0.5);
    expect(centroid(polygons.right_eye).x).toBeGreaterThan(0.5);
    expect(centroid(polygons.left_brow).x).toBeLessThan(0.5);
    expect(faceBox).toMatchObject({ x0: 0.2, x1: 0.8 });
    // 스톤 모양용 윤곽은 지우기 마스크보다 작다
    for (const id of ['left_eye', 'right_eye', 'left_brow', 'right_brow', 'mouth']) expect(polygonArea(tight[id])).toBeLessThan(polygonArea(polygons[id])); // 코는 이 가짜 랜드마크에서 넓이 0
    expect(indicesOf(conn([1, 2, 3]))).toEqual([1, 2, 3]);
  });
  it('autoCrop은 얼굴을 가운데 두는 정사각형', () => {
    const c = autoCrop([{ x: 0.4, y: 0.2 }, { x: 0.6, y: 0.5 }], 1000, 1000);
    expect(c.size).toBeCloseTo(300 * 1.4);
    expect(c.cx).toBeCloseTo(500);
  });
});

describe('imageops', () => {
  const W = 32;
  it('boxBlur는 가장자리를 부드럽게 하고 합을 대략 보존', () => {
    const a = new Uint8ClampedArray(W * W);
    for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) a[y * W + x] = 255;
    const b = boxBlur(a, W, W, 2);
    expect(b[16 * W + 16]).toBe(255);
    expect(b[16 * W + 8]).toBeGreaterThan(80);
    expect(b[16 * W + 8]).toBeLessThan(200);
    const sum = (x) => x.reduce((s, v) => s + v, 0);
    expect(Math.abs(sum(b) - sum(a)) / sum(a)).toBeLessThan(0.02);
  });
  it('dilate는 r만큼 넓힌다', () => {
    const a = new Uint8ClampedArray(W * W);
    a[16 * W + 16] = 200;
    const d = dilate(a, W, W, 3);
    expect(d[16 * W + 19]).toBe(200);
    expect(d[16 * W + 20]).toBe(0);
  });
  it('alphaStats 무게중심', () => {
    const a = new Uint8ClampedArray(W * W);
    for (let y = 4; y < 8; y++) for (let x = 20; x < 24; x++) a[y * W + x] = 255;
    const s = alphaStats(a, W, W);
    expect(s.anchor.x).toBeCloseTo(22 / W);
    expect(s.anchor.y).toBeCloseTo(6 / W);
    expect(s.box).toEqual({ x0: 20, y0: 4, x1: 24, y1: 8 });
    expect(alphaStats(new Uint8ClampedArray(W * W), W, W)).toBeNull();
  });
  it('inpaint: 마스크 안이 주변의 밝기 기울기를 따라 채워지고, 바깥은 그대로', () => {
    const rgba = new Uint8ClampedArray(W * W * 4);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const v = 60 + x * 4; // 왼쪽 어둡고 오른쪽 밝음
      rgba.set([v, v, v, 255], (y * W + x) * 4);
    }
    const mask = new Uint8ClampedArray(W * W);
    for (let y = 10; y < 22; y++) for (let x = 10; x < 22; x++) {
      mask[y * W + x] = 255;
      rgba.set([255, 0, 0, 255], (y * W + x) * 4); // 지울 빨간 눈
    }
    const out = inpaint(rgba, mask, W, W, { noise: 0 });
    const at = (x, y, c = 0) => out[(y * W + x) * 4 + c];
    expect(at(12, 16, 1)).toBeGreaterThan(80); // 빨강이 사라짐 (G가 0이 아님)
    expect(Math.abs(at(12, 16) - at(12, 16, 1))).toBeLessThan(6); // 회색
    expect(at(20, 16)).toBeGreaterThan(at(11, 16)); // 기울기 유지
    expect(at(2, 2)).toBe(rgba[(2 * W + 2) * 4]); // 마스크 밖은 그대로
  });

  it('inpaint: 색을 가져올 픽셀(source)만 쓰고, 일부만 허용해도 채운 색이 어두워지지 않는다', () => {
    // 왼쪽 절반 = 피부색, 오른쪽 절반 = 검은 머리카락. 가운데 구멍은 피부에서만 색을 가져와야 한다
    const rgba = new Uint8ClampedArray(W * W * 4);
    const source = new Uint8ClampedArray(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const skin = x < W / 2;
      rgba.set(skin ? [220, 180, 160, 255] : [20, 20, 20, 255], (y * W + x) * 4);
      source[y * W + x] = skin ? 255 : 0;
    }
    const mask = new Uint8ClampedArray(W * W);
    for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) mask[y * W + x] = 255;
    const out = inpaint(rgba, mask, W, W, { noise: 0, source });
    const at = (x, y, c) => out[(y * W + x) * 4 + c];
    expect(at(16, 16, 0)).toBeGreaterThan(210);
    expect(at(16, 16, 1)).toBeGreaterThan(170);
    expect(at(16, 16, 2)).toBeGreaterThan(150);
  });
});
