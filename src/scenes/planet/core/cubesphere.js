// Cube-sphere helpers. Faces: 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z, face coords (u,v) ∈ [-1,1]².

/** Face coords → point on unit cube. */
export function faceToCube(face, u, v, out) {
  switch (face) {
    case 0: out[0] = 1; out[1] = v; out[2] = -u; break;
    case 1: out[0] = -1; out[1] = v; out[2] = u; break;
    case 2: out[0] = u; out[1] = 1; out[2] = -v; break;
    case 3: out[0] = u; out[1] = -1; out[2] = v; break;
    case 4: out[0] = u; out[1] = v; out[2] = 1; break;
    default: out[0] = -u; out[1] = v; out[2] = -1; break;
  }
  return out;
}

/** Cube point → unit sphere (area-preserving-ish mapping, much more uniform than normalize()). */
export function cubeToSphere(out) {
  const x = out[0], y = out[1], z = out[2];
  const x2 = x * x, y2 = y * y, z2 = z * z;
  out[0] = x * Math.sqrt(Math.max(0, 1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3));
  out[1] = y * Math.sqrt(Math.max(0, 1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3));
  out[2] = z * Math.sqrt(Math.max(0, 1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3));
  const l = Math.hypot(out[0], out[1], out[2]);
  out[0] /= l; out[1] /= l; out[2] /= l;
  return out;
}

export function faceToSphere(face, u, v, out) { return cubeToSphere(faceToCube(face, u, v, out)); }

/** Unit direction → [face, u, v] (inverse of faceToCube on the cube, approximate inverse of the sphere mapping). */
export function dirToFace(x, y, z) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ax >= ay && ax >= az) return x > 0 ? [0, -z / ax, y / ax] : [1, z / ax, y / ax];
  if (ay >= ax && ay >= az) return y > 0 ? [2, x / ay, -z / ay] : [3, x / ay, z / ay];
  return z > 0 ? [4, x / az, y / az] : [5, -x / az, y / az];
}

/** Lat/lon in degrees → unit direction (y-up). */
export function latLonToDir(lat, lon, out = [0, 0, 0]) {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  out[0] = Math.cos(la) * Math.sin(lo); out[1] = Math.sin(la); out[2] = Math.cos(la) * Math.cos(lo);
  return out;
}
export function dirToLatLon(x, y, z) { return [(Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI, (Math.atan2(x, z) * 180) / Math.PI]; }
