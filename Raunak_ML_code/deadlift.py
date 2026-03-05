# raunak singh soi – phoenixfit deadlift (balanced fps + full overlay)

import cv2
import mediapipe as mp
import numpy as np
import time

from utils.angle_math import angle_3pts, torso_angle_deg
from utils.smoothing import SmootherDict
from utils.ml_predictor import predict_score
from utils.visualization import draw_full_overlay

mp_pose = mp.solutions.pose

def get_xy(lm, idx, w, h):
    return int(lm[idx].x * w), int(lm[idx].y * h)

def mean_visibility(lm, idxs):
    vals = [float(getattr(lm[i], "visibility", 0.0)) for i in idxs]
    return float(sum(vals) / len(vals)) if vals else 0.0

# compute deadlift angles
def compute_deadlift_angles(lm, w, h):
    # hip-knee-ankle
    lh = get_xy(lm, 23, w, h)
    lk = get_xy(lm, 25, w, h)
    la = get_xy(lm, 27, w, h)

    rh = get_xy(lm, 24, w, h)
    rk = get_xy(lm, 26, w, h)
    ra = get_xy(lm, 28, w, h)

    knee_l = angle_3pts(lh, lk, la)
    knee_r = angle_3pts(rh, rk, ra)

    # torso
    torso = torso_angle_deg(lm)

    # hip hinge angle (shoulder-hip-knee), choose best visible side
    sh_l = get_xy(lm, 11, w, h)
    sh_r = get_xy(lm, 12, w, h)
    hinge_l = angle_3pts(sh_l, lh, lk)
    hinge_r = angle_3pts(sh_r, rh, rk)

    vis_l = mean_visibility(lm, (11, 23, 25))
    vis_r = mean_visibility(lm, (12, 24, 26))
    if vis_l >= 0.5 and vis_r >= 0.5:
        hinge = (hinge_l + hinge_r) / 2.0
    elif vis_l >= vis_r:
        hinge = hinge_l
    else:
        hinge = hinge_r

    return {
        "knee_l": knee_l,
        "knee_r": knee_r,
        "torso": torso,
        "hinge": hinge
    }

# setup/execution only
def detect_phase(angles, prev_phase, reached_bottom):
    hinge = angles["hinge"]
    if hinge is None:
        return "setup", reached_bottom

    # Hysteresis + depth latch to reduce noisy toggles.
    STANDING_THRESHOLD = 155
    HINGE_THRESHOLD = 145
    DEPTH_THRESHOLD = 130

    if hinge < DEPTH_THRESHOLD:
        reached_bottom = True

    if prev_phase == "setup":
        if hinge < HINGE_THRESHOLD:
            return "execution", reached_bottom
        return "setup", reached_bottom
    else:
        if hinge > STANDING_THRESHOLD:
            return "setup", reached_bottom
        return "execution", reached_bottom

def coaching_rules(angles, phase):
    torso = angles["torso"]
    hinge = angles["hinge"]

    if torso is None or hinge is None:
        return ""

    # Avoid false warnings while standing still at top.
    if phase == "setup":
        return ""

    if hinge < 70:
        return "back collapsing"

    # 45-degree camera angle naturally reads larger torso angles than side view.
    if torso > 60:
        return "chest too low"

    return ""

def run_deadlift():
    print("deadlift mode (balanced + full overlay). press esc to exit.")

    pose = mp_pose.Pose(
        model_complexity=0,
        smooth_landmarks=True
    )

    cap = cv2.VideoCapture(0)
    smoother = SmootherDict(6)

    reps = 0
    prev_phase = "setup"
    reached_bottom = False

    frame_id = 0
    score_cache = 75
    ui_cache = None

    t0 = time.time()
    fps_val = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            continue

        h, w = frame.shape[:2]

        small = cv2.resize(frame, (640, 360))
        small_rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
        results = pose.process(small_rgb)

        t1 = time.time()
        fps_val = 1.0 / (t1 - t0 + 1e-6)
        t0 = t1

        if not results.pose_landmarks:
            cv2.imshow("PhoenixFit – Deadlift", frame)
            if cv2.waitKey(1) & 0xFF == 27:
                break
            continue

        lm = results.pose_landmarks.landmark

        angles_raw = compute_deadlift_angles(lm, w, h)
        angles = smoother.update(angles_raw)

        phase, reached_bottom = detect_phase(angles, prev_phase, reached_bottom)

        if prev_phase == "execution" and phase == "setup":
            if reached_bottom:
                reps += 1
            reached_bottom = False
        prev_phase = phase

        if frame_id % 5 == 0:
            feat = [
                angles["knee_l"],
                angles["knee_r"],
                angles["torso"]
            ]
            score_cache = predict_score("deadlift", feat)

        coach = coaching_rules(angles, phase)

        mp.solutions.drawing_utils.draw_landmarks(
            frame,
            results.pose_landmarks,
            mp_pose.POSE_CONNECTIONS,
            mp.solutions.drawing_styles.get_default_pose_landmarks_style()
        )

        angle_panel = {
            "knee_l": angles["knee_l"],
            "knee_r": angles["knee_r"],
            "torso": angles["torso"],
            "hinge": angles["hinge"]
        }

        if frame_id % 2 == 0:
            ui_cache = draw_full_overlay(
                frame,
                phase=phase,
                reps=reps,
                angles=angle_panel,
                score=score_cache,
                coach=coach,
                fps=fps_val
            )
        else:
            frame = ui_cache

        cv2.imshow("PhoenixFit – Deadlift", ui_cache)

        key = cv2.waitKey(1) & 0xFF
        if key == 27:
            break

        frame_id += 1

    cap.release()
    cv2.destroyAllWindows()
