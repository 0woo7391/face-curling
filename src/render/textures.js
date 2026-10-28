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

  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('▼ 턱 · 투구자 쪽', cx, N - 24);
  g.fillText('POC A 가상 평균 얼굴', cx, 48);
  return finish(c);
}

/** 퍽 윗면 데칼: 부위 아이콘. 회전하지 않는다 (명세 3.10: 얼굴 이미지는 정방향) */
export function puckTexture(part) {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = part.color;
  g.beginPath();
  g.arc(N / 2, N / 2, N / 2 - 6, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 10;
  g.strokeStyle = '#fff';
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '110px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  g.fillStyle = '#fff';
  g.fillText(part.icon, N / 2, N / 2 - (part.side ? 18 : 0));
  if (part.side) {
    g.font = 'bold 64px system-ui, sans-serif';
    g.fillText(part.side, N / 2, N / 2 + 72);
  }
  return finish(c);
}

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
