# Dashboard Mitigasi Risiko Koperasi

Dashboard interaktif untuk memonitor kualitas & risiko koperasi berbasis Excel.

## Fitur Utama

- Upload file Excel (.xlsx)
- Klasifikasi otomatis: Berkualitas, Cukup Berkualitas, Tidak Berkualitas, Belum Diklasifikasi
- Saran mitigasi otomatis berdasarkan status & sektor
- Grafik:
  - Status Risiko (Bar Chart)
  - Sektor Usaha (Horizontal Bar)
- Peta Indonesia interaktif (Leaflet + GeoJSON):
  - Warna provinsi berdasarkan jumlah koperasi bermasalah
  - Hover: total koperasi & jumlah bermasalah
  - Klik provinsi → filter tabel & grafik
- Data tersimpan di browser (localStorage) + bisa di-download kembali sebagai Excel.

## Tech Stack

- HTML, CSS, JavaScript (vanilla)
- Chart.js
- Leaflet.js
- SheetJS (XLSX)
- GitHub Pages
