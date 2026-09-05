// 3D Asset engine: Gaussian Splats, glTF meshes, and Kinect-style point clouds,
// sharing one persistent THREE.WebGLRenderer + THREE.PerspectiveCamera the same
// way WebGLGenerativeRenderer (generatives.ts) shares one WebGL context across
// every generative layer -- render into the shared canvas, caller blits it into
// a per-layer offscreen canvas immediately, then the next layer reuses it.
import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { GenerativeParameter } from './generatives';

export type ThreeDKind = 'mesh' | 'splat' | 'kinect';

// --- Parameter registry -----------------------------------------------------
// Same shape as GenerativeParameter so renderKnob/sortParamsForDisplay in
// App.tsx can render these with zero changes to that machinery.
export const THREE_D_PARAMETERS: GenerativeParameter[] = [
  { name: 'pitch', min: -89, max: 89, default: 0, type: 'number' },
  { name: 'yaw', min: -180, max: 180, default: 0, type: 'number' },
  { name: 'roll', min: -180, max: 180, default: 0, type: 'number' },
  { name: 'zoom', min: 0.3, max: 4, default: 1, type: 'number' },
  { name: 'fov', min: 20, max: 110, default: 60, type: 'number' },
  { name: 'bg', min: 0, max: 0.3, default: 0, type: 'number' },
  { name: 'pos_x', min: -150, max: 150, default: 0, type: 'number' },
  { name: 'pos_y', min: -150, max: 150, default: 0, type: 'number' },
  { name: 'pos_z', min: -150, max: 150, default: 0, type: 'number' },
  { name: 'rot_x', min: -180, max: 180, default: 0, type: 'number' },
  { name: 'rot_y', min: -180, max: 180, default: 0, type: 'number' },
  { name: 'rot_z', min: -180, max: 180, default: 0, type: 'number' },
  { name: 'glitch', min: 0, max: 100, default: 0, type: 'number' },
  { name: 'point_cloud', min: 0, max: 100, default: 0, type: 'number' },
  { name: 'clip_radius', min: 10, max: 150, default: 100, type: 'number' },
  { name: 'clip_w', min: 10, max: 150, default: 100, type: 'number' },
  { name: 'clip_h', min: 10, max: 150, default: 100, type: 'number' },
  { name: 'clip_d', min: 10, max: 150, default: 100, type: 'number' },
];

export type ClipMode = 'off' | 'sphere' | 'box';

export interface ThreeDRenderParams {
  pitch: number; yaw: number; roll: number; zoom: number; fov: number; bg: number;
  pos_x: number; pos_y: number; pos_z: number; rot_x: number; rot_y: number; rot_z: number;
  glitch: number; point_cloud: number;
  clip_radius: number; clip_w: number; clip_h: number; clip_d: number;
  clipMode: ClipMode;
}

// --- File-kind detection -----------------------------------------------------

export function detectThreeDAssetKindByExt(filename: string): ThreeDKind | 'ply-ambiguous' | 'unsupported-sog' | null {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'glb' || ext === 'gltf') return 'mesh';
  if (ext === 'splat' || ext === 'ksplat') return 'splat';
  if (ext === 'sog') return 'unsupported-sog'; // SOGS transcode not implemented this pass
  if (ext === 'ply') return 'ply-ambiguous';
  return null;
}

export async function detectPlyKind(file: File): Promise<'splat' | 'kinect'> {
  try {
    const headerBuf = await file.slice(0, 8192).text();
    const isSplat = /property\s+\S+\s+(f_dc_0|scale_0|opacity)\b/.test(headerBuf);
    return isSplat ? 'splat' : 'kinect';
  } catch {
    return 'kinect';
  }
}

export const THREE_D_ACCEPT = '.glb,.gltf,.ply,.splat,.ksplat';

// --- Kinect wire format -------------------------------------------------------

export interface KinectMeta { outWidth: number; outHeight: number; step: number; floatsPerPoint: number; }

// --- Internal per-layer state -------------------------------------------------

interface CameraOrbitState {
  pitch: number; yaw: number; roll: number; radius: number;
  anchor: THREE.Vector3;
}

interface LayerState {
  kind: ThreeDKind;
  scene: THREE.Scene;
  content: THREE.Object3D | null;     // the thing Position transform applies to
  splatViewer: any | null;            // GaussianSplats3D.Viewer, splat kind only
  loadToken: number;
  loading: boolean;
  loadError: string | null;
  boundingRadius: number;
  boundingCenter: THREE.Vector3;
  camera: CameraOrbitState;
  raycastSamples: Float32Array | null; // world-space xyz triples, capped ~6000 points
  glitchSeed: number;
  // mesh-only
  meshNodes: THREE.Mesh[];
  meshPointCloud: THREE.Points | null;
  // kinect-only
  kinectGeometry: THREE.BufferGeometry | null;
  kinectMaterial: THREE.ShaderMaterial | null;
  kinectPoints: THREE.Points | null;
  kinectSocket: WebSocket | null;
  kinectMeta: KinectMeta | null;
  kinectUsingSynthetic: boolean;
  kinectError: string | null;
  kinectPointCount: number;
}

function disposeObject3D(obj: THREE.Object3D | null) {
  if (!obj) return;
  obj.traverse((o: any) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const key of Object.keys(m)) {
          const v = (m as any)[key];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    }
  });
  obj.parent?.remove(obj);
}

function clampNum(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

// --- Synthetic Kinect demo: colored torus-knot point cloud -------------------

function buildSyntheticKinectPoints(): { positions: Float32Array; colors: Float32Array } {
  const geo = new THREE.TorusKnotGeometry(1.1, 0.38, 400, 60);
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const color = new THREE.Color();
  for (let i = 0; i < n; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
    const hue = (i / n + 0.0) % 1;
    color.setHSL(hue, 0.75, 0.55);
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
  }
  geo.dispose();
  return { positions, colors };
}

// --- Kinect shader (glitch + clip + point-cloud sizing shared with splat/mesh idea) --

const KINECT_VERTEX_SHADER = `
  attribute vec3 color;
  uniform float uPointSize;
  uniform float uGlitch;
  uniform float uTime;
  uniform int uClipMode; // 0 off, 1 sphere, 2 box
  uniform vec3 uClipCenter;
  uniform float uClipRadius;
  uniform vec3 uClipBox;
  varying vec3 vColor;
  varying float vDiscard;
  void main() {
    vColor = color;
    vec3 p = position;
    if (uGlitch > 0.0) {
      float n = sin(p.x * 12.9898 + p.y * 78.233 + p.z * 37.719 + uTime * 3.0) * 43758.5453;
      float jitter = fract(n) - 0.5;
      p += normalize(p + vec3(0.001)) * jitter * uGlitch;
    }
    vDiscard = 0.0;
    if (uClipMode == 1) {
      if (distance(p, uClipCenter) > uClipRadius) vDiscard = 1.0;
    } else if (uClipMode == 2) {
      vec3 d = abs(p - uClipCenter);
      if (d.x > uClipBox.x || d.y > uClipBox.y || d.z > uClipBox.z) vDiscard = 1.0;
    }
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uPointSize * (300.0 / -mvPosition.z);
    gl_Position = vDiscard > 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mvPosition;
  }
`;

const KINECT_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vDiscard;
  void main() {
    if (vDiscard > 0.5) discard;
    vec2 c = gl_PointCoord - vec2(0.5);
    if (dot(c, c) > 0.25) discard;
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

// --- The engine ----------------------------------------------------------------

export class ThreeDEngine {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  private layers = new Map<string, LayerState>();
  private gltfLoader: GLTFLoader;
  private dracoLoader: DRACOLoader;
  private clock = new THREE.Clock();

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.renderer.localClippingEnabled = true;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100000);
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/');
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder as any);
  }

  get canvas(): HTMLCanvasElement { return this.renderer.domElement; }

  resize(w: number, h: number) {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
    }
  }

  hasLayer(layerId: string) { return this.layers.has(layerId); }

  getBoundingRadius(layerId: string): number {
    return this.layers.get(layerId)?.boundingRadius ?? 1;
  }

  getCameraOrbit(layerId: string): CameraOrbitState | null {
    return this.layers.get(layerId)?.camera ?? null;
  }

  getLoadError(layerId: string): string | null {
    return this.layers.get(layerId)?.loadError ?? null;
  }

  isLoading(layerId: string): boolean {
    return this.layers.get(layerId)?.loading ?? false;
  }

  // --- lifecycle -------------------------------------------------------------

  private ensureLayerState(layerId: string): LayerState {
    let st = this.layers.get(layerId);
    if (!st) {
      const scene = new THREE.Scene();
      const hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 1.1);
      scene.add(hemi);
      const key = new THREE.DirectionalLight(0xffffff, 1.0);
      key.position.set(3, 5, 4);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xffffff, 0.35);
      fill.position.set(-4, 2, -3);
      scene.add(fill);
      st = {
        kind: 'mesh', scene, content: null, splatViewer: null,
        loadToken: 0, loading: false, loadError: null,
        boundingRadius: 1, boundingCenter: new THREE.Vector3(),
        camera: { pitch: 10, yaw: 0, roll: 0, radius: 3, anchor: new THREE.Vector3() },
        raycastSamples: null, glitchSeed: Math.random() * 1000,
        meshNodes: [], meshPointCloud: null,
        kinectGeometry: null, kinectMaterial: null, kinectPoints: null,
        kinectSocket: null, kinectMeta: null, kinectUsingSynthetic: true,
        kinectError: null, kinectPointCount: 0,
      };
      this.layers.set(layerId, st);
    }
    return st;
  }

  disposeLayer(layerId: string) {
    const st = this.layers.get(layerId);
    if (!st) return;
    st.loadToken++;
    if (st.kinectSocket) { try { st.kinectSocket.close(); } catch {} st.kinectSocket = null; }
    if (st.splatViewer) {
      try { st.splatViewer.dispose(); } catch {}
      st.splatViewer = null;
    }
    disposeObject3D(st.content);
    if (st.meshPointCloud) disposeObject3D(st.meshPointCloud);
    if (st.kinectPoints) disposeObject3D(st.kinectPoints);
    st.kinectGeometry?.dispose();
    st.kinectMaterial?.dispose();
    this.layers.delete(layerId);
  }

  disposeAll() {
    for (const id of Array.from(this.layers.keys())) this.disposeLayer(id);
  }

  // --- loading -----------------------------------------------------------------

  async ensureLayer(layerId: string, kind: ThreeDKind, src: string | null): Promise<void> {
    const st = this.ensureLayerState(layerId);
    if (!src) return;
    const cacheKey = `${kind}:${src}`;
    if ((st as any)._lastCacheKey === cacheKey && !st.loadError) return;
    (st as any)._lastCacheKey = cacheKey;

    const myToken = ++st.loadToken;
    st.loading = true;
    st.loadError = null;
    try {
      // tear down any previously loaded content for this layer before loading new content
      if (st.splatViewer) { try { st.splatViewer.dispose(); } catch {} st.splatViewer = null; }
      disposeObject3D(st.content);
      st.content = null;
      if (st.meshPointCloud) { disposeObject3D(st.meshPointCloud); st.meshPointCloud = null; }
      st.meshNodes = [];

      if (kind === 'mesh') {
        await this.loadMesh(st, src, myToken);
      } else if (kind === 'splat') {
        await this.loadSplat(st, src, myToken);
      } else {
        this.setupKinect(st, myToken);
      }
      if (myToken !== st.loadToken) return; // superseded by a newer load
      st.kind = kind;
    } catch (err: any) {
      if (myToken !== st.loadToken) return;
      console.error('[ThreeDEngine] load error', err);
      st.loadError = err?.message || 'Failed to load 3D asset.';
    } finally {
      if (myToken === st.loadToken) st.loading = false;
    }
  }

  private async loadMesh(st: LayerState, url: string, token: number) {
    const gltf = await this.gltfLoader.loadAsync(url);
    if (token !== st.loadToken) return;
    const group = gltf.scene || gltf.scenes[0];
    st.scene.add(group);
    st.content = group;
    const meshNodes: THREE.Mesh[] = [];
    group.traverse((o: any) => { if (o.isMesh) meshNodes.push(o); });
    st.meshNodes = meshNodes;
    this.computeMeshBounds(st);
  }

  private computeMeshBounds(st: LayerState) {
    const budget = 6000;
    const totalVerts = st.meshNodes.reduce((s, m) => s + (m.geometry.attributes.position?.count || 0), 0) || 1;
    const samples: THREE.Vector3[] = [];
    for (const m of st.meshNodes) {
      const posAttr = m.geometry.attributes.position;
      if (!posAttr) continue;
      m.updateWorldMatrix(true, false);
      const share = Math.max(1, Math.round(budget * (posAttr.count / totalVerts)));
      const step = Math.max(1, Math.floor(posAttr.count / share));
      for (let i = 0; i < posAttr.count; i += step) {
        samples.push(new THREE.Vector3().fromBufferAttribute(posAttr, i).applyMatrix4(m.matrixWorld));
      }
    }
    this.finishBoundsFromSamples(st, samples);
  }

  private finishBoundsFromSamples(st: LayerState, samples: THREE.Vector3[]) {
    if (samples.length === 0) {
      st.boundingCenter.set(0, 0, 0);
      st.boundingRadius = 1;
      st.raycastSamples = new Float32Array(0);
    } else {
      const centroid = new THREE.Vector3();
      for (const p of samples) centroid.add(p);
      centroid.divideScalar(samples.length);
      const dists = samples.map(p => p.distanceTo(centroid)).sort((a, b) => a - b);
      const idx = Math.min(dists.length - 1, Math.floor(dists.length * 0.75));
      const radius = Math.max(0.01, dists[idx] || 1);
      st.boundingCenter.copy(centroid);
      st.boundingRadius = radius;
      const arr = new Float32Array(samples.length * 3);
      samples.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; });
      st.raycastSamples = arr;
    }
    st.camera.anchor.copy(st.boundingCenter);
    st.camera.radius = st.boundingRadius * 2.6;
  }

  private async loadSplat(st: LayerState, url: string, token: number) {
    const viewer = new (GaussianSplats3D as any).Viewer({
      renderer: this.renderer,
      camera: this.camera,
      selfDrivenMode: false,
      useBuiltInControls: false,
      gpuAcceleratedSort: false,
      sharedMemoryForWorkers: typeof self !== 'undefined' && (self as any).crossOriginIsolated === true,
      dropInMode: false,
    });
    await viewer.addSplatScene(url, { showLoadingUI: false });
    if (token !== st.loadToken) { try { viewer.dispose(); } catch {} return; }
    st.splatViewer = viewer;
    const splatMesh = viewer.getSplatMesh();
    st.content = splatMesh;

    // Sample splat centers for bounding radius + anchor raycasting (guide's 75th-percentile technique)
    const total = splatMesh?.getSplatCount ? splatMesh.getSplatCount() : 0;
    const budget = Math.min(6000, total || 0);
    const samples: THREE.Vector3[] = [];
    if (budget > 0 && splatMesh?.getSplatCenter) {
      const step = Math.max(1, Math.floor(total / budget));
      const tmp = new THREE.Vector3();
      for (let i = 0; i < total; i += step) {
        try {
          splatMesh.getSplatCenter(i, tmp, true);
          samples.push(tmp.clone());
        } catch { /* ignore individual sample failures */ }
      }
    }
    this.finishBoundsFromSamples(st, samples);
  }

  private setupKinect(st: LayerState, _token: number) {
    const { positions, colors } = buildSyntheticKinectPoints();
    this.applyKinectPointBuffer(st, positions, colors);
    st.kinectUsingSynthetic = true;
    const dists: number[] = [];
    for (let i = 0; i < positions.length; i += 3) {
      dists.push(Math.hypot(positions[i], positions[i + 1], positions[i + 2]));
    }
    dists.sort((a, b) => a - b);
    const radius = dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.75))] || 1.5;
    st.boundingCenter.set(0, 0, 0);
    st.boundingRadius = Math.max(0.5, radius);
    st.camera.anchor.set(0, 0, 0);
    st.camera.radius = st.boundingRadius * 2.6;
    const budget = Math.min(6000, positions.length / 3);
    const step = Math.max(1, Math.floor((positions.length / 3) / budget));
    const arr: number[] = [];
    for (let i = 0; i < positions.length / 3; i += step) arr.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    st.raycastSamples = new Float32Array(arr);
  }

  private applyKinectPointBuffer(st: LayerState, positions: Float32Array, colors: Float32Array) {
    if (st.kinectPoints) { disposeObject3D(st.kinectPoints); st.kinectPoints = null; }
    st.kinectGeometry?.dispose();
    st.kinectMaterial?.dispose();

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uPointSize: { value: 2.5 },
        uGlitch: { value: 0 },
        uTime: { value: 0 },
        uClipMode: { value: 0 },
        uClipCenter: { value: new THREE.Vector3() },
        uClipRadius: { value: 100 },
        uClipBox: { value: new THREE.Vector3(100, 100, 100) },
      },
      vertexShader: KINECT_VERTEX_SHADER,
      fragmentShader: KINECT_FRAGMENT_SHADER,
      transparent: false,
    });
    const points = new THREE.Points(geo, mat);
    st.scene.add(points);
    st.kinectGeometry = geo;
    st.kinectMaterial = mat;
    st.kinectPoints = points;
    st.content = points;
    st.kinectPointCount = positions.length / 3;
  }

  // --- Kinect live connection --------------------------------------------------

  connectKinect(layerId: string, url: string) {
    const st = this.ensureLayerState(layerId);
    this.disconnectKinect(layerId);
    st.kinectError = null;
    try {
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => { st.kinectUsingSynthetic = false; };
      socket.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          try {
            const meta = JSON.parse(ev.data);
            if (meta?.type === 'meta') {
              st.kinectMeta = { outWidth: meta.outWidth, outHeight: meta.outHeight, step: meta.step, floatsPerPoint: meta.floatsPerPoint };
            }
          } catch { /* ignore malformed meta */ }
          return;
        }
        const floats = new Float32Array(ev.data as ArrayBuffer);
        const n = Math.floor(floats.length / 3);
        const positions = new Float32Array(n * 3);
        const colors = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const mmx = floats[i * 3], mmy = floats[i * 3 + 1], mmz = floats[i * 3 + 2];
          positions[i * 3] = mmx / 1000; positions[i * 3 + 1] = mmy / 1000; positions[i * 3 + 2] = mmz / 1000;
          const depthNorm = clampNum(mmz / 4500, 0, 1);
          colors[i * 3] = 0.2 + depthNorm * 0.8; colors[i * 3 + 1] = 0.6 - depthNorm * 0.4; colors[i * 3 + 2] = 1.0 - depthNorm * 0.6;
        }
        this.applyKinectPointBuffer(st, positions, colors);
      };
      socket.onerror = () => { st.kinectError = 'Could not connect to the Kinect stream.'; };
      socket.onclose = () => { if (st.kinectSocket === socket) st.kinectSocket = null; };
      st.kinectSocket = socket;
    } catch (err: any) {
      st.kinectError = err?.message || 'Could not connect to the Kinect stream.';
    }
  }

  disconnectKinect(layerId: string) {
    const st = this.layers.get(layerId);
    if (!st) return;
    if (st.kinectSocket) { try { st.kinectSocket.close(); } catch {} st.kinectSocket = null; }
    st.kinectUsingSynthetic = true;
    this.setupKinect(st, st.loadToken);
  }

  useSyntheticKinectDemo(layerId: string) {
    this.disconnectKinect(layerId);
  }

  getKinectError(layerId: string): string | null {
    return this.layers.get(layerId)?.kinectError ?? null;
  }

  isKinectLive(layerId: string): boolean {
    const st = this.layers.get(layerId);
    return !!st && !st.kinectUsingSynthetic && !!st.kinectSocket;
  }

  // --- camera / anchor navigation ------------------------------------------------

  setCameraOrbit(layerId: string, patch: Partial<CameraOrbitState>) {
    const st = this.ensureLayerState(layerId);
    if (patch.pitch !== undefined) st.camera.pitch = clampNum(patch.pitch, -89, 89);
    if (patch.yaw !== undefined) st.camera.yaw = ((patch.yaw % 360) + 360) % 360 > 180 ? (patch.yaw % 360) - 360 : patch.yaw % 360;
    if (patch.roll !== undefined) st.camera.roll = patch.roll;
    if (patch.radius !== undefined) st.camera.radius = Math.max(0.01, patch.radius);
  }

  setAnchor(layerId: string, anchor: THREE.Vector3) {
    const st = this.ensureLayerState(layerId);
    st.camera.anchor.copy(anchor);
  }

  panAnchor(layerId: string, dxNdc: number, dyNdc: number) {
    const st = this.ensureLayerState(layerId);
    const up = st.kind === 'splat' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 1, 0);
    const camPos = this.applySphericalTo(new THREE.Vector3(), st.camera, up);
    const forward = st.camera.anchor.clone().sub(camPos).normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    const trueUp = new THREE.Vector3().crossVectors(right, forward).normalize();
    const scale = st.camera.radius * 0.9;
    const delta = right.multiplyScalar(-dxNdc * scale).add(trueUp.multiplyScalar(dyNdc * scale));
    st.camera.anchor.add(delta);
  }

  moveAnchor(layerId: string, dir: 'up' | 'down' | 'left' | 'right' | 'forward' | 'backward', step?: number) {
    const st = this.ensureLayerState(layerId);
    const up = st.kind === 'splat' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 1, 0);
    const camPos = this.applySphericalTo(new THREE.Vector3(), st.camera, up);
    const forward = st.camera.anchor.clone().sub(camPos).normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    const amt = step ?? st.boundingRadius * 0.08;
    const delta = new THREE.Vector3();
    if (dir === 'left') delta.copy(right).multiplyScalar(-amt);
    else if (dir === 'right') delta.copy(right).multiplyScalar(amt);
    else if (dir === 'up') delta.copy(up).multiplyScalar(amt);
    else if (dir === 'down') delta.copy(up).multiplyScalar(-amt);
    else if (dir === 'forward') delta.copy(forward).multiplyScalar(amt);
    else delta.copy(forward).multiplyScalar(-amt);
    st.camera.anchor.add(delta);
  }

  raycastAnchor(layerId: string, ndcX: number, ndcY: number): THREE.Vector3 | null {
    const st = this.layers.get(layerId);
    if (!st || !st.raycastSamples || st.raycastSamples.length === 0) return null;
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: st.boundingRadius * 0.05 } as any;
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    // Find nearest sample point to the ray (cheap manual test, avoids building a temp Points object every click)
    const ro = raycaster.ray.origin, rd = raycaster.ray.direction;
    let bestT = Infinity, bestDist = Infinity, best: THREE.Vector3 | null = null;
    const tmp = new THREE.Vector3();
    const n = st.raycastSamples.length / 3;
    for (let i = 0; i < n; i++) {
      tmp.set(st.raycastSamples[i * 3], st.raycastSamples[i * 3 + 1], st.raycastSamples[i * 3 + 2]);
      const t = tmp.clone().sub(ro).dot(rd);
      if (t < 0) continue;
      const closest = ro.clone().add(rd.clone().multiplyScalar(t));
      const dist = closest.distanceTo(tmp);
      if (dist < bestDist) { bestDist = dist; bestT = t; best = tmp.clone(); }
    }
    if (!best || bestDist > st.boundingRadius * 0.15) return null;
    return best;
  }

  private applySphericalTo(out: THREE.Vector3, cam: CameraOrbitState, _up: THREE.Vector3): THREE.Vector3 {
    const pitchRad = THREE.MathUtils.degToRad(cam.pitch);
    const yawRad = THREE.MathUtils.degToRad(cam.yaw);
    const cosP = Math.cos(pitchRad);
    out.set(
      cam.anchor.x + cam.radius * cosP * Math.sin(yawRad),
      cam.anchor.y + cam.radius * Math.sin(pitchRad),
      cam.anchor.z + cam.radius * cosP * Math.cos(yawRad),
    );
    return out;
  }

  private applySpherical(st: LayerState) {
    const up = st.kind === 'splat' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 1, 0);
    const pos = this.applySphericalTo(new THREE.Vector3(), st.camera, up);
    this.camera.position.copy(pos);
    this.camera.up.copy(up);
    this.camera.lookAt(st.camera.anchor);
    if (st.camera.roll) this.camera.rotateZ(THREE.MathUtils.degToRad(st.camera.roll));
  }

  // --- per-frame render --------------------------------------------------------

  renderLayer(layerId: string, params: ThreeDRenderParams): HTMLCanvasElement | null {
    const st = this.layers.get(layerId);
    if (!st || st.loading || st.loadError) return null;

    // Camera: base orbit values come from the params (knobs / trigger-modulated),
    // but manual mouse-drag nav (setCameraOrbit/panAnchor/moveAnchor) writes
    // directly into st.camera -- knobs are the source of truth only while the
    // user isn't actively dragging; App.tsx flushes drag results back into the
    // layer's threeDSettings on pointer-up so both stay in sync.
    st.camera.pitch = params.pitch;
    st.camera.yaw = params.yaw;
    st.camera.roll = params.roll;
    st.camera.radius = Math.max(0.01, st.boundingRadius * 2.6 * params.zoom);

    this.camera.fov = params.fov;
    this.camera.updateProjectionMatrix();
    this.applySpherical(st);

    // Position transform (independent of camera/anchor) applied to the loaded content
    if (st.content) {
      const posScale = (st.boundingRadius * 1.5) / 100;
      st.content.position.set(params.pos_x * posScale, params.pos_y * posScale, params.pos_z * posScale);
      st.content.rotation.set(
        THREE.MathUtils.degToRad(params.rot_x),
        THREE.MathUtils.degToRad(params.rot_y),
        THREE.MathUtils.degToRad(params.rot_z),
      );
      st.content.visible = true;
    }

    const t = this.clock.getElapsedTime();
    const clipCenter = st.camera.anchor;
    const clipScale = st.boundingRadius / 100;

    if (st.kind === 'kinect' && st.kinectMaterial) {
      st.kinectMaterial.uniforms.uGlitch.value = (params.glitch / 100) * st.boundingRadius * 0.08;
      st.kinectMaterial.uniforms.uTime.value = t;
      st.kinectMaterial.uniforms.uPointSize.value = 1.0 + (params.point_cloud / 100) * 10.0;
      st.kinectMaterial.uniforms.uClipMode.value = params.clipMode === 'sphere' ? 1 : params.clipMode === 'box' ? 2 : 0;
      st.kinectMaterial.uniforms.uClipCenter.value.copy(clipCenter);
      st.kinectMaterial.uniforms.uClipRadius.value = params.clip_radius * clipScale;
      st.kinectMaterial.uniforms.uClipBox.value.set(params.clip_w * clipScale, params.clip_h * clipScale, params.clip_d * clipScale);
    }

    if (st.kind === 'mesh' && st.content) {
      if (params.glitch > 0) {
        const g = (params.glitch / 100) * st.boundingRadius * 0.05;
        st.content.position.x += Math.sin(t * 13 + st.glitchSeed) * g;
        st.content.position.y += Math.sin(t * 17 + st.glitchSeed * 1.3) * g;
        st.content.position.z += Math.sin(t * 11 + st.glitchSeed * 0.7) * g;
        st.content.rotation.x += Math.sin(t * 9 + st.glitchSeed) * (params.glitch / 100) * 0.05;
        st.content.rotation.y += Math.sin(t * 7 + st.glitchSeed * 1.7) * (params.glitch / 100) * 0.05;
      }
      this.applyMeshPointCloudBlend(st, params.point_cloud);
      this.applyMeshClip(st, params.clipMode, clipCenter, params.clip_w * clipScale, params.clip_h * clipScale, params.clip_d * clipScale);
    }

    if (st.kind === 'splat' && st.content) {
      if (params.glitch > 0) {
        const g = (params.glitch / 100) * st.boundingRadius * 0.05;
        st.content.position.x += Math.sin(t * 13 + st.glitchSeed) * g;
        st.content.position.y += Math.sin(t * 17 + st.glitchSeed * 1.3) * g;
        st.content.position.z += Math.sin(t * 11 + st.glitchSeed * 0.7) * g;
      }
      this.applySplatPointCloud(st, params.point_cloud);
      // Clip Region is a documented no-op for splat this pass (see plan notes) --
      // the library's shader isn't authored with clipping-plane support and we
      // deliberately avoid runtime shader-patching for splats in this pass.
    }

    const bg = params.bg;
    this.renderer.setClearColor(new THREE.Color(bg, bg, bg), 1);
    this.renderer.setScissorTest(false);
    this.renderer.clear();

    if (st.kind === 'splat' && st.splatViewer) {
      this.renderer.clippingPlanes = [];
      st.splatViewer.update();
      st.splatViewer.render();
    } else {
      this.renderer.clippingPlanes = (st.kind === 'mesh' ? this.getMeshClipPlanes(st) : []);
      this.renderer.render(st.scene, this.camera);
      this.renderer.clippingPlanes = [];
    }

    return this.renderer.domElement;
  }

  // --- mesh-only effects -----------------------------------------------------

  private ensureMeshPointCloud(st: LayerState) {
    if (st.meshPointCloud || st.meshNodes.length === 0) return;
    const positions: number[] = [];
    const colors: number[] = [];
    const budgetTotal = 150000;
    const totalVerts = st.meshNodes.reduce((s, m) => s + (m.geometry.attributes.position?.count || 0), 0) || 1;
    const color = new THREE.Color();
    for (const m of st.meshNodes) {
      const posAttr = m.geometry.attributes.position;
      if (!posAttr) continue;
      const mat: any = Array.isArray(m.material) ? m.material[0] : m.material;
      if (mat && mat.color) color.copy(mat.color); else color.set(0xffffff);
      const share = Math.max(1, Math.round(budgetTotal * (posAttr.count / totalVerts)));
      const step = Math.max(1, Math.floor(posAttr.count / share));
      for (let i = 0; i < posAttr.count; i += step) {
        positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        colors.push(color.r, color.g, color.b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: 0.01, vertexColors: true, sizeAttenuation: true });
    const points = new THREE.Points(geo, mat);
    points.visible = false;
    (st.content as THREE.Object3D).add(points);
    st.meshPointCloud = points;
  }

  private applyMeshPointCloudBlend(st: LayerState, pointCloud: number) {
    this.ensureMeshPointCloud(st);
    const showPoints = pointCloud > 50;
    for (const m of st.meshNodes) m.visible = !showPoints;
    if (st.meshPointCloud) {
      st.meshPointCloud.visible = showPoints;
      const mat = st.meshPointCloud.material as THREE.PointsMaterial;
      mat.size = st.boundingRadius * (0.004 + (pointCloud / 100) * 0.012);
    }
  }

  private meshClipPlanesCache = new Map<string, THREE.Plane[]>();
  private getMeshClipPlanes(st: LayerState): THREE.Plane[] {
    return (st as any)._clipPlanes || [];
  }
  private applyMeshClip(st: LayerState, mode: ClipMode, center: THREE.Vector3, hw: number, hh: number, hd: number) {
    if (mode !== 'box') { (st as any)._clipPlanes = []; return; }
    const planes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -(center.x - hw)),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), (center.x + hw)),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -(center.y - hh)),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), (center.y + hh)),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -(center.z - hd)),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), (center.z + hd)),
    ];
    (st as any)._clipPlanes = planes;
  }

  // --- splat-only reduced-scope point-cloud blend -----------------------------

  private applySplatPointCloud(st: LayerState, pointCloud: number) {
    const mesh: any = st.content;
    if (!mesh) return;
    try {
      if (typeof mesh.setPointCloudModeEnabled === 'function') {
        mesh.setPointCloudModeEnabled(pointCloud > 50);
      }
      const viewer = st.splatViewer;
      if (viewer && mesh.geometry && typeof viewer.splatRenderCount === 'number' && pointCloud < 50) {
        const frac = Math.max(0.02, pointCloud / 50);
        mesh.geometry.instanceCount = Math.floor(viewer.splatRenderCount * frac);
      } else if (mesh.geometry && viewer) {
        mesh.geometry.instanceCount = viewer.splatRenderCount ?? mesh.geometry.instanceCount;
      }
    } catch { /* library API surface can vary; degrade silently */ }
  }
}
