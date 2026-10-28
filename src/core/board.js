// 얼굴 보드 좌표 변환 (명세 6.1). world = boardTransform(q)는 이 파일에서만 수행한다.
//
// 좌표계
//   q:     1:1 크롭 이미지 정규화 좌표. (0,0)=좌상단, y는 아래(턱 방향)로 증가.
//   world: 2D 물리 평면. x=레인 가로(투구자 기준 오른쪽 +), y=레인 진행 방향(+ = 투구자에서 멀어짐).
//
// 보드 방향 [확정 v1.2]: 턱이 투구자 쪽. 이미지 아래(v↑) → world y↓.
// 좌/우 [제안 v1.1]: left_* = 이미지(화면)에서 보이는 왼쪽 → world -x.

// POC A용 가상 평균 얼굴 앵커 (명세 12장 POC A-0). 실측 얼굴이 아님.
// shape: 사진이 없을 때 쓰는 스톤 모양 (q 단위 폭·높이, core/shape.js defaultOutline)
export const FACE_PARTS = Object.freeze([
  { id: 'left_brow', label: '왼눈썹', icon: '〰', side: 'L', color: '#8d6e63', q: { x: 0.335, y: 0.355 }, shape: { kind: 'brow', w: 0.2, h: 0.05 } },
  { id: 'right_brow', label: '오른눈썹', icon: '〰', side: 'R', color: '#a1887f', q: { x: 0.665, y: 0.355 }, shape: { kind: 'brow', w: 0.2, h: 0.05 } },
  { id: 'left_eye', label: '왼눈', icon: '👁', side: 'L', color: '#1e88e5', q: { x: 0.34, y: 0.44 }, shape: { kind: 'eye', w: 0.17, h: 0.085 } },
  { id: 'right_eye', label: '오른눈', icon: '👁', side: 'R', color: '#42a5f5', q: { x: 0.66, y: 0.44 }, shape: { kind: 'eye', w: 0.17, h: 0.085 } },
  { id: 'nose', label: '코', icon: '👃', side: '', color: '#ef6c00', q: { x: 0.5, y: 0.585 }, shape: { kind: 'nose', w: 0.17, h: 0.165 } },
  { id: 'mouth', label: '입', icon: '👄', side: '', color: '#e53935', q: { x: 0.5, y: 0.715 }, shape: { kind: 'mouth', w: 0.28, h: 0.075 } },
]);

// 얼굴 기준 박스 (q 공간) — 채점 정규화용
export const FACE_BOX = Object.freeze({ x0: 0.2, y0: 0.17, x1: 0.8, y1: 0.9 });
export const FACE_DIAGONAL = Math.hypot(FACE_BOX.x1 - FACE_BOX.x0, FACE_BOX.y1 - FACE_BOX.y0);

export function makeBoard(cfg) {
  const B = cfg.boardSize;
  const C = cfg.boardCenterY;
  return {
    size: B,
    centerY: C,
    qToWorld: (q) => ({ x: (q.x - 0.5) * B, y: C + (0.5 - q.y) * B }),
    worldToQ: (p) => ({ x: p.x / B + 0.5, y: 0.5 - (p.y - C) / B }),
  };
}
