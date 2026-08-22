export interface GenerativeParameter {
  name: string;
  min?: number;
  max?: number;
  default: number | string;
  type?: 'number' | 'string' | 'boolean';
}

export interface GenerativeDefinition {
  uuid: string;
  description: string;
  color: string;
  movement: boolean;
  parameters: GenerativeParameter[];
  fragmentShader: string;
}

export const GENERATIVES_DATA = [
  {
    header: `/*{
  "description": "3D Cubes Matrix",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "rotation", "min": 0.0, "max": 5.0, "default": 0.0, "type": "number" },
    { "name": "count", "min": 2.0, "max": 6.0, "default": 3.0, "type": "number" },
    { "name": "cube_size", "min": 20.0, "max": 160.0, "default": 64.0, "type": "number" },
    { "name": "spacing", "min": 0.0, "max": 200.0, "default": 55.0, "type": "number" },
    { "name": "size_randomization", "min": 0.0, "max": 1.0, "default": 0.5, "type": "number" },
    { "name": "dispersion", "min": 0.0, "max": 350.0, "default": 90.0, "type": "number" },
    { "name": "opacity", "min": 0.1, "max": 1.0, "default": 0.70, "type": "number" }
  ],
  "uuid": "cubes-matrix-3d-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Growing Red Circles",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "count", "min": 1.0, "max": 100.0, "default": 25.0, "type": "number" },
    { "name": "size", "min": 10.0, "max": 1200.0, "default": 280.0, "type": "number" },
    { "name": "speed", "min": 0.1, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "duration", "min": 0.5, "max": 30.0, "default": 6.0, "type": "number" },
    { "name": "delay", "min": 0.0, "max": 3.0, "default": 0.25, "type": "number" },
    { "name": "transparency", "min": 0.0, "max": 1.0, "default": 0.0, "type": "number" }
  ],
  "uuid": "growing-circles-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "3D Studio Still Life",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "light_angle", "min": 0.0, "max": 6.28, "default": 1.15, "type": "number" },
    { "name": "balance", "min": 0.0, "max": 1.0, "default": 0.5, "type": "number" },
    { "name": "roughness", "min": 0.1, "max": 2.0, "default": 1.0, "type": "number" },
    { "name": "camera_orbit", "min": -1.0, "max": 1.0, "default": 0.0, "type": "number" }
  ],
  "uuid": "studio-still-life-3d"
}*/`,
    code: `
#ifdef GL_ES
precision highp float;
#endif

uniform float time;
uniform vec2 resolution;
uniform float speed;
uniform float light_angle;
uniform float balance;
uniform float roughness;
uniform float camera_orbit;

varying vec2 texCoord;

// --- Procedural Hash & Noise for PBR Textures ---
float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
    vec3 p = floor(x);
    vec3 w = fract(x);
    vec3 u = w * w * (3.0 - 2.0 * w);
    return mix(mix(mix(hash(p + vec3(0.0,0.0,0.0)), hash(p + vec3(1.0,0.0,0.0)), u.x),
                   mix(hash(p + vec3(0.0,1.0,0.0)), hash(p + vec3(1.0,1.0,0.0)), u.x), u.y),
               mix(mix(hash(p + vec3(0.0,0.0,1.0)), hash(p + vec3(1.0,0.0,1.0)), u.x),
                   mix(hash(p + vec3(0.0,1.0,1.0)), hash(p + vec3(1.0,1.0,1.0)), u.x), u.y), u.z);
}

// --- SDF Primitives ---
float sdSphere(vec3 p, float r) {
    return length(p) - r;
}

float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Global material ID:
// 1 = Floor (sandstone ground)
// 2 = Left Wall (dusty teal)
// 3 = Right Wall (terracotta red)
// 4 = Pedestal Box (sandstone)
// 5 = Bottom Red Ceramic Sphere (Left)
// 6 = Top Red Lacquer Sphere (Left)
// 7 = Travertine Stone Sphere (Right)
// 8 = Small Turquoise Enamel Sphere (Foreground)

vec2 map(vec3 p) {
    float t = time * speed;
    
    // 1. Floor Plane
    float dFloor = p.y - (-1.15);
    vec2 res = vec2(dFloor, 1.0);
    
    // 2. Corner Walls: Left Teal Wall & Right Terracotta Wall
    // Left Teal Wall at x <= 0.0, z = 0.95
    float dLeftWall = sdBox(p - vec3(-2.0, 1.5, 0.95), vec3(2.0, 3.0, 0.05));
    if (dLeftWall < res.x) res = vec2(dLeftWall, 2.0);
    
    // Right Terracotta Wall at x > 0.0, z = 0.95
    float dRightWall = sdBox(p - vec3(2.0, 1.5, 0.95), vec3(2.0, 3.0, 0.05));
    if (dRightWall < res.x) res = vec2(dRightWall, 3.0);
    
    // 3. Sandstone Pedestal Block on Right
    vec3 bPos = p - vec3(0.65, -0.75, 0.10);
    float dBox = sdBox(bPos, vec3(0.60, 0.40, 0.50)) - 0.02;
    if (dBox < res.x) res = vec2(dBox, 4.0);
    
    // 4. Large Bottom Red Sphere (textured ceramic) on Left
    vec3 posRed1 = vec3(-0.45, -0.36, -0.05);
    float dRed1 = sdSphere(p - posRed1, 0.76);
    if (dRed1 < res.x) res = vec2(dRed1, 5.0);
    
    // 5. Top Red Sphere (balanced on bottom sphere with subtle breathing wobble)
    float wobble = sin(t * 1.2) * (0.02 * balance);
    float breath = cos(t * 0.8) * (0.015 * balance);
    vec3 posRed2 = vec3(-0.38 + wobble, 0.70 + breath, -0.02);
    float dRed2 = sdSphere(p - posRed2, 0.44);
    if (dRed2 < res.x) res = vec2(dRed2, 6.0);
    
    // 6. Large Travertine Limestone Sphere (sitting on pedestal) on Right
    vec3 posStone = vec3(0.52, 0.04, 0.08);
    float dStone = sdSphere(p - posStone, 0.65);
    if (dStone < res.x) res = vec2(dStone, 7.0);
    
    // 7. Small Turquoise Enamel Sphere in foreground
    float floatTurq = sin(t * 1.5 + 1.0) * (0.02 * balance);
    vec3 posTurq = vec3(0.14, -0.80 + floatTurq, -0.70);
    float dTurq = sdSphere(p - posTurq, 0.32);
    if (dTurq < res.x) res = vec2(dTurq, 8.0);
    
    return res;
}

vec3 calcNormal(vec3 p) {
    const float eps = 0.001;
    vec2 h = vec2(eps, 0.0);
    return normalize(vec3(
        map(p + h.xyy).x - map(p - h.xyy).x,
        map(p + h.yxy).x - map(p - h.yxy).x,
        map(p + h.yyx).x - map(p - h.yyx).x
    ));
}

// Raymarching soft shadows
float calcShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
    float res = 1.0;
    float t = mint;
    for (int i = 0; i < 56; i++) {
        float h = map(ro + rd * t).x;
        res = min(res, k * h / t);
        t += clamp(h, 0.015, 0.22);
        if (res < 0.001 || t > maxt) break;
    }
    return clamp(res, 0.0, 1.0);
}

// Ambient occlusion
float calcAO(vec3 p, vec3 n) {
    float occ = 0.0;
    float sca = 1.0;
    for (int i = 0; i < 5; i++) {
        float h = 0.01 + 0.12 * float(i) / 4.0;
        float d = map(p + h * n).x;
        occ += (h - d) * sca;
        sca *= 0.85;
    }
    return clamp(1.0 - 2.5 * occ, 0.0, 1.0);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * resolution.xy) / resolution.y;
    float t = time * speed;
    
    // Camera setup with interactive orbit
    float camAngle = 0.02 + camera_orbit * 0.45;
    float camDist = 3.8;
    vec3 ro = vec3(sin(camAngle) * camDist, 0.20, -cos(camAngle) * camDist);
    vec3 ta = vec3(0.02, -0.05, 0.0);
    
    vec3 ww = normalize(ta - ro);
    vec3 uu = normalize(cross(vec3(0.0, 1.0, 0.0), ww)); // Right-handed view matrix
    vec3 vv = normalize(cross(ww, uu));
    
    // Ray direction with balanced studio lens
    vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.35 * ww);
    
    // Sun key light direction from top-right casting diagonal shadow across left teal wall
    float sunA = light_angle;
    vec3 lightDir = normalize(vec3(-cos(sunA) * 1.5, 1.7, -sin(sunA) * 1.2 - 0.2));
    vec3 lightCol = vec3(1.0, 0.95, 0.88) * 1.45;
    
    // Raymarch
    float dO = 0.0;
    float matID = 0.0;
    for (int i = 0; i < 115; i++) {
        vec3 p = ro + rd * dO;
        vec2 dMat = map(p);
        if (dMat.x < 0.001) {
            matID = dMat.y;
            break;
        }
        if (dO > 22.0) break;
        dO += dMat.x;
    }
    
    vec3 col = vec3(0.92, 0.86, 0.80); // Warm ambient background fallback
    
    if (dO < 22.0) {
        vec3 p = ro + rd * dO;
        vec3 n = calcNormal(p);
        vec3 v = -rd;
        
        // Procedural micro-texture
        float nVal = noise(p * 32.0);
        float speckle = noise(p * 95.0);
        
        vec3 albedo = vec3(1.0);
        float specPower = 32.0;
        float specIntensity = 0.6;
        float fresnelPower = 4.0;
        
        // Assign Material Properties
        if (matID < 1.5) {
            // Floor: Sandstone / Terracotta Floor
            albedo = vec3(0.92, 0.78, 0.64) * (0.93 + 0.12 * nVal);
            specPower = 14.0 / max(0.1, roughness);
            specIntensity = 0.18;
        }
        else if (matID < 2.5) {
            // Left Wall: Dusty Sage / Teal Cyan
            albedo = vec3(0.36, 0.58, 0.60) * (0.95 + 0.08 * nVal);
            specPower = 8.0 / max(0.1, roughness);
            specIntensity = 0.08;
        }
        else if (matID < 3.5) {
            // Right Wall: Rich Terracotta Red
            albedo = vec3(0.68, 0.20, 0.18) * (0.95 + 0.08 * nVal);
            specPower = 8.0 / max(0.1, roughness);
            specIntensity = 0.08;
        }
        else if (matID < 4.5) {
            // Pedestal Box: Sandy Limestone Block
            albedo = vec3(0.90, 0.74, 0.58) * (0.9 + 0.15 * nVal);
            specPower = 18.0 / max(0.1, roughness);
            specIntensity = 0.22;
        }
        else if (matID < 5.5) {
            // Bottom Large Red Ceramic Sphere (speckled micro-glaze)
            albedo = vec3(0.76, 0.12, 0.09) * (0.88 + 0.2 * speckle);
            specPower = 64.0 / max(0.1, roughness);
            specIntensity = 1.35;
        }
        else if (matID < 6.5) {
            // Top Red Lacquer Sphere (smooth high-gloss)
            albedo = vec3(0.84, 0.16, 0.12);
            specPower = 84.0 / max(0.1, roughness);
            specIntensity = 1.5;
        }
        else if (matID < 7.5) {
            // Travertine / Sandstone Sphere (matte stone with pores)
            albedo = vec3(0.84, 0.85, 0.74) * (0.86 + 0.22 * nVal + 0.12 * speckle);
            specPower = 22.0 / max(0.1, roughness);
            specIntensity = 0.38;
        }
        else {
            // Small Turquoise Enamel Sphere
            albedo = vec3(0.38, 0.72, 0.72) * (0.95 + 0.08 * speckle);
            specPower = 76.0 / max(0.1, roughness);
            specIntensity = 1.4;
        }
        
        // Lighting Computation
        float diff = max(dot(n, lightDir), 0.0);
        float shadow = calcShadow(p + n * 0.02, lightDir, 0.03, 7.0, 26.0);
        float ao = calcAO(p, n);
        
        // Specular Blinn-Phong
        vec3 h = normalize(lightDir + v);
        float spec = pow(max(dot(n, h), 0.0), specPower) * specIntensity;
        
        // Fresnel Rim Reflection
        float fresnel = pow(clamp(1.0 - dot(n, v), 0.0, 1.0), fresnelPower);
        
        // Ambient Fill / Indirect Color Bleed
        vec3 skyLight = vec3(0.40, 0.55, 0.68) * max(n.y * 0.5 + 0.5, 0.0) * 0.35;
        vec3 bounceLight = vec3(0.85, 0.40, 0.30) * max(-n.y * 0.5 + 0.5, 0.0) * 0.28;
        
        // Direct Sun Light + Specular
        vec3 direct = lightCol * diff * shadow;
        vec3 specular = lightCol * spec * shadow;
        
        col = albedo * (direct + skyLight + bounceLight) * ao + specular + fresnel * 0.16 * albedo;
    }
    
    // Tone mapping & gamma correction
    col = col / (col + vec3(0.82)) * 1.82;
    col = pow(col, vec3(1.0 / 2.2));
    
    // Subtle Vignette
    col *= 1.0 - 0.22 * dot(uv, uv);
    
    gl_FragColor = vec4(col, 1.0);
}
`
  },
  {
    header: `/*{
  "description": "Vein Labyrinth",
  "color": "white",
  "movement": false,
  "parameters": [
    { "name": "growth", "min": 0.0, "max": 45.0, "default": 25.0, "type": "number" },
    { "name": "branch_chance", "min": 0.0, "max": 1.0, "default": 0.45, "type": "number" },
    { "name": "split_mode", "min": 2.0, "max": 3.0, "default": 2.5, "type": "number" },
    { "name": "segment_size", "min": 10.0, "max": 45.0, "default": 20.0, "type": "number" },
    { "name": "grid_mesh", "min": 0.0, "max": 1.0, "default": 0.35, "type": "number" }
  ],
  "uuid": "vein-labyrinth-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Neon 3D Polygon",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "shadows", "min": 0.0, "max": 2.0, "default": 1.0, "type": "number" },
    { "name": "sides", "min": 4.0, "max": 12.0, "default": 6.0, "type": "number" },
    { "name": "symmetry", "min": 0.0, "max": 1.0, "default": 1.0, "type": "number" },
    { "name": "size", "min": 0.1, "max": 3.0, "default": 1.0, "type": "number" }
  ],
  "uuid": "3d-polygon-neon-1"
}*/`,
    code: `// Custom Canvas 2D Implementation`
  },
  {
    header: `/*{
  "description": "3D Ferrofluid",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "blobbiness", "min": 0.1, "max": 2.0, "default": 0.8, "type": "number" },
    { "name": "droplets", "min": 1.0, "max": 10.0, "default": 5.0, "type": "number" },
    { "name": "size", "min": 0.5, "max": 3.0, "default": 1.0, "type": "number" },
    { "name": "gravity", "min": 0.5, "max": 5.0, "default": 1.5, "type": "number" }
  ],
  "uuid": "ferrofluid-3d-1"
}*/`,
    code: `
#ifdef GL_ES
precision highp float;
#endif

uniform float time;
uniform vec2 resolution;
uniform float speed;
uniform float blobbiness;
uniform float droplets;

varying vec2 texCoord;

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float sdSphere(vec3 p, float s) {
    return length(p) - s;
}

float map(vec3 p) {
    float t = time * speed;
    
    // Main central blob
    float d = sdSphere(p - vec3(0.0, sin(t*1.3)*0.2, 0.0), 1.0 + sin(t*2.0)*0.1);
    
    // Add droplets
    int numDrops = int(droplets);
    for(int i=1; i<=10; i++) {
        if(i > numDrops) break;
        float fi = float(i);
        vec3 pos = vec3(
            sin(t * 0.8 + fi * 2.1) * 1.5,
            cos(t * 1.1 + fi * 1.7) * 1.5,
            sin(t * 0.9 + fi * 3.3) * 1.5
        );
        float size = 0.2 + 0.2 * sin(fi * 7.2);
        float drop = sdSphere(p - pos, size);
        d = smin(d, drop, blobbiness);
    }
    
    // A few micro droplets
    for(int i=1; i<=5; i++) {
        float fi = float(i);
        vec3 pos = vec3(
            sin(t * 1.5 + fi * 8.1) * 2.5,
            cos(t * 1.8 + fi * 6.7) * 2.5,
            sin(t * 1.3 + fi * 9.3) * 2.5
        );
        float drop = sdSphere(p - pos, 0.08);
        d = smin(d, drop, blobbiness * 0.5);
    }
    
    return d;
}

vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

void main() {
    vec2 uv = texCoord * 2.0 - 1.0;
    uv.x *= resolution.x / resolution.y;
    
    vec3 ro = vec3(0.0, 0.0, 4.0); // ray origin
    vec3 rd = normalize(vec3(uv, -1.5)); // ray direction
    
    float t = 0.0;
    float maxD = 10.0;
    float d = 0.0;
    
    for(int i=0; i<100; i++) {
        vec3 p = ro + rd * t;
        d = map(p);
        if(d < 0.001 || t > maxD) break;
        t += d;
    }
    
    vec3 bg = vec3(0.95, 0.95, 0.97); // light background
    vec3 col = bg;
    
    if(t < maxD) {
        vec3 p = ro + rd * t;
        vec3 n = calcNormal(p);
        
        // Lighting
        vec3 lig = normalize(vec3(0.8, 0.7, 0.6));
        vec3 lig2 = normalize(vec3(-0.8, -0.2, -0.6));
        
        float dif = clamp(dot(n, lig), 0.0, 1.0);
        float dif2 = clamp(dot(n, lig2), 0.0, 1.0);
        
        vec3 ref = reflect(rd, n);
        float spe = pow(clamp(dot(ref, lig), 0.0, 1.0), 32.0);
        float fre = pow(clamp(1.0 + dot(n, rd), 0.0, 1.0), 2.0);
        
        // Very dark material (ferrofluid)
        vec3 mat = vec3(0.02, 0.02, 0.02);
        
        col = mat;
        // subtle rim light
        col += vec3(0.1) * fre;
        // sharp specular highlights
        col += vec3(1.0) * spe * 1.5;
        // subtle secondary reflection
        col += vec3(0.05) * dif2;
    }
    
    gl_FragColor = vec4(col, 1.0);
}
`
  },
  {
    header: `/*{
  "description": "Stacked Balls",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "count", "min": 10.0, "max": 100.0, "default": 40.0, "type": "number" },
    { "name": "max_size", "min": 20.0, "max": 200.0, "default": 100.0, "type": "number" },
    { "name": "movement", "min": 0.0, "max": 100.0, "default": 30.0, "type": "number" },
    { "name": "chaos", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" }
  ],
  "uuid": "stacked-balls-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation`
  },
  {
    header: `/*{
  "description": "3D Debris Rocks",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "count", "min": 10.0, "max": 150.0, "default": 80.0, "type": "number" },
    { "name": "scatter", "min": 100.0, "max": 800.0, "default": 400.0, "type": "number" },
    { "name": "size", "min": 0.5, "max": 3.0, "default": 1.0, "type": "number" }
  ],
  "uuid": "3d-debris-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation`
  },
  {
    header: `/*{
  "description": "Random Symbols Mix",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "density", "min": 50.0, "max": 500.0, "default": 250.0, "type": "number" },
    { "name": "scale", "min": 0.1, "max": 3.0, "default": 1.0, "type": "number" },
    { "name": "movement", "min": 0.0, "max": 100.0, "default": 20.0, "type": "number" },
    { "name": "chaos", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" }
  ],
  "uuid": "random-symbols-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation`
  },

  {
    header: `/*{
  "description": "Multicolor Terrain",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 0.8, "type": "number" },
    { "name": "amplitude", "min": 30.0, "max": 300.0, "default": 140.0, "type": "number" },
    { "name": "density", "min": 0.5, "max": 2.5, "default": 1.2, "type": "number" },
    { "name": "ruggedness", "min": 0.5, "max": 3.0, "default": 1.8, "type": "number" },
    { "name": "thickness", "min": 0.5, "max": 5.0, "default": 1.5, "type": "number" }
  ],
  "uuid": "terrain-lines-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Squares Decomposition",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "count", "min": 5.0, "max": 50.0, "default": 22.0, "type": "number" },
    { "name": "size", "min": 20.0, "max": 300.0, "default": 130.0, "type": "number" },
    { "name": "spacing", "min": 10.0, "max": 100.0, "default": 32.0, "type": "number" },
    { "name": "movement", "min": 0.0, "max": 50.0, "default": 15.0, "type": "number" },
    { "name": "rotation", "min": 0.0, "max": 6.28, "default": 0.0, "type": "number" },
    { "name": "delay", "min": 0.0, "max": 1.0, "default": 0.05, "type": "number" }
  ],
  "uuid": "squares-noise-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Number Paths",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "nodes", "min": 5.0, "max": 40.0, "default": 16.0, "type": "number" },
    { "name": "grid_size", "min": 20.0, "max": 100.0, "default": 45.0, "type": "number" },
    { "name": "spread", "min": 0.0, "max": 1.0, "default": 0.4, "type": "number" },
    { "name": "movement", "min": 0.0, "max": 100.0, "default": 15.0, "type": "number" },
    { "name": "chaos", "min": 0.0, "max": 5.0, "default": 0.0, "type": "number" }
  ],
  "uuid": "number-paths-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Buildings Rising",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "count", "min": 2.0, "max": 15.0, "default": 7.0, "type": "number" },
    { "name": "size", "min": 0.2, "max": 3.0, "default": 1.0, "type": "number" },
    { "name": "spacing", "min": 0.0, "max": 30.0, "default": 2.0, "type": "number" },
    { "name": "max_height", "min": 50.0, "max": 500.0, "default": 220.0, "type": "number" },
    { "name": "movement", "min": 0.0, "max": 2.0, "default": 1.0, "type": "number" },
    { "name": "chaos", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" }
  ],
  "uuid": "isometric-buildings-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },

  {
    header: `/*{
  "description": "Umbrella Rain Canvas",
  "color": "blue",
  "movement": true,
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "font_size", "min": 10.0, "max": 60.0, "default": 16.0, "type": "number" },
    { "name": "rain_density", "min": 0.1, "max": 2.0, "default": 1.0, "type": "number" },
    { "name": "umbrella_size", "min": 0.1, "max": 3.0, "default": 1.0, "type": "number" },
    { "name": "umbrella_x", "min": -100.0, "max": 100.0, "default": 0.0, "type": "number" },
    { "name": "umbrella_y", "min": -100.0, "max": 100.0, "default": 0.0, "type": "number" },
    { "name": "text_content", "default": "01", "type": "string" }
  ],
  "uuid": "text-umbrella-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation`
  },
  {
    header: `/*{
  "description": "Word Ripples Canvas",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 10.0, "default": 2.0, "type": "number" },
    { "name": "font_size", "min": 10.0, "max": 60.0, "default": 20.0, "type": "number" },
    { "name": "frequency", "min": 0.01, "max": 0.2, "default": 0.05, "type": "number" },
    { "name": "amplitude", "min": 0.0, "max": 50.0, "default": 20.0, "type": "number" },
    { "name": "text_content", "default": "滴水穿石 | 海纳百川 | 润物无声", "type": "string" }
  ],
  "uuid": "text-water-drop-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation`
  },
  {
    header: `/*{
  "description": "Sea of Words Canvas",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "font_size", "min": 10.0, "max": 60.0, "default": 18.0, "type": "number" },
    { "name": "wave_height", "min": 0.0, "max": 100.0, "default": 30.0, "type": "number" },
    { "name": "boat_size", "min": 0.1, "max": 3.0, "default": 1.0, "type": "number" },
    { "name": "boat_speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "chaos", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "text_content", "default": "~波浪~海洋~航行~漂流~", "type": "string" }
  ],
  "uuid": "text-boat-sea-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation`
  },
  {
    header: `/*{
  "description": "Text Mask Canvas",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 10.0, "default": 1.0, "type": "number" },
    { "name": "font_size", "min": 10.0, "max": 100.0, "default": 24.0, "type": "number" },
    { "name": "dragon_size", "min": 0.1, "max": 3.0, "default": 1.0, "type": "number" },
    { "name": "chaos", "min": 0.0, "max": 10.0, "default": 1.0, "type": "number" },
    { "name": "thickness", "min": 0.1, "max": 3.0, "default": 1.0, "type": "number" },
    { "name": "dir_x", "min": -5.0, "max": 5.0, "default": 0.0, "type": "number" },
    { "name": "dir_y", "min": -5.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "displacement", "min": 0.0, "max": 150.0, "default": 50.0, "type": "number" },
    { "name": "text_content", "default": "学而不思则罔，思而不学则殆。 | 温故而知新，可以为师矣。 | 三人行，必有我师焉。择其善者而从之，其不善者而改之。 | 己所不欲，勿施于人。 | 君子坦荡荡，小人长戚戚。 | 君子和而不同，小人同而不和。 | 知之为知之，不知为不知，是知也。 | 逝者如斯夫，不舍昼夜。", "type": "string" }
  ],
  "uuid": "dragon-text-mask-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },

  {
    header: `/*{
  "description": "Brutalist Grid",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "columns", "min": 1.0, "max": 10.0, "default": 3.0 },
    { "name": "rows", "min": 1.0, "max": 10.0, "default": 3.0 },
    { "name": "shape_type", "min": 0.0, "max": 5.0, "default": 0.0 },
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0 },
    { "name": "thickness", "min": 0.01, "max": 0.2, "default": 0.05 },
    { "name": "aberration", "min": 0.0, "max": 0.1, "default": 0.02 }
  ],
  "uuid": "brutalist-grid-1"
}*/`,
    code: `
#ifdef GL_ES
precision highp float;
#endif

uniform float time;
uniform vec2 resolution;
uniform float columns;
uniform float rows;
uniform float shape_type;
uniform float speed;
uniform float thickness;
uniform float aberration;

varying vec2 texCoord;

const float PI = 3.14159265359;

mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
}

float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdTriangle(vec2 p, float r) {
    const float k = sqrt(3.0);
    p.x = abs(p.x) - r;
    p.y = p.y + r/k;
    if(p.x + k*p.y > 0.0) p = vec2(p.x-k*p.y, -k*p.x-p.y)/2.0;
    p.x -= clamp(p.x, -2.0*r, 0.0);
    return -length(p)*sign(p.y);
}
float sdClover(vec2 p, float r) {
    float d1 = length(p - vec2(r, r)*0.5) - r*0.5;
    float d2 = length(p - vec2(-r, r)*0.5) - r*0.5;
    float d3 = length(p - vec2(r, -r)*0.5) - r*0.5;
    float d4 = length(p - vec2(-r, -r)*0.5) - r*0.5;
    return min(min(d1, d2), min(d3, d4));
}
float sdSemiCircle(vec2 p, float r) {
    p.y += r*0.25;
    float d = length(p) - r;
    return max(d, -p.y + r*0.25);
}

float getShape(vec2 p, float type, float r) {
    int t = int(mod(type, 5.0));
    if(t == 0) return sdBox(p, vec2(r*0.8));
    if(t == 1) return sdClover(p, r*0.8);
    if(t == 2) return sdSemiCircle(p, r);
    if(t == 3) return sdTriangle(p, r);
    if(t == 4) return sdCircle(p, r);
    return sdCircle(p, r);
}

float scene(vec2 p, float seed) {
    float t = time * speed + seed * 10.0;
    float angle = floor(t) * PI * 0.5 + smoothstep(0.0, 0.5, fract(t)) * PI * 0.5;
    p *= rot(angle);
    float tType = mod(shape_type + floor(seed * 100.0), 5.0);
    float d = getShape(p, tType, 0.6);
    return abs(d) - thickness;
}

void main() {
    vec2 uv = texCoord;
    float aspect = resolution.x / resolution.y;
    vec2 p = uv * vec2(columns, rows);
    vec2 cellId = floor(p);
    vec2 cellUv = fract(p) * 2.0 - 1.0;
    
    // adjust aspect ratio inside the cell so shapes aren't stretched
    cellUv.x *= (resolution.x / columns) / (resolution.y / rows);
    
    float seed = fract(sin(dot(cellId, vec2(12.9898, 78.233))) * 43758.5453);
    
    float dR = scene(cellUv - vec2(aberration, 0.0), seed);
    float dG = scene(cellUv, seed);
    float dB = scene(cellUv + vec2(aberration, 0.0), seed);
    
    float blur = 0.02;
    float r = smoothstep(blur, 0.0, dR);
    float g = smoothstep(blur, 0.0, dG);
    float b = smoothstep(blur, 0.0, dB);
    
    // red background
    vec3 result = vec3(0.8, 0.1, 0.1); 
    result = mix(result, vec3(1.0, 1.0, 0.0), r); 
    result = mix(result, vec3(0.0, 1.0, 1.0), b); 
    result = mix(result, vec3(1.0, 1.0, 1.0), g); 
    
    gl_FragColor = vec4(result, 1.0);
}
`
  },
  {
    header: `/*{
  "description": "Ferrofluid",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "blob_size", "min": 1.0, "max": 50.0, "default": 21.0 },
    { "name": "blobs", "min": 1.0, "max": 10.0, "default": 1.0 },
    { "name": "density", "min": 1.0, "max": 100.0, "default": 52.0 },
    { "name": "speed", "min": 0.0, "max": 100.0, "default": 38.0 },
    { "name": "opacity", "min": 0.0, "max": 1.0, "default": 1.0 }
  ],
  "uuid": "ferrofluid-1"
}*/`,
    code: `
#ifdef GL_ES
precision highp float;
#endif

uniform float time;
uniform vec2 resolution;
uniform float blob_size;
uniform float blobs;
uniform float density;
uniform float speed;
uniform float opacity;

varying vec2 texCoord;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
               mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
}
float fbm(vec2 p) {
    float f = 0.0;
    float amp = 0.5;
    for(int i=0; i<4; i++) {
        f += amp * noise(p);
        p *= 2.0;
        amp *= 0.5;
    }
    return f;
}

void main() {
    vec2 uv = texCoord * 2.0 - 1.0;
    uv.x *= resolution.x / resolution.y;
    
    float t = time * speed * 0.01;
    
    vec2 p = uv * (density * 0.1);
    
    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3 - t)));
    vec2 r = vec2(fbm(p + 4.0*q + vec2(1.7, 9.2)), fbm(p + 4.0*q + vec2(8.3, 2.8)));
    
    float n = fbm(p + 4.0*r);
    
    float ridges = abs(sin(n * blobs * 3.1415 + t));
    ridges = smoothstep(0.0, blob_size * 0.01, ridges);
    ridges = 1.0 - ridges;
    
    vec3 lightDir = normalize(vec3(1.0, 1.0, 0.5));
    float eps = 0.01;
    float nx = fbm(p + vec2(eps, 0.0) + 4.0*r) - n;
    float ny = fbm(p + vec2(0.0, eps) + 4.0*r) - n;
    vec3 normal = normalize(vec3(-nx, -ny, eps * 10.0));
    
    float diffuse = max(dot(normal, lightDir), 0.0);
    float spec = pow(max(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0), 16.0);
    
    vec3 color = vec3(0.8, 0.2, 0.05) * diffuse + vec3(1.0, 0.8, 0.6) * spec;
    color *= ridges * 1.5; 
    
    color = mix(vec3(0.05, 0.0, 0.0), color, ridges);
    
    gl_FragColor = vec4(color, opacity);
}
`
  },
  {
    header: `/*{
  "description": "Cloudy Shader",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "smooth_bands", "default": 1.0, "type": "boolean" },
    { "name": "warp_depth", "min": 0.0, "max": 10.0, "default": 1.0 },
    { "name": "complexity", "min": 1.0, "max": 10.0, "default": 6.0 },
    { "name": "bands", "min": 1.0, "max": 100.0, "default": 48.0 },
    { "name": "speed", "min": 0.0, "max": 100.0, "default": 57.0 }
  ],
  "uuid": "shader-clouds-1"
}*/`,
    code: `
#ifdef GL_ES
precision highp float;
#endif

uniform float time;
uniform vec2 resolution;
uniform float warp_depth;
uniform float complexity;
uniform float bands;
uniform float speed;
uniform float smooth_bands;

varying vec2 texCoord;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
               mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
}
float fbm(vec2 p, float comp) {
    float f = 0.0;
    float amp = 0.5;
    for(int i=0; i<10; i++) {
        if(float(i) >= comp) break;
        f += amp * noise(p);
        p *= 2.0;
        amp *= 0.5;
    }
    return f;
}

void main() {
    vec2 uv = texCoord * 2.0 - 1.0;
    uv.x *= resolution.x / resolution.y;
    
    float t = time * speed * 0.005;
    
    vec2 p = uv * 3.0;
    
    vec2 q = vec2(fbm(p + vec2(0.0, t), complexity), fbm(p + vec2(5.2, 1.3 - t), complexity));
    vec2 r = vec2(fbm(p + warp_depth*q + vec2(1.7, 9.2), complexity), fbm(p + warp_depth*q + vec2(8.3, 2.8), complexity));
    
    float n = fbm(p + warp_depth*r, complexity);
    
    if (smooth_bands < 0.5) {
        n = floor(n * bands) / bands;
    } else {
        n = sin(n * bands * 3.1415) * 0.5 + 0.5;
    }
    
    vec3 col1 = vec3(0.05, 0.2, 0.4);
    vec3 col2 = vec3(0.2, 0.5, 0.8);
    vec3 col3 = vec3(0.8, 0.9, 1.0);
    
    vec3 color = mix(col1, col2, clamp(n*2.0, 0.0, 1.0));
    color = mix(color, col3, clamp(n*2.0 - 1.0, 0.0, 1.0));
    
    gl_FragColor = vec4(color, 1.0);
}
`
  },

  {
    header: `/*{
  "description": "Auto-Rotating Arcs (Tempo Sync)",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed_rel",   "min": 0.0,  "max": 1.0,  "default": 0.5 },
    { "name": "tail_style",  "min": 0.0,  "max": 1.0,  "default": 0.0 },
    { "name": "count",       "min": 1.0,  "max": 10.0, "default": 8.0 },
    { "name": "thickness",   "min": 0.001,"max": 0.3,  "default": 0.015 },
    { "name": "tail_length", "min": 0.1,  "max": 1.0,  "default": 0.6 },
    { "name": "offset",      "min": 0.0,  "max": 1.0,  "default": 0.1 },
    { "name": "spacing",     "min": 0.01, "max": 0.65, "default": 0.04 }
  ],
  "uuid": "arcs-auto-tail-v4"
}*/`,
    code: `
#ifdef GL_ES
precision highp float;
#endif

const float TAU = 6.2831853;

uniform float time;
uniform vec2 resolution;
uniform float speed_rel;
uniform float tail_style;
uniform float count;
uniform float thickness;
uniform float tail_length;
uniform float offset;
uniform float spacing;

varying vec2 texCoord;

void main() {
    vec2 uv = texCoord * 2.0 - 1.0;
    uv.x *= resolution.x / resolution.y;

    float total = floor(count);
    float m = 0.0;
    
    float pixelAngle = atan(uv.y, uv.x);

    float speedMult = 1.0;
    if (speed_rel < 0.33) {
        speedMult = 0.5;
    } else if (speed_rel > 0.66) {
        speedMult = 2.0;
    }
    
    for (float i = 0.0; i < 20.0; i++) {
        if (i >= total) break;

        float currentRadius = 0.15 + (i * spacing);
        float d = length(uv);
        float ring = smoothstep(thickness + 0.002, thickness, abs(d - currentRadius));
        
        float baseTime = time * 0.5; 
        float currentAngle = (baseTime * speedMult) - (i * offset * TAU);
        
        float angleProgress = fract((pixelAngle - currentAngle) / TAU);
        
        float fadeTail = smoothstep(tail_length, 0.0, angleProgress);
        float solidTail = smoothstep(tail_length, tail_length - 0.005, angleProgress);
        float arcMask = mix(fadeTail, solidTail, tail_style);

        m += ring * arcMask;
    }

    float finalAlpha = clamp(m, 0.0, 1.0);
    gl_FragColor = vec4(1.0, 1.0, 1.0, finalAlpha); // default white as per JSON
}`
  },
  {
    header: `/*{
  "description": "Stickiness",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "count",      "min": 2,   "max": 12,  "default": 3 },
    { "name": "ball_size",  "min": 10,  "max": 150, "default": 15 },
    { "name": "radius",     "min": 0.1, "max": 2.0, "default": 1.0 },
    { "name": "chaos",      "min": 0.0, "max": 1.0, "default": 0.3 },
    { "name": "speed",      "min": 0.1, "max": 3.0, "default": 0.6 },
    { "name": "diffusion",  "min": 0.1, "max": 0.95,"default": 0.85 }
  ],
  "uuid": "stickiness-canvas-gen-1"
}*/`,
    code: `
#ifdef GL_ES
precision highp float;
#endif

uniform float time;
uniform vec2 resolution;
uniform float count;
uniform float chaos;
uniform float speed;
uniform float radius;
uniform float ball_size;
uniform float diffusion;

varying vec2 texCoord;

float df(vec2 v, float r) {
    float d = length(v);
    return r / max(d, 0.0001);
}

void main(void) {
    vec2 uv = texCoord * 2.0 - 1.0;
    uv.x *= resolution.x / resolution.y;

    float r = ball_size * 0.002; 
    float glow = 0.6 + (1.0 - diffusion) * 40.0;
    
    float col = 0.0;
    float totalBalls = floor(count);

    for (int i = 0; i < 50; i++) {
        if (float(i) >= totalBalls) break;

        float fi = float(i);
        float t = time * speed;
        float id = fi / totalBalls; 

        vec2 regularPos = vec2(
            cos(t + id * 6.28),
            sin(t + id * 6.28)
        ) * radius;

        vec2 chaoticPos = vec2(
            sin(t * 2.5 + id * 13.0) * cos(t * 1.5), 
            cos(t * 3.2 + id * 7.0) * sin(t * 0.9)
        ) * radius;

        vec2 finalPos = mix(regularPos, chaoticPos, chaos);
        col += df(uv - finalPos, r);
    }

    float t_thresh = 0.1;
    col = smoothstep(0.0, 1.0, (col - t_thresh) / t_thresh);
    col = pow(col, glow);

    gl_FragColor = vec4(1.0, 1.0, 1.0, clamp(col, 0.0, 1.0)); // white output
}`
  },
  {
    header: `/*{
  "description": "Waves",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed",     "min": 0.5, "max": 20.0, "default": 4.0 },
    { "name": "freq",      "min": 0.1, "max": 4.0,  "default": 0.8 },
    { "name": "amp",       "min": 1.0, "max": 60.0, "default": 18.0 },
    { "name": "lines",     "min": 5.0, "max": 150.0,"default": 45.0 },
    { "name": "thickness", "min": 0.5, "max": 8.0,  "default": 2.2 }
  ],
  "uuid": "waves-canvas-gen-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Topography",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed",     "min": 0.0, "max": 10.0,  "default": 1.0 },
    { "name": "freq",      "min": 0.2, "max": 6.0,   "default": 1.5 },
    { "name": "amp",       "min": 10.0,"max": 400.0, "default": 320.0 },
    { "name": "lines",     "min": 5.0, "max": 100.0, "default": 25.0 },
    { "name": "thickness", "min": 0.5, "max": 8.0,   "default": 2.2 }
  ],
  "uuid": "topography-canvas-gen-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  }
];

export function parseGeneratives(): GenerativeDefinition[] {
  return GENERATIVES_DATA.map(g => {
    let metadata: any = {};
    try {
      let startIdx = g.header.indexOf('{');
      let endIdx = g.header.lastIndexOf('}');
      if (startIdx >= 0 && endIdx >= startIdx) {
        let cleaned = g.header.substring(startIdx, endIdx + 1);
        metadata = JSON.parse(cleaned);
      }
    } catch (e) {
      console.error("Failed to parse generative header", e);
    }

    return {
      uuid: metadata.uuid || Math.random().toString(),
      description: metadata.description || 'Generative',
      color: metadata.color || 'white',
      movement: metadata.movement || false,
      parameters: metadata.parameters || [],
      fragmentShader: g.code
    };
  });
}

const VERTEX_SHADER = `
  attribute vec2 position;
  varying vec2 texCoord;
  
  void main() {
    // position is -1 to 1
    texCoord = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

export class WebGLGenerativeRenderer {
  private gl: WebGLRenderingContext | null = null;
  public canvas: HTMLCanvasElement;
  private programs: Record<string, { program: WebGLProgram, uniforms: Record<string, WebGLUniformLocation> }> = {};
  private positionBuffer: WebGLBuffer | null = null;

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl = this.canvas.getContext('webgl', { premultipliedAlpha: false });

    if (this.gl) {
      this.initQuad();
    }
  }

  resize(w: number, h: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl?.viewport(0, 0, w, h);
    }
  }

  private initQuad() {
    const gl = this.gl;
    if (!gl) return;
    const vertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  }

  private compileShader(type: number, source: string) {
    const gl = this.gl;
    if (!gl) return null;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Shader compile error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  initProgram(def: GenerativeDefinition) {
    const gl = this.gl;
    if (!gl) return;
    if (this.programs[def.uuid]) return;

    const vs = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, def.fragmentShader);

    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Program link error:", gl.getProgramInfoLog(program));
      return;
    }

    const uniforms: Record<string, WebGLUniformLocation> = {};
    ['time', 'resolution', ...def.parameters.map(p => p.name)].forEach(name => {
      const loc = gl.getUniformLocation(program, name);
      if (loc) uniforms[name] = loc;
    });

    this.programs[def.uuid] = { program, uniforms };
  }

  render(def: GenerativeDefinition, time: number, settings: Record<string, number>) {
    const gl = this.gl;
    if (!gl || !this.positionBuffer) return;

    const progData = this.programs[def.uuid];
    if (!progData) {
      this.initProgram(def);
      return; 
    }

    gl.useProgram(progData.program);

    // Bind quad
    const positionLocation = gl.getAttribLocation(progData.program, "position");
    gl.enableVertexAttribArray(positionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    // Set uniforms
    if (progData.uniforms['time']) gl.uniform1f(progData.uniforms['time'], time);
    if (progData.uniforms['resolution']) gl.uniform2f(progData.uniforms['resolution'], this.canvas.width, this.canvas.height);

    def.parameters.forEach(p => {
      if (progData.uniforms[p.name]) {
        const val = settings[p.name] !== undefined ? settings[p.name] : p.default;
        if (typeof val === 'number') {
            gl.uniform1f(progData.uniforms[p.name], val);
        } else if (typeof val === 'string' && !isNaN(Number(val))) {
            gl.uniform1f(progData.uniforms[p.name], Number(val));
        }
      }
    });

    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
