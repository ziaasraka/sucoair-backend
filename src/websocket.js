// ============================================================
// websocket.js — Manajemen WebSocket Server
// Menangani koneksi dari:
//   - Frontend React (menerima data real-time)
//   - ESP32 (bisa kirim data via WS juga, selain HTTP POST)
// ============================================================
const WebSocket = require('ws');

/**
 * Setup WebSocket server dan pasang ke HTTP server
 * @param {http.Server} httpServer
 * @param {express.Application} app
 */
function setupWebSocket(httpServer, app) {
  const wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

  // Kumpulan client yang terhubung
  const clients = new Map(); // Map<ws, { type: 'frontend'|'esp32', id: string }>

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    const clientId = `client_${Date.now()}`;
    clients.set(ws, { type: 'frontend', id: clientId, ip });

    console.log(`[WS] Client terhubung: ${clientId} dari ${ip}. Total: ${clients.size}`);

    // Kirim pesan sambutan + data terbaru
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Terhubung ke SucoAir WebSocket Server',
      clientId,
    }));

    // Tangani pesan masuk dari client
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // ESP32 kirim data sensor via WebSocket
        if (msg.type === 'sensor_data') {
          handleESP32Data(msg, ws, app, broadcast);
        }

        // Frontend minta data terbaru
        if (msg.type === 'request_latest') {
          sendLatestData(ws, app);
        }

        // Ping / keepalive
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }

      } catch (e) {
        console.error('[WS] Parse error:', e.message);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Client putus: ${clientId}. Total: ${clients.size}`);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error ${clientId}:`, err.message);
    });
  });

  // ── Broadcast ke semua frontend ─────────────────────────────
  function broadcast(payload, excludeWs = null) {
    let count = 0;
    clients.forEach((info, ws) => {
      if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        count++;
      }
    });
    return count;
  }

  // Daftarkan broadcast ke app.locals agar bisa dipakai routes
  app.locals.wsBroadcast = broadcast;
  app.locals.wsClients   = clients;

  // ── Tangani data dari ESP32 via WebSocket ────────────────────
  function handleESP32Data(msg, ws, app, broadcast) {
    const deviceKey = msg.device_key;
    if (deviceKey !== (process.env.ESP32_DEVICE_KEY || 'ESP32_SUCOFINDO_MANADO_2025')) {
      ws.send(JSON.stringify({ type: 'error', message: 'Device key tidak valid.' }));
      return;
    }

    const { hitungISPU } = require('./utils/fuzzyMamdani');
    const db = require('./utils/database');
    const { pm25, pm10, co, no2, so2, o3, temperature, humidity, pressure, inspection_id } = msg;

    const fuzzy = hitungISPU(
      parseFloat(pm25 || 0), parseFloat(pm10 || 0), parseFloat(co || 0),
      parseFloat(no2  || 0), parseFloat(so2  || 0), parseFloat(o3 || 0)
    );

    const result = db.prepare(`
      INSERT INTO sensor_data
        (inspection_id, pm25, pm10, co, no2, so2, o3,
         temperature, humidity, pressure, ispu, kategori, membership)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      inspection_id || null,
      pm25, pm10, co, no2, so2, o3,
      temperature || null, humidity || null, pressure || null,
      fuzzy.ispu, fuzzy.kategori,
      JSON.stringify(fuzzy.membership)
    );

    // Kirim konfirmasi ke ESP32
    ws.send(JSON.stringify({
      type:     'ack',
      id:       result.lastInsertRowid,
      ispu:     fuzzy.ispu,
      kategori: fuzzy.kategori,
    }));

    // Broadcast ke semua frontend
    broadcast(JSON.stringify({
      type: 'sensor_update',
      data: {
        id:           result.lastInsertRowid,
        recorded_at:  new Date().toISOString(),
        pm25, pm10, co, no2, so2, o3,
        temperature, humidity, pressure,
        ispu:         fuzzy.ispu,
        kategori:     fuzzy.kategori,
        membership:   fuzzy.membership,
        inspection_id,
      },
    }), ws);
  }

  // ── Kirim data terbaru ke 1 client ──────────────────────────
  function sendLatestData(ws, app) {
    try {
      const db = require('./utils/database');
      const row = db.prepare(
        'SELECT * FROM sensor_data ORDER BY recorded_at DESC LIMIT 1'
      ).get();
      if (row) {
        if (row.membership) row.membership = JSON.parse(row.membership);
        ws.send(JSON.stringify({ type: 'latest_data', data: row }));
      }
    } catch (e) {
      console.error('[WS] sendLatestData error:', e.message);
    }
  }

  // ── Heartbeat: cek client aktif setiap 30 detik ─────────────
  setInterval(() => {
    clients.forEach((info, ws) => {
      if (ws.readyState !== WebSocket.OPEN) {
        clients.delete(ws);
      }
    });
  }, 30000);

  console.log('[WS] WebSocket server aktif di path /ws');
  return wss;
}

module.exports = { setupWebSocket };
