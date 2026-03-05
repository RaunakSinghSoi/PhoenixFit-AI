# raunak singh soi – phoenixfit ui v2 (clean modern overlay)

import cv2
import time

# semi-transparent rectangle helper
def draw_panel(frame, x, y, w, h, color=(0,0,0), alpha=0.45):
    overlay = frame.copy()
    cv2.rectangle(overlay, (x, y), (x + w, y + h), color, -1)
    return cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0)

# clean text helper
def put_text(frame, text, x, y, size=0.7, color=(255,255,255), thick=2):
    cv2.putText(frame, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, size, color, thick, cv2.LINE_AA)

# -------------------------
# LEFT INFO PANEL (angles)
# -------------------------
def draw_angle_panel(frame, angle_dict, x=10, y=60):
    """
    angle_dict example:
       {"knee_l": 155, "knee_r": 170, "hip_l": 140, ...}
    """
    h = 25 * len(angle_dict) + 20
    frame = draw_panel(frame, x, y - 40, 200, h)

    put_text(frame, "Angles", x + 10, y - 15, 0.7, (0,255,255))

    offset = 0
    for name, val in angle_dict.items():
        if val is None:
            t = f"{name}: ---"
        else:
            t = f"{name}: {int(val)}°"
        put_text(frame, t, x + 10, y + offset, 0.6)
        offset += 25

    return frame

# -------------------------
# PHASE + REPS BOX (top)
# -------------------------
def draw_phase_reps(frame, phase, reps):
    text = f"Phase: {phase}  |  Reps: {reps}"
    frame = draw_panel(frame, 10, 10, 300, 40)
    put_text(frame, text, 20, 40, 0.7, (0,255,255))
    return frame

# -------------------------
# SCORE BANNER (bottom-left)
# -------------------------
def draw_score_banner(frame, score):
    score = int(score)
    label = f"{score}/100"

    # lenient thresholds - average squats should be GOOD or EXCELLENT
    if score >= 70:
        color = (0, 200, 0)   # green
        status = "EXCELLENT"
    elif score >= 50:
        color = (50, 180, 255)  # yellow-blue
        status = "GOOD"
    elif score >= 30:
        color = (0, 140, 255)  # orange
        status = "OK"
    else:
        color = (0, 0, 255)   # red
        status = "BAD"

    w, h = 260, 55
    frame = draw_panel(frame, 10, frame.shape[0] - h - 10, w, h, color=color, alpha=0.35)

    put_text(frame, f"{status}  ({label})", 20, frame.shape[0] - 25, 0.8, (255,255,255), 2)
    return frame

# -------------------------
# COACHING TEXT (under score)
# -------------------------
def draw_coaching(frame, coaching_text):
    if coaching_text.strip() == "":
        return frame
    
    y = frame.shape[0] - 80
    frame = draw_panel(frame, 10, y, 280, 35, color=(0,0,0), alpha=0.5)
    put_text(frame, coaching_text, 20, y + 25, 0.6, (0,255,255))
    return frame

# -------------------------
# FPS COUNTER (bottom-right)
# -------------------------
def draw_fps(frame, fps):
    text = f"FPS {int(fps)}"
    x = frame.shape[1] - 150
    y = frame.shape[0] - 20
    frame = draw_panel(frame, x - 10, y - 30, 140, 40)
    put_text(frame, text, x, y, 0.7, (0,255,255))
    return frame

# -------------------------
# STATUS BAR (bottom middle)
# -------------------------
def draw_status_bar(frame):
    msg = "SPACE=Summary   |   ESC=Exit"
    w = 330
    h = 35
    x = frame.shape[1] // 2 - w // 2
    y = frame.shape[0] - h - 10

    frame = draw_panel(frame, x, y, w, h)
    put_text(frame, msg, x + 10, y + 25, 0.6, (255,255,255))
    return frame

# -------------------------
# MAIN COMBINED DRAW
# -------------------------
def draw_full_overlay(frame, phase, reps, angles, score, coach, fps):
    """
    angles = dict of angle values
    """
    frame = draw_phase_reps(frame, phase, reps)
    frame = draw_angle_panel(frame, angles)
    frame = draw_score_banner(frame, score)
    frame = draw_coaching(frame, coach)
    frame = draw_fps(frame, fps)
    frame = draw_status_bar(frame)
    return frame
