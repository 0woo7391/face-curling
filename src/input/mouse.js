// 마우스 입력 (명세 3.7, 3.8.1, 3.8.3).
// 투구 준비: Pointer Events + setPointerCapture (캔버스 밖에서 놓아도 처리).
// 스위핑: Pointer Lock + movementX/Y로 월드 고정 목표점을 상대 이동.
//         버튼은 mousedown + e.button으로 받는다 — 다른 버튼을 누른 채 추가로 누르면 pointerdown이 오지 않기 때문.
import { LAUNCH } from '../core/game.js';

const AIM_STATES = new Set(['AIM', 'SPIN', 'POWER']);
const SWEEP_STATES = new Set(['SWEEP', 'SETTLING']);
const SPIN_FULL_TURN = Math.PI * 1.5; // 이만큼 원을 그리면 spin = ±1

export class MouseInput {
  constructor(canvas, game, renderer) {
    this.canvas = canvas;
    this.game = game;
    this.renderer = renderer;
    this.drag = null;
    this.locked = false;
    this.lockErrors = 0;
    this.forceAbsolute = false;
    this.unsupported = !('requestPointerLock' in canvas);

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', () => (this.drag = null));
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    // 우클릭 메뉴는 게임 캔버스에서만 차단. contextmenu 시점은 OS마다 달라서 스트로크 판정에 쓰지 않는다.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    document.addEventListener('pointerlockerror', () => this.onLockError());
    window.addEventListener('blur', () => this.interrupt());
    document.addEventListener('visibilitychange', () => document.hidden && this.interrupt());
  }

  /** Pointer Lock 미지원·반복 실패·강제 설정 시 레인 탑다운 + 절대 좌표 (명세 3.8.1 대체 모드) */
  get fallback() {
    return this.unsupported || this.forceAbsolute || this.lockErrors >= 3;
  }

  get sweeping() {
    return SWEEP_STATES.has(this.game.state);
  }

  get needsLock() {
    return this.sweeping && !this.fallback && !this.locked;
  }

  onPointerDown(e) {
    if (!AIM_STATES.has(this.game.state) || e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    const st = this.game.state;
    if (st === 'AIM') {
      this.drag = { kind: 'aim' };
      this.aimAt(e);
    } else if (st === 'SPIN') {
      const c = this.renderer.worldToScreen(LAUNCH.x, LAUNCH.y);
      this.drag = { kind: 'spin', cx: c.x, cy: c.y, last: Math.atan2(e.clientY - c.y, e.clientX - c.x) };
    } else {
      this.drag = { kind: 'power', y0: e.clientY };
      this.game.setPower(0);
    }
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'aim') this.aimAt(e);
    else if (d.kind === 'spin') {
      // 화면 y가 아래로 증가하므로 atan2 각도 증가 = 화면 시계 방향 = 위에서 본 시계 방향
      const a = Math.atan2(e.clientY - d.cy, e.clientX - d.cx);
      let delta = a - d.last;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      d.last = a;
      this.game.setSpin(this.game.spin + delta / SPIN_FULL_TURN);
    } else {
      this.game.setPower((e.clientY - d.y0) / (this.canvas.clientHeight * 0.35));
    }
  }

  onPointerUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (d.kind === 'power' && this.game.release()) this.requestLock();
  }

  aimAt(e) {
    const p = this.renderer.screenToGround(e.clientX, e.clientY);
    if (p) this.game.setAimFromPoint(p);
  }

  onMouseDown(e) {
    if (!this.sweeping) return;
    e.preventDefault();
    if (this.needsLock) {
      this.requestLock(); // 재개 클릭은 스트로크로 세지 않는다
      return;
    }
    this.game.enqueue({ type: 'press', button: e.button });
  }

  onMouseMove(e) {
    if (!this.sweeping) return;
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
    this.drag = null; // 스트로크는 누르는 순간만 쓰므로 고착될 누름 상태가 없다
  }

  /** 매 프레임: 스위핑이 끝나면 잠금 해제 */
  update() {
    if (!this.sweeping && this.locked) document.exitPointerLock();
  }
}
