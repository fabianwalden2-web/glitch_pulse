// Standalone Kinect wire-format relay/demo server -- NOT bundled by Vite.
// Broadcasts the same {type:"meta"} handshake + raw Float32Array XYZ-triple
// frame format the ThreeDEngine's live Kinect client expects, using a
// synthetic colored torus-knot as a stand-in for real sensor data. Useful for
// testing the whole live-Kinect pipeline end-to-end without hardware.
//
// A real Kinect-v2 capture bridge (reading the physical sensor via the
// Windows Kinect SDK / a native driver) is NOT implemented here -- that's a
// hardware-specific integration outside what this script can build or verify
// without the device. Replace getNextFrame() below with real sensor frames
// to go from demo to live hardware.
//
// Usage: node scripts/kinect-relay-server.cjs [port]

const { WebSocketServer } = require('ws');

const PORT = Number(process.argv[2]) || 8787;
const POINT_COUNT = 20000;

// Precompute a torus-knot point cloud once (millimetres, camera-space-ish).
function buildTorusKnotPoints(count) {
  const points = new Float32Array(count * 3);
  const p = 2, q = 3, radius = 900, tube = 300, scale = 1;
  for (let i = 0; i < count; i++) {
    const u = (i / count) * Math.PI * 2 * q;
    const cu = Math.cos(u), su = Math.sin(u);
    const quOverP = (q / p) * u;
    const cs = Math.cos(quOverP);
    const x = (radius + tube * cs) * cu * scale;
    const y = (radius + tube * cs) * su * scale;
    const z = tube * Math.sin(quOverP) * scale;
    points[i * 3] = x;
    points[i * 3 + 1] = y;
    points[i * 3 + 2] = z + 1500; // push in front of "camera" like real depth data
  }
  return points;
}

const basePoints = buildTorusKnotPoints(POINT_COUNT);

// Seam for real hardware: replace this with a function that reads the next
// frame from an actual Kinect v2 sensor (e.g. via a native addon or a
// sidecar process piping frames in) and returns a Float32Array of the same
// shape (N * 3 floats, millimetres, XYZ per point).
function getNextFrame(t) {
  const out = new Float32Array(basePoints.length);
  const wobble = Math.sin(t * 0.6) * 80;
  for (let i = 0; i < basePoints.length; i += 3) {
    out[i] = basePoints[i] + wobble;
    out[i + 1] = basePoints[i + 1];
    out[i + 2] = basePoints[i + 2] + Math.cos(t * 0.4) * 60;
  }
  return out;
}

const wss = new WebSocketServer({ port: PORT });
console.log(`[kinect-relay] listening on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  console.log('[kinect-relay] client connected');
  ws.send(JSON.stringify({ type: 'meta', outWidth: 1, outHeight: POINT_COUNT, step: 1, floatsPerPoint: 3 }));

  const start = Date.now();
  const interval = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;
    const t = (Date.now() - start) / 1000;
    const frame = getNextFrame(t);
    ws.send(frame.buffer.slice(0), { binary: true });
  }, 1000 / 24);

  ws.on('close', () => { clearInterval(interval); console.log('[kinect-relay] client disconnected'); });
  ws.on('error', () => clearInterval(interval));
});
