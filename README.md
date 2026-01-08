# PhoenixFit AI

A cross-platform fitness app built with React Native (Expo) featuring **real-time exercise rep counting** using computer vision and optional **IMU sensor integration**.

## Features

- **Vision-Based Rep Counting** – Uses Mediapipe Pose to detect and count reps for Squat, Push-up, and Deadlift
- **Form Feedback** – Real-time coaching tips based on body angles and posture
- **IMU Integration** – Connect an ESP32 + BNO055 sensor for movement metrics (peak acceleration, power output)
- **Workout Summary** – View reps, average score, duration, and IMU stats after each session
- **Progress Tracking** – Calendar-based exercise logging with streak tracking
- **Nutrition Logging** – Track meals and macros with USDA food database search

---

## Quick Start

### 1. Mobile App (Expo)

```bash
npm install
npx expo start
```

Scan the QR code with **Expo Go** on your phone.

### 2. Vision Server (Python)

```bash
cd Raunak_ML_code
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # Mac/Linux
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8000
```

### 3. Connect App to Server

1. Make sure your phone and computer are on the **same network**
2. Find your computer's IP (`ipconfig` on Windows, `ifconfig` on Mac)
3. In the app's Rep Tracking screen, tap the **settings icon** and enter: `http://YOUR_IP:8000`

---

## IMU Setup (Optional)

1. Flash the ESP32 Arduino code to your ESP32 + BNO055
2. Configure it to connect to your WiFi network
3. In the app, tap **Connect IMU** and enter the WebSocket URL (e.g., `ws://192.168.1.50:81`)

---

## Project Structure

```
CapstoneFinal/
├── src/
│   ├── screens/           # App screens (Workout, Progress, Nutrition)
│   ├── navigation/        # React Navigation setup
│   └── components/        # Reusable UI components
├── Raunak_ML_code/
│   ├── server.py          # FastAPI vision server
│   ├── requirements.txt   # Python dependencies
│   └── utils/             # ML models and angle calculations
└── package.json           # Node dependencies
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Mobile App | React Native, Expo |
| Navigation | React Navigation |
| Vision Server | FastAPI, Mediapipe, OpenCV |
| ML Scoring | scikit-learn |
| IMU Sensor | ESP32 + BNO055, WebSocket |
| Data Storage | AsyncStorage (local) |

---

## How It Works

1. **Camera captures frames** → Sent to Python server
2. **Mediapipe detects pose** → Extracts body landmarks
3. **Angle calculations** → Determines squat depth, elbow bend, etc.
4. **Phase detection** → Tracks "up" vs "down" position
5. **Rep counting** → Counts when user completes full range of motion
6. **Form scoring** → ML model rates form quality

---

## Authors

- Raunak Singh Soi – ML/Vision Code
- [Your Name] – Mobile App Development

## License

MIT License - For educational purposes.
