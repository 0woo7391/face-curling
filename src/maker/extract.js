// 사진 → 게임용 얼굴 데이터 (명세 3.2~3.4, 6.2).
//   크롭(1:1, N×N) → 부위 마스크(자동 + 손 보정) → 빈 얼굴(채우기) → 부위 스티커(흰 테두리, 방향 A)
import { FACE_PARTS } from '../core/board.js';
import { boxBlur, dilate, alphaStats, inpaint } from './imageops.js';
import { radialOutline } from '../core/shape.js';

export const N = 512; // 크롭 해상도

export function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d', { willReadFrequently: true }); // 픽셀을 자주 읽으므로 CPU 쪽 캔버스로
  return c;
}

/** 원본에서 정사각 영역을 N×N으로. 사진 밖은 중간 회색 */
export function cropTo(source, crop, size = N) {
  const c = canvas(size);
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, crop.cx - crop.size / 2, crop.cy - crop.size / 2, crop.size, crop.size, 0, 0, size, size);
  return c;
}

/** 다각형(q) → 경계가 부드러운 알파 마스크 */
export function polygonMask(poly, size = N, feather = 3) {
  const c = canvas(size);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath();
  poly.forEach((p, i) => (i ? g.lineTo(p.x * size, p.y * size) : g.moveTo(p.x * size, p.y * size)));
  g.closePath();
  g.fill();
  const d = g.getImageData(0, 0, size, size).data;
  const a = new Uint8ClampedArray(size * size);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return boxBlur(a, size, size, feather);
}

/** 붓으로 마스크 칠하기/지우기 (부드러운 원) */
export function brush(alpha, size, x, y, radius, erase) {
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= size || py >= size) continue;
      const d = Math.hypot(dx, dy) / radius;
      if (d > 1) continue;
      const f = Math.min(1, (1 - d) * 2.5) * 255; // 가장자리만 부드럽게
      const i = py * size + px;
      alpha[i] = erase ? Math.min(alpha[i], 255 - f) : Math.max(alpha[i], f);
    }
  }
}

/**
 * 빈 얼굴: 부위 마스크 합을 넓혀 딱 잘라 지우고 주변 피부로 채운 뒤, 더 넓은 범위를 강하게 흐린다.
 * - 지우는 구멍은 경계가 딱딱해야 한다: 부드러운 경계면 속눈썹·눈썹 끝 어두운 픽셀이 채우기에 섞여 회색 얼룩이 된다.
 * - 바깥 띠까지 흐려야 눈가 주름·콧대 그림자 같은 남은 선이 사라지고 "지운 자리"가 확실히 보인다.
 */
export function makeEmptyFace(crop, masks) {
  const size = crop.width;
  const union = new Uint8ClampedArray(size * size);
  for (const m of Object.values(masks)) for (let i = 0; i < union.length; i++) union[i] = Math.max(union[i], m[i]);
  const hole = dilate(threshold(union, 16), size, size, Math.round(size * 0.02));
  const g = crop.getContext('2d');
  const img = g.getImageData(0, 0, size, size);
  const filled = inpaint(img.data, hole, size, size, { noise: 0 });
  // 흐림 띠: 구멍보다 넓게, 경계는 길게 풀어 준다
  const zone = boxBlur(dilate(hole, size, size, Math.round(size * 0.03)), size, size, Math.round(size * 0.03));
  const soft = blurRGB(filled, size, size, Math.round(size * 0.025));
  const out = new Uint8ClampedArray(filled.length);
  for (let i = 0; i < size * size; i++) {
    const k = zone[i] / 255;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = filled[i * 4 + c] * (1 - k) + soft[i * 4 + c] * k;
    out[i * 4 + 3] = 255;
  }
  const c = canvas(size);
  c.getContext('2d').putImageData(new ImageData(out, size, size), 0, 0);
  return c;
}

const threshold = (a, t) => a.map((v) => (v > t ? 255 : 0));

/** RGBA의 RGB만 박스 블러를 두 번 (가우시안에 가깝게) */
function blurRGB(rgba, w, h, r) {
  const out = Uint8ClampedArray.from(rgba);
  const ch = new Uint8ClampedArray(w * h);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < w * h; i++) ch[i] = rgba[i * 4 + c];
    const b = boxBlur(boxBlur(ch, w, h, r), w, h, r);
    for (let i = 0; i < w * h; i++) out[i * 4 + c] = b[i];
  }
  return out;
}

/**
 * 부위 스티커: 사진 조각 + 흰 다이컷 테두리. 결과 화면에서 실제 크기로 붙인다 (명세 3.10, 5.3).
 * @returns {{canvas, rect:{x,y,w,h}, anchor:{x,y}}} rect·anchor는 q 좌표. anchor = 마스크 무게중심 = 채점 기준점
 */
export function makeSticker(crop, alpha, border = 5) {
  const size = crop.width;
  const st = alphaStats(alpha, size, size);
  if (!st) return null;
  const m = border + 3;
  const x0 = Math.max(0, st.box.x0 - m);
  const y0 = Math.max(0, st.box.y0 - m);
  const x1 = Math.min(size, st.box.x1 + m);
  const y1 = Math.min(size, st.box.y1 + m);
  const w = x1 - x0;
  const h = y1 - y0;
  const outline = boxBlur(dilate(alpha, size, size, border), size, size, 1);
  const src = crop.getContext('2d').getImageData(x0, y0, w, h).data;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y + y0) * size + (x + x0);
      const a = alpha[i] / 255;
      const o = outline[i] / 255;
      const j = (y * w + x) * 4;
      // 흰 테두리 위에 사진 조각을 얹는다
      for (let c = 0; c < 3; c++) out[j + c] = src[j + c] * a + 255 * (1 - a);
      out[j + 3] = Math.max(a, o) * 255;
    }
  }
  const c = canvas(w, h);
  c.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
  return { canvas: c, rect: { x: x0 / size, y: y0 / size, w: w / size, h: h / size }, anchor: st.anchor };
}

/**
 * 스티커 윤곽 (흰 테두리 포함) = 스톤 모양. 앵커 기준 q 차이 [{x, y}]
 * 저장된 얼굴에는 윤곽을 따로 저장하지 않고 불러올 때 스티커에서 다시 만든다.
 */
export function stickerOutline(sticker, size = N) {
  const { canvas: c, rect, anchor } = sticker;
  const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  const inside = (x, y) => {
    const px = Math.floor(x);
    const py = Math.floor(y);
    return px >= 0 && py >= 0 && px < c.width && py < c.height && data[(py * c.width + px) * 4 + 3] > 127;
  };
  const cx = (anchor.x - rect.x) * size;
  const cy = (anchor.y - rect.y) * size;
  return radialOutline(inside, cx, cy, Math.hypot(c.width, c.height)).map((p) => ({ x: p.x / size, y: p.y / size }));
}

/** 원위치 재합성 (명세 3.4-5): 빈 얼굴 위에 부위 조각을 원래 자리에 — 원본과 비교용 */
export function recomposite(empty, crop, masks) {
  const size = crop.width;
  const c = canvas(size);
  const g = c.getContext('2d');
  g.drawImage(empty, 0, 0);
  const top = g.getImageData(0, 0, size, size);
  const src = crop.getContext('2d').getImageData(0, 0, size, size).data;
  for (const m of Object.values(masks)) {
    for (let i = 0; i < m.length; i++) {
      const a = m[i] / 255;
      if (!a) continue;
      for (let k = 0; k < 3; k++) top.data[i * 4 + k] = top.data[i * 4 + k] * (1 - a) + src[i * 4 + k] * a;
    }
  }
  g.putImageData(top, 0, 0);
  return c;
}

/**
 * 게임이 쓰는 얼굴 데이터
 * @param tight 부위별 실제 윤곽 마스크 — 스티커·스톤 모양은 (손으로 다듬은) 지우기 마스크와 이것이 겹치는 부분만 쓴다
 */
export function buildFace(crop, masks, faceBox, tight) {
  const empty = makeEmptyFace(crop, masks);
  const parts = {};
  for (const p of FACE_PARTS) {
    const s = makeSticker(crop, masks[p.id].map((v, i) => Math.min(v, tight[p.id][i])));
    if (s) parts[p.id] = { ...s, outline: stickerOutline(s) };
  }
  return { crop, empty, parts, faceBox };
}
