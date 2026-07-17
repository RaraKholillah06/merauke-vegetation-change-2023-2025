## Google Earth Engine Script

Script Google Earth Engine dapat diakses melalui link berikut:

https://code.earthengine.google.com/70f20368c78ae95d7b580d81c9451e00

Catatan: Link GEE ini digunakan untuk melihat snapshot kode. Agar script dapat dijalankan ulang secara lengkap.

# Analisis Perubahan Vegetasi Kabupaten Merauke Tahun 2023–2025

Repository ini berisi kode dan data pendukung untuk analisis perubahan vegetasi Kabupaten Merauke, Provinsi Papua Selatan, tahun 2023–2025 menggunakan citra Sentinel-2 Surface Reflectance Harmonized, algoritma Random Forest, dan Google Earth Engine.

## Wilayah Kajian

Wilayah kajian pada penelitian ini adalah Kabupaten Merauke, Provinsi Papua Selatan. Boundary wilayah kajian tersedia pada folder `data/boundary/`.

## Dataset

Dataset utama yang digunakan adalah Sentinel-2 Surface Reflectance Harmonized dengan koleksi Google Earth Engine:

`COPERNICUS/S2_SR_HARMONIZED`

Periode citra yang digunakan:
- 2023: 1 Januari 2023 – 1 Januari 2024
- 2024: 1 Januari 2024 – 1 Januari 2025
- 2025: 1 Januari 2025 – 1 Januari 2026

## Kelas Klasifikasi

Klasifikasi dilakukan secara biner dengan dua kelas:

- 0 = Non-Vegetasi
- 1 = Vegetasi

## Feature Stack

Fitur yang digunakan dalam model Random Forest terdiri dari:

- B2
- B3
- B4
- B8
- B11
- B12
- NDVI
- NDWI
- NDBI
- NDMI

## Metode

Tahapan analisis meliputi:

1. Penentuan boundary Kabupaten Merauke sebagai area of interest.
2. Pengambilan citra Sentinel-2 tahun 2023, 2024, dan 2025.
3. Cloud masking menggunakan band SCL.
4. Pembuatan median composite tahunan.
5. Penyusunan feature stack.
6. Pembuatan ground truth vegetasi dan non-vegetasi.
7. Split data training dan testing 70:30 dengan seed 42.
8. Klasifikasi menggunakan Random Forest.
9. Evaluasi model menggunakan confusion matrix, accuracy, precision, recall, dan F1-score.
10. Analisis perubahan vegetasi 2023–2024, 2024–2025, dan 2023–2025.
11. Export hasil raster dan GeoJSON untuk QGIS dan WebGIS.

## Struktur Repository

```text
gee/
  merauke_vegetation_change_2023_2025.js

data/
  boundary/
    boundary_merauke.geojson

  ground_truth/
    ground_truth_merauke_2023_2025.csv
    gt_vegetasi_2023.geojson
    gt_non_vegetasi_2023.geojson
    gt_vegetasi_2024.geojson
    gt_non_vegetasi_2024.geojson
    gt_vegetasi_2025.geojson
    gt_non_vegetasi_2025.geojson

## Reproducibility

Repository ini disusun untuk mendukung reproducibility, sehingga kode dan data pendukung dapat diperiksa serta digunakan ulang. Kode Google Earth Engine tersedia pada folder `gee/`, sedangkan data boundary dan ground truth tersedia pada folder `data/`.

Script GEE menggunakan Geometry Imports untuk ground truth dan asset boundary. Agar script dapat dijalankan ulang, pengguna perlu meng-import file pada folder `data/ground_truth/` dan `data/boundary/` ke Google Earth Engine, lalu menyesuaikan nama variable sesuai yang tertulis pada script.

Nama variable ground truth yang digunakan dalam script adalah:

- `vegetasi2023`
- `nonVegetasi2023`
- `vegetasi2024`
- `nonVegetasi2024`
- `vegetasi2025`
- `nonVegetasi2025`

Ground truth juga disediakan dalam format CSV berisi atribut `year`, `class`, `class_name`, `longitude`, dan `latitude`, sehingga titik sampel dapat diperiksa ulang secara tabular.
