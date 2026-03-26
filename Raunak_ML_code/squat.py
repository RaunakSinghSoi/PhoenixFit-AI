# raunak singh soi – phoenixfit squat (balanced fps + setup/execution + full overlay)

import cv2
import mediapipe as mp
import numpy as np
import time

from utils.angle_math import angle_3pts, torso_angle_deg
from utils.smoothing import SmootherDict
from utils.ml_predictor import predict_score
from utils.visualization import draw_full_overlay

mp_pose = mp.solutions.pose

# helper to get pixel coordinates
def get_xy(lm, idx, w, h):
    return int(lm[idx].x * w), int(lm[idx].y * h)

# compute squat angles
def compute_squat_angles(lm, w, h):
    lh = get_xy(lm, 23, w, h)
    lk = get_xy(lm, 25, w, h)
    la = get_xy(lm, 27, w, h)

    rh = get_xy(lm, 24, w, h)
    rk = get_xy(lm, 26, w, h)
    ra = get_xy(lm, 28, w, h)

    knee_l = angle_3pts(lh, lk, la)
    knee_r = angle_3pts(rh, rk, ra)

    hip_l = angle_3pts((lm[11].x*w, lm[11].y*h), lh, lk)
    hip_r = angle_3pts((lm[12].x*w, lm[12].y*h), rh, rk)

    torso = torso_angle_deg(lm)

    return {
        "knee_l": knee_l,
        "knee_r": knee_r,
        "hip_l": hip_l,
        "hip_r": hip_r,
        "torso": torso
    }

def detect_phase(angles, prev_phase, reached_depth):
    knee_l = angles["knee_l"]
    knee_r = angles["knee_r"]

    if knee_l is None or knee_r is None:
        return "setup", reached_depth

    avg_knee = (knee_l + knee_r) / 2.0

    STANDING_THRESHOLD = 155
    BEND_THRESHOLD = 140
    DEPTH_THRESHOLD = 110

    if avg_knee < DEPTH_THRESHOLD:
        reached_depth = True

    if prev_phase == "setup":
        if avg_knee < BEND_THRESHOLD:
            return "execution", reached_depth
        return "setup", reached_depth
    else:
        if avg_knee > STANDING_THRESHOLD:
            return "setup", reached_depth
        return "execution", reached_depth

def coaching_rules(angles, phase, reached_depth):
    if phase == "setup":
        if reached_depth is False:
            return ""
        return ""

    knee_l = angles["knee_l"]
    knee_r = angles["knee_r"]
    torso = angles["torso"]

    if knee_l is None or knee_r is None:
        return ""

    avg_knee = (knee_l + knee_r) / 2.0

    if torso is not None and torso > 55:
        return "too much forward lean"

    if avg_knee > 120 and not reached_depth:
        return "go deeper"

    return ""

# main squat module
def run_squat():
    print("squat mode (balanced + setup/execution). press esc to exit.")

    pose = mp_pose.Pose(
        model_complexity=0,       # faster mediapipe
        smooth_landmarks=True
    )

    cap = cv2.VideoCapture(0)
    smoother = SmootherDict(6)

    reps = 0
    prev_phase = "setup"
    reached_depth = False

    frame_id = 0
    score_cache = 75

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
            cv2.imshow("PhoenixFit – Squat", frame)
            if cv2.waitKey(1) & 0xFF == 27:
                break
            continue

        lm = results.pose_landmarks.landmark

        angles_raw = compute_squat_angles(lm, w, h)
        angles = smoother.update(angles_raw)

        phase, reached_depth = detect_phase(angles, prev_phase, reached_depth)

        if prev_phase == "execution" and phase == "setup":
            if reached_depth:
                reps += 1
            reached_depth = False
        prev_phase = phase

        if frame_id % 2 == 0:
            feat = [
                angles["knee_l"],
                angles["knee_r"],
                angles["torso"]
            ]
            score_cache = predict_score("squat", feat)

        coach_text = coaching_rules(angles, phase, reached_depth)

        mp.solutions.drawing_utils.draw_landmarks(
            frame,
            results.pose_landmarks,
            mp_pose.POSE_CONNECTIONS,
            mp.solutions.drawing_styles.get_default_pose_landmarks_style()
        )

        angle_panel = {
            "knee_l": angles["knee_l"],
            "knee_r": angles["knee_r"],
            "hip_l": angles["hip_l"],
            "hip_r": angles["hip_r"],
            "torso": angles["torso"]
        }

        ui_frame = draw_full_overlay(
            frame,
            phase=phase,
            reps=reps,
            angles=angle_panel,
            score=score_cache,
            coach=coach_text,
            fps=fps_val
        )

        cv2.imshow("PhoenixFit – Squat", ui_frame)

        key = cv2.waitKey(1) & 0xFF
        if key == 27:
            break
        if key == 32:
            print(f"summary: {reps} reps, last score: {score_cache}")

        frame_id += 1

    cap.release()
    cv2.destroyAllWindows()
