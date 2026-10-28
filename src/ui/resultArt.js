// 결과 그림 (2D): 빈 얼굴 위에 부위 그림을 멈춘 좌표·각도 그대로 붙인다.
// 3D 스톤 대신 이 그림만 보여 주므로 스톤 모양·원근이 없고, 얼굴 사진 밖에서 멈춘 부위는 그리지 않는다.
import { FACE_BOX } from '../core/board.js';
import { faceBoardTexture, shapeCanvas } from '../render/textures.js';

const POP_DELAY = 0.15; // 부위마다 늦게 붙는 시간 (s)
const POP_TIME = 0.25;
export const RESULT_ART_DURATION = 6 * POP_DELAY + POP_TIME;

let defaultBoard = null;
const shapeImages = new Map();

/**
 * @param canvas 정사각 캔버스
 * @param t      결과 화면이 열린 뒤 지난 시간 (s) — 부위가 하나씩 '착' 붙는다
 */
export function drawResultArt(canvas, game, t) {
  const S = canvas.width;
  const g = canvas.getContext('2d');
  defaultBoard ??= faceBoardTexture(FACE_BOX).image;
  g.clearRect(0, 0, S, S);
  g.drawImage(game.face ? game.face.empty : defaultBoard, 0, 0, S, S);
  const B = game.board.size;
  game.parts.forEach((p, i) => {
    const s = game.sim.stones.get(p.id);
    if (!s || (p.status !== 'stopped' && p.status !== 'moving')) return;
    const q = game.board.worldToQ(s);
    if (q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1) return; // 얼굴 사진 밖
    const k = Math.min(1, Math.max(0, (t - i * POP_DELAY) / POP_TIME));
    if (k <= 0) return;
    const pop = k < 1 ? 1.25 - 0.25 * k : 1;
    const img = game.face?.parts[p.id]?.canvas ?? shapeImage(p);
    // texRect: 스톤 윗면 그림의 자리 (앵커 기준 로컬 m, y 위) → 그림 좌표 (q, y 아래)
    const r = p.texRect;
    const w = (r.w / B) * S;
    const h = (r.h / B) * S;
    g.save();
    g.translate(q.x * S, q.y * S);
    g.rotate(-s.angle); // 월드 반시계 + = 그림(y 아래)에서는 반대 방향
    g.translate(((r.x0 + r.w / 2) / B) * S, (-(r.y0 + r.h / 2) / B) * S);
    g.scale(pop * k, pop * k);
    g.drawImage(img, -w / 2, -h / 2, w, h);
    g.restore();
  });
}

function shapeImage(p) {
  if (!shapeImages.has(p.id) || shapeImages.get(p.id).part !== p.texRect) shapeImages.set(p.id, { part: p.texRect, img: shapeCanvas(p) });
  return shapeImages.get(p.id).img;
}
