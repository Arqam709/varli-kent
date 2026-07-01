import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment } from '@react-three/drei'
import { useRef } from 'react'

const Sofa = ({ position, color }) => (
  <group position={position}>
    <mesh position={[0, 0.25, 0]}>
      <boxGeometry args={[1.8, 0.35, 0.8]} />
      <meshStandardMaterial color={color} roughness={0.7} />
    </mesh>
    <mesh position={[0, 0.55, -0.32]}>
      <boxGeometry args={[1.8, 0.55, 0.18]} />
      <meshStandardMaterial color={color} roughness={0.7} />
    </mesh>
    {[-0.76, 0.76].map((x) => (
      <mesh key={x} position={[x, 0.45, -0.1]}>
        <boxGeometry args={[0.18, 0.45, 0.6]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
    ))}
  </group>
)

const Table = ({ position }) => (
  <group position={position}>
    <mesh position={[0, 0.38, 0]}>
      <boxGeometry args={[1.1, 0.06, 0.6]} />
      <meshStandardMaterial color="#4a3728" roughness={0.5} metalness={0.1} />
    </mesh>
    {[[-0.45, -0.25], [0.45, -0.25], [-0.45, 0.25], [0.45, 0.25]].map(([x, z]) => (
      <mesh key={`${x},${z}`} position={[x, 0.18, z]}>
        <cylinderGeometry args={[0.03, 0.03, 0.36, 6]} />
        <meshStandardMaterial color="#3a2718" roughness={0.6} />
      </mesh>
    ))}
  </group>
)

const Lamp = ({ position }) => {
  const lightRef = useRef()
  useFrame((state) => {
    if (lightRef.current) {
      lightRef.current.intensity = 0.8 + Math.sin(state.clock.elapsedTime * 2) * 0.05
    }
  })
  return (
    <group position={position}>
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 1.2, 6]} />
        <meshStandardMaterial color="#888" metalness={0.9} />
      </mesh>
      <mesh position={[0, 1.25, 0]}>
        <coneGeometry args={[0.18, 0.25, 16, 1, true]} />
        <meshStandardMaterial color="#f5e6c8" side={2} />
      </mesh>
      <pointLight ref={lightRef} position={[0, 1.1, 0]} intensity={0.8} color="#ffd280" distance={3} />
    </group>
  )
}

const Room = ({ wallColor, floorColor }) => (
  <group>
    {/* Floor */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[6, 6]} />
      <meshStandardMaterial color={floorColor} roughness={0.8} />
    </mesh>
    {/* Back wall */}
    <mesh position={[0, 1.5, -3]} receiveShadow>
      <planeGeometry args={[6, 3]} />
      <meshStandardMaterial color={wallColor} roughness={0.9} />
    </mesh>
    {/* Side wall */}
    <mesh rotation={[0, Math.PI / 2, 0]} position={[-3, 1.5, 0]} receiveShadow>
      <planeGeometry args={[6, 3]} />
      <meshStandardMaterial color={wallColor} roughness={0.9} />
    </mesh>

    <Sofa position={[0, 0, -1.8]} color="#8b7355" />
    <Table position={[0, 0, -0.2]} />
    <Lamp position={[-1.8, 0, -1.8]} />
    <Lamp position={[1.8, 0, -1.8]} />
  </group>
)

const RoomCanvas = ({ wallColor = '#e8ddd0', floorColor = '#4a3728' }) => (
  <Canvas camera={{ position: [3, 2.5, 4], fov: 50 }} shadows gl={{ antialias: true }} style={{ background: 'transparent' }}>
    <ambientLight intensity={0.3} />
    <directionalLight position={[3, 5, 3]} intensity={0.6} castShadow />
    <Environment preset="apartment" />
    <Room wallColor={wallColor} floorColor={floorColor} />
    <OrbitControls
      enablePan={false}
      enableZoom={false}
      minPolarAngle={Math.PI / 6}
      maxPolarAngle={Math.PI / 2.2}
      minAzimuthAngle={-Math.PI / 3}
      maxAzimuthAngle={Math.PI / 4}
    />
  </Canvas>
)

export default RoomCanvas
