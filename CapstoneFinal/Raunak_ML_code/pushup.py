# raunak singh soi – phoenixfit pushup (balanced fps + full overlay)

import cv2
import mediapipe as mp
import numpy as np
import time

from utils.angle_math import angle_3pts
from utils.smoothing import SmootherDict
from utils.ml_predictor import predict_score
from utils.visualization import draw_full_overlay

mp_pose = mp.solutions.pose

# helper to get pixel coordinate
def get_xy(lm, idx, w, h):
    return int(lm[idx].x * w), int(lm[idx].y * h)

# compute pushup angles
def compute_pushup_angles(lm, w, h):
    # left arm
    ls = get_xy(lm, 11, w, h)
    le = get_xy(lm, 13, w, h)
    lw = get_xy(lm, 15, w, h)

    # right arm
    rs = get_xy(lm, 12, w, h)
    re = get_xy(lm, 14, w, h)
    rw = get_xy(lm, 16, w, h)

    elbow_l = angle_3pts(ls, le, lw)
    elbow_r = angle_3pts(rs, re, rw)

    # torso alignment (shoulder–hip)
    sh = get_xy(lm, 11, w, h)
    hp = get_xy(lm, 23, w, h)
    ankle = get_xy(lm, 27, w, h)

    torso = angle_3pts(sh, hp, ankle)

    return {
        "elbow_l": elbow_l,
        "elbow_r": elbow_r,
        "torso": torso
    }

# only setup + execution
def detect_phase(angles):
    elbow_l = angles["elbow_l"]
    elbow_r = angles["elbow_r"]

    if elbow_l is None or elbow_r is None:
        return "setup"

    if elbow_l > 150 and elbow_r > 150:
        return "setup"

    return "execution"

# coaching logic
def coaching_rules(angles):
    elbow_l = angles["elbow_l"]
    elbow_r = angles["elbow_r"]
    torso = angles["torso"]

    if elbow_l < 70 or elbow_r < 70:
        return "elbows collapsing too much"

    if torso < 150:
        return "hips sagging"

    return ""

def run_pushup():
    print("pushup mode (balanced + full overlay). press esc to exit.")

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
            cv2.imshow("PhoenixFit – Pushup", frame)
            if cv2.waitKey(1) & 0xFF == 27:
                break
            continue

        lm = results.pose_landmarks.landmark

        angles_raw = compute_pushup_angles(lm, w, h)
        angles = smoother.update(angles_raw)

        phase = detect_phase(angles)

        if prev_phase == "execution" and phase == "setup":
            reps += 1
        prev_phase = phase

        if frame_id % 5 == 0:
            feat = [
                angles["elbow_l"],
                angles["elbow_r"],
                angles["torso"]
            ]
            score_cache = predict_score("pushup", feat)

        coach = coaching_rules(angles)

        mp.solutions.drawing_utils.draw_landmarks(
            frame,
            results.pose_landmarks,
            mp_pose.POSE_CONNECTIONS,
            mp.solutions.drawing_styles.get_default_pose_landmarks_style()
        )

        angle_panel = {
            "elbow_l": angles["elbow_l"],
            "elbow_r": angles["elbow_r"],
            "torso": angles["torso"]
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

        cv2.imshow("PhoenixFit – Pushup", ui_cache)

        key = cv2.waitKey(1) & 0xFF
        if key == 27:
            break

        frame_id += 1

    cap.release()
    cv2.destroyAllWindows()
