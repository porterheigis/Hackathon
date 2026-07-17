/**
 * Asset props for globe + tactical map.
 * Top-down ship/tanker/plane/military silhouettes drawn on canvas, used as:
 *  - flat textured meshes glued tangent to the globe (heading-oriented)
 *  - data-URL icons for MapLibre markers (same art on both surfaces)
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

export const ASSET_COLORS: Record<TimelineAsset["kind"], string> = {
  plane: "#7fe3ff",
  tanker: "#ffb454",
  ship: "#e8eef5",
  military: "#ff5c5c",
};

const canvasCache = new Map<string, HTMLCanvasElement>();
const dataUrlCache = new Map<string, string>();
const textureCache = new Map<string, unknown>();

/**
 * Draw a top-down silhouette. Nose/bow points UP (canvas top).
 * 128x128, transparent background, soft glow for readability on satellite/ocean.
 */
function iconCanvas(kind: TimelineAsset["kind"]): HTMLCanvasElement {
  const cached = canvasCache.get(kind);
  if (cached) return cached;

  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const color = ASSET_COLORS[kind];
  ctx.clearRect(0, 0, 128, 128);
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(10,14,20,0.85)";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";

  if (kind === "plane") {
    // Airliner: fuselage, swept wings, tailplane — nose up
    ctx.beginPath();
    ctx.moveTo(64, 8); // nose
    ctx.quadraticCurveTo(70, 18, 70, 34); // right fuselage
    ctx.lineTo(71, 52);
    ctx.lineTo(120, 74); // right wing tip
    ctx.lineTo(120, 82);
    ctx.lineTo(71, 68);
    ctx.lineTo(70, 96); // rear fuselage
    ctx.lineTo(90, 112); // right tail
    ctx.lineTo(90, 119);
    ctx.lineTo(66, 111);
    ctx.lineTo(64, 122); // tail cone
    ctx.lineTo(62, 111);
    ctx.lineTo(38, 119);
    ctx.lineTo(38, 112);
    ctx.lineTo(58, 96);
    ctx.lineTo(57, 68);
    ctx.lineTo(8, 82);
    ctx.lineTo(8, 74);
    ctx.lineTo(57, 52);
    ctx.lineTo(58, 34);
    ctx.quadraticCurveTo(58, 18, 64, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === "tanker") {
    // Long crude carrier: pointed bow up, flat stern, deck piping + aft bridge
    ctx.beginPath();
    ctx.moveTo(64, 8); // bow
    ctx.quadraticCurveTo(82, 26, 82, 48);
    ctx.lineTo(82, 108);
    ctx.quadraticCurveTo(82, 118, 72, 118);
    ctx.lineTo(56, 118);
    ctx.quadraticCurveTo(46, 118, 46, 108);
    ctx.lineTo(46, 48);
    ctx.quadraticCurveTo(46, 26, 64, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Deck details
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(10,14,20,0.45)";
    ctx.fillRect(58, 34, 12, 4);
    ctx.fillRect(58, 46, 12, 4);
    ctx.fillRect(58, 58, 12, 4);
    ctx.fillRect(58, 70, 12, 4);
    ctx.fillRect(52, 96, 24, 14); // bridge
  } else if (kind === "military") {
    // Naval combatant: sharp bow, angular superstructure
    ctx.beginPath();
    ctx.moveTo(64, 6);
    ctx.lineTo(78, 40);
    ctx.lineTo(78, 104);
    ctx.lineTo(70, 120);
    ctx.lineTo(58, 120);
    ctx.lineTo(50, 104);
    ctx.lineTo(50, 40);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(10,14,20,0.5)";
    ctx.fillRect(56, 50, 16, 22); // superstructure
    ctx.beginPath();
    ctx.arc(64, 34, 5, 0, Math.PI * 2); // forward gun
    ctx.fill();
  } else {
    // Container ship: boxy hull, container stacks
    ctx.beginPath();
    ctx.moveTo(64, 10);
    ctx.quadraticCurveTo(80, 24, 80, 44);
    ctx.lineTo(80, 110);
    ctx.quadraticCurveTo(80, 118, 70, 118);
    ctx.lineTo(58, 118);
    ctx.quadraticCurveTo(48, 118, 48, 110);
    ctx.lineTo(48, 44);
    ctx.quadraticCurveTo(48, 24, 64, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(10,14,20,0.5)";
    for (let row = 0; row < 4; row++) {
      ctx.fillRect(54, 34 + row * 17, 9, 12);
      ctx.fillRect(66, 34 + row * 17, 9, 12);
    }
    ctx.fillRect(52, 102, 24, 12); // bridge
  }

  canvasCache.set(kind, c);
  return c;
}

/** Same art as the globe props, for MapLibre markers */
export function assetIconDataUrl(kind: TimelineAsset["kind"]): string {
  const cached = dataUrlCache.get(kind);
  if (cached) return cached;
  const url = iconCanvas(kind).toDataURL("image/png");
  dataUrlCache.set(kind, url);
  return url;
}

const ICON_SIZE: Record<TimelineAsset["kind"], number> = {
  plane: 3.4,
  tanker: 3.2,
  ship: 2.9,
  military: 3.0,
};

/**
 * Flat textured mesh lying tangent to the globe.
 * Geometry rotated so canvas-top (nose) points along +Z = travel direction
 * when posed with `poseAssetMesh` (up = surface normal, lookAt = ahead).
 */
export function makeAssetIcon(kind: TimelineAsset["kind"]): object {
  const T = getThree();
  let tex = textureCache.get(kind) as import("three").CanvasTexture | undefined;
  if (!tex) {
    tex = new T.CanvasTexture(iconCanvas(kind));
    tex.anisotropy = 4;
    textureCache.set(kind, tex);
  }
  const size = ICON_SIZE[kind];
  const geom = new T.PlaneGeometry(size, size);
  // +Y (canvas top / nose) -> +Z (lookAt forward); plane lies in XZ.
  // rotateX alone leaves the textured front face pointing -Y (into the
  // globe), which would show the mirrored back face from outside. rotateZ(PI)
  // flips the face normal to +Y (outward, along mesh.up = surface normal)
  // while keeping the nose on +Z.
  geom.rotateX(Math.PI / 2);
  geom.rotateZ(Math.PI);
  const mat = new T.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    opacity: 0,
  });
  const mesh = new T.Mesh(geom, mat);
  mesh.visible = false;
  mesh.renderOrder = 3;
  mesh.userData.kind = kind;
  return mesh;
}

export function makeLayerGroup(): object {
  const T = getThree();
  return new T.Group();
}

// Reusable temps for per-frame posing (no GC churn)
let tmpUp: import("three").Vector3 | null = null;
let tmpTarget: import("three").Vector3 | null = null;

/**
 * Pose a prop at world coords, oriented along its path, faded by opacity.
 */
export function poseAssetMesh(
  meshObj: object,
  coords: { x: number; y: number; z: number },
  ahead: { x: number; y: number; z: number },
  opacity: number
): void {
  const T = getThree();
  if (!tmpUp) tmpUp = new T.Vector3();
  if (!tmpTarget) tmpTarget = new T.Vector3();

  const mesh = meshObj as import("three").Mesh;
  mesh.position.set(coords.x, coords.y, coords.z);
  tmpUp.set(coords.x, coords.y, coords.z).normalize();
  mesh.up.copy(tmpUp);
  tmpTarget.set(ahead.x, ahead.y, ahead.z);
  if (tmpTarget.distanceToSquared(mesh.position) > 1e-8) {
    mesh.lookAt(tmpTarget);
  }
  const mat = mesh.material as import("three").MeshBasicMaterial;
  mat.opacity = Math.max(0, Math.min(1, opacity));
  mesh.visible = opacity > 0.01;
}

export function disposeAssetMesh(meshObj: object): void {
  const mesh = meshObj as import("three").Mesh;
  mesh.geometry?.dispose();
  // Textures are cached/shared — only dispose per-mesh material
  const mat = mesh.material as import("three").Material | undefined;
  mat?.dispose();
}
