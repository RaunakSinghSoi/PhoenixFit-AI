# for ronin-Raunak

import numpy as np

class IMUProcessor:
    """
    imu processing module for squat, pushup, deadlift
    expects yaw, pitch, roll (deg) + ax, ay, az, a (m/s^2)
    computes stability, tilt, jerk and penalty score
    """

    def __init__(self, window=30):
        self.yaw = []
        self.pitch = []
        self.roll = []
        self.a = []
        self.ax = []
        self.ay = []
        self.az = []
        self.window = window

    def update(self, imu):
        """
        imu packet format:
            imu = {
                "yaw": float,
                "pitch": float,
                "roll": float,
                "a": float,
                "ax": float,
                "ay": float,
                "az": float
            }

        returns:
            imu_penalty: int 0–20
            imu_warnings: list[str]
            imu_features: dict
        """

        yaw = imu["yaw"]
        pitch = imu["pitch"]
        roll = imu["roll"]

        a_mag = imu["a"]
        ax = imu["ax"]
        ay = imu["ay"]
        az = imu["az"]

        # store values
        self._push(self.yaw, yaw)
        self._push(self.pitch, pitch)
        self._push(self.roll, roll)
        self._push(self.a, a_mag)
        self._push(self.ax, ax)
        self._push(self.ay, ay)
        self._push(self.az, az)

        # compute stability metrics
        pitch_std = np.std(self.pitch[-self.window:]) if len(self.pitch) > 5 else 0
        roll_std = np.std(self.roll[-self.window:]) if len(self.roll) > 5 else 0
        accel_std = np.std(self.a[-self.window:]) if len(self.a) > 5 else 0

        # tilt = forward/backward lean
        tilt = abs(pitch)

        # twist = torso rotation
        twist = abs(yaw - np.mean(self.yaw[-self.window:])) if len(self.yaw) > 5 else 0

        # jerk = rapid accel changes
        jerk = accel_std

        # build warnings + penalty
        warnings = []
        penalty = 0

        if tilt > 20:
            warnings.append("excessive forward lean")
            penalty += 5

        if roll_std > 5:
            warnings.append("side sway detected")
            penalty += 5

        if twist > 15:
            warnings.append("torso rotation")
            penalty += 5

        if jerk > 0.5:
            warnings.append("unstable acceleration")
            penalty += 5

        penalty = min(20, penalty)

        features = {
            "tilt": float(tilt),
            "twist": float(twist),
            "pitch_std": float(pitch_std),
            "roll_std": float(roll_std),
            "accel_std": float(accel_std),
            "jerk": float(jerk),
            "ax": float(ax),
            "ay": float(ay),
            "az": float(az)
        }

        return penalty, warnings, features

    def _push(self, arr, val):
        arr.append(val)
        if len(arr) > self.window:
            arr.pop(0)
