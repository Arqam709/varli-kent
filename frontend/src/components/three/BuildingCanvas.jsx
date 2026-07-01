import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment } from '@react-three/drei'
import { useRef } from 'react'

const Building = () => {
  const group = useRef()
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.3
  })

  const floors = 8
  return (
    <group ref={group}>
      {/* Base / ground */}
      <mesh position={[0, -0.1, 0]} receiveShadow>
        <cylinderGeometry args={[2.5, 2.5, 0.08, 32]} />
        <meshStandardMaterial color="#1a2430" metalness={0.3} roughness={0.7} />
      </mesh>

      {/* Main tower */}
      {Array.from({ length: floors }).map((_, i) => (
        <group key={i} position={[0, i * 0.52, 0]}>
          <mesh castShadow>
            <boxGeometry args={[1.4 - i * 0.04, 0.48, 1.4 - i * 0.04]} />
            <meshStandardMaterial
              color={i % 2 === 0 ? '#202a36' : '#1a2330'}
              metalness={0.6}
              roughness={0.2}
            />
          </mesh>
          {/* Windows row */}
          {[-0.4, 0, 0.4].map((x) => (
            <mesh key={x} position={[x, 0.05, (1.4 - i * 0.04) / 2 + 0.01]}>
              <boxGeometry args={[0.18, 0.22, 0.01]} />
              <meshStandardMaterial color="#7cb9e8" emissive="#4488aa" emissiveIntensity={0.4} metalness={0.9} roughness={0.1} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Spire */}
      <mesh position={[0, floors * 0.52 + 0.4, 0]} castShadow>
        <coneGeometry args={[0.25, 0.9, 4]} />
        <meshStandardMaterial color="#4b6741" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* Side wings */}
      {[-1.1, 1.1].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          {Array.from({ length: 4 }).map((_, i) => (
            <mesh key={i} position={[0, i * 0.52, 0]} castShadow>
              <boxGeometry args={[0.5, 0.48, 0.9]} />
              <meshStandardMaterial color="#202a36" metalness={0.5} roughness={0.3} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

const BuildingCanvas = () => (
  <Canvas
    camera={{ position: [5, 3, 5], fov: 45 }}
    shadows
    gl={{ antialias: true }}
    style={{ background: 'transparent' }}
  >
    <ambientLight intensity={0.4} />
    <directionalLight position={[5, 10, 5]} intensity={1.2} castShadow />
    <pointLight position={[-5, 5, -5]} intensity={0.5} color="#4b6741" />
    <Environment preset="city" />
    <Building />
    <OrbitControls
      enablePan={false}
      enableZoom={false}
      minPolarAngle={Math.PI / 4}
      maxPolarAngle={Math.PI / 2.2}
    />
  </Canvas>
)

export default BuildingCanvas
