// ============================================================
// fuzzyMamdani.js  — Mesin Inferensi Fuzzy Mamdani ISPU
// Digunakan di backend untuk memproses data dari ESP32
// Referensi: KepMen LH No.45/MENLH/1997
// ============================================================

// ── Fungsi Keanggotaan Dasar ─────────────────────────────────

/** Segitiga: naik dari a, puncak b, turun ke c */
function trimf(x, a, b, c) {
  if (x <= a || x >= c) return 0;
  if (x <= b) return (x - a) / (b - a);
  return (c - x) / (c - b);
}

/** Trapesium: naik dari a ke b, datar b–c, turun ke d */
function trapmf(x, a, b, c, d) {
  if (x <= a || x >= d) return 0;
  if (x >= b && x <= c) return 1;
  if (x < b) return (x - a) / (b - a);
  return (d - x) / (d - c);
}

// ── Fuzzifikasi per Parameter ────────────────────────────────

function fuzzifyPM25(v) {
  return {
    baik:             trapmf(v,   0,   0,  15.5,  40),
    sedang:           trimf (v,  15.5, 40,   65),
    tidakSehat:       trimf (v,  55,   90,  150),
    sangatTidakSehat: trimf (v, 110,  168,  210),
    berbahaya:        trapmf(v, 180,  250,  500, 500),
  };
}

function fuzzifyPM10(v) {
  return {
    baik:             trapmf(v,   0,   0,   50,  150),
    sedang:           trimf (v,  50,  150,  250),
    tidakSehat:       trimf (v, 200,  300,  420),
    sangatTidakSehat: trimf (v, 350,  420,  500),
    berbahaya:        trapmf(v, 430,  500,  700, 700),
  };
}

function fuzzifyCO(v) {
  return {
    baik:             trapmf(v,  0,  0,   4.5,  9),
    sedang:           trimf (v,  4.5, 9,  15),
    tidakSehat:       trimf (v, 12,  20,  30),
    sangatTidakSehat: trimf (v, 25,  35,  45),
    berbahaya:        trapmf(v, 40,  50, 100, 100),
  };
}

function fuzzifyNO2(v) {
  return {
    baik:             trapmf(v,   0,   0,   50,  100),
    sedang:           trimf (v,  50,  100,  200),
    tidakSehat:       trimf (v, 150,  250,  400),
    sangatTidakSehat: trimf (v, 300,  500,  700),
    berbahaya:        trapmf(v, 600,  800, 1200, 1200),
  };
}

function fuzzifySO2(v) {
  return {
    baik:             trapmf(v,   0,   0,   52,  100),
    sedang:           trimf (v,  52,  100,  260),
    tidakSehat:       trimf (v, 200,  365,  565),
    sangatTidakSehat: trimf (v, 400,  565,  800),
    berbahaya:        trapmf(v, 600,  800, 1200, 1200),
  };
}

function fuzzifyO3(v) {
  return {
    baik:             trapmf(v,   0,   0,  120,  200),
    sedang:           trimf (v, 120,  200,  235),
    tidakSehat:       trimf (v, 200,  290,  400),
    sangatTidakSehat: trimf (v, 300,  400,  500),
    berbahaya:        trapmf(v, 420,  600, 1000, 1000),
  };
}

// ── Pusat Output (Centroid per Kategori) ─────────────────────
const OUTPUT_CENTERS = {
  baik:             25,
  sedang:           75,
  tidakSehat:       150,
  sangatTidakSehat: 250,
  berbahaya:        425,
};

// ── Fungsi Utama: hitungISPU ─────────────────────────────────
/**
 * Hitung ISPU menggunakan metode Fuzzy Mamdani
 * @param {number} pm25   - μg/m³
 * @param {number} pm10   - μg/m³
 * @param {number} co     - ppm
 * @param {number} no2    - μg/m³
 * @param {number} so2    - μg/m³
 * @param {number} o3     - μg/m³
 * @returns {object}
 */
function hitungISPU(pm25, pm10, co, no2, so2, o3) {
  // 1. FUZZIFIKASI
  const fPM25 = fuzzifyPM25(pm25);
  const fPM10 = fuzzifyPM10(pm10);
  const fCO   = fuzzifyCO(co);
  const fNO2  = fuzzifyNO2(no2);
  const fSO2  = fuzzifySO2(so2);
  const fO3   = fuzzifyO3(o3);

  // 2. INFERENSI — MAX aggregation (setiap parameter berkontribusi)
  const rules = {
    baik:             Math.max(fPM25.baik,             fPM10.baik,             fCO.baik,             fNO2.baik,             fSO2.baik,             fO3.baik),
    sedang:           Math.max(fPM25.sedang,           fPM10.sedang,           fCO.sedang,           fNO2.sedang,           fSO2.sedang,           fO3.sedang),
    tidakSehat:       Math.max(fPM25.tidakSehat,       fPM10.tidakSehat,       fCO.tidakSehat,       fNO2.tidakSehat,       fSO2.tidakSehat,       fO3.tidakSehat),
    sangatTidakSehat: Math.max(fPM25.sangatTidakSehat, fPM10.sangatTidakSehat, fCO.sangatTidakSehat, fNO2.sangatTidakSehat, fSO2.sangatTidakSehat, fO3.sangatTidakSehat),
    berbahaya:        Math.max(fPM25.berbahaya,        fPM10.berbahaya,        fCO.berbahaya,        fNO2.berbahaya,        fSO2.berbahaya,        fO3.berbahaya),
  };

  // 3. DEFUZZIFIKASI — Weighted Average (Centroid Method)
  let numerator = 0, denominator = 0;
  for (const [key, mu] of Object.entries(rules)) {
    numerator   += mu * OUTPUT_CENTERS[key];
    denominator += mu;
  }
  const ispu = denominator > 0 ? Math.round(numerator / denominator) : 0;

  // 4. KLASIFIKASI Kategori ISPU
  let kategori, kode;
  if      (ispu <= 50)  { kategori = 'Baik';               kode = 1; }
  else if (ispu <= 100) { kategori = 'Sedang';             kode = 2; }
  else if (ispu <= 200) { kategori = 'Tidak Sehat';        kode = 3; }
  else if (ispu <= 300) { kategori = 'Sangat Tidak Sehat'; kode = 4; }
  else                  { kategori = 'Berbahaya';          kode = 5; }

  return {
    ispu,
    kategori,
    kode,
    membership: rules,
    detail: {
      fuzzifikasiPM25: fPM25,
      fuzzifikasiPM10: fPM10,
      fuzzifikasiCO:   fCO,
      fuzzifikasiNO2:  fNO2,
      fuzzifikasiSO2:  fSO2,
      fuzzifikasiO3:   fO3,
    },
  };
}

module.exports = { hitungISPU };
