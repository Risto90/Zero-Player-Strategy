import { FLAG_EMBLEM_CONFIG as CONFIG } from './flagEmblemConfig';
import type { FlagEmblemComposerId, FlagEmblemModuleId } from './flagEmblemConfig';

export interface EmblemPoint { x: number; y: number }
export type EmblemPrimitive =
  | { kind: 'polygon'; points: EmblemPoint[]; fill: string; strokeWidth?: number }
  | { kind: 'circle'; center: EmblemPoint; radius: number; fill: string }
  | { kind: 'ring'; center: EmblemPoint; outerRadius: number; innerRadius: number; fill: string };
export interface EmblemNode {
  module?: FlagEmblemModuleId;
  composer?: FlagEmblemComposerId;
  params?: Record<string, any>;
  children?: EmblemNode[];
}
export interface EmblemBuildOptions {
  rng?: () => number;
  scale?: number;
  canvasHeight?: number;
}
export interface EmblemBuildResult {
  primitives: EmblemPrimitive[];
  primitiveCount: number;
  depth: number;
  requiredScale: number;
  slots: { inner: string; outer: string };
  graph?: { nodes: EmblemPoint[]; edges: { from: number; to: number; curved: boolean }[] };
}

const rad = (degrees: number) => degrees * Math.PI / 180;
const point = (x: number, y: number): EmblemPoint => ({ x, y });
const poly = (points: EmblemPoint[], fill = 'outer', strokeWidth?: number): EmblemPrimitive =>
  ({ kind: 'polygon', points, fill, ...(strokeWidth === undefined ? {} : { strokeWidth }) });
const circle = (x: number, y: number, radius: number, fill = 'outer'): EmblemPrimitive =>
  ({ kind: 'circle', center: point(x, y), radius, fill });
const ring = (x: number, y: number, outerRadius: number, innerRadius: number, fill = 'outer'): EmblemPrimitive =>
  ({ kind: 'ring', center: point(x, y), outerRadius, innerRadius, fill });
const rect = (x0: number, y0: number, x1: number, y1: number, fill = 'outer'): EmblemPrimitive =>
  poly([point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)], fill);
const ellipsePoly = (cx: number, cy: number, rx: number, ry: number, samples = 48): EmblemPoint[] =>
  Array.from({ length: samples }, (_, i) => {
    const a = 2 * Math.PI * i / samples;
    return point(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
  });
const triangle = (a: EmblemPoint, b: EmblemPoint, c: EmblemPoint, fill = 'outer') => poly([a, b, c], fill);
const merge = (...parts: EmblemPrimitive[][]) => parts.flat();
const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));
const nearest = (value: number, allowed: readonly number[]) =>
  allowed.reduce((best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best, allowed[0]);
const val = (p: Record<string, any>, key: string, fallback: number) => Number.isFinite(p[key]) ? p[key] : fallback;
const text = (p: Record<string, any>, key: string, fallback: string) => typeof p[key] === 'string' ? p[key] : fallback;
function missingSeededRng():number {
  throw new TypeError('GLYPH construction requires an injected seeded random source');
}
const circleSamples = CONFIG.defaults.circleSamples;

function star(points: number, innerRatio: number, angleOffset = -90): EmblemPrimitive {
  const vertices = Array.from({ length: points * 2 }, (_, i) => {
    const r = i % 2 ? innerRatio * 0.5 : 0.5;
    const a = rad(angleOffset + i * 180 / points);
    return point(r * Math.cos(a), r * Math.sin(a));
  });
  return poly(vertices);
}
function regularPolygon(sides: number, rotation = -90): EmblemPrimitive {
  return poly(Array.from({ length: sides }, (_, i) => {
    const a = rad(rotation + i * 360 / sides);
    return point(0.5 * Math.cos(a), 0.5 * Math.sin(a));
  }));
}
function crescent(innerRatio: number, offsetRatio: number, rotation: number): EmblemPrimitive {
  const R = 0.5;
  const r = R * innerRatio;
  const d = R * offsetRatio;
  if (!(Math.abs(R-r)<d&&d<R+r&&R+d-r>=0.2*R)) {
    throw new RangeError('crescent parameters do not meet the specified intersection and thickness constraints');
  }
  const x0 = (d * d + R * R - r * r) / (2 * d);
  const y0 = Math.sqrt(Math.max(0, R * R - x0 * x0));
  const top = Math.atan2(-y0, x0);
  const bottom = Math.atan2(y0, x0);
  const relative = Math.atan2(y0, x0 - d);
  const outer: EmblemPoint[] = [];
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const a = top - (2 * Math.PI - (bottom - top)) * i / n;
    outer.push(point(R * Math.cos(a), R * Math.sin(a)));
  }
  for (let i = 1; i <= n; i++) {
    const a = relative + (2 * Math.PI - 2 * relative) * i / n;
    outer.push(point(d + r * Math.cos(a), r * Math.sin(a)));
  }
  const angle = rad(rotation);
  return poly(outer.map(({ x, y }) => point(x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle))));
}
function lens(length: number, width: number, fill = 'outer'): EmblemPrimitive {
  const half = length / 2;
  const halfWidth = Math.min(width / 2, half * 0.98);
  const centerOffset = Math.max(0, (half * half - halfWidth * halfWidth) / (2 * halfWidth));
  const radius = centerOffset + halfWidth;
  const upperLeft = Math.atan2(-half, -centerOffset);
  const lowerLeft = Math.atan2(half, -centerOffset) - 2 * Math.PI;
  const lowerRight = Math.atan2(half, centerOffset);
  const upperRight = Math.atan2(-half, centerOffset);
  const points: EmblemPoint[] = [];
  const samples = 32;
  for (let i = 0; i <= samples; i++) {
    const angle = upperLeft + (lowerLeft - upperLeft) * i / samples;
    points.push(point(centerOffset + radius * Math.cos(angle), radius * Math.sin(angle)));
  }
  for (let i = 1; i <= samples; i++) {
    const angle = lowerRight + (upperRight - lowerRight) * i / samples;
    points.push(point(-centerOffset + radius * Math.cos(angle), radius * Math.sin(angle)));
  }
  return poly(points, fill);
}
function transformPrimitive(item: EmblemPrimitive, matrix: { x: number; y: number; scale: number; angle: number; mirrorX?: boolean }): EmblemPrimitive {
  const apply = ({ x, y }: EmblemPoint) => {
    const mx = matrix.mirrorX ? -x : x;
    const a = matrix.angle;
    return point(matrix.x + matrix.scale * (mx * Math.cos(a) - y * Math.sin(a)), matrix.y + matrix.scale * (mx * Math.sin(a) + y * Math.cos(a)));
  };
  if (item.kind === 'polygon') return { ...item, points: item.points.map(apply),
    ...(item.strokeWidth === undefined ? {} : { strokeWidth: item.strokeWidth * matrix.scale }) };
  const center = apply(item.center);
  return item.kind === 'circle'
    ? { ...item, center, radius: item.radius * matrix.scale }
    : { ...item, center, outerRadius: item.outerRadius * matrix.scale, innerRadius: item.innerRadius * matrix.scale };
}
function translate(parts: EmblemPrimitive[], x: number, y: number, scale = 1, angle = 0, mirrorX = false) {
  return parts.map((item) => transformPrimitive(item, { x, y, scale, angle: rad(angle), mirrorX }));
}
function assignSlot(parts:EmblemPrimitive[],slot:'inner'|'outer'):EmblemPrimitive[] {
  return parts.map((item)=>({...item,fill:slot}));
}

function buildModule(id: FlagEmblemModuleId, input: Record<string, any>, rng: () => number): EmblemPrimitive[] {
  const defaults = CONFIG.modules[id].defaults as Record<string, any>;
  const p = { ...defaults, ...input };
  const n = (key: string, d: number) => val(p, key, d);
  switch (id) {
    case 'M01': return [circle(0, 0, 0.5)];
    case 'M02': return [ring(0, 0, 0.5, 0.5 * clamp(n('innerRatio', 0.65), 0.45, 0.85))];
    case 'M03': {
      const count = Math.round(clamp(n('points', 5), 3, 24));
      let rho = clamp(n('innerRatio', 0.382), 0.4, 0.75);
      if (text(p, 'mode', 'POINTED') === 'POINTED' && count >= 5) {
        const skip = Math.round(clamp(n('skip', 2), 2, Math.floor((count - 1) / 2)));
        rho = Math.cos(Math.PI * skip / count) / Math.cos(Math.PI * (skip - 1) / count);
      } else {
        const halfAngle=rad(CONFIG.glyph.minimumStarTipAngle/2);
        const spacing=rad(180/count);
        const minimumRho=Math.tan(halfAngle)/(Math.sin(spacing)+Math.tan(halfAngle)*Math.cos(spacing));
        rho=Math.max(rho,minimumRho);
      }
      return [star(count, rho)];
    }
    case 'M04': {
      const sides = Math.round(clamp(n('sides', 5), 3, 12));
      return [regularPolygon(sides, text(p, 'rotation', 'FLAT') === 'POINT' ? 180 / sides : 0)];
    }
    case 'M05': {
      const ratio = clamp(n('verticalRatio', 0.75), 0.5, 1);
      return [poly([point(-0.5 * ratio, 0), point(0, -0.5), point(0.5 * ratio, 0), point(0, 0.5)])];
    }
    case 'M06': return [crescent(clamp(n('innerRatio', 0.8), 0.7, 0.92), clamp(n('offsetRatio', 0.35), 0.2, 0.55), nearest(n('rotation',0),[0,45,90,135,180,225,270,315]))];
    case 'M07': {
      const rays = nearest(n('rays', 12), [8,12,16,24,32]);
      const core = clamp(n('coreRadius', 0.24), 0.08, 0.4);
      const length = clamp(n('rayLength', 0.55), 0.25, 0.8) * core * 2;
      const half = clamp(n('rayWidth', 0.65), 0.4, 0.9) * Math.PI * core / rays;
      const type = text(p, 'rayType', 'TRI');
      const items: EmblemPrimitive[] = [circle(0, 0, core)];
      for (let i = 0; i < rays; i++) {
        const a = -Math.PI / 2 + i * 2 * Math.PI / rays;
        const outer = core + (type === 'LONG_SHORT' && i % 2 ? length / 2 : length);
        const c = Math.cos(a), s = Math.sin(a), t = -s, u = c;
        if (type === 'BAR') {
          items.push(poly([point(core*c-half*t, core*s-half*u), point(outer*c-half*t, outer*s-half*u), point(outer*c+half*t, outer*s+half*u), point(core*c+half*t, core*s+half*u)]));
        } else if (type === 'WAVY_ALT' && i % 2 === 1) {
          const amplitude = clamp(n('waveAmplitude', 0.08), 0.02, 0.16);
          const left: EmblemPoint[] = [], right: EmblemPoint[] = [];
          for (let step = 0; step <= 24; step += 1) {
            const t0 = step / 24;
            const radius = core + (outer - core) * t0;
            const centerShift = amplitude * Math.sin(2 * Math.PI * t0);
            const cx = radius * c + centerShift * t, cy = radius * s + centerShift * u;
            const width = half * (1 - t0);
            left.push(point(cx - width * t, cy - width * u));
            right.push(point(cx + width * t, cy + width * u));
          }
          items.push(poly([...left, ...right.reverse()]));
        } else if (type === 'KITE') {
          items.push(poly([point(core*c-half*t, core*s-half*u), point((core+length*0.55)*c, (core+length*0.55)*s), point(outer*c, outer*s), point(core*c+half*t, core*s+half*u)]));
        } else {
          items.push(triangle(point(core*c-half*t, core*s-half*u), point(core*c+half*t, core*s+half*u), point(outer*c, outer*s)));
        }
      }
      return items;
    }
    case 'M08': {
      const spokes = nearest(n('spokes', 8), [6,8,12,16,24]);
      const inner = 0.5 * clamp(n('innerRatio', 0.66), 0.45, 0.85);
      const items: EmblemPrimitive[] = [ring(0, 0, 0.5, inner), circle(0, 0, 0.5 * clamp(n('hubRatio', 0.17), 0.12, 0.25))];
      for (let i = 0; i < spokes; i++) {
        const a = 2 * Math.PI * i / spokes;
        items.push(poly([point(inner*Math.cos(a)-0.012*Math.sin(a), inner*Math.sin(a)+0.012*Math.cos(a)),
          point(0.5*Math.cos(a)-0.012*Math.sin(a), 0.5*Math.sin(a)+0.012*Math.cos(a)),
          point(0.5*Math.cos(a)+0.012*Math.sin(a), 0.5*Math.sin(a)-0.012*Math.cos(a)),
          point(inner*Math.cos(a)+0.012*Math.sin(a), inner*Math.sin(a)-0.012*Math.cos(a))]));
      }
      if (p.gear) {
        const teeth = Math.round(clamp(n('teeth', spokes), 8, 16));
        for (let i = 0; i < teeth; i++) {
          const a = 2 * Math.PI * i / teeth;
          items.push(...translate([rect(-0.045, -0.02, 0.045, 0.02)], 0.5*Math.cos(a), 0.5*Math.sin(a), 1, a*180/Math.PI));
        }
      }
      return items;
    }
    case 'M09': {
      const arms = [3, 4, 5].includes(n('arms', 4)) ? n('arms', 4) : 4;
      const t = clamp(n('thickness', 0.22), 0.15, 0.35);
      const profile = text(p, 'profile', 'RECT');
      const arm: EmblemPrimitive[] = [rect(-t/2, -0.5, t/2, 0.5)];
      const side = [rect(-0.5, -t/2, 0.5, t/2)];
      if (profile === 'FLARED') {
        arm.push(poly([point(-t/2,-0.32),point(-t*0.8,-0.5),point(t*0.8,-0.5),point(t/2,-0.32)]));
        side.push(poly([point(-0.32,-t/2),point(-0.5,-t*0.8),point(-0.5,t*0.8),point(-0.32,t/2)]));
      }
      if (profile === 'MALTESE') {
        return Array.from({ length: arms }, (_, i) => translate([poly([
          point(-t/2,-0.12),point(-t/2,-0.38),point(-t*0.9,-0.5),point(0,-0.42),
          point(t*0.9,-0.5),point(t/2,-0.38),point(t/2,-0.12),point(0,-0.22),
        ])], 0, 0, 1, i*360/arms)).flat();
      }
      if (profile === 'BOTTONY') {
        for (const a of [0, 90, 180, 270]) {
          const theta = rad(a);
          arm.push(circle(0.43*Math.sin(theta), -0.43*Math.cos(theta), t/2, 'detail'));
        }
      }
      if (arms === 4) return merge(arm, side);
      const spokes: EmblemPrimitive[] = [];
      for (let i = 0; i < arms; i++) spokes.push(...translate([rect(-t/2, -0.5, t/2, 0)], 0, 0, 1, i*360/arms));
      return spokes;
    }
    case 'M10': {
      const mode = text(p, 'mode', 'ARROW');
      const t = clamp(n('thickness', 0.12), 0.05, 0.25);
      if (mode === 'CHEVRON') {
        const a = rad(clamp(n('angle', 50), 20, 120) / 2);
        return [poly([point(0.5*Math.cos(a),-0.5*Math.sin(a)),point(0.5*Math.cos(a)-t*Math.sin(a),-0.5*Math.sin(a)-t*Math.cos(a)),point(0,0),point(0.5*Math.cos(a)-t*Math.sin(a),0.5*Math.sin(a)+t*Math.cos(a)),point(0.5*Math.cos(a),0.5*Math.sin(a))])];
      }
      return [rect(-0.34, -t/2, 0.25, t/2), triangle(point(0.2,-0.18), point(0.5,0), point(0.2,0.18))];
    }
    case 'M11': return [lens(clamp(n('length', 0.8), 0.25, 1), clamp(n('width', 0.38), 0.1, 0.6))];
    case 'M12': {
      const sideAngle = clamp(n('sideAngle', 45), 35, 60);
      const items = [lens(0.82, 0.3)];
      items.push(...translate([lens(0.62, 0.25)], -0.12, 0.06, 1, 90-sideAngle));
      items.push(...translate([lens(0.62, 0.25)], 0.12, 0.06, 1, sideAngle-90));
      items.push(rect(-0.225, 0.15, 0.225, 0.27, 'detail'));
      if (p.lowerPetal) items.push(...translate([lens(0.32,0.16)],0,0.31,1,90));
      return items;
    }
    case 'M13': {
      const merlons = Math.round(clamp(n('merlons', 4), 3, 7));
      const items: EmblemPrimitive[] = [rect(-0.4, 0.05, 0.4, 0.42)];
      const step = 0.8 / merlons;
      for (let i=0;i<merlons;i++) items.push(rect(-0.4+i*step, -0.08, -0.4+i*step+step/2, 0.06));
      items.push(rect(-0.08, 0.23, 0.08, 0.42, 'detail'));
      if (p.archedDoor) items.push(circle(0,0.23,0.08,'detail'));
      if (p.sideTowers) {
        items.push(rect(-0.5,0.02,-0.3,0.42), rect(0.3,0.02,0.5,0.42));
      }
      const windows = Math.round(clamp(n('windows',0),0,3));
      for (let i=0;i<windows;i++) items.push(rect(-0.27+i*0.18,0.12,-0.21+i*0.18,0.18,'detail'));
      return items;
    }
    case 'M14': {
      const count = [3,5,7].includes(n('points',5)) ? n('points',5) : 5;
      const items: EmblemPrimitive[] = [rect(-0.36,0.2,0.36,0.34)];
      for(let i=0;i<count;i++) {
        const x = -0.32 + 0.64*i/(count-1);
        items.push(triangle(point(x-0.055,0.2),point(x, -0.18-(i%2===0?0.03:0)),point(x+0.055,0.2)));
        items.push(circle(x,-0.18-(i%2===0?0.03:0),0.035));
      }
      if(p.arch) items.push(poly(ellipsePoly(0,-0.04,0.28,0.22,32)));
      return items;
    }
    case 'M15': {
      const teeth = Math.round(clamp(n('teeth',2),1,3));
      const items: EmblemPrimitive[] = [ring(-0.27,-0.22,0.16,0.09), rect(-0.13,-0.25,0.34,-0.19)];
      for(let i=0;i<teeth;i++) items.push(rect(0.15+i*0.06,-0.19,0.21+i*0.06,-0.08+i*0.03));
      return items;
    }
    case 'M16': return [
      poly([point(-0.07,-0.35),point(0.07,-0.35),point(0.055,0.29),point(0,0.5),point(-0.055,0.29)]),
      rect(-0.24,-0.31,0.24,-0.25,'detail'), rect(-0.045,-0.25,0.045,-0.12,'detail'), circle(0,-0.37,0.055),
    ];
    case 'M17': {
      const items: EmblemPrimitive[] = [rect(-0.025,-0.25,0.025,0.48)];
      if (text(p,'mode','SPEAR') === 'TRIDENT') {
        items.push(triangle(point(-0.1,-0.25),point(0,-0.5),point(0.1,-0.25)));
        items.push(...translate([poly([point(-0.2,-0.16),point(-0.14,-0.43),point(-0.06,-0.35),point(-0.1,-0.15)])],0,0));
        items.push(...translate([poly([point(0.2,-0.16),point(0.14,-0.43),point(0.06,-0.35),point(0.1,-0.15)])],0,0));
      } else items.push(poly([point(-0.13,-0.24),point(0,-0.5),point(0.13,-0.24)]));
      return items;
    }
    case 'M18': return [
      rect(-0.025,-0.2,0.025,0.42), rect(-0.32,-0.08,0.32,-0.02), ring(0,-0.27,0.13,0.075),
      poly([
        ...Array.from({length:25},(_,i)=>{const a=rad(160+i*200/24);return point(0.35*Math.cos(a),0.12+0.35*Math.sin(a));}),
        ...Array.from({length:25},(_,i)=>{const a=rad(360-i*200/24);return point(0.29*Math.cos(a),0.12+0.29*Math.sin(a));}),
      ]),
      triangle(point(-0.32,0.12),point(-0.18,0.08),point(-0.22,0.27)),
      triangle(point(0.32,0.12),point(0.18,0.08),point(0.22,0.27)),
    ];
    case 'M19': {
      const style=text(p,'style','CONIFER');
      const items:EmblemPrimitive[]=[rect(-0.045,0.18,0.045,0.5)];
      if(style==='ROUND') {
        const count=Math.round(clamp(n('tiers',4),3,5));
        for(let i=0;i<count;i++) items.push(circle((i%2?0.1:-0.1),-0.32+Math.floor(i/2)*0.2,0.17));
      } else if(style==='PALM') {
        const leaves=Math.round(clamp(n('leaves',7),5,9));
        for(let i=0;i<leaves;i++) items.push(...translate([lens(0.38,0.13)],0,-0.16,1,-135+i*270/(leaves-1)));
        items.push(circle(0,-0.17,0.05));
      } else {
        const tiers=Math.round(clamp(n('tiers',3),2,4));
        for(let i=0;i<tiers;i++) items.push(triangle(point(-0.38+i*0.07,0.3-i*0.21),point(0, -0.18+i*0.18),point(0.38-i*0.07,0.3-i*0.21)));
      }
      return items;
    }
    case 'M20': {
      const peaks=Math.round(clamp(n('peaks',1),1,3));
      const items:EmblemPrimitive[]=[];
      for(let i=0;i<peaks;i++){
        const cx=(i-(peaks-1)/2)*0.26, height=0.38-(i%2)*0.08;
        items.push(triangle(point(cx-0.3,0.38),point(cx,-height),point(cx+0.3,0.38)));
        if(p.snow) items.push(poly([point(cx-0.09,-height+0.12),point(cx,-height),point(cx+0.09,-height+0.12),point(cx+0.03,-height+0.09),point(cx,-height+0.13),point(cx-0.04,-height+0.09)],'detail'));
      }
      items.push(rect(-0.5,0.38,0.5,0.48));
      if(p.sun) items.push(circle(0,-0.25,0.13,'detail'));
      return items;
    }
    case 'M21': {
      const bands=Math.round(clamp(n('bands',3),2,4));
      const amplitude=clamp(n('amplitude',0.08),0.03,0.2), wave=clamp(n('wavelength',0.28),0.12,0.6);
      const items:EmblemPrimitive[]=[];
      for(let band=0;band<bands;band++){
        const y=-0.36+band*0.24, points=[point(-0.5,y)];
        for(let i=0;i<=48;i++){const x=-0.5+i/48;points.push(point(x,y+amplitude*Math.sin((x+0.5)*2*Math.PI/wave)));}
        points.push(point(0.5,0.5),point(-0.5,0.5));
        items.push(poly(points,band%2?'inner':'outer'));
      }
      return items;
    }
    case 'M22': {
      const items:EmblemPrimitive[]=[poly([point(-0.43,0.2),point(0.43,0.2),point(0.3,0.38),point(-0.3,0.38)]),rect(-0.025,-0.4,0.025,0.2)];
      const sails=Math.round(clamp(n('sails',2),1,3));
      for(let i=0;i<sails;i++){
        const x=-0.02+i*0.13;
        items.push(triangle(point(x,-0.34+i*0.1),point(x,0.12),point(0.26+i*0.1,0.12)));
      }
      items.push(triangle(point(0.025,-0.4),point(0.2,-0.32),point(0.025,-0.24)));
      if(p.galley){
        const oars=Math.round(clamp(n('oars',6),4,8));
        for(let i=0;i<oars;i++) items.push(rect(-0.48+i*0.96/(oars-1),0.05,-0.45+i*0.96/(oars-1),0.24,'detail'));
      }
      return items;
    }
    case 'M23': {
      const body=text(p,'body','DISC');
      const items:EmblemPrimitive[]=body==='RHOMBUS'
        ? [poly([point(0,-0.12),point(0.12,0),point(0,0.12),point(-0.12,0)])]
        : body==='LENS' ? [lens(0.24,0.16)] : [circle(0,0,0.09)];
      const feathers=Math.round(clamp(n('feathers',4),3,7));
      for(let side of [-1,1]){
        for(let i=0;i<feathers;i++){
          const angle=side*(clamp(n('featherAngle',35),15,70)*(0.35+i*0.65/(feathers-1)));
          const length=0.43*(1-0.1*i);
          items.push(...translate([lens(length,0.12)],side*(0.13+i*0.03),-0.05+i*0.055,1,angle));
        }
      }
      if(p.tail) items.push(...translate([lens(0.3,0.12)],0,0.34,1,90));
      if(p.head) items.push(circle(0,-0.16,0.08),triangle(point(0.04,-0.17),point(0.2,-0.14),point(0.05,-0.11)));
      return items;
    }
    case 'M24': return buildGlyph(p, rng).primitives;
    case 'M25': {
      const lobes=[2,3].includes(n('lobes',3))?n('lobes',3):3;
      const items:EmblemPrimitive[]=[];
      for(let i=0;i<lobes;i++){
        const a=2*Math.PI*i/lobes, x=0.18*Math.cos(a),y=0.18*Math.sin(a);
        items.push(circle(x,y,0.19),circle(x+0.1*Math.cos(a+Math.PI/2),y+0.1*Math.sin(a+Math.PI/2),0.06,'inner'));
      }
      return items;
    }
    case 'M26': {
      const style=text(p,'style','TREFOIL');
      const count=style==='QUATREFOIL'?4:style==='ROSE'?5:3;
      const radius=clamp(n('radius',0.32),0.25,0.4);
      const items:EmblemPrimitive[]=[];
      for(let i=0;i<count;i++){
        const a=2*Math.PI*i/count;
        items.push(circle(radius*Math.cos(a),radius*Math.sin(a),0.2));
      }
      if(style==='ROSE') items.push(circle(0,0,0.14,'detail'));
      return items;
    }
    case 'M27': return [
      lens(0.8,0.36), ...translate([lens(0.55,0.25)],-0.12,0.08,1,-35),
      ...translate([lens(0.55,0.25)],0.12,0.08,1,35),
    ];
    case 'M28': {
      const shape=text(p,'shape','HEATER'), inset=clamp(n('inset',0.58),0.45,0.7);
      let points:EmblemPoint[];
      if(shape==='ROUND') points=ellipsePoly(0,0,0.5,0.5,circleSamples);
      else if(shape==='KITE') points=[point(0,-0.5),point(0.42,-0.08),point(0.32,0.34),point(0,0.5),point(-0.32,0.34),point(-0.42,-0.08)];
      else if(shape==='LOZENGE') points=[point(0,-0.5),point(0.36,0),point(0,0.5),point(-0.36,0)];
      else if(shape==='PENTAGON') points=(regularPolygon(5) as Extract<EmblemPrimitive,{kind:'polygon'}>).points;
      else points=[point(-0.4,-0.5),point(0.4,-0.5),point(0.38,0.15),point(0,0.5),point(-0.38,0.15)];
      return [poly(points), poly(points.map(({x,y})=>point(x*inset,y*inset)),'inner')];
    }
    case 'M29': {
      const span=rad(clamp(n('span',120),100,140)), half=span/2, thickness=clamp(n('strokeWidth',0.055),0.025,0.09);
      const arc:EmblemPoint[]=[];
      for(let i=0;i<=40;i++){const a=-half+span*i/40;arc.push(point(0.33*Math.cos(a),0.33*Math.sin(a)));}
      const outer=arc.map(({x,y})=>point(x*(1+thickness/0.33),y*(1+thickness/0.33)));
      const inner=[...arc].reverse().map(({x,y})=>point(x*(1-thickness/0.33),y*(1-thickness/0.33)));
      return [poly([...outer,...inner]), rect(-0.36,-thickness/2,0.36,thickness/2), ...translate(buildModule('M10',{mode:'ARROW'},rng),0,0,0.55,0)];
    }
    case 'M30': {
      const ids=(Array.isArray(p.modules)?p.modules:defaults.modules) as string[];
      const allowed:FlagEmblemModuleId[]=['M01','M06','M11','M04'];
      const list=ids.filter((m):m is FlagEmblemModuleId=>allowed.includes(m as FlagEmblemModuleId)).slice(0,4);
      const items:EmblemPrimitive[]=[rect(-0.42,-0.42,-0.35,0.42),rect(0.35,-0.42,0.42,0.42)];
      const h=0.72/Math.max(1,list.length);
      list.forEach((module,index)=>{
        const shape=buildModule(module,{},rng);
        items.push(...translate(shape,0,-0.36+h*(index+0.5),Math.min(0.55,h*1.5)));
      });
      return items;
    }
  }
}

function distance(a: EmblemPoint, b: EmblemPoint) { return Math.hypot(a.x-b.x,a.y-b.y); }
function segmentDistance(a:EmblemPoint,b:EmblemPoint,c:EmblemPoint,d:EmblemPoint):number {
  const cross=(p:EmblemPoint,q:EmblemPoint,r:EmblemPoint)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  const c1=cross(a,b,c),c2=cross(a,b,d),c3=cross(c,d,a),c4=cross(c,d,b);
  const onSegment=(p:EmblemPoint,q:EmblemPoint,r:EmblemPoint)=>
    q.x>=Math.min(p.x,r.x)-1e-10&&q.x<=Math.max(p.x,r.x)+1e-10&&
    q.y>=Math.min(p.y,r.y)-1e-10&&q.y<=Math.max(p.y,r.y)+1e-10;
  if (((c1<0&&c2>0)||(c1>0&&c2<0))&&((c3<0&&c4>0)||(c3>0&&c4<0))) return 0;
  if (Math.abs(c1)<1e-10&&onSegment(a,c,b)||Math.abs(c2)<1e-10&&onSegment(a,d,b)||
      Math.abs(c3)<1e-10&&onSegment(c,a,d)||Math.abs(c4)<1e-10&&onSegment(c,b,d)) return 0;
  const pointDistance=(p:EmblemPoint,x:EmblemPoint,y:EmblemPoint)=>{
    const dx=y.x-x.x,dy=y.y-x.y,t=clamp(((p.x-x.x)*dx+(p.y-x.y)*dy)/(dx*dx+dy*dy||1),0,1);
    return distance(p,point(x.x+t*dx,x.y+t*dy));
  };
  return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));
}
function glyphPath(a:EmblemPoint,b:EmblemPoint,curve:boolean,bend:number):EmblemPoint[] {
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
  if(!curve||Math.abs(dx)>1e-8&&Math.abs(dy)>1e-8) return [a,b];
  const cx=(a.x+b.x)/2+bend*(-dy/length)*(length/2);
  const cy=(a.y+b.y)/2+bend*(dx/length)*(length/2);
  const radius=length/Math.sqrt(2),start=Math.atan2(a.y-cy,a.x-cx),end=Math.atan2(b.y-cy,b.x-cx);
  let sweep=end-start;
  while(sweep>Math.PI) sweep-=2*Math.PI;
  while(sweep< -Math.PI) sweep+=2*Math.PI;
  return Array.from({length:CONFIG.glyph.arcSamples+1},(_,i)=>{
    const angle=start+sweep*i/CONFIG.glyph.arcSamples;
    return point(cx+radius*Math.cos(angle),cy+radius*Math.sin(angle));
  });
}
function pathDistance(a:EmblemPoint[],b:EmblemPoint[]):number {
  let min=Infinity;
  for(let i=0;i<a.length-1;i++) for(let j=0;j<b.length-1;j++) {
    min=Math.min(min,segmentDistance(a[i],a[i+1],b[j],b[j+1]));
  }
  return min;
}
function convexHull(points:EmblemPoint[]):EmblemPoint[] {
  const sorted=[...points].sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(o:EmblemPoint,a:EmblemPoint,b:EmblemPoint)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lower:EmblemPoint[]=[],upper:EmblemPoint[]=[];
  for(const p of sorted){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p);}
  for(const p of [...sorted].reverse()){while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p);}
  return [...lower.slice(0,-1),...upper.slice(0,-1)];
}
function buildGlyph(p:Record<string,any>,rng:()=>number):EmblemBuildResult {
  const k=Math.round(clamp(val(p,'gridSize',3+Math.floor(rng()*3)),3,5));
  const mirrored=typeof p.mirrored==='boolean'?p.mirrored:rng()<CONFIG.glyph.mirrorProbability;
  const targetCount=Math.round(clamp(val(p,'edgeCount',3+Math.floor(rng()*6)),3,8));
  const count=mirrored?Math.max(2,Math.ceil(targetCount/2)):targetCount;
  const w=clamp(val(p,'strokeWidth',CONFIG.glyph.strokeWidth),0.02,0.2);
  const canvasHeight=val(p,'canvasHeight',CONFIG.glyph.defaultCanvasHeight);
  const scale=val(p,'scale',1);
  const requiredScale=CONFIG.glyph.minimumStroke/(w*canvasHeight);
  if(scale+1e-9<requiredScale) throw new RangeError('GLYPH stroke is thinner than the configured minimum after scaling');
  const candidates: {a:number;b:number;curve:boolean}[]=[];
  const idx=(x:number,y:number)=>y*k+x;
  for(let y=0;y<k;y++) for(let x=0;x<k;x++) {
    for(const [dx,dy] of [[1,0],[0,1],[1,1],[-1,1]]) {
      const xx=x+dx,yy=y+dy;
      if(xx>=0&&xx<k&&yy>=0&&yy<k) candidates.push({a:idx(x,y),b:idx(xx,yy),curve:dx===0||dy===0});
    }
  }
  const nodes=Array.from({length:k*k},(_,i)=>point(-0.3+(i%k)*0.6/(k-1),-0.3+Math.floor(i/k)*0.6/(k-1)));
  for(let attempt=0;attempt<CONFIG.glyph.attempts;attempt++){
    const edges:{a:number;b:number;curve:boolean;bend:number}[]=[];
    const row=Math.floor(rng()*k);
    const start=mirrored?row*k+Math.floor((k-1)/2):Math.floor(rng()*nodes.length);
    const connected=new Set([start]);
    if(mirrored&&k%2===0) {
      edges.push({a:start,b:start+1,curve:false,bend:1});
      connected.add(start+1);
    }
    const pool=[...candidates];
    while(edges.length<count) {
      const eligible=pool.filter(e=>connected.has(e.a)!==connected.has(e.b));
      if(!eligible.length) break;
      const candidate=eligible[Math.floor(rng()*eligible.length)];
      const axisEdge=mirrored&&Math.abs(nodes[candidate.a].x-nodes[candidate.b].x)<1e-8&&
        Math.abs(nodes[candidate.a].x)<1e-8;
      const edge={...candidate,curve:candidate.curve&&!axisEdge&&rng()<CONFIG.glyph.curveProbability,bend:rng()<0.5?1:-1};
      const a=nodes[edge.a],b=nodes[edge.b];
      const path=glyphPath(a,b,edge.curve,edge.bend);
      const valid=edges.every(old=>{
        const c=nodes[old.a],d=nodes[old.b];
        if(old.a===edge.a||old.a===edge.b||old.b===edge.a||old.b===edge.b) return true;
        return pathDistance(path,glyphPath(c,d,old.curve,old.bend))>=CONFIG.glyph.separationFactor*w;
      });
      pool.splice(pool.indexOf(candidate),1);
      if(!valid) continue;
      edges.push(edge); connected.add(edge.a);connected.add(edge.b);
    }
    if(edges.length!==count) continue;
    if(mirrored) {
      const mirrorEdge=(e:{a:number;b:number;curve:boolean;bend:number})=>{
        const mirrorIndex=(i:number)=>Math.floor(i/k)*k+(k-1-i%k);
        return {a:mirrorIndex(e.a),b:mirrorIndex(e.b),curve:e.curve,
          bend:e.curve&&Math.abs(nodes[e.a].x-nodes[e.b].x)<1e-8?-e.bend:e.bend};
      };
      const expanded=[...edges];
      for(const e of edges){
        const m=mirrorEdge(e);
        if(m.a===e.a&&m.b===e.b) continue;
        if(!expanded.some(q=>(q.a===m.a&&q.b===m.b)||(q.a===m.b&&q.b===m.a))) expanded.push(m);
      }
      if(expanded.length>targetCount||expanded.length<CONFIG.glyph.edgeCount[0]) continue;
      edges.splice(0,edges.length,...expanded);
    }
    const edgeKey=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`;
    const edgeSet=new Set(edges.map(({a,b})=>edgeKey(a,b)));
    const rotateNode=(nodeIndex:number,turns:number) => {
      let x=nodeIndex%k,y=Math.floor(nodeIndex/k);
      for(let turn=0;turn<turns;turn++) [x,y]=[k-1-y,x];
      return y*k+x;
    };
    const hasRotation90=[1,2,3].every((turns)=>edges.every(({a,b})=>edgeSet.has(edgeKey(rotateNode(a,turns),rotateNode(b,turns)))));
    const mirrorNode=(nodeIndex:number)=>(Math.floor(nodeIndex/k)*k)+(k-1-nodeIndex%k);
    const hasReflection=edges.every(({a,b})=>edgeSet.has(edgeKey(mirrorNode(a),mirrorNode(b))));
    if(hasRotation90&&!hasReflection) continue;
    let violatesSeparation=false;
    for(let i=0;i<edges.length;i++) for(let j=i+1;j<edges.length;j++) {
      const left=edges[i],right=edges[j];
      if(left.a===right.a||left.a===right.b||left.b===right.a||left.b===right.b) continue;
      const aPath=glyphPath(nodes[left.a],nodes[left.b],left.curve,left.bend);
      const bPath=glyphPath(nodes[right.a],nodes[right.b],right.curve,right.bend);
      if(pathDistance(aPath,bPath)<CONFIG.glyph.separationFactor*w) violatesSeparation=true;
    }
    if(violatesSeparation) continue;
    const involved=[...new Set(edges.flatMap(({a,b})=>[a,b]))].map(i=>nodes[i]);
    const width=Math.max(...involved.map(q=>q.x))-Math.min(...involved.map(q=>q.x));
    const height=Math.max(...involved.map(q=>q.y))-Math.min(...involved.map(q=>q.y));
    const aspect=Math.max(width,height)/Math.max(1e-8,Math.min(width,height));
    if(aspect>CONFIG.glyph.maxAspectRatio) continue;
    const reached=new Set([edges[0].a]);
    let changed=true;
    while(changed) {
      changed=false;
      for(const edge of edges) {
        if(reached.has(edge.a)&&!reached.has(edge.b)){reached.add(edge.b);changed=true;}
        if(reached.has(edge.b)&&!reached.has(edge.a)){reached.add(edge.a);changed=true;}
      }
    }
    if(edges.some(({a,b})=>!reached.has(a)||!reached.has(b))) continue;
    const polygons:EmblemPrimitive[]=[];
    for(const e of edges){
      const a=nodes[e.a],b=nodes[e.b],centerline=glyphPath(a,b,e.curve,e.bend);
      const left:EmblemPoint[]=[],right:EmblemPoint[]=[];
      for(let i=0;i<centerline.length;i++){
        const prev=centerline[Math.max(0,i-1)],next=centerline[Math.min(centerline.length-1,i+1)];
        const tx=next.x-prev.x,ty=next.y-prev.y,len=Math.hypot(tx,ty)||1;
        left.push(point(centerline[i].x-ty/len*w/2,centerline[i].y+tx/len*w/2));
        right.push(point(centerline[i].x+ty/len*w/2,centerline[i].y-tx/len*w/2));
      }
      polygons.push(poly([...left,...right.reverse()],'outer',w));
    }
    if(text(p,'endpointCap',CONFIG.glyph.defaultCap)==='ROUND') {
      for(const endpoint of new Set(edges.flatMap(({a,b})=>[a,b]))) {
        if(edges.filter(({a,b})=>a===endpoint||b===endpoint).length===1) {
          polygons.push(circle(nodes[endpoint].x,nodes[endpoint].y,w/2));
        }
      }
    }
    for(const joint of new Set(edges.flatMap(({a,b})=>[a,b]))) {
      const incident=edges.filter(({a,b})=>a===joint||b===joint);
      if(incident.length<2) continue;
      if(text(p,'join',CONFIG.glyph.defaultJoin)==='ROUND') {
        polygons.push(circle(nodes[joint].x,nodes[joint].y,w/2));
      } else {
        const offsets:EmblemPoint[]=[];
        for(const edge of incident) {
          const path=glyphPath(nodes[edge.a],nodes[edge.b],edge.curve,edge.bend);
          const atStart=edge.a===joint,near=atStart?path[1]:path[path.length-2];
          const dx=nodes[joint].x-near.x,dy=nodes[joint].y-near.y,length=Math.hypot(dx,dy)||1;
          const nx=-dy/length*w/2,ny=dx/length*w/2;
          offsets.push(point(nodes[joint].x+nx,nodes[joint].y+ny),point(nodes[joint].x-nx,nodes[joint].y-ny));
        }
        const hull=convexHull(offsets);
        if(hull.length>=3) {
          const join=poly(hull,'outer',w);
          if(primitiveArea(join)>1e-10) polygons.push(join);
        }
      }
    }
    for(let index=polygons.length-1;index>=0;index--) {
      if(primitiveArea(polygons[index])<=1e-10) polygons.splice(index,1);
    }
    const geometryBounds=flagEmblemBounds(polygons);
    const geometryAspect=Math.max(geometryBounds.width,geometryBounds.height)/
      Math.max(1e-8,Math.min(geometryBounds.width,geometryBounds.height));
    if(geometryAspect>CONFIG.glyph.maxAspectRatio||
      polygons.some((shape)=>shape.kind==='polygon'&&shape.points.some(({x,y})=>Math.hypot(x,y)>0.5+1e-8))) {
      continue;
    }
    return {
      primitives:polygons,
      primitiveCount:polygons.length,
      depth:1,
      requiredScale,
      slots:{inner:'inner',outer:'outer'},
      graph:{nodes,edges:edges.map(({a,b,curve,bend})=>({
        from:a,to:b,curved:curve,path:glyphPath(nodes[a],nodes[b],curve,bend),width:w,
      }))},
    };
  }
  throw new RangeError(`could not construct a valid connected GLYPH with the configured constraints (grid=${k}, mirrored=${mirrored}, edges=${targetCount})`);
}

export function generateFlagGlyph(params:Record<string,any>={},rng:()=>number=missingSeededRng):EmblemBuildResult {
  return buildGlyph(params,rng);
}

function primitiveArea(primitive:EmblemPrimitive):number {
  if(primitive.kind==='circle') return Math.PI*primitive.radius**2;
  if(primitive.kind==='ring') return Math.PI*(primitive.outerRadius**2-primitive.innerRadius**2);
  return Math.abs(primitive.points.reduce((sum,a,i)=>{
    const b=primitive.points[(i+1)%primitive.points.length];return sum+a.x*b.y-b.x*a.y;
  },0))/2;
}
export function flagEmblemArea(primitive:EmblemPrimitive):number { return primitiveArea(primitive); }
export function flagEmblemBounds(primitives:EmblemPrimitive[]) {
  const points=primitives.flatMap(item=>item.kind==='polygon'?item.points:
    [point(item.center.x-(item.kind==='circle'?item.radius:item.outerRadius),item.center.y-(item.kind==='circle'?item.radius:item.outerRadius)),
      point(item.center.x+(item.kind==='circle'?item.radius:item.outerRadius),item.center.y+(item.kind==='circle'?item.radius:item.outerRadius))]);
  if(!points.length) return {minX:0,minY:0,maxX:0,maxY:0,width:0,height:0};
  const minX=Math.min(...points.map(q=>q.x)),maxX=Math.max(...points.map(q=>q.x));
  const minY=Math.min(...points.map(q=>q.y)),maxY=Math.max(...points.map(q=>q.y));
  return {minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};
}
export function validateFlagEmblem(node:EmblemNode, options:EmblemBuildOptions={}):EmblemBuildResult {
  const rng=options.rng??missingSeededRng;
  const scale=options.scale??1;
  const canvasHeight=options.canvasHeight??CONFIG.glyph.defaultCanvasHeight;
  const visit=(current:EmblemNode,depth:number):EmblemPrimitive[]=>{
    if(depth>CONFIG.maxDepth) throw new RangeError(`emblem composition depth exceeds ${CONFIG.maxDepth}`);
    if(current.module){
      if(current.module==='M24'){
        return buildGlyph({...current.params,scale,canvasHeight},rng).primitives;
      }
      return buildModule(current.module,current.params??{},rng);
    }
    if(!current.composer||!Object.hasOwn(CONFIG.composers,current.composer)) throw new TypeError('emblem node must name a supported module or composer');
    const composer=current.composer,params:Record<string,any>={...CONFIG.composers[composer].defaults,...current.params};
    const children=current.children??[];
    const required=composer==='SINGLE'?1:composer==='STACK'||composer==='PAIR_MIRROR'||composer==='CROSSED'||composer==='FLANK'||composer==='CHARGE_ON_CHARGE'||composer==='CONCENTRIC'||composer==='INSCRIBE'? (composer==='FLANK'?3:composer==='CHARGE_ON_CHARGE'||composer==='CONCENTRIC'?2:1):1;
    if(children.length<required) throw new RangeError(`${composer} requires ${required} child node${required===1?'':'s'}`);
    if(composer==='ARC_REPEAT'&&children[0].module!=='M11') throw new RangeError('ARC_REPEAT requires an M11 leaf module');
    const child=(index=0)=>visit(children[index]??children[0],depth+1);
    const single=child();
    switch(composer){
      case 'SINGLE':return single;
      case 'STACK': {
        const count=Math.round(clamp(val(params,'count',3),2,4)),gap=clamp(val(params,'gap',0.1),0.05,0.25),vertical=text(params,'axis','VERTICAL')==='VERTICAL';
        return Array.from({length:count},(_,i)=>assignSlot(
          translate(single,vertical?0:(i-(count-1)/2)*(1+gap),vertical?(i-(count-1)/2)*(1+gap):0,1/count,0),
          i%2?'inner':'outer',
        )).flat();
      }
      case 'PAIR_MIRROR': {
        const offset=clamp(val(params,'distance',0.3),0.05,0.5),vertical=text(params,'axis','VERTICAL')==='VERTICAL';
        const other=translate(child(children.length>1?1:0),vertical?offset:0,vertical?0:offset,1,0,true);
        return [...assignSlot(translate(single,vertical?-offset:0,vertical?0:-offset),'inner'),...assignSlot(other,'outer')];
      }
      case 'CROSSED': {
        const angle=clamp(val(params,'angle',35),25,50),second=child(children.length>1?1:0);
        return text(params,'order','FIRST_OVER_SECOND')==='FIRST_OVER_SECOND'
          ? [...assignSlot(translate(second,0,0,1,angle),'outer'),...assignSlot(translate(single,0,0,1,-angle),'inner')]
          : [...assignSlot(translate(single,0,0,1,-angle),'inner'),...assignSlot(translate(second,0,0,1,angle),'outer')];
      }
      case 'RING': {
        const count=Math.round(clamp(val(params,'count',6),3,16)),radius=clamp(val(params,'radius',0.32),...CONFIG.composers.RING.radius),upright=text(params,'orientation','OUT')==='UPRIGHT';
        return Array.from({length:count},(_,i)=>{const a=2*Math.PI*i/count-Math.PI/2;return assignSlot(
          translate(single,radius*Math.cos(a),radius*Math.sin(a),Math.min(0.5,2*Math.PI*radius/count*0.7),upright?0:a*180/Math.PI),
          i%2?'inner':'outer',
        );}).flat();
      }
      case 'ARC_REPEAT': {
        const count=Math.round(clamp(val(params,'count',7),3,16)),sweep=clamp(val(params,'sweep',240),120,300),radius=clamp(val(params,'radius',0.38),...CONFIG.composers.ARC_REPEAT.radius);
        return Array.from({length:count},(_,i)=>{const a=rad(-90-sweep/2+sweep*i/(count-1));return assignSlot(
          translate(single,radius*Math.cos(a),radius*Math.sin(a),0.55,a*180/Math.PI+90),i%2?'inner':'outer',
        );}).flat();
      }
      case 'INSCRIBE': {
        const frame=text(params,'frame','DISC'),ratio=clamp(val(params,'scale',0.58),0.45,0.7),border:EmblemPrimitive[]=[];
        if(frame==='DISC') border.push(circle(0,0,0.5));
        else if(frame==='RING') border.push(ring(0,0,0.5,0.42));
        else if(frame==='RHOMBUS') border.push(poly([point(0,-0.5),point(0.5,0),point(0,0.5),point(-0.5,0)]));
        else if(frame==='POLYGON') border.push(regularPolygon(Math.round(clamp(val(params,'sides',6),3,12))));
        else border.push(...buildModule('M28',{shape:'HEATER'},rng));
        return [...assignSlot(border,'outer'),...assignSlot(translate(single,0,0,ratio),'inner')];
      }
      case 'FLANK': {
        const sideScale=clamp(val(params,'sideScale',0.65),0.5,0.8),offset=clamp(val(params,'offset',0.3),0.15,0.45),side=child(children.length>1?1:0);
        return [...assignSlot(single,'outer'),...assignSlot(translate(side,-offset,0,sideScale,0,true),'inner'),
          ...assignSlot(translate(child(children.length>2?2:1),offset,0,sideScale),'inner')];
      }
      case 'CHARGE_ON_CHARGE': {
        const back=child(children.length>1?1:0),small=clamp(val(params,'smallScale',0.38),0.2,0.6),off:Record<string,any>=params.offset??{x:0,y:0};
        return [...assignSlot(back,'outer'),...assignSlot(translate(single,val(off,'x',0),val(off,'y',0),small),'inner')];
      }
      case 'CONCENTRIC': {
        const base=child(children.length>1?1:0),rings=Math.round(clamp(val(params,'rings',2),1,4)),ratio=clamp(val(params,'innerRatio',0.68),0.45,0.85);
        const additions=Array.from({length:rings},(_,i)=>ring(0,0,0.5*(1-i*(1-ratio)/rings),0.5*(1-i*(1-ratio)/rings)*(0.78)));
        return [...assignSlot(single,'inner'),...assignSlot(base,'outer'),...assignSlot(additions,'inner')];
      }
    }
  };
  const primitives=visit(node,1);
  const primitiveCount=primitives.length;
  if(primitiveCount>CONFIG.maxPrimitives) throw new RangeError(`emblem expands to ${primitiveCount} primitives; maximum is ${CONFIG.maxPrimitives}`);
  if(primitives.some((primitive)=>primitive.kind==='polygon'&&primitive.strokeWidth!==undefined&&
    primitive.strokeWidth*scale*canvasHeight+1e-9<CONFIG.glyph.minimumStroke)) {
    throw new RangeError('GLYPH stroke is thinner than the configured minimum after scaling');
  }
  if(primitives.some((primitive)=>primitiveArea(primitive)<=0||!Number.isFinite(primitiveArea(primitive)))) {
    throw new RangeError('emblem contains a degenerate primitive');
  }
  const narrowestStroke=primitives.reduce((min,primitive)=>
    primitive.kind==='polygon'&&primitive.strokeWidth!==undefined?Math.min(min,primitive.strokeWidth):min,
    Number.POSITIVE_INFINITY);
  return {
    primitives:primitives.map((primitive)=>primitive.fill==='detail'?{...primitive,fill:'inner'}:primitive),
    primitiveCount,
    depth:Math.min(CONFIG.maxDepth,compositionDepth(node)),
    requiredScale:Number.isFinite(narrowestStroke)?CONFIG.glyph.minimumStroke/(narrowestStroke*canvasHeight):0,
    slots:{inner:'inner',outer:'outer'},
  };
}
function compositionDepth(node:EmblemNode):number {
  return node.module?1:1+Math.max(0,...(node.children??[]).map(compositionDepth));
}

export const FLAG_EMBLEM_MODULES = Object.keys(CONFIG.modules) as FlagEmblemModuleId[];
export const FLAG_EMBLEM_COMPOSERS = Object.keys(CONFIG.composers) as FlagEmblemComposerId[];
