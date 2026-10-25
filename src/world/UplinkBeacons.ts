import * as THREE from 'three';
import { WATCH_TOWER_ROOF_TOP } from './towerDesign.ts';
import { EXTRACTION_RADIUS, type MissionView } from '../core/mission/missionState.ts';
import { ACCENT_AMBER, ACCENT_CYAN } from '../render/look.ts';
import { sampleHeight } from './TerrainGenerator.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { FACILITY_CONSOLE_HEIGHT, FacilityConsoles } from './facility/facilityConsoles.ts';

const BEAM_HEIGHT = 140;
const BEAM_RADIUS = 1.1;
/** Indoors the beam is a slim shaft from the console's cap to the ceiling. */
const INDOOR_BEAM_RADIUS = 0.28;

/** An indoor mission site (the Facility): a console at every point, and beams that stop at the
 * ceiling instead of rising into the sky. */
export interface IndoorBeaconSite {
  readonly physics: PhysicsWorld;
  ceilingAt(x: number, z: number): number;
}
/** Seconds per pulse while an uplink uploads. */
const PULSE_PERIOD = 1.1;

const beamVertex = /* glsl */ `
  varying float vHeight;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  void main() {
    vHeight = uv.y;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-view.xyz);
    gl_Position = projectionMatrix * view;
  }
`;

const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vHeight;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  void main() {
    // Bright core seen face on, soft at the silhouette; fades out toward the top.
    float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float core = pow(facing, 3.0);
    float rise = pow(1.0 - vHeight, 1.4);
    gl_FragColor = vec4(uColor * uIntensity * core * rise, 1.0);
  }
`;

interface Beam {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
}

function createBeam(x: number, z: number, indoor: IndoorBeaconSite | null): Beam {
  const material = new THREE.ShaderMaterial({
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    uniforms: { uColor: { value: new THREE.Color(ACCENT_AMBER) }, uIntensity: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const height = indoor ? Math.max(0.5, indoor.ceilingAt(x, z) - FACILITY_CONSOLE_HEIGHT - 0.05) : BEAM_HEIGHT;
  const radius = indoor ? INDOOR_BEAM_RADIUS : BEAM_RADIUS;
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 20, 1, true);
  geometry.translate(0, height / 2, 0);
  const mesh = new THREE.Mesh(geometry, material);
  // Rises from the lookout roof, around its mast, so the tower itself stays readable; indoors from
  // the console's beacon cap.
  mesh.position.set(x, indoor ? FACILITY_CONSOLE_HEIGHT : sampleHeight(x, z) + WATCH_TOWER_ROOF_TOP + 0.2, z);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return { mesh, material };
}

/**
 * The Uplink mission's world visuals (docs/visual-overhaul.md, phase 4): a beam over each uplink
 * tower, amber while pending, pulsing amber while it uploads, cyan once online; and once all three
 * are online, a cyan beam and a ground ring at the extraction tower. Accent light only, so bloom
 * picks the beams out against the dusk sky the same way it does the weapon glow. On the Facility
 * each point is a console (FacilityConsoles) and its beam a shaft from the console to the ceiling.
 */
export class UplinkBeacons {
  private readonly root = new THREE.Group();
  private readonly uplinkBeams: Beam[];
  private readonly extractionBeam: Beam;
  private readonly ring: THREE.Mesh;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly cyan = new THREE.Color(ACCENT_CYAN);
  private readonly amber = new THREE.Color(ACCENT_AMBER);
  private readonly consoles: FacilityConsoles | null;

  constructor(private readonly scene: THREE.Scene, initial: MissionView, indoor: IndoorBeaconSite | null = null) {
    this.uplinkBeams = initial.uplinks.map((uplink) => createBeam(uplink.x, uplink.z, indoor));
    this.extractionBeam = createBeam(initial.extraction.x, initial.extraction.z, indoor);
    this.consoles = indoor ? new FacilityConsoles(scene, indoor.physics, [...initial.uplinks, initial.extraction]) : null;
    this.extractionBeam.material.uniforms.uColor!.value = this.cyan.clone();
    this.extractionBeam.mesh.visible = false;

    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: ACCENT_CYAN,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const ringGeometry = new THREE.RingGeometry(EXTRACTION_RADIUS - 0.35, EXTRACTION_RADIUS, 64);
    ringGeometry.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeometry, this.ringMaterial);
    const { x, z } = initial.extraction;
    this.ring.position.set(x, sampleHeight(x, z) + 0.08, z);
    this.ring.visible = false;
    this.ring.renderOrder = 2;

    for (const beam of this.uplinkBeams) this.root.add(beam.mesh);
    this.root.add(this.extractionBeam.mesh, this.ring);
    scene.add(this.root);
  }

  /** `time` in seconds, for the pulse; `reducedMotion` holds the pulse at a steady glow. */
  update(view: MissionView, time: number, reducedMotion: boolean): void {
    // Additive over a bright dusk sky: kept low so the beam stays amber or cyan instead of washing out
    // to cream under ACES.
    const pulse = reducedMotion ? 0.55 : 0.4 + 0.3 * (0.5 + 0.5 * Math.sin((time * Math.PI * 2) / PULSE_PERIOD));
    view.uplinks.forEach((uplink, index) => {
      const beam = this.uplinkBeams[index];
      if (!beam) return;
      const uniforms = beam.material.uniforms;
      (uniforms.uColor!.value as THREE.Color).copy(uplink.status === 'online' ? this.cyan : this.amber);
      uniforms.uIntensity!.value = uplink.status === 'uploading' ? pulse : uplink.status === 'online' ? 0.5 : 0.32;
    });
    const extractionOpen = view.phase === 'extract' || view.phase === 'won';
    this.extractionBeam.mesh.visible = extractionOpen;
    this.ring.visible = extractionOpen;
    if (extractionOpen) {
      this.extractionBeam.material.uniforms.uIntensity!.value = 0.55 + 0.4 * view.extractionProgress;
      this.ringMaterial.opacity = 0.55 + 0.45 * Math.max(view.extractionProgress, reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 3));
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.consoles?.dispose();
    for (const beam of [...this.uplinkBeams, this.extractionBeam]) {
      beam.mesh.geometry.dispose();
      beam.material.dispose();
    }
    this.ring.geometry.dispose();
    this.ringMaterial.dispose();
  }
}
