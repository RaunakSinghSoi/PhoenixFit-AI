import os
import pickle
import numpy as np

# Load model relative to this file so imports work from any working directory.
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_MODEL_PATH = os.path.join(_BASE_DIR, "..", "phoenixfit_model.pkl")
with open(_MODEL_PATH, "rb") as f:
    model = pickle.load(f)

def prepare_vector(landmarks):
    vec = []
    for p in landmarks:
        vec.extend([p.x, p.y, p.z, p.visibility])
    return np.array(vec)

def predict_exercise(landmarks):
    vec = prepare_vector(landmarks).reshape(1, -1)
    return model.predict(vec)[0]
