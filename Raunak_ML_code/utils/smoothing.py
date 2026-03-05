# Author: Raunak Singh Soi
# PhoenixFit – Simple Smoothing Utilities

import numpy as np
from collections import deque

class RollingMean:
    """Keeps a rolling window of N values and returns mean."""
    def __init__(self, size=5):
        self.size = size
        self.buffer = deque(maxlen=size)

    def update(self, value):
        self.buffer.append(value)
        return np.mean(self.buffer)

class SmootherDict:
    """Handles multiple named smoothers (e.g., angles)."""
    def __init__(self, size=5):
        self.size = size
        self.map = {}

    def update(self, data_dict):
        out = {}
        for k, v in data_dict.items():
            # Allow missing/invalid values without crashing (common when pose is partial).
            if v is None:
                out[k] = None
                continue
            try:
                if isinstance(v, (float, int)) and (not np.isfinite(v)):
                    out[k] = None
                    continue
            except Exception:
                pass
            if k not in self.map:
                self.map[k] = RollingMean(self.size)
            out[k] = self.map[k].update(v)
        return out
