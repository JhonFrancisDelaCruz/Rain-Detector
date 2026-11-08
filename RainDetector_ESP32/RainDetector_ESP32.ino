#include <Wire.h>
#include <hd44780.h>
#include <hd44780ioClass/hd44780_I2Cexp.h>
#include <ESP32Servo.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// =================== Wi-Fi & Backend Settings ===================
const char* WIFI_SSID     = "DITO";
const char* WIFI_PASS     = "jhon12345";

// --- Switch between local (http) and cloud (https) ---
// For LOCAL testing:   use http://192.168.0.101:8000/api/rain
// For CLOUD (Railway/Render): use https://your-app.up.railway.app/api/rain
const char* SERVER_URL = "https://rain-detector-production.up.railway.app/api/rain";
const bool  USE_HTTPS  = true;

const char* API_KEY       = "ce615aac2e6ea1876efa0c544cb5ed73";     // same as RAIN_API_KEY in .env

const unsigned long HTTP_INTERVAL = 2500;          // send every 2.5 seconds
unsigned long lastHttpSend        = 0;
unsigned long lastWifiTry         = 0;
const unsigned long WIFI_RETRY_MS = 10000;

// ---------- Pins ----------
#define RAIN_SENSOR 1
#define SERVO_PIN   4
#define BUTTON_PIN  5
#define BUZZER_PIN  6
#define LED_PIN     7
#define SDA_PIN     8
#define SCL_PIN     9

// 1 = active buzzer, 0 = passive buzzer
// (if you hear nothing or only a faint click, try changing this to 0)
#define ACTIVE_BUZZER 1

// ---------- Rain levels (change from the DRY baseline, 0-4095 scale) ----------
const int LIGHT_CHANGE = 1000;
const int HEAVY_CHANGE = 2000;
const int HYST         = 150;
const unsigned long CONFIRM_MS = 2500;

// ---------- Servo sweep ----------
const int SERVO_MIN = 0;
const int SERVO_MAX = 90;
const int SERVO_STEP = 3;
const unsigned long SERVO_INTERVAL = 15;

// ---------- Levels / display states ----------
#define LV_DRY   0
#define LV_LIGHT 1
#define LV_HEAVY 2
#define SHOW_STOPPED 3

hd44780_I2Cexp lcd;
bool lcdOk = false;
byte lcdAddr = 0;                          // found by the I2C scan
unsigned long lastLcdCheck = 0;
const unsigned long LCD_CHECK_MS = 3000;
Servo myServo;

float baseline = 0;
int level = LV_DRY;
bool muted = false;
int lastShown = -1;
int peak = 0;
bool lastButton = HIGH;
unsigned long lastButtonChange = 0;
unsigned long lastPrint = 0;
unsigned long rainSince = 0;

bool servoMoving = false;
unsigned long lastServoMove = 0;
int servoAngle = 0;
int servoDir = 1;

// ---------- Buzzer ----------
#if !ACTIVE_BUZZER
  #if ESP_ARDUINO_VERSION_MAJOR >= 3
    #define TONE_WRITE(f) ledcWriteTone(BUZZER_PIN, f)
  #else
    #define TONE_WRITE(f) ledcWriteTone(0, f)
  #endif
#endif

void buzzerSetup() {
#if ACTIVE_BUZZER
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
#else
  #if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttach(BUZZER_PIN, 2000, 8);
  #else
    ledcSetup(0, 2000, 8);
    ledcAttachPin(BUZZER_PIN, 0);
  #endif
  TONE_WRITE(0);
#endif
}

void buzzerOn() {
#if ACTIVE_BUZZER
  digitalWrite(BUZZER_PIN, HIGH);
#else
  TONE_WRITE(2000);
#endif
}

void buzzerOff() {
#if ACTIVE_BUZZER
  digitalWrite(BUZZER_PIN, LOW);
#else
  TONE_WRITE(0);
#endif
}

void setAlarm(bool on) {
  digitalWrite(LED_PIN, on ? HIGH : LOW);
  if (on) buzzerOn(); else buzzerOff();
}

// Buzzer self-test at boot: 3 LONG beeps, so you can tell if it works at all
void buzzerSelfTest() {
  Serial.print("Buzzer test on GPIO ");
  Serial.print(BUZZER_PIN);
  Serial.println(ACTIVE_BUZZER ? " (ACTIVE mode)" : " (PASSIVE mode)");
  for (int i = 0; i < 3; i++) {
    buzzerOn();
    delay(400);
    buzzerOff();
    delay(250);
  }
}

// ---------- Servo ----------
void sweepServo() {
  servoMoving = true;
  if (millis() - lastServoMove < SERVO_INTERVAL) return;
  lastServoMove = millis();

  servoAngle += servoDir * SERVO_STEP;
  if (servoAngle >= SERVO_MAX) { servoAngle = SERVO_MAX; servoDir = -1; }
  if (servoAngle <= SERVO_MIN) { servoAngle = SERVO_MIN; servoDir = 1; }
  myServo.write(servoAngle);
}

void parkServo() {
  if (!servoMoving) return;
  servoMoving = false;
  servoAngle = SERVO_MIN;
  servoDir = 1;
  myServo.write(SERVO_MIN);
}

// ---------- Helpers ----------
int readRainAveraged() {
  long sum = 0;
  for (int i = 0; i < 20; i++) {
    sum += analogRead(RAIN_SENSOR);
    delay(2);
  }
  return sum / 20;
}

void scanI2C() {
  Serial.println("Scanning I2C...");
  int found = 0;
  lcdAddr = 0;
  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.print("  Found device at 0x");
      Serial.println(addr, HEX);
      if (lcdAddr == 0 && addr >= 0x20 && addr <= 0x3F) lcdAddr = addr;
      found++;
    }
  }
  if (found == 0) Serial.println("  NOTHING FOUND - check SDA/SCL wires, GND, 5V");
}

void lcdPrintLines(const char *l1, const char *l2) {
  if (!lcdOk) return;
  lcd.setCursor(0, 0);
  lcd.print(l1);
  lcd.setCursor(0, 1);
  lcd.print(l2);
}

void showState(int shown, int value, int change) {
  char line2[17];
  snprintf(line2, sizeof(line2), "V:%-4d CH:%-4d  ", value, change);

  if (shown == LV_DRY)           lcdPrintLines("STATUS: NORMAL  ", line2);
  else if (shown == LV_LIGHT)    lcdPrintLines("WARN: LIGHT RAIN", line2);
  else if (shown == LV_HEAVY)    lcdPrintLines("WARN: HEAVY RAIN", line2);
  else                           lcdPrintLines("RAIN - STOPPED  ", line2);
}

// Re-initialize the LCD if it disappears from the I2C bus (power glitch, loose wire)
void lcdHealthCheck() {
  if (lcdAddr == 0) {                       // never found: look again
    scanI2C();
    if (lcdAddr == 0) return;
  }
  Wire.beginTransmission(lcdAddr);
  bool present = (Wire.endTransmission() == 0);
  if (!present) {
    if (lcdOk) Serial.println("LCD lost from I2C bus");
    lcdOk = false;
    return;
  }
  if (!lcdOk) {                             // it is back: start it again
    if (lcd.begin(16, 2) == 0) {
      lcdOk = true;
      lcd.backlight();
      lcd.clear();
      lastShown = -1;                       // force a redraw
      Serial.println("LCD recovered");
    }
  }
}

// ---------- HTTP Backend Transmitter ----------
void sendToBackend(const char* levelStr, int value, int delta, int intensity, bool isMuted) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;

  if (USE_HTTPS) {
    // Cloud HTTPS — skip cert verification for simplicity
    static WiFiClientSecure secureClient;
    secureClient.setInsecure();
    http.begin(secureClient, SERVER_URL);
  } else {
    // Local HTTP
    static WiFiClient plainClient;
    http.begin(plainClient, SERVER_URL);
  }

  http.setTimeout(1000);                       // keep the loop responsive
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Accept", "application/json");
  http.addHeader("X-API-KEY", API_KEY);

  char jsonBuffer[180];
  snprintf(jsonBuffer, sizeof(jsonBuffer),
           "{\"level\":\"%s\",\"value\":%d,\"delta\":%d,\"intensity\":%d,\"muted\":%s}",
           levelStr, value, delta, intensity, isMuted ? "true" : "false");

  int httpCode = http.POST((uint8_t*)jsonBuffer, strlen(jsonBuffer));

  if (httpCode > 0) {
    if (httpCode != 200 && httpCode != 201) {
      Serial.print("Backend HTTP error: ");
      Serial.println(httpCode);
    }
  } else {
    Serial.print("HTTP connect error: ");
    Serial.println(http.errorToString(httpCode).c_str());
  }

  http.end();
}

// ---------- Setup ----------
void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\n=== Rain detector start ===");

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  buzzerSetup();

  analogReadResolution(12);
  analogSetPinAttenuation(RAIN_SENSOR, ADC_11db);

  // Boot test: LED on + 3 long beeps
  digitalWrite(LED_PIN, HIGH);
  buzzerSelfTest();
  digitalWrite(LED_PIN, LOW);

  // LCD first, before Wi-Fi and the servo draw power
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);                       // 100 kHz: more stable on jumper wires
  delay(300);
  scanI2C();

  int status = lcd.begin(16, 2);
  if (status) {
    Serial.print("LCD init failed, code: ");
    Serial.println(status);
  } else {
    lcdOk = true;
    Serial.println("LCD OK");
    lcd.backlight();
    lcd.clear();
    lcdPrintLines("RAIN DETECTOR   ", "Connecting WiFi ");
  }

  // Connect to Wi-Fi
  Serial.println("\nConnecting to Wi-Fi...");
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int wifiAttempts = 0;
  while (WiFi.status() != WL_CONNECTED && wifiAttempts < 30) {
    delay(500);
    Serial.print(".");
    wifiAttempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWIFI CONNECTED!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("Signal Strength: ");
    Serial.println(WiFi.RSSI());
    if (lcdOk) lcdPrintLines("WIFI CONNECTED  ", "Connection ready");
  } else {
    Serial.println("\nWIFI CONNECTION FAILED!");
    Serial.print("Final WiFi status: ");
    Serial.println(WiFi.status());
    if (lcdOk) lcdPrintLines("WIFI FAILED     ", "CHECK CONNECTION");
  }

  // Wi-Fi start-up can glitch the I2C bus / LCD: initialize the LCD again
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);
  delay(100);
  if (lcd.begin(16, 2) == 0) {
    lcdOk = true;
    lcd.backlight();
    lcd.clear();
    Serial.println("LCD re-initialized after Wi-Fi");
  }
  delay(300);                                  // let the power settle before the servo

  // Learn the dry baseline (about 2 seconds)
  Serial.println("Calibrating dry baseline - keep the sensor DRY...");
  if (lcdOk) lcdPrintLines("CALIBRATING...  ", "Keep sensor DRY ");
  long sum = 0;
  for (int i = 0; i < 100; i++) {
    sum += analogRead(RAIN_SENSOR);
    delay(20);
  }
  baseline = sum / 100.0;
  Serial.print("Dry baseline = ");
  Serial.println((int)baseline);

  if (lcdOk) lcd.clear();

  // Servo
  ESP32PWM::allocateTimer(0);
  myServo.setPeriodHertz(50);
  myServo.attach(SERVO_PIN, 500, 2400);
  myServo.write(SERVO_MIN);
}

// ---------- Loop ----------
void loop() {
  int rainValue = readRainAveraged();
  int change = abs(rainValue - (int)baseline);
  if (change > peak) peak = change;

  // Rain level with hysteresis
  int newLevel = level;
  if (level == LV_DRY) {
    if (change >= HEAVY_CHANGE)      newLevel = LV_HEAVY;
    else if (change >= LIGHT_CHANGE) newLevel = LV_LIGHT;
  } else if (level == LV_LIGHT) {
    if (change >= HEAVY_CHANGE)             newLevel = LV_HEAVY;
    else if (change < LIGHT_CHANGE - HYST)  newLevel = LV_DRY;
  } else {  // LV_HEAVY
    if (change < HEAVY_CHANGE - HYST)
      newLevel = (change < LIGHT_CHANGE - HYST) ? LV_DRY : LV_LIGHT;
  }

  // Going UP must last CONFIRM_MS; going down is immediate
  if (newLevel > level) {
    if (rainSince == 0) rainSince = millis();
    if (millis() - rainSince >= CONFIRM_MS) {
      level = newLevel;
      rainSince = 0;
    }
  } else {
    rainSince = 0;
    level = newLevel;
  }

  // While clearly dry, let the baseline follow slow drift
  if (level == LV_DRY && change < LIGHT_CHANGE / 2) {
    baseline += (rainValue - baseline) / 200.0;
  }

  // Button with debounce
  bool button = digitalRead(BUTTON_PIN);
  if (button != lastButton && millis() - lastButtonChange > 30) {
    lastButtonChange = millis();
    if (button == LOW) {
      Serial.println("Button pressed");
      if (level != LV_DRY) muted = true;
      else peak = 0;
    }
    lastButton = button;
  }

  // Dry again -> reset the stop
  if (level == LV_DRY) muted = false;

  // Outputs
  if (level == LV_DRY || muted) {
    setAlarm(false);
    parkServo();
  } else if (level == LV_HEAVY) {
    setAlarm(true);
    sweepServo();
  } else {                                     // LIGHT: blink blink ... pause
    unsigned long t = millis() % 1200;
    bool on = (t < 150) || (t >= 300 && t < 450);
    setAlarm(on);
    sweepServo();
  }

  // LCD + Serial: on change, and every 500 ms
  int shown = muted ? SHOW_STOPPED : level;
  if (shown != lastShown || millis() - lastPrint > 500) {
    lastPrint = millis();
    lastShown = shown;
    showState(shown, rainValue, change);

    Serial.print("Value: ");
    Serial.print(rainValue);
    Serial.print("  baseline: ");
    Serial.print((int)baseline);
    Serial.print("  change: ");
    Serial.print(change);
    Serial.print("  peak: ");
    Serial.print(peak);
    Serial.print("  level: ");
    Serial.println(shown == LV_DRY ? "DRY" : shown == LV_LIGHT ? "LIGHT" :
                   shown == LV_HEAVY ? "HEAVY" : "STOPPED");
  }

  // ---------- LCD health check ----------
  if (millis() - lastLcdCheck >= LCD_CHECK_MS) {
    lastLcdCheck = millis();
    lcdHealthCheck();
  }

  // ---------- Wi-Fi auto-reconnect ----------
  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiTry >= WIFI_RETRY_MS) {
    lastWifiTry = millis();
    Serial.println("Wi-Fi lost, reconnecting...");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }

  // ---------- Send data to backend every 2.5s ----------
  if (millis() - lastHttpSend >= HTTP_INTERVAL) {
    lastHttpSend = millis();

    const char* levelStr = (shown == LV_DRY) ? "DRY" :
                           (shown == LV_LIGHT) ? "LIGHT" :
                           (shown == LV_HEAVY) ? "HEAVY" : "STOPPED";

    int intensity = (change * 100) / HEAVY_CHANGE;
    if (intensity > 100) intensity = 100;
    if (intensity < 0)   intensity = 0;

    sendToBackend(levelStr, rainValue, change, intensity, muted);
  }

  delay(5);
}