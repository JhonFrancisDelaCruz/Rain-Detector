<?php
/**
 * Standalone Rain Detector API Server & Live Web Dashboard
 * Runs with PHP built-in server: php -S 0.0.0.0:8000 server.php
 * Fully compatible with Laravel's RainController and SensorReading schema.
 */

// Handle CORS for Mobile App and external clients
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-KEY, Authorization, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// Load API Key from .env if present
$apiKey = 'ce615aac2e6ea1876efa0c544cb5ed73';
$envFile = __DIR__ . '/.env';
if (file_exists($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (str_starts_with(trim($line), 'RAIN_API_KEY=')) {
            $apiKey = trim(substr(trim($line), strlen('RAIN_API_KEY=')));
            break;
        }
    }
}

// Database setup: SQLite
$dbDir = __DIR__ . '/database';
$primaryDb = $dbDir . '/database.sqlite';
$fallbackDb = sys_get_temp_dir() . '/rain_detector.sqlite';

$pdo = null;
$dbErrors = [];

foreach ([$primaryDb, $fallbackDb, ':memory:'] as $candidate) {
    try {
        $p = new PDO("sqlite:" . $candidate);
        $p->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        // Create table matching migration
        $p->exec("CREATE TABLE IF NOT EXISTS sensor_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level TEXT NOT NULL,
            value INTEGER NOT NULL,
            delta INTEGER NOT NULL,
            intensity INTEGER NOT NULL,
            muted INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )");
        $pdo = $p;
        break;
    } catch (Exception $e) {
        $dbErrors[] = $candidate . ': ' . $e->getMessage();
    }
}

if (!$pdo) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Database initialization failed', 'details' => $dbErrors]);
    exit;
}

// Route: GET /api/health
if ($uri === '/api/health') {
    header('Content-Type: application/json');
    echo json_encode([
        'status' => 'ok',
        'service' => 'Rain Detector API Server',
        'version' => '1.0.0',
        'time' => gmdate('Y-m-d\TH:i:s\Z')
    ]);
    exit;
}

// Route: POST /api/rain (ESP32 calls this)
if ($uri === '/api/rain' && $method === 'POST') {
    header('Content-Type: application/json');

    $incomingKey = $_SERVER['HTTP_X_API_KEY'] ?? '';
    if (!hash_equals($apiKey, (string)$incomingKey)) {
        http_response_code(401);
        file_put_contents('php://stderr', sprintf("[%s] ❌ REJECTED POST /api/rain: Invalid or missing X-API-KEY\n", date('H:i:s')));
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }

    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);

    if (!is_array($data)) {
        http_response_code(422);
        file_put_contents('php://stderr', sprintf("[%s] ❌ REJECTED POST /api/rain: Invalid JSON body\n", date('H:i:s')));
        echo json_encode(['error' => 'Invalid JSON payload']);
        exit;
    }

    $level = $data['level'] ?? null;
    $value = $data['value'] ?? null;
    $delta = $data['delta'] ?? null;
    $intensity = $data['intensity'] ?? null;
    $muted = isset($data['muted']) ? (bool)$data['muted'] : false;

    $validLevels = ['DRY', 'LIGHT', 'HEAVY', 'STOPPED'];
    if (!in_array($level, $validLevels, true) ||
        !is_numeric($value) ||
        !is_numeric($delta) ||
        !is_numeric($intensity) ||
        $intensity < 0 || $intensity > 100) {
        http_response_code(422);
        file_put_contents('php://stderr', sprintf("[%s] ❌ REJECTED POST /api/rain: Validation failed\n", date('H:i:s')));
        echo json_encode(['error' => 'Validation failed']);
        exit;
    }

    $now = gmdate('Y-m-d\TH:i:s\Z');
    $stmt = $pdo->prepare("INSERT INTO sensor_readings (level, value, delta, intensity, muted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([$level, (int)$value, (int)$delta, (int)$intensity, $muted ? 1 : 0, $now, $now]);

    // Print friendly log to server terminal
    file_put_contents('php://stderr', sprintf(
        "[%s] 🌧️ SENSOR DATA RECEIVED -> Level: %-7s | Value: %4d | Delta: %4d | Intensity: %3d%% | Muted: %s\n",
        date('H:i:s'), $level, $value, $delta, $intensity, $muted ? 'YES' : 'NO'
    ));

    http_response_code(201);
    echo json_encode(['ok' => true]);
    exit;
}

// Route: GET /api/rain/latest (Called by Mobile App and Web UI)
if ($uri === '/api/rain/latest' && $method === 'GET') {
    header('Content-Type: application/json');

    $stmt = $pdo->query("SELECT * FROM sensor_readings ORDER BY id DESC LIMIT 1");
    $r = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$r) {
        echo json_encode(['online' => false]);
        exit;
    }

    $createdAt = strtotime($r['created_at']);
    $isOnline = (time() - $createdAt) <= 10;

    echo json_encode([
        'level'     => (string)$r['level'],
        'value'     => (int)$r['value'],
        'delta'     => (int)$r['delta'],
        'intensity' => (int)$r['intensity'],
        'muted'     => (bool)$r['muted'],
        'updated'   => (string)$r['created_at'],
        'online'    => $isOnline,
    ]);
    exit;
}

// Route: GET /api/rain/history (Returns latest 10 readings for chart/log)
if ($uri === '/api/rain/history' && $method === 'GET') {
    header('Content-Type: application/json');

    $stmt = $pdo->query("SELECT * FROM sensor_readings ORDER BY id DESC LIMIT 10");
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode(array_map(function($r) {
        return [
            'id'        => (int)$r['id'],
            'level'     => (string)$r['level'],
            'value'     => (int)$r['value'],
            'delta'     => (int)$r['delta'],
            'intensity' => (int)$r['intensity'],
            'muted'     => (bool)$r['muted'],
            'time'      => (string)$r['created_at'],
        ];
    }, $rows));
    exit;
}

// Route: POST /api/rain/simulate (Allows testing without ESP32)
if ($uri === '/api/rain/simulate' && ($method === 'POST' || $method === 'GET')) {
    header('Content-Type: application/json');

    $levels = ['DRY', 'LIGHT', 'HEAVY', 'STOPPED'];
    $randLevel = $levels[array_rand($levels)];
    $intensityMap = [
        'DRY' => rand(0, 10),
        'LIGHT' => rand(25, 50),
        'HEAVY' => rand(65, 100),
        'STOPPED' => rand(5, 15),
    ];
    $intensity = $intensityMap[$randLevel];
    $now = gmdate('Y-m-d\TH:i:s\Z');

    $stmt = $pdo->prepare("INSERT INTO sensor_readings (level, value, delta, intensity, muted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([
        $randLevel,
        rand(1500, 3500),
        rand(50, 750),
        $intensity,
        0,
        $now,
        $now
    ]);

    echo json_encode([
        'ok' => true,
        'simulated' => [
            'level' => $randLevel,
            'intensity' => $intensity,
            'updated' => $now,
            'online' => true,
        ]
    ]);
    exit;
}

// Route: GET / -> Renders Live Web UI Dashboard matching Mobile App
if ($uri === '/' || $uri === '/index.html' || $uri === '/dashboard') {
    header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rain Detector - Live IoT Monitor</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        body { background-color: #121316; color: #FFFFFF; min-height: 100vh; display: flex; flex-direction: column; }
        .app-container { max-width: 480px; width: 100%; margin: 0 auto; padding: 20px 16px 80px 16px; flex: 1; }
        
        /* Header */
        .top-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .header-title { font-size: 22px; font-weight: 700; color: #FFFFFF; letter-spacing: 0.2px; }
        .header-subtitle { font-size: 12px; color: #8E8E93; margin-top: 2px; }
        .test-btn { background: rgba(0, 163, 255, 0.12); border: 1px solid rgba(0, 163, 255, 0.35); color: #00A3FF; font-weight: 600; font-size: 13px; padding: 6px 12px; border-radius: 8px; cursor: pointer; transition: all 0.2s; }
        .test-btn:hover { background: rgba(0, 163, 255, 0.25); }

        /* Banner */
        .banner { display: flex; justify-content: space-between; align-items: center; border-radius: 10px; padding: 10px 14px; margin-bottom: 16px; font-size: 12px; border: 1px solid #26282E; background: #1A1B1F; }
        .banner.online { background: rgba(0, 230, 118, 0.08); border-color: rgba(0, 230, 118, 0.25); }
        .banner.offline { background: rgba(239, 68, 68, 0.08); border-color: rgba(239, 68, 68, 0.25); }
        .banner-left { display: flex; align-items: center; gap: 8px; font-weight: 500; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #9CA3AF; }
        .dot.online { background: #00E676; box-shadow: 0 0 8px #00E676; }
        .dot.offline { background: #EF4444; }
        .banner-host { color: #9CA3AF; font-size: 11px; }

        /* LIGHT RAIN WARNING BANNER */
        .light-alert { display: none; background: rgba(251, 191, 36, 0.12); border: 1.5px solid #FBBF24; border-radius: 12px; padding: 14px; margin-bottom: 16px; align-items: center; gap: 12px; }
        .light-alert.active { display: flex; }
        .light-alert-icon { font-size: 26px; }
        .light-alert-title { font-size: 13px; font-weight: 700; color: #FBBF24; letter-spacing: 0.2px; }
        .light-alert-sub { font-size: 12px; color: #E5E7EB; margin-top: 2px; line-height: 1.4; }

        /* HEAVY RAIN PHONE RINGING BANNER */
        .heavy-alert { display: none; background: rgba(239, 68, 68, 0.22); border: 2px solid #EF4444; border-radius: 14px; padding: 16px; margin-bottom: 16px; animation: siren-pulse 0.8s infinite alternate; }
        .heavy-alert.active { display: block; }
        @keyframes siren-pulse { 0% { box-shadow: 0 0 10px rgba(239, 68, 68, 0.4); border-color: #EF4444; } 100% { box-shadow: 0 0 25px rgba(239, 68, 68, 0.9); border-color: #FF8080; } }
        .heavy-alert-top { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .heavy-bell-circle { width: 44px; height: 44px; border-radius: 50%; background: #EF4444; display: flex; align-items: center; justify-content: center; font-size: 22px; animation: ring-wiggle 0.5s infinite; }
        @keyframes ring-wiggle { 0% { transform: rotate(0); } 25% { transform: rotate(-15deg); } 75% { transform: rotate(15deg); } 100% { transform: rotate(0); } }
        .heavy-alert-title { font-size: 14px; font-weight: 800; color: #EF4444; letter-spacing: 0.2px; }
        .heavy-alert-sub { font-size: 12px; color: #FEE2E2; margin-top: 2px; font-weight: 600; }
        .silence-btn { width: 100%; background: #DC2626; color: #FFFFFF; border: none; padding: 10px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; transition: background 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .silence-btn:hover { background: #B91C1C; }

        /* Weather Status Hero Card */
        .weather-card { background: #1A1B1F; border-radius: 16px; border: 1px solid #26282E; padding: 22px 20px; margin-bottom: 16px; }
        .weather-card-title { font-size: 14px; font-weight: 600; color: #9CA3AF; text-transform: uppercase; letter-spacing: 0.5px; }
        .weather-value { font-size: 32px; font-weight: 800; color: #00E676; margin: 8px 0 6px 0; letter-spacing: 0.5px; transition: color 0.3s; }
        .divider { height: 1px; background: #26282E; margin: 14px 0; }
        .weather-sub { font-size: 13px; color: #9CA3AF; }

        /* 2x2 Grid */
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
        .stat-card { background: #1E1F24; border-radius: 16px; border: 1px solid #26282E; padding: 16px; display: flex; flex-direction: column; justify-content: space-between; min-height: 135px; }
        .stat-icon { font-size: 22px; margin-bottom: 10px; }
        .stat-label { font-size: 12px; color: #8E8E93; margin-bottom: 4px; }
        .stat-value { font-size: 19px; font-weight: 700; color: #FFFFFF; }
        .stat-sub { font-size: 11px; color: #6B7280; margin-top: 4px; }

        /* Gauge Card */
        .gauge-card { background: #1A1B1F; border-radius: 16px; border: 1px solid #26282E; padding: 20px; margin-bottom: 16px; }
        .gauge-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
        .gauge-title { font-size: 17px; font-weight: 700; color: #FFFFFF; }
        .gauge-subtitle { font-size: 13px; color: #8E8E93; margin-top: 2px; }
        .gauge-percent { font-size: 22px; font-weight: 700; color: #00A3FF; }
        .progress-track { height: 12px; border-radius: 6px; background: #2A2C32; overflow: hidden; margin: 10px 0 14px 0; }
        .progress-fill { height: 100%; border-radius: 6px; background: #00E676; width: 0%; transition: width 0.4s ease, background-color 0.4s ease; }
        .raw-row { display: flex; justify-content: space-between; padding-top: 12px; border-top: 1px solid #26282E; font-size: 11px; color: #8E8E93; }
        .raw-row strong { color: #E5E7EB; }
        .disclaimer { font-size: 11px; color: #6B7280; margin-top: 10px; line-height: 1.4; }

        /* History Table */
        .history-card { background: #1A1B1F; border-radius: 16px; border: 1px solid #26282E; padding: 18px; margin-bottom: 16px; }
        .history-title { font-size: 14px; font-weight: 600; color: #9CA3AF; margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { text-align: left; color: #8E8E93; padding: 6px 4px; border-bottom: 1px solid #26282E; font-weight: 500; }
        td { padding: 8px 4px; border-bottom: 1px solid #1E1F24; color: #D1D5DB; }
        .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 10px; }
        .badge-HEAVY { background: rgba(239, 68, 68, 0.2); color: #EF4444; }
        .badge-LIGHT { background: rgba(0, 163, 255, 0.2); color: #00A3FF; }
        .badge-DRY { background: rgba(0, 230, 118, 0.2); color: #00E676; }
        .badge-STOPPED { background: rgba(251, 191, 36, 0.2); color: #FBBF24; }

        /* Footer */
        .footer { position: fixed; bottom: 0; left: 0; right: 0; background: #090A0C; border-top: 1px solid #1A1B1F; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #8E8E93; z-index: 100; }
        .pulse-live { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #00E676; margin-right: 6px; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.3; transform: scale(0.85); } 100% { opacity: 1; transform: scale(1); } }
    </style>
</head>
<body>
    <div class="app-container">
        <!-- Header -->
        <div class="top-header">
            <div>
                <h1 class="header-title">Rain Detector</h1>
                <p class="header-subtitle">Live IoT Web Dashboard</p>
            </div>

        </div>

        <!-- LIGHT RAIN WARNING BANNER -->
        <div class="light-alert" id="lightAlert">
            <div class="light-alert-icon">⚠️</div>
            <div>
                <div class="light-alert-title">WARNING: LIGHT RAIN DETECTED!</div>
                <div class="light-alert-sub">Precipitation has begun. Close windows and bring in hanging items.</div>
            </div>
        </div>

        <!-- HEAVY RAIN EMERGENCY RINGING BANNER -->
        <div class="heavy-alert" id="heavyAlert">
            <div class="heavy-alert-top">
                <div class="heavy-bell-circle">🔔</div>
                <div>
                    <div class="heavy-alert-title">🚨 EMERGENCY: HEAVY RAIN DETECTED!</div>
                    <div class="heavy-alert-sub" id="heavyAlertSub">🔊 BROWSER ALARM RINGING NOW!</div>
                </div>
            </div>
            <button class="silence-btn" id="silenceBtn" onclick="silenceAlarm()">🔇 Silence Alarm</button>
        </div>

        <!-- Weather Status Hero Card -->
        <div class="weather-card">
            <div class="weather-card-title">Current Weather Status</div>
            <div class="weather-value" id="weatherValue">NORMAL / DRY</div>
            <div class="divider"></div>
            <div class="weather-sub" id="weatherSub">Waiting for sensor data...</div>
        </div>

        <!-- 2x2 Grid -->
        <div class="grid">
            <!-- Rain Intensity -->
            <div class="stat-card">
                <div>
                    <div class="stat-icon">💧</div>
                    <div class="stat-label">Rain Intensity</div>
                    <div class="stat-value" id="intensityText">0%</div>
                </div>
                <div class="stat-sub" id="intensitySub">Clear / Dry</div>
            </div>

            <!-- Sensor Status -->
            <div class="stat-card">
                <div>
                    <div class="stat-icon" id="sensorIcon">📡</div>
                    <div class="stat-label">Sensor Status</div>
                    <div class="stat-value" id="sensorValue">Active</div>
                </div>
                <div class="stat-sub" id="sensorSub">ESP32 transmitting</div>
            </div>

            <!-- Last Updated -->
            <div class="stat-card">
                <div>
                    <div class="stat-icon">🕒</div>
                    <div class="stat-label">Last Updated</div>
                    <div class="stat-value" id="updatedText">--:--</div>
                </div>
                <div class="stat-sub" id="updatedSub">Auto polling 1.5s</div>
            </div>

            <!-- Connection -->
            <div class="stat-card">
                <div>
                    <div class="stat-icon">📶</div>
                    <div class="stat-label">Connection</div>
                    <div class="stat-value" id="connText">Connected</div>
                </div>
                <div class="stat-sub">Live monitoring</div>
            </div>
        </div>

        <!-- Gauge Card -->
        <div class="gauge-card">
            <div class="gauge-header">
                <div>
                    <div class="gauge-title">Rain Detector Gauge</div>
                    <div class="gauge-subtitle">Current intensity reading</div>
                </div>
                <div class="gauge-percent" id="gaugePercent">0%</div>
            </div>

            <div class="progress-track">
                <div class="progress-fill" id="progressFill"></div>
            </div>

            <div class="raw-row">
                <span>ADC Value: <strong id="rawAdc">--</strong></span>
                <span>Delta: <strong id="rawDelta">--</strong></span>
                <span>Buzzer: <strong id="rawMuted">Unmuted</strong></span>
            </div>

            <p class="disclaimer">
                Illustrative intensity indicator computed from ESP32 moisture delta.
            </p>
        </div>


    </div>

    <!-- Pinned Footer -->
    <div class="footer">
        <span>Device: ESP32-S3</span>
        <div>
            <span class="pulse-live"></span>
            <span>Live stream active</span>
        </div>
    </div>

    <script>
        async function fetchLatest() {
            try {
                const res = await fetch('/api/rain/latest');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                updateUI(data);
                document.getElementById('connText').innerText = 'Connected';
                document.getElementById('connText').style.color = '#00E676';
            } catch (err) {
                document.getElementById('connText').innerText = 'Offline';
                document.getElementById('connText').style.color = '#EF4444';
            }
        }

        function updateUI(data) {
            const valEl = document.getElementById('weatherValue');
            const subEl = document.getElementById('weatherSub');
            const intText = document.getElementById('intensityText');
            const intSub = document.getElementById('intensitySub');
            const sensorVal = document.getElementById('sensorValue');
            const sensorSub = document.getElementById('sensorSub');
            const updatedText = document.getElementById('updatedText');
            const progressFill = document.getElementById('progressFill');
            const gaugePercent = document.getElementById('gaugePercent');
            const rawAdc = document.getElementById('rawAdc');
            const rawDelta = document.getElementById('rawDelta');
            const rawMuted = document.getElementById('rawMuted');

            if (!data || data.level === undefined) {
                valEl.innerText = data && data.online === false ? 'SENSOR OFFLINE' : 'WAITING FOR DATA';
                valEl.style.color = '#9CA3AF';
                subEl.innerText = 'No readings received in last 10s';
                sensorVal.innerText = 'Offline';
                sensorVal.style.color = '#9CA3AF';
                sensorSub.innerText = 'Waiting for ESP32';
                return;
            }

            const intensity = Math.min(100, Math.max(0, data.intensity || 0));
            intText.innerText = intensity + '%';
            gaugePercent.innerText = intensity + '%';
            progressFill.style.width = intensity + '%';

            if (intensity > 60) {
                progressFill.style.backgroundColor = '#EF4444';
            } else if (intensity > 20) {
                progressFill.style.backgroundColor = '#00A3FF';
            } else {
                progressFill.style.backgroundColor = '#00E676';
            }

            // Sensor online / offline status
            if (data.online) {
                sensorVal.innerText = 'Active';
                sensorVal.style.color = '#00E676';
                sensorSub.innerText = 'ESP32 transmitting';
            } else {
                sensorVal.innerText = 'Offline';
                sensorVal.style.color = '#9CA3AF';
                sensorSub.innerText = 'No signal in 10s';
            }

            // Weather status formatting
            switch (data.level) {
                case 'HEAVY':
                    valEl.innerText = 'HEAVY RAIN';
                    valEl.style.color = '#EF4444';
                    subEl.innerText = 'Heavy precipitation detected by sensor';
                    intSub.innerText = 'Heavy Rain';
                    break;
                case 'LIGHT':
                    valEl.innerText = 'LIGHT RAIN';
                    valEl.style.color = '#00A3FF';
                    subEl.innerText = 'Light rainfall detected by sensor';
                    intSub.innerText = 'Light Rain';
                    break;
                case 'STOPPED':
                    valEl.innerText = 'RAIN STOPPED';
                    valEl.style.color = '#FBBF24';
                    subEl.innerText = 'Sensor surface is drying';
                    intSub.innerText = 'Drying Off';
                    break;
                case 'DRY':
                default:
                    valEl.innerText = 'NORMAL / DRY';
                    valEl.style.color = '#00E676';
                    subEl.innerText = 'No rain detected by sensor';
                    intSub.innerText = 'Clear / Dry';
                    break;
            }

            // Raw data
            rawAdc.innerText = data.value !== undefined ? data.value : '--';
            rawDelta.innerText = data.delta !== undefined ? data.delta : '--';
            rawMuted.innerText = data.muted ? 'Muted' : 'Sound ON';

            if (data.updated) {
                const d = new Date(data.updated);
                updatedText.innerText = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            }

            showAlerts(data.level);
        }

        // ---- Alert Banners & Browser Alarm ----
        let audioCtx = null;
        let alarmInterval = null;
        let alarmSilenced = false;

        function showAlerts(level) {
            const lightEl = document.getElementById('lightAlert');
            const heavyEl = document.getElementById('heavyAlert');
            if (lightEl) lightEl.className = level === 'LIGHT' ? 'light-alert active' : 'light-alert';
            if (heavyEl) heavyEl.className = level === 'HEAVY' ? 'heavy-alert active' : 'heavy-alert';

            if (level === 'HEAVY' && !alarmSilenced) {
                startBrowserAlarm();
            } else if (level !== 'HEAVY') {
                stopBrowserAlarm();
                alarmSilenced = false;
                const sub = document.getElementById('heavyAlertSub');
                const btn = document.getElementById('silenceBtn');
                if (sub) sub.innerText = '🔊 BROWSER ALARM RINGING NOW!';
                if (btn) btn.innerText = '🔇 Silence Alarm';
            }
        }

        function startBrowserAlarm() {
            if (alarmInterval) return;
            try {
                if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                if (audioCtx.state === 'suspended') audioCtx.resume();
                playAlarmBurst();
                alarmInterval = setInterval(playAlarmBurst, 3000);
            } catch(e) {}
        }

        function playAlarmBurst() {
            if (!audioCtx || alarmSilenced) return;
            const now = audioCtx.currentTime;
            [0, 1.2].forEach(function(offset) {
                const o1 = audioCtx.createOscillator();
                const o2 = audioCtx.createOscillator();
                const g  = audioCtx.createGain();
                o1.frequency.value = 440;
                o2.frequency.value = 480;
                g.gain.setValueAtTime(0, now + offset);
                g.gain.linearRampToValueAtTime(0.4, now + offset + 0.05);
                g.gain.setValueAtTime(0.4, now + offset + 0.75);
                g.gain.linearRampToValueAtTime(0, now + offset + 0.8);
                o1.connect(g); o2.connect(g); g.connect(audioCtx.destination);
                o1.start(now + offset); o1.stop(now + offset + 0.8);
                o2.start(now + offset); o2.stop(now + offset + 0.8);
            });
        }

        function stopBrowserAlarm() {
            if (alarmInterval) { clearInterval(alarmInterval); alarmInterval = null; }
        }

        function silenceAlarm() {
            alarmSilenced = true;
            stopBrowserAlarm();
            const sub = document.getElementById('heavyAlertSub');
            const btn = document.getElementById('silenceBtn');
            if (sub) sub.innerText = '🔇 Alarm silenced';
            if (btn) btn.innerText = '✓ Silenced';
        }

        // Auto poll every 1.5 seconds
        fetchLatest();
        setInterval(fetchLatest, 1500);
    </script>
</body>
</html>
<?php
    exit;
}

// 404 for unknown routes
http_response_code(404);
header('Content-Type: application/json');
echo json_encode(['error' => 'Endpoint not found: ' . $uri]);
