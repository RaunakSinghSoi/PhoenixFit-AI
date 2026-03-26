# raunak singh soi – phoenixfit deadlift (balanced fps + full overlay)

import cv2
import mediapipe as mp
import numpy as np
import time
import threading
import queue

from utils.angle_math import angle_3pts, torso_angle_deg
from utils.smoothing import SmootherDict
from utils.ml_predictor import predict_score
from utils.visualization import draw_full_overlay

mp_pose = mp.solutions.pose


class VoiceCoach:
    """Non-blocking TTS that speaks coaching cues + score in a background thread."""

    def __init__(self, cooldown=3.0):
        self._q = queue.Queue()
        self._last = ""
        self._last_time = 0.0
        self._cooldown = cooldown
        self._t = threading.Thread(target=self._worker, daemon=True)
        self._t.start()

    def _worker(self):
        try:
            import pyttsx3
            engine = pyttsx3.init()
            engine.setProperty("rate", 160)
            while True:
                text = self._q.get()
                if text is None:
                    break
                engine.say(text)
                engine.runAndWait()
        except Exception:
            pass

    def speak(self, coach_text, score):
        if not coach_text:
            return
        now = time.time()
        if coach_text == self._last and (now - self._last_time) < self._cooldown:
            return
        self._last = coach_text
        self._last_time = now
        while not self._q.empty():
            try:
                self._q.get_nowait()
            except queue.Empty:
                break
        self._q.put(f"{coach_text}. Score {int(score)}")

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
    if vis_l >= 0.7 and vis_r >= 0.7:
        hinge = (hinge_l + hinge_r) / 2.0
    elif vis_l >= vis_r:
        hinge = hinge_l
    else:
        hinge = hinge_r

    return {
        "knee_l": knee_l,
        "knee_r": knee_r,
        "torso": torso,
        "hinge": hinge,
        "vis_l": vis_l,
        "vis_r": vis_r,
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
    if phase == "setup":
        return ""

    torso = angles["torso"]
    hinge = angles["hinge"]
    knee_l = angles["knee_l"]
    knee_r = angles["knee_r"]
    vis_l = angles.get("vis_l", 0.0)
    vis_r = angles.get("vis_r", 0.0)

    if torso is None or hinge is None:
        return ""

    if torso > 18:
        return "keep back straight"

    if hinge < 110:
        return "chest up"

    if hinge > 152:
        return "lock out at the top"

    both_legs_visible = (vis_l is not None and vis_r is not None
                         and vis_l > 0.6 and vis_r > 0.6)
    if both_legs_visible and knee_l is not None and knee_r is not None:
        if abs(knee_l - knee_r) > 15:
            return "even out your knees"

    return ""

def form_adjusted_score(ml_score, angles, phase):
    if phase == "setup":
        return ml_score

    score = float(ml_score)
    torso = angles["torso"]
    hinge = angles["hinge"]
    knee_l = angles["knee_l"]
    knee_r = angles["knee_r"]
    vis_l = angles.get("vis_l", 0.0)
    vis_r = angles.get("vis_r", 0.0)

    if torso is not None:
        if torso > 18:
            score -= 25
        elif torso > 12:
            score -= 10

    if hinge is not None and hinge < 110:
        score -= 20

    both_legs_visible = (vis_l is not None and vis_r is not None
                         and vis_l > 0.6 and vis_r > 0.6)
    if both_legs_visible and knee_l is not None and knee_r is not None:
        if abs(knee_l - knee_r) > 15:
            score -= 10

    return int(max(0, min(100, score)))

def run_deadlift():
    print("deadlift mode (balanced + full overlay). press esc to exit.")

    pose = mp_pose.Pose(
        model_complexity=0,
        smooth_landmarks=True
    )

    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
    smoother = SmootherDict(6)
    voice = VoiceCoach(cooldown=3.0)

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

        if frame_id % 2 == 0:
            feat = [
                angles["knee_l"],
                angles["knee_r"],
                angles["torso"]
            ]
            raw_score = predict_score("deadlift", feat)
            score_cache = form_adjusted_score(raw_score, angles, phase)

        coach = coaching_rules(angles, phase)

        if coach:
            voice.speak(coach, score_cache)

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

        ui_frame = draw_full_overlay(
            frame,
            phase=phase,
            reps=reps,
            angles=angle_panel,
            score=score_cache,
            coach=coach,
            fps=fps_val
        )

        cv2.imshow("PhoenixFit – Deadlift", ui_frame)

        key = cv2.waitKey(1) & 0xFF
        if key == 27:
            break

        frame_id += 1

    cap.release()
    cv2.destroyAllWindows()
