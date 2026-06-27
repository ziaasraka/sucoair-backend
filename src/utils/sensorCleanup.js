const db = require('./database');

function cleanupOldMonitoringData() {
  try {
    const result = db.prepare(`
      DELETE FROM sensor_data
      WHERE (inspection_id IS NULL OR inspection_id = '')
        AND recorded_at < datetime('now', '-1 day')
    `).run();

    if (result.changes > 0) {
      console.log(`[CLEANUP] ${result.changes} data monitoring umum lebih dari 1 hari dihapus.`);
    }

    return result.changes;
  } catch (err) {
    console.error('[CLEANUP MONITORING DATA ERROR]', err.message);
    return 0;
  }
}

module.exports = {
  cleanupOldMonitoringData
};