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

def avg_visibility(lm, idxs):
    vals = [float(getattr(lm[i], "visibility", 0.0)) for i in idxs]
    return float(sum(vals) / len(vals)) if vals else 0.0

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

    # Use the better visible side for body-line checks.
    vis_l = avg_visibility(lm, (11, 13, 15, 23, 27))
    vis_r = avg_visibility(lm, (12, 14, 16, 24, 28))
    if vis_l >= vis_r:
        sh = get_xy(lm, 11, w, h)
        hp = get_xy(lm, 23, w, h)
        ankle = get_xy(lm, 27, w, h)
        elbow_ref = elbow_l
    else:
        sh = get_xy(lm, 12, w, h)
        hp = get_xy(lm, 24, w, h)
        ankle = get_xy(lm, 28, w, h)
        elbow_ref = elbow_r

    torso = angle_3pts(sh, hp, ankle)
    line_y = None
    dx = float(ankle[0] - sh[0])
    if abs(dx) > 1e-3:
        t = (float(hp[0]) - float(sh[0])) / dx
        line_y = float(sh[1]) + t * (float(ankle[1]) - float(sh[1]))
    hip_line_delta = float(hp[1] - line_y) if line_y is not None else 0.0

    return {
        "elbow_l": elbow_l,
        "elbow_r": elbow_r,
        "elbow_ref": elbow_ref,
        "vis_l": vis_l,
        "vis_r": vis_r,
        "torso": torso,
        "hip_line_delta": hip_line_delta,
    }

# setup/execution phase with hysteresis + depth tracking
def detect_phase(angles, prev_phase, reached_bottom):
    elbow_ref = angles["elbow_ref"]
    if elbow_ref is None:
        return "setup", reached_bottom

    EXTENDED_THRESHOLD = 150
    BENT_THRESHOLD = 135
    DEPTH_THRESHOLD = 118

    if elbow_ref < DEPTH_THRESHOLD:
        reached_bottom = True

    if prev_phase == "setup":
        if elbow_ref < BENT_THRESHOLD:
            return "execution", reached_bottom
        return "setup", reached_bottom
    else:
        if elbow_ref > EXTENDED_THRESHOLD:
            return "setup", reached_bottom
        return "execution", reached_bottom

# coaching logic
def coaching_rules(angles, phase, reached_bottom):
    if phase == "setup":
        return ""

    torso = angles["torso"]
    hip_line_delta = angles["hip_line_delta"]
    elbow_l = angles["elbow_l"]
    elbow_r = angles["elbow_r"]
    elbow_ref = angles["elbow_ref"]

    if hip_line_delta > 25:
        return "don't let hips sag"

    if hip_line_delta < -25:
        return "keep hips down"

    if torso is not None and torso < 130:
        return "straighten your body"

    if elbow_l is not None and elbow_r is not None and abs(elbow_l - elbow_r) > 25:
        return "even out your arms"

    if elbow_ref is not None and elbow_ref > 120 and not reached_bottom:
        return "go deeper"

    return ""


def form_adjusted_score(ml_score, angles, phase):
    if phase == "setup":
        return ml_score

    score = float(ml_score)
    torso = angles["torso"]
    hip_line_delta = angles["hip_line_delta"]
    elbow_l = angles["elbow_l"]
    elbow_r = angles["elbow_r"]

    if torso is not None and torso < 130:
        score -= 20

    if abs(hip_line_delta) > 25:
        score -= 15

    if elbow_l is not None and elbow_r is not None and abs(elbow_l - elbow_r) > 25:
        score -= 10

    return int(max(0, min(100, score)))

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
    reached_bottom = False

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
            cv2.imshow("PhoenixFit – Pushup", frame)
            if cv2.waitKey(1) & 0xFF == 27:
                break
            continue

        lm = results.pose_landmarks.landmark

        angles_raw = compute_pushup_angles(lm, w, h)
        angles = smoother.update(angles_raw)

        phase, reached_bottom = detect_phase(angles, prev_phase, reached_bottom)

        if prev_phase == "execution" and phase == "setup":
            if reached_bottom:
                reps += 1
            reached_bottom = False
        prev_phase = phase

        if frame_id % 2 == 0:
            feat = [
                angles["elbow_l"],
                angles["elbow_r"],
                angles["torso"]
            ]
            raw_score = predict_score("pushup", feat)
            score_cache = form_adjusted_score(raw_score, angles, phase)

        coach = coaching_rules(angles, phase, reached_bottom)

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

        ui_frame = draw_full_overlay(
            frame,
            phase=phase,
            reps=reps,
            angles=angle_panel,
            score=score_cache,
            coach=coach,
            fps=fps_val
        )

        cv2.imshow("PhoenixFit – Pushup", ui_frame)

        key = cv2.waitKey(1) & 0xFF
        if key == 27:
            break

        frame_id += 1

    cap.release()
    cv2.destroyAllWindows()
