const db = require('./database');

function durationToMinutes(duration = '1 jam') {
  const text = String(duration).toLowerCase().trim();
  const number = parseInt(text, 10) || 1;

  if (text.includes('menit')) return number;
  if (text.includes('jam')) return number * 60;
  if (text.includes('hari')) return number * 24 * 60;

  return number * 60;
}

function parseDbDate(value) {
  if (!value) return null;
  return new Date(String(value).replace(' ', 'T'));
}

function createReportIfMissing(inspection) {
  const existing = db.prepare(`
    SELECT id FROM reports
    WHERE inspection_id = ?
    LIMIT 1
  `).get(inspection.id);

  if (existing) return;

  db.prepare(`
    INSERT INTO reports
      (company_id, inspection_id, title, period, format, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    inspection.company_id,
    inspection.id,
    `Laporan Inspeksi ${inspection.id}`,
    inspection.duration || '-',
    'Excel',
    `Laporan otomatis dari sesi inspeksi ${inspection.id}`
  );
}

function finishInspection(id) {
  const inspection = db.prepare(`
    SELECT *
    FROM inspections
    WHERE id = ?
  `).get(id);

  if (!inspection) {
    return {
      success: false,
      status: 404,
      message: 'Inspeksi tidak ditemukan.'
    };
  }

  if (inspection.status === 'Selesai') {
    createReportIfMissing(inspection);

    return {
      success: false,
      status: 400,
      message: 'Inspeksi sudah selesai.'
    };
  }

  db.prepare(`
    UPDATE inspections
    SET status = 'Selesai',
        ended_at = datetime('now','localtime')
    WHERE id = ?
  `).run(id);

  createReportIfMissing(inspection);

  return {
    success: true,
    status: 200,
    message: 'Inspeksi berhasil diselesaikan.'
  };
}

function finalizeExpiredInspections() {
  const inspections = db.prepare(`
    SELECT *
    FROM inspections
    WHERE status = 'Berlangsung'
  `).all();

  const now = Date.now();

  for (const inspection of inspections) {
    const startedAt = parseDbDate(inspection.started_at);

    if (!startedAt || isNaN(startedAt.getTime())) continue;

    const durationMinutes = durationToMinutes(inspection.duration);
    const endTime = startedAt.getTime() + durationMinutes * 60 * 1000;

    if (now >= endTime) {
      finishInspection(inspection.id);
      console.log(`[AUTO CLOSE] Inspeksi ${inspection.id} selesai otomatis.`);
    }
  }
}

function getActiveInspection() {
  finalizeExpiredInspections();

  return db.prepare(`
    SELECT *
    FROM inspections
    WHERE status = 'Berlangsung'
    ORDER BY started_at DESC
    LIMIT 1
  `).get();
}

module.exports = {
  durationToMinutes,
  finalizeExpiredInspections,
  getActiveInspection,
  finishInspection
};