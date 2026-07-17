// CATATAN UNTUK MENJALANKAN ULANG:
// Jika script dijalankan dari repository GitHub, pastikan file ground truth pada folder data/ground_truth telah di-import ke Google Earth Engine dengan nama variable yang sama.
// vegetasi2023, nonVegetasi2023, vegetasi2024, nonVegetasi2024, vegetasi2025, nonVegetasi2025.

// ======================================================================
// ANALISIS PERUBAHAN VEGETASI KABUPATEN MERAUKE TAHUN 2023–2025
// Platform : Google Earth Engine
// Dataset  : Sentinel-2 Surface Reflectance Harmonized
// Metode   : Random Forest
// Kelas    : 0 = Non-Vegetasi, 1 = Vegetasi
//
// Catatan reproducibility:
// - Dataset, boundary, periode, cloud masking, feature stack, seed,
//   parameter Random Forest, dan parameter export ditulis eksplisit.
// - Ground truth harus tersedia sebagai Geometry Imports di GEE
//   atau disimpan sebagai asset/GeoJSON agar script dapat dijalankan ulang.
// ======================================================================


// ======================================================================
// 1. PARAMETER UTAMA PENELITIAN
// ======================================================================

var PARAMS = {
  // Dataset dan boundary
  koleksi: 'COPERNICUS/S2_SR_HARMONIZED',
  boundary_asset: 'projects/gis-raraklh/assets/boundry_merauke',

  // Periode citra tahunan
  periode_2023: ['2023-01-01', '2024-01-01'],
  periode_2024: ['2024-01-01', '2025-01-01'],
  periode_2025: ['2025-01-01', '2026-01-01'],

  // Preprocessing
  max_cloud_pct: 80,
  scl_removed: [3, 8, 9, 10, 11],
  metode_komposit: 'median',

  // Band Sentinel-2 yang digunakan
  bands_asli: ['B2', 'B3', 'B4', 'B8', 'B11', 'B12'],

  // Feature stack untuk model
  bands_model: [
    'B2', 'B3', 'B4', 'B8', 'B11', 'B12',
    'NDVI', 'NDWI', 'NDBI', 'NDMI'
  ],

  // Random Forest
  seed: 42,
  split_train: 0.7,
  n_trees: 100,

  // Resolusi
  resolusi_analisis_m: 10,
  resolusi_hitung_luas_m: 100,
  resolusi_vectorize_m: 100,

  // Parameter vectorisasi
  smoothing_radius_px: 1,
  simplify_tolerance: 15,
  min_area_ha_polygon: 0.5,

  // Folder export Google Drive
  folder_export: 'GEE_Merauke_UAS'
};

print('=== PARAMETER PENELITIAN ===', PARAMS);


// ======================================================================
// 2. WILAYAH KAJIAN / AREA OF INTEREST
// ======================================================================

var boundary = ee.FeatureCollection(PARAMS.boundary_asset);
Map.centerObject(boundary, 8);

// Menampilkan batas administratif Kabupaten Merauke
var boundaryLine = ee.Image().paint({
  featureCollection: boundary,
  color: 1,
  width: 2
});

Map.addLayer(boundaryLine, {palette: ['red']}, 'Boundary Merauke');
print('Boundary Merauke:', boundary);


// ======================================================================
// 3. PREPROCESSING CITRA SENTINEL-2
// Tahapan:
// 1) Filter citra berdasarkan boundary
// 2) Filter citra berdasarkan tanggal
// 3) Filter citra berdasarkan CLOUDY_PIXEL_PERCENTAGE
// 4) Cloud masking menggunakan band SCL
// 5) Pilih band B2, B3, B4, B8, B11, B12
// 6) Scaling reflektansi dengan membagi nilai piksel 10000
// 7) Median composite
// 8) Clip ke boundary Kabupaten Merauke
// ======================================================================

function maskS2clouds(image) {
  var scl = image.select('SCL');

  // Kelas SCL yang dihilangkan:
  // 3  = Cloud shadow
  // 8  = Cloud medium probability
  // 9  = Cloud high probability
  // 10 = Thin cirrus
  // 11 = Snow / ice
  var mask = scl.neq(3)
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10))
    .and(scl.neq(11));

  var scaledBands = image
    .select(PARAMS.bands_asli)
    .divide(10000);

  return scaledBands
    .updateMask(mask)
    .copyProperties(image, ['system:time_start']);
}

function getS2Composite(startDate, endDate, label) {
  var collection = ee.ImageCollection(PARAMS.koleksi)
    .filterBounds(boundary)
    .filterDate(startDate, endDate)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', PARAMS.max_cloud_pct))
    .map(maskS2clouds);

  print('Jumlah citra Sentinel-2 ' + label + ':', collection.size());

  var composite = collection
    .median()
    .clip(boundary);

  return composite;
}

// Membuat komposit tahunan
var s2_2023 = getS2Composite(
  PARAMS.periode_2023[0],
  PARAMS.periode_2023[1],
  '2023'
);

var s2_2024 = getS2Composite(
  PARAMS.periode_2024[0],
  PARAMS.periode_2024[1],
  '2024'
);

var s2_2025 = getS2Composite(
  PARAMS.periode_2025[0],
  PARAMS.periode_2025[1],
  '2025'
);


// ======================================================================
// 4. PENYUSUNAN FEATURE STACK
// Feature stack terdiri dari:
// - Band Sentinel-2: B2, B3, B4, B8, B11, B12
// - Indeks spektral: NDVI, NDWI, NDBI, NDMI
// ======================================================================

function addIndices(image) {
  var ndvi = image.normalizedDifference(['B8', 'B4']).rename('NDVI');
  var ndwi = image.normalizedDifference(['B3', 'B8']).rename('NDWI');
  var ndbi = image.normalizedDifference(['B11', 'B8']).rename('NDBI');
  var ndmi = image.normalizedDifference(['B8', 'B11']).rename('NDMI');

  return image
    .addBands(ndvi)
    .addBands(ndwi)
    .addBands(ndbi)
    .addBands(ndmi);
}

var featureStack2023 = addIndices(s2_2023);
var featureStack2024 = addIndices(s2_2024);
var featureStack2025 = addIndices(s2_2025);

var bands = PARAMS.bands_model;

print('Feature stack bands:', bands);


// ======================================================================
// 5. VISUALISASI AWAL UNTUK INTERPRETASI DAN GROUND TRUTH
// Layer ini dipakai untuk membantu interpretasi visual saat membuat
// titik sampel vegetasi dan non-vegetasi.
// ======================================================================

var rgbVis = {
  bands: ['B4', 'B3', 'B2'],
  min: 0,
  max: 0.3
};

var fcirVis = {
  bands: ['B8', 'B4', 'B3'],
  min: 0,
  max: 0.4
};

var ndviVis = {
  min: -0.2,
  max: 0.8,
  palette: ['brown', 'yellow', 'lightgreen', 'green', 'darkgreen']
};

Map.addLayer(s2_2023, rgbVis, 'RGB Natural 2023', false);
Map.addLayer(s2_2024, rgbVis, 'RGB Natural 2024', false);
Map.addLayer(s2_2025, rgbVis, 'RGB Natural 2025', false);

Map.addLayer(s2_2023, fcirVis, 'False Color IR 2023', false);
Map.addLayer(s2_2024, fcirVis, 'False Color IR 2024', false);
Map.addLayer(s2_2025, fcirVis, 'False Color IR 2025', false);

Map.addLayer(featureStack2023.select('NDVI'), ndviVis, 'NDVI 2023', false);
Map.addLayer(featureStack2024.select('NDVI'), ndviVis, 'NDVI 2024', false);
Map.addLayer(featureStack2025.select('NDVI'), ndviVis, 'NDVI 2025', false);


// ======================================================================
// 6. GROUND TRUTH
// Ground truth dibuat secara manual di GEE berdasarkan interpretasi visual.
// Kelas:
// 0 = Non-Vegetasi
// 1 = Vegetasi
//
// WAJIB ADA DI PANEL IMPORTS GEE:
// vegetasi2023
// nonVegetasi2023
// vegetasi2024
// nonVegetasi2024
// vegetasi2025
// nonVegetasi2025
//
// Untuk GitHub/reproducibility:
// simpan juga ground truth sebagai GeoJSON/Asset agar dosen dapat
// menjalankan ulang script tanpa membuat titik dari awal.
// ======================================================================

function pointsToFC(multiPoint, classValue, yearValue) {
  var coords = ee.List(multiPoint.coordinates());

  return ee.FeatureCollection(
    coords.map(function (coord) {
      return ee.Feature(
        ee.Geometry.Point(coord),
        {
          'class': classValue,
          'year': yearValue
        }
      );
    })
  );
}

// Konversi geometry MultiPoint menjadi FeatureCollection
var veg2023FC    = pointsToFC(vegetasi2023, 1, 2023);
var nonVeg2023FC = pointsToFC(nonVegetasi2023, 0, 2023);

var veg2024FC    = pointsToFC(vegetasi2024, 1, 2024);
var nonVeg2024FC = pointsToFC(nonVegetasi2024, 0, 2024);

var veg2025FC    = pointsToFC(vegetasi2025, 1, 2025);
var nonVeg2025FC = pointsToFC(nonVegetasi2025, 0, 2025);

// =====================================================
// EXPORT GROUND TRUTH KE CSV
// CSV berisi year, class, class_name, longitude, latitude
// Format ini memudahkan pengecekan titik sampel di Excel/GitHub.
// =====================================================

function addLonLatAndLabel(feature) {
  var coords = feature.geometry().coordinates();
  var classValue = ee.Number(feature.get('class'));

  var className = ee.Algorithms.If(
    classValue.eq(1),
    'Vegetasi',
    'Non-Vegetasi'
  );

  return feature.set({
    'longitude': coords.get(0),
    'latitude': coords.get(1),
    'class_name': className
  });
}

var groundTruthAll = veg2023FC
  .merge(nonVeg2023FC)
  .merge(veg2024FC)
  .merge(nonVeg2024FC)
  .merge(veg2025FC)
  .merge(nonVeg2025FC)
  .map(addLonLatAndLabel);

Export.table.toDrive({
  collection: groundTruthAll,
  description: 'CSV_Ground_Truth_Merauke_2023_2025',
  folder: 'GEE_Merauke_UAS',
  fileNamePrefix: 'ground_truth_merauke_2023_2025',
  fileFormat: 'CSV',
  selectors: ['year', 'class', 'class_name', 'longitude', 'latitude']
});


// =====================================================
// EXPORT GROUND TRUTH UNTUK REPRODUCIBILITY
// File ini diperlukan agar titik sampel dapat dicek ulang
// dan tidak hanya tersimpan sebagai Geometry Imports di GEE.
// =====================================================

Export.table.toDrive({
  collection: veg2023FC,
  description: 'GT_Vegetasi_2023',
  folder: 'GEE_Merauke_UAS',
  fileNamePrefix: 'gt_vegetasi_2023',
  fileFormat: 'GeoJSON'
});

Export.table.toDrive({
  collection: nonVeg2023FC,
  description: 'GT_NonVegetasi_2023',
  folder: 'GEE_Merauke_UAS',
  fileNamePrefix: 'gt_non_vegetasi_2023',
  fileFormat: 'GeoJSON'
});

Export.table.toDrive({
  collection: veg2024FC,
  description: 'GT_Vegetasi_2024',
  folder: 'GEE_Merauke_UAS',
  fileNamePrefix: 'gt_vegetasi_2024',
  fileFormat: 'GeoJSON'
});

Export.table.toDrive({
  collection: nonVeg2024FC,
  description: 'GT_NonVegetasi_2024',
  folder: 'GEE_Merauke_UAS',
  fileNamePrefix: 'gt_non_vegetasi_2024',
  fileFormat: 'GeoJSON'
});

Export.table.toDrive({
  collection: veg2025FC,
  description: 'GT_Vegetasi_2025',
  folder: 'GEE_Merauke_UAS',
  fileNamePrefix: 'gt_vegetasi_2025',
  fileFormat: 'GeoJSON'
});

Export.table.toDrive({
  collection: nonVeg2025FC,
  description: 'GT_NonVegetasi_2025',
  folder: 'GEE_Merauke_UAS',
  fileNamePrefix: 'gt_non_vegetasi_2025',
  fileFormat: 'GeoJSON'
});

// =====================================================
// EXPORT BOUNDARY MERAUKE UNTUK REPRODUCIBILITY
// Boundary diekspor agar batas wilayah kajian dapat dicek ulang.
// =====================================================

Export.table.toDrive({
  collection: boundary,
  description: 'Boundary_Merauke',
  folder: 'GEE_Merauke_UAS',
  fileNamePrefix: 'boundary_merauke',
  fileFormat: 'GeoJSON'
});


// ======================================================================
// 7. SAMPLING NILAI PIXEL BERDASARKAN GROUND TRUTH
// Setiap titik ground truth mengambil nilai feature stack pada tahun
// yang sesuai.
// ======================================================================

function sampleFromYear(featureStack, fc, yearLabel) {
  var sampled = featureStack
    .select(bands)
    .sampleRegions({
      collection: fc,
      properties: ['class', 'year'],
      scale: PARAMS.resolusi_analisis_m,
      geometries: true
    });

  // Menghapus sampel yang memiliki nilai null akibat mask awan/NoData
  sampled = sampled.filter(ee.Filter.notNull(bands));

  print('Jumlah sample valid ' + yearLabel + ':', sampled.size());

  return sampled;
}

var sample_veg2023    = sampleFromYear(featureStack2023, veg2023FC, 'Vegetasi 2023');
var sample_nonVeg2023 = sampleFromYear(featureStack2023, nonVeg2023FC, 'Non-Vegetasi 2023');

var sample_veg2024    = sampleFromYear(featureStack2024, veg2024FC, 'Vegetasi 2024');
var sample_nonVeg2024 = sampleFromYear(featureStack2024, nonVeg2024FC, 'Non-Vegetasi 2024');

var sample_veg2025    = sampleFromYear(featureStack2025, veg2025FC, 'Vegetasi 2025');
var sample_nonVeg2025 = sampleFromYear(featureStack2025, nonVeg2025FC, 'Non-Vegetasi 2025');


// ======================================================================
// 8. SPLIT DATA TRAINING DAN TESTING
// Split dilakukan 70:30 untuk setiap kombinasi kelas dan tahun.
// Seed dibuat tetap agar hasil pembagian data dapat direproduksi.
// ======================================================================

function splitTrainTest(fc) {
  var withRandom = fc.randomColumn('random', PARAMS.seed);

  return {
    train: withRandom.filter(ee.Filter.lt('random', PARAMS.split_train)),
    test: withRandom.filter(ee.Filter.gte('random', PARAMS.split_train))
  };
}

var split_veg2023    = splitTrainTest(sample_veg2023);
var split_nonVeg2023 = splitTrainTest(sample_nonVeg2023);

var split_veg2024    = splitTrainTest(sample_veg2024);
var split_nonVeg2024 = splitTrainTest(sample_nonVeg2024);

var split_veg2025    = splitTrainTest(sample_veg2025);
var split_nonVeg2025 = splitTrainTest(sample_nonVeg2025);

var trainingData = split_veg2023.train
  .merge(split_nonVeg2023.train)
  .merge(split_veg2024.train)
  .merge(split_nonVeg2024.train)
  .merge(split_veg2025.train)
  .merge(split_nonVeg2025.train);

var testingData = split_veg2023.test
  .merge(split_nonVeg2023.test)
  .merge(split_veg2024.test)
  .merge(split_nonVeg2024.test)
  .merge(split_veg2025.test)
  .merge(split_nonVeg2025.test);

print('Total Training Data:', trainingData.size());
print('Total Testing Data:', testingData.size());


// ======================================================================
// 9. KLASIFIKASI RANDOM FOREST
// Satu model Random Forest digunakan untuk seluruh tahun agar hasil
// klasifikasi 2023, 2024, dan 2025 konsisten.
// ======================================================================

var rfModel = ee.Classifier
  .smileRandomForest({
    numberOfTrees: PARAMS.n_trees,
    seed: PARAMS.seed
  })
  .train({
    features: trainingData,
    classProperty: 'class',
    inputProperties: bands
  });

function classifyYear(featureStack) {
  return featureStack
    .select(bands)
    .classify(rfModel)
    .rename('classification')
    .clip(boundary);
}

var classified2023 = classifyYear(featureStack2023);
var classified2024 = classifyYear(featureStack2024);
var classified2025 = classifyYear(featureStack2025);

var classVis = {
  min: 0,
  max: 1,
  palette: ['orange', 'green']
};

Map.addLayer(classified2023, classVis, 'Klasifikasi Vegetasi 2023', false);
Map.addLayer(classified2024, classVis, 'Klasifikasi Vegetasi 2024', false);
Map.addLayer(classified2025, classVis, 'Klasifikasi Vegetasi 2025', true);


// ======================================================================
// 10. EVALUASI MODEL
// Evaluasi dilakukan hanya menggunakan data testing.
// Metrik yang dihitung:
// - Confusion Matrix
// - Overall Accuracy
// - Precision kelas target 1
// - Recall kelas target 1
// - F1-score kelas target 1
// ======================================================================

var validated = testingData.classify(rfModel);

var confusionMatrix = validated.errorMatrix(
  'class',
  'classification',
  [0, 1]
);

print('Confusion Matrix Testing (order 0,1):', confusionMatrix);
print('Overall Accuracy Testing:', confusionMatrix.accuracy());

var cmArray = confusionMatrix.array();

var TN = cmArray.get([0, 0]);
var FP = cmArray.get([0, 1]);
var FN = cmArray.get([1, 0]);
var TP = cmArray.get([1, 1]);

var precisionTarget = ee.Number(TP)
  .divide(ee.Number(TP).add(FP));

var recallTarget = ee.Number(TP)
  .divide(ee.Number(TP).add(FN));

var f1Target = precisionTarget
  .multiply(recallTarget)
  .multiply(2)
  .divide(precisionTarget.add(recallTarget));

print('Precision Target/Vegetasi:', precisionTarget);
print('Recall Target/Vegetasi:', recallTarget);
print('F1-score Target/Vegetasi:', f1Target);


// ======================================================================
// 11. CEK OVERFITTING
// Overfitting dicek dengan membandingkan akurasi training dan testing.
// Gap kecil menunjukkan model relatif stabil.
// ======================================================================

var trainValidated = trainingData.classify(rfModel);

var trainConfusionMatrix = trainValidated.errorMatrix(
  'class',
  'classification',
  [0, 1]
);

var trainingAccuracy = trainConfusionMatrix.accuracy();
var testingAccuracy = confusionMatrix.accuracy();
var accuracyGap = trainingAccuracy.subtract(testingAccuracy);

print('Confusion Matrix Training:', trainConfusionMatrix);
print('Training Accuracy (%):', trainingAccuracy.multiply(100));
print('Testing Accuracy (%):', testingAccuracy.multiply(100));
print('Gap Training vs Testing Accuracy (%):', accuracyGap.multiply(100));


// ======================================================================
// 12. CHANGE DETECTION
// Change map dibuat dengan membandingkan hasil klasifikasi dua tahun.
//
// Kode klasifikasi:
// 0 = Non-Vegetasi
// 1 = Vegetasi
//
// Kode perubahan:
// 0 = 0 -> 0 = Tetap Non-Vegetasi
// 1 = 1 -> 0 = Vegetation Loss
// 2 = 0 -> 1 = Vegetation Gain
// 3 = 1 -> 1 = Tetap Vegetasi
//
// Catatan:
// Menggunakan remap agar area NoData/masked tidak otomatis menjadi kelas 0.
// ======================================================================

function buildChangeMap(imgBefore, imgAfter) {
  var raw = imgBefore
    .multiply(10)
    .add(imgAfter);

  var change = raw
    .remap(
      [0, 10, 1, 11],
      [0, 1, 2, 3]
    )
    .rename('change_class')
    .clip(boundary);

  return change;
}

var changeClass_2023_2024 = buildChangeMap(classified2023, classified2024);
var changeClass_2024_2025 = buildChangeMap(classified2024, classified2025);
var changeClass_2023_2025 = buildChangeMap(classified2023, classified2025);

var changeVis = {
  min: 0,
  max: 3,
  palette: ['gray', 'red', 'blue', 'green']
};

Map.addLayer(changeClass_2023_2024, changeVis, 'Perubahan Vegetasi 2023-2024', false);
Map.addLayer(changeClass_2024_2025, changeVis, 'Perubahan Vegetasi 2024-2025', false);
Map.addLayer(changeClass_2023_2025, changeVis, 'Perubahan Vegetasi 2023-2025', true);


// ======================================================================
// 13. PERHITUNGAN LUAS VEGETASI DAN PERUBAHAN
// Luas dihitung menggunakan ee.Image.pixelArea() dan dikonversi ke hektare.
// Untuk mengurangi beban komputasi, perhitungan luas menggunakan scale 100 m.
// ======================================================================

var luasWilayahHa = ee.Number(
  boundary.geometry()
    .area({maxError: 100})
    .divide(10000)
);

print('Luas total wilayah Merauke (ha):', luasWilayahHa);

function luasVegetasi(image, tahun) {
  var area = image
    .eq(1)
    .multiply(ee.Image.pixelArea())
    .divide(10000)
    .rename('luas_ha');

  var total = area.reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: boundary.geometry(),
    scale: PARAMS.resolusi_hitung_luas_m,
    maxPixels: 1e13,
    tileScale: 8,
    bestEffort: true
  });

  var luasHa = ee.Number(total.get('luas_ha'));
  var persen = luasHa.divide(luasWilayahHa).multiply(100);

  print('Luas vegetasi ' + tahun + ' (ha):', luasHa);
  print('Persentase vegetasi ' + tahun + ' (%):', persen);

  return {
    luas: luasHa,
    persen: persen
  };
}

var luas2023 = luasVegetasi(classified2023, '2023');
var luas2024 = luasVegetasi(classified2024, '2024');
var luas2025 = luasVegetasi(classified2025, '2025');

function luasPerubahan(changeImg, label) {
  var areaChange = ee.Image
    .pixelArea()
    .divide(10000)
    .rename('luas_ha')
    .addBands(changeImg.rename('kelas'));

  var stats = areaChange.reduceRegion({
    reducer: ee.Reducer.sum().group({
      groupField: 1,
      groupName: 'kelas'
    }),
    geometry: boundary.geometry(),
    scale: PARAMS.resolusi_hitung_luas_m,
    maxPixels: 1e13,
    tileScale: 8,
    bestEffort: true
  });

  print('Luas tiap kelas perubahan ' + label + ' (ha):', stats);

  return stats;
}

var luasChange_2023_2024 = luasPerubahan(changeClass_2023_2024, '2023-2024');
var luasChange_2024_2025 = luasPerubahan(changeClass_2024_2025, '2024-2025');
var luasChange_2023_2025 = luasPerubahan(changeClass_2023_2025, '2023-2025');

function printNetChange(luasAwal, luasAkhir, labelAwal, labelAkhir) {
  var netChange = luasAkhir.luas.subtract(luasAwal.luas);
  var pctChange = netChange.divide(luasAwal.luas).multiply(100);

  print('Net change vegetasi ' + labelAwal + '->' + labelAkhir + ' (ha):', netChange);
  print('Persentase perubahan vegetasi ' + labelAwal + '->' + labelAkhir + ' (%):', pctChange);
}

printNetChange(luas2023, luas2024, '2023', '2024');
printNetChange(luas2024, luas2025, '2024', '2025');
printNetChange(luas2023, luas2025, '2023', '2025');


// ======================================================================
// 14. VECTORIZE DAN EXPORT GEOJSON
// Vectorize dilakukan untuk menghasilkan polygon target vegetasi,
// gain, dan loss. Agar proses lebih ringan, dilakukan smoothing sederhana,
// simplifikasi geometry, dan filter polygon kecil.
// ======================================================================

function smoothBinary(binaryImage, radius) {
  var opened = binaryImage
    .focal_min(radius)
    .focal_max(radius);

  var closed = opened
    .focal_max(radius)
    .focal_min(radius);

  return closed;
}

function cleanAndVectorize(binaryImage, label, yearOrCategory) {
  var smoothed = smoothBinary(
      binaryImage,
      PARAMS.smoothing_radius_px
    )
    .selfMask();

  var vectors = smoothed.reduceToVectors({
    geometry: boundary.geometry(),
    scale: PARAMS.resolusi_vectorize_m,
    geometryType: 'polygon',
    eightConnected: true,
    labelProperty: 'value',
    maxPixels: 1e13,
    tileScale: 16,
    bestEffort: true
  });

  vectors = vectors.map(function (f) {
    var simplified = f
      .geometry()
      .simplify(PARAMS.simplify_tolerance);

    var areaHa = simplified
      .area({maxError: 10})
      .divide(10000);

    return ee.Feature(
      simplified,
      {
        'kategori': label,
        'tahun_atau_status': yearOrCategory,
        'luas_ha': areaHa
      }
    );
  });

  // Menghapus polygon kecil agar hasil lebih bersih
  vectors = vectors.filter(
    ee.Filter.gte('luas_ha', PARAMS.min_area_ha_polygon)
  );

  return vectors;
}

// Polygon target vegetasi per tahun
var vec_target2023 = cleanAndVectorize(
  classified2023.eq(1),
  'target_vegetasi',
  '2023'
);

var vec_target2024 = cleanAndVectorize(
  classified2024.eq(1),
  'target_vegetasi',
  '2024'
);

var vec_target2025 = cleanAndVectorize(
  classified2025.eq(1),
  'target_vegetasi',
  '2025'
);

// Polygon gain dan loss tiap periode
var vec_gain_2023_2024 = cleanAndVectorize(
  changeClass_2023_2024.eq(2),
  'gain',
  '2023-2024'
);

var vec_loss_2023_2024 = cleanAndVectorize(
  changeClass_2023_2024.eq(1),
  'loss',
  '2023-2024'
);

var vec_gain_2024_2025 = cleanAndVectorize(
  changeClass_2024_2025.eq(2),
  'gain',
  '2024-2025'
);

var vec_loss_2024_2025 = cleanAndVectorize(
  changeClass_2024_2025.eq(1),
  'loss',
  '2024-2025'
);

var vec_gain_2023_2025 = cleanAndVectorize(
  changeClass_2023_2025.eq(2),
  'gain',
  '2023-2025'
);

var vec_loss_2023_2025 = cleanAndVectorize(
  changeClass_2023_2025.eq(1),
  'loss',
  '2023-2025'
);

Map.addLayer(vec_target2023, {color: 'darkgreen'}, 'Polygon Target Vegetasi 2023', false);
Map.addLayer(vec_target2024, {color: 'green'}, 'Polygon Target Vegetasi 2024', false);
Map.addLayer(vec_target2025, {color: 'lightgreen'}, 'Polygon Target Vegetasi 2025', false);

Map.addLayer(vec_gain_2023_2025, {color: 'blue'}, 'Polygon Gain 2023-2025', false);
Map.addLayer(vec_loss_2023_2025, {color: 'red'}, 'Polygon Loss 2023-2025', false);


// ======================================================================
// 15. EXPORT GEOJSON KE GOOGLE DRIVE
// Output ini dapat digunakan untuk WebGIS/QGIS.
// ======================================================================

function exportTableToDrive(collection, description, fileNamePrefix) {
  Export.table.toDrive({
    collection: collection,
    description: description,
    folder: PARAMS.folder_export,
    fileNamePrefix: fileNamePrefix,
    fileFormat: 'GeoJSON'
  });
}

exportTableToDrive(vec_target2023, 'GeoJSON_Target_Vegetasi_2023', 'target_vegetasi_2023');
exportTableToDrive(vec_target2024, 'GeoJSON_Target_Vegetasi_2024', 'target_vegetasi_2024');
exportTableToDrive(vec_target2025, 'GeoJSON_Target_Vegetasi_2025', 'target_vegetasi_2025');

exportTableToDrive(vec_gain_2023_2024, 'GeoJSON_Gain_2023_2024', 'gain_vegetasi_2023_2024');
exportTableToDrive(vec_loss_2023_2024, 'GeoJSON_Loss_2023_2024', 'loss_vegetasi_2023_2024');

exportTableToDrive(vec_gain_2024_2025, 'GeoJSON_Gain_2024_2025', 'gain_vegetasi_2024_2025');
exportTableToDrive(vec_loss_2024_2025, 'GeoJSON_Loss_2024_2025', 'loss_vegetasi_2024_2025');

exportTableToDrive(vec_gain_2023_2025, 'GeoJSON_Gain_2023_2025', 'gain_vegetasi_2023_2025');
exportTableToDrive(vec_loss_2023_2025, 'GeoJSON_Loss_2023_2025', 'loss_vegetasi_2023_2025');


// ======================================================================
// 16. EXPORT RASTER KE GOOGLE DRIVE
// Output raster digunakan untuk QGIS, layout peta, dan WebGIS.
// ======================================================================

function exportImageToDrive(image, description, fileNamePrefix) {
  Export.image.toDrive({
    image: image,
    description: description,
    folder: PARAMS.folder_export,
    fileNamePrefix: fileNamePrefix,
    region: boundary.geometry(),
    scale: PARAMS.resolusi_analisis_m,
    maxPixels: 1e13
  });
}

exportImageToDrive(
  classified2023,
  'Klasifikasi_2023',
  'Klasifikasi_Vegetasi_Merauke_2023'
);

exportImageToDrive(
  classified2024,
  'Klasifikasi_2024',
  'Klasifikasi_Vegetasi_Merauke_2024'
);

exportImageToDrive(
  classified2025,
  'Klasifikasi_2025',
  'Klasifikasi_Vegetasi_Merauke_2025'
);

exportImageToDrive(
  changeClass_2023_2024,
  'Perubahan_2023_2024',
  'Perubahan_Vegetasi_2023_2024'
);

exportImageToDrive(
  changeClass_2024_2025,
  'Perubahan_2024_2025',
  'Perubahan_Vegetasi_2024_2025'
);

exportImageToDrive(
  changeClass_2023_2025,
  'Perubahan_2023_2025',
  'Perubahan_Vegetasi_2023_2025'
);


// ======================================================================
// SELESAI
// Setelah script dijalankan, buka tab Tasks untuk menjalankan export.
// ======================================================================
