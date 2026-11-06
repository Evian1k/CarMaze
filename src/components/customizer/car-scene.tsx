'use client'

/*
 * CARMAZE 3D Showroom: procedural stylized sedan built entirely from
 * primitives (RoundedBox / cylinder / torus). No external model files exist in
 * this sandbox, so every part below is authored in code; each visual property
 * derives from the CarConfig: paint + finish (shared physical material),
 * rimStyle (spoke geometry per style), rimColor (shared metal material),
 * glassTint (window opacity), accessory (spoiler / roof rack meshes) and
 * rideHeight (body group offset: wheels stay grounded).
 *
 * The <Canvas> itself lives in the view; this component is the scene contents
 * and is memoized so unrelated parent re-renders never touch the WebGL tree.
 */

import { memo, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { ContactShadows, Grid, OrbitControls, RoundedBox } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { CarConfig, RimStyle } from './presets'

export type OrbitControlsRef = OrbitControlsImpl

type SceneProps = {
  config: CarConfig
  /** Ref forwarded to OrbitControls so the view can call .reset(). */
  controlsRef?: React.RefObject<OrbitControlsImpl | null>
  /** Dark showroom mode: near-black floor + dimmed grid so the stage blends
   *  with the charcoal page background instead of glowing light. */
  dark?: boolean
}

// ─────────────────────────── Material factories ───────────────────────────

const FINISH_METALNESS: Record<CarConfig['finish'], number> = { gloss: 0.35, matte: 0.05, metallic: 0.85 }
const FINISH_ROUGHNESS: Record<CarConfig['finish'], number> = { gloss: 0.12, matte: 0.6, metallic: 0.3 }

// ─────────────────────────────── Wheels ───────────────────────────────

const WHEEL_POSITIONS: [number, number, number][] = [
  [1.42, 0.42, 0.88],
  [1.42, 0.42, -0.88],
  [-1.42, 0.42, 0.88],
  [-1.42, 0.42, -0.88],
]

function spokeAngles(style: RimStyle): number[] {
  const count = style === 'sport' ? 5 : style === 'classic' ? 8 : 12
  return Array.from({ length: count }, (_, i) => (i * Math.PI * 2) / count)
}

/** One wheel. Local frame has the axle along +Y; the group rotation maps it across the car (+Z world). */
function Wheel({ rimStyle, rimMaterial, position }: { rimStyle: RimStyle; rimMaterial: THREE.Material; position: [number, number, number] }) {
  const angles = useMemo(() => spokeAngles(rimStyle), [rimStyle])
  const spokeT = rimStyle === 'sport' ? 0.075 : rimStyle === 'classic' ? 0.045 : 0.032

  return (
    <group position={position} rotation={[Math.PI / 2, 0, 0]}>
      {/* tyre */}
      <mesh castShadow>
        <cylinderGeometry args={[0.42, 0.42, 0.3, 32]} />
        <meshStandardMaterial color="#151716" roughness={0.95} metalness={0.05} />
      </mesh>
      {/* rim disc: slightly wider than the tyre so both faces stay visible */}
      <mesh castShadow material={rimMaterial}>
        <cylinderGeometry args={[0.27, 0.27, 0.316, 28]} />
      </mesh>
      {/* spokes: boxes radiating in the rim plane */}
      {angles.map((a, i) => (
        <mesh
          key={`${rimStyle}-${i}`}
          position={[Math.cos(a) * 0.155, 0, Math.sin(a) * 0.155]}
          rotation={[0, -a, 0]}
          material={rimMaterial}
        >
          <boxGeometry args={[0.2, 0.34, spokeT]} />
        </mesh>
      ))}
      {rimStyle === 'classic' && (
        <mesh material={rimMaterial}>
          <cylinderGeometry args={[0.06, 0.06, 0.34, 16]} />
        </mesh>
      )}
      {rimStyle === 'mesh' && (
        <mesh material={rimMaterial} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.17, 0.02, 10, 36]} />
        </mesh>
      )}
    </group>
  )
}

// ─────────────────────────── Scene (memoized) ───────────────────────────

export const CarScene = memo(function CarScene({ config, controlsRef, dark = false }: SceneProps) {
  // Paint: recreated when paint/finish change; the previous instance is
  // disposed here (R3F never auto-disposes <primitive> objects).
  const paintMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(config.paint),
        metalness: FINISH_METALNESS[config.finish],
        roughness: FINISH_ROUGHNESS[config.finish],
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        envMapIntensity: config.finish === 'matte' ? 0.55 : 1.1,
      }),
    [config.paint, config.finish]
  )
  useEffect(() => () => paintMaterial.dispose(), [paintMaterial])

  // Rims: shared metal material across all four wheels.
  const rimMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: new THREE.Color(config.rimColor), metalness: 0.9, roughness: 0.25, envMapIntensity: 1.2 }),
    [config.rimColor]
  )
  useEffect(() => () => rimMaterial.dispose(), [rimMaterial])

  // Glass: recreated when the tint slider moves; the previous instance is
  // disposed by the cleanup below (same pattern as paint/rim materials).
  const glassMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#0d110f'),
        metalness: 0.1,
        roughness: 0.06,
        transparent: true,
        opacity: Math.min(1, 0.15 + config.glassTint),
        envMapIntensity: 1.5,
      }),
    [config.glassTint]
  )
  useEffect(() => () => glassMaterial.dispose(), [glassMaterial])

  return (
    <>
      <ambientLight intensity={dark ? 0.5 : 0.4} />
      <directionalLight
        position={[5, 8, 4]}
        intensity={dark ? 1.45 : 1.25}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={0.5}
        shadow-camera-far={24}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-6, 4, -5]} intensity={0.3} />
      {/* Studio fill from the camera side; gives gloss paint a horizon
          highlight. NOTE: no <Environment> here on purpose. Its cubemap
          render misbehaves on some GPU stacks (notably sandboxed/software
          WebGL) and paints a large light plane over the stage, which glared
          against the dark theme. Plain lights keep the showroom correct
          everywhere; gloss still gets analytic specular highlights. */}
      <directionalLight position={[2, 3, 7]} intensity={dark ? 0.55 : 0.7} color="#fff4e2" />

      {/* Showroom floor: dark pedestal disc + faint brand grid. Colors adapt
          to the app theme so the stage never glows against a dark page. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[11, 56]} />
        {/* envMapIntensity 0: the pedestal stays matte and dark under the
            analytic lights only: a bright env map would wash it out gray */}
        <meshStandardMaterial color={dark ? '#101410' : '#202421'} roughness={0.95} metalness={0} envMapIntensity={0} />
      </mesh>
      <Grid
        position={[0, 0.004, 0]}
        args={[22, 22]}
        cellSize={0.55}
        cellThickness={0.6}
        cellColor={dark ? '#272c27' : '#3a403b'}
        sectionSize={2.2}
        sectionThickness={1}
        sectionColor={dark ? '#3f5f4e' : '#315E4B'}
        fadeDistance={17}
        fadeStrength={1.5}
      />

      {/* ── Body (moves with rideHeight) ── */}
      <group position={[0, config.rideHeight, 0]}>
        <RoundedBox args={[4.4, 0.72, 1.95]} radius={0.18} smoothness={4} position={[0, 0.62, 0]} material={paintMaterial} castShadow />
        <RoundedBox
          args={[1.35, 0.1, 1.8]}
          radius={0.05}
          smoothness={3}
          position={[1.45, 1.0, 0]}
          rotation={[0, 0, -0.055]}
          material={paintMaterial}
          castShadow
        />
        <RoundedBox
          args={[1.05, 0.09, 1.8]}
          radius={0.045}
          smoothness={3}
          position={[-1.68, 0.99, 0]}
          rotation={[0, 0, 0.05]}
          material={paintMaterial}
          castShadow
        />
        <RoundedBox args={[2.3, 0.66, 1.7]} radius={0.16} smoothness={4} position={[-0.15, 1.22, 0]} material={paintMaterial} castShadow />

        {/* Glass: slightly proud of the cabin */}
        <mesh position={[0.98, 1.23, 0]} rotation={[0, 0, -0.48]} material={glassMaterial}>
          <boxGeometry args={[0.07, 0.6, 1.5]} />
        </mesh>
        <mesh position={[-1.3, 1.2, 0]} rotation={[0, 0, 0.52]} material={glassMaterial}>
          <boxGeometry args={[0.07, 0.55, 1.45]} />
        </mesh>
        <mesh position={[-0.3, 1.33, 0.86]} material={glassMaterial}>
          <boxGeometry args={[1.55, 0.4, 0.05]} />
        </mesh>
        <mesh position={[-0.3, 1.33, -0.86]} material={glassMaterial}>
          <boxGeometry args={[1.55, 0.4, 0.05]} />
        </mesh>

        {/* Lights */}
        <mesh position={[2.2, 0.78, 0.55]}>
          <boxGeometry args={[0.08, 0.13, 0.32]} />
          <meshStandardMaterial color="#f5f7f2" emissive="#f5f7f2" emissiveIntensity={1.4} roughness={0.3} />
        </mesh>
        <mesh position={[2.2, 0.78, -0.55]}>
          <boxGeometry args={[0.08, 0.13, 0.32]} />
          <meshStandardMaterial color="#f5f7f2" emissive="#f5f7f2" emissiveIntensity={1.4} roughness={0.3} />
        </mesh>
        <mesh position={[-2.21, 0.8, 0.52]}>
          <boxGeometry args={[0.06, 0.12, 0.38]} />
          <meshStandardMaterial color="#B3382C" emissive="#B3382C" emissiveIntensity={1.3} roughness={0.4} />
        </mesh>
        <mesh position={[-2.21, 0.8, -0.52]}>
          <boxGeometry args={[0.06, 0.12, 0.38]} />
          <meshStandardMaterial color="#B3382C" emissive="#B3382C" emissiveIntensity={1.3} roughness={0.4} />
        </mesh>
        {/* front intake */}
        <mesh position={[2.21, 0.5, 0]}>
          <boxGeometry args={[0.06, 0.16, 0.95]} />
          <meshStandardMaterial color="#141614" roughness={0.7} />
        </mesh>

        {/* Accessory: spoiler */}
        {config.accessory === 'spoiler' && (
          <group>
            <mesh position={[-2.02, 1.2, 0]} rotation={[0, 0, 0.08]} material={paintMaterial} castShadow>
              <boxGeometry args={[0.38, 0.05, 1.55]} />
            </mesh>
            <mesh position={[-1.94, 1.1, 0.5]}>
              <boxGeometry args={[0.16, 0.16, 0.07]} />
              <meshStandardMaterial color="#191c19" roughness={0.5} metalness={0.4} />
            </mesh>
            <mesh position={[-1.94, 1.1, -0.5]}>
              <boxGeometry args={[0.16, 0.16, 0.07]} />
              <meshStandardMaterial color="#191c19" roughness={0.5} metalness={0.4} />
            </mesh>
          </group>
        )}

        {/* Accessory: roof rack */}
        {config.accessory === 'roofrack' && (
          <group>
            <mesh position={[-1.05, 1.6, 0.62]}>
              <boxGeometry args={[0.05, 0.12, 0.05]} />
              <meshStandardMaterial color="#191c19" roughness={0.5} metalness={0.4} />
            </mesh>
            <mesh position={[-1.05, 1.6, -0.62]}>
              <boxGeometry args={[0.05, 0.12, 0.05]} />
              <meshStandardMaterial color="#191c19" roughness={0.5} metalness={0.4} />
            </mesh>
            <mesh position={[0.72, 1.6, 0.62]}>
              <boxGeometry args={[0.05, 0.12, 0.05]} />
              <meshStandardMaterial color="#191c19" roughness={0.5} metalness={0.4} />
            </mesh>
            <mesh position={[0.72, 1.6, -0.62]}>
              <boxGeometry args={[0.05, 0.12, 0.05]} />
              <meshStandardMaterial color="#191c19" roughness={0.5} metalness={0.4} />
            </mesh>
            <mesh position={[-0.165, 1.67, 0.62]} castShadow>
              <boxGeometry args={[2.05, 0.045, 0.08]} />
              <meshStandardMaterial color="#191c19" roughness={0.5} metalness={0.4} />
            </mesh>
            <mesh position={[-0.165, 1.67, -0.62]} castShadow>
              <boxGeometry args={[2.05, 0.045, 0.08]} />
              <meshStandardMaterial color="#191c19" roughness={0.5} metalness={0.4} />
            </mesh>
          </group>
        )}
      </group>

      {/* Wheels stay grounded regardless of rideHeight. */}
      {WHEEL_POSITIONS.map((p) => (
        <Wheel key={`${p[0]}-${p[2]}`} rimStyle={config.rimStyle} rimMaterial={rimMaterial} position={p} />
      ))}

      {/* Soft contact shadow under the car. Skipped in dark mode: on GPUs
          where the half-float depth target misbehaves (sandboxed/software
          WebGL) this plane renders as an opaque light patch, which glares
          against the charcoal stage. The pedestal + grid still ground the
          car without it. */}
      {!dark && (
        <ContactShadows position={[0, 0.02, 0]} scale={11} blur={2.4} opacity={0.55} far={4} resolution={512} />
      )}

      <OrbitControls
        ref={controlsRef}
        makeDefault
        target={[0, 0.5, 0]}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={0.15}
        maxPolarAngle={1.45}
        minDistance={3}
        maxDistance={9}
      />
    </>
  )
})

// ── (no defensive wrappers needed anymore: the scene is fully procedural) ──
