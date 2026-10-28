// 픽셀 연산 (마스크 경계 부드럽게, 넓히기, 빈 얼굴 채우기). 타입 배열만 다루는 순수 함수.

/** 분리형 박스 블러 (알파 1채널) */
export function boxBlur(src, w, h, r) {
  if (r < 1) return Uint8ClampedArray.from(src);
  const tmp = new Float32Array(w * h);
  const out = new Uint8ClampedArray(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / n;
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** 원형에 가까운 팽창(최댓값 필터): 가로·세로 분리 후 한 번 더 대각 보정 없이 사각 근사 */
export function dilate(src, w, h, r) {
  const tmp = new Uint8ClampedArray(w * h);
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, src[y * w + k]);
      tmp[y * w + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, tmp[k * w + x]);
      out[y * w + x] = m;
    }
  }
  return out;
}

/** 알파 가중 무게중심과 테두리 상자 (정규화 0..1). 알파가 없으면 null */
export function alphaStats(alpha, w, h, threshold = 32) {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha[y * w + x];
      if (a < threshold) continue;
      sx += x * a;
      sy += y * a;
      sw += a;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (!sw) return null;
  return { anchor: { x: (sx / sw + 0.5) / w, y: (sy / sw + 0.5) / h }, box: { x0, y0, x1: x1 + 1, y1: y1 + 1 } };
}

/**
 * 빈 얼굴 채우기: 마스크(255 = 지울 곳) 안을 주변 픽셀로 채우는 다중 해상도 푸시-풀.
 * 평균색 + 전체 블러보다 주변 밝기 변화를 따라가지만, 결은 만들지 못하므로 약한 잡음을 더한다 (명세 3.4).
 * @param source 채울 색을 가져와도 되는 픽셀 (0..255, 없으면 전부). 배경·머리카락을 빼야 채운 자리가 회색이 되지 않는다
 */
export function inpaint(rgba, mask, w, h, { noise = 3, seed = 1, source = null } = {}) {
  // 레벨 0: 알려진 픽셀(가중치 1)과 모르는 픽셀(0)
  const levels = [];
  let cw = w;
  let ch = h;
  let col = new Float32Array(w * h * 3);
  let wt = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const k = (1 - mask[i] / 255) * (source ? source[i] / 255 : 1);
    wt[i] = k;
    col[i * 3] = rgba[i * 4] * k;
    col[i * 3 + 1] = rgba[i * 4 + 1] * k;
    col[i * 3 + 2] = rgba[i * 4 + 2] * k;
  }
  levels.push({ w: cw, h: ch, col, wt });
  // 푸시: 절반 해상도로 가중 평균
  while (cw > 1 || ch > 1) {
    const nw = Math.max(1, cw >> 1);
    const nh = Math.max(1, ch >> 1);
    const ncol = new Float32Array(nw * nh * 3);
    const nwt = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let a = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(cw - 1, x * 2 + dx);
            const sy = Math.min(ch - 1, y * 2 + dy);
            const j = sy * cw + sx;
            a += wt[j];
            r += col[j * 3];
            g += col[j * 3 + 1];
            b += col[j * 3 + 2];
          }
        }
        const i = y * nw + x;
        nwt[i] = a / 4;
        ncol[i * 3] = r / 4;
        ncol[i * 3 + 1] = g / 4;
        ncol[i * 3 + 2] = b / 4;
      }
    }
    cw = nw;
    ch = nh;
    col = ncol;
    wt = nwt;
    levels.push({ w: cw, h: ch, col, wt });
  }
  // 풀: 거친 레벨에서 정규화된 색을 받아 비어 있는 만큼 채운다
  let up = null;
  for (let L = levels.length - 1; L >= 0; L--) {
    const { w: lw, h: lh, col: lc, wt: lwt } = levels[L];
    const res = new Float32Array(lw * lh * 3);
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        const i = y * lw + x;
        let r = 0;
        let g = 0;
        let b = 0;
        if (up) {
          // 쌍선형 업샘플
          const ux = Math.min(up.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
          const uy = Math.min(up.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
          const x0 = Math.floor(ux);
          const y0 = Math.floor(uy);
          const x1 = Math.min(up.w - 1, x0 + 1);
          const y1 = Math.min(up.h - 1, y0 + 1);
          const fx = ux - x0;
          const fy = uy - y0;
          for (let c = 0; c < 3; c++) {
            const v00 = up.res[(y0 * up.w + x0) * 3 + c];
            const v10 = up.res[(y0 * up.w + x1) * 3 + c];
            const v01 = up.res[(y1 * up.w + x0) * 3 + c];
            const v11 = up.res[(y1 * up.w + x1) * 3 + c];
            const v = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
            if (c === 0) r = v;
            else if (c === 1) g = v;
            else b = v;
          }
        }
        // 가장 거친 레벨(up 없음)은 섞을 아래 색이 없으므로 알려진 색을 그대로 쓴다 — 0(검정)과 섞으면 채운 자리가 어두워진다
        const a = up ? Math.min(1, lwt[i]) : 1;
        const known = lwt[i] > 1e-6;
        const kr = known ? lc[i * 3] / lwt[i] : 0;
        const kg = known ? lc[i * 3 + 1] / lwt[i] : 0;
        const kb = known ? lc[i * 3 + 2] / lwt[i] : 0;
        res[i * 3] = known ? kr * a + r * (1 - a) : r;
        res[i * 3 + 1] = known ? kg * a + g * (1 - a) : g;
        res[i * 3 + 2] = known ? kb * a + b * (1 - a) : b;
      }
    }
    up = { w: lw, h: lh, res };
  }
  // 결과: 마스크 안만 바꾸고, 약한 잡음으로 평평한 얼룩을 줄인다
  const out = Uint8ClampedArray.from(rgba);
  let s = seed >>> 0 || 1;
  const rand = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
  for (let i = 0; i < w * h; i++) {
    const m = mask[i] / 255;
    if (m <= 0) continue;
    const n = rand() * noise;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = rgba[i * 4 + c] * (1 - m) + (up.res[i * 3 + c] + n) * m;
  }
  return out;
}
