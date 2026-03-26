"""
PhoenixFit – FastAPI vision rep-count server

Mobile app (`src/screens/RepTrackingScreen.tsx`) streams camera frames to:
- GET  /health
- POST /analyze-frame  (multipart form: file, session_id, exercise, run_id?, frame_id?)

This server runs Mediapipe Pose on each frame, tracks per-session rep counts,
and returns landmarks + bounding box for the in-app overlay.
"""

from __future__ import annotations

import os
import sys
import time
import threading
import warnings
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

# Suppress noisy third-party warnings (protobuf, sklearn version, absl)
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"
os.environ["GLOG_minloglevel"] = "2"
warnings.filterwarnings("ignore", message="SymbolDatabase.GetPrototype")
warnings.filterwarnings("ignore", category=UserWarning, module="google.protobuf")

import numpy as np
import cv2
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

import mediapipe as mp

# Ensure `utils/` is importable whether we run from repo root or from Raunak_ML_code/.
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

from utils.angle_math import angle_3pts, torso_angle_deg
from utils.ml_predictor import predict_score
from utils.smoothing import SmootherDict


app = FastAPI(title="PhoenixFit Vision Server", version="1.0.0")

# Allow dev/testing from phones on same network.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


mp_pose = mp.solutions.pose

_POSE_LOCK = threading.Lock()
_POSE = mp_pose.Pose(model_complexity=0, smooth_landmarks=True)


@dataclass
class SessionState:
    exercise: str
    reps: int = 0
    prev_phase: str = "setup"
    frame_count: int = 0
    score_cache: int = 75
    smoother: SmootherDict = None  # type: ignore
    last_seen_s: float = 0.0
    reached_bottom: bool = False
    current_rep_scores: list = None
    rep_scores: list = None
    latest_rep_score: int = None
    # Squat per-rep fault tracking (extremes during execution)
    rep_min_knee: float = 180.0
    # Minimum hip angle recorded in mid/deep squat.
    # Lower angle => more forward lean (e.g., <80 is usually excessive).
    rep_min_hip_mid: float = 180.0
    # Post-rep feedback (shown for N frames after completion, then clears)
    last_rep_feedback: str = ""
    feedback_frames_left: int = 0
    # Deadlift per-rep metric tracking (for stable, simple feedback).
    rep_min_hinge: float = 180.0
    rep_max_torso: float = 0.0
    rep_max_knee_diff: float = 0.0
    # Pushup per-rep metric tracking.
    rep_min_elbow: float = 180.0
    # Most negative value indicates hips above shoulder-ankle line (butt too high).
    rep_min_hip_line_delta: float = 1.0

    def __post_init__(self):
        if self.smoother is None:
            self.smoother = SmootherDict(3)
        if self.current_rep_scores is None:
            self.current_rep_scores = []
        if self.rep_scores is None:
            self.rep_scores = []


_SESSIONS: Dict[str, SessionState] = {}
_SESSIONS_LOCK = threading.Lock()
_SESSION_TTL_S = 60.0 * 20  # 20 minutes


def _session_key(session_id: str, exercise: str) -> str:
    return f"{session_id}:{exercise}"


def _cleanup_sessions(now_s: float) -> None:
    with _SESSIONS_LOCK:
        stale = [k for k, s in _SESSIONS.items() if (now_s - s.last_seen_s) > _SESSION_TTL_S]
        for k in stale:
            _SESSIONS.pop(k, None)


def _get_session(session_id: str, exercise: str, now_s: float) -> SessionState:
    key = _session_key(session_id, exercise)
    with _SESSIONS_LOCK:
        s = _SESSIONS.get(key)
        if s is None:
            s = SessionState(exercise=exercise, last_seen_s=now_s)
            _SESSIONS[key] = s
        s.last_seen_s = now_s
        return s


def _decode_image(upload_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(upload_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None or img.size == 0:
        raise HTTPException(status_code=400, detail="Invalid image")
    return img


def _pose_process(rgb_img: np.ndarray):
    # Mediapipe Pose is not guaranteed thread-safe; guard it.
    with _POSE_LOCK:
        return _POSE.process(rgb_img)


def _landmarks_to_json(lm) -> list[dict]:
    out = []
    for p in lm:
        out.append({"x": float(p.x), "y": float(p.y), "v": float(getattr(p, "visibility", 0.0))})
    return out


def _bbox_from_landmarks(lm) -> Dict[str, float]:
    xs = [float(p.x) for p in lm]
    ys = [float(p.y) for p in lm]
    xmin = max(0.0, min(xs))
    ymin = max(0.0, min(ys))
    xmax = min(1.0, max(xs))
    ymax = min(1.0, max(ys))
    return {"xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax}


def _visibility_confidence(lm, idxs: Tuple[int, ...]) -> float:
    vs = []
    for i in idxs:
        v = float(getattr(lm[i], "visibility", 0.0))
        vs.append(v)
    if not vs:
        return 0.0
    return float(sum(vs) / len(vs))


def _get_xy_norm(lm, idx: int) -> Tuple[float, float]:
    return float(lm[idx].x), float(lm[idx].y)


def _compute_squat_angles(lm) -> Dict[str, Optional[float]]:
    lh = _get_xy_norm(lm, 23)
    lk = _get_xy_norm(lm, 25)
    la = _get_xy_norm(lm, 27)

    rh = _get_xy_norm(lm, 24)
    rk = _get_xy_norm(lm, 26)
    ra = _get_xy_norm(lm, 28)

    knee_l = float(angle_3pts(lh, lk, la))
    knee_r = float(angle_3pts(rh, rk, ra))

    hip_l = float(angle_3pts(_get_xy_norm(lm, 11), lh, lk))
    hip_r = float(angle_3pts(_get_xy_norm(lm, 12), rh, rk))

    torso = float(torso_angle_deg(lm))

    return {"knee_l": knee_l, "knee_r": knee_r, "hip_l": hip_l, "hip_r": hip_r, "torso": torso}


def _detect_phase_squat(angles: Dict[str, Optional[float]], session: "SessionState") -> Tuple[str, bool]:
    """
    Returns (phase, reached_bottom).
    Phase: "setup" (standing), "execution" (squatting down/up)
    reached_bottom: True if user has squatted deep enough to count a rep
    """
    knee_l = angles.get("knee_l")
    knee_r = angles.get("knee_r")
    if knee_l is None or knee_r is None:
        return "setup", session.reached_bottom
    
    min_knee = min(knee_l, knee_r)
    
    # Simple thresholds:
    # - "resting/standing" is knee angle > 160°
    # - enter execution once knee bends below the squat threshold
    # - depth is tracked for coaching (reps still count even if shallow)
    STANDING_THRESHOLD = 160
    SQUAT_THRESHOLD = 150
    DEPTH_THRESHOLD = 130
    
    reached_bottom = session.reached_bottom
    
    # Check if reached depth
    if min_knee < DEPTH_THRESHOLD:
        reached_bottom = True
    
    # Debug logging every few frames
    if session.frame_count % 10 == 0:
        print(f"[SQUAT] knee_min={min_knee:.1f}° phase={session.prev_phase} depth_reached={reached_bottom}")
    
    # Determine phase with hysteresis
    if session.prev_phase == "setup":
        # Currently standing - need to go below SQUAT_THRESHOLD to enter execution
        if min_knee < SQUAT_THRESHOLD:
            return "execution", reached_bottom
        return "setup", reached_bottom
    else:
        # Currently in execution - need to go above STANDING_THRESHOLD to return to setup
        if min_knee > STANDING_THRESHOLD:
            return "setup", reached_bottom
        return "execution", reached_bottom



def _evaluate_squat_rep(session: "SessionState", rep_score: Optional[int]) -> str:
    """
    Called once when a squat rep completes.
    Angles are checked FIRST regardless of score — score is only used
    as a fallback when no angle fault is detected.
    """
    min_knee = session.rep_min_knee
    min_hip_mid = session.rep_min_hip_mid

    print(f"[EVAL] min_knee={min_knee:.1f}° min_hip_mid={min_hip_mid:.1f}° score={rep_score}")

    score_value = int(rep_score) if rep_score is not None else int(session.score_cache)

    if score_value >= 80:
        rating = "Great rep."
    elif score_value >= 60:
        rating = "Good rep."
    elif score_value < 50:
        rating = "Bad rep."
    else:
        rating = "Needs work."

    fault = ""
    # User-tested thresholds:
    # - depth fault if knees never got to <= 90°
    # - lean fault if hip angle dropped below 80° in mid/deep squat
    if min_knee > 90:
        fault = "Not enough depth."
    elif min_hip_mid < 80:
        fault = "Too much forward lean."

    return f"{score_value} {rating} {fault}".strip()


def _compute_pushup_angles(lm) -> Dict[str, Optional[float]]:
    ls = _get_xy_norm(lm, 11)
    le = _get_xy_norm(lm, 13)
    lw = _get_xy_norm(lm, 15)

    rs = _get_xy_norm(lm, 12)
    re = _get_xy_norm(lm, 14)
    rw = _get_xy_norm(lm, 16)

    elbow_l = float(angle_3pts(ls, le, lw))
    elbow_r = float(angle_3pts(rs, re, rw))

    # Use the best visible side for side-view pushup geometry.
    vis_l = _visibility_confidence(lm, (11, 13, 15, 23, 27))
    vis_r = _visibility_confidence(lm, (12, 14, 16, 24, 28))
    elbow_ref = elbow_l if vis_l >= vis_r else elbow_r
    if vis_l >= vis_r:
        sh = _get_xy_norm(lm, 11)
        hp = _get_xy_norm(lm, 23)
        ankle = _get_xy_norm(lm, 27)
    else:
        sh = _get_xy_norm(lm, 12)
        hp = _get_xy_norm(lm, 24)
        ankle = _get_xy_norm(lm, 28)

    torso = float(angle_3pts(sh, hp, ankle))

    # Vertical delta between hip and shoulder-ankle line at hip.x.
    # Negative => hip above line (butt in the air), positive => hips sagging.
    line_y = None
    dx = float(ankle[0] - sh[0])
    if abs(dx) > 1e-3:
        t = (float(hp[0]) - float(sh[0])) / dx
        line_y = float(sh[1]) + t * (float(ankle[1]) - float(sh[1]))
    hip_line_delta = float(hp[1] - line_y) if line_y is not None else None

    return {
        "elbow_l": elbow_l,
        "elbow_r": elbow_r,
        "elbow_ref": float(elbow_ref),
        "vis_l": float(vis_l),
        "vis_r": float(vis_r),
        "torso": torso,
        "hip_line_delta": hip_line_delta,
    }


def _detect_phase_pushup(angles: Dict[str, Optional[float]], session: "SessionState") -> Tuple[str, bool]:
    """
    Returns (phase, reached_bottom).
    For pushups: setup = arms extended, execution = arms bent
    """
    elbow_ref = angles.get("elbow_ref")
    if elbow_ref is None:
        return "setup", session.reached_bottom

    # Side-view thresholds (with 3-frame smoothing, raw angles are dampened):
    #   Lockout top: raw ~160-175, smoothed ~145-160
    #   Bottom:      raw ~70-95,  smoothed ~80-100
    EXTENDED_THRESHOLD = 148
    BENT_THRESHOLD = 130
    DEPTH_THRESHOLD = 100

    reached_bottom = session.reached_bottom

    if elbow_ref < DEPTH_THRESHOLD:
        reached_bottom = True

    if session.frame_count % 15 == 0:
        print(
            f"[PUSHUP] elbow_ref={elbow_ref:.1f}° "
            f"phase={session.prev_phase} depth={reached_bottom}"
        )

    if session.prev_phase == "setup":
        if elbow_ref < BENT_THRESHOLD:
            return "execution", reached_bottom
        return "setup", reached_bottom
    else:
        if elbow_ref > EXTENDED_THRESHOLD:
            return "setup", reached_bottom
        return "execution", reached_bottom


def _coach_pushup(angles: Dict[str, Optional[float]], phase: str) -> str:
    elbow_ref = angles.get("elbow_ref")
    torso = angles.get("torso")
    hip_line_delta = angles.get("hip_line_delta")
    if elbow_ref is None or torso is None:
        return ""
    if phase == "setup":
        return ""
    if hip_line_delta is not None and hip_line_delta < -0.09:
        return "keep hips down"
    if torso is not None and torso < 130:
        return "straighten your body"
    return ""


def _evaluate_pushup_rep(session: "SessionState", _model_score: Optional[int]) -> Tuple[int, str]:
    """
    Rule-based pushup rep evaluation.  The ML model isn't reliable for
    side-view pushups, so we score purely on body-line geometry.
    Only penalise for clearly bad form (butt way up in the air).
    """
    min_hip_delta = float(session.rep_min_hip_line_delta)

    if min_hip_delta < -0.09:
        return 55, "Butt in the air."

    return 90, "Good rep!"


def _compute_deadlift_angles(lm) -> Dict[str, Optional[float]]:
    lh = _get_xy_norm(lm, 23)
    lk = _get_xy_norm(lm, 25)
    la = _get_xy_norm(lm, 27)

    rh = _get_xy_norm(lm, 24)
    rk = _get_xy_norm(lm, 26)
    ra = _get_xy_norm(lm, 28)

    knee_l = float(angle_3pts(lh, lk, la))
    knee_r = float(angle_3pts(rh, rk, ra))

    torso = float(torso_angle_deg(lm))

    # Use the best visible side (or average both when reliable) for 45-degree camera setups.
    sh_l = _get_xy_norm(lm, 11)
    sh_r = _get_xy_norm(lm, 12)
    hinge_l = float(angle_3pts(sh_l, lh, lk))
    hinge_r = float(angle_3pts(sh_r, rh, rk))

    vis_l = _visibility_confidence(lm, (11, 23, 25))
    vis_r = _visibility_confidence(lm, (12, 24, 26))
    if vis_l >= 0.5 and vis_r >= 0.5:
        hinge = float((hinge_l + hinge_r) / 2.0)
    elif vis_l >= vis_r:
        hinge = hinge_l
    else:
        hinge = hinge_r

    return {"knee_l": knee_l, "knee_r": knee_r, "torso": torso, "hinge": hinge}


def _detect_phase_deadlift(angles: Dict[str, Optional[float]], session: "SessionState") -> Tuple[str, bool]:
    """
    Returns (phase, reached_bottom).
    For deadlifts: setup = standing upright, execution = hinging
    """
    hinge = angles.get("hinge")
    if hinge is None:
        return "setup", session.reached_bottom
    
    # More lenient thresholds
    STANDING_THRESHOLD = 155   # Above this = standing (setup) - lowered from 165
    HINGE_THRESHOLD = 145      # Below this = hinging (execution) - lowered from 155
    DEPTH_THRESHOLD = 130      # Must hinge this much to count - raised from 120
    
    reached_bottom = session.reached_bottom
    
    # Check if reached depth
    if hinge < DEPTH_THRESHOLD:
        reached_bottom = True
    
    # Debug logging
    if session.frame_count % 10 == 0:
        print(f"[DEADLIFT] hinge={hinge:.1f}° phase={session.prev_phase} depth_reached={reached_bottom}")
    
    # Determine phase with hysteresis
    if session.prev_phase == "setup":
        if hinge < HINGE_THRESHOLD:
            return "execution", reached_bottom
        return "setup", reached_bottom
    else:
        if hinge > STANDING_THRESHOLD:
            return "setup", reached_bottom
        return "execution", reached_bottom


def _coach_deadlift(angles: Dict[str, Optional[float]], phase: str) -> str:
    torso = angles.get("torso")
    hinge = angles.get("hinge")
    if torso is None or hinge is None:
        return ""
    if phase == "setup":
        return ""
    # Keep live feedback minimal while moving; rep-complete feedback is primary.
    if hinge < 65:
        return "keep back neutral"
    # Only warn for chest position near/below bottom range to avoid constant spam.
    if hinge < 140 and torso > 130:
        return "keep chest taller"
    return ""

def _evaluate_deadlift_rep(session: "SessionState") -> Tuple[int, str]:
    """
    Simple, stable deadlift rep feedback from per-rep extremes.
    Returns (rule_score, feedback_text).
    """
    min_hinge = float(session.rep_min_hinge)
    max_torso = float(session.rep_max_torso)
    max_knee_diff = float(session.rep_max_knee_diff)

    # 45-degree camera thresholds.
    if min_hinge > 138:
        return 55, "hinge deeper before lockout"
    if max_torso > 130:
        return 65, "keep chest taller"
    if max_knee_diff > 38:
        return 72, "keep hips level"
    return 90, "good rep"


def _blend_deadlift_score(model_score: int, rule_score: int) -> int:
    """
    Blend ML score and rule score for more reliable per-rep deadlift scoring.
    """
    # Heavier rule weight because model was trained on different camera geometry.
    out = int(round((0.2 * float(model_score)) + (0.8 * float(rule_score))))
    return max(0, min(100, out))


def _scale_score(raw_score: int) -> int:
    """
    Scale scores to allow reaching 80-100 range, but ONLY for scores above 70.
    Bad reps (<=70) keep their original score, good reps get boosted.
    
    Example: 70 -> 70, 75 -> 83, 80 -> 92, 85+ -> caps at 100
    """
    if raw_score <= 70:
        return raw_score
    
    # For scores 71-100, scale the portion above 70
    # Maps 70-85 range to 70-100 range (stretch factor ~2x for bonus points)
    bonus = raw_score - 70
    scaled_bonus = bonus * 2.0
    final = 70 + scaled_bonus
    
    return min(100, int(round(final)))


def _analyze(exercise: str, session: SessionState, lm) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    # Compute + smooth angles
    if exercise == "squat":
        angles_raw = _compute_squat_angles(lm)
        angles = session.smoother.update(angles_raw)
        phase, reached_bottom = _detect_phase_squat(angles, session)
        coach = ""
        feat = [angles.get("knee_l"), angles.get("knee_r"), angles.get("torso")]
        feat = [float(x) if x is not None else 0.0 for x in feat]
        score_ex = "squat"

        # Track worst angles during execution (evaluated after rep completes)
        if phase == "execution":
            kl = angles.get("knee_l")
            kr = angles.get("knee_r")
            hl = angles.get("hip_l")
            hr = angles.get("hip_r")
            if kl is not None and kr is not None:
                mk = min(kl, kr)
                if mk < session.rep_min_knee:
                    session.rep_min_knee = mk
                # Only evaluate lean once user reaches mid/deeper squat.
                if mk < 145 and hl is not None and hr is not None:
                    mh = min(hl, hr)
                    if mh < session.rep_min_hip_mid:
                        session.rep_min_hip_mid = mh
    elif exercise == "pushup":
        angles_raw = _compute_pushup_angles(lm)
        angles = session.smoother.update(angles_raw)
        phase, reached_bottom = _detect_phase_pushup(angles, session)
        coach = _coach_pushup(angles, phase)
        feat = [angles.get("elbow_l"), angles.get("elbow_r"), angles.get("torso")]
        feat = [float(x) if x is not None else 0.0 for x in feat]
        score_ex = "pushup"

        # Track per-rep pushup extremes during execution.
        if phase == "execution":
            er = angles.get("elbow_ref")
            hd = angles.get("hip_line_delta")
            if er is not None and er < session.rep_min_elbow:
                session.rep_min_elbow = er
            if hd is not None and hd < session.rep_min_hip_line_delta:
                session.rep_min_hip_line_delta = hd
    elif exercise == "deadlift":
        angles_raw = _compute_deadlift_angles(lm)
        angles = session.smoother.update(angles_raw)
        phase, reached_bottom = _detect_phase_deadlift(angles, session)
        coach = _coach_deadlift(angles, phase)
        feat = [angles.get("knee_l"), angles.get("knee_r"), angles.get("torso")]
        feat = [float(x) if x is not None else 0.0 for x in feat]
        score_ex = "deadlift"

        # Track per-rep deadlift extremes during execution.
        if phase == "execution":
            hinge = angles.get("hinge")
            torso = angles.get("torso")
            kl = angles.get("knee_l")
            kr = angles.get("knee_r")
            if hinge is not None and hinge < session.rep_min_hinge:
                session.rep_min_hinge = hinge
            if torso is not None and torso > session.rep_max_torso:
                session.rep_max_torso = torso
            if kl is not None and kr is not None:
                kd = abs(kl - kr)
                if kd > session.rep_max_knee_diff:
                    session.rep_max_knee_diff = kd

        # Angle debug logs for deadlift tuning.
        if session.frame_count % 10 == 0:
            hinge_now = angles.get("hinge")
            torso_now = angles.get("torso")
            kl = angles.get("knee_l")
            kr = angles.get("knee_r")
            kd_now = abs(kl - kr) if (kl is not None and kr is not None) else None
            if hinge_now is not None and torso_now is not None:
                kd_txt = f"{kd_now:.1f}" if kd_now is not None else "NA"
                kl_txt = f"{kl:.1f}" if kl is not None else "NA"
                kr_txt = f"{kr:.1f}" if kr is not None else "NA"
                print(
                    "[DL-ANGLES] "
                    f"phase={phase} "
                    f"hinge={hinge_now:.1f} torso={torso_now:.1f} "
                    f"knee_l={kl_txt} knee_r={kr_txt} knee_diff={kd_txt} "
                    f"| rep_min_hinge={session.rep_min_hinge:.1f} "
                    f"rep_max_torso={session.rep_max_torso:.1f} "
                    f"rep_max_knee_diff={session.rep_max_knee_diff:.1f}"
                )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown exercise '{exercise}'")

    # Update reached_bottom state
    session.reached_bottom = reached_bottom

    # Calculate current frame's score (for tracking during execution phase)
    current_score = None
    if session.frame_count % 5 == 0:
        try:
            current_score = int(predict_score(score_ex, feat))
        except Exception:
            pass

    # Track scores during execution phase (when actually doing the rep)
    if phase == "execution" and current_score is not None:
        session.current_rep_scores.append(current_score)

    rep_just_completed = False
    latest_rep_score = None

    # Rep lifecycle:
    # - reset tracking when a new execution phase starts
    # - for pushups/deadlifts, count a rep only if depth was reached before lockout
    if exercise == "squat" and session.prev_phase == "setup" and phase == "execution":
        session.rep_min_knee = 180.0
        session.rep_min_hip_mid = 180.0
        session.current_rep_scores = []
    elif exercise == "pushup" and session.prev_phase == "setup" and phase == "execution":
        session.current_rep_scores = []
        session.rep_min_elbow = 180.0
        session.rep_min_hip_line_delta = 1.0
    elif exercise == "deadlift" and session.prev_phase == "setup" and phase == "execution":
        session.current_rep_scores = []
        session.rep_min_hinge = 180.0
        session.rep_max_torso = 0.0
        session.rep_max_knee_diff = 0.0

    if session.prev_phase == "execution" and phase == "setup":
        should_count_rep = True
        if exercise in ("pushup", "deadlift"):
            should_count_rep = bool(session.reached_bottom)

        if should_count_rep:
            session.reps += 1
        session.reached_bottom = False

        if should_count_rep and session.current_rep_scores:
            # Robust model score: use 75th percentile, not noisy max frame.
            raw_score = int(round(float(np.percentile(session.current_rep_scores, 75))))
            model_score = _scale_score(raw_score)

            if exercise == "deadlift":
                rule_score, rep_feedback = _evaluate_deadlift_rep(session)
                latest_rep_score = _blend_deadlift_score(model_score, rule_score)
                coach = rep_feedback
                session.last_rep_feedback = rep_feedback
                session.feedback_frames_left = 25
                print(
                    "[DL-REP] "
                    f"rep={session.reps} model_p75={raw_score} model_scaled={model_score} "
                    f"rule={rule_score} final={latest_rep_score} "
                    f"min_hinge={session.rep_min_hinge:.1f} "
                    f"max_torso={session.rep_max_torso:.1f} "
                    f"max_knee_diff={session.rep_max_knee_diff:.1f} "
                    f"feedback='{rep_feedback}'"
                )
            elif exercise == "pushup":
                latest_rep_score, rep_feedback = _evaluate_pushup_rep(session, model_score)
                coach = rep_feedback
                session.last_rep_feedback = rep_feedback
                session.feedback_frames_left = 20
                print(
                    f"[PU-REP] rep={session.reps} "
                    f"score={latest_rep_score} feedback='{rep_feedback}'"
                )
            else:
                latest_rep_score = model_score
                print(f"[REP] +1 rep! Total: {session.reps} Raw: {raw_score} -> Scaled: {latest_rep_score} ({exercise})")

            session.rep_scores.append(latest_rep_score)
            session.latest_rep_score = latest_rep_score
            session.score_cache = latest_rep_score
        elif exercise == "deadlift" and not should_count_rep:
            coach = "hinge deeper before lockout"
            session.last_rep_feedback = coach
            session.feedback_frames_left = 20
        elif exercise == "pushup" and not should_count_rep:
            coach = "go lower before lockout"
            session.last_rep_feedback = coach
            session.feedback_frames_left = 20

        session.current_rep_scores = []
        rep_just_completed = should_count_rep

    # Squat coaching: evaluate once per rep, display for ~3 seconds afterward
    if exercise == "squat":
        if rep_just_completed:
            rep_score_for_feedback = latest_rep_score if latest_rep_score is not None else session.score_cache
            coach = _evaluate_squat_rep(session, rep_score_for_feedback)
            session.last_rep_feedback = coach
            session.feedback_frames_left = 25
            if coach:
                print(f"[COACH] {coach}")
        elif session.feedback_frames_left > 0:
            coach = session.last_rep_feedback
            session.feedback_frames_left -= 1
        else:
            coach = ""
    elif exercise == "deadlift":
        if session.feedback_frames_left > 0:
            coach = session.last_rep_feedback
            session.feedback_frames_left -= 1
    elif exercise == "pushup":
        if session.feedback_frames_left > 0:
            coach = session.last_rep_feedback
            session.feedback_frames_left -= 1

    session.prev_phase = phase

    session.frame_count += 1

    return (
        {
            "reps": session.reps,
            "score": session.score_cache,  # Only updates when rep completes
            "phase": phase,
            "coach": coach,
            "angles": angles,
            "rep_scores": session.rep_scores.copy(),
            "rep_just_completed": rep_just_completed,
            "latest_rep_score": latest_rep_score,
        },
        {
            "_angles_raw": angles_raw,
        },
    )


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/analyze-frame")
async def analyze_frame(
    file: UploadFile = File(...),
    session_id: str = Form(...),
    exercise: str = Form(...),
    run_id: Optional[str] = Form(None),
    frame_id: Optional[str] = Form(None),
):
    t0 = time.time()
    now_s = t0
    _cleanup_sessions(now_s)
    
    print(f"[analyze-frame] session={session_id[:12]}… exercise={exercise} frame_id={frame_id}")

    exercise = (exercise or "").strip().lower()
    if exercise not in ("squat", "pushup", "deadlift"):
        raise HTTPException(status_code=400, detail="exercise must be squat|pushup|deadlift")

    raw = await file.read()
    img_bgr = _decode_image(raw)
    h, w = img_bgr.shape[:2]
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    results = _pose_process(img_rgb)

    # Always get/create session so rep count persists even when pose is lost
    session = _get_session(session_id=session_id, exercise=exercise, now_s=now_s)

    if not results.pose_landmarks:
        dt = time.time() - t0
        return {
            "reps": session.reps,  # Keep current rep count
            "score": session.score_cache,
            "phase": session.prev_phase,
            "coach": "Position your full body in frame",
            "poseFound": False,
            "fps": (1.0 / dt) if dt > 0 else None,
            "angles": None,
            "_debug": {"frame_w": int(w), "frame_h": int(h), "run_id": run_id, "frame_id": frame_id},
            "landmarks": [],
            "bbox": None,
            "poseConfidence": 0.0,
        }

    lm = results.pose_landmarks.landmark

    # Confidence based on key points; if very low, treat as "no body".
    conf = _visibility_confidence(lm, (11, 12, 23, 24, 25, 26, 27, 28))
    pose_found = conf >= 0.35

    analysis, _dbg = _analyze(exercise, session, lm)
    dt = time.time() - t0

    return {
        "reps": analysis["reps"],
        "score": float(analysis["score"]) if analysis["score"] is not None else None,
        "phase": analysis["phase"],
        "coach": analysis["coach"],
        "poseFound": bool(pose_found),
        "fps": (1.0 / dt) if dt > 0 else None,
        "angles": analysis["angles"],
        "_debug": {"frame_w": int(w), "frame_h": int(h), "run_id": run_id, "frame_id": frame_id},
        "landmarks": _landmarks_to_json(lm) if pose_found else [],
        "bbox": _bbox_from_landmarks(lm) if pose_found else None,
        "poseConfidence": float(conf),
    }


