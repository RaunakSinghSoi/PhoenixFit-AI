# PhoenixFit AI  
Real-Time Form Analysis and Coaching System  
SYSC 4907 – Capstone Project (2025–2026)

## Overview
PhoenixFit AI is a real-time exercise feedback system designed to assist users in performing resistance-training movements with greater accuracy, safety, and consistency. The system integrates computer vision, wearable sensor data, and a mobile application to deliver immediate form-related feedback. By combining pose estimation with IMU-based motion tracking, PhoenixFit AI identifies common lifting errors, provides corrective cues, and supports progressive training.

The project focuses on three fundamental movements—squats, push-ups, and deadlifts—and evaluates user performance using joint-angle calculations, rep segmentation, depth analysis, and rule-based fault detection. Processing is performed on-device to ensure low-latency feedback suitable for real-time coaching.

## System Components

### Mobile Application (React Native)
The mobile client manages the camera feed, pose overlay visualization, real-time feedback interface, and Bluetooth Low Energy (BLE) communication with the wearable sensor. It functions as the primary interaction point for users.

### Machine Learning Pipeline
The machine learning pipeline includes pose estimation model benchmarking, angle computation, rep detection, and rule-based form evaluation. It incorporates dataset experimentation, accuracy validation, and testing routines aligned with the project requirements.

### Wearable Sensor Unit (Arduino Nano 33 BLE Sense)
The wearable device streams accelerometer and gyroscope data through BLE to enhance pose-based analysis, especially under occlusion or rapid movement. Its architecture allows future extension to EMG sensing for muscle activation monitoring.

### Database and Cloud Backend (Firebase)
The backend handles authentication, Firestore data storage, cloud functions, and progress logging. The database structure records workout metrics, historical performance, and relevant user information.

## Repository Structure

```
PhoenixFit-AI/
│
├── app/                     # Mobile application
├── ml-pipeline/             # Models, scripts, angle calculations, scoring logic
├── wearable-sensor/         # IMU firmware, BLE services, sensor code
├── database/                # Firestore schema, rules, and cloud functions
├── docs/                    # Proposal, reports, diagrams, documentation
└── testing/                 # Accuracy tests, sensor validation, latency logs
```

## Team Members and Roles

**Raunak Singh Soi - Machine Learning and Backend Integration**  
Responsible for pose model evaluation, joint-angle computation, rep detection, scoring mechanisms, and integration of sensor data with the mobile application.

**Ronin Vicars - Software Development and Hardware Integration**  
Responsible for BLE communication, IMU firmware development, hardware validation, and secondary support in machine learning and backend tasks.

**Brix Velasco - Database and Cloud Services**  
Responsible for Firestore schema design, cloud function logic, synchronization mechanisms, and database security rules.

**Yousif Muziel - Mobile Application Development**  
Responsible for the React Native application, BLE integration, user interface workflow, and pose overlay implementation.

## Documentation
All documentation, including the project proposal, diagrams, reports, and meeting records, is stored under the `docs/` directory.

## Timeline Summary
The project timeline includes initial research and proposal preparation, model and BLE evaluation, prototype development, system integration, testing phases, and final reporting in accordance with SYSC 4907 capstone requirements.

## Academic Statement
This repository is part of the Carleton University SYSC 4907 Capstone Project. All materials herein are intended solely for academic evaluation and demonstration of engineering competencies in machine learning, embedded systems, mobile development, and distributed systems.
