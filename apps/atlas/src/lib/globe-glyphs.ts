/**
 * Cached Three.js glyphs for timeline assets — recognizable silhouettes
 * (ship/tanker hulls, aircraft, military markers) with material pooling.
 */

import type { TimelineAsset } from "@/lib/types";

type ThreeMod = typeof import("three");

let THREE: ThreeMod | null = null;

function getThree(): ThreeMod {
  if (!THREE) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    THREE = require("three") as ThreeMod;
  }
  return THREE;
}

const geomCache = new Map<string, unknown>();
const matCache = new Map<string, unknown>();

function canvasSilhouette(
  kind: TimelineAsset["kind"],
  color: string
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2;

  if (kind === "plane") {
    // Top-down airliner silhouette
    ctx.beginPath();
    ctx.moveTo(64, 12);
    ctx.lineTo(72, 48);
    ctx.lineTo(118, 58);
    ctx.lineTo(118, 68);
    ctx.lineTo(72, 72);
    ctx.lineTo(70, 108);
    ctx.lineTo(86, 118);
    ctx.lineTo(86, 122);
    ctx.lineTo(64, 116);
    ctx.lineTo(42, 122);
    ctx.lineTo(42, 118);
    ctx.lineTo(58, 108);
    ctx.lineTo(56, 72);
    ctx.lineTo(10, 68);
    ctx.lineTo(10, 58);
    ctx.lineTo(56, 48);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === "tanker") {
    // Long tanker hull with bridge
    ctx.beginPath();
    ctx.moveTo(20, 48);
    ctx.lineTo(108, 48);
    ctx.quadraticCurveTo(118, 48, 118, 64);
    ctx.quadraticCurveTo(118, 80, 108, 80);
    ctx.lineTo(20, 80);
    ctx.quadraticCurveTo(10, 80, 10, 64);
    ctx.quadraticCurveTo(10, 48, 20, 48);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(88, 42, 18, 20);
  } else if (kind === "military") {
    // Diamond + chevron
    ctx.beginPath();
    ctx.moveTo(64, 18);
    ctx.lineTo(100, 64);
    ctx.lineTo(64, 110);
    ctx.lineTo(28, 64);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.moveTo(48, 64);
    ctx.lineTo(64, 48);
    ctx.lineTo(80, 64);
    ctx.stroke();
  } else {
    // Container ship
    ctx.beginPath();
    ctx.moveTo(18, 52);
    ctx.lineTo(100, 52);
    ctx.quadraticCurveTo(114, 52, 114, 64);
    ctx.quadraticCurveTo(114, 76, 100, 76);
    ctx.lineTo(18, 76);
    ctx.quadraticCurveTo(8, 76, 8, 64);
    ctx.quadraticCurveTo(8, 52, 18, 52);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(24 + i * 16, 56, 12, 16);
    }
  }
  return c;
}

const COLORS: Record<TimelineAsset["kind"], string> = {
  plane: "#39d3f5",
  tanker: "#ffb454",
  ship: "#e8eef5",
  military: "#ff5c5c",
};

export function makeAssetGlyph(kind: TimelineAsset["kind"]): object {
  const T = getThree();
  const key = `sprite:${kind}`;
  let mat = matCache.get(key) as import("three").SpriteMaterial | undefined;
  if (!mat) {
    const canvas = canvasSilhouette(kind, COLORS[kind]);
    const tex = new T.CanvasTexture(canvas);
    tex.needsUpdate = true;
    mat = new T.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0.95,
    });
    matCache.set(key, mat);
  }
  const sprite = new T.Sprite(mat.clone());
  const scale =
    kind === "plane" ? 1.8 : kind === "tanker" ? 2.2 : kind === "military" ? 1.6 : 1.9;
  sprite.scale.set(scale, scale, 1);
  sprite.userData.kind = kind;
  return sprite;
}

/** Low-poly mesh fallback for heading-aware orientation */
export function makeAssetMesh(kind: TimelineAsset["kind"]): object {
  const T = getThree();
  let geom = geomCache.get(kind) as import("three").BufferGeometry | undefined;
  if (!geom) {
    if (kind === "plane") {
      // Flat extruded plane shape via thin box + wings
      const group = new T.Group();
      const body = new T.Mesh(
        new T.BoxGeometry(0.2, 0.12, 0.9),
        new T.MeshLambertMaterial({
          color: COLORS.plane,
          transparent: true,
          opacity: 0.95,
        })
      );
      const wing = new T.Mesh(
        new T.BoxGeometry(1.1, 0.06, 0.28),
        new T.MeshLambertMaterial({
          color: COLORS.plane,
          transparent: true,
          opacity: 0.9,
        })
      );
      wing.position.z = 0.05;
      group.add(body, wing);
      group.scale.setScalar(0.7);
      return group;
    }
    if (kind === "military") {
      geom = new T.OctahedronGeometry(0.4, 0);
    } else if (kind === "tanker") {
      geom = new T.BoxGeometry(0.32, 0.18, 1.3);
    } else {
      geom = new T.BoxGeometry(0.28, 0.14, 0.95);
    }
    geomCache.set(kind, geom);
  }
  const matKey = `mesh:${kind}`;
  let mat = matCache.get(matKey) as import("three").MeshLambertMaterial | undefined;
  if (!mat) {
    mat = new T.MeshLambertMaterial({
      color: COLORS[kind],
      transparent: true,
      opacity: 0.95,
    });
    matCache.set(matKey, mat);
  }
  const mesh = new T.Mesh(geom, mat.clone());
  mesh.scale.setScalar(0.6);
  return mesh;
}
