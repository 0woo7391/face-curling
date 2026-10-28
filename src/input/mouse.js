// 마우스·포인터 입력 (명세 3.7, 3.8).
// 투구(THROW): 새총 — 아무 곳이나 누른 채 아래로 당기면 반대 방향이 투구 방향, 당긴 길이가 파워. 놓으면 발사.
//              손가락·마우스 모두 Pointer Events + setPointerCapture (캔버스 밖에서 놓아도 처리).
// 스위핑
//   보조 켬(기본): 버튼을 누른 채(= 빗자루를 얼음에 댐) 좌우로 흔들기. 방향이 바뀔 때마다 한 번 쓸기,
//                  손의 좌우 위치대로 빗자루가 스톤 앞에서 움직인다 (터치와 같은 동작). 마우스 잠금 없음.
//   보조 끔(v1.2): Pointer Lock + movementX/Y로 월드 고정 목표점 이동, 좌클릭 밀기 → 우클릭 당기기.
//                  버튼은 mousedown + e.button으로 받는다 — 다른 버튼을 누른 채 추가로 누르면 pointerdown이 오지 않기 때문.
import { SwipeStrokeDetector, HandTracker } from './swipe.js';

const SWEEP_STATES = new Set(['SWEEP', 'SETTLING']);
const AIM_SCALE = 0.5; // 당기는 각도 대비 투구 각도 — 작은 각도를 정밀하게
const SCRUB_THRESHOLD = 10; // 흔들기 한 번으로 치는 최소 이동(px) — 손 떨림 무시
const HAND_RANGE = 40; // 이만큼(px) 흔들면 빗자루가 끝까지

export class MouseInput {
  constructor(canvas, game, renderer) {
    this.canvas = canvas;
    this.game = game;
    this.renderer = renderer;
    this.drag = null;
    this.scrub = null;
    this.locked = false;
    this.lockErrors = 0;
    this.forceAbsolute = false;
    this.pointerType = 'mouse'; // 마지막 pointerdown의 종류 — 기기가 아니라 실제 입력으로 모드를 정한다
    this.suspended = false; // 홈·일시정지 중
    this.unsupported = !('requestPointerLock' in canvas);

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', () => this.interrupt());
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    // 우클릭 메뉴는 게임 캔버스에서만 차단. contextmenu 시점은 OS마다 달라서 스트로크 판정에 쓰지 않는다.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    document.addEventListener('pointerlockerror', () => this.onLockError());
    window.addEventListener('blur', () => this.interrupt());
    document.addEventListener('visibilitychange', () => document.hidden && this.interrupt());
  }

  get touchMode() {
    return this.pointerType === 'touch';
  }

  get assist() {
    return !!this.game.cfg.sweepAssist;
  }

  /** 직접 이동 모드에서 Pointer Lock을 못 쓰면 레인 탑다운 + 절대 좌표 (명세 3.8.1 대체 모드) */
  get fallback() {
    return !this.assist && !this.touchMode && (this.unsupported || this.forceAbsolute || this.lockErrors >= 2);
  }

  get sweeping() {
    return !this.suspended && SWEEP_STATES.has(this.game.state);
  }

  get needsLock() {
    return this.sweeping && !this.assist && !this.touchMode && !this.fallback && !this.locked;
  }

  onPointerDown(e) {
    this.pointerType = e.pointerType;
    if (this.suspended) return;
    if (this.game.state === 'THROW' && e.button === 0) {
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
      this.game.setThrow(this.game.aimAngle, 0);
    } else if (this.sweeping && this.assist && e.pointerType === 'mouse') {
      this.canvas.setPointerCapture(e.pointerId);
      this.scrub = { id: e.pointerId, det: new SwipeStrokeDetector(SCRUB_THRESHOLD), hand: new HandTracker(HAND_RANGE) };
      this.scrub.det.start(e.clientX);
      this.scrub.hand.start(e.clientX);
    }
  }

  onPointerMove(e) {
    if (this.drag && e.pointerId === this.drag.id) {
      // 새총: 아래로 당길수록 세게, 당긴 반대 방향으로. 위로 밀면 파워 0 (놓으면 취소)
      const dx = e.clientX - this.drag.x0;
      const dy = e.clientY - this.drag.y0;
      if (dy <= 4) {
        this.game.setThrow(this.game.aimAngle, 0);
        return;
      }
      const pull = Math.hypot(dx, dy) / (this.canvas.clientHeight * this.game.cfg.maxPullFraction);
      this.game.setThrow(Math.atan2(-dx, dy) * AIM_SCALE, pull);
    } else if (this.scrub && e.pointerId === this.scrub.id) {
      this.game.enqueue({ type: 'hand', x: this.scrub.hand.move(e.clientX) });
      const s = this.scrub.det.move(e.clientX);
      if (s) this.game.enqueue({ type: 'press', button: s === 'push' ? 0 : 2 });
    }
  }

  onPointerUp(e) {
    if (this.scrub && e.pointerId === this.scrub.id) {
      this.scrub = null; // 버튼을 떼면 빗자루가 들린다
      this.game.enqueue({ type: 'hand', x: 0 });
    }
    if (!this.drag || e.pointerId !== this.drag.id) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.game.release() && e.pointerType === 'mouse' && !this.assist) this.requestLock();
  }

  /** 직접 이동 모드: 좌클릭 밀기 / 우클릭 당기기 */
  onMouseDown(e) {
    if (!this.sweeping || this.touchMode || this.assist) return;
    e.preventDefault();
    if (this.needsLock) {
      this.requestLock(); // 재개 클릭은 스트로크로 세지 않는다
      return;
    }
    this.game.enqueue({ type: 'press', button: e.button });
  }

  onMouseMove(e) {
    if (!this.sweeping || this.touchMode || this.assist) return;
    if (this.locked) this.game.enqueue({ type: 'move', dx: e.movementX, dy: e.movementY });
    else if (this.fallback) {
      const p = this.renderer.screenToGround(e.clientX, e.clientY);
      if (p) this.game.enqueue({ type: 'moveAbs', x: p.x, y: p.y });
    }
  }

  async requestLock() {
    if (this.fallback || this.locked) return;
    try {
      // unadjustedMovement: OS 마우스 가속 제외 (미지원 브라우저는 예외 → 일반 요청)
      await this.canvas.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try {
        await this.canvas.requestPointerLock();
      } catch {
        this.onLockError();
      }
    }
  }

  onLockChange() {
    this.locked = document.pointerLockElement === this.canvas;
    if (this.locked) this.lockErrors = 0;
  }

  onLockError() {
    this.lockErrors++;
  }

  interrupt() {
    // 당기던 중에 끊기면 발사하지 않는다
    if (this.drag) this.game.setThrow(this.game.aimAngle, 0);
    this.drag = null;
    this.scrub = null;
  }

  /** 매 프레임: 스위핑이 끝나면 잠금 해제 */
  update() {
    if (!this.sweeping && this.locked) document.exitPointerLock();
    if (this.suspended) this.interrupt();
  }
}
