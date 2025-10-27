import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

let scene, camera, renderer
let clock = new THREE.Clock()

let currentSection = 0
let animTriggered = false

let eggRoot
let shellPieces = []
let eggBroken = false
let breakStartTime = 0

let explosionCenter = new THREE.Vector3()
let burstRadiusGlobal = 3.0

let texture1, texture2, texture3, normalMap
let materialUniforms
let sharedEggShaderMaterial

const EGG_SLOW = 5.0
const DUST_SLOW = 5.0
const DNA_SLOW = 2.0

const CRACK_SEPARATE_TIME_BASE = 0.4
const BASE_SPLIT_OFFSET = 1.4
const FINAL_SPREAD_MULT = 5.0
const GRAVITY_BASE = 9.8
const FADE_SPEED_BASE = 0.4
const ROT_BASE_BASE = 0.8

const CRACK_SEPARATE_TIME = CRACK_SEPARATE_TIME_BASE * EGG_SLOW
const GRAVITY = GRAVITY_BASE
const ROT_BASE = ROT_BASE_BASE / EGG_SLOW

const PARTICLE_MAX = 20000
let particleSystem = null
let particleData = null

let particleStartTime = 0
let globalDustBurstDone = false

const EXPLODE_TIME_BASE = 0.45
const HANG_TIME_BASE    = 0.55
const GATHER_TIME_BASE  = 1.3
const FADE_TIME_BASE    = 0.7
const REVEAL_TIME_BASE  = 1.0
const VORTEX_STRENGTH_BASE = 8.0

const EXPLOSION_SLOW_MULT = 2.0

const EXPLODE_TIME = EXPLODE_TIME_BASE * DUST_SLOW * EXPLOSION_SLOW_MULT
const HANG_TIME    = 0.0
const GATHER_TIME  = GATHER_TIME_BASE  * DUST_SLOW
const FADE_TIME    = FADE_TIME_BASE    * DUST_SLOW
const REVEAL_TIME  = REVEAL_TIME_BASE  * DNA_SLOW

const VORTEX_STRENGTH = VORTEX_STRENGTH_BASE
const VORTEX_TILT = new THREE.Vector3(0.3, 1.0, 0.2).normalize()

let dnaMesh
let dnaVisible = false
let dnaParallaxActive = false

const DNA_BASE_SCALE = 0.4
const DNA_CENTER = new THREE.Vector3(0, 5, 10)
const SINGULARITY_POINT = new THREE.Vector3(0, 5, 10)

let dnaTargetRotX = 0
let dnaTargetRotY = 0

init()
animate()

function init() {
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b0b0b)

  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    200
  )
  camera.position.set(0, 5, 25)

  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('eggCanvas'),
    antialias: true
  })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.outputEncoding = THREE.sRGBEncoding
  renderer.shadowMap.enabled = true

  {
    const hemi = new THREE.HemisphereLight(0x444444, 0x0a0a0a, 0.4)
    scene.add(hemi)

    const keyLeft = new THREE.DirectionalLight(0xffffff, 0.45)
    keyLeft.position.set(-12, 6, 8)
    keyLeft.castShadow = true
    scene.add(keyLeft)

    const keyRight = new THREE.DirectionalLight(0xffffff, 0.25)
    keyRight.position.set(12, 4, 10)
    keyRight.castShadow = true
    scene.add(keyRight)

    const topLight = new THREE.DirectionalLight(0xffffff, 0.18)
    topLight.position.set(0, 15, 0)
    scene.add(topLight)
  }

  initEggMaterialAndTextures()
  loadEgg()
  initParticleSystem()
  loadDNAPlane()

  window.addEventListener('resize', onWindowResize)
  window.addEventListener('scroll', onScroll)
  window.addEventListener('mousemove', onMouseMove)
}

function initEggMaterialAndTextures() {
  const loader = new THREE.TextureLoader()

  texture1 = loader.load('/assets/novo/Egg-Diffuse2.png')
  texture2 = loader.load('/assets/novo/Egg-Diffuse1Neon2.png')
  texture3 = loader.load('/assets/novo/Egg-Diffuse3Neon3.png')
  normalMap = loader.load('/assets/novo/egg-Normal.png')

  ;[texture1, texture2, texture3, normalMap].forEach(tex => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.encoding = THREE.sRGBEncoding
  })

  materialUniforms = {
    map1:     { value: texture1 },
    map2:     { value: texture1 },
    mixRatio: { value: 0.0 },
    normalMap:{ value: normalMap }
  }

  sharedEggShaderMaterial = new THREE.ShaderMaterial({
    uniforms: materialUniforms,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map1;
      uniform sampler2D map2;
      uniform float mixRatio;
      uniform sampler2D normalMap;
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vec3 n = normalize(texture2D(normalMap, vUv).rgb * 2.0 - 1.0);
        float light = dot(n, normalize(vec3(0.2, 0.8, 0.6))) * 0.5 + 0.5;
        vec4 base1 = texture2D(map1, vUv);
        vec4 base2 = texture2D(map2, vUv);
        vec4 color = mix(base1, base2, smoothstep(0.0, 1.0, mixRatio));
        gl_FragColor = vec4(color.rgb * light, 1.0);
      }
    `,
    lights: false,
    transparent: true
  })
}

function loadEgg() {
  const loader = new GLTFLoader()
  loader.load('/assets/novo/glancnovojaje.glb', glb => {
    eggRoot = glb.scene

    eggRoot.traverse(obj => {
      if (obj.isMesh) {
        const pieceMat = sharedEggShaderMaterial.clone()
        pieceMat.uniforms = sharedEggShaderMaterial.uniforms
        pieceMat.transparent = true
        pieceMat.depthWrite = true
        pieceMat.opacity = 1.0

        obj.material = pieceMat
        obj.castShadow = true
        obj.receiveShadow = true

        shellPieces.push({
          mesh: obj,
          released: false,
          opacity: 1.0,
          baseOffset: new THREE.Vector3(),
          fallVel:   new THREE.Vector3(0,0,0),
          rotVel:    new THREE.Vector3(
            (Math.random()-0.5)*ROT_BASE,
            (Math.random()-0.5)*ROT_BASE,
            (Math.random()-0.5)*ROT_BASE
          )
        })
      }
    })

    scene.add(eggRoot)
  })
}

function smoothTransition(nextTexture) {
  if (!materialUniforms) return

  materialUniforms.map1.value = materialUniforms.map2.value
  materialUniforms.map2.value = nextTexture
  materialUniforms.mixRatio.value = 0.0

  const start = performance.now()
  const duration = 2500

  function update() {
    const elapsed = performance.now() - start
    const t = Math.min(elapsed / duration, 1)
    materialUniforms.mixRatio.value = t
    if (t < 1) requestAnimationFrame(update)
  }
  update()
}

function onScroll() {
  const scrollY = window.scrollY
  const h = window.innerHeight
  const sectionIndex = Math.floor(scrollY / h)

  if (sectionIndex !== currentSection) {
    currentSection = sectionIndex

    switch (currentSection) {
      case 0:
        smoothTransition(texture1)
        break
      case 1:
        smoothTransition(texture2)
        break
      case 2:
        smoothTransition(texture3)
        break
      case 3:
        smoothTransition(texture3)
        if (!animTriggered) {
          animTriggered = true
          startCrackSequence()
        }
        break
      default:
        smoothTransition(texture1)
    }
  }
}

function startCrackSequence() {
  if (eggBroken) return
  eggBroken = true
  breakStartTime = clock.getElapsedTime()

  const centerAll = new THREE.Vector3()
  let countAll = 0
  shellPieces.forEach(p => {
    const wp = p.mesh.getWorldPosition(new THREE.Vector3())
    centerAll.add(wp)
    countAll++
  })
  if (countAll > 0) centerAll.multiplyScalar(1 / countAll)
  explosionCenter.copy(centerAll)

  let maxDist = 0
  shellPieces.forEach(p => {
    const m = p.mesh
    const wp = m.getWorldPosition(new THREE.Vector3())
    const dist = wp.distanceTo(explosionCenter)
    if (dist > maxDist) maxDist = dist
  })
  burstRadiusGlobal = maxDist * 1.05

  shellPieces.forEach(p => {
    const m = p.mesh

    const wp = m.getWorldPosition(new THREE.Vector3())
    const wq = m.getWorldQuaternion(new THREE.Quaternion())
    const ws = m.getWorldScale(new THREE.Vector3())

    scene.attach(m)
    m.position.copy(wp)
    m.quaternion.copy(wq)
    m.scale.copy(ws)

    p.released = true
    p.opacity  = 1.0
    m.material.opacity = 1.0

    const dirOut = wp.clone().sub(centerAll)

    const horizDir = new THREE.Vector3(
      dirOut.x,
      (Math.random()-0.5)*0.2,
      dirOut.z
    )

    if (horizDir.length() < 0.0001) {
      horizDir.set(
        (Math.random()-0.5),
        (Math.random()-0.5)*0.2,
        (Math.random()-0.5)
      )
    }

    horizDir.normalize()

    const dist = BASE_SPLIT_OFFSET * (0.7 + Math.random()*0.6)
    p.baseOffset = new THREE.Vector3().copy(horizDir).multiplyScalar(dist)

    p.fallVel.set(
      0,
      -(1.0 + Math.random()*0.5),
      0
    )

    m.userData.lastX = 0
    m.userData.lastY = 0
    m.userData.lastZ = 0
  })

  if (!globalDustBurstDone) {
    globalDustBurstDone = true
    spawnHugeDustBurst(explosionCenter.clone(), burstRadiusGlobal)
  }

  if (eggRoot) {
    eggRoot.visible = false
  }
}

function updateEggPieces(delta) {
  const now = clock.getElapsedTime()

  if (!eggBroken) {
    if (eggRoot) {
      eggRoot.position.y = Math.sin(now * 1.5) * 0.15
    }
    return
  }

  const slowDeltaEgg = delta / EGG_SLOW
  const tSince = now - breakStartTime
  const crackEnd = CRACK_SEPARATE_TIME

  shellPieces.forEach(p => {
    const m = p.mesh
    if (!p.released || !m.visible) return

    m.rotation.x += p.rotVel.x * slowDeltaEgg
    m.rotation.y += p.rotVel.y * slowDeltaEgg
    m.rotation.z += p.rotVel.z * slowDeltaEgg

    if (tSince < crackEnd) {
      const localT = tSince / CRACK_SEPARATE_TIME
      const ease = 1.0 - Math.pow(1.0 - localT, 2.0)
      const widen = THREE.MathUtils.lerp(1.0, FINAL_SPREAD_MULT, ease)

      const targetX = p.baseOffset.x * widen
      const targetY = p.baseOffset.y * widen
      const targetZ = p.baseOffset.z * widen

      m.position.x += (targetX - (m.userData.lastX ?? 0))
      m.position.y += (targetY - (m.userData.lastY ?? 0))
      m.position.z += (targetZ - (m.userData.lastZ ?? 0))

      m.userData.lastX = targetX
      m.userData.lastY = targetY
      m.userData.lastZ = targetZ
    }

    p.fallVel.y -= GRAVITY * slowDeltaEgg
    m.position.addScaledVector(p.fallVel, slowDeltaEgg)

    if (tSince >= crackEnd) {
      p.opacity -= FADE_SPEED_BASE * slowDeltaEgg
      if (p.opacity < 0) p.opacity = 0
      m.material.opacity = p.opacity

      if (p.opacity <= 0.01 || m.position.y < -80) {
        m.visible = false
      }
    }
  })
}

function initParticleSystem() {
  const positions   = new Float32Array(PARTICLE_MAX * 3)
  const velocities  = new Float32Array(PARTICLE_MAX * 3)
  const active      = new Float32Array(PARTICLE_MAX)
  const omega       = new Float32Array(PARTICLE_MAX)
  const rand        = new Float32Array(PARTICLE_MAX)
  const gatherOff   = new Float32Array(PARTICLE_MAX * 3)

  for (let i = 0; i < PARTICLE_MAX; i++) {
    positions[i*3+0] = 0
    positions[i*3+1] = -9999
    positions[i*3+2] = 0

    velocities[i*3+0] = 0
    velocities[i*3+1] = 0
    velocities[i*3+2] = 0

    active[i] = 0
    omega[i]  = 0
    rand[i]   = Math.random()
    gatherOff[i*3+0] = 0
    gatherOff[i*3+1] = 0
    gatherOff[i*3+2] = 0
  }

  const sprite = makeConcreteDustTexture()

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position',    new THREE.BufferAttribute(positions,   3))
  geom.setAttribute('velocity',    new THREE.BufferAttribute(velocities,  3))
  geom.setAttribute('isActive',    new THREE.BufferAttribute(active,      1))
  geom.setAttribute('omega',       new THREE.BufferAttribute(omega,       1))
  geom.setAttribute('rand',        new THREE.BufferAttribute(rand,        1))
  geom.setAttribute('gatherOff',   new THREE.BufferAttribute(gatherOff,   3))

  const mat = new THREE.PointsMaterial({
    map: sprite,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    color: new THREE.Color(0x6c6c6c),
    size: 0.22,
    sizeAttenuation: true,
    opacity: 0.0,
    alphaTest: 0.03
  })

  particleSystem = new THREE.Points(geom, mat)
  particleSystem.visible = false
  particleSystem.frustumCulled = false
  scene.add(particleSystem)

  particleData = {
    positions,
    velocities,
    active,
    omega,
    rand,
    gatherOff,
    geom,
    cursor: 0
  }
}

function makeConcreteDustTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')

  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size/2
      const dy = y - size/2
      const r = Math.sqrt(dx*dx + dy*dy)
      const maxR = size/2

      let a = 0
      if (r < maxR) {
        const k = r / maxR
        a = (1.0 - k)
        a = Math.pow(a, 2.6)
      }

      const ring = Math.max(0, 1.0 - r/maxR)
      const noise = (Math.random() - 0.5) * 0.18 * ring
      let finalA = Math.max(0, Math.min(1, a + noise))

      const gray = 96 + (Math.random()*12 - 6)

      const idx = (y*size + x) * 4
      img.data[idx+0] = gray
      img.data[idx+1] = gray
      img.data[idx+2] = gray
      img.data[idx+3] = finalA * 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return new THREE.CanvasTexture(canvas)
}

function spawnHugeDustBurst(origin, radiusSpread) {
  if (!particleSystem) return

  particleStartTime = clock.getElapsedTime()
  particleSystem.visible = true
  particleSystem.material.opacity = 1.0

  const burstCount = PARTICLE_MAX
  for (let n = 0; n < burstCount; n++) {
    addDustParticle(origin, radiusSpread)
  }
}

function addDustParticle(origin, radiusSpread) {
  const d = particleData
  const i = d.cursor
  d.cursor = (d.cursor + 1) % PARTICLE_MAX

  const coreBias = Math.random() < 0.7
  const boxBase = radiusSpread * 2.0
  const boxCore = radiusSpread * 0.3
  const box = coreBias ? boxCore : boxBase

  const sx = origin.x + (Math.random() - 0.5) * box
  const sy = origin.y + (Math.random() - 0.5) * box
  const sz = origin.z + (Math.random() - 0.5) * box

  d.positions[i*3+0] = sx
  d.positions[i*3+1] = sy
  d.positions[i*3+2] = sz

  const dirInit = new THREE.Vector3(
    (Math.random()-0.5) * 2.0,
    (Math.random()-0.5) * 2.0,
    (Math.random()-0.5) * 2.0
  ).normalize()

  const speed = coreBias
    ? (15 + Math.random()*20)
    : (40 + Math.random()*40)

  d.velocities[i*3+0] = dirInit.x * speed
  d.velocities[i*3+1] = dirInit.y * speed
  d.velocities[i*3+2] = dirInit.z * speed

  d.omega[i] = (0.8 + Math.random()*1.2) * VORTEX_STRENGTH
  d.rand[i]  = Math.random()

  const swirlRadius = coreBias
    ? (2 + Math.random()*4)
    : (5 + Math.random()*10)

  const theta = Math.random() * Math.PI * 2
  const u = Math.random()*2 - 1
  const phi = Math.acos(u)

  const offx = swirlRadius * Math.sin(phi) * Math.cos(theta)
  const offy = swirlRadius * Math.cos(phi)
  const offz = swirlRadius * Math.sin(phi) * Math.sin(theta)

  d.gatherOff[i*3+0] = offx
  d.gatherOff[i*3+1] = offy
  d.gatherOff[i*3+2] = offz

  d.active[i] = 1
}

function updateParticles(delta) {
  if (!particleSystem) return
  if (!particleData) return
  if (!particleSystem.visible) return

  const now = clock.getElapsedTime()
  const t = now - particleStartTime

  const t1 = EXPLODE_TIME
  const t2 = t1
  const t3 = t2 + GATHER_TIME
  const t4 = t3 + FADE_TIME

  const slowDeltaDust = delta / DUST_SLOW
  const dustNow = now / DUST_SLOW

  let desiredOpacity
  if (t <= t1) {
    desiredOpacity = 1.0
  } else if (t <= t3) {
    const k = (t - t1) / (t3 - t1)
    desiredOpacity = THREE.MathUtils.lerp(1.0, 0.6, k)
  } else if (t <= t4) {
    const k = (t - t3) / (t4 - t3)
    desiredOpacity = THREE.MathUtils.lerp(0.6, 0.0, k)
  } else {
    desiredOpacity = 0.0
  }

  particleSystem.material.opacity = THREE.MathUtils.lerp(
    particleSystem.material.opacity,
    desiredOpacity,
    0.18
  )

  if (!dnaVisible && t >= t4) {
    dnaVisible = true
    if (dnaMesh) {
      dnaMesh.visible = true
      dnaMesh.position.copy(DNA_CENTER)
      dnaMesh.scale.set(0.0001, 0.0001, 0.0001)
      dnaMesh.material.opacity = 0.0
    }
    dnaParallaxActive = true
  }

  const pos = particleData.positions
  const vel = particleData.velocities
  const act = particleData.active
  const omg = particleData.omega
  const rnd = particleData.rand
  const gof = particleData.gatherOff

  const gatherLocalTRaw = (t - t1) / GATHER_TIME
  const gatherLocalT = THREE.MathUtils.clamp(gatherLocalTRaw, 0, 1)

  const pullBase = 14.0
  const pullExtra = 20.0
  const pullNow = pullBase + pullExtra * gatherLocalT

  const spiralScaleStart = 1.3
  const spiralScaleEnd   = 0.15
  const spiralScaleNow   = THREE.MathUtils.lerp(spiralScaleStart, spiralScaleEnd, gatherLocalT)

  const focusBlendNow = THREE.MathUtils.clamp(gatherLocalT * 0.7, 0, 1)

  for (let i = 0; i < PARTICLE_MAX; i++) {
    if (act[i] === 0) continue

    let px = pos[i*3+0]
    let py = pos[i*3+1]
    let pz = pos[i*3+2]

    let vx = vel[i*3+0]
    let vy = vel[i*3+1]
    let vz = vel[i*3+2]

    const randBias = rnd[i]

    if (t <= t1) {
      const dx0 = px - explosionCenter.x
      const dy0 = py - explosionCenter.y
      const dz0 = pz - explosionCenter.z
      let outLen = Math.sqrt(dx0*dx0 + dy0*dy0 + dz0*dz0) + 0.0001
      const nx0 = dx0 / outLen
      const ny0 = dy0 / outLen
      const nz0 = dz0 / outLen

      const outwardForce = 60.0 + randBias * 30.0
      vx += nx0 * outwardForce * slowDeltaDust
      vy += ny0 * outwardForce * slowDeltaDust
      vz += nz0 * outwardForce * slowDeltaDust

      const swirlKick = 20.0 + randBias * 15.0
      const swirlVec = new THREE.Vector3(
        -ny0 * VORTEX_TILT.z + nz0 * VORTEX_TILT.y,
         nx0 * VORTEX_TILT.z - nz0 * VORTEX_TILT.x,
        -nx0 * VORTEX_TILT.y + ny0 * VORTEX_TILT.x
      ).normalize().multiplyScalar(swirlKick * slowDeltaDust)

      vx += swirlVec.x
      vy += swirlVec.y
      vz += swirlVec.z

      vy -= GRAVITY * 0.15 * slowDeltaDust

      vx *= 0.992
      vy *= 0.992
      vz *= 0.992

    } else {
      const baseOffX = gof[i*3+0]
      const baseOffY = gof[i*3+1]
      const baseOffZ = gof[i*3+2]

      let offVec = new THREE.Vector3(
        baseOffX * spiralScaleNow,
        baseOffY * spiralScaleNow,
        baseOffZ * spiralScaleNow
      )

      const chaosAmp = (0.6 + randBias*1.2) * (1.0 - gatherLocalT + 0.3)
      offVec.x += (Math.random()-0.5) * chaosAmp
      offVec.y += (Math.random()-0.5) * chaosAmp
      offVec.z += (Math.random()-0.5) * chaosAmp

      const angle = dustNow * omg[i] * (1.0 + gatherLocalT * 2.0)
      const cosA = Math.cos(angle)
      const sinA = Math.sin(angle)

      const ax = VORTEX_TILT.x
      const ay = VORTEX_TILT.y
      const az = VORTEX_TILT.z
      const cx = ay*offVec.z - az*offVec.y
      const cy = az*offVec.x - ax*offVec.z
      const cz = ax*offVec.y - ay*offVec.x
      const dot = ax*offVec.x + ay*offVec.y + az*offVec.z

      const rotX = offVec.x * cosA + cx * sinA + ax * dot * (1 - cosA)
      const rotY = offVec.y * cosA + cy * sinA + ay * dot * (1 - cosA)
      const rotZ = offVec.z * cosA + cz * sinA + az * dot * (1 - cosA)

      const targetX = THREE.MathUtils.lerp(DNA_CENTER.x + rotX, SINGULARITY_POINT.x, focusBlendNow)
      const targetY = THREE.MathUtils.lerp(DNA_CENTER.y + rotY, SINGULARITY_POINT.y, focusBlendNow)
      const targetZ = THREE.MathUtils.lerp(DNA_CENTER.z + rotZ, SINGULARITY_POINT.z, focusBlendNow)

      const dx = targetX - px
      const dy = targetY - py
      const dz = targetZ - pz

      const dynamicPull = pullNow + randBias * 10.0
      vx += dx * dynamicPull * slowDeltaDust
      vy += dy * dynamicPull * slowDeltaDust
      vz += dz * dynamicPull * slowDeltaDust

      const shake = (1.0 - gatherLocalT) * 9.0 + 1.0
      vx += (Math.random()-0.5) * shake * slowDeltaDust
      vy += (Math.random()-0.5) * shake * slowDeltaDust
      vz += (Math.random()-0.5) * shake * slowDeltaDust

      const swirlTighten = THREE.MathUtils.lerp(0.94, 0.985, gatherLocalT)
      vx *= swirlTighten
      vy *= swirlTighten
      vz *= swirlTighten
    }

    px += vx * slowDeltaDust
    py += vy * slowDeltaDust
    pz += vz * slowDeltaDust

    pos[i*3+0] = px
    pos[i*3+1] = py
    pos[i*3+2] = pz

    vel[i*3+0] = vx
    vel[i*3+1] = vy
    vel[i*3+2] = vz
  }

  particleSystem.geometry.attributes.position.needsUpdate = true
  particleSystem.geometry.attributes.velocity.needsUpdate = true

  if (dnaVisible && dnaMesh) {
    const tReveal = t - t4
    const revealProg = THREE.MathUtils.clamp(tReveal / REVEAL_TIME, 0, 1)
    const scl = THREE.MathUtils.lerp(0.0001, DNA_BASE_SCALE, revealProg)
    dnaMesh.scale.set(scl, scl, scl)
    dnaMesh.material.opacity = THREE.MathUtils.lerp(
      dnaMesh.material.opacity,
      revealProg,
      0.15
    )
  }
}

function loadDNAPlane() {
  const loader = new THREE.TextureLoader()
  const dnaTex = loader.load('/assets/novo/dnanana5.png')

  dnaTex.encoding = THREE.sRGBEncoding
  dnaTex.center.set(0.5, 0.5)
  dnaTex.flipY = false
  dnaTex.minFilter = THREE.LinearMipMapLinearFilter
  dnaTex.magFilter = THREE.LinearFilter

  const dnaMat = new THREE.MeshBasicMaterial({
    map: dnaTex,
    color: 0x444444,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
    blending: THREE.NormalBlending
  })

  const h = 8
  const geo = new THREE.PlaneGeometry(h * 8, h * 2)

  dnaMesh = new THREE.Mesh(geo, dnaMat)
  dnaMesh.visible = false
  dnaMesh.renderOrder = 10

  scene.add(dnaMesh)
}

function onMouseMove(e) {
  if (!dnaParallaxActive) return
  const nx = (e.clientX / window.innerWidth) * 2 - 1
  const ny = (e.clientY / window.innerHeight) * 2 - 1
  dnaTargetRotY = nx * 0.3
  dnaTargetRotX = ny * -0.2
}

function updateDNAPlane(delta) {
  if (!dnaParallaxActive || !dnaMesh) return

  dnaMesh.rotation.x = THREE.MathUtils.lerp(
    dnaMesh.rotation.x,
    dnaTargetRotX,
    0.08
  )
  dnaMesh.rotation.y = THREE.MathUtils.lerp(
    dnaMesh.rotation.y,
    dnaTargetRotY,
    0.08
  )
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

function animate() {
  requestAnimationFrame(animate)

  const delta = clock.getDelta()

  updateEggPieces(delta)
  updateParticles(delta)
  updateDNAPlane(delta)

  renderer.render(scene, camera)
}
