// 사진 → 게임용 얼굴 데이터 (명세 3.2~3.4, 6.2).
//   크롭(1:1, N×N) → 부위 마스크(자동 + 손 보정) → 빈 얼굴(채우기) → 부위 스티커(테두리 없음)
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
 * 빈 얼굴. 얼굴 만들기 마지막 단계에서 두 가지 중 고른다.
 * - 'blur' 흐리게: 지우기 마스크(손 보정 포함)를 조금 넓혀 채우고, 그 둘레를 얼굴 윤곽 안에서만 흐린다.
 *   흔적이 거의 안 남는 대신 가운데가 흐림 덩어리가 된다.
 * - 'clean' 깔끔하게: 실제 부위 윤곽만(눈은 눈꺼풀 주름까지, 코는 콧대 그림자까지 조금 더) 지워 채우고 경계만 살짝 흐린다.
 *   얼굴이 잘 남는 대신 지운 자리가 매끈한 패치로 보인다.
 * 공통:
 * - 지우는 구멍은 경계가 딱딱해야 한다: 부드러운 경계면 속눈썹·눈썹 끝 어두운 픽셀이 채우기에 섞여 회색 얼룩이 된다.
 * - 채울 색은 얼굴 윤곽 안의 피부색 픽셀에서만 가져온다: 배경·머리카락·그림자가 섞이면 채운 자리가 회색이 된다.
 * - 부위 밖의 아주 어두운 픽셀(앞머리 등)은 지우지도 흐리지도 않는다.
 * - 볼에서 찾은 매끈한 피부 조각의 잔결을 채운 자리에 입혀 플라스틱처럼 보이지 않게 한다.
 * @param opts {tight: 부위별 실제 윤곽 마스크, faceMask: 얼굴 윤곽 마스크, style: 'blur' | 'clean'}
 */
export function makeEmptyFace(crop, masks, { tight, faceMask, style = 'blur' }) {
  const S = crop.width;
  const px = (f) => Math.max(1, Math.round(S * f));
  const src = crop.getContext('2d').getImageData(0, 0, S, S).data;
  const lum = (i) => 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];

  // 머리카락: 부위(눈동자·콧구멍·입술선 포함) 밖에서 이 사진의 피부보다 훨씬 어둡고(피부 평균 밝기의 절반 미만) 색이 옅은 픽셀
  const partZone = dilate(unionOf(tight, S), S, S, px(0.02));
  let skinSum = 0;
  let skinN = 0;
  for (let i = 0; i < S * S; i++) {
    if (faceMask[i] > 128 && !partZone[i]) {
      skinSum += lum(i);
      skinN++;
    }
  }
  const hairLum = skinN ? (skinSum / skinN) * 0.5 : 55;
  const hairRaw = new Uint8ClampedArray(S * S);
  // 채도도 낮아야 머리카락 (검정·회색). 피부 주름·그림자는 어두워도 색이 있다
  const sat = (i) => {
    const r = src[i * 4];
    const g = src[i * 4 + 1];
    const b = src[i * 4 + 2];
    const mx = Math.max(r, g, b);
    return mx ? (mx - Math.min(r, g, b)) / mx : 0;
  };
  for (let i = 0; i < S * S; i++) hairRaw[i] = lum(i) < hairLum && sat(i) < 0.35 && !partZone[i] ? 255 : 0;
  const hair = boxBlur(hairRaw, S, S, 2);

  const hole =
    style === 'clean'
      ? unionOf(tight, S, { all: 0.008, left_eye: 0.022, right_eye: 0.022, nose: 0.012 })
      : dilate(unionOf(masks, S), S, S, px(0.012));
  // 머리카락이나 얼굴 윤곽 밖(앞머리 끝 등)은 지우지 않는다 — 피부색으로 채우면 머리카락에 네모난 홈이 생긴다
  for (let i = 0; i < S * S; i++) if (hairRaw[i] || faceMask[i] < 128) hole[i] = 0;

  // 채울 색을 가져올 피부: 얼굴 윤곽 안, 머리카락·지울 부위 아님, 너무 어둡거나(그림자) 밝지(반사) 않음
  const source = new Uint8ClampedArray(S * S);
  for (let i = 0; i < S * S; i++) {
    const l = lum(i);
    source[i] = faceMask[i] > 128 && !hairRaw[i] && !partZone[i] && l > 60 && l < 245 ? 255 : 0;
  }
  const filled = inpaint(src, hole, S, S, { noise: 0, source });

  const zr = style === 'clean' ? 0.008 : 0.01;
  const zone = boxBlur(dilate(hole, S, S, px(zr)), S, S, px(zr));
  const soft = blurRGB(filled, S, S, px(style === 'clean' ? 0.005 : 0.009));
  const tex = skinPatch(src, S, faceMask, dilate(unionOf(masks, S), S, S, 12));
  const out = new Uint8ClampedArray(filled.length);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const k = (zone[i] / 255) * (faceMask[i] / 255) * (1 - hair[i] / 255);
      const t = Math.max(k, hole[i] / 255);
      // 잔결은 반만 — 모공·주근깨가 많은 피부에서 반복 무늬가 점박이로 보이지 않게
      for (let c = 0; c < 3; c++) out[i * 4 + c] = filled[i * 4 + c] * (1 - k) + soft[i * 4 + c] * k + (tex ? tex(x, y, c) * t * 0.5 : 0);
      out[i * 4 + 3] = 255;
    }
  }
  const c = canvas(S);
  c.getContext('2d').putImageData(new ImageData(out, S, S), 0, 0);
  return c;
}

/** 부위별 마스크의 합 (0/255). grow: 부위별로 더 넓힐 비율 (all = 기본) */
function unionOf(masks, S, grow = {}) {
  const u = new Uint8ClampedArray(S * S);
  for (const [id, a] of Object.entries(masks)) {
    const r = Math.round(S * (grow[id] ?? grow.all ?? 0));
    const d = dilate(threshold(a, 16), S, S, r);
    for (let i = 0; i < u.length; i++) u[i] = Math.max(u[i], d[i]);
  }
  return u;
}

/**
 * 피부 잔결: 얼굴 안에서 부위와 겹치지 않는 가장 매끈한 48px 조각을 찾아, (원본 − 흐린 원본)을 거울 타일로 돌려준다.
 * 찾지 못하면 null.
 */
function skinPatch(src, S, faceMask, avoid) {
  const P = 48;
  const fine = blurRGB(src, S, S, 3);
  let best = null;
  for (let y = 0; y + P < S; y += 8) {
    for (let x = 0; x + P < S; x += 8) {
      let ok = true;
      let e = 0;
      for (let j = 0; j < P && ok; j += 4) {
        for (let i = 0; i < P; i += 4) {
          const k = (y + j) * S + x + i;
          if (avoid[k] || faceMask[k] < 250) {
            ok = false;
            break;
          }
          e += Math.abs(src[k * 4] - fine[k * 4]);
        }
      }
      if (ok && (!best || e < best.e)) best = { x, y, e };
    }
  }
  if (!best) return null;
  const refl = (v) => {
    const p = v % (2 * P);
    return p < P ? p : 2 * P - 1 - p;
  };
  return (x, y, c) => {
    const q = ((best.y + refl(y)) * S + best.x + refl(x)) * 4 + c;
    return src[q] - fine[q];
  };
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
 * 부위 스티커: 마스크대로 오려 낸 사진 조각 (흰 테두리 없음 — 결과 화면에서 빛나 보이지 않게). 결과 화면에서 실제 크기로 붙인다 (명세 3.10, 5.3).
 * @returns {{canvas, rect:{x,y,w,h}, anchor:{x,y}}} rect·anchor는 q 좌표. anchor = 마스크 무게중심 = 채점 기준점
 */
export function makeSticker(crop, alpha) {
  const size = crop.width;
  const st = alphaStats(alpha, size, size);
  if (!st) return null;
  const m = 3;
  const x0 = Math.max(0, st.box.x0 - m);
  const y0 = Math.max(0, st.box.y0 - m);
  const x1 = Math.min(size, st.box.x1 + m);
  const y1 = Math.min(size, st.box.y1 + m);
  const w = x1 - x0;
  const h = y1 - y0;
  const src = crop.getContext('2d').getImageData(x0, y0, w, h).data;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y + y0) * size + (x + x0);
      const j = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) out[j + c] = src[j + c];
      out[j + 3] = alpha[i];
    }
  }
  const c = canvas(w, h);
  c.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
  return { canvas: c, rect: { x: x0 / size, y: y0 / size, w: w / size, h: h / size }, anchor: st.anchor };
}

/**
 * 스티커 윤곽 = 스톤 모양. 앵커 기준 q 차이 [{x, y}]
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
export function buildFace(crop, masks, faceBox, tight, faceMask, style = 'blur') {
  const empty = makeEmptyFace(crop, masks, { tight, faceMask, style });
  const parts = {};
  for (const p of FACE_PARTS) {
    const s = makeSticker(crop, masks[p.id].map((v, i) => Math.min(v, tight[p.id][i])));
    if (s) parts[p.id] = { ...s, outline: stickerOutline(s) };
  }
  return { crop, empty, parts, faceBox };
}
