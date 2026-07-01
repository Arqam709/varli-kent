import { Suspense, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, useGLTF, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

const PHASES = [
  { pct: 0,   label: 'Foundation', desc: 'Excavation, footings and concrete slab' },
  { pct: 25,  label: 'Structure',  desc: 'Columns, beams and floor plates rise' },
  { pct: 50,  label: 'Walls',      desc: 'Masonry, facade panels and openings' },
  { pct: 75,  label: 'Roof',       desc: 'Roof structure, membrane and cladding' },
  { pct: 100, label: 'Final',      desc: 'Complete building ready for fit-out' },
]

const TARGET_SIZE = 6

function ClippedModel({ url, progress, onReady }) {
  const { scene } = useGLTF(url)
  const { gl, camera } = useThree()
  const groupRef = useRef()
  const clipPlane = useRef(new THREE.Plane(new THREE.Vector3(0, -1, 0), 9999))
  const heightRef = useRef(1)
  const currentConstantRef = useRef(9999)

  useEffect(() => {
    gl.localClippingEnabled = true

    const box = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3()
    box.getSize(size)
    const center = new THREE.Vector3()
    box.getCenter(center)

    const diagonal = Math.sqrt(size.x ** 2 + size.y ** 2 + size.z ** 2)
    const scale = TARGET_SIZE / (diagonal || 1)

    if (groupRef.current) {
      groupRef.current.scale.setScalar(scale)
      groupRef.current.position.set(
        -center.x * scale,
        -box.min.y * scale,
        -center.z * scale
      )
    }

    const normHeight = size.y * scale
    heightRef.current = normHeight
    currentConstantRef.current = 0.01
    clipPlane.current.constant = currentConstantRef.current

    const midY = normHeight * 0.35
    if (onReady) onReady(midY)

    scene.traverse(obj => {
      if (!obj.isMesh) return
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      mats.forEach(m => {
        m.clippingPlanes = [clipPlane.current]
        m.clipShadows = false
        m.needsUpdate = true
      })
    })
  }, [scene, gl, camera, onReady])

  useFrame((_, delta) => {
    const target = progress * heightRef.current + 0.02
    currentConstantRef.current = THREE.MathUtils.lerp(
      currentConstantRef.current,
      target,
      1 - Math.exp(-5 * delta)
    )
    clipPlane.current.constant = currentConstantRef.current
  })

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  )
}

function Scene({ progress, orbitTarget, onReady }) {
  return (
    <Suspense fallback={null}>
      <ClippedModel
        url="/models/construction/construction_full.glb"
        progress={progress}
        onReady={onReady}
      />
      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.2}
        minDistance={TARGET_SIZE * 0.18}
        maxDistance={TARGET_SIZE * 1.4}
        target={[0, orbitTarget, 0]}
      />
      <Environment preset="city" />
      <ambientLight intensity={0.8} />
      <directionalLight position={[6, 10, 6]} intensity={1.2} />
      <directionalLight position={[-4, 6, -4]} intensity={0.4} />
    </Suspense>
  )
}

const ClickPrompt = ({ onClick }) => (
  <button
    onClick={onClick}
    className="absolute inset-0 flex flex-col items-center justify-center gap-5 cursor-pointer z-10"
    style={{ backgroundColor: '#1E1E1C' }}
  >
    <div className="flex h-20 w-20 items-center justify-center rounded-full border"
      style={{ borderColor: 'rgba(201,163,90,0.4)' }}>
      <svg className="h-8 w-8" style={{ color: '#C9A35A' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    </div>
    <div className="text-center">
      <p style={{ fontFamily: 'Cinzel, serif', color: '#F6F3ED' }} className="text-sm tracking-[0.2em] uppercase">
        View Construction Model
      </p>
      <p className="mt-1 text-xs" style={{ color: 'rgba(246,243,237,0.35)' }}>Click to load</p>
    </div>
  </button>
)

export default function ConstructionClipViewer({ height }) {
  const [active, setActive] = useState(false)
  const [sliderValue, setSliderValue] = useState(0)
  const [orbitTarget, setOrbitTarget] = useState(1.2)
  const progress = sliderValue / 100

  const activePhaseIndex = PHASES.reduce((best, phase, i) =>
    sliderValue >= phase.pct ? i : best, 0)
  const activePhase = PHASES[activePhaseIndex]

  const containerStyle = height
    ? { height, backgroundColor: '#1E1E1C' }
    : { aspectRatio: '16/9', minHeight: '280px', backgroundColor: '#1E1E1C' }

  return (
    <div className="w-full rounded-2xl overflow-hidden relative select-none"
      style={containerStyle}>

      {!active && <ClickPrompt onClick={() => setActive(true)} />}

      {active && (
        <>
          <Canvas
            camera={{ position: [4, 1.2, 4], fov: 50, near: 0.01, far: 1000 }}
            gl={{ antialias: true, localClippingEnabled: true }}
            style={{ position: 'absolute', inset: 0 }}
          >
            <color attach="background" args={['#1E1E1C']} />
            <Scene progress={progress} orbitTarget={orbitTarget} onReady={setOrbitTarget} />
          </Canvas>

          {/* Hint — hidden on small screens */}
          <div className="absolute top-3 right-3 z-20 pointer-events-none hidden sm:block">
            <p className="text-xs" style={{ color: 'rgba(246,243,237,0.2)' }}>Drag to rotate · Scroll to zoom</p>
          </div>

          {/* Phase pills */}
          <div className="absolute top-3 left-0 right-0 flex justify-center gap-1.5 px-3 pointer-events-none z-20 flex-wrap">
            {PHASES.map((phase, i) => (
              <div key={phase.label}
                className="px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold transition-all duration-300"
                style={{
                  backgroundColor: i === activePhaseIndex ? '#C9A35A' : 'rgba(246,243,237,0.07)',
                  color: i === activePhaseIndex ? '#1E1E1C' : i < activePhaseIndex ? 'rgba(201,163,90,0.7)' : 'rgba(246,243,237,0.35)',
                  border: i < activePhaseIndex ? '1px solid rgba(201,163,90,0.35)' : '1px solid transparent',
                }}>
                {phase.label}
              </div>
            ))}
          </div>

          {/* Phase info + Percentage — row on mobile */}
          <div className="absolute bottom-16 left-4 right-4 z-20 pointer-events-none flex items-end justify-between sm:bottom-20 sm:left-6 sm:right-6">
            <div>
              <p className="text-[10px] sm:text-xs uppercase tracking-widest mb-0.5" style={{ color: '#C9A35A' }}>
                {activePhase.label}
              </p>
              <p className="text-xs sm:text-sm hidden sm:block" style={{ color: 'rgba(246,243,237,0.55)' }}>
                {activePhase.desc}
              </p>
            </div>
            <div className="text-right">
              <span style={{ fontFamily: 'Cinzel, serif', color: '#C9A35A', fontSize: 'clamp(1.4rem, 4vw, 2.2rem)', lineHeight: 1 }}>
                {sliderValue}
              </span>
              <span className="text-xs ml-0.5" style={{ color: 'rgba(246,243,237,0.35)' }}>%</span>
            </div>
          </div>

          {/* Slider */}
          <div className="absolute bottom-0 left-0 right-0 z-20 px-4 pb-4 pt-6 sm:px-6 sm:pb-6"
            style={{ background: 'linear-gradient(to top, rgba(30,30,28,0.97) 60%, transparent)' }}>
            <div className="relative h-1.5 rounded-full mb-1"
              style={{ backgroundColor: 'rgba(246,243,237,0.1)' }}>
              <div className="absolute left-0 top-0 h-full rounded-full"
                style={{ width: `${sliderValue}%`, background: 'linear-gradient(to right, #5E7F52, #C9A35A)' }} />
              {PHASES.map(phase => (
                <button key={phase.pct}
                  onClick={() => setSliderValue(phase.pct)}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 cursor-pointer transition-all"
                  style={{
                    left: `${phase.pct}%`,
                    backgroundColor: sliderValue >= phase.pct ? '#C9A35A' : '#1E1E1C',
                    borderColor: sliderValue >= phase.pct ? '#C9A35A' : 'rgba(246,243,237,0.3)',
                    zIndex: 2,
                  }} />
              ))}
              <input type="range" min="0" max="100" step="1"
                value={sliderValue}
                onChange={e => setSliderValue(Number(e.target.value))}
                className="absolute w-full opacity-0 cursor-pointer"
                style={{ top: '-16px', height: '44px', zIndex: 3 }} />
            </div>
            <div className="flex justify-between mt-2">
              {PHASES.map((phase, i) => (
                <button key={phase.pct}
                  onClick={() => setSliderValue(phase.pct)}
                  className="text-[10px] sm:text-xs cursor-pointer transition-colors"
                  style={{
                    color: i === activePhaseIndex ? '#C9A35A' : sliderValue > phase.pct ? 'rgba(201,163,90,0.5)' : 'rgba(246,243,237,0.25)',
                    fontWeight: i === activePhaseIndex ? 700 : 400,
                  }}>
                  {phase.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
