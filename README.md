# SucoAir Backend
**Node.js + WebSocket + SQLite + Fuzzy Mamdani**  
PT Sucofindo Unit Pelayanan Manado

---

## Struktur Proyek

```
sucoair-backend/
├── src/
│   ├── server.js              # Entry point (Express + HTTP server)
│   ├── websocket.js           # WebSocket server manager
│   ├── middleware/
│   │   └── auth.js            # JWT middleware
│   ├── routes/
│   │   ├── auth.js            # POST /api/auth/login
│   │   ├── users.js           # CRUD pengguna (admin)
│   │   ├── companies.js       # CRUD perusahaan
│   │   ├── inspections.js     # CRUD sesi inspeksi
│   │   ├── sensor.js          # Terima data ESP32 + riwayat
│   │   └── reports.js         # CRUD laporan
│   └── utils/
│       ├── database.js        # SQLite setup + seed
│       └── fuzzyMamdani.js    # Mesin Inferensi Fuzzy Mamdani
├── ESP32_SucoAir.ino          # Kode Arduino untuk ESP32
├── .env.example               # Template konfigurasi
└── package.json
```

---

## Cara Menjalankan

```bash
# 1. Install dependencies
npm install

# 2. Salin file environment
cp .env.example .env
# Edit .env sesuaikan JWT_SECRET, CORS_ORIGIN, dll

# 3. Jalankan development
npm run dev

# 4. Atau production
npm start
```

Server aktif di:
- REST API  → `http://localhost:8080/api`
- WebSocket → `ws://localhost:8080/ws`
- Health    → `http://localhost:8080/health`

**Akun default:**
| Username | Password  | Role  |
|----------|-----------|-------|
| admin    | admin123  | admin |
| agil     | user123   | user  |
| suci     | user123   | user  |

---

## Alur Data ESP32 → Backend → Frontend

```
ESP32 (sensor)
   │
   │  HTTP POST /api/sensor/data
   │  Header: X-Device-Key: ESP32_SUCOFINDO_MANADO_2025
   │  Body: { pm25, pm10, co, no2, so2, o3, temp, humidity, pressure }
   ▼
Backend Node.js
   │
   ├─ Fuzzy Mamdani → hitung ISPU & kategori
   ├─ Simpan ke SQLite
   └─ Broadcast via WebSocket ke semua frontend
         │
         ▼
Frontend React (useWebSocket hook)
   └─ Update dashboard real-time
```

---

## REST API Endpoints

### Auth
| Method | Endpoint          | Deskripsi        |
|--------|-------------------|------------------|
| POST   | /api/auth/login   | Login            |
| GET    | /api/auth/me      | Cek token aktif  |

### Sensor (ESP32)
| Method | Endpoint              | Auth         | Deskripsi             |
|--------|----------------------|--------------|-----------------------|
| POST   | /api/sensor/data     | Device Key   | Kirim data sensor     |
| GET    | /api/sensor/latest   | Bearer Token | Data sensor terbaru   |
| GET    | /api/sensor/history  | Bearer Token | Riwayat data sensor   |
| GET    | /api/sensor/stats    | Bearer Token | Statistik ringkasan   |

### Inspeksi
| Method | Endpoint                       | Deskripsi                |
|--------|-------------------------------|--------------------------|
| GET    | /api/inspections               | Daftar semua sesi        |
| POST   | /api/inspections               | Buat sesi baru           |
| GET    | /api/inspections/:id           | Detail sesi              |
| PUT    | /api/inspections/:id/selesai   | Selesaikan sesi          |
| GET    | /api/inspections/:id/sensor    | Data sensor per sesi     |
| GET    | /api/inspections/:id/latest    | Data terbaru per sesi    |

### Perusahaan
| Method | Endpoint              | Deskripsi                |
|--------|----------------------|--------------------------|
| GET    | /api/companies        | Daftar perusahaan        |
| POST   | /api/companies        | Tambah perusahaan        |
| PUT    | /api/companies/:id    | Edit perusahaan          |
| DELETE | /api/companies/:id    | Hapus perusahaan         |

---

## Konfigurasi ESP32

Edit bagian ini di `ESP32_SucoAir.ino`:
```cpp
const char* WIFI_SSID     = "NAMA_WIFI_ANDA";
const char* WIFI_PASSWORD = "PASSWORD_WIFI_ANDA";
const char* SERVER_URL    = "http://IP_BACKEND:8080/api/sensor/data";
const char* DEVICE_KEY    = "ESP32_SUCOFINDO_MANADO_2025";
const char* INSPECTION_ID = "INS-xxxx"; // ID sesi inspeksi aktif
```

**Library Arduino yang dibutuhkan:**
- `ArduinoJson` by Benoit Blanchon
- `Adafruit BMP280` by Adafruit
- `Adafruit ADS1X15` by Adafruit
- `RTClib` by Adafruit
- `LiquidCrystal I2C` by Frank de Brabander

---

## WebSocket Events

**Frontend menerima:**
```json
{ "type": "sensor_update", "data": { "pm25": 18.4, "ispu": 68, "kategori": "Sedang", ... } }
{ "type": "connected",     "clientId": "client_xxx" }
{ "type": "latest_data",   "data": { ... } }
```

**Frontend bisa kirim:**
```json
{ "type": "ping" }
{ "type": "request_latest" }
```

---

*Sitti Nurhazriah Asraka — NIM 22024115*  
*Politeknik Negeri Manado, 2025*
