// 터치 조작 (세로 화면 기본). 스위핑 중에만 동작한다.
//   왼쪽 절반: 누른 자리에 생기는 조이스틱 → 월드 고정 목표점 이동
//   오른쪽 절반: 위아래로 문지르기 → 밀기/당기기
// 투구 준비(방향·회전·파워)는 손가락 하나 드래그라 MouseInput의 Pointer Events가 그대로 처리한다.
import { SwipeStrokeDetector } from './swipe.js';

const SWEEP_STATES = new Set(['SWEEP', 'SETTLING']);
const JOY_RADIUS = 56; // CSS px
const EDGE_GUARD = 24; // iOS 왼쪽 가장자리 '뒤로 가기' 스와이프와 겹치지 않게
const SWIPE_THRESHOLD = 14;

export class TouchInput {
  constructor(canvas, game, ui) {
    this.canvas = canvas;
    this.game = game;
    this.ui = ui; // { joyBase, joyKnob, swipeZone }
    this.joy = null;
    this.swipe = null;
    this.detector = new SwipeStrokeDetector(SWIPE_THRESHOLD);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    window.addEventListener('blur', () => this.releaseAll());
  }

  get sweeping() {
    return SWEEP_STATES.has(this.game.state);
  }

  down(e) {
    if (e.pointerType !== 'touch' || !this.sweeping) return;
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const left = e.clientX < rect.left + rect.width / 2;
    if (left && !this.joy && e.clientX > rect.left + EDGE_GUARD) {
      this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
      this.showJoy(e.clientX, e.clientY, 0, 0);
    } else if (!left && !this.swipe) {
      this.swipe = { id: e.pointerId };
      this.canvas.setPointerCapture(e.pointerId);
      this.detector.start(e.clientY);
    }
  }

  move(e) {
    if (this.joy && e.pointerId === this.joy.id) {
      let dx = e.clientX - this.joy.ox;
      let dy = e.clientY - this.joy.oy;
      const len = Math.hypot(dx, dy);
      if (len > JOY_RADIUS) {
        dx *= JOY_RADIUS / len;
        dy *= JOY_RADIUS / len;
      }
      this.game.enqueue({ type: 'joy', x: dx / JOY_RADIUS, y: -dy / JOY_RADIUS });
      this.showJoy(this.joy.ox, this.joy.oy, dx, dy);
    } else if (this.swipe && e.pointerId === this.swipe.id) {
      const stroke = this.detector.move(e.clientY);
      if (stroke) {
        this.game.enqueue({ type: 'press', button: stroke === 'push' ? 0 : 2 });
        this.ui.swipeZone.dataset.flash = stroke;
        clearTimeout(this.flashTimer);
        this.flashTimer = setTimeout(() => delete this.ui.swipeZone.dataset.flash, 120);
      }
    }
  }

  up(e) {
    if (this.joy && e.pointerId === this.joy.id) {
      this.joy = null;
      this.game.enqueue({ type: 'joy', x: 0, y: 0 });
      this.ui.joyBase.hidden = true;
    } else if (this.swipe && e.pointerId === this.swipe.id) {
      this.swipe = null;
    }
  }

  releaseAll() {
    if (this.joy) this.game.enqueue({ type: 'joy', x: 0, y: 0 });
    this.joy = null;
    this.swipe = null;
    this.ui.joyBase.hidden = true;
  }

  showJoy(x, y, dx, dy) {
    const { joyBase, joyKnob } = this.ui;
    joyBase.hidden = false;
    joyBase.style.left = `${x}px`;
    joyBase.style.top = `${y}px`;
    joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** 매 프레임: 스위핑이 끝나면 손가락 상태 정리 */
  update() {
    if (!this.sweeping && (this.joy || this.swipe)) this.releaseAll();
  }
}
