// 캔버스로 만드는 POC용 텍스처. 실제 얼굴 이미지는 POC B에서 들어온다.
import * as THREE from 'three';

function finish(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** 빈 얼굴 자리표시자. q 좌표계(1:1, y 아래 = 턱)를 그대로 그린다. */
export function faceBoardTexture(box) {
  const N = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = '#dde7ef';
  g.fillRect(0, 0, N, N);

  const cx = N / 2;
  const cy = ((box.y0 + box.y1) / 2) * N;
  const rx = ((box.x1 - box.x0) / 2) * N;
  const ry = ((box.y1 - box.y0) / 2) * N;
  const ellipse = (x, y, a, b, start = 0, end = Math.PI * 2) => {
    g.beginPath();
    g.ellipse(x, y, a, b, 0, start, end);
    g.fill();
  };

  g.fillStyle = '#4e342e';
  ellipse(cx, cy - ry * 0.12, rx * 1.1, ry * 0.95);
  g.fillStyle = '#efc7a2';
  g.fillRect(cx - rx * 0.33, cy + ry * 0.6, rx * 0.66, N);
  ellipse(cx, cy, rx, ry);
  g.fillStyle = '#4e342e';
  ellipse(cx, cy - ry * 0.55, rx * 0.98, ry * 0.42, Math.PI, Math.PI * 2);
  return finish(c);
}

/**
 * 기본 얼굴 스톤 윗면 그림: 부위 색 모양 + 흰 테두리 + 아이콘. 캔버스 = 모양의 테두리 상자(texRect)
 * shape는 로컬 m 좌표(y 위), 캔버스는 y 아래이므로 뒤집어 그린다. HUD의 부위 그림으로도 쓴다.
 */
export function shapeCanvas(part) {
  const S = 256;
  const { x0, y0, w, h } = part.texRect;
  const k = S / Math.max(w, h);
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(w * k));
  c.height = Math.max(8, Math.round(h * k));
  const g = c.getContext('2d');
  g.fillStyle = part.color;
  g.beginPath();
  part.shape.forEach((p, i) => g[i ? 'lineTo' : 'moveTo']((p.x - x0) * k, (y0 + h - p.y) * k));
  g.closePath();
  g.fill();
  g.lineWidth = 10;
  g.strokeStyle = '#fff';
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${Math.round(Math.min(c.width, c.height) * 0.55)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  g.fillStyle = '#fff';
  g.fillText(part.icon, (-x0) * k, (y0 + h) * k);
  return c;
}

export const shapeTexture = (part) => finish(shapeCanvas(part));

export function labelTexture(text, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 72;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(15,20,30,0.72)';
  g.beginPath();
  g.roundRect(4, 8, 248, 56, 16);
  g.fill();
  g.fillStyle = color;
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 37);
  return finish(c);
}

export function canvasTexture(source) {
  return finish(source);
}
