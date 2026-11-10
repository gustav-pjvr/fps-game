import * as THREE from 'three';
import { WATCH_TOWER_ROOF_TOP } from './towerDesign.ts';
import { EXTRACTION_RADIUS, EXTRACTION_SECONDS, type MissionPoint, type MissionSites, type MissionView } from '../core/mission/missionState.ts';
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
/** Seconds per pulse while the hack or the upload runs. */
const PULSE_PERIOD = 1.1;
/** Steady beam brightness: waiting, and done. Additive over a bright dusk sky, so kept low: the
 * beam stays amber or cyan instead of washing out to cream under ACES. */
const BEAM_IDLE = 0.32;
const BEAM_DONE = 0.5;
/** The data core: a small bright crystal, seen from across a lab or a room. */
const CORE_RADIUS = 0.26;

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

/** `fromGround` starts an outdoor beam at the terrain instead of a tower's roof: the data core's. */
function createBeam(x: number, z: number, indoor: IndoorBeaconSite | null, fromGround = false): Beam {
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
  mesh.position.set(x, indoor ? FACILITY_CONSOLE_HEIGHT : sampleHeight(x, z) + (fromGround ? 0 : WATCH_TOWER_ROOF_TOP + 0.2), z);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return { mesh, material };
}

/**
 * Operation Uplink's world visuals (docs/uplink.md): a beam over the terminal, the relay and the
 * extraction point, amber while waiting, pulsing while the hack or the upload runs, cyan once done;
 * a ground ring at the extraction; and the data core itself, a cyan crystal in a turning amber
 * ring, with a beam over wherever it lies. Accent light only (unlit and additive materials, never a
 * light), so bloom picks them out against the dusk sky the same way it does the weapon glow, and
 * the match's light count does not change. On the Facility each site is a console
 * (FacilityConsoles) and its beam a shaft from the console to the ceiling.
 */
export class UplinkBeacons {
  private readonly root = new THREE.Group();
  private readonly terminalBeam: Beam;
  private readonly relayBeam: Beam;
  private readonly extractionBeam: Beam;
  private readonly coreBeam: Beam;
  /** The indoor core beam's built height, which update() rescales to the ceiling over the core. */
  private readonly coreBeamHeight: number;
  private readonly core = new THREE.Group();
  private readonly coreCrystal: THREE.Mesh;
  private readonly coreHalo: THREE.Mesh;
  private readonly coreMaterial: THREE.MeshBasicMaterial;
  private readonly haloMaterial: THREE.MeshBasicMaterial;
  private readonly ring: THREE.Mesh;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly cyan = new THREE.Color(ACCENT_CYAN);
  private readonly amber = new THREE.Color(ACCENT_AMBER);
  private readonly consoles: FacilityConsoles | null;

  constructor(
    private readonly scene: THREE.Scene,
    sites: MissionSites,
    consoles: readonly MissionPoint[],
    private readonly indoor: IndoorBeaconSite | null = null,
  ) {
    this.terminalBeam = createBeam(sites.breach.x, sites.breach.z, indoor);
    this.relayBeam = createBeam(sites.relay.x, sites.relay.z, indoor);
    this.extractionBeam = createBeam(sites.extraction.x, sites.extraction.z, indoor);
    this.coreBeam = createBeam(sites.core.x, sites.core.z, indoor, true);
    this.coreBeamHeight = indoor ? Math.max(0.5, indoor.ceilingAt(sites.core.x, sites.core.z) - FACILITY_CONSOLE_HEIGHT - 0.05) : BEAM_HEIGHT;
    this.consoles = indoor && consoles.length > 0 ? new FacilityConsoles(scene, indoor.physics, consoles) : null;
    (this.extractionBeam.material.uniforms.uColor!.value as THREE.Color).copy(this.cyan);
    (this.coreBeam.material.uniforms.uColor!.value as THREE.Color).copy(this.cyan);

    this.coreMaterial = new THREE.MeshBasicMaterial({ color: ACCENT_CYAN, toneMapped: false, fog: false });
    this.haloMaterial = new THREE.MeshBasicMaterial({ color: ACCENT_AMBER, toneMapped: false, fog: false });
    this.coreCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(CORE_RADIUS), this.coreMaterial);
    this.coreCrystal.scale.y = 1.5;
    this.coreHalo = new THREE.Mesh(new THREE.TorusGeometry(CORE_RADIUS * 1.9, 0.022, 6, 32), this.haloMaterial);
    this.coreHalo.rotation.x = Math.PI / 2;
    this.core.add(this.coreCrystal, this.coreHalo);

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
    const { x, z } = sites.extraction;
    this.ring.position.set(x, sampleHeight(x, z) + 0.08, z);
    this.ring.renderOrder = 2;

    for (const beam of this.beams()) this.root.add(beam.mesh);
    this.root.add(this.core, this.ring);
    scene.add(this.root);
  }

  /** `corePosition` is where the core rests or was dropped (unused while it is carried or plugged
   * in); `time` in seconds, for the pulse and the core's turn; `reducedMotion` holds both still. */
  update(view: MissionView, corePosition: THREE.Vector3, time: number, reducedMotion: boolean): void {
    const pulse = reducedMotion ? 0.55 : 0.4 + 0.3 * (0.5 + 0.5 * Math.sin((time * Math.PI * 2) / PULSE_PERIOD));
    const { phase } = view;

    const hacked = view.hack.progress >= 1;
    this.paint(this.terminalBeam, hacked ? this.cyan : this.amber, hacked ? BEAM_DONE : view.hack.paused ? BEAM_IDLE : pulse);

    // The relay shows once there is something to bring to it.
    const uploaded = view.upload.progress >= 1;
    this.relayBeam.mesh.visible = view.stageNumber >= 2;
    this.paint(
      this.relayBeam,
      uploaded ? this.cyan : this.amber,
      uploaded ? BEAM_DONE : phase === 'defend' && !view.upload.paused ? pulse : view.core.state === 'carried' ? BEAM_DONE : BEAM_IDLE,
    );

    const coreShown = phase === 'fetch' && (view.core.state === 'home' || view.core.state === 'dropped');
    this.core.visible = coreShown;
    this.coreBeam.mesh.visible = coreShown;
    if (coreShown) {
      this.core.position.copy(corePosition);
      if (!reducedMotion) {
        this.coreCrystal.rotation.y = time * 1.2;
        this.coreHalo.rotation.set(Math.PI / 2 + 0.35 * Math.sin(time * 0.9), 0, time * 0.7);
      }
      const beam = this.coreBeam.mesh;
      if (this.indoor) {
        beam.position.set(corePosition.x, corePosition.y + CORE_RADIUS * 1.5, corePosition.z);
        beam.scale.y = Math.max(0.2, this.indoor.ceilingAt(corePosition.x, corePosition.z) - beam.position.y - 0.05) / this.coreBeamHeight;
      } else {
        // From the ground above an underground core, so the lab it lies in can be found.
        beam.position.set(corePosition.x, Math.max(corePosition.y, sampleHeight(corePosition.x, corePosition.z)), corePosition.z);
      }
      this.coreBeam.material.uniforms.uIntensity!.value = 0.3 + 0.5 * pulse;
    }

    const extractionOpen = view.stageNumber === 4;
    this.extractionBeam.mesh.visible = extractionOpen;
    this.ring.visible = extractionOpen;
    if (extractionOpen) {
      // Brighter and steadier as the countdown runs down.
      const urgency = 1 - view.extractionLeft / EXTRACTION_SECONDS;
      this.extractionBeam.material.uniforms.uIntensity!.value = 0.55 + 0.4 * urgency;
      this.ringMaterial.opacity = 0.55 + 0.45 * Math.max(urgency, reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(time * 3));
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.consoles?.dispose();
    for (const beam of this.beams()) {
      beam.mesh.geometry.dispose();
      beam.material.dispose();
    }
    for (const mesh of [this.coreCrystal, this.coreHalo, this.ring]) mesh.geometry.dispose();
    this.coreMaterial.dispose();
    this.haloMaterial.dispose();
    this.ringMaterial.dispose();
  }

  private beams(): Beam[] {
    return [this.terminalBeam, this.relayBeam, this.extractionBeam, this.coreBeam];
  }

  private paint(beam: Beam, color: THREE.Color, intensity: number): void {
    (beam.material.uniforms.uColor!.value as THREE.Color).copy(color);
    beam.material.uniforms.uIntensity!.value = intensity;
  }
}
