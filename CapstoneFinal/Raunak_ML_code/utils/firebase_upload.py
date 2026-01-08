# firebase_upload.py
# PhoenixFit – Firebase Realtime Database Uploader (Auto Upload Version)
# Author: Raunak Singh Soi

import time
import json
import requests

DATABASE_URL = "https://pheonix-dabdc-default-rtdb.firebaseio.com"
USER_ID = "test_user"  # replace with actual user id

def upload_set_results(summary: dict, exercise="squat"):
    timestamp = int(time.time())
    path = f"/workouts/{USER_ID}/{exercise}/{timestamp}.json"
    url = DATABASE_URL + path

    try:
        res = requests.put(url, json=summary)
        if res.status_code == 200:
            print("🔥 Firebase upload successful.")
        else:
            print("⚠️ Firebase upload failed:", res.text)
    except Exception as e:
        print("❌ Firebase Error:", e)
