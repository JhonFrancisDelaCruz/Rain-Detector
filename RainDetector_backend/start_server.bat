@echo off
echo ====================================================
echo Starting Rain Detector Backend API Server
echo ====================================================
echo Available endpoints:
echo   GET  /api/health       - Health check
echo   GET  /api/rain/latest  - Latest sensor reading (used by Mobile App)
echo   POST /api/rain         - Push sensor reading (used by ESP32)
echo   POST /api/rain/simulate- Generate simulated reading for testing
echo.
echo Server running at:
echo   Local:   http://localhost:8000
echo   Network: http://192.168.0.101:8000
echo ====================================================
php -S 0.0.0.0:8000 server.php
pause
