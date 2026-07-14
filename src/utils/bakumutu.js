// ============================================================
// utils/bakumutu.js
//
// Evaluasi Baku Mutu Udara Ambien
// Lampiran VII PP Republik Indonesia Nomor 22 Tahun 2021
//
// Sistem ini tidak menghitung ISPU.
// Setiap parameter dievaluasi secara terpisah berdasarkan:
// - rata-rata konsentrasi;
// - periode pengukuran;
// - nilai baku mutu.
//
// Status:
// - Memenuhi Baku Mutu
// - Melebihi Baku Mutu
// - Belum Cukup Data
// - Belum Ada Data
// ============================================================


// ============================================================
// BAKU MUTU YANG DIGUNAKAN
//
// Batas tahunan belum digunakan karena sistem inspeksi
// belum mengumpulkan data selama satu tahun penuh.
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
  // Jangan menganggap null, undefined, atau string kosong
  // sebagai angka nol.
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return number;
}


function round(value, digits = 2) {
  const number = toNumber(value);

  if (number === null) {
    return null;
  }

  return Number(number.toFixed(digits));
}


// ============================================================
// KONVERSI CO
//
// Sensor mengirim CO dalam ppm.
// Baku mutu menggunakan µg/m³.
//
// Kondisi:
// - temperatur 25°C;
// - tekanan 1 atm.
//
// Rumus:
//
// mg/m³ = ppm × berat molekul / 24,45
// µg/m³ = ppm × berat molekul × 1000 / 24,45
//
// Berat molekul CO = 28,01 g/mol.
// ============================================================

function convertCOPpmToUgM3(ppm) {
  const value = toNumber(ppm);

  if (value === null) {
    return null;
  }

  const molecularWeightCO = 28.01;
  const molarVolume = 24.45;

  const ugM3 =
    (
      value *
      molecularWeightCO *
      1000
    ) / molarVolume;

  return round(ugM3, 2);
}


// ============================================================
// EVALUASI SATU NILAI RATA-RATA
//
// average:
// Nilai rata-rata pada periode yang dievaluasi.
//
// standard:
// Konfigurasi periode dan batas baku mutu.
//
// dataComplete:
// Menunjukkan apakah durasi data sudah memenuhi periode
// pengukuran yang diwajibkan.
// ============================================================

function evaluateAverage(
  average,
  standard,
  dataComplete
) {
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

  const percentage =
    standard.limit > 0
      ? round(
          (
            numericAverage /
            standard.limit
          ) * 100,
          2
        )
      : null;

  if (!dataComplete) {
    return {
      average: round(
        numericAverage,
        2
      ),

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

  const exceedsLimit =
    numericAverage > standard.limit;

  return {
    average: round(
      numericAverage,
      2
    ),

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
// EVALUASI SATU PARAMETER
//
// Fungsi menerima nilai rata-rata yang sebelumnya telah
// dihitung berdasarkan periode pengukuran.
// ============================================================

function evaluateParameter(
  parameterKey,
  periodKey,
  average,
  dataComplete
) {
  const parameter =
    BAKU_MUTU[parameterKey];

  if (!parameter) {
    throw new Error(
      `Parameter ${parameterKey} tidak ditemukan.`
    );
  }

  const standard =
    parameter.standards.find(
      (item) =>
        item.key === periodKey
    );

  if (!standard) {
    throw new Error(
      `Periode ${periodKey} untuk parameter ` +
      `${parameterKey} tidak ditemukan.`
    );
  }

  const originalValue =
    toNumber(average);

  let evaluatedValue =
    originalValue;

  let conversion = null;


  // ==========================================================
  // KONVERSI CO
  //
  // Rata-rata CO dari database masih dalam ppm.
  // Nilai tersebut dikonversi ke µg/m³ sebelum dibandingkan
  // dengan baku mutu.
  // ==========================================================

  if (parameterKey === 'co') {
    evaluatedValue =
      convertCOPpmToUgM3(
        originalValue
      );

    conversion = {
      original_value:
        round(originalValue, 4),

      original_unit: 'ppm',

      converted_value:
        evaluatedValue,

      converted_unit: 'µg/m³',

      condition:
        '25°C dan 1 atm'
    };
  }

  return {
    parameter: parameterKey,
    label: parameter.label,

    ...evaluateAverage(
      evaluatedValue,
      standard,
      dataComplete
    ),

    conversion
  };
}


// ============================================================
// MENGAMBIL SATU KONFIGURASI BAKU MUTU
// ============================================================

function getStandard(
  parameterKey,
  periodKey
) {
  const parameter =
    BAKU_MUTU[parameterKey];

  if (!parameter) {
    return null;
  }

  return (
    parameter.standards.find(
      (item) =>
        item.key === periodKey
    ) || null
  );
}


// ============================================================
// MENGAMBIL SEMUA KONFIGURASI BAKU MUTU
// ============================================================

function getAllStandards() {
  return BAKU_MUTU;
}


// ============================================================
// MEMBANGUN KESIMPULAN
//
// Kesimpulan ini bukan ISPU gabungan.
//
// Fungsi hanya mencatat:
// - parameter yang melebihi baku mutu;
// - parameter yang memenuhi baku mutu;
// - parameter yang belum cukup data;
// - parameter yang belum memiliki data.
// ============================================================

function buildConclusion(results) {
  const values =
    Array.isArray(results)
      ? results
      : Object.values(
          results || {}
        );

  if (values.length === 0) {
    return {
      status: 'Belum Ada Data',

      exceeded_parameters: [],
      fulfilled_parameters: [],
      incomplete_parameters: [],
      no_data_parameters: [],

      text:
        'Belum ada data yang dapat dievaluasi.'
    };
  }

  const exceeded =
    values.filter(
      (item) =>
        item &&
        item.status ===
          'Melebihi Baku Mutu'
    );

  const fulfilled =
    values.filter(
      (item) =>
        item &&
        item.status ===
          'Memenuhi Baku Mutu'
    );

  const incomplete =
    values.filter(
      (item) =>
        item &&
        item.status ===
          'Belum Cukup Data'
    );

  const noData =
    values.filter(
      (item) =>
        item &&
        item.status ===
          'Belum Ada Data'
    );


  const exceededLabels =
    exceeded.map(
      (item) =>
        `${item.label} (${item.period})`
    );

  const fulfilledLabels =
    fulfilled.map(
      (item) =>
        `${item.label} (${item.period})`
    );

  const incompleteLabels =
    incomplete.map(
      (item) =>
        `${item.label} (${item.period})`
    );

  const noDataLabels =
    noData.map(
      (item) =>
        `${item.label} (${item.period})`
    );


  // Jika seluruh hasil tidak memiliki data.
  if (
    noDataLabels.length ===
    values.length
  ) {
    return {
      status: 'Belum Ada Data',

      exceeded_parameters: [],
      fulfilled_parameters: [],
      incomplete_parameters: [],
      no_data_parameters:
        noDataLabels,

      text:
        'Belum ada data sensor yang dapat dievaluasi.'
    };
  }


  const textParts = [];

  if (
    exceededLabels.length > 0
  ) {
    textParts.push(
      'Parameter yang melebihi baku mutu adalah ' +
      `${exceededLabels.join(', ')}.`
    );
  } else if (
    fulfilledLabels.length > 0
  ) {
    textParts.push(
      'Tidak ditemukan parameter yang melebihi baku mutu ' +
      'pada periode pengukuran yang telah lengkap.'
    );
  }

  if (
    incompleteLabels.length > 0
  ) {
    textParts.push(
      `Evaluasi ${incompleteLabels.join(', ')} ` +
      'belum dapat disimpulkan karena periode pengukuran ' +
      'belum mencukupi.'
    );
  }

  if (
    noDataLabels.length > 0
  ) {
    textParts.push(
      `Belum tersedia data untuk ${noDataLabels.join(', ')}.`
    );
  }


  let status;

  if (
    exceededLabels.length > 0
  ) {
    status =
      'Terdapat Parameter Melebihi Baku Mutu';
  } else if (
    incompleteLabels.length > 0 ||
    noDataLabels.length > 0
  ) {
    status =
      'Evaluasi Belum Lengkap';
  } else {
    status =
      'Memenuhi Baku Mutu';
  }


  return {
    status,

    exceeded_parameters:
      exceededLabels,

    fulfilled_parameters:
      fulfilledLabels,

    incomplete_parameters:
      incompleteLabels,

    no_data_parameters:
      noDataLabels,

    text:
      textParts.join(' ')
  };
}


// ============================================================
// EXPORT
// ============================================================

module.exports = {
  BAKU_MUTU,

  getStandard,
  getAllStandards,

  convertCOPpmToUgM3,

  evaluateAverage,
  evaluateParameter,

  buildConclusion
};