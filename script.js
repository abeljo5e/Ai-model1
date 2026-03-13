import {
    GestureRecognizer,
    FaceLandmarker,
    FilesetResolver,
    DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

// DOM Elements
const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const enableWebcamButton = document.getElementById("webcamButton");
const feedOverlay = document.getElementById("feedOverlay");
const connectionStatus = document.getElementById("connection-status");
const statusText = document.getElementById("status-text");
const gestureOutput = document.getElementById("gesture-output");
const gestureConfidence = document.getElementById("gesture-confidence");
const faceOutput = document.getElementById("face-output");
const armAction = document.getElementById("arm-action");
const commandLog = document.getElementById("command-log");

// State flags
let gestureRecognizer;
let faceLandmarker;
let runningMode = "VIDEO";
let webcamRunning = false;
let lastVideoTime = -1;

// Logging utility
function logCommand(msg, type = 'system') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });
    entry.textContent = `[${time}] ${msg}`;
    commandLog.appendChild(entry);
    commandLog.scrollTop = commandLog.scrollHeight;
}

// Map gestures to robotic arm actions
const gestureMap = {
    "None": "IDLE",
    "Closed_Fist": "GRAB",
    "Open_Palm": "RELEASE",
    "Pointing_Up": "UP",
    "Thumb_Down": "DOWN",
    "Thumb_Up": "ACKNOWLEDGE",
    "Victory": "READY",
    "ILoveYou": "CALIBRATE"
};

let lastCommand = "";

window.manualCommand = function(action) {
    if (action !== "IDLE") {
        armAction.textContent = action;
        armAction.className = "badge active";
        logCommand(`Manual Override: ${action}`, "action");
        lastCommand = action;
    }
};

// Intialize MediaPipe Models
async function initializeModels() {
    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );

        // Load Gesture Recognizer
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
                delegate: "CPU"
            },
            runningMode: runningMode,
            numHands: 1 // Reduced from 2 to save compute
        });
        logCommand("Gesture Recognizer Loaded", 'system');

        // Load Face Landmarker
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                delegate: "CPU"
            },
            outputFaceBlendshapes: false, // Disabled to save massive compute
            outputFacialTransformationMatrixes: false,
            runningMode: runningMode,
            numFaces: 1
        });
        logCommand("Face Landmarker Loaded", 'system');

        // Enable UI
        connectionStatus.className = "status-indicator success";
        statusText.textContent = "System Ready";
        enableWebcamButton.classList.remove("disabled");
        enableWebcamButton.disabled = false;
        
    } catch (error) {
        connectionStatus.className = "status-indicator danger";
        statusText.textContent = "Model Load Failed";
        logCommand(`Error: ${error.message}`, 'warn');
        console.error(error);
    }
}

// Call on startup
initializeModels();

// Enable the camera
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    enableWebcamButton.addEventListener("click", enableCam);
} else {
    console.warn("getUserMedia() is not supported by your browser");
    logCommand("Camera API not supported", "warn");
}

function enableCam() {
    if (!gestureRecognizer || !faceLandmarker) {
        logCommand("Wait for models to load", "warn");
        return;
    }

    if (webcamRunning === true) {
        webcamRunning = false;
        enableWebcamButton.innerHTML = `<i class="fa-solid fa-video"></i> Start Camera`;
        video.srcObject.getTracks().forEach(track => track.stop());
        feedOverlay.style.display = 'flex';
        video.style.display = 'none';
        logCommand("Camera Offline", "system");
        
        // Clear canvas
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        
        // Reset UI
        gestureOutput.textContent = "None";
        faceOutput.textContent = "No Face";
        armAction.textContent = "IDLE";
        armAction.className = "badge";
    } else {
        webcamRunning = true;
        enableWebcamButton.innerHTML = `<i class="fa-solid fa-video-slash"></i> Stop Camera`;
        
        const constraints = {
            video: true
        };

        navigator.mediaDevices.getUserMedia(constraints)
        .then((stream) => {
            video.srcObject = stream;
            video.style.display = 'block';
            feedOverlay.style.display = 'none';
            video.play().catch(e => logCommand("Play err: " + e.message, "warn"));
            video.addEventListener("loadeddata", predictWebcam);
            logCommand("Camera Livestream Active", "system");
        })
        .catch((err) => {
            console.error("Camera access failed:", err);
            logCommand("Camera Error: " + err.message, "danger");
            webcamRunning = false;
            enableWebcamButton.innerHTML = `<i class="fa-solid fa-video"></i> Start Camera`;
            statusText.textContent = "Camera Blocked";
            connectionStatus.className = "status-indicator danger";
        });
    }
}

async function predictWebcam() {
    // Canvas sizing to match video
    if (canvasElement.width !== video.videoWidth) {
        canvasElement.width = video.videoWidth;
        canvasElement.height = video.videoHeight;
    }

    let startTimeMs = performance.now();
    
    // Process frames if we have new video data
    if (lastVideoTime !== video.currentTime && webcamRunning) {
        lastVideoTime = video.currentTime;
        
        const gestureResults = gestureRecognizer.recognizeForVideo(video, startTimeMs);
        const faceResults = faceLandmarker.detectForVideo(video, startTimeMs);

        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        const drawingUtils = new DrawingUtils(canvasCtx);

        // Draw and handle Face Results
        if (faceResults.faceLandmarks.length > 0) {
            faceOutput.textContent = "Detected";
            for (const landmarks of faceResults.faceLandmarks) {
                drawingUtils.drawConnectors(
                    landmarks,
                    FaceLandmarker.FACE_LANDMARKS_TESSELATION,
                    { color: "#C0C0C070", lineWidth: 1 }
                );
                drawingUtils.drawConnectors(
                    landmarks,
                    FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
                    { color: "#00f0ff" }
                );
                drawingUtils.drawConnectors(
                    landmarks,
                    FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
                    { color: "#00f0ff" }
                );
                drawingUtils.drawConnectors(
                    landmarks,
                    FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
                    { color: "#7000ff", lineWidth: 2 }
                );
            }
        } else {
            faceOutput.textContent = "No Face";
        }

        // Draw and handle Hand Gestures
        if (gestureResults.gestures.length > 0) {
            const gesture = gestureResults.gestures[0][0]; // Primary hand, top gesture prediction
            const categoryName = gesture.categoryName;
            const score = parseFloat((gesture.score * 100).toFixed(1));
            
            gestureOutput.textContent = categoryName;
            gestureConfidence.textContent = `Confidence: ${score}%`;
            
            // Map to arm action
            const action = gestureMap[categoryName] || "UNKNOWN";
            armAction.textContent = action;
            if (action !== "IDLE" && action !== "UNKNOWN") {
                armAction.className = "badge active";
                
                // Only log if command changes to avoid spam
                if(lastCommand !== action) {
                    logCommand(`Executing: ${action}`, "action");
                    lastCommand = action;
                }
            } else {
                armAction.className = "badge";
                if(lastCommand !== "IDLE") {
                    logCommand("Returning to IDLE", "system");
                    lastCommand = "IDLE";
                }
            }

            // Draw hand connections
            for (const landmarks of gestureResults.landmarks) {
                drawingUtils.drawConnectors(
                    landmarks,
                    GestureRecognizer.HAND_CONNECTIONS,
                    { color: "#00ff88", lineWidth: 3 }
                );
                drawingUtils.drawLandmarks(landmarks, {
                    color: "#ffffff",
                    lineWidth: 1,
                    radius: 4
                });
            }
        } else {
            gestureOutput.textContent = "None";
            gestureConfidence.textContent = "Confidence: 0%";
            armAction.textContent = "IDLE";
            armAction.className = "badge";
            
            if(lastCommand !== "IDLE") {
                logCommand("Returning to IDLE", "system");
                lastCommand = "IDLE";
            }
        }
        canvasCtx.restore();
    }

    // Call this function again to keep predicting
    if (webcamRunning === true) {
        window.requestAnimationFrame(predictWebcam);
    }
}
