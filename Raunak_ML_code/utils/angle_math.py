# Author: Raunak Singh Soi
# PhoenixFit – Angle Computation Utilities

import numpy as np

def angle_3pts(a, b, c):
    """Return the angle (degrees) at point b formed by a-b-c."""
    a, b, c = np.array(a), np.array(b), np.array(c)
    ba, bc = a - b, c - b
    cosine = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-6)
    return np.degrees(np.arccos(np.clip(cosine, -1.0, 1.0)))

def get_joint_angles(landmarks):
    """Compute main joint angles (left/right knee, hip, shoulder)."""
    lm = landmarks
    try:
        knee_l = angle_3pts(lm['hip_l'], lm['knee_l'], lm['ankle_l'])
        knee_r = angle_3pts(lm['hip_r'], lm['knee_r'], lm['ankle_r'])
        hip_l = angle_3pts(lm['shoulder_l'], lm['hip_l'], lm['knee_l'])
        hip_r = angle_3pts(lm['shoulder_r'], lm['hip_r'], lm['knee_r'])
        shoulder_l = angle_3pts(lm['hip_l'], lm['shoulder_l'], lm['elbow_l'])
        shoulder_r = angle_3pts(lm['hip_r'], lm['shoulder_r'], lm['elbow_r'])
    except Exception:
        return {}
    return {
        'knee_l': knee_l, 'knee_r': knee_r,
        'hip_l': hip_l, 'hip_r': hip_r,
        'shoulder_l': shoulder_l, 'shoulder_r': shoulder_r
    }

def torso_angle_deg(lm):
    """Compute torso angle relative to vertical."""
    sx = (lm[11].x + lm[12].x) / 2
    sy = (lm[11].y + lm[12].y) / 2
    hx = (lm[23].x + lm[24].x) / 2
    hy = (lm[23].y + lm[24].y) / 2

    import numpy as np
    from math import acos, degrees

    v = np.array([0, -1])
    u = np.array([sx - hx, sy - hy])
    nu = np.linalg.norm(u) + 1e-6
    cosv = np.clip(np.dot(u/nu, v), -1.0, 1.0)
    return degrees(acos(cosv))

