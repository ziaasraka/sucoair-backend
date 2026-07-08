// ============================================================
// fuzzyMamdani.js
//
// Disamakan dengan perhitungan app:
// - Nilai akhir ISPU memakai interpolasi linear resmi.
// - ISPU final = sub-indeks tertinggi dari semua parameter.
// - Fuzzy Mamdani dipakai sebagai informasi pendukung,
//   bukan sebagai angka final.
//
// Digunakan oleh:
//   const { hitungISPU } = require('../utils/fuzzyMamdani');
//
// Output tetap kompatibel dengan sensor.js:
//   {
//     ispu,
//     kategori,
//     kode,
//     membership,
//     per_parameter,
//     sub_indeks,
//     pencemar_kritis
//   }
// ============================================================


// ============================================================
// BREAKPOINT ISPU
// Format: [Ib, Ia, Xb, Xa]
// ============================================================

const BREAKPOINTS = {
  pm25: [
    [0,   50,  0,     15.5],
    [51,  100, 15.5,  55.4],
    [101, 200, 55.4,  150.4],
    [201, 300, 150.4, 250.4],
    [301, 500, 250.4, 500],
  ],

  pm10: [
    [0,   50,  0,   50],
    [51,  100, 50,  150],
    [101, 200, 150, 350],
    [201, 300, 350, 420],
    [301, 500, 420, 500],
  ],

  so2: [
    [0,   50,  0,   52],
    [51,  100, 52,  180],
    [101, 200, 180, 400],
    [201, 300, 400, 800],
    [301, 500, 800, 1200],
  ],

  no2: [
    [0,   50,  0,    80],
    [51,  100, 80,   200],
    [101, 200, 200,  1130],
    [201, 300, 1130, 2260],
    [301, 500, 2260, 3000],
  ],

  o3: [
    [0,   50,  0,   120],
    [51,  100, 120, 235],
    [101, 200, 235, 400],
    [201, 300, 400, 800],
    [301, 500, 800, 1000],
  ],

  // Penting:
  // Breakpoint CO ini memakai satuan µg/m³.
  // Kalau ESP32 mengirim CO dalam ppm, hasil web dan app tidak akan sama
  // sampai satuannya disamakan.
  co: [
    [0,   50,  0,     4000],
    [51,  100, 4000,  8000],
    [101, 200, 8000,  15000],
    [201, 300, 15000, 30000],
    [301, 500, 30000, 45000],
  ],
};

const CATEGORY_KEYS = [
  "baik",
  "sedang",
  "tidakSehat",
  "sangatTidakSehat",
  "berbahaya",
];

const CATEGORY_LABELS = {
  baik: "Baik",
  sedang: "Sedang",
  tidakSehat: "Tidak Sehat",
  sangatTidakSehat: "Sangat Tidak Sehat",
  berbahaya: "Berbahaya",
};

const CATEGORY_CODES = {
  baik: 1,
  sedang: 2,
  tidakSehat: 3,
  sangatTidakSehat: 4,
  berbahaya: 5,
};

const PARAM_LABELS = {
  pm25: "PM2.5",
  pm10: "PM10",
  so2: "SO2",
  no2: "NO2",
  o3: "O3",
  co: "CO",
};


// ============================================================
// Helper Dasar
// ============================================================

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round(value, digit = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(digit));
}


// ============================================================
// Interpolasi Linear Resmi ISPU
//
// Rumus:
// I = ((Ia - Ib) / (Xa - Xb)) * (Xx - Xb) + Ib
// ============================================================

function hitungSubIndeksResmi(xx, breakpoint) {
  const value = toNumber(xx);

  for (const row of breakpoint) {
    const [ib, ia, xb, xa] = row;

    if (value >= xb && value <= xa) {
      if (xa === xb) return ib;

      const result = ((ia - ib) / (xa - xb)) * (value - xb) + ib;
      return round(result, 2);
    }
  }

  if (value < breakpoint[0][2]) return 0;

  const last = breakpoint[breakpoint.length - 1];
  return last[1];
}


// ============================================================
// Kategori Final ISPU
// ============================================================

function kategoriISPU(value) {
  const ispu = toNumber(value);

  if (ispu <= 50) {
    return {
      key: "baik",
      kategori: "Baik",
      kode: 1,
    };
  }

  if (ispu <= 100) {
    return {
      key: "sedang",
      kategori: "Sedang",
      kode: 2,
    };
  }

  if (ispu <= 200) {
    return {
      key: "tidakSehat",
      kategori: "Tidak Sehat",
      kode: 3,
    };
  }

  if (ispu <= 300) {
    return {
      key: "sangatTidakSehat",
      kategori: "Sangat Tidak Sehat",
      kode: 4,
    };
  }

  return {
    key: "berbahaya",
    kategori: "Berbahaya",
    kode: 5,
  };
}


// ============================================================
// Fuzzy Pendukung
// ============================================================

function anchorFromBreakpoint(bp) {
  return [
    bp[0][2],
    bp[0][3],
    bp[1][3],
    bp[2][3],
    bp[3][3],
    bp[4][3],
  ];
}

function triangular(x, a, b, c) {
  const value = toNumber(x);

  if (value <= a || value >= c) return 0;
  if (value === b) return 1;

  if (value < b) {
    return (value - a) / (b - a);
  }

  return (c - value) / (c - b);
}

function fuzzifikasi(x, anchor) {
  const value = toNumber(x);
  const [x0, x1, x2, x3, x4] = anchor;

  const mu = {
    baik: 0,
    sedang: 0,
    tidakSehat: 0,
    sangatTidakSehat: 0,
    berbahaya: 0,
  };

  if (value <= x0) {
    mu.baik = 1;
  } else if (value >= x1) {
    mu.baik = 0;
  } else {
    mu.baik = (x1 - value) / (x1 - x0);
  }

  mu.sedang = triangular(value, x0, x1, x2);
  mu.tidakSehat = triangular(value, x1, x2, x3);
  mu.sangatTidakSehat = triangular(value, x2, x3, x4);

  if (value >= x4) {
    mu.berbahaya = 1;
  } else if (value <= x3) {
    mu.berbahaya = 0;
  } else {
    mu.berbahaya = (value - x3) / (x4 - x3);
  }

  return {
    baik: round(mu.baik, 6),
    sedang: round(mu.sedang, 6),
    tidakSehat: round(mu.tidakSehat, 6),
    sangatTidakSehat: round(mu.sangatTidakSehat, 6),
    berbahaya: round(mu.berbahaya, 6),
  };
}

function statusDariMembership(mu) {
  let maxKey = "baik";
  let maxValue = -1;

  for (const key of CATEGORY_KEYS) {
    const value = toNumber(mu[key]);

    if (value > maxValue) {
      maxValue = value;
      maxKey = key;
    }
  }

  return {
    key: maxKey,
    kategori: CATEGORY_LABELS[maxKey],
    kode: CATEGORY_CODES[maxKey],
  };
}

function aggregateMembership(perParameter) {
  const result = {
    baik: 0,
    sedang: 0,
    tidakSehat: 0,
    sangatTidakSehat: 0,
    berbahaya: 0,
  };

  for (const item of Object.values(perParameter)) {
    for (const key of CATEGORY_KEYS) {
      result[key] = Math.max(result[key], toNumber(item.membership[key]));
    }
  }

  return {
    baik: round(result.baik, 6),
    sedang: round(result.sedang, 6),
    tidakSehat: round(result.tidakSehat, 6),
    sangatTidakSehat: round(result.sangatTidakSehat, 6),
    berbahaya: round(result.berbahaya, 6),
  };
}


// ============================================================
// Build Hasil Per Parameter
// ============================================================

function buildParameterResult(key, rawValue, breakpoint) {
  const value = toNumber(rawValue);
  const subIndeks = hitungSubIndeksResmi(value, breakpoint);
  const kategoriResmi = kategoriISPU(subIndeks);

  const anchor = anchorFromBreakpoint(breakpoint);
  const membership = fuzzifikasi(value, anchor);
  const fuzzyStatus = statusDariMembership(membership);

  return {
    parameter: key,
    label: PARAM_LABELS[key],
    value,
    ispu: subIndeks,
    kategori: kategoriResmi.kategori,
    kode: kategoriResmi.kode,

    membership,

    fuzzy_status: fuzzyStatus.kategori,
    fuzzy_kode: fuzzyStatus.kode,
  };
}


// ============================================================
// Fungsi Utama
// ============================================================

function hitungISPU(pm25, pm10, co, no2, so2, o3) {
  const values = {
    pm25: toNumber(pm25),
    pm10: toNumber(pm10),
    so2: toNumber(so2),
    no2: toNumber(no2),
    o3: toNumber(o3),
    co: toNumber(co),
  };

  const perParameter = {
    pm25: buildParameterResult("pm25", values.pm25, BREAKPOINTS.pm25),
    pm10: buildParameterResult("pm10", values.pm10, BREAKPOINTS.pm10),
    so2: buildParameterResult("so2", values.so2, BREAKPOINTS.so2),
    no2: buildParameterResult("no2", values.no2, BREAKPOINTS.no2),
    o3: buildParameterResult("o3", values.o3, BREAKPOINTS.o3),
    co: buildParameterResult("co", values.co, BREAKPOINTS.co),
  };

  const subIndeks = {
    "PM2.5": perParameter.pm25.ispu,
    PM10: perParameter.pm10.ispu,
    SO2: perParameter.so2.ispu,
    NO2: perParameter.no2.ispu,
    O3: perParameter.o3.ispu,
    CO: perParameter.co.ispu,
  };

  const dominant = Object.values(perParameter).sort((a, b) => {
    return b.ispu - a.ispu;
  })[0];

  const ispuFinal = dominant?.ispu || 0;
  const kategoriFinal = kategoriISPU(ispuFinal);

  const fuzzyMembership = {
    "PM2.5": perParameter.pm25.membership,
    PM10: perParameter.pm10.membership,
    SO2: perParameter.so2.membership,
    NO2: perParameter.no2.membership,
    O3: perParameter.o3.membership,
    CO: perParameter.co.membership,
  };

  const fuzzyStatus = {
    "PM2.5": perParameter.pm25.fuzzy_status,
    PM10: perParameter.pm10.fuzzy_status,
    SO2: perParameter.so2.fuzzy_status,
    NO2: perParameter.no2.fuzzy_status,
    O3: perParameter.o3.fuzzy_status,
    CO: perParameter.co.fuzzy_status,
  };

  const membershipAggregate = aggregateMembership(perParameter);

  const metode =
    "Interpolasi Linear ISPU resmi untuk nilai akhir; Fuzzy Logic Mamdani untuk klasifikasi pendukung per parameter";

  return {
    ispu: ispuFinal,
    kategori: kategoriFinal.kategori,
    kode: kategoriFinal.kode,

    pencemar_kritis: dominant?.label || null,
    dominant_parameter: dominant?.parameter || null,
    dominant_label: dominant?.label || null,

    sub_indeks: subIndeks,
    per_parameter: perParameter,

    membership: {
      ...membershipAggregate,

      metode,
      sub_indeks: subIndeks,
      pencemar_kritis: dominant?.label || null,

      fuzzy_analysis: {
        membership: fuzzyMembership,
        status_per_parameter: fuzzyStatus,
      },

      per_parameter: perParameter,
      dominant_parameter: dominant?.parameter || null,
      dominant_label: dominant?.label || null,
    },

    detail: {
      metode,
      input: values,
      sub_indeks: subIndeks,
      pencemar_kritis: dominant?.label || null,
      fuzzy_analysis: {
        membership: fuzzyMembership,
        status_per_parameter: fuzzyStatus,
      },
      perParameter,
    },
  };
}

module.exports = {
  hitungISPU,

  // Export tambahan untuk testing jika dibutuhkan
  hitungSubIndeksResmi,
  kategoriISPU,
  fuzzifikasi,
};