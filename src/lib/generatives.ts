export interface GenerativeParameter {
  name: string;
  min: number;
  max: number;
  default: number;
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
    { "name": "speed", "min": 0.5, "max": 20.0, "default": 4.0 },
    { "name": "freq",  "min": 0.1, "max": 4.0,  "default": 0.8 },
    { "name": "amp",   "min": 1.0, "max": 60.0, "default": 18.0 },
    { "name": "lines", "min": 5.0, "max": 150.0,"default": 45.0 }
  ],
  "uuid": "waves-canvas-gen-1"
}*/`,
    code: `
#ifdef GL_ES
precision highp float;
#endif

uniform float time;
uniform vec2 resolution;
uniform float randomness;
uniform float spacing;
uniform float speed;

varying vec2 texCoord;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865, 0.366025403, -0.577350269, 0.024390243);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m ; m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.792842914 - 0.8537347209 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
    vec2 uv = texCoord * 2.0 - 1.0;
    uv.x *= resolution.x / resolution.y;
    
    float t = time * speed;
    
    float n = snoise(vec2(uv.y * 1.5, t * 0.4)) * 0.5 + 
              snoise(vec2(uv.y * 3.0, t * 0.8)) * 0.25 +
              snoise(vec2(uv.y * 6.0, t * 1.2)) * 0.125;
              
    float displacedX = uv.x + n * randomness * 0.6;
    float dist = abs(fract(displacedX / spacing + 0.5) - 0.5) * spacing;
    
    float lineT = 0.003; 
    float aa = 0.002;
    
    float line = smoothstep(lineT + aa, lineT, dist);
    
    gl_FragColor = vec4(1.0, 1.0, 1.0, clamp(line, 0.0, 1.0));
}`
  },
  {
    header: `/*{
  "description": "Particle Sphere",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "particles", "min": 20.0,  "max": 2000.0, "default": 800.0 },
    { "name": "wiggle",    "min": 0.0,   "max": 1.0,    "default": 0.22 },
    { "name": "radius",    "min": 50.0,  "max": 220.0,  "default": 140.0 },
    { "name": "ball_size", "min": 1.0,   "max": 10.0,   "default": 3.5 },
    { "name": "speed",     "min": 0.0,   "max": 3.0,    "default": 0.5 },
    { "name": "light_x",   "min": -1.0,  "max": 1.0,    "default": -0.5 }
  ],
  "uuid": "particles-sphere-canvas-1"
}*/`,
    code: `// Custom Canvas 2D Implementation rendered natively via UUID interception`
  },
  {
    header: `/*{
  "description": "Topography",
  "color": "white",
  "movement": true,
  "parameters": [
    { "name": "speed",  "min": 0.0, "max": 10.0,  "default": 1.0 },
    { "name": "freq",   "min": 0.2, "max": 6.0,   "default": 1.5 },
    { "name": "amp",    "min": 10.0,"max": 400.0, "default": 320.0 },
    { "name": "lines",  "min": 5.0, "max": 100.0, "default": 25.0 }
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
        gl.uniform1f(progData.uniforms[p.name], val);
      }
    });

    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
