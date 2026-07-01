import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useRef } from 'react'
import * as THREE from 'three'

const Crane = ({ position }) => {
  const armRef = useRef()
  useFrame((state) => {
    if (armRef.current) {
      armRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.4) * 0.8
    }
  })
  return (
    <group position={position}>
      {/* Tower */}
      <mesh position={[0, 1.5, 0]}>
        <boxGeometry args={[0.12, 3, 0.12]} />
        <meshStandardMaterial color="#d97706" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Rotating arm */}
      <group ref={armRef} position={[0, 3.1, 0]}>
        <mesh position={[0.9, 0, 0]}>
          <boxGeometry args={[2, 0.08, 0.08]} />
          <meshStandardMaterial color="#d97706" metalness={0.6} roughness={0.4} />
        </mesh>
        {/* Hook cable */}
        <mesh position={[1.5, -0.4, 0]}>
          <cylinderGeometry args={[0.01, 0.01, 0.8, 4]} />
          <meshStandardMaterial color="#888" metalness={0.9} />
        </mesh>
        {/* Hook load */}
        <mesh position={[1.5, -0.9, 0]}>
          <boxGeometry args={[0.25, 0.15, 0.25]} />
          <meshStandardMaterial color="#4b6741" metalness={0.5} roughness={0.5} />
        </mesh>
      </group>
    </group>
  )
}

const BuildingProgress = () => {
  const completedFloors = 5
  const totalFloors = 8

  return (
    <group>
      {/* Foundation */}
      <mesh position={[0, 0.04, 0]}>
        <boxGeometry args={[3, 0.08, 2]} />
        <meshStandardMaterial color="#1a2430" roughness={0.9} />
      </mesh>

      {/* Completed floors */}
      {Array.from({ length: completedFloors }).map((_, i) => (
        <group key={i} position={[0, i * 0.52 + 0.3, 0]}>
          <mesh>
            <boxGeometry args={[2.6, 0.48, 1.7]} />
            <meshStandardMaterial color={i % 2 === 0 ? '#202a36' : '#1a2330'} metalness={0.4} roughness={0.3} />
          </mesh>
          {/* Window band */}
          <mesh position={[0, 0.1, 0.86]}>
            <boxGeometry args={[2.4, 0.2, 0.01]} />
            <meshStandardMaterial color="#7cb9e8" emissive="#4488aa" emissiveIntensity={0.3} metalness={0.9} roughness={0.1} />
          </mesh>
        </group>
      ))}

      {/* In-progress floors (scaffolding) */}
      {Array.from({ length: totalFloors - completedFloors }).map((_, i) => (
        <group key={`wip-${i}`} position={[0, (completedFloors + i) * 0.52 + 0.3, 0]}>
          {/* Exposed rebar columns */}
          {[[-1.1, -0.7], [-1.1, 0.7], [1.1, -0.7], [1.1, 0.7]].map(([x, z]) => (
            <mesh key={`${x},${z}`} position={[x, 0, z]}>
              <cylinderGeometry args={[0.03, 0.03, 0.52, 6]} />
              <meshStandardMaterial color="#888" metalness={0.8} />
            </mesh>
          ))}
          {/* Scaffold planks */}
          {[-0.6, 0, 0.6].map((x) => (
            <mesh key={x} position={[x, -0.18, 0]}>
              <boxGeometry args={[0.45, 0.05, 1.8]} />
              <meshStandardMaterial color="#8b6914" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Crane */}
      <Crane position={[1.8, 0, 0]} />
    </group>
  )
}

const ConstructionCanvas = () => (
  <Canvas camera={{ position: [6, 4, 6], fov: 45 }} shadows gl={{ antialias: true }} style={{ background: 'transparent' }}>
    <ambientLight intensity={0.5} />
    <directionalLight position={[5, 10, 5]} intensity={1} castShadow />
    <pointLight position={[-5, 8, 0]} intensity={0.4} color="#d97706" />
    <BuildingProgress />
    <OrbitControls enablePan={false} enableZoom={false} minPolarAngle={Math.PI / 5} maxPolarAngle={Math.PI / 2.3} />
  </Canvas>
)

export default ConstructionCanvas
