# raunak singh soi

import joblib
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "ml")

_CACHE = {}

def load_model(exercise):
    # model filenames
    model_file = f"{exercise}_model.joblib"
    scaler_file = f"{exercise}_scaler.joblib"

    # correct paths inside utils/ml/
    model_path = os.path.join(MODEL_DIR, model_file)
    scaler_path = os.path.join(MODEL_DIR, scaler_file)

    cache_key = (model_path, scaler_path)
    cached = _CACHE.get(cache_key)
    if cached:
        return cached

    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path)
    _CACHE[cache_key] = (model, scaler)
    return model, scaler

def predict_score(exercise, features):
    model, scaler = load_model(exercise)
    Xs = scaler.transform([features])
    return int(model.predict(Xs)[0])
