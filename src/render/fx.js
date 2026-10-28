// 이펙트 (비주얼 준비안 5장). 게임 이벤트를 구독하고, 게임 상태는 바꾸지 않는다.
// - 얼음 가루 파티클 (스트로크·발사·충돌)
// - 퍼지는 고리 (충돌·정지·번드)
// - 스톤이 지나간 자국 (스위핑한 구간은 더 밝게)
// - 카메라 펀치 (충돌·발사)
import * as THREE from 'three';

const V = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
const MAX_PARTICLES = 400;
const MAX_RINGS = 16;
const TRAIL_POINTS = 90;

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.punch = 0;

    // 파티클: 작은 상자 하나를 인스턴스로 재사용
    this.pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), MAX_PARTICLES);
    this.pMesh.frustumCulled = false;
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles = [];
    this.dummy = new THREE.Object3D();
    this.pMesh.count = 0;
    scene.add(this.pMesh);

    this.rings = [];
    for (let i = 0; i < MAX_RINGS; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1, 40),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.rings.push({ mesh: m, life: 0 });
    }

    this.trails = new Map(); // stoneId → {mesh, pts:[{x,y,s}]}
    this.trailMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false });
  }

  // ── 생성 ──

  puff(x, y, n, color, { speed = 1.2, up = 1.2, size = 0.035, life = 0.5, dir = null } = {}) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      let vx = Math.cos(a) * sp;
      let vy = Math.sin(a) * sp;
      if (dir) {
        vx = vx * 0.5 + dir.x * sp;
        vy = vy * 0.5 + dir.y * sp;
      }
      this.particles.push({
        x, y, h: 0.03, vx, vy, vh: up * (0.5 + Math.random()),
        life, age: 0, size: size * (0.6 + Math.random() * 0.8), color: c,
      });
    }
  }

  ring(x, y, color, radius, life = 0.45, thick = 0.18) {
    const r = this.rings.find((q) => q.life <= 0) ?? this.rings[0];
    r.life = life;
    r.age = 0;
    r.radius = radius;
    r.thick = thick;
    r.mesh.material.color.set(color);
    r.mesh.position.copy(V(x, y, 0.02));
    r.mesh.visible = true;
  }

  // ── 게임 이벤트 ──

  handle(events, game) {
    for (const e of events) {
      switch (e.type) {
        case 'launch':
          this.puff(e.x, e.y, 14, '#e3f2fd', { speed: 1.6, up: 0.8 });
          this.punch = Math.max(this.punch, 0.12);
          break;
        case 'stroke': {
          // 유효 스트로크: 하얀 얼음 가루가 강도만큼 튐. 무효: 회색 몇 알
          const s = game.currentStone;
          const dir = s ? { x: s.vx / (Math.hypot(s.vx, s.vy) || 1), y: s.vy / (Math.hypot(s.vx, s.vy) || 1) } : null;
          if (e.valid) this.puff(e.x, e.y, 6 + Math.round(16 * e.intensity), '#ffffff', { speed: 1 + 1.5 * e.intensity, up: 1.4, dir });
          else this.puff(e.x, e.y, 3, '#90a4ae', { speed: 0.6, up: 0.6 });
          break;
        }
        case 'contact':
          this.ring(e.x, e.y, '#ff5252', 0.25, 0.25, 0.3);
          break;
        case 'collision': {
          // 큰 스톤끼리 부딪힐수록 고리·가루·화면 흔들림이 크다 (sound.js와 같은 무게 계수)
          const heavy = Math.min(1, Math.max(0, (e.mass ?? 0.1) - 0.05) / 0.15);
          const k = Math.min(1, (e.impulse / 3) * (0.6 + 0.8 * heavy));
          this.ring(e.x, e.y, '#ffffff', (0.4 + 0.6 * k) * (1 + heavy), 0.4);
          this.puff(e.x, e.y, 8 + Math.round(20 * k), '#e1f5fe', { speed: 1.5 + 2 * k, up: 1.6 });
          this.punch = Math.max(this.punch, (0.08 + 0.2 * k) * (1 + 0.8 * heavy));
          break;
        }
        case 'stop':
          this.ring(e.x, e.y, '#b3e5fc', 0.3, 0.35, 0.25);
          break;
        case 'burn':
          this.ring(e.x, e.y, '#ff1744', 1.2, 0.6, 0.12);
          this.puff(e.x, e.y, 18, '#ff8a80', { speed: 2, up: 1.5 });
          this.punch = Math.max(this.punch, 0.25);
          break;
        default:
          break;
      }
    }
  }

  // ── 프레임 ──

  update(dt, game) {
    // 파티클
    const d = this.dummy;
    let n = 0;
    this.particles = this.particles.filter((p) => (p.age += dt) < p.life);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vh -= 6 * dt;
      p.h = Math.max(0.01, p.h + p.vh * dt);
      p.vx *= 0.96;
      p.vy *= 0.96;
      const k = 1 - p.age / p.life;
      d.position.copy(V(p.x, p.y, p.h));
      d.scale.setScalar(p.size * k);
      d.rotation.set(p.age * 7, p.age * 5, 0);
      d.updateMatrix();
      this.pMesh.setMatrixAt(n, d.matrix);
      this.pMesh.setColorAt(n, p.color);
      n++;
    }
    this.pMesh.count = n;
    this.pMesh.instanceMatrix.needsUpdate = true;
    if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;

    // 고리
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        r.life = 0;
        r.mesh.visible = false;
        continue;
      }
      const s = r.radius * (0.3 + 0.7 * Math.sqrt(t));
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = 1 - t;
    }

    this.updateTrails(game);
    this.punch *= Math.exp(-dt * 10);
  }

  updateTrails(game) {
    const cur = game.currentStone;
    const sweepS = game.sweep.intensity;
    for (const s of game.sim.stones.values()) {
      let t = this.trails.get(s.id);
      if (s.status === 'moving') {
        if (!t) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 2 * 3), 3));
          geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 2 * 4), 4));
          const idx = [];
          for (let i = 0; i < TRAIL_POINTS - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
          geo.setIndex(idx);
          const mesh = new THREE.Mesh(geo, this.trailMat);
          mesh.frustumCulled = false;
          this.scene.add(mesh);
          t = { mesh, pts: [] };
          this.trails.set(s.id, t);
        }
        const last = t.pts.at(-1);
        if (!last || Math.hypot(s.x - last.x, s.y - last.y) > 0.12) {
          t.pts.push({ x: s.x, y: s.y, s: s === cur ? sweepS : 0 });
          if (t.pts.length > TRAIL_POINTS) t.pts.shift();
        }
      }
      if (t) this.writeTrail(t, game.cfg.stoneRadius);
    }
    for (const [id, t] of this.trails) {
      const s = game.sim.stones.get(id);
      // 스톤이 사라졌거나 멈춘 뒤에는 자국이 서서히 사라진다
      if (!s || s.status !== 'moving') {
        t.fade = (t.fade ?? 1) - 0.01;
        if (t.fade <= 0) {
          this.scene.remove(t.mesh);
          t.mesh.geometry.dispose();
          this.trails.delete(id);
        }
      }
    }
  }

  writeTrail(t, r) {
    const pos = t.mesh.geometry.attributes.position.array;
    const col = t.mesh.geometry.attributes.color.array;
    const pts = t.pts;
    if (!pts.length) return;
    const fade = t.fade ?? 1;
    const last = pts.length - 1;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const p = pts[Math.min(i, last)];
      const q = pts[Math.min(i + 1, last)];
      const o = pts[Math.min(Math.max(i - 1, 0), last)];
      let dx = q.x - o.x;
      let dy = q.y - o.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const w = r * (0.55 + 0.5 * p.s);
      for (let side = 0; side < 2; side++) {
        const sg = side ? -1 : 1;
        const k = (i * 2 + side) * 3;
        pos[k] = p.x + dy * w * sg;
        pos[k + 1] = 0.006;
        pos[k + 2] = -(p.y - dx * w * sg);
        // 오래된 자국일수록 투명, 스위핑한 구간은 밝은 하늘색
        const age = i < pts.length ? i / pts.length : 0;
        const c = (i * 2 + side) * 4;
        col[c] = 0.55 + 0.25 * p.s;
        col[c + 1] = 0.75 + 0.2 * p.s;
        col[c + 2] = 0.92;
        col[c + 3] = i < pts.length ? age * (0.28 + 0.45 * p.s) * fade : 0;
      }
    }
    t.mesh.geometry.attributes.position.needsUpdate = true;
    t.mesh.geometry.attributes.color.needsUpdate = true;
  }
}
