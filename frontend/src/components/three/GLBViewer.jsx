import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, ContactShadows, useGLTF } from '@react-three/drei'

function Model({ url, scale = 1, position = [0, 0, 0] }) {
  const { scene } = useGLTF(url)
  return <primitive object={scene} scale={scale} position={position} />
}

function SceneLoader() {
  return (
    <mesh>
      <sphereGeometry args={[0.001, 8, 8]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  )
}

const GoldSpinner = () => (
  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0e1520]">
    <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#c4993a] border-t-transparent" />
    <p className="text-xs tracking-[0.3em] uppercase text-slate-500">Loading Model</p>
  </div>
)

const ViewPrompt = ({ onClick, label }) => (
  <button
    onClick={onClick}
    className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0e1520] cursor-pointer group"
  >
    <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[#c4993a]/40 transition-colors group-hover:border-[#c4993a]">
      <svg className="h-6 w-6 text-[#c4993a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12l4-4m0 0l-4-4m4 4H3m13 8l4-4m0 0l-4-4m4 4h-7" />
      </svg>
    </div>
    <p style={{ fontFamily: 'Cinzel, serif' }} className="text-sm tracking-[0.2em] uppercase text-white">
      {label || 'View 3D Model'}
    </p>
  </button>
)

export default function GLBViewer({
  url,
  scale = 1,
  position = [0, -1, 0],
  cameraPosition = [6, 4, 6],
  height,
  bgColor = '#0e1520',
  autoLoad = false,
  loadLabel = 'View 3D Model',
}) {
  const [requested, setRequested] = useState(autoLoad)

  const containerStyle = height
    ? { height, backgroundColor: bgColor }
    : { aspectRatio: '16/9', minHeight: '260px', backgroundColor: bgColor }

  if (!url) {
    return (
      <div
        className="w-full relative overflow-hidden blueprint-grid flex items-center justify-center"
        style={containerStyle}
      >
        <p className="text-xs tracking-[0.2em] uppercase text-slate-600">3D model not available</p>
      </div>
    )
  }

  return (
    <div className="w-full relative overflow-hidden" style={containerStyle}>
      {!requested && <ViewPrompt onClick={() => setRequested(true)} label={loadLabel} />}
      {requested && (
        <Suspense fallback={<GoldSpinner />}>
          <Canvas camera={{ position: cameraPosition, fov: 38 }} dpr={[1, 1.5]} shadows>
            <color attach="background" args={[bgColor]} />
            <ambientLight intensity={0.4} />
            <directionalLight position={[8, 12, 6]} intensity={1.4} castShadow />
            <Suspense fallback={<SceneLoader />}>
              <Model url={url} scale={scale} position={position} />
              <Environment preset="city" />
              <ContactShadows position={[0, -1.01, 0]} opacity={0.55} scale={14} blur={2.4} far={4} />
            </Suspense>
            <OrbitControls
              enablePan={false}
              minDistance={3}
              maxDistance={14}
              maxPolarAngle={Math.PI / 2.05}
              autoRotate
              autoRotateSpeed={0.6}
            />
          </Canvas>
        </Suspense>
      )}
    </div>
  )
}
