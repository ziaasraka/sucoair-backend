// ============================================================
// utils/bakuMutu.js
//
// Evaluasi Baku Mutu Udara Ambien
// Lampiran VII PP Republik Indonesia Nomor 22 Tahun 2021
//
// Sistem ini tidak menghitung ISPU.
// Setiap parameter dievaluasi secara terpisah berdasarkan:
// - rata-rata konsentrasi
// - periode pengukuran
// - nilai baku mutu
//
// Status:
// - Memenuhi Baku Mutu
// - Melebihi Baku Mutu
// - Belum Cukup Data
// ============================================================


// ============================================================
// BAKU MUTU YANG DIPAKAI UNTUK MONITORING/INSPEKSI
//
// Batas tahunan tidak dimasukkan karena sistem inspeksi belum
// menyimpan data selama satu tahun penuh.
// ============================================================

const BAKU_MUTU = {
  pm25: {
    label: 'PM2.5',
    sourceUnit: 'µg/m³',
    standards: [
      {
        key: '24h',
        label: '24 jam',
        hours: 24,
        limit: 55,
        unit: 'µg/m³'
      }
    ]
  },

  pm10: {
    label: 'PM10',
    sourceUnit: 'µg/m³',
    standards: [
      {
        key: '24h',
        label: '24 jam',
        hours: 24,
        limit: 75,
        unit: 'µg/m³'
      }
    ]
  },

  so2: {
    label: 'SO₂',
    sourceUnit: 'µg/m³',
    standards: [
      {
        key: '1h',
        label: '1 jam',
        hours: 1,
        limit: 150,
        unit: 'µg/m³'
      },
      {
        key: '24h',
        label: '24 jam',
        hours: 24,
        limit: 75,
        unit: 'µg/m³'
      }
    ]
  },

  co: {
    label: 'CO',
    sourceUnit: 'ppm',
    convertedUnit: 'µg/m³',
    standards: [
      {
        key: '1h',
        label: '1 jam',
        hours: 1,
        limit: 10000,
        unit: 'µg/m³'
      },
      {
        key: '8h',
        label: '8 jam',
        hours: 8,
        limit: 4000,
        unit: 'µg/m³'
      }
    ]
  },

  no2: {
    label: 'NO₂',
    sourceUnit: 'µg/m³',
    standards: [
      {
        key: '1h',
        label: '1 jam',
        hours: 1,
        limit: 200,
        unit: 'µg/m³'
      },
      {
        key: '24h',
        label: '24 jam',
        hours: 24,
        limit: 65,
        unit: 'µg/m³'
      }
    ]
  },

  o3: {
    label: 'O₃',
    sourceUnit: 'µg/m³',
    standards: [
      {
        key: '1h',
        label: '1 jam',
        hours: 1,
        limit: 150,
        unit: 'µg/m³'
      },
      {
        key: '8h',
        label: '8 jam',
        hours: 8,
        limit: 100,
        unit: 'µg/m³'
      }
    ]
  }
};


// ============================================================
// HELPER ANGKA
// ============================================================

function toNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return number;
}

function round(value, digits = 2) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return Number(number.toFixed(digits));
}


// ============================================================
// KONVERSI CO
//
// Sensor saat ini mengirim CO dalam ppm.
// Baku mutu menggunakan µg/m³.
//
// Rumus pada kondisi 25°C dan 1 atm:
//
// mg/m³ = ppm × berat molekul / 24,45
// µg/m³ = ppm × berat molekul × 1000 / 24,45
//
// Berat molekul CO = 28,01 g/mol
// ============================================================

function convertCOPpmToUgM3(ppm) {
  const value = toNumber(ppm);

  if (value === null) {
    return null;
  }

  const molecularWeightCO = 28.01;
  const molarVolume = 24.45;

  const ugM3 = value * molecularWeightCO * 1000 / molarVolume;

  return round(ugM3, 2);
}


// ============================================================
// EVALUASI SATU NILAI RATA-RATA
//
// average      : nilai rata-rata hasil pengukuran
// standard     : konfigurasi periode dan batas
// dataComplete : apakah periode pengukuran sudah terpenuhi
// ============================================================

function evaluateAverage(average, standard, dataComplete) {
  const numericAverage = toNumber(average);

  if (numericAverage === null) {
    return {
      average: null,
      limit: standard.limit,
      unit: standard.unit,
      period: standard.label,
      period_hours: standard.hours,
      data_complete: false,
      status: 'Belum Ada Data',
      exceeds_limit: null,
      percentage_of_limit: null
    };
  }

  const percentage = standard.limit > 0
    ? round((numericAverage / standard.limit) * 100, 2)
    : null;

  if (!dataComplete) {
    return {
      average: round(numericAverage, 2),
      limit: standard.limit,
      unit: standard.unit,
      period: standard.label,
      period_hours: standard.hours,
      data_complete: false,
      status: 'Belum Cukup Data',
      exceeds_limit: null,
      percentage_of_limit: percentage
    };
  }

  const exceedsLimit = numericAverage > standard.limit;

  return {
    average: round(numericAverage, 2),
    limit: standard.limit,
    unit: standard.unit,
    period: standard.label,
    period_hours: standard.hours,
    data_complete: true,
    status: exceedsLimit
      ? 'Melebihi Baku Mutu'
      : 'Memenuhi Baku Mutu',
    exceeds_limit: exceedsLimit,
    percentage_of_limit: percentage
  };
}


// ============================================================
// EVALUASI PARAMETER
//
// Fungsi ini menerima nilai rata-rata yang sudah dihitung
// berdasarkan periode tertentu.
// ============================================================

function evaluateParameter(parameterKey, periodKey, average, dataComplete) {
  const parameter = BAKU_MUTU[parameterKey];

  if (!parameter) {
    throw new Error(`Parameter ${parameterKey} tidak ditemukan.`);
  }

  const standard = parameter.standards.find(
    (item) => item.key === periodKey
  );

  if (!standard) {
    throw new Error(
      `Periode ${periodKey} untuk parameter ${parameterKey} tidak ditemukan.`
    );
  }

  let evaluatedValue = average;
  let originalValue = average;
  let conversion = null;

  // CO dari sensor dikirim dalam ppm, sedangkan baku mutu µg/m³
  if (parameterKey === 'co') {
    evaluatedValue = convertCOPpmToUgM3(average);

    conversion = {
      original_value: round(originalValue, 4),
      original_unit: 'ppm',
      converted_value: evaluatedValue,
      converted_unit: 'µg/m³',
      condition: '25°C dan 1 atm'
    };
  }

  return {
    parameter: parameterKey,
    label: parameter.label,
    ...evaluateAverage(evaluatedValue, standard, dataComplete),
    conversion
  };
}


// ============================================================
// MENGAMBIL KONFIGURASI
// ============================================================

function getStandard(parameterKey, periodKey) {
  const parameter = BAKU_MUTU[parameterKey];

  if (!parameter) {
    return null;
  }

  return parameter.standards.find(
    (item) => item.key === periodKey
  ) || null;
}

function getAllStandards() {
  return BAKU_MUTU;
}


// ============================================================
// KESIMPULAN DARI HASIL PER PARAMETER
//
// Ini bukan kategori ISPU gabungan.
// Fungsi hanya mencatat parameter mana yang melebihi baku mutu.
// ============================================================

function buildConclusion(results) {
  const values = Array.isArray(results)
    ? results
    : Object.values(results || {});

  const exceeded = values.filter(
    (item) => item && item.status === 'Melebihi Baku Mutu'
  );

  const fulfilled = values.filter(
    (item) => item && item.status === 'Memenuhi Baku Mutu'
  );

  const incomplete = values.filter(
    (item) =>
      item &&
      (
        item.status === 'Belum Cukup Data' ||
        item.status === 'Belum Ada Data'
      )
  );

  if (values.length === 0) {
    return {
      status: 'Belum Ada Data',
      exceeded_parameters: [],
      fulfilled_parameters: [],
      incomplete_parameters: [],
      text: 'Belum ada data yang dapat dievaluasi.'
    };
  }

  const exceededLabels = exceeded.map(
    (item) => `${item.label} (${item.period})`
  );

  const fulfilledLabels = fulfilled.map(
    (item) => `${item.label} (${item.period})`
  );

  const incompleteLabels = incomplete.map(
    (item) => `${item.label} (${item.period})`
  );

  let text = '';

  if (exceededLabels.length > 0) {
    text +=
      `Parameter yang melebihi baku mutu adalah ` +
      `${exceededLabels.join(', ')}.`;
  } else if (fulfilledLabels.length > 0) {
    text +=
      'Tidak ditemukan parameter yang melebihi baku mutu pada periode pengukuran yang telah lengkap.';
  }

  if (incompleteLabels.length > 0) {
    text +=
      `${text ? ' ' : ''}` +
      `Evaluasi ${incompleteLabels.join(', ')} belum dapat disimpulkan karena periode pengukuran belum mencukupi.`;
  }

  return {
    status:
      exceededLabels.length > 0
        ? 'Terdapat Parameter Melebihi Baku Mutu'
        : incompleteLabels.length > 0
          ? 'Evaluasi Belum Lengkap'
          : 'Memenuhi Baku Mutu',

    exceeded_parameters: exceededLabels,
    fulfilled_parameters: fulfilledLabels,
    incomplete_parameters: incompleteLabels,
    text
  };
}


module.exports = {
  BAKU_MUTU,
  getStandard,
  getAllStandards,
  convertCOPpmToUgM3,
  evaluateAverage,
  evaluateParameter,
  buildConclusion
};