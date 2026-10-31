import * as THREE from 'three';

export function disposeTree(root) {
  root.traverse((obj) => {
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) {
      for (const key of ['map', 'emissiveMap', 'alphaMap']) m[key]?.dispose();
      m.dispose();
    }
  });
}
