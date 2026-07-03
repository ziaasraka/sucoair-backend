// ============================================================
// fuzzyMamdani.js — Mesin Inferensi Fuzzy Mamdani ISPU
//
// Disesuaikan dengan:
// - Rumus fungsi keanggotaan segitiga μ[x,a,b,c]
// - Kategori ISPU:
//   Baik               : 0 - 50
//   Sedang             : 51 - 100
//   Tidak Sehat        : 101 - 199
//   Sangat Tidak Sehat : 200 - 299
//   Berbahaya          : > 300
//
// Catatan:
// - Kategori tengah menggunakan trimf sesuai rumus gambar.
// - Kategori ujung kiri dan kanan menggunakan shoulder function,
//   supaya nilai sangat rendah tetap Baik dan nilai sangat tinggi
//   tetap Berbahaya.
// ============================================================


// ============================================================
// Fungsi Keanggotaan Dasar
// ============================================================

/**
 * Fungsi keanggotaan segitiga.
 *
 * Rumus:
 * 0,                         x <= a atau x >= c
 * (x - a) / (b - a),          a <= x <= b
 * (c - x) / (c - b),          b <= x <= c
 */
function trimf(x, a, b, c) {
  x = Number(x);

  if (!Number.isFinite(x)) return 0;

  if (x <= a || x >= c) return 0;
  if (x === b) return 1;

  if (x > a && x < b) {
    return (x - a) / (b - a);
  }

  if (x > b && x < c) {
    return (c - x) / (c - b);
  }

  return 0;
}

/**
 * Fungsi bahu kiri.
 * Digunakan untuk kategori "Baik".
 *
 * Nilai kecil dianggap penuh sebagai Baik.
 * Setelah batas tertentu, derajat keanggotaannya turun.
 */
function leftShoulder(x, b, c) {
  x = Number(x);

  if (!Number.isFinite(x)) return 0;

  if (x <= b) return 1;
  if (x >= c) return 0;

  return (c - x) / (c - b);
}

/**
 * Fungsi bahu kanan.
 * Digunakan untuk kategori "Berbahaya".
 *
 * Nilai tinggi dianggap penuh sebagai Berbahaya.
 */
function rightShoulder(x, a, b) {
  x = Number(x);

  if (!Number.isFinite(x)) return 0;

  if (x <= a) return 0;
  if (x >= b) return 1;

  return (x - a) / (b - a);
}


// ============================================================
// Fuzzifikasi per Parameter
// ============================================================
//
// Nilai batas tetap memakai batas yang sudah ada pada sistem kamu.
// Yang diubah adalah bentuk fungsi fuzzy-nya supaya sesuai rumus
// segitiga dan kategori ISPU.
// ============================================================

function fuzzifyPM25(v) {
  return {
    baik: leftShoulder(v, 15.5, 40),
    sedang: trimf(v, 15.5, 40, 65),
    tidakSehat: trimf(v, 55, 90, 150),
    sangatTidakSehat: trimf(v, 110, 168, 210),
    berbahaya: rightShoulder(v, 180, 250),
  };
}

function fuzzifyPM10(v) {
  return {
    baik: leftShoulder(v, 50, 150),
    sedang: trimf(v, 50, 150, 250),
    tidakSehat: trimf(v, 200, 300, 420),
    sangatTidakSehat: trimf(v, 350, 420, 500),
    berbahaya: rightShoulder(v, 430, 500),
  };
}

function fuzzifyCO(v) {
  return {
    baik: leftShoulder(v, 4.5, 9),
    sedang: trimf(v, 4.5, 9, 15),
    tidakSehat: trimf(v, 12, 20, 30),
    sangatTidakSehat: trimf(v, 25, 35, 45),
    berbahaya: rightShoulder(v, 40, 50),
  };
}

function fuzzifyNO2(v) {
  return {
    baik: leftShoulder(v, 50, 100),
    sedang: trimf(v, 50, 100, 200),
    tidakSehat: trimf(v, 150, 250, 400),
    sangatTidakSehat: trimf(v, 300, 500, 700),
    berbahaya: rightShoulder(v, 600, 800),
  };
}

function fuzzifySO2(v) {
  return {
    baik: leftShoulder(v, 52, 100),
    sedang: trimf(v, 52, 100, 260),
    tidakSehat: trimf(v, 200, 365, 565),
    sangatTidakSehat: trimf(v, 400, 565, 800),
    berbahaya: rightShoulder(v, 600, 800),
  };
}

function fuzzifyO3(v) {
  return {
    baik: leftShoulder(v, 120, 200),
    sedang: trimf(v, 120, 200, 235),
    tidakSehat: trimf(v, 200, 290, 400),
    sangatTidakSehat: trimf(v, 300, 400, 500),
    berbahaya: rightShoulder(v, 420, 600),
  };
}


// ============================================================
// Pusat Output ISPU
// ============================================================
//
// Sesuai tabel:
// Baik               : 0 - 50      pusat 25
// Sedang             : 51 - 100    pusat 75
// Tidak Sehat        : 101 - 199   pusat 150
// Sangat Tidak Sehat : 200 - 299   pusat 250
// Berbahaya          : > 300       pusat 400
//
// Karena Berbahaya tidak punya batas atas pasti, dipakai 400.
// Kalau kamu ingin skala sampai 500, 400 masih masuk akal.
// ============================================================

const OUTPUT_CENTERS = {
  baik: 25,
  sedang: 75,
  tidakSehat: 150,
  sangatTidakSehat: 250,
  berbahaya: 400,
};

const CATEGORY_ORDER = [
  "baik",
  "sedang",
  "tidakSehat",
  "sangatTidakSehat",
  "berbahaya",
];

const PARAM_LABEL = {
  pm25: "PM2.5",
  pm10: "PM10",
  co: "CO",
  no2: "NO2",
  so2: "SO2",
  o3: "O3",
};


// ============================================================
// Helper Perhitungan
// ============================================================

function weightedScore(membership) {
  let numerator = 0;
  let denominator = 0;

  for (const key of CATEGORY_ORDER) {
    const mu = Number(membership[key] || 0);

    if (mu > 0) {
      numerator += mu * OUTPUT_CENTERS[key];
      denominator += mu;
    }
  }

  return denominator > 0 ? Math.round(numerator / denominator) : 0;
}

function kategoriFromIspu(ispu) {
  const value = Number(ispu);

  if (value <= 50) {
    return {
      kategori: "Baik",
      kode: 1,
    };
  }

  if (value <= 100) {
    return {
      kategori: "Sedang",
      kode: 2,
    };
  }

  if (value <= 199) {
    return {
      kategori: "Tidak Sehat",
      kode: 3,
    };
  }

  if (value <= 299) {
    return {
      kategori: "Sangat Tidak Sehat",
      kode: 4,
    };
  }

  return {
    kategori: "Berbahaya",
    kode: 5,
  };
}

function buildParameterResult(key, rawValue, membership) {
  const ispu = weightedScore(membership);
  const kategori = kategoriFromIspu(ispu);

  return {
    parameter: key,
    label: PARAM_LABEL[key],
    value: Number(rawValue),
    ispu,
    kategori: kategori.kategori,
    kode: kategori.kode,
    membership,
  };
}


// ============================================================
// Fungsi Utama
// ============================================================

function hitungISPU(pm25, pm10, co, no2, so2, o3) {
  const nPm25 = Number(pm25);
  const nPm10 = Number(pm10);
  const nCo = Number(co);
  const nNo2 = Number(no2);
  const nSo2 = Number(so2);
  const nO3 = Number(o3);

  const fPM25 = fuzzifyPM25(nPm25);
  const fPM10 = fuzzifyPM10(nPm10);
  const fCO = fuzzifyCO(nCo);
  const fNO2 = fuzzifyNO2(nNo2);
  const fSO2 = fuzzifySO2(nSo2);
  const fO3 = fuzzifyO3(nO3);

  const perParameter = {
    pm25: buildParameterResult("pm25", nPm25, fPM25),
    pm10: buildParameterResult("pm10", nPm10, fPM10),
    co: buildParameterResult("co", nCo, fCO),
    no2: buildParameterResult("no2", nNo2, fNO2),
    so2: buildParameterResult("so2", nSo2, fSO2),
    o3: buildParameterResult("o3", nO3, fO3),
  };

  // ==========================================================
  // ISPU Akhir
  // ==========================================================
  //
  // Untuk ISPU udara, nilai akhir lebih aman memakai parameter
  // terburuk atau nilai ISPU tertinggi.
  //
  // Kalau dirata-ratakan, polutan tinggi bisa tertutup oleh
  // parameter lain yang rendah. Itu penyebab hasil sebelumnya
  // terlihat "terlalu baik", sebuah keputusan matematika yang
  // agak terlalu optimis untuk udara beracun.
  // ==========================================================

  const dominant = Object.values(perParameter).sort((a, b) => {
    return b.ispu - a.ispu;
  })[0];

  const ispu = dominant?.ispu || 0;
  const kategoriFinal = kategoriFromIspu(ispu);

  const aggregateMembership = {
    baik: Math.max(
      fPM25.baik,
      fPM10.baik,
      fCO.baik,
      fNO2.baik,
      fSO2.baik,
      fO3.baik
    ),

    sedang: Math.max(
      fPM25.sedang,
      fPM10.sedang,
      fCO.sedang,
      fNO2.sedang,
      fSO2.sedang,
      fO3.sedang
    ),

    tidakSehat: Math.max(
      fPM25.tidakSehat,
      fPM10.tidakSehat,
      fCO.tidakSehat,
      fNO2.tidakSehat,
      fSO2.tidakSehat,
      fO3.tidakSehat
    ),

    sangatTidakSehat: Math.max(
      fPM25.sangatTidakSehat,
      fPM10.sangatTidakSehat,
      fCO.sangatTidakSehat,
      fNO2.sangatTidakSehat,
      fSO2.sangatTidakSehat,
      fO3.sangatTidakSehat
    ),

    berbahaya: Math.max(
      fPM25.berbahaya,
      fPM10.berbahaya,
      fCO.berbahaya,
      fNO2.berbahaya,
      fSO2.berbahaya,
      fO3.berbahaya
    ),

    per_parameter: perParameter,
    dominant_parameter: dominant?.parameter || null,
    dominant_label: dominant?.label || null,
  };

  return {
    ispu,
    kategori: kategoriFinal.kategori,
    kode: kategoriFinal.kode,

    dominant_parameter: dominant?.parameter || null,
    dominant_label: dominant?.label || null,

    per_parameter: perParameter,

    membership: aggregateMembership,

    detail: {
      fuzzifikasiPM25: fPM25,
      fuzzifikasiPM10: fPM10,
      fuzzifikasiCO: fCO,
      fuzzifikasiNO2: fNO2,
      fuzzifikasiSO2: fSO2,
      fuzzifikasiO3: fO3,
      perParameter,
    },
  };
}

module.exports = {
  hitungISPU,
};