// ============================================================
// ESP32_SucoAir.ino — Kode Arduino untuk ESP32
// Kirim data sensor ke backend via HTTP POST
//
// Hardware yang digunakan (sesuai proposal):
//   - ESP32 DevKitC V4
//   - PMS5003  → PM2.5 & PM10 (Serial2)
//   - MQ-7     → CO   (ADS1115 ch0)
//   - MQ-135   → NO2  (ADS1115 ch1)
//   - MQ-136   → SO2  (ADS1115 ch2)
//   - MQ-131   → O3   (ADS1115 ch3)
//   - BMP280   → Suhu, Kelembapan, Tekanan (I2C)
//   - RTC DS3231 → Pencatatan waktu (I2C)
//   - Modul Micro SD Card → Penyimpanan lokal
//   - LCD 20x4 I2C → Display
//   - SIM7000E → GSM/LTE (opsional)
// ============================================================

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_BMP280.h>
#include <Adafruit_ADS1X15.h>
#include <RTClib.h>
#include <SD.h>
#include <SPI.h>
#include <LiquidCrystal_I2C.h>
#include <HardwareSerial.h>

// ── KONFIGURASI WiFi ─────────────────────────────────────────
const char* WIFI_SSID     = "NAMA_WIFI_ANDA";
const char* WIFI_PASSWORD = "PASSWORD_WIFI_ANDA";

// ── KONFIGURASI BACKEND ───────────────────────────────────────
const char* SERVER_URL    = "http://192.168.1.100:8080/api/sensor/data";
const char* DEVICE_KEY    = "ESP32_SUCOFINDO_MANADO_2025";
const char* INSPECTION_ID = "INS-1771489133574"; // Ganti sesuai sesi inspeksi aktif

// ── INTERVAL PENGIRIMAN (ms) ──────────────────────────────────
const unsigned long SEND_INTERVAL = 5000; // 5 detik

// ── PIN DEFINITIONS ───────────────────────────────────────────
#define SD_CS_PIN     5
#define PMS_RX_PIN   16
#define PMS_TX_PIN   17
#define LCD_ADDR     0x27

// ── OBJEK SENSOR ─────────────────────────────────────────────
Adafruit_BMP280    bmp;
Adafruit_ADS1115   ads;
RTC_DS3231         rtc;
LiquidCrystal_I2C  lcd(LCD_ADDR, 20, 4);
HardwareSerial     pmsSerial(2); // Serial2 untuk PMS5003

// ── VARIABEL DATA SENSOR ─────────────────────────────────────
struct SensorData {
  float pm25      = 0;
  float pm10      = 0;
  float co        = 0;
  float no2       = 0;
  float so2       = 0;
  float o3        = 0;
  float temp      = 0;
  float humidity  = 0;
  float pressure  = 0;
};

SensorData sensorData;
unsigned long lastSend = 0;

// ── KALIBRASI MQ SENSOR ───────────────────────────────────────
// Nilai Ro (resistance di udara bersih) — kalibrasi di lapangan
const float MQ7_RO   = 10.0;  // kΩ
const float MQ135_RO = 76.0;  // kΩ
const float MQ136_RO = 35.0;  // kΩ
const float MQ131_RO = 30.0;  // kΩ

// ── SETUP ─────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Wire.begin();

  // Init LCD
  lcd.init();
  lcd.backlight();
  lcd.print("SucoAir Monitor");
  lcd.setCursor(0, 1);
  lcd.print("Inisialisasi...");

  // Init BMP280
  if (!bmp.begin(0x76)) {
    Serial.println("[ERROR] BMP280 tidak ditemukan!");
  }
  bmp.setSampling(Adafruit_BMP280::MODE_NORMAL,
                  Adafruit_BMP280::SAMPLING_X2,
                  Adafruit_BMP280::SAMPLING_X16,
                  Adafruit_BMP280::FILTER_X16,
                  Adafruit_BMP280::STANDBY_MS_500);

  // Init ADS1115
  if (!ads.begin()) {
    Serial.println("[ERROR] ADS1115 tidak ditemukan!");
  }
  ads.setGain(GAIN_ONE); // ±4.096V

  // Init RTC
  if (!rtc.begin()) {
    Serial.println("[ERROR] RTC DS3231 tidak ditemukan!");
  }
  if (rtc.lostPower()) {
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }

  // Init SD Card
  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("[WARN] SD Card tidak ditemukan, log lokal dinonaktifkan.");
  }

  // Init PMS5003
  pmsSerial.begin(9600, SERIAL_8N1, PMS_RX_PIN, PMS_TX_PIN);

  // Koneksi WiFi
  connectWiFi();

  lcd.clear();
  lcd.print("Sistem Siap!");
  delay(1000);
}

// ── LOOP UTAMA ───────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // Baca semua sensor
  readBMP280();
  readPMS5003();
  readMQSensors();

  // Tampilkan di LCD
  updateLCD();

  // Kirim ke backend setiap SEND_INTERVAL
  if (now - lastSend >= SEND_INTERVAL) {
    lastSend = now;

    if (WiFi.status() == WL_CONNECTED) {
      sendToBackend();
      saveToSD();
    } else {
      Serial.println("[WARN] WiFi terputus, mencoba reconnect...");
      connectWiFi();
      saveToSD(); // Tetap simpan lokal
    }
  }

  delay(100);
}

// ── BACA BMP280 ───────────────────────────────────────────────
void readBMP280() {
  sensorData.temp     = bmp.readTemperature();
  sensorData.pressure = bmp.readPressure() / 100.0F; // hPa
  // BMP280 tidak memiliki humidity, gunakan nilai tetap atau sensor tambahan
  sensorData.humidity = 0;
}

// ── BACA PMS5003 (PM2.5, PM10) ───────────────────────────────
void readPMS5003() {
  uint8_t buf[32];
  if (pmsSerial.available() >= 32) {
    pmsSerial.readBytes(buf, 32);
    if (buf[0] == 0x42 && buf[1] == 0x4D) {
      // Atmospheric concentration (μg/m³)
      sensorData.pm25 = (buf[12] << 8) | buf[13];
      sensorData.pm10 = (buf[14] << 8) | buf[15];
    }
  }
}

// ── BACA MQ SENSOR via ADS1115 ───────────────────────────────
void readMQSensors() {
  // ADS1115 channel mapping:
  //   ch0 → MQ-7  (CO)
  //   ch1 → MQ-135 (NO2)
  //   ch2 → MQ-136 (SO2)
  //   ch3 → MQ-131 (O3)

  float vcc = 5.0; // Tegangan suplai sensor
  float rl  = 10.0; // Load resistance (kΩ)

  // MQ-7 → CO (ppm)
  float raw0  = ads.readADC_SingleEnded(0) * 0.125 / 1000.0; // konversi ke Volt
  float rs0   = rl * (vcc - raw0) / raw0;
  sensorData.co  = 100.0 * pow(rs0 / MQ7_RO, -1.5);

  // MQ-135 → NO2 (μg/m³) — konversi approx
  float raw1  = ads.readADC_SingleEnded(1) * 0.125 / 1000.0;
  float rs1   = rl * (vcc - raw1) / raw1;
  sensorData.no2 = 50.0 * pow(rs1 / MQ135_RO, -1.3) * 1.88; // ppm → μg/m³

  // MQ-136 → SO2 (μg/m³)
  float raw2  = ads.readADC_SingleEnded(2) * 0.125 / 1000.0;
  float rs2   = rl * (vcc - raw2) / raw2;
  sensorData.so2 = 10.0 * pow(rs2 / MQ136_RO, -1.1) * 2.62;

  // MQ-131 → O3 (μg/m³)
  float raw3  = ads.readADC_SingleEnded(3) * 0.125 / 1000.0;
  float rs3   = rl * (vcc - raw3) / raw3;
  sensorData.o3  = 15.0 * pow(rs3 / MQ131_RO, -1.5) * 1.96;

  // Clamp nilai negatif
  sensorData.co  = max(0.0f, sensorData.co);
  sensorData.no2 = max(0.0f, sensorData.no2);
  sensorData.so2 = max(0.0f, sensorData.so2);
  sensorData.o3  = max(0.0f, sensorData.o3);
}

// ── KIRIM DATA KE BACKEND ─────────────────────────────────────
void sendToBackend() {
  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);

  // Buat JSON payload
  StaticJsonDocument<512> doc;
  doc["inspection_id"] = INSPECTION_ID;
  doc["pm25"]          = round(sensorData.pm25 * 10) / 10.0;
  doc["pm10"]          = round(sensorData.pm10 * 10) / 10.0;
  doc["co"]            = round(sensorData.co   * 100) / 100.0;
  doc["no2"]           = round(sensorData.no2  * 10) / 10.0;
  doc["so2"]           = round(sensorData.so2  * 10) / 10.0;
  doc["o3"]            = round(sensorData.o3   * 10) / 10.0;
  doc["temperature"]   = round(sensorData.temp * 10) / 10.0;
  doc["humidity"]      = round(sensorData.humidity);
  doc["pressure"]      = round(sensorData.pressure);

  String payload;
  serializeJson(doc, payload);

  int code = http.POST(payload);

  if (code == 200) {
    String resp = http.getString();
    StaticJsonDocument<256> respDoc;
    deserializeJson(respDoc, resp);
    int   ispu     = respDoc["ispu"];
    const char* kat = respDoc["kategori"];
    Serial.printf("[OK] ISPU: %d | %s\n", ispu, kat);
  } else {
    Serial.printf("[ERROR] HTTP %d\n", code);
  }

  http.end();
}

// ── SIMPAN KE SD CARD ─────────────────────────────────────────
void saveToSD() {
  DateTime now = rtc.now();
  String filename = "/log_" + String(now.year()) +
    String(now.month())  + String(now.day()) + ".csv";

  File f = SD.open(filename, FILE_APPEND);
  if (f) {
    if (f.size() == 0) {
      f.println("Timestamp,PM25,PM10,CO,NO2,SO2,O3,Temp,Hum,Press");
    }
    f.printf("%04d-%02d-%02d %02d:%02d:%02d,%.1f,%.1f,%.2f,%.1f,%.1f,%.1f,%.1f,%.0f,%.0f\n",
      now.year(), now.month(), now.day(),
      now.hour(), now.minute(), now.second(),
      sensorData.pm25, sensorData.pm10, sensorData.co,
      sensorData.no2,  sensorData.so2,  sensorData.o3,
      sensorData.temp, sensorData.humidity, sensorData.pressure);
    f.close();
  }
}

// ── UPDATE LCD 20x4 ───────────────────────────────────────────
void updateLCD() {
  lcd.clear();

  // Baris 1: PM2.5 & PM10
  lcd.setCursor(0, 0);
  lcd.printf("PM2.5:%.1f PM10:%.1f", sensorData.pm25, sensorData.pm10);

  // Baris 2: CO, NO2
  lcd.setCursor(0, 1);
  lcd.printf("CO:%.2f  NO2:%.1f", sensorData.co, sensorData.no2);

  // Baris 3: SO2, O3
  lcd.setCursor(0, 2);
  lcd.printf("SO2:%.1f  O3:%.1f", sensorData.so2, sensorData.o3);

  // Baris 4: Suhu & Tekanan
  lcd.setCursor(0, 3);
  lcd.printf("T:%.1fC P:%.0fhPa", sensorData.temp, sensorData.pressure);
}

// ── KONEKSI WiFi ──────────────────────────────────────────────
void connectWiFi() {
  Serial.print("[WiFi] Menghubungkan ke ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempt = 0;
  while (WiFi.status() != WL_CONNECTED && attempt < 20) {
    delay(500);
    Serial.print(".");
    attempt++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Terhubung! IP: " + WiFi.localIP().toString());
    lcd.setCursor(0, 2);
    lcd.print("WiFi OK: ");
    lcd.print(WiFi.localIP());
  } else {
    Serial.println("\n[WiFi] Gagal terhubung. Mode offline.");
  }
}
