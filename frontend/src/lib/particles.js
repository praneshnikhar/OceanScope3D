import * as THREE from 'three'

/**
 * GPU particle advection over a 3-D velocity field (u/v currents).
 *
 * Positions live in ping-pong half-float render targets (xyz = world pos,
 * w = normalized life). Each frame an advection pass samples a Data3DTexture
 * carrying (u, v, |vel|) and integrates forward; dead/out-of-domain particles
 * respawn at hashed random locations inside the volume. Rendering draws one
 * point per texel colored by speed and fading with life.
 *
 * World mapping (matches OceanScene):
 *   x = lonFrac * W - W/2      (eastward)
 *   y = -depth_m * DEPTH_SCALE (down, group-scaled)
 *   z = H/2  - latFrac * H     (southward +z)
 */
export class ParticleSystem {
  constructor(renderer, { res = 256, maxAge = 14, speedScale = 14 } = {}) {
    this.renderer = renderer
    this.res = res
    this.maxAge = maxAge
    this.speedScale = speedScale

    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    }
    this.rtA = new THREE.WebGLRenderTarget(res, res, opts)
    this.rtB = new THREE.WebGLRenderTarget(res, res, opts)

    this.simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.simScene = new THREE.Scene()

    this.advectMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uPrev: { value: null },
        uVel: { value: null },
        uRes: { value: new THREE.Vector2(res, res) },
        uDt: { value: 0 },
        uTime: { value: 0 },
        uW: { value: 1 },
        uH: { value: 1 },
        uMaxDepthWorld: { value: 1 },
        uMaxAge: { value: maxAge },
        uSpeedScale: { value: speedScale },
      },
      vertexShader: /* glsl */ `
        void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        precision highp sampler3D;
        layout(location = 0) out highp vec4 outColor;
        uniform sampler2D uPrev;
        uniform sampler3D uVel;
        uniform vec2 uRes;
        uniform float uDt, uTime, uW, uH, uMaxDepthWorld, uMaxAge, uSpeedScale;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7)) + mod(uTime, 100.0)) * 43758.5453);
        }

        void main() {
          vec2 uv = gl_FragCoord.xy / uRes;
          vec4 prev = texture(uPrev, uv);
          vec3 pos = prev.xyz;
          float life = prev.w;

          vec3 uvw = vec3(
            clamp((pos.x + 0.5 * uW) / uW, 0.0, 0.999),
            clamp((0.5 * uH - pos.z) / uH, 0.0, 0.999),
            clamp(-pos.y / uMaxDepthWorld, 0.0, 0.999)
          );
          vec3 vel = texture(uVel, uvw).xyz;

          pos.x += vel.x * uSpeedScale * uDt;
          pos.z += -vel.y * uSpeedScale * uDt;
          life -= uDt / uMaxAge;

          bool outside =
            abs(pos.x) > 0.55 * uW || pos.z < -0.55 * uH || pos.z > 0.55 * uH ||
            pos.y > 1.0 || -pos.y > uMaxDepthWorld * 1.05 || life <= 0.0;

          if (outside || !(life > 0.0)) {
            float h1 = hash(gl_FragCoord.xy);
            float h2 = hash(gl_FragCoord.xy + 17.31);
            float h3 = hash(gl_FragCoord.xy + 43.7);
            pos = vec3(
              (h1 - 0.5) * uW,
              -(h3 * uMaxDepthWorld),
              (0.5 - h2) * uH
            );
            life = mix(0.35, 1.0, h1);
          }
          outColor = vec4(pos, life);
        }
      `,
    })
    this.advectQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.advectMat)
    this.simScene.add(this.advectQuad)

    // -- render pass --------------------------------------------------------
    const n = res * res
    const refs = new Float32Array(n * 2)
    let p = 0
    for (let j = 0; j < res; ++j) {
      for (let i = 0; i < res; ++i) {
        refs[p++] = (i + 0.5) / res
        refs[p++] = (j + 0.5) / res
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3))
    geo.setAttribute('aRef', new THREE.Float32BufferAttribute(refs, 2))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)

    this.pointsMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uPos: { value: null },
        uVel: { value: null },
        uRes: { value: new THREE.Vector2(res, res) },
        uW: { value: 1 },
        uH: { value: 1 },
        uMaxDepthWorld: { value: 1 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: /* glsl */ `
        precision highp float;
        precision highp sampler3D;
        attribute vec2 aRef;
        uniform sampler2D uPos;
        uniform sampler3D uVel;
        uniform vec2 uRes;
        uniform float uW, uH, uMaxDepthWorld, uPixelRatio;
        varying float vLife;
        varying float vSpeed;
        varying float vDepthFrac;

        void main() {
          vec4 P = texture(uPos, aRef);
          vLife = clamp(P.w, 0.0, 1.0);
          vec3 uvw = vec3(
            clamp((P.x + 0.5 * uW) / uW, 0.0, 0.999),
            clamp((0.5 * uH - P.z) / uH, 0.0, 0.999),
            clamp(-P.y / uMaxDepthWorld, 0.0, 0.999)
          );
          vSpeed = texture(uVel, uvw).z;
          vDepthFrac = uvw.z;
          vec4 mv = modelViewMatrix * vec4(P.xyz, 1.0);
          gl_PointSize = (1.6 + 2.2 * vSpeed) * uPixelRatio * (140.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        layout(location = 0) out highp vec4 outColor;
        varying float vLife;
        varying float vSpeed;
        varying float vDepthFrac;

        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          float soft = smoothstep(0.5, 0.05, r);

          vec3 deep = vec3(0.16, 0.42, 0.75);
          vec3 warm = vec3(0.35, 0.95, 0.95);
          vec3 hot = vec3(1.0, 0.85, 0.35);
          vec3 col = vSpeed < 0.5
            ? mix(deep, warm, vSpeed / 0.5)
            : mix(warm, hot, clamp((vSpeed - 0.5) / 1.2, 0.0, 1.0));

          float fade = smoothstep(0.0, 0.18, vLife) * smoothstep(1.0, 0.85, vLife);
          outColor = vec4(col, soft * (0.25 + 0.55 * vSpeed) * fade);
        }
      `,
    })

    this.points = new THREE.Points(geo, this.pointsMat)
    this.points.frustumCulled = false
    this.points.visible = false

    this._time = 0
    this._ready = false
    this.velTex = null
  }

  /** volU/volV: parsed /volume payloads (must share shape). world: {W,H,maxDepthWorld}. */
  setField(volU, volV, world) {
    const [d, la, lo] = volU.shape
    const n = d * la * lo
    const rgba = new Uint16Array(n * 4)
    const hf = THREE.DataUtils.toHalfFloat
    for (let q = 0; q < n; ++q) {
      const u = volU.data[q]
      const v = volV.data[q]
      rgba[q * 4] = hf(Math.max(-9.9, Math.min(9.9, u)))
      rgba[q * 4 + 1] = hf(Math.max(-9.9, Math.min(9.9, v)))
      rgba[q * 4 + 2] = hf(Math.min(9.9, Math.hypot(u, v)))
      rgba[q * 4 + 3] = hf(1)
    }
    if (this.velTex) this.velTex.dispose()
    this.velTex = new THREE.Data3DTexture(rgba, lo, la, d)
    this.velTex.format = THREE.RGBAFormat
    this.velTex.type = THREE.HalfFloatType
    this.velTex.minFilter = THREE.LinearFilter
    this.velTex.magFilter = THREE.LinearFilter
    this.velTex.wrapR = this.velTex.wrapS = this.velTex.wrapT = THREE.ClampToEdgeWrapping
    this.velTex.needsUpdate = true

    for (const m of [this.advectMat.uniforms, this.pointsMat.uniforms]) {
      m.uW.value = world.W
      m.uH.value = world.H
      m.uMaxDepthWorld.value = world.maxDepthWorld
      if (m.uVel) m.uVel.value = this.velTex
    }

    this._seed(world)
    this._ready = true
  }

  _seed(world) {
    const { res } = this
    const seed = new Float32Array(res * res * 4)
    for (let q = 0; q < res * res; ++q) {
      seed[q * 4] = (Math.random() - 0.5) * world.W
      seed[q * 4 + 1] = -Math.random() * world.maxDepthWorld
      seed[q * 4 + 2] = (0.5 - Math.random()) * world.H
      seed[q * 4 + 3] = Math.random()
    }
    const tex = new THREE.DataTexture(seed, res, res, THREE.RGBAFormat, THREE.FloatType)
    tex.needsUpdate = true
    const mat = new THREE.MeshBasicMaterial({ map: tex })
    this.advectQuad.material = mat
    this.renderer.setRenderTarget(this.rtA)
    this.renderer.render(this.simScene, this.simCamera)
    this.renderer.setRenderTarget(this.rtB)
    this.renderer.render(this.simScene, this.simCamera)
    this.renderer.setRenderTarget(null)
    mat.dispose()
    tex.dispose()
    this.advectQuad.material = this.advectMat
  }

  update(dt) {
    if (!this._ready) return
    const u = this.advectMat.uniforms
    this._time += dt
    u.uTime.value = this._time
    u.uDt.value = Math.min(dt, 0.1)
    u.uPrev.value = this.rtA.texture
    this.renderer.setRenderTarget(this.rtB)
    this.renderer.render(this.simScene, this.simCamera)
    this.renderer.setRenderTarget(null)
    ;[this.rtA, this.rtB] = [this.rtB, this.rtA]
    this.pointsMat.uniforms.uPos.value = this.rtA.texture
  }

  dispose() {
    this.rtA.dispose()
    this.rtB.dispose()
    this.advectMat.dispose()
    this.pointsMat.dispose()
    this.points.geometry.dispose()
    if (this.velTex) this.velTex.dispose()
  }
}
