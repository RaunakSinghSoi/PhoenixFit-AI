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

    # hip hinge angle (shoulder-hip-knee)
    sh = get_xy(lm, 11, w, h)
    hp = lh
    knee = lk
    hinge = angle_3pts(sh, hp, knee)

    return {
        "knee_l": knee_l,
        "knee_r": knee_r,
        "torso": torso,
        "hinge": hinge
    }

# setup/execution only
def detect_phase(angles):
    if angles["hinge"] > 160:
        return "setup"
    return "execution"

def coaching_rules(angles):
    torso = angles["torso"]
    hinge = angles["hinge"]

    if hinge < 70:
        return "back collapsing"

    if torso > 45:
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

        phase = detect_phase(angles)

        if prev_phase == "execution" and phase == "setup":
            reps += 1
        prev_phase = phase

        if frame_id % 5 == 0:
            feat = [
                angles["knee_l"],
                angles["knee_r"],
                angles["torso"]
            ]
            score_cache = predict_score("deadlift", feat)

        coach = coaching_rules(angles)

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
