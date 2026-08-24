#!/usr/bin/env python3
"""Convert a Kimodo SMPL-X default-NPZ motion into the SmplxClip JSON that
src/game/retarget.ts reads.

Kimodo's `smplx22` bone order and parent table are identical to SMPLX_PARENTS in
retarget.ts, so no joint remapping is applied. Every other conversion is printed
by --report so it can be checked rather than trusted.
"""
import argparse
import json

import numpy as np
from scipy.spatial.transform import Rotation

PARENTS = [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19]
NAMES = [
    "pelvis", "left_hip", "right_hip", "spine1", "left_knee", "right_knee",
    "spine2", "left_ankle", "right_ankle", "spine3", "left_foot", "right_foot",
    "neck", "left_collar", "right_collar", "head", "left_shoulder",
    "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist",
]


def squeeze_batch(a):
    a = np.asarray(a)
    return a[0] if a.ndim >= 3 and a.shape[0] == 1 and a.shape[1] > 4 else a


def main():
    p = argparse.ArgumentParser()
    p.add_argument("npz")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--name", default="clip")
    p.add_argument("--fps", type=float, default=30.0)
    p.add_argument("--round", type=int, default=6)
    args = p.parse_args()

    d = np.load(args.npz, allow_pickle=True)
    print("NPZ keys:", {k: np.asarray(d[k]).shape for k in d.files})

    local = squeeze_batch(d["local_rot_mats"]).astype(np.float64)   # (T,22,3,3)
    glob = squeeze_batch(d["global_rot_mats"]).astype(np.float64)   # (T,22,3,3)
    joints = squeeze_batch(d["posed_joints"]).astype(np.float64)    # (T,22,3)
    root = squeeze_batch(d["root_positions"]).astype(np.float64)    # (T,3)
    if root.ndim == 3:
        root = root[0]
    T, J = joints.shape[0], joints.shape[1]
    assert J == 22, f"expected 22 joints, got {J}"

    # ---- up-axis detection -------------------------------------------------
    # SMPL-X is Y-up. Confirm from the data rather than assuming: the pelvis sits
    # near 0.9 m on the up axis and varies little; the other two axes travel.
    means = joints[:, 0].mean(0)
    spans = np.ptp(joints.reshape(-1, 3), axis=0)
    up = int(np.argmax(means))
    print(f"pelvis mean per axis = {means.round(3)}, joint span per axis = {spans.round(3)}")
    print(f"detected up axis = {'XYZ'[up]}")
    if up != 1:
        raise SystemExit(
            f"up axis is {'XYZ'[up]}, not Y. A rotation is needed here and this "
            "script deliberately refuses to guess one silently."
        )

    # ---- rest offsets ------------------------------------------------------
    # off_i = R_global[parent]^T * (p_i - p_parent). A rotation cannot change a
    # bone length, so this is constant across frames; the spread is the check.
    offs = np.zeros((T, J, 3))
    for i in range(1, J):
        pa = PARENTS[i]
        delta = joints[:, i] - joints[:, pa]
        offs[:, i] = np.einsum("tji,tj->ti", glob[:, pa], delta)
    rest = np.median(offs, axis=0)
    drift = np.abs(offs - rest).max(axis=(0, 2))
    print("max per-joint rest-offset drift (m):", float(drift.max()))

    # ---- rotations ---------------------------------------------------------
    # scipy as_quat() is scalar-last (XYZW), which is what retarget.ts wants.
    quat = Rotation.from_matrix(local.reshape(-1, 3, 3)).as_quat().reshape(T, J, 4)
    # sign-continuity: q and -q are the same rotation but interpolation cares.
    for t in range(1, T):
        flip = (quat[t] * quat[t - 1]).sum(-1) < 0
        quat[t][flip] *= -1

    # ---- facing ------------------------------------------------------------
    # Kimodo writes global_root_heading = [cos t, sin t] with
    #   t = atan2(dz, -dx),  d = right_hip - left_hip     (feature_utils.py:125)
    # Our +X is the character's left, so left = -d and, rotating left by -90 deg
    # about +Y, forward = (dz, -dx)/|d| = (sin t, cos t). facing is [x, z], so it
    # is the heading pair swapped. Sanity: hips square to +X give heading [1, 0]
    # and facing [0, 1], i.e. +Z forward, which is the rest-pose convention.
    pelvis_fwd = glob[0, 0] @ np.array([0.0, 0.0, 1.0])
    pelvis_facing = np.array([pelvis_fwd[0], pelvis_fwd[2]])
    pelvis_facing /= np.linalg.norm(pelvis_facing) or 1.0
    if "global_root_heading" in d.files:
        h = np.asarray(squeeze_batch(d["global_root_heading"]))
        if h.ndim == 3:
            h = h[0]
        facing = np.array([h[0][1], h[0][0]], dtype=float)
        facing /= np.linalg.norm(facing) or 1.0
    else:
        facing = pelvis_facing
    print(f"facing (from hip heading) = {facing.round(4)} | "
          f"pelvis +Z forward = {pelvis_facing.round(4)}")

    r = args.round
    clip = {
        "name": args.name,
        "fps": args.fps,
        "facing": [round(float(x), r) for x in facing],
        "rest": [[round(float(x), r) for x in v] for v in rest],
        "frames": [
            {
                "root": [round(float(x), r) for x in root[t]],
                "rot": [[round(float(x), r) for x in q] for q in quat[t]],
            }
            for t in range(T)
        ],
    }
    with open(args.out, "w") as f:
        json.dump(clip, f)

    # ---- sanity ------------------------------------------------------------
    lens = np.linalg.norm(offs[:, 1:], axis=-1)
    print("\n--- sanity ---")
    print(f"joints={J} frames={T} fps={args.fps} duration={T/args.fps:.2f}s")
    print(f"bone length drift max={float((lens.max(0)-lens.min(0)).max()):.6f} m")
    for i, nm in enumerate(NAMES):
        if nm in ("left_foot", "right_foot", "left_ankle", "right_ankle"):
            y = joints[:, i, 1]
            print(f"  {nm:<12} y min={y.min():.3f} max={y.max():.3f} mean={y.mean():.3f}")
    print(f"root y: min={root[:,1].min():.3f} max={root[:,1].max():.3f}")
    print(f"root xz travel: {np.linalg.norm(root[-1,[0,2]]-root[0,[0,2]]):.3f} m")
    sole = joints[:, [10, 11], 1].min()
    head_h = joints[:, 15, 1].max()
    print(f"lowest foot y={sole:.3f}  head y max={head_h:.3f}  implied stature~{(head_h-sole)/0.885:.3f} m")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
