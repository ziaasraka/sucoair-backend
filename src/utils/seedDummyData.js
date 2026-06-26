const db = require('./database');
const { v4: uuidv4 } = require('uuid');

// Ambil semua company
const companies = db.prepare('SELECT id FROM companies').all();

// Ambil admin user untuk created_by
const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');

if (!companies.length) {
  console.log('Tidak ada perusahaan di database. Seed gagal.');
  process.exit(1);
}

function randomNumber(min, max) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(2));
}

// Seed 5 sesi inspeksi per perusahaan
companies.forEach(company => {
  for (let i = 0; i < 5; i++) {
    const inspectionId = uuidv4();
    const location = `Lokasi ${i + 1}`;
    const startedAt = new Date(Date.now() - i * 86400000).toISOString(); // tiap hari
    const endedAt = new Date(Date.now() - i * 86400000 + 3600000).toISOString(); // +1 jam

    // Insert inspeksi
    db.prepare(`
      INSERT INTO inspections (id, company_id, location, started_at, ended_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(inspectionId, company.id, location, startedAt, endedAt, admin.id);

    // Insert 20 data sensor per inspeksi
    for (let j = 0; j < 20; j++) {
      db.prepare(`
        INSERT INTO sensor_data (inspection_id, pm25, pm10, co, no2, so2, o3, temperature, humidity, pressure, ispu, kategori)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        inspectionId,
        randomNumber(5, 75),  // PM2.5
        randomNumber(10, 100), // PM10
        randomNumber(0, 1),    // CO
        randomNumber(0, 0.1),  // NO2
        randomNumber(0, 0.1),  // SO2
        randomNumber(0, 0.05), // O3
        randomNumber(20, 35),  // Temperature
        randomNumber(40, 90),  // Humidity
        randomNumber(950, 1050), // Pressure
        Math.floor(randomNumber(50, 200)), // ISPU
        'Baik'                 // Kategori dummy
      );
    }
  }
});

console.log('[DB] Seed dummy data sensor & inspeksi selesai.');