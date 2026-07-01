import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, ContactShadows, useGLTF } from '@react-three/drei'

const STAGES = [
  { file: '/models/construction/base.glb', label: 'Site Base & Foundation' },
  { file: '/models/construction/Wall1nofloor.glb', label: 'Ground Level Walls' },
  { file: '/models/construction/Wall1floor.glb', label: 'Ground Floor Slab' },
  { file: '/models/construction/floor1roof.glb', label: 'First Floor Structure' },
  { file: '/models/construction/floor2noroof.glb', label: 'Second Floor Frame' },
  { file: '/models/construction/floor2roof.glb', label: 'Second Floor Slab' },
  { file: '/models/construction/floor3noroof.glb', label: 'Roof Level Structure' },
  { file: '/models/construction/floor3semiroof.glb', label: 'Roof Assembly' },
  { file: '/models/construction/finaldone.glb', label: 'Completed Villa' },
]

function StageModel({ url }) {
  const { scene } = useGLTF(url)
  return <primitive object={scene} scale={1} position={[0, -1, 0]} />
}

const GoldSpinner = () => (
  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0e1520] z-10">
    <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#c4993a] border-t-transparent" />
    <p className="text-xs tracking-[0.3em] uppercase text-slate-500">Loading Stage</p>
  </div>
)

const ViewPrompt = ({ onClick }) => (
  <button
    onClick={onClick}
    className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0e1520] cursor-pointer group z-10"
  >
    <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[#c4993a]/40 transition-colors group-hover:border-[#c4993a]">
      <svg className="h-6 w-6 text-[#c4993a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12l4-4m0 0l-4-4m4 4H3m13 8l4-4m0 0l-4-4m4 4h-7" />
      </svg>
    </div>
    <p style={{ fontFamily: 'Cinzel, serif' }} className="text-sm tracking-[0.2em] uppercase text-white">
      View Construction Progression
    </p>
  </button>
)

export default function ConstructionProgressionViewer({ height = '620px' }) {
  const [requested, setRequested] = useState(false)
  const [stage, setStage] = useState(0)

  return (
    <div className="w-full" style={{ backgroundColor: '#0e1520' }}>
      <div className="relative overflow-hidden" style={{ height, backgroundColor: '#0e1520' }}>
        {!requested && <ViewPrompt onClick={() => setRequested(true)} />}
        {requested && (
          <Suspense fallback={<GoldSpinner />}>
            <Canvas camera={{ position: [7, 5, 7], fov: 38 }} dpr={[1, 1.5]} shadows>
              <color attach="background" args={['#0e1520']} />
              <ambientLight intensity={0.4} />
              <directionalLight position={[8, 12, 6]} intensity={1.4} castShadow />
              <Suspense fallback={null}>
                <StageModel url={STAGES[stage].file} />
                <Environment preset="city" />
                <ContactShadows position={[0, -1.01, 0]} opacity={0.55} scale={14} blur={2.4} far={4} />
              </Suspense>
              <OrbitControls
                enablePan={false}
                minDistance={3}
                maxDistance={16}
                maxPolarAngle={Math.PI / 2.05}
              />
            </Canvas>
          </Suspense>
        )}

        {/* Stage label overlay */}
        {requested && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-center pointer-events-none">
            <p className="text-xs tracking-[0.3em] uppercase text-[#c4993a]">Stage {stage + 1} / {STAGES.length}</p>
            <p style={{ fontFamily: 'Cinzel, serif' }} className="mt-1 text-base text-white">{STAGES[stage].label}</p>
          </div>
        )}
      </div>

      {/* Step controls */}
      {requested && (
        <div className="px-6 py-8 border-t border-white/8">
          <input
            type="range"
            min={0}
            max={STAGES.length - 1}
            value={stage}
            onChange={(e) => setStage(Number(e.target.value))}
            className="w-full accent-[#c4993a] cursor-pointer"
          />
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {STAGES.map((s, i) => (
              <button
                key={s.file}
                onClick={() => setStage(i)}
                className={`px-3 py-2 text-[10px] sm:text-xs tracking-wider uppercase transition-colors cursor-pointer ${
                  i === stage ? 'text-[#c4993a] border border-[#c4993a]' : 'text-slate-500 border border-white/10 hover:text-white hover:border-white/30'
                }`}
              >
                {i + 1}. {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
