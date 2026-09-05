export interface GenerativeParameter {
  name: string;
  min?: number;
  max?: number;
  default: number | string;
  type?: 'number' | 'string' | 'boolean' | 'action';
  icon?: string;
  group?: string;
}

export interface GenerativeElement {
  id: string;
  name: string;
  defaultColor: string;
  icon?: string;
}

export interface ColorPalettePreset {
  id: string;
  name: string;
  colors: string[]; // array of hex colors
}

export const BUILTIN_PALETTES: ColorPalettePreset[] = [
  {
    id: 'monochrome_duo',
    name: 'Black & White',
    colors: ['#000000', '#ffffff']
  },
  {
    id: 'monochrome_duo_white',
    name: 'White & Black',
    colors: ['#ffffff', '#000000']
  },
  {
    id: 'crimson_slate',
    name: 'Crimson & Slate',
    colors: ['#ffffff', '#eb556b', '#7599a4', '#f5a6b5', '#233136']
  },
  {
    id: 'retro_amber',
    name: 'Retro Amber & Teal',
    colors: ['#cf7d2a', '#4de8e0', '#df9bf3', '#6ec7f8', '#2e2117']
  },
  {
    id: 'cyberpunk_neon',
    name: 'Cyberpunk Neon',
    colors: ['#0a0a12', '#ff007f', '#00f0ff', '#ffe600', '#7000ff']
  },
  {
    id: 'tokyo_synth',
    name: 'Tokyo Synthwave',
    colors: ['#1a1b26', '#f7768e', '#7aa2f7', '#bb9af7', '#7dcfff']
  },
  {
    id: 'acid_matrix',
    name: 'Acid Matrix',
    colors: ['#0d1117', '#39d353', '#00ff66', '#2ea043', '#033a16']
  },
  {
    id: 'monochrome_brutalist',
    name: 'Monochrome Brutalist',
    colors: ['#000000', '#ffffff', '#888888', '#e5e5e5', '#333333']
  },
  {
    id: 'warm_sunset',
    name: 'Warm Sunset',
    colors: ['#1f1427', '#f25c54', '#f27059', '#f7b267', '#f4845f']
  },
  {
    id: 'nordic_ice',
    name: 'Nordic Ice',
    colors: ['#2e3440', '#88c0d0', '#81a1c1', '#eceff4', '#5e81ac']
  },
  {
    id: 'bauhaus_primary',
    name: 'Bauhaus Primary',
    colors: ['#ffffff', '#e63946', '#1d3557', '#f1faee', '#457b9d']
  },
  {
    id: 'obsidian_gold',
    name: 'Obsidian Gold',
    colors: ['#121212', '#d4af37', '#aa7c11', '#f3e5ab', '#5b4511']
  },
  {
    id: 'coral_reef',
    name: 'Coral Reef',
    colors: ['#e0560f', '#0a0a0a', '#ffae5c', '#c23b06', '#2a1206']
  },
  {
    id: 'risograph_paper',
    name: 'Risograph Paper',
    colors: ['#f4f0e4', '#171717', '#8a8578', '#d8d2c0', '#3a372e']
  },
  {
    id: 'aurora_glow',
    name: 'Aurora Glow',
    colors: ['#0a0a12', '#8b6cf0', '#f0a0d8', '#ffffff']
  },
  {
    id: 'plotter_bands',
    name: 'Plotter Bands',
    colors: ['#ede9e2', '#d9557a', '#3a5ba0', '#3c7a52', '#e08a2e', '#234a30', '#a4342f']
  },
  {
    id: 'ember_glow',
    name: 'Ember Glow',
    colors: ['#1b2140', '#ffcf5c', '#ff7a2e', '#ffffff']
  }
];

export interface GenerativeDefinition {
  uuid: string;
  description: string;
  color: string;
  category: string;
  movement: boolean;
  parameters: GenerativeParameter[];
  elements?: GenerativeElement[];
  defaultPaletteId?: string;
  fragmentShader: string;
}

export const GENERATIVES_DATA = [
  {
    header: `/*{
  "description": "Dancing Cubes Isometric",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "acid_matrix",
  "parameters": [
    { "name": "grid_size", "min": 2.0, "max": 8.0, "default": 5.0, "type": "number" },
    { "name": "cube_size", "min": 40.0, "max": 260.0, "default": 115.0, "type": "number" },
    { "name": "x_movement", "min": 0.0, "max": 100.0, "default": 30.0, "type": "number" },
    { "name": "y_movement", "min": 0.0, "max": 100.0, "default": 45.0, "type": "number" },
    { "name": "z_movement", "min": 0.0, "max": 100.0, "default": 30.0, "type": "number" },
    { "name": "delay", "min": 0.0, "max": 2.0, "default": 0.35, "type": "number" },
    { "name": "wireframe_ratio", "min": 0.0, "max": 1.0, "default": 0.5, "type": "number" },
    { "name": "rotate_face", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#050a05" },
    { "id": "cubes_crimson", "name": "Primary Cubes", "defaultColor": "#00ff41" },
    { "id": "cubes_slate", "name": "Secondary Cubes", "defaultColor": "#008f11" },
    { "id": "wireframes", "name": "Wireframe Frames", "defaultColor": "#50ff70" }
  ],
  "uuid": "dancing-cubes-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "3D Cubes Matrix",
  "color": "white",
  "movement": true,
  "defaultPaletteId": "retro_amber",
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "rotation", "min": 0.0, "max": 5.0, "default": 0.0, "type": "number" },
    { "name": "count", "min": 2.0, "max": 6.0, "default": 3.0, "type": "number" },
    { "name": "cube_size", "min": 20.0, "max": 160.0, "default": 64.0, "type": "number" },
    { "name": "spacing", "min": 0.0, "max": 200.0, "default": 55.0, "type": "number" },
    { "name": "dispersion", "min": 0.0, "max": 350.0, "default": 90.0, "type": "number" },
    { "name": "opacity", "min": 0.1, "max": 1.0, "default": 0.70, "type": "number" },
    { "name": "reshuffle", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#2e2117" },
    { "id": "cube_a", "name": "Cube Colour A", "defaultColor": "#cf7d2a" },
    { "id": "cube_b", "name": "Cube Colour B", "defaultColor": "#4de8e0" },
    { "id": "cube_c", "name": "Cube Colour C", "defaultColor": "#df9bf3" }
  ],
  "uuid": "cubes-matrix-3d-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Drops",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "acid_matrix",
  "parameters": [
    { "name": "count", "min": 0.0, "max": 100.0, "default": 25.0, "type": "number" },
    { "name": "size", "min": 10.0, "max": 1200.0, "default": 280.0, "type": "number" },
    { "name": "speed", "min": 0.1, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "duration", "min": 0.5, "max": 30.0, "default": 6.0, "type": "number" },
    { "name": "delay", "min": 0.0, "max": 3.0, "default": 0.25, "type": "number" },
    { "name": "drop", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#0d1117" },
    { "id": "circles", "name": "Growing Circles", "defaultColor": "#39d353" },
    { "id": "accent", "name": "Accent Glow", "defaultColor": "#00ff66" }
  ],
  "uuid": "growing-circles-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Ramification",
  "color": "white",
  "movement": true,
  "defaultPaletteId": "monochrome_duo_white",
  "category": "Lines & Terrain",
  "parameters": [
    { "name": "growth", "min": 1.0, "max": 45.0, "default": 30.0, "type": "number" },
    { "name": "branch_chance", "min": 0.0, "max": 1.0, "default": 0.5, "type": "number" },
    { "name": "split_mode", "min": 0.5, "max": 5.0, "default": 2.5, "type": "number" },
    { "name": "segment_size", "min": 10.0, "max": 45.0, "default": 24.0, "type": "number" },
    { "name": "grid_mesh", "min": 0.0, "max": 1.0, "default": 0.3, "type": "number" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#ffffff" },
    { "id": "veins", "name": "Vein Network", "defaultColor": "#0a0a0a" },
    { "id": "accent", "name": "Vessel Glow", "defaultColor": "#c81e3c" }
  ],
  "uuid": "vein-labyrinth-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Neon 3D Polygon",
  "category": "Geometric",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "cyberpunk_neon",
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "shadows", "min": 0.0, "max": 2.0, "default": 1.3, "type": "number" },
    { "name": "sides", "min": 4.0, "max": 12.0, "default": 6.0, "type": "number" },
    { "name": "symmetry", "min": 0.0, "max": 1.0, "default": 1.0, "type": "number" },
    { "name": "size", "min": 0.1, "max": 3.0, "default": 1.0, "type": "number" }
  ],
  "elements": [
    { "id": "background", "name": "Void Background", "defaultColor": "#07070f" },
    { "id": "wireframe", "name": "Polygon Edges", "defaultColor": "#00f0ff" },
    { "id": "faces", "name": "Crystal Faces", "defaultColor": "#7000ff" },
    { "id": "glow", "name": "Core Glow", "defaultColor": "#ff007f" }
  ],
  "uuid": "3d-polygon-neon-1"
}*/`,
    code: `// Custom Canvas 2D Implementation`
  },
  {
    header: `/*{
  "description": "3D Ferrofluid",
  "category": "Psychedelic",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "tokyo_synth",
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "blobbiness", "min": 0.2, "max": 2.0, "default": 1.1, "type": "number" },
    { "name": "droplets", "min": 1.0, "max": 10.0, "default": 5.0, "type": "number" },
    { "name": "spikes", "min": 0.0, "max": 1.0, "default": 0.55, "type": "number" },
    { "name": "size", "min": 0.5, "max": 2.5, "default": 1.0, "type": "number" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#1a1b26" },
    { "id": "spikes", "name": "Fluid Body", "defaultColor": "#24263b" },
    { "id": "specular", "name": "Specular Light", "defaultColor": "#7dcfff" },
    { "id": "rim", "name": "Rim Light", "defaultColor": "#bb9af7" }
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
uniform float spikes;
uniform float size;

uniform vec3 u_color_0;
uniform vec3 u_color_1;
uniform vec3 u_color_2;
uniform vec3 u_color_3;

varying vec2 texCoord;

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float sdSphere(vec3 p, float s) {
    return length(p) - s;
}

float map(vec3 pIn) {
    float sc = clamp(size, 0.5, 2.5);
    vec3 p = pIn / sc;
    float t = time * speed;

    // Main central body
    float d = sdSphere(p - vec3(0.0, sin(t * 1.3) * 0.12, 0.0), 1.15 + sin(t * 2.0) * 0.07);

    // Droplets orbiting CLOSE + pulsing so they fuse and stretch off the body
    int numDrops = int(clamp(droplets, 1.0, 10.0));
    for (int i = 1; i <= 10; i++) {
        if (i > numDrops) break;
        float fi = float(i);
        float orb = 0.78 + 0.55 * (0.5 + 0.5 * sin(t * 1.15 + fi * 2.0));
        vec3 pos = vec3(
            sin(t * 0.7 + fi * 2.1),
            cos(t * 0.9 + fi * 1.7) * 0.85,
            sin(t * 0.8 + fi * 3.3)
        ) * orb;
        float sz = 0.34 + 0.16 * sin(fi * 7.2);
        d = smin(d, sdSphere(p - pos, sz), max(0.15, blobbiness));
    }

    // Magnetic spikes: pull the surface out along p in a bristly high-freq pattern
    vec3 pn = normalize(p + 1e-4);
    float sp = sin(pn.x * 9.0 + t * 3.0) * sin(pn.y * 9.0 - t * 2.0) * sin(pn.z * 9.0 + t * 1.5);
    d -= clamp(spikes, 0.0, 1.0) * 0.24 * max(0.0, sp) * exp(-abs(d) * 3.0);

    return d * sc;
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
    
    vec3 bg = (length(u_color_0) > 0.001) ? u_color_0 : vec3(0.03, 0.03, 0.05);
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
        
        vec3 mat = (length(u_color_1) > 0.001) ? u_color_1 : vec3(0.07, 0.06, 0.11);
        vec3 specCol = (length(u_color_2) > 0.001) ? u_color_2 : vec3(1.0, 0.85, 0.63);
        vec3 rimCol = (length(u_color_3) > 0.001) ? u_color_3 : vec3(0.60, 0.48, 1.0);

        // faux chrome environment reflection so the black body still has form
        vec3 env = mix(mat * 1.4, rimCol * 0.9, clamp(0.5 + 0.5 * ref.y, 0.0, 1.0));

        col = mat * (0.30 + 0.85 * dif);
        col += env * 0.35;
        col += rimCol * fre * 1.7;
        col += specCol * spe * 2.4;
        col += mat * dif2 * 0.4;
    }
    
    gl_FragColor = vec4(col, 1.0);
}
`
  },
  {
    header: `/*{
  "description": "Stacked Balls",
  "category": "Psychedelic",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "crimson_slate",
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "count", "min": 0.0, "max": 100.0, "default": 46.0, "type": "number" },
    { "name": "max_size", "min": 20.0, "max": 220.0, "default": 110.0, "type": "number" },
    { "name": "movement", "min": 0.0, "max": 100.0, "default": 12.0, "type": "number" },
    { "name": "chaos", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#0d1117" },
    { "id": "spheres_shade", "name": "Sphere Shading", "defaultColor": "#eb556b" },
    { "id": "contour", "name": "Sphere Highlight", "defaultColor": "#f5a6b5" }
  ],
  "uuid": "stacked-balls-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation`
  },
  {
    header: `/*{
  "description": "3D Debris Rocks",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "coral_reef",
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "count", "min": 10.0, "max": 150.0, "default": 80.0, "type": "number" },
    { "name": "scatter", "min": 100.0, "max": 800.0, "default": 400.0, "type": "number" },
    { "name": "size", "min": 0.5, "max": 3.0, "default": 1.0, "type": "number" },
    { "name": "transparency", "min": 0.0, "max": 1.0, "default": 0.0, "type": "number" },
    { "name": "gravity", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#e0560f" },
    { "id": "debris", "name": "Flying Debris", "defaultColor": "#0a0a0a" },
    { "id": "debris_alt", "name": "Debris Accent", "defaultColor": "#ffae5c" }
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
  "defaultPaletteId": "crimson_slate",
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "density", "min": 50.0, "max": 500.0, "default": 250.0, "type": "number" },
    { "name": "scale", "min": 0.1, "max": 3.0, "default": 1.0, "type": "number" },
    { "name": "movement", "min": 0.0, "max": 100.0, "default": 20.0, "type": "number" },
    { "name": "chaos", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#ffffff" },
    { "id": "circles", "name": "Circle Symbols", "defaultColor": "#eb556b" },
    { "id": "triangles", "name": "Triangle Symbols", "defaultColor": "#7599a4" },
    { "id": "squares", "name": "Square & Bar Symbols", "defaultColor": "#233136" }
  ],
  "uuid": "random-symbols-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation`
  },
  {
    header: `/*{
  "description": "Multicolor Terrain",
  "category": "Lines & Terrain",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "acid_matrix",
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 0.8, "type": "number" },
    { "name": "amplitude", "min": 30.0, "max": 420.0, "default": 240.0, "type": "number" },
    { "name": "density", "min": 0.5, "max": 2.5, "default": 1.3, "type": "number" },
    { "name": "ruggedness", "min": 0.5, "max": 3.0, "default": 1.6, "type": "number" },
    { "name": "thickness", "min": 0.5, "max": 5.0, "default": 1.6, "type": "number" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#0d1117" },
    { "id": "terrain_lines", "name": "Terrain Ribs", "defaultColor": "#39d353" }
  ],
  "uuid": "terrain-lines-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Squares Decomposition",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "count", "min": 5.0, "max": 50.0, "default": 22.0, "type": "number" },
    { "name": "size", "min": 20.0, "max": 300.0, "default": 130.0, "type": "number" },
    { "name": "spacing", "min": 10.0, "max": 100.0, "default": 32.0, "type": "number" },
    { "name": "movement", "min": 0.0, "max": 50.0, "default": 15.0, "type": "number" },
    { "name": "rotation", "min": 0.0, "max": 6.28, "default": 0.0, "type": "number" },
    { "name": "delay", "min": 0.0, "max": 1.0, "default": 0.05, "type": "number" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "squares", "name": "Grid Squares", "defaultColor": "#ffffff" }
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
  "defaultPaletteId": "crimson_slate",
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "nodes", "min": 5.0, "max": 40.0, "default": 16.0, "type": "number" },
    { "name": "grid_size", "min": 20.0, "max": 100.0, "default": 45.0, "type": "number" },
    { "name": "spread", "min": 0.0, "max": 1.0, "default": 0.4, "type": "number" },
    { "name": "movement", "min": 0.0, "max": 100.0, "default": 15.0, "type": "number" },
    { "name": "chaos", "min": 0.0, "max": 5.0, "default": 0.0, "type": "number" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#ffffff" },
    { "id": "color_1", "name": "Node Crimson", "defaultColor": "#eb556b" },
    { "id": "color_2", "name": "Node Slate", "defaultColor": "#7599a4" },
    { "id": "color_3", "name": "Node Rose", "defaultColor": "#f5a6b5" },
    { "id": "color_4", "name": "Node Dark", "defaultColor": "#233136" }
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
  "defaultPaletteId": "crimson_slate",
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "count", "min": 2.0, "max": 15.0, "default": 7.0, "type": "number" },
    { "name": "size", "min": 0.2, "max": 3.0, "default": 1.0, "type": "number" },
    { "name": "spacing", "min": 0.0, "max": 30.0, "default": 2.0, "type": "number" },
    { "name": "max_height", "min": 50.0, "max": 500.0, "default": 220.0, "type": "number" },
    { "name": "movement", "min": 0.0, "max": 2.0, "default": 1.0, "type": "number" },
    { "name": "chaos", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" }
  ],
  "elements": [
    { "id": "background", "name": "Sky Background", "defaultColor": "#ffffff" },
    { "id": "buildings", "name": "Cityscape Edges", "defaultColor": "#eb556b" }
  ],
  "uuid": "isometric-buildings-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Umbrella Rain Canvas",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "category": "Text",
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "font_size", "min": 10.0, "max": 60.0, "default": 16.0, "type": "number" },
    { "name": "rain_density", "min": 0.1, "max": 2.0, "default": 1.0, "type": "number" },
    { "name": "umbrella_size", "min": 0.1, "max": 3.0, "default": 1.0, "type": "number" },
    { "name": "umbrella_x", "min": -100.0, "max": 100.0, "default": 0.0, "type": "number" },
    { "name": "umbrella_y", "min": -100.0, "max": 100.0, "default": 0.0, "type": "number" },
    { "name": "text_content", "default": "01", "type": "string" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#05060a" },
    { "id": "umbrella", "name": "Rain Text", "defaultColor": "#8fd0ff" },
    { "id": "canopy", "name": "Umbrella Canopy", "defaultColor": "#ff2d55" },
    { "id": "figure", "name": "Figure & Pole", "defaultColor": "#e8e8f0" }
  ],
  "uuid": "text-umbrella-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation`
  },
  {
    header: `/*{
  "description": "Word Ripples Canvas",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 10.0, "default": 2.0, "type": "number" },
    { "name": "font_size", "min": 10.0, "max": 60.0, "default": 20.0, "type": "number" },
    { "name": "frequency", "min": 0.01, "max": 0.2, "default": 0.05, "type": "number" },
    { "name": "amplitude", "min": 0.0, "max": 50.0, "default": 20.0, "type": "number" },
    { "name": "text_content", "default": "滴水穿石 | 海纳百川 | 润物无声", "type": "string" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "ripples", "name": "Ripple Typography", "defaultColor": "#ffffff" }
  ],
  "uuid": "text-water-drop-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation`
  },
  {
    header: `/*{
  "description": "Sea of Words Canvas",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "font_size", "min": 10.0, "max": 60.0, "default": 18.0, "type": "number" },
    { "name": "wave_height", "min": 0.0, "max": 100.0, "default": 30.0, "type": "number" },
    { "name": "boat_size", "min": 0.1, "max": 3.0, "default": 1.0, "type": "number" },
    { "name": "boat_speed", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "chaos", "min": 0.0, "max": 5.0, "default": 1.0, "type": "number" },
    { "name": "text_content", "default": "~波浪~海洋~航行~漂流~", "type": "string" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "boat_sea", "name": "Boat & Sea Text", "defaultColor": "#ffffff" }
  ],
  "uuid": "text-boat-sea-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation`
  },
  {
    header: `/*{
  "description": "Dragon Manuscript",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "category": "Text",
  "parameters": [
    { "name": "speed", "min": 0.0, "max": 10.0, "default": 1.4, "type": "number" },
    { "name": "font_size", "min": 8.0, "max": 60.0, "default": 20.0, "type": "number" },
    { "name": "glyph_size", "min": 0.2, "max": 1.6, "default": 1.05, "type": "number" },
    { "name": "invert", "min": 0.0, "max": 1.0, "default": 0.0, "type": "boolean" },
    { "name": "line_gap", "min": 0.7, "max": 2.0, "default": 1.15, "type": "number" },
    { "name": "wander", "min": 0.0, "max": 1.0, "default": 0.55, "type": "number" },
    { "name": "reach", "min": 10.0, "max": 260.0, "default": 90.0, "type": "number" },
    { "name": "edge_glow", "min": 0.0, "max": 1.0, "default": 0.5, "type": "number" },
    { "name": "glyph", "default": "字", "type": "string" },
    { "name": "text_content", "default": "学而不思则罔，思而不学则殆。 温故而知新，可以为师矣。 三人行，必有我师焉。 己所不欲，勿施于人。 君子坦荡荡，小人长戚戚。 君子和而不同，小人同而不和。 知之为知之，不知为不知，是知也。 逝者如斯夫，不舍昼夜。 ", "type": "string" },
    { "name": "coil", "default": 0, "type": "action" },
    { "name": "breathe_fire", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "dragon", "name": "Text", "defaultColor": "#ffffff" },
    { "id": "accent", "name": "Dragon & Glow", "defaultColor": "#ff2d55" }
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
  "defaultPaletteId": "bauhaus_primary",
  "parameters": [
    { "name": "columns", "min": 1.0, "max": 10.0, "default": 3.0 },
    { "name": "rows", "min": 1.0, "max": 10.0, "default": 3.0 },
    { "name": "shape_type", "min": 0.0, "max": 5.0, "default": 0.0 },
    { "name": "speed", "min": 0.0, "max": 5.0, "default": 1.0 },
    { "name": "thickness", "min": 0.01, "max": 0.2, "default": 0.05 },
    { "name": "aberration", "min": 0.0, "max": 0.1, "default": 0.02 },
    { "name": "luck", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#ffffff" },
    { "id": "primary_shapes", "name": "Red Shadow / Accent", "defaultColor": "#e63946" },
    { "id": "secondary_shapes", "name": "Navy Blue Structure", "defaultColor": "#1b2a47" },
    { "id": "accent_shapes", "name": "Inner Fill / Highlight", "defaultColor": "#ffffff" }
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
uniform float luck_spin;
uniform float luck_seed;

uniform vec3 u_color_0;
uniform vec3 u_color_1;
uniform vec3 u_color_2;
uniform vec3 u_color_3;
uniform float u_color_0_alpha;

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
    // "Luck" slot-machine spin: columns churn shapes fast, settling at slightly
    // different rates, then land on a new luck_seed-dependent shape.
    float col = floor(seed * 7.0);
    float spin = luck_spin * (5.0 + mod(col, 3.0) * 3.0);
    float churn = floor(spin * 6.0 + t * (1.0 + spin * 2.0));
    p.y += luck_spin * sin(t * 22.0 + col * 1.7) * 0.35;
    float angle = floor(t) * PI * 0.5 + smoothstep(0.0, 0.5, fract(t)) * PI * 0.5 + spin * PI;
    p *= rot(angle);
    float baseType = shape_type + floor(seed * 100.0)
                   + luck_seed * 3.0 + floor(seed * (luck_seed + 1.0) * 17.0);
    float tType = mod(baseType + churn, 5.0);
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
    
    vec3 cBg = (length(u_color_0) > 0.001) ? u_color_0 : vec3(1.0, 1.0, 1.0);
    vec3 cRed = (length(u_color_1) > 0.001) ? u_color_1 : vec3(0.90, 0.22, 0.27);
    vec3 cBlue = (length(u_color_2) > 0.001) ? u_color_2 : vec3(0.106, 0.165, 0.278);
    vec3 cAccent = (length(u_color_3) > 0.001) ? u_color_3 : vec3(1.0, 1.0, 1.0);
    
    float bgAlpha = (u_color_0_alpha > 0.01) ? 1.0 : 0.0;
    vec4 result = vec4(cBg, bgAlpha);
    
    // Layer 1: Red shadow offset
    result.rgb = mix(result.rgb, cRed, r);
    result.a = max(result.a, r);
    
    // Layer 2: Inner shape core
    result.rgb = mix(result.rgb, cAccent, g * 0.95);
    result.a = max(result.a, g);
    
    // Layer 3: Navy blue stroke on top
    result.rgb = mix(result.rgb, cBlue, b);
    result.a = max(result.a, b);
    
    gl_FragColor = result;
}
`
  },
  {
    header: `/*{
  "description": "Ferrofluid",
  "category": "Psychedelic",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "coral_reef",
  "parameters": [
    { "name": "scale",      "min": 2.0,  "max": 14.0, "default": 6.0 },
    { "name": "warp",       "min": 0.0,  "max": 2.0,  "default": 1.15 },
    { "name": "line_width", "min": 0.02, "max": 0.35, "default": 0.11 },
    { "name": "spots",      "min": 0.0,  "max": 1.0,  "default": 0.6 },
    { "name": "speed",      "min": 0.0,  "max": 3.0,  "default": 0.35 }
  ],
  "elements": [
    { "id": "background", "name": "Base", "defaultColor": "#e0560f" },
    { "id": "ink", "name": "Pattern", "defaultColor": "#0a0a0a" },
    { "id": "accent", "name": "Highlight", "defaultColor": "#ffae5c" }
  ],
  "uuid": "ferrofluid-1"
}*/`,
    code: `
#ifdef GL_ES
precision highp float;
#endif

uniform float time;
uniform vec2 resolution;
uniform float scale;
uniform float warp;
uniform float line_width;
uniform float spots;
uniform float speed;

uniform vec3 u_color_0;
uniform vec3 u_color_1;
uniform vec3 u_color_2;

varying vec2 texCoord;

// Fake reaction-diffusion (Gray-Scott "coral" regime): domain-warped fbm thresholded
// into winding worms, plus scattered spots in the gaps. Single-pass, no feedback.
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return v;
}

void main() {
    vec2 uv = texCoord;
    uv.x *= resolution.x / resolution.y;
    float t = time * speed * 0.12;

    vec2 p = uv * scale;
    vec2 q = vec2(fbm(p * 0.8 + vec2(0.0, t)), fbm(p * 0.8 + vec2(5.2, 1.3) - t));
    vec2 wv = vec2(fbm(p * 0.75 + 1.4 * q + 1.7), fbm(p * 0.75 + 1.4 * q + 8.3));

    // ridge field: a linear ramp (regular spacing) + warp (wiggle + splits/merges)
    float rf = (p.x * 0.6 + p.y * 0.18) + (0.8 + warp * 1.5) * (wv.x - wv.y);
    float line = abs(fract(rf) - 0.5) * 2.0;              // 0 on a ridge, 1 in the trough
    float lw = clamp(line_width, 0.02, 0.35) * 1.7;
    float worm = smoothstep(lw + 0.05, lw, line);

    // round spots scattered through the troughs, denser where a low-freq field peaks
    float dotF = fbm(p * 2.2 + wv * 1.2 + 31.0);
    float dens = mix(0.7, 1.25, smoothstep(0.32, 0.62, fbm(p * 0.3 + 7.0)));
    float sThr = mix(0.62, 0.44, clamp(spots, 0.0, 1.0));
    float spot = smoothstep(sThr, sThr + 0.06, dotF) * dens * (1.0 - worm) * step(0.02, spots);

    float ink = clamp(max(worm, spot), 0.0, 1.0);

    vec3 cBase = (length(u_color_0) > 0.001) ? u_color_0 : vec3(0.88, 0.34, 0.06);
    vec3 cInk  = (length(u_color_1) > 0.001) ? u_color_1 : vec3(0.04, 0.04, 0.04);
    vec3 cHi   = (length(u_color_2) > 0.001) ? u_color_2 : vec3(1.0, 0.68, 0.36);

    vec2 c2 = texCoord - 0.5;
    float vig = 1.0 - dot(c2, c2) * 0.75;
    float shade = fbm(p * 0.25 + 12.0);
    vec3 fieldCol = mix(cBase * 0.9, mix(cBase, cHi, 0.35), shade) * vig;

    vec3 col = mix(fieldCol, cInk, ink);
    gl_FragColor = vec4(col, 1.0);
}
`
  },
  {
    header: `/*{
  "description": "Cloudy Shader",
  "color": "white",
  "movement": true,
  "defaultPaletteId": "bauhaus_primary",
  "parameters": [
    { "name": "smooth_bands", "default": 1.0, "type": "boolean" },
    { "name": "warp_depth", "min": 0.0, "max": 10.0, "default": 1.0 },
    { "name": "complexity", "min": 1.0, "max": 10.0, "default": 6.0 },
    { "name": "bands", "min": 1.0, "max": 100.0, "default": 48.0 },
    { "name": "speed", "min": 0.0, "max": 100.0, "default": 57.0 }
  ],
  "elements": [
    { "id": "sky", "name": "Atmosphere", "defaultColor": "#ffffff" },
    { "id": "clouds", "name": "Volumetric Clouds", "defaultColor": "#e63946" },
    { "id": "sunlight", "name": "Matrix Energy", "defaultColor": "#1d3557" }
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

uniform vec3 u_color_0;
uniform vec3 u_color_1;
uniform vec3 u_color_2;

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
    
    vec3 col1 = (length(u_color_0) > 0.001) ? u_color_0 : vec3(1.0, 1.0, 1.0);
    vec3 col2 = (length(u_color_1) > 0.001) ? u_color_1 : vec3(0.9, 0.22, 0.27);
    vec3 col3 = (length(u_color_2) > 0.001) ? u_color_2 : vec3(0.11, 0.21, 0.34);
    
    vec3 color = mix(col1, col2, clamp(n*2.0, 0.0, 1.0));
    color = mix(color, col3, clamp(n*2.0 - 1.0, 0.0, 1.0));
    
    gl_FragColor = vec4(color, 1.0);
}
`
  },

  {
    header: `/*{
  "description": "Auto-Rotating Arcs (Tempo Sync)",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "speed_rel",   "min": 0.0,  "max": 1.0,  "default": 0.5 },
    { "name": "tail_style",  "min": 0.0,  "max": 1.0,  "default": 0.0 },
    { "name": "count",       "min": 1.0,  "max": 10.0, "default": 8.0 },
    { "name": "thickness",   "min": 0.001,"max": 0.3,  "default": 0.015 },
    { "name": "tail_length", "min": 0.1,  "max": 1.0,  "default": 0.6 },
    { "name": "offset",      "min": 0.0,  "max": 1.0,  "default": 0.1 },
    { "name": "spacing",     "min": 0.01, "max": 0.65, "default": 0.04 }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "inner_arcs", "name": "Primary Arcs", "defaultColor": "#ffffff" },
    { "id": "outer_arcs", "name": "Secondary Rings", "defaultColor": "#ffffff" },
    { "id": "dots", "name": "Trailing Points", "defaultColor": "#ffffff" }
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

uniform vec3 u_color_0;
uniform vec3 u_color_1;

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
    vec3 cBg = (length(u_color_0) > 0.001) ? u_color_0 : vec3(0.0, 0.0, 0.0);
    vec3 cFg = (length(u_color_1) > 0.001) ? u_color_1 : vec3(1.0, 1.0, 1.0);
    vec3 col = mix(cBg, cFg, finalAlpha);
    gl_FragColor = vec4(col, 1.0);
} `
  },
  {
    header: `/*{
  "description": "Stickiness",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "category": "Psychedelic",
  "parameters": [
    { "name": "count",      "min": 2,   "max": 12,  "default": 6 },
    { "name": "ball_size",  "min": 2,   "max": 40,  "default": 16 },
    { "name": "radius",     "min": 0.2, "max": 2.0, "default": 1.0 },
    { "name": "chaos",      "min": 0.0, "max": 1.0, "default": 0.35 },
    { "name": "speed",      "min": 0.1, "max": 3.0, "default": 0.5 },
    { "name": "diffusion",  "min": 0.0, "max": 1.0, "default": 0.25 }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "blobs", "name": "Bubbles", "defaultColor": "#ffffff" }
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

uniform vec3 u_color_0;
uniform vec3 u_color_1;

varying vec2 texCoord;

// Flat 2D bubbles on a slow ring, each breathing in and out of the centre at its
// own phase so neighbours keep kissing (sticky necks) and pulling apart. Pure
// metaball threshold + contour ring -> clean graphic 2D look, no 3D shading.
void field(vec2 uv, out float f) {
    f = 0.0;
    float N = clamp(floor(count), 2.0, 12.0);
    float A = radius * 0.95;                                   // drift amplitude
    float R = (0.05 + ball_size * 0.006) * (0.8 + 0.5 * (4.0 / N)); // small bubble radius
    float t = time * speed;
    for (int i = 0; i < 12; i++) {
        if (float(i) >= N) break;
        float fi = float(i);
        // unique slow Lissajous drift per bubble -> they wander past each other,
        // forming and breaking liquid necks (surface tension) as they pass
        vec2 c = vec2(sin(t * (0.35 + 0.11 * fi) + fi * 1.7) * A * 0.82,
                      cos(t * (0.31 + 0.13 * fi) + fi * 3.3) * A * 0.60);
        c += vec2(sin(t * (1.3 + fi) + fi), cos(t * (1.1 + fi) - fi)) * A * 0.10 * chaos;
        vec2 d = uv - c;
        f += R * R / (dot(d, d) + 1e-4);
    }
}

void main(void) {
    vec2 uv = texCoord * 2.0 - 1.0;
    uv.x *= resolution.x / resolution.y;

    float f;
    field(uv, f);

    float aa = mix(0.012, 0.09, clamp(diffusion, 0.0, 1.0));
    float m = smoothstep(1.0 - aa, 1.0 + aa, f);            // 1 inside the goo
    float edge = smoothstep(0.13, 0.0, abs(f - 1.0));       // band hugging the surface

    vec3 cBg   = (length(u_color_0) > 0.001) ? u_color_0 : vec3(0.0);
    vec3 cBlob = (length(u_color_1) > 0.001) ? u_color_1 : vec3(1.0);

    vec3 col = mix(cBg, cBlob, m);
    col = mix(col, cBlob * 0.42, edge);                     // darker contour on every bubble
    // faint sheen just inside the surface -> soap-bubble read
    float sheen = smoothstep(0.0, 0.05, f - 1.0) * (1.0 - smoothstep(0.05, 0.30, f - 1.0));
    col += cBlob * sheen * 0.22 * m;
    gl_FragColor = vec4(col, 1.0);
}`
  },
  {
    header: `/*{
  "description": "Waves",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "speed",     "min": 0.5, "max": 20.0, "default": 4.0 },
    { "name": "freq",      "min": 0.1, "max": 4.0,  "default": 0.8 },
    { "name": "amp",       "min": 1.0, "max": 60.0, "default": 18.0 },
    { "name": "lines",     "min": 5.0, "max": 150.0,"default": 45.0 },
    { "name": "thickness", "min": 0.5, "max": 8.0,  "default": 2.2 }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "waves", "name": "Flow Waves", "defaultColor": "#ffffff" }
  ],
  "uuid": "waves-canvas-gen-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Topography",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "speed",     "min": 0.0, "max": 10.0,  "default": 1.0 },
    { "name": "freq",      "min": 0.2, "max": 6.0,   "default": 1.5 },
    { "name": "amp",       "min": 10.0,"max": 400.0, "default": 320.0 },
    { "name": "lines",     "min": 5.0, "max": 100.0, "default": 25.0 },
    { "name": "thickness", "min": 0.5, "max": 8.0,   "default": 2.2 }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "contours", "name": "Contour Lines", "defaultColor": "#ffffff" }
  ],
  "uuid": "topography-canvas-gen-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Kinetic Type",
  "category": "Text",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "word_count", "min": 2.0,  "max": 40.0,  "default": 12.0, "type": "number" },
    { "name": "size",       "min": 20.0, "max": 260.0, "default": 120.0, "type": "number" },
    { "name": "speed",      "min": 0.0,  "max": 100.0, "default": 32.0, "type": "number" },
    { "name": "gravity",    "min": -100.0, "max": 100.0, "default": 0.0, "type": "number" },
    { "name": "spin",       "min": 0.0,  "max": 100.0, "default": 18.0, "type": "number" },
    { "name": "gather",     "min": 0.0,  "max": 1.0,   "default": 0.0, "type": "number" },
    { "name": "bounce",     "min": 0.2,  "max": 1.0,   "default": 0.92, "type": "number" },
    { "name": "weight",     "min": 0.0,  "max": 1.0,   "default": 0.0, "type": "number" },
    { "name": "trail",      "min": 0.0,  "max": 1.0,   "default": 0.0, "type": "number" },
    { "name": "text",       "default": "TYPE MOTION FLOW PULSE FORM SHIFT", "type": "string" },
    { "name": "impact",     "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "words", "name": "Words", "defaultColor": "#ffffff" },
    { "id": "accent", "name": "Accent Word", "defaultColor": "#eb556b" }
  ],
  "uuid": "kinetic-type-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Circle Bloom",
  "category": "Geometric",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "max_count", "min": 0.0,  "max": 60.0,  "default": 26.0, "type": "number" },
    { "name": "max_size",  "min": 8.0,  "max": 600.0, "default": 130.0, "type": "number" },
    { "name": "speed",     "min": 0.1,  "max": 8.0,   "default": 1.4, "type": "number" },
    { "name": "delay",     "min": 0.0,  "max": 3.0,   "default": 0.3, "type": "number" },
    { "name": "fade",      "min": 0.0,  "max": 1.0,   "default": 0.55, "type": "number" },
    { "name": "outline",   "min": 0.0,  "max": 1.0,   "default": 0.0, "type": "number" },
    { "name": "bloom",     "default": 0, "type": "action" },
    { "name": "clear",     "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "circles", "name": "Circles", "defaultColor": "#ffffff" },
    { "id": "accent", "name": "Accent Circle", "defaultColor": "#eb556b" }
  ],
  "uuid": "circle-bloom-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Hex Grid",
  "category": "Geometric",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "cyberpunk_neon",
  "parameters": [
    { "name": "density",   "min": 4.0,  "max": 30.0,  "default": 12.0, "type": "number" },
    { "name": "lit_count", "min": 0.0,  "max": 200.0, "default": 26.0, "type": "number" },
    { "name": "shuffle",   "min": 0.0,  "max": 5.0,   "default": 0.9, "type": "number" },
    { "name": "gap",       "min": 0.0,  "max": 0.4,   "default": 0.08, "type": "number" },
    { "name": "glow",      "min": 0.0,  "max": 1.0,   "default": 0.5, "type": "number" },
    { "name": "outline",   "min": 0.0,  "max": 1.0,   "default": 0.3, "type": "number" },
    { "name": "flip",      "default": 0, "type": "action" },
    { "name": "center",    "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#0a0a12" },
    { "id": "grid", "name": "Grid Cells", "defaultColor": "#2a1a3a" },
    { "id": "lit", "name": "Lit Cells", "defaultColor": "#00f0ff" }
  ],
  "uuid": "hex-grid-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Mosaic Grid",
  "category": "Geometric",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "tokyo_synth",
  "parameters": [
    { "name": "columns",   "min": 2.0,  "max": 40.0,  "default": 16.0, "type": "number" },
    { "name": "lit_count", "min": 0.0,  "max": 400.0, "default": 42.0, "type": "number" },
    { "name": "shuffle",   "min": 0.0,  "max": 5.0,   "default": 0.6, "type": "number" },
    { "name": "gap",       "min": 0.0,  "max": 0.3,   "default": 0.05, "type": "number" },
    { "name": "checker",   "min": 0.0,  "max": 1.0,   "default": 0.0, "type": "number" },
    { "name": "round",     "min": 0.0,  "max": 0.5,   "default": 0.0, "type": "number" },
    { "name": "flip",      "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#1a1b26" },
    { "id": "grid", "name": "Grid Cells", "defaultColor": "#2e2f45" },
    { "id": "lit", "name": "Lit Cells", "defaultColor": "#f7768e" }
  ],
  "uuid": "square-grid-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Reaction Diffusion",
  "category": "Psychedelic",
  "color": "white",
  "movement": true,
  "defaultPaletteId": "risograph_paper",
  "parameters": [
    { "name": "sim_speed",  "min": 1.0,   "max": 30.0,  "default": 14.0,   "type": "number" },
    { "name": "feed",       "min": 0.02,  "max": 0.08,  "default": 0.0545, "type": "number" },
    { "name": "kill",       "min": 0.045, "max": 0.07,  "default": 0.062,  "type": "number" },
    { "name": "breathe",    "min": 0.0,   "max": 0.02,  "default": 0.006,  "type": "number" },
    { "name": "resolution", "min": 70.0,  "max": 200.0, "default": 120.0,  "type": "number" },
    { "name": "threshold",  "min": 0.05,  "max": 0.5,   "default": 0.22,   "type": "number" },
    { "name": "reseed",     "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Paper", "defaultColor": "#f2efe6" },
    { "id": "ink", "name": "Ink", "defaultColor": "#141414" }
  ],
  "uuid": "reaction-diffusion-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Voronoi Cells",
  "category": "Lines & Terrain",
  "color": "white",
  "movement": true,
  "defaultPaletteId": "monochrome_duo_white",
  "parameters": [
    { "name": "seeds",       "min": 8.0,  "max": 80.0, "default": 34.0, "type": "number" },
    { "name": "drift",       "min": 0.0,  "max": 3.0,  "default": 1.0,  "type": "number" },
    { "name": "line_weight", "min": 0.5,  "max": 3.0,  "default": 1.0,  "type": "number" },
    { "name": "highlight",   "min": 0.0,  "max": 1.0,  "default": 1.0,  "type": "number" },
    { "name": "reseed",      "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Page", "defaultColor": "#ffffff" },
    { "id": "lines", "name": "Cell Edges", "defaultColor": "#000000" },
    { "id": "highlight", "name": "Centre Cell", "defaultColor": "#ff3b00" }
  ],
  "uuid": "voronoi-cells-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Contour Isolines",
  "category": "Lines & Terrain",
  "color": "white",
  "movement": true,
  "defaultPaletteId": "monochrome_duo_white",
  "parameters": [
    { "name": "levels",      "min": 5.0,  "max": 26.0, "default": 14.0, "type": "number" },
    { "name": "zoom",        "min": 0.4,  "max": 3.0,  "default": 1.0,  "type": "number" },
    { "name": "crawl",       "min": 0.0,  "max": 3.0,  "default": 1.0,  "type": "number" },
    { "name": "line_weight", "min": 0.4,  "max": 2.5,  "default": 1.0,  "type": "number" },
    { "name": "label",       "default": "SURVEY / FIELD NOTES / SECTOR 07 / SHEET 1 OF 1", "type": "string" }
  ],
  "elements": [
    { "id": "background", "name": "Paper", "defaultColor": "#ede9e2" },
    { "id": "lines", "name": "Contours", "defaultColor": "#1a1a1a" },
    { "id": "label", "name": "Type Block", "defaultColor": "#1a1a1a" }
  ],
  "uuid": "contour-lines-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Neon Labyrinth",
  "category": "Retro",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "cyberpunk_neon",
  "parameters": [
    { "name": "corridor_density", "min": 0.0, "max": 1.0, "default": 0.55, "type": "number" },
    { "name": "ghost_aggression", "min": 0.0, "max": 1.0, "default": 0.5,  "type": "number" },
    { "name": "glow_decay",       "min": 0.0, "max": 1.0, "default": 0.6,  "type": "number" },
    { "name": "wrap_frequency",   "min": 0.0, "max": 6.0, "default": 2.0,  "type": "number" },
    { "name": "power_surge",  "default": 0, "type": "action" },
    { "name": "grid_reseed",  "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Void", "defaultColor": "#05060f" },
    { "id": "walls", "name": "Maze Walls", "defaultColor": "#2b1a63" },
    { "id": "pellets", "name": "Pellets", "defaultColor": "#ffe600" },
    { "id": "ghosts", "name": "Entities & Trail", "defaultColor": "#ff2e88" }
  ],
  "uuid": "neon-labyrinth-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Pixel Swarm",
  "category": "Retro",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "acid_matrix",
  "parameters": [
    { "name": "march_speed",     "min": 0.1, "max": 4.0, "default": 1.0, "type": "number" },
    { "name": "row_spacing",     "min": 0.4, "max": 2.0, "default": 1.0, "type": "number" },
    { "name": "barrage_rate",    "min": 0.0, "max": 3.0, "default": 1.0, "type": "number" },
    { "name": "jitter_amplitude","min": 0.0, "max": 1.0, "default": 0.15,"type": "number" },
    { "name": "step_down",     "default": 0, "type": "action" },
    { "name": "scatter_strike","default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#04120a" },
    { "id": "invaders", "name": "Invaders", "defaultColor": "#39ff88" },
    { "id": "bullets", "name": "Barrage", "defaultColor": "#eaffea" },
    { "id": "accent", "name": "Accent", "defaultColor": "#00b34a" }
  ],
  "uuid": "pixel-swarm-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Tetromino Cascade",
  "category": "Retro",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "bauhaus_primary",
  "parameters": [
    { "name": "fall_velocity",     "min": 0.2, "max": 6.0, "default": 1.6, "type": "number" },
    { "name": "grid_chaos",        "min": 0.0, "max": 1.0, "default": 0.15,"type": "number" },
    { "name": "settle_bounciness", "min": 0.0, "max": 1.0, "default": 0.3, "type": "number" },
    { "name": "line_density",      "min": 0.0, "max": 0.9, "default": 0.25,"type": "number" },
    { "name": "line_clear",     "default": 0, "type": "action" },
    { "name": "gravity_invert", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Chamber", "defaultColor": "#0c0c10" },
    { "id": "blocks", "name": "Blocks", "defaultColor": "#e63946" },
    { "id": "grid", "name": "Well Grid", "defaultColor": "#1d3557" },
    { "id": "flash", "name": "Clear Flash", "defaultColor": "#f1faee" }
  ],
  "uuid": "tetromino-cascade-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Procedural Hillscape",
  "category": "Retro",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "retro_amber",
  "parameters": [
    { "name": "terrain_roughness", "min": 0.0, "max": 1.0, "default": 0.5, "type": "number" },
    { "name": "jump_gravity",      "min": 0.2, "max": 2.5, "default": 1.0, "type": "number" },
    { "name": "pipe_density",      "min": 0.0, "max": 1.0, "default": 0.4, "type": "number" },
    { "name": "cloud_parallax",    "min": 0.0, "max": 1.0, "default": 0.5, "type": "number" },
    { "name": "coin_burst",   "default": 0, "type": "action" },
    { "name": "scroll_rush",  "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Sky", "defaultColor": "#1a2a4a" },
    { "id": "terrain", "name": "Terrain", "defaultColor": "#3aa856" },
    { "id": "structures", "name": "Pipes & Blocks", "defaultColor": "#2e7d32" },
    { "id": "coins", "name": "Coins & Sprites", "defaultColor": "#ffd23f" }
  ],
  "uuid": "hillscape-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Orbit Deflection",
  "category": "Retro",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "tokyo_synth",
  "parameters": [
    { "name": "brick_ring_count",     "min": 1.0, "max": 8.0,  "default": 4.0, "type": "number" },
    { "name": "ball_speed_multiplier","min": 1.0, "max": 1.15, "default": 1.03,"type": "number" },
    { "name": "paddle_curvature",     "min": 0.0, "max": 1.0,  "default": 0.5, "type": "number" },
    { "name": "trail_viscosity",      "min": 0.0, "max": 1.0,  "default": 0.5, "type": "number" },
    { "name": "multi_ball",       "default": 0, "type": "action" },
    { "name": "brick_detonation", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Arena", "defaultColor": "#12131f" },
    { "id": "bricks", "name": "Brick Rings", "defaultColor": "#7aa2f7" },
    { "id": "ball", "name": "Projectiles", "defaultColor": "#f7768e" },
    { "id": "paddle", "name": "Paddles", "defaultColor": "#bb9af7" }
  ],
  "uuid": "orbit-deflection-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Centipede Garden",
  "category": "Retro",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "acid_matrix",
  "parameters": [
    { "name": "segment_count",    "min": 4.0,  "max": 40.0, "default": 16.0, "type": "number" },
    { "name": "obstacle_density", "min": 0.0,  "max": 1.0,  "default": 0.4,  "type": "number" },
    { "name": "turn_radius",      "min": 0.0,  "max": 1.0,  "default": 0.3,  "type": "number" },
    { "name": "spore_growth_rate","min": 0.0,  "max": 3.0,  "default": 1.0,  "type": "number" },
    { "name": "segment_split", "default": 0, "type": "action" },
    { "name": "spore_bloom",   "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Field", "defaultColor": "#071206" },
    { "id": "worm", "name": "Crawlers", "defaultColor": "#39ff88" },
    { "id": "obstacles", "name": "Obstacle Nodes", "defaultColor": "#b15cff" },
    { "id": "accent", "name": "Spores", "defaultColor": "#e6ff5c" }
  ],
  "uuid": "centipede-garden-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Orb Cluster",
  "category": "Geometric",
  "color": "white",
  "movement": true,
  "defaultPaletteId": "aurora_glow",
  "parameters": [
    { "name": "count",       "min": 8.0,  "max": 100.0, "default": 45.0, "type": "number" },
    { "name": "size",        "min": 0.4,  "max": 2.0,   "default": 1.0,  "type": "number" },
    { "name": "glossiness",  "min": 0.0,  "max": 1.0,   "default": 0.7,  "type": "number" },
    { "name": "attraction",  "min": 0.0,  "max": 1.0,   "default": 0.5,  "type": "number" },
    { "name": "turbulence",  "min": 0.0,  "max": 2.0,   "default": 0.4,  "type": "number" },
    { "name": "pop",     "default": 0, "type": "action" },
    { "name": "scatter", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#0a0a12" },
    { "id": "orb_a", "name": "Orb Colour A", "defaultColor": "#8b6cf0" },
    { "id": "orb_b", "name": "Orb Colour B", "defaultColor": "#f0a0d8" },
    { "id": "highlight", "name": "Specular Highlight", "defaultColor": "#ffffff" }
  ],
  "uuid": "orb-cluster-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Hatched Summit",
  "category": "Lines & Terrain",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "plotter_bands",
  "parameters": [
    { "name": "peaks",         "min": 1.0,   "max": 4.0,   "default": 2.0,   "type": "number" },
    { "name": "elevation",     "min": 40.0,  "max": 260.0, "default": 150.0, "type": "number" },
    { "name": "hatch_density", "min": 40.0,  "max": 160.0, "default": 90.0,  "type": "number" },
    { "name": "roughness",     "min": 0.0,   "max": 1.0,   "default": 0.5,   "type": "number" },
    { "name": "hatch_angle",   "min": -60.0, "max": 60.0,  "default": -20.0, "type": "number" },
    { "name": "erode",  "default": 0, "type": "action" },
    { "name": "replot", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Paper", "defaultColor": "#ede9e2" },
    { "id": "band_1", "name": "Band 1", "defaultColor": "#d9557a" },
    { "id": "band_2", "name": "Band 2", "defaultColor": "#3a5ba0" },
    { "id": "band_3", "name": "Band 3", "defaultColor": "#3c7a52" },
    { "id": "band_4", "name": "Band 4", "defaultColor": "#e08a2e" },
    { "id": "band_5", "name": "Band 5", "defaultColor": "#234a30" },
    { "id": "band_6", "name": "Band 6", "defaultColor": "#a4342f" }
  ],
  "uuid": "hatched-summit-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Symbol Portrait",
  "category": "Geometric",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "resolution", "min": 6.0,  "max": 24.0, "default": 12.0, "type": "number" },
    { "name": "pose",       "min": 0.0,  "max": 1.0,  "default": 0.5,  "type": "number" },
    { "name": "density",    "min": 0.0,  "max": 1.0,  "default": 0.85, "type": "number" },
    { "name": "shimmer",    "min": 0.0,  "max": 2.0,  "default": 0.6,  "type": "number" },
    { "name": "contrast",   "min": 0.3,  "max": 3.0,  "default": 1.2,  "type": "number" },
    { "name": "blink",  "default": 0, "type": "action" },
    { "name": "reveal", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "symbols", "name": "Symbols", "defaultColor": "#ffffff" }
  ],
  "uuid": "symbol-portrait-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Ink Blot",
  "category": "Psychedelic",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo_white",
  "parameters": [
    { "name": "blob_count",    "min": 2.0, "max": 6.0,  "default": 4.0,  "type": "number" },
    { "name": "size",          "min": 0.5, "max": 2.0,  "default": 1.0,  "type": "number" },
    { "name": "viscosity",     "min": 0.0, "max": 1.0,  "default": 0.4,  "type": "number" },
    { "name": "droplet_count", "min": 0.0, "max": 24.0, "default": 10.0, "type": "number" },
    { "name": "sheen",         "min": 0.0, "max": 1.0,  "default": 0.5,  "type": "number" },
    { "name": "splat",   "default": 0, "type": "action" },
    { "name": "gravity", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#ffffff" },
    { "id": "ink", "name": "Ink", "defaultColor": "#000000" },
    { "id": "highlight", "name": "Sheen", "defaultColor": "#ffffff" }
  ],
  "uuid": "ink-blot-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Floating Gem",
  "category": "Geometric",
  "color": "white",
  "movement": true,
  "defaultPaletteId": "ember_glow",
  "parameters": [
    { "name": "facets",         "min": 4.0, "max": 10.0, "default": 6.0,  "type": "number" },
    { "name": "rotation_speed", "min": 0.0, "max": 3.0,  "default": 0.6,  "type": "number" },
    { "name": "bob",            "min": 0.0, "max": 1.0,  "default": 0.5,  "type": "number" },
    { "name": "glow",           "min": 0.0, "max": 1.0,  "default": 0.7,  "type": "number" },
    { "name": "beam",           "min": 0.0, "max": 1.0,  "default": 0.6,  "type": "number" },
    { "name": "pulse",   "default": 0, "type": "action" },
    { "name": "shatter", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Sky", "defaultColor": "#1b2140" },
    { "id": "gem", "name": "Gem Facets", "defaultColor": "#ffcf5c" },
    { "id": "beam", "name": "Light Beam", "defaultColor": "#ff7a2e" },
    { "id": "dust", "name": "Dust Motes", "defaultColor": "#ffffff" }
  ],
  "uuid": "floating-gem-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Confetti Scatter",
  "category": "Geometric",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "bauhaus_primary",
  "parameters": [
    { "name": "density",     "min": 40.0, "max": 400.0, "default": 160.0, "type": "number" },
    { "name": "gravity",     "min": 0.0,  "max": 3.0,   "default": 0.6,   "type": "number" },
    { "name": "spin",        "min": 0.0,  "max": 4.0,   "default": 1.2,   "type": "number" },
    { "name": "size",        "min": 0.4,  "max": 2.5,   "default": 1.0,   "type": "number" },
    { "name": "turbulence",  "min": 0.0,  "max": 2.0,   "default": 0.5,   "type": "number" },
    { "name": "burst",  "default": 0, "type": "action" },
    { "name": "freeze", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#ffffff" },
    { "id": "shape_a", "name": "Shape Colour A", "defaultColor": "#e63946" },
    { "id": "shape_b", "name": "Shape Colour B", "defaultColor": "#1d3557" }
  ],
  "uuid": "confetti-scatter-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Woven Blocks",
  "category": "Geometric",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "blocks",     "min": 4.0,  "max": 24.0, "default": 14.0, "type": "number" },
    { "name": "bands",      "min": 3.0,  "max": 22.0, "default": 12.0, "type": "number" },
    { "name": "taper",      "min": -1.0, "max": 1.0,  "default": -0.9, "type": "number" },
    { "name": "band_ratio", "min": 0.05, "max": 0.6,  "default": 0.25, "type": "number" },
    { "name": "spread",     "min": 0.35, "max": 1.6,  "default": 0.9,  "type": "number" },
    { "name": "size",       "min": 0.3,  "max": 2.0,  "default": 1.0,  "type": "number" },
    { "name": "reweave",  "default": 0, "type": "action" },
    { "name": "collapse", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "lines", "name": "Hatch Lines", "defaultColor": "#ffffff" },
    { "id": "accent", "name": "Ridge Accent", "defaultColor": "#eb556b" }
  ],
  "uuid": "woven-hex-blocks-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Circuit Routes",
  "category": "Retro",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "acid_matrix",
  "parameters": [
    { "name": "columns",       "min": 8.0,  "max": 40.0, "default": 19.0, "type": "number" },
    { "name": "node_size",     "min": 1.0,  "max": 10.0, "default": 5.0,  "type": "number" },
    { "name": "route_density", "min": 0.0,  "max": 0.5,  "default": 0.13, "type": "number" },
    { "name": "jitter",        "min": 0.0,  "max": 30.0, "default": 0.0,  "type": "number" },
    { "name": "roamers",       "min": 0.0,  "max": 24.0, "default": 5.0,  "type": "number" },
    { "name": "pulse_route", "default": 0, "type": "action" },
    { "name": "rewire",      "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Board", "defaultColor": "#0d1117" },
    { "id": "nodes", "name": "Pads", "defaultColor": "#39d353" },
    { "id": "traces", "name": "Traces", "defaultColor": "#2ea043" },
    { "id": "pulse", "name": "Signal Pulse", "defaultColor": "#00ff66" }
  ],
  "uuid": "circuit-routes-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Spiral Shells",
  "category": "Geometric",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "sides",     "min": 3.0,  "max": 12.0, "default": 8.0,  "type": "number" },
    { "name": "rings",     "min": 3.0,  "max": 44.0, "default": 20.0, "type": "number" },
    { "name": "size",      "min": 0.3,  "max": 2.0,  "default": 1.0,  "type": "number" },
    { "name": "turns",     "min": 0.0,  "max": 10.0, "default": 5.5,  "type": "number" },
    { "name": "radius",    "min": 50.0, "max": 400.0,"default": 300.0,"type": "number" },
    { "name": "noise_amt", "min": 0.0,  "max": 1.0,  "default": 0.37, "type": "number" },
    { "name": "unwind", "default": 0, "type": "action" },
    { "name": "twist",  "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "lines", "name": "Shell Edges", "defaultColor": "#ffffff" },
    { "id": "accent", "name": "Core Accent", "defaultColor": "#7599a4" }
  ],
  "uuid": "spiral-shells-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Polar Checker",
  "category": "Geometric",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "sectors",      "min": 6.0,  "max": 64.0,  "default": 52.0, "type": "number" },
    { "name": "rings",        "min": 3.0,  "max": 20.0,  "default": 11.0, "type": "number" },
    { "name": "inner_radius", "min": 10.0, "max": 220.0, "default": 64.0, "type": "number" },
    { "name": "warp",         "min": 0.0,  "max": 1.0,   "default": 0.0,  "type": "number" },
    { "name": "edge_noise",   "min": 0.0,  "max": 2.0,   "default": 0.0,  "type": "number" },
    { "name": "fill_noise",   "min": 0.0,  "max": 100.0, "default": 45.3, "type": "number" },
    { "name": "spin_rings", "default": 0, "type": "action" },
    { "name": "invert",     "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "fill", "name": "Filled Cells", "defaultColor": "#ffffff" },
    { "id": "grid", "name": "Grid Lines", "defaultColor": "#7599a4" }
  ],
  "uuid": "polar-checker-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Truchet Arcs",
  "category": "Lines & Terrain",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "arc_count", "min": 2.0,  "max": 12.0,   "default": 6.0,    "type": "number" },
    { "name": "columns",   "min": 4.0,  "max": 20.0,   "default": 10.0,   "type": "number" },
    { "name": "seed",      "min": 0.0,  "max": 9999.0, "default": 6051.0, "type": "number" },
    { "name": "arc_ratio", "min": 0.1,  "max": 0.5,    "default": 0.2955, "type": "number" },
    { "name": "reflow", "default": 0, "type": "action" },
    { "name": "pop",    "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "lines", "name": "Arcs", "defaultColor": "#ffffff" },
    { "id": "accent", "name": "Popped Tiles", "defaultColor": "#eb556b" }
  ],
  "uuid": "truchet-arcs-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Voxel Cross",
  "category": "Geometric",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_brutalist",
  "parameters": [
    { "name": "resolution", "min": 2.0, "max": 6.0,   "default": 3.0,  "type": "number" },
    { "name": "gap",        "min": 0.0, "max": 5.0,   "default": 2.1,  "type": "number" },
    { "name": "spin",       "min": 0.0, "max": 2.0,   "default": 0.35, "type": "number" },
    { "name": "fill",       "min": 0.2, "max": 1.0,   "default": 0.75, "type": "number" },
    { "name": "seed",       "min": 0.0, "max": 999.0, "default": 20.0, "type": "number" },
    { "name": "dissolve",    "default": 0, "type": "action" },
    { "name": "rotate_step", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "top", "name": "Top Faces", "defaultColor": "#e5e5e5" },
    { "id": "left", "name": "Left Faces", "defaultColor": "#888888" },
    { "id": "right", "name": "Right Faces", "defaultColor": "#333333" }
  ],
  "uuid": "voxel-cross-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Flow Strokes",
  "category": "Lines & Terrain",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "grid_size",     "min": 8.0,  "max": 48.0,  "default": 28.0,   "type": "number" },
    { "name": "flow_scale",    "min": 10.0, "max": 150.0, "default": 79.313, "type": "number" },
    { "name": "stroke_length", "min": 2.0,  "max": 30.0,  "default": 11.54,  "type": "number" },
    { "name": "curl",          "min": 0.0,  "max": 1.0,   "default": 0.3,    "type": "number" },
    { "name": "seed",          "min": 0.0,  "max": 999.0, "default": 7.0,    "type": "number" },
    { "name": "gust",   "default": 0, "type": "action" },
    { "name": "center", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "lines", "name": "Strokes", "defaultColor": "#ffffff" },
    { "id": "accent", "name": "Gust Front", "defaultColor": "#7599a4" }
  ],
  "uuid": "flow-strokes-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Halftone Drift",
  "category": "Geometric",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "cols",          "min": 6.0,  "max": 40.0,   "default": 17.0,   "type": "number" },
    { "name": "noise_scale",   "min": 0.5,  "max": 10.0,   "default": 4.135,  "type": "number" },
    { "name": "rotation_amt",  "min": 0.0,  "max": 2.0,    "default": 0.0,    "type": "number" },
    { "name": "translate_amt", "min": 0.0,  "max": 40.0,   "default": 18.0,   "type": "number" },
    { "name": "scale_amt",     "min": 0.0,  "max": 2.0,    "default": 0.0,    "type": "number" },
    { "name": "seed",          "min": 0.0,  "max": 9999.0, "default": 3100.0, "type": "number" },
    { "name": "ripple", "default": 0, "type": "action" },
    { "name": "settle", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "cells", "name": "Cells", "defaultColor": "#ffffff" }
  ],
  "uuid": "halftone-drift-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Delta Maze",
  "category": "Retro",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "columns",     "min": 8.0,   "max": 40.0,  "default": 18.0,  "type": "number" },
    { "name": "line_width",  "min": 0.1,   "max": 1.0,   "default": 0.3,   "type": "number" },
    { "name": "noise_scale", "min": 0.005, "max": 0.1,   "default": 0.036, "type": "number" },
    { "name": "density",     "min": 0.0,   "max": 1.0,   "default": 0.6,   "type": "number" },
    { "name": "carve", "default": 0, "type": "action" },
    { "name": "flood", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "grid", "name": "Grid", "defaultColor": "#555555" },
    { "id": "path", "name": "Corridor", "defaultColor": "#ffffff" },
    { "id": "flood", "name": "Flood", "defaultColor": "#eb556b" }
  ],
  "uuid": "delta-maze-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Thread Nest",
  "category": "Lines & Terrain",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "loop_count",  "min": 10.0, "max": 120.0, "default": 54.0,  "type": "number" },
    { "name": "min_radius",  "min": 20.0, "max": 200.0, "default": 100.0, "type": "number" },
    { "name": "wobble",      "min": 0.0,  "max": 0.5,   "default": 0.185, "type": "number" },
    { "name": "line_weight", "min": 0.3,  "max": 3.0,   "default": 1.0,   "type": "number" },
    { "name": "center",      "min": 0.0,  "max": 1.0,   "default": 0.2,   "type": "number" },
    { "name": "tighten", "default": 0, "type": "action" },
    { "name": "unspool", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "lines", "name": "Thread", "defaultColor": "#ffffff" },
    { "id": "accent", "name": "Loose End", "defaultColor": "#eb556b" }
  ],
  "uuid": "thread-nest-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Iso Bar Wave",
  "category": "Geometric",
  "color": "black",
  "movement": true,
  "defaultPaletteId": "monochrome_duo",
  "parameters": [
    { "name": "bar_size",   "min": 8.0,  "max": 60.0,  "default": 34.0,  "type": "number" },
    { "name": "amplitude",  "min": 0.0,  "max": 600.0, "default": 422.0, "type": "number" },
    { "name": "count",      "min": 20.0, "max": 300.0, "default": 181.0, "type": "number" },
    { "name": "frequency",  "min": 0.5,  "max": 12.0,  "default": 5.2,   "type": "number" },
    { "name": "bar_height", "min": 10.0, "max": 200.0, "default": 80.0,  "type": "number" },
    { "name": "pulse_wave", "default": 0, "type": "action" },
    { "name": "phase_flip", "default": 0, "type": "action" }
  ],
  "elements": [
    { "id": "background", "name": "Background", "defaultColor": "#000000" },
    { "id": "top", "name": "Bar Tops", "defaultColor": "#ffffff" },
    { "id": "side", "name": "Bar Sides", "defaultColor": "#999999" }
  ],
  "uuid": "iso-bar-wave-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  }
];

// Curated grouping for the asset browser. Falls back to metadata.category then "Other".
export const GENERATIVE_CATEGORIES: Record<string, string> = {
  // Geometric
  'dancing-cubes-canvas-1': 'Geometric',
  'cubes-matrix-3d-1': 'Geometric',
  'brutalist-grid-1': 'Geometric',
  'isometric-buildings-canvas-1': 'Geometric',
  'squares-noise-canvas-1': 'Geometric',
  '3d-polygon-neon-1': 'Geometric',
  '3d-debris-canvas-1': 'Geometric',
  'random-symbols-canvas-1': 'Geometric',
  'orb-cluster-canvas-1': 'Geometric',
  'symbol-portrait-canvas-1': 'Geometric',
  'floating-gem-canvas-1': 'Geometric',
  'confetti-scatter-canvas-1': 'Geometric',
  'woven-hex-blocks-1': 'Geometric',
  'spiral-shells-1': 'Geometric',
  'polar-checker-1': 'Geometric',
  'voxel-cross-1': 'Geometric',
  'halftone-drift-1': 'Geometric',
  'iso-bar-wave-1': 'Geometric',
  // Psychedelic
  'shader-clouds-1': 'Psychedelic',
  'ferrofluid-1': 'Psychedelic',
  'ferrofluid-3d-1': 'Psychedelic',
  'stickiness-canvas-gen-1': 'Psychedelic',
  'growing-circles-canvas-1': 'Psychedelic',
  'stacked-balls-canvas-1': 'Psychedelic',
  'reaction-diffusion-canvas-1': 'Psychedelic',
  'ink-blot-canvas-1': 'Psychedelic',
  // Text
  'kinetic-type-canvas-1': 'Text',
  'text-umbrella-canvas-1': 'Text',
  'text-water-drop-canvas-1': 'Text',
  'text-boat-sea-canvas-1': 'Text',
  'dragon-text-mask-canvas-1': 'Text',
  'number-paths-canvas-1': 'Text',
  // Lines & Terrain
  'vein-labyrinth-canvas-1': 'Lines & Terrain',
  'terrain-lines-canvas-1': 'Lines & Terrain',
  'topography-canvas-gen-1': 'Lines & Terrain',
  'waves-canvas-gen-1': 'Lines & Terrain',
  'arcs-auto-tail-v4': 'Lines & Terrain',
  'voronoi-cells-canvas-1': 'Lines & Terrain',
  'contour-lines-canvas-1': 'Lines & Terrain',
  'hatched-summit-canvas-1': 'Lines & Terrain',
  'truchet-arcs-1': 'Lines & Terrain',
  'flow-strokes-1': 'Lines & Terrain',
  'thread-nest-1': 'Lines & Terrain',
  // Retro
  'neon-labyrinth-canvas-1': 'Retro',
  'pixel-swarm-canvas-1': 'Retro',
  'tetromino-cascade-canvas-1': 'Retro',
  'hillscape-canvas-1': 'Retro',
  'orbit-deflection-canvas-1': 'Retro',
  'centipede-garden-canvas-1': 'Retro',
  'circuit-routes-1': 'Retro',
  'delta-maze-1': 'Retro',
};

export const GENERATIVE_CATEGORY_ORDER = ['Geometric', 'Psychedelic', 'Text', 'Lines & Terrain', 'Retro', 'Other'];

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

    const defaultElements: GenerativeElement[] = [
      { id: "background", name: "Background", defaultColor: metadata.color === 'white' ? "#ffffff" : "#000000" },
      { id: "primary", name: "Primary Geometry", defaultColor: metadata.color === 'white' ? "#eb556b" : "#ffffff" },
      { id: "secondary", name: "Secondary Accent", defaultColor: "#7599a4" },
      { id: "highlight", name: "Highlights & Lines", defaultColor: "#f5a6b5" }
    ];

    const uuid = metadata.uuid || Math.random().toString();
    return {
      uuid,
      description: metadata.description || 'Generative',
      color: metadata.color || 'black',
      category: metadata.category || GENERATIVE_CATEGORIES[uuid] || 'Other',
      movement: metadata.movement || false,
      parameters: metadata.parameters || [],
      elements: metadata.elements || defaultElements,
      defaultPaletteId: metadata.defaultPaletteId || (metadata.color === 'white' ? 'monochrome_duo_white' : 'monochrome_duo'),
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

export function isTransparentColor(c?: string): boolean {
  if (!c) return false;
  const s = c.trim().toLowerCase();
  return s === 'transparent' || s === 'none' || (s.startsWith('rgba(') && s.endsWith(', 0)')) || (s.startsWith('rgba(') && s.endsWith(',0)')) || s === '#00000000' || s === '#0000' || (s.startsWith('#') && s.length === 9 && s.endsWith('00'));
}

function parseHexColorVec3(hex: string): [number, number, number] {
  if (!hex || isTransparentColor(hex)) return [0, 0, 0];
  let clean = hex.replace('#', '');
  if (clean.length === 3) clean = clean.split('').map(c => c + c).join('');
  if (clean.length >= 6) {
    const r = parseInt(clean.substring(0, 2), 16) / 255.0;
    const g = parseInt(clean.substring(2, 4), 16) / 255.0;
    const b = parseInt(clean.substring(4, 6), 16) / 255.0;
    return [isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b];
  }
  return [0, 0, 0];
}

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
    [
      'time', 'resolution',
      'u_color_0', 'u_color_1', 'u_color_2', 'u_color_3', 'u_color_4',
      'u_color_0_alpha', 'u_color_1_alpha', 'u_color_2_alpha', 'u_color_3_alpha', 'u_color_4_alpha',
      'luck_spin', 'luck_seed',
      ...def.parameters.map(p => p.name)
    ].forEach(name => {
      const loc = gl.getUniformLocation(program, name);
      if (loc) uniforms[name] = loc;
    });

    if (def.elements) {
      def.elements.forEach(el => {
        const loc = gl.getUniformLocation(program, `u_${el.id}`) || gl.getUniformLocation(program, el.id);
        if (loc) uniforms[`u_${el.id}`] = loc;
        const locA = gl.getUniformLocation(program, `u_${el.id}_alpha`);
        if (locA) uniforms[`u_${el.id}_alpha`] = locA;
      });
    }

    this.programs[def.uuid] = { program, uniforms };
  }

  render(def: GenerativeDefinition, time: number, settings: Record<string, number>, colors?: Record<string, string>) {
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

    // runtime-only uniforms passed through settings (not user-facing params)
    ['luck_spin', 'luck_seed'].forEach(k => {
      if (progData.uniforms[k] && typeof settings[k] === 'number') gl.uniform1f(progData.uniforms[k], settings[k]);
    });

    if (def.elements) {
      def.elements.forEach((el, idx) => {
        const rawColor = (colors && colors[el.id]) ? colors[el.id] : el.defaultColor;
        const [r, g, b] = parseHexColorVec3(rawColor);
        const isTransp = isTransparentColor(rawColor);
        
        const uIdx = progData.uniforms[`u_color_${idx}`];
        if (uIdx) gl.uniform3f(uIdx, r, g, b);

        const uIdxAlpha = progData.uniforms[`u_color_${idx}_alpha`];
        if (uIdxAlpha) gl.uniform1f(uIdxAlpha, isTransp ? 0.0 : 1.0);
        
        const uNamed = progData.uniforms[`u_${el.id}`];
        if (uNamed) gl.uniform3f(uNamed, r, g, b);

        const uNamedAlpha = progData.uniforms[`u_${el.id}_alpha`];
        if (uNamedAlpha) gl.uniform1f(uNamedAlpha, isTransp ? 0.0 : 1.0);
      });
    }

    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
