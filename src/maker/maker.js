// 얼굴 만들기 화면 (명세 3.2~3.5): 사진 → 자르기 → 부위 다듬기 → 빈 얼굴 → 플레이.
// 세로 화면 기준. 손가락·마우스 모두 Pointer Events로 처리한다.
import { FACE_PARTS } from '../core/board.js';
import { detectFace, loadLandmarker, CONNECTIONS } from './faceModel.js';
import { partPolygons, autoCrop } from './geometry.js';
import { N, canvas, cropTo, polygonMask, brush, buildFace, recomposite } from './extract.js';

const STEPS = ['사진', '자르기', '다듬기', '빈 얼굴'];
const MAX_SRC = 1600; // 검출용 원본 최대 변

export class FaceMaker {
  constructor(root, { onDone, onReset, hasFace, layoutWarnings }) {
    this.root = root;
    this.onDone = onDone;
    this.onReset = onReset;
    this.hasFace = hasFace;
    this.layoutWarnings = layoutWarnings;
    this.consent = false;
    root.innerHTML = `
      <header><button data-act="close" aria-label="닫기">✕</button><ol class="mk-steps">${STEPS.map((s) => `<li>${s}</li>`).join('')}</ol></header>
      <div class="mk-view"><canvas width="${N}" height="${N}"></canvas><div class="mk-msg" hidden></div></div>
      <div class="mk-tools"></div>
      <footer class="mk-foot"></footer>
      <input type="file" accept="image/*" hidden />`;
    this.view = root.querySelector('canvas');
    this.g = this.view.getContext('2d');
    this.msg = root.querySelector('.mk-msg');
    this.tools = root.querySelector('.mk-tools');
    this.foot = root.querySelector('.mk-foot');
    this.file = root.querySelector('input[type=file]');
    root.querySelector('[data-act=close]').addEventListener('click', () => this.close());
    this.file.addEventListener('change', () => this.file.files[0] && this.loadPhoto(this.file.files[0]));
    this.bindPointer();
  }

  open() {
    this.root.hidden = false;
    loadLandmarker().catch(() => {}); // 미리 받아 두기
    this.goPick();
  }

  close() {
    this.root.hidden = true;
  }

  setStep(i) {
    this.stepIdx = i;
    [...this.root.querySelectorAll('.mk-steps li')].forEach((li, k) => {
      li.classList.toggle('on', k === i);
      li.classList.toggle('done', k < i);
    });
  }

  say(text, kind = '') {
    this.msg.hidden = !text;
    this.msg.textContent = text ?? '';
    this.msg.dataset.kind = kind;
  }

  // ── 1. 사진 ──

  goPick() {
    this.setStep(0);
    this.mode = 'pick';
    this.say('');
    this.g.fillStyle = '#26344a';
    this.g.fillRect(0, 0, N, N);
    this.g.fillStyle = '#9fb0c2';
    this.g.font = 'bold 30px system-ui, sans-serif';
    this.g.textAlign = 'center';
    this.g.fillText('정면 얼굴 사진 한 장', N / 2, N / 2 - 10);
    this.g.font = '22px system-ui, sans-serif';
    this.g.fillText('사진은 이 기기 안에서만 처리돼요', N / 2, N / 2 + 30);
    this.tools.innerHTML = `<label class="mk-consent"><input type="checkbox" ${this.consent ? 'checked' : ''} /> 사진 속 사람에게 허락받았어요</label>`;
    const box = this.tools.querySelector('input');
    box.addEventListener('change', () => {
      this.consent = box.checked;
      pick.disabled = !this.consent;
    });
    this.foot.innerHTML = `${this.hasFace() ? '<button data-act="reset">기본 얼굴로</button>' : ''}<button class="primary" data-act="pick">📷 사진 고르기</button>`;
    const pick = this.foot.querySelector('[data-act=pick]');
    pick.disabled = !this.consent;
    pick.addEventListener('click', () => {
      this.file.value = '';
      this.file.click();
    });
    this.foot.querySelector('[data-act=reset]')?.addEventListener('click', () => {
      this.onReset();
      this.close();
    });
  }

  async loadPhoto(file) {
    this.say('얼굴 찾는 중…', 'busy');
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const k = Math.min(1, MAX_SRC / Math.max(bmp.width, bmp.height));
      const src = canvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
      src.getContext('2d').drawImage(bmp, 0, 0, src.width, src.height);
      const found = await detectFace(src);
      if (!found) {
        this.say('얼굴을 찾지 못했어요. 얼굴이 잘 보이는 정면 사진으로 다시 골라 주세요.', 'error');
        return;
      }
      this.src = src;
      const oval = CONNECTIONS.oval.flatMap((c) => [found.landmarks[c.start], found.landmarks[c.end]]);
      this.crop = autoCrop(oval, src.width, src.height);
      this.autoSize = this.crop.size;
      this.goCrop(found.count > 1 ? '얼굴이 여러 개라 가장 큰 얼굴을 골랐어요.' : '');
    } catch (err) {
      this.say(`사진을 처리하지 못했어요 (${err.message})`, 'error');
    }
  }

  // ── 2. 자르기 ──

  goCrop(note = '') {
    this.setStep(1);
    this.mode = 'crop';
    this.say(note);
    this.tools.innerHTML = `<label class="mk-row">확대 <input type="range" min="0.5" max="2" step="0.01" value="${(this.autoSize / this.crop.size).toFixed(2)}" /></label>
      <p class="mk-tip">끌어서 위치, 두 손가락이나 휠로 확대. 얼굴이 가운데 오게.</p>`;
    const zoom = this.tools.querySelector('input');
    zoom.addEventListener('input', () => {
      this.crop.size = this.autoSize / Number(zoom.value);
      this.drawCrop();
    });
    this.zoomInput = zoom;
    this.foot.innerHTML = '<button data-act="back">◀ 다시 고르기</button><button class="primary" data-act="next">다음 ▶</button>';
    this.foot.querySelector('[data-act=back]').addEventListener('click', () => this.goPick());
    this.foot.querySelector('[data-act=next]').addEventListener('click', () => this.confirmCrop());
    this.drawCrop();
  }

  drawCrop() {
    this.g.drawImage(cropTo(this.src, this.crop), 0, 0);
    // 얼굴이 들어갈 대략의 자리
    this.g.strokeStyle = 'rgba(255,255,255,0.6)';
    this.g.setLineDash([10, 8]);
    this.g.lineWidth = 3;
    this.g.beginPath();
    this.g.ellipse(N / 2, N * 0.53, N * 0.3, N * 0.37, 0, 0, Math.PI * 2);
    this.g.stroke();
    this.g.setLineDash([]);
  }

  async confirmCrop() {
    this.say('부위 찾는 중…', 'busy');
    const crop = cropTo(this.src, this.crop, N);
    const found = await detectFace(crop);
    if (!found) {
      this.say('이 범위에서는 얼굴을 찾지 못했어요. 조금 넓게 잘라 주세요.', 'error');
      return;
    }
    const { polygons, tight, faceBox } = partPolygons(found.landmarks, CONNECTIONS);
    this.cropCanvas = crop;
    this.faceBox = faceBox;
    this.polygons = polygons;
    this.masks = {};
    this.tightMasks = {};
    for (const p of FACE_PARTS) {
      this.masks[p.id] = polygonMask(polygons[p.id]);
      this.tightMasks[p.id] = polygonMask(tight[p.id]);
    }
    this.undo = [];
    this.current = 'left_brow';
    this.erase = false;
    this.brushSize = 10;
    this.goEdit();
  }

  // ── 3. 다듬기 ──

  goEdit() {
    this.setStep(2);
    this.mode = 'edit';
    this.say('');
    this.tools.innerHTML = `
      <div class="mk-parts">${FACE_PARTS.map((p) => `<button data-part="${p.id}" style="--c:${p.color}">${p.label}</button>`).join('')}</div>
      <div class="mk-row">
        <div class="mk-seg"><button data-tool="paint">칠하기</button><button data-tool="erase">지우기</button></div>
        <label>붓 <input type="range" min="3" max="30" step="1" value="${this.brushSize}" /></label>
        <button data-act="undo" aria-label="되돌리기">↶</button>
        <button data-act="auto">자동</button>
      </div>`;
    this.tools.querySelectorAll('[data-part]').forEach((b) => b.addEventListener('click', () => {
      this.current = b.dataset.part;
      this.refreshEditTools();
      this.drawEdit();
    }));
    this.tools.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
      this.erase = b.dataset.tool === 'erase';
      this.refreshEditTools();
    }));
    this.tools.querySelector('input[type=range]').addEventListener('input', (e) => (this.brushSize = Number(e.target.value)));
    this.tools.querySelector('[data-act=undo]').addEventListener('click', () => {
      const u = this.undo.pop();
      if (u) {
        this.masks[u.id] = u.alpha;
        this.drawEdit();
      }
    });
    this.tools.querySelector('[data-act=auto]').addEventListener('click', () => {
      this.pushUndo();
      this.masks[this.current] = polygonMask(this.polygons[this.current]);
      this.drawEdit();
    });
    this.foot.innerHTML = '<button data-act="back">◀ 자르기</button><button class="primary" data-act="next">빈 얼굴 만들기 ▶</button>';
    this.foot.querySelector('[data-act=back]').addEventListener('click', () => this.goCrop());
    this.foot.querySelector('[data-act=next]').addEventListener('click', () => this.goEmpty());
    this.refreshEditTools();
    this.drawEdit();
  }

  refreshEditTools() {
    this.tools.querySelectorAll('[data-part]').forEach((b) => b.classList.toggle('on', b.dataset.part === this.current));
    this.tools.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', (b.dataset.tool === 'erase') === this.erase));
  }

  pushUndo() {
    this.undo.push({ id: this.current, alpha: Uint8ClampedArray.from(this.masks[this.current]) });
    if (this.undo.length > 20) this.undo.shift();
  }

  /** 사진 위에 부위별 색으로 마스크를 겹쳐 보여준다. 마스크 밖은 어둡게, 고른 부위는 진하게 + 흰 윤곽선 */
  drawEdit() {
    const base = this.cropCanvas.getContext('2d').getImageData(0, 0, N, N);
    const d = base.data;
    const any = new Uint8ClampedArray(N * N);
    for (const p of FACE_PARTS) {
      const m = this.masks[p.id];
      for (let i = 0; i < m.length; i++) if (m[i] > any[i]) any[i] = m[i];
    }
    for (let i = 0; i < any.length; i++) {
      const k = 0.45 + 0.55 * (any[i] / 255);
      d[i * 4] *= k;
      d[i * 4 + 1] *= k;
      d[i * 4 + 2] *= k;
    }
    for (const p of FACE_PARTS) {
      const m = this.masks[p.id];
      const on = p.id === this.current;
      const k = on ? 0.5 : 0.25;
      const c = [parseInt(p.color.slice(1, 3), 16), parseInt(p.color.slice(3, 5), 16), parseInt(p.color.slice(5, 7), 16)];
      for (let i = 0; i < m.length; i++) {
        if (!m[i]) continue;
        const a = (m[i] / 255) * k;
        d[i * 4] = d[i * 4] * (1 - a) + c[0] * a;
        d[i * 4 + 1] = d[i * 4 + 1] * (1 - a) + c[1] * a;
        d[i * 4 + 2] = d[i * 4 + 2] * (1 - a) + c[2] * a;
      }
      if (!on) continue;
      // 윤곽선: 알파가 절반을 넘는 곳과 아닌 곳의 경계
      for (let y = 1; y < N - 1; y++) {
        for (let x = 1; x < N - 1; x++) {
          const i = y * N + x;
          const inside = m[i] >= 128;
          if (inside && (m[i - 1] < 128 || m[i + 1] < 128 || m[i - N] < 128 || m[i + N] < 128)) {
            d[i * 4] = 255;
            d[i * 4 + 1] = 255;
            d[i * 4 + 2] = 255;
          }
        }
      }
    }
    this.g.putImageData(base, 0, 0);
  }

  // ── 4. 빈 얼굴 ──

  goEmpty() {
    this.setStep(3);
    this.mode = 'empty';
    this.say('빈 얼굴 만드는 중…', 'busy');
    this.tools.innerHTML = '';
    this.foot.innerHTML = '';
    // 화면이 먼저 바뀌도록 한 프레임 쉬고 계산
    setTimeout(() => {
      this.face = buildFace(this.cropCanvas, this.masks, this.faceBox, this.tightMasks);
      this.recomp = recomposite(this.face.empty, this.cropCanvas, this.masks);
      const warns = this.layoutWarnings(this.face);
      this.say(warns.length ? warns.join(' ') : '', warns.length ? 'warn' : '');
      this.tools.innerHTML = `<div class="mk-seg wide"><button data-show="empty">빈 얼굴</button><button data-show="orig">원본</button><button data-show="recomp">다시 붙이기</button></div>`;
      this.tools.querySelectorAll('[data-show]').forEach((b) => b.addEventListener('click', () => this.show(b.dataset.show)));
      this.foot.innerHTML = '<button data-act="back">◀ 다듬기</button><button class="primary" data-act="play">이 얼굴로 플레이 ▶</button>';
      this.foot.querySelector('[data-act=back]').addEventListener('click', () => this.goEdit());
      this.foot.querySelector('[data-act=play]').addEventListener('click', () => {
        this.onDone(this.face);
        this.close();
      });
      this.show('empty');
    }, 30);
  }

  show(which) {
    const img = which === 'orig' ? this.cropCanvas : which === 'recomp' ? this.recomp : this.face.empty;
    this.g.drawImage(img, 0, 0);
    this.tools.querySelectorAll('[data-show]').forEach((b) => b.classList.toggle('on', b.dataset.show === which));
  }

  // ── 포인터: 자르기(끌기·확대), 다듬기(붓) ──

  bindPointer() {
    const pts = new Map();
    const toN = (e) => {
      const r = this.view.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * N, y: ((e.clientY - r.top) / r.height) * N, scale: N / r.width };
    };
    this.view.addEventListener('pointerdown', (e) => {
      this.view.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, toN(e));
      if (this.mode === 'edit') {
        this.pushUndo();
        this.paint(toN(e));
      }
    });
    this.view.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = toN(e);
      const prev = pts.get(e.pointerId);
      if (this.mode === 'crop') {
        if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          const before = Math.hypot(a.x - b.x, a.y - b.y);
          pts.set(e.pointerId, p);
          const [c, d] = [...pts.values()];
          const after = Math.hypot(c.x - d.x, c.y - d.y);
          if (before > 10) this.zoomBy(before / after);
          return;
        }
        const k = this.crop.size / N;
        this.crop.cx -= (p.x - prev.x) * k;
        this.crop.cy -= (p.y - prev.y) * k;
        this.drawCrop();
      } else if (this.mode === 'edit') {
        // 빠르게 그어도 끊기지 않게 사이를 채운다
        const steps = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / (this.brushSize / 2)));
        for (let i = 1; i <= steps; i++) this.paint({ x: prev.x + ((p.x - prev.x) * i) / steps, y: prev.y + ((p.y - prev.y) * i) / steps }, false);
        this.scheduleEditDraw();
      }
      pts.set(e.pointerId, p);
    });
    const up = (e) => pts.delete(e.pointerId);
    this.view.addEventListener('pointerup', up);
    this.view.addEventListener('pointercancel', up);
    this.view.addEventListener('wheel', (e) => {
      if (this.mode !== 'crop') return;
      e.preventDefault();
      this.zoomBy(Math.exp(e.deltaY * 0.001));
    }, { passive: false });
  }

  zoomBy(f) {
    this.crop.size = Math.min(this.autoSize * 2, Math.max(this.autoSize / 2, this.crop.size * f));
    if (this.zoomInput) this.zoomInput.value = (this.autoSize / this.crop.size).toFixed(2);
    this.drawCrop();
  }

  paint(p, redraw = true) {
    brush(this.masks[this.current], N, p.x, p.y, this.brushSize, this.erase);
    if (redraw) this.scheduleEditDraw();
  }

  scheduleEditDraw() {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      this.drawEdit();
    });
  }
}
