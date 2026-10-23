/**
 * Exact solid-overlap check via manifold-3d (WASM). Our meshes are planar-faced
 * polygons; faces are triangulated with earcut before being handed to Manifold.
 * Any mesh Manifold can't handle is reported as unverifiable (a warning), so a
 * weird AI part can never crash validation.
 */
import Module from "manifold-3d";
import earcut from "earcut";
import { sub, cross, dot, type Mesh, type Solid, type Vec3 } from "@/lib/blueprint/solids";

type ManifoldModule = Awaited<ReturnType<typeof Module>>;
type ManifoldInstance = InstanceType<ManifoldModule["Manifold"]>;

let modulePromise: Promise<ManifoldModule> | null = null;
function getModule(): Promise<ManifoldModule> {
  modulePromise ??= Module().then((m) => (m.setup(), m));
  return modulePromise;
}

/** Flatten a planar polygon face (with optional hole loops) to triangles. */
function triangulateMesh(mesh: Mesh): { vertProperties: Float32Array; triVerts: Uint32Array } {
  const triVerts: number[] = [];
  for (const face of mesh.faces) {
    const n = face.n;
    const ax = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
    const drop = ax.indexOf(Math.max(...ax));
    const proj = (v: Vec3): [number, number] =>
      drop === 0 ? [v[1], v[2]] : drop === 1 ? [v[0], v[2]] : [v[0], v[1]];

    const allIdx = face.loops.flat();
    const coords = allIdx.flatMap((i) => proj(mesh.verts[i]));
    const holeStarts: number[] = [];
    let acc = face.loops[0].length;
    for (let h = 1; h < face.loops.length; h++) {
      holeStarts.push(acc);
      acc += face.loops[h].length;
    }
    const tris = earcut(coords, holeStarts.length ? holeStarts : undefined);
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const ia = allIdx[tris[t]];
      let ib = allIdx[tris[t + 1]],
        ic = allIdx[tris[t + 2]];
      // keep triangle winding consistent with the face's outward normal
      const tn = cross(sub(mesh.verts[ib], mesh.verts[ia]), sub(mesh.verts[ic], mesh.verts[ia]));
      if (dot(tn, n) < 0) [ib, ic] = [ic, ib];
      triVerts.push(ia, ib, ic);
    }
  }
  return {
    vertProperties: new Float32Array(mesh.verts.flat()),
    triVerts: new Uint32Array(triVerts),
  };
}

export interface OverlapHit {
  a: string; // "P1 (Left side) copy 2"
  b: string;
  volumeMm3: number;
}
export interface OverlapResult {
  hits: OverlapHit[];
  unverifiable: string[]; // part ids whose mesh Manifold rejected
}

/** Pairwise exact intersection volume between all solids. O(n²) over part copies. */
export async function findOverlaps(solids: Solid[]): Promise<OverlapResult> {
  const wasm = await getModule();
  const mans: (ManifoldInstance | null)[] = [];
  const unverifiable: string[] = [];

  for (const s of solids) {
    try {
      const { vertProperties, triVerts } = triangulateMesh(s.mesh);
      const m = new wasm.Manifold(
        new wasm.Mesh({ numProp: 3, vertProperties, triVerts })
      );
      if (m.status() !== "NoError") throw new Error(String(m.status()));
      mans.push(m);
    } catch {
      mans.push(null);
      if (!unverifiable.includes(s.part.id)) unverifiable.push(s.part.id);
    }
  }

  const hits: OverlapHit[] = [];
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const a = mans[i],
        b = mans[j];
      if (!a || !b || a === b) continue;
      try {
        const inter = a.intersect(b);
        const v = inter.volume();
        if (v > 1) {
          hits.push({
            a: `${solids[i].part.id} (${solids[i].part.name}) copy ${solids[i].copy + 1}`,
            b: `${solids[j].part.id} (${solids[j].part.name}) copy ${solids[j].copy + 1}`,
            volumeMm3: v,
          });
        }
      } catch {
        if (!unverifiable.includes(solids[i].part.id)) unverifiable.push(solids[i].part.id);
      }
    }
  }

  for (const m of mans) m?.delete();
  return { hits, unverifiable };
}
