// ===== Global state =====
let allData = [];
let filteredData = [];
let statusChart, sektorChart;
let map, geoJsonLayer;

const filters = {
  propinsi: "",
  sektor: "",
  status: ""
};

// key untuk localStorage
const LOCAL_KEY = "koperasiDashboardData_v1";
// bikin kunci unik: NAMA KOPERASI + PROPINSI (dua2nya uppercase)
function makeRowKey(namaKoperasi, propinsiUpper) {
  return `${String(namaKoperasi).toUpperCase()}|${String(propinsiUpper).toUpperCase()}`;
}


// ===== Utils kolom =====
function getPropinsiRow(row) {
  // nama kolom baku
  if (row.Propinsi) return row.Propinsi;
  if (row.propinsi) return row.propinsi;
  if (row.PROPINSI) return row.PROPINSI;

  // fallback: scan semua key yang mengandung "provinsi"/"propinsi"
  for (const key of Object.keys(row)) {
    const norm = key.toString().toLowerCase().replace(/\s+/g, "");
    if (norm.includes("provinsi") || norm.includes("propinsi")) {
      return row[key];
    }
  }

  return "";
}

function getSektorRow(row) {
  return (
    row.GroupSektorUsaha ||
    row["Group Sektor Usaha"] ||
    row["Sektor Usaha"] ||
    row.Sektor ||
    ""
  );
}

// ===== Buat saran mitigasi sederhana berdasarkan status + sektor =====
function generateMitigationSuggestion(info) {
  const status = (info.status || "").toLowerCase();
  const sektor = (info.sektorUsaha || "").toLowerCase();
  const klas = (info.klasifikasi || "").toLowerCase(); // belum kepakai banyak tapi kita simpan aja

  // 1. Belum Diklasifikasi
  if (status.includes("belum diklasifikasi")) {
    return "Segera lakukan penilaian kesehatan koperasi (klasifikasi) dan lengkapi data laporan keuangan serta RAT.";
  }

  // 2. Tidak Berkualitas (risiko tinggi)
  if (status.includes("tidak berkualitas")) {
    if (sektor.includes("keuangan") || sektor.includes("asuransi") || sektor.includes("simpan pinjam")) {
      return "Lakukan pendampingan intensif: audit keuangan, penagihan piutang bermasalah, penyusunan rencana perbaikan tata kelola, serta pembekuan sementara layanan berisiko tinggi.";
    }
    if (sektor.includes("perdagangan")) {
      return "Evaluasi manajemen stok dan arus kas, hentikan sementara kontrak yang merugikan, serta susun ulang rencana usaha dan pemasaran.";
    }
    if (sektor.includes("pertanian") || sektor.includes("perikanan")) {
      return "Perkuat pendampingan usaha anggota, evaluasi skema pembiayaan, dan cari dukungan program dari dinas terkait.";
    }
    // default
    return "Susun rencana aksi perbaikan menyeluruh: tata kelola, keuangan, kepatuhan RAT, dan perkuat peran pengurus/pengawas.";
  }

  // 3. Cukup Berkualitas (kuning)
  if (status.includes("cukup berkualitas")) {
    if (sektor.includes("keuangan") || sektor.includes("asuransi")) {
      return "Perbaiki ketepatan penyampaian laporan keuangan, tingkatkan kualitas analisis kredit, dan lakukan pelatihan manajemen risiko bagi pengurus.";
    }
    if (sektor.includes("perdagangan")) {
      return "Optimalkan pencatatan penjualan dan stok, serta lakukan review margin dan biaya operasional secara berkala.";
    }
    if (sektor.includes("pertanian") || sektor.includes("perikanan")) {
      return "Perkuat pendampingan teknis usaha anggota dan tingkatkan ketepatan setoran/pengembalian dari anggota.";
    }
    return "Tingkatkan kepatuhan terhadap RAT, laporan keuangan, dan lakukan monitoring berkala agar naik menjadi Berkualitas.";
  }

  // 4. Berkualitas (hijau)
  if (status.includes("berkualitas")) {
    return "Pertahankan praktik baik yang sudah berjalan, dokumentasikan SOP, dan jadwalkan evaluasi rutin agar kualitas tetap terjaga.";
  }

  // 5. fallback kalau statusnya gak kebaca
  return "Lakukan monitoring berkala dan lengkapi data pendukung untuk penilaian risiko yang lebih akurat.";
}

// Normalisasi status (Hijau/Kuning/Merah → string baku)
function determineStatus(row) {
  // gabungkan semua info status yg mungkin ada
  const klasRaw = String(row.KlasifikasiKoperasi || row.Klasifikasi || "").toLowerCase();
  const statusRaw = String(row.Status || row.StatusRisiko || row["Status Risiko"] || "").toLowerCase();
  const ket = String(row.Keterangan || row.keterangan || row.KeteranganPermasalahan || "").toLowerCase();

  const text = (statusRaw || klasRaw || ket).toLowerCase();

  // 1. Belum diklasifikasi / belum dinilai
  if (text.includes("belum diklasifikasi") || text.includes("belum dinilai") || text.includes("belum")) {
    return "Belum Diklasifikasi";
  }

  // 2. Tidak berkualitas / bermasalah (merah)
  if (
    text.includes("tidak") ||
    text.includes("bermasalah") ||
    text.includes("merah") ||
    text.includes("buruk") ||
    text.includes("risiko tinggi")
  ) {
    return "Tidak Berkualitas";
  }

  // 3. Cukup berkualitas (kuning)
  if (text.includes("cukup") || text.includes("kuning") || text.includes("perlu perhatian")) {
    return "Cukup Berkualitas";
  }

  // 4. Berkualitas (hijau)
  if (text.includes("berkualitas") || text.includes("baik") || text.includes("sehat") || text.includes("hijau")) {
    return "Berkualitas";
  }

  // fallback, kalau benar-benar nggak ketemu apa-apa
  return "Cukup Berkualitas";
}

// ====== LocalStorage helper ======
function saveToLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(allData));
  } catch (e) {
    console.error("Gagal save ke localStorage", e);
  }
}

function loadFromLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    allData = parsed;
    filteredData = allData.slice();
    populateFilters();
    applyFilters();
  } catch (e) {
    console.error("Gagal load dari localStorage", e);
  }
}

// ===== File upload (APPEND + save) =====
document.getElementById("fileInput").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;

  document.getElementById("fileName").textContent = file.name;

  const reader = new FileReader();
  reader.onload = ev => {
    const data = new Uint8Array(ev.target.result);
    const workbook = XLSX.read(data, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });

    // mapping kolom → struktur dashboard
    const newData = jsonData.map(row => {
      const propinsiRaw = String(getPropinsiRow(row)).trim();
      const propinsiUpper = propinsiRaw.toUpperCase();

      const namaKoperasi =
        String(
          row.NamaKoperasi ||
          row["Koperasi"] ||
          row.Nama ||
          ""
        ).trim() || "Tidak Ada Nama";

      const klasifikasi = String(
        row.KlasifikasiKoperasi ||
        row.Klasifikasi ||
        row["Status Risiko"] ||
        ""
      ).trim();

      const sektorUsaha =
        String(getSektorRow(row)).trim() || "Lainnya";

      const status = determineStatus(row);

      // ambil keterangan asli kalau ada
      const baseKeterangan = String(
        row.Keterangan ||
        row.keterangan ||
        row.KeteranganPermasalahan ||
        ""
      ).trim();

      // buat saran mitigasi berdasarkan status + sektor + klasifikasi
      const suggestion = generateMitigationSuggestion({
        propinsi: propinsiRaw,
        namaKoperasi,
        klasifikasi,
        sektorUsaha,
        status
      });

      // kalau tidak ada keterangan asli, pakai saran
      const keterangan =
        baseKeterangan && baseKeterangan !== "-"
          ? baseKeterangan
          : suggestion;

      return {
        propinsi: propinsiUpper || "TIDAK DIKETAHUI", // disimpan uppercase biar gampang match map
        namaKoperasi,
        klasifikasi: klasifikasi || "Tidak Dikategorikan",
        sektorUsaha,
        status,
        keterangan
      };
    });

    // ⬇️ append ke data lama, bukan replace
    // ====== MERGE TANPA DUPLIKAT (Nama Koperasi + Propinsi) ======
    // kumpulkan key yang sudah ada di allData
    const existingKeys = new Set(
      allData.map(row => makeRowKey(row.namaKoperasi, row.propinsi))
    );

    // cek setiap baris baru
    newData.forEach(row => {
      const key = makeRowKey(row.namaKoperasi, row.propinsi);
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        allData.push(row);      // cuma masuk kalau belum ada
      }
      // kalau sudah ada, dia di-skip, jadi nggak dobel
    });

    // simpan ke localStorage
    saveToLocal();

    // reset filter dan apply
    filters.propinsi = "";
    filters.sektor = "";
    filters.status = "";
    document.getElementById("filterPropinsi").value = "";
    document.getElementById("filterSektor").value = "";
    document.getElementById("filterStatus").value = "";

    populateFilters();
    applyFilters();
  };

  reader.readAsArrayBuffer(file);
});

// ===== Filters dropdown =====
document.getElementById("filterPropinsi").addEventListener("change", e => {
  filters.propinsi = e.target.value || "";
  applyFilters();
});

document.getElementById("filterSektor").addEventListener("change", e => {
  filters.sektor = e.target.value || "";
  applyFilters();
});

document.getElementById("filterStatus").addEventListener("change", e => {
  filters.status = e.target.value || "";
  applyFilters();
});

function populateFilters() {
  const provSet = new Set();
  const sektorSet = new Set();

  allData.forEach(row => {
    if (row.propinsi) provSet.add(row.propinsi); // sudah uppercase
    if (row.sektorUsaha) sektorSet.add(row.sektorUsaha);
  });

  const provSel = document.getElementById("filterPropinsi");
  provSel.innerHTML = `<option value="">Semua Propinsi</option>`;
  Array.from(provSet)
    .sort()
    .forEach(p => {
      provSel.innerHTML += `<option value="${p}">${p}</option>`;
    });

  const sekSel = document.getElementById("filterSektor");
  sekSel.innerHTML = `<option value="">Semua Sektor</option>`;
  Array.from(sektorSet)
    .sort()
    .forEach(s => {
      sekSel.innerHTML += `<option value="${s}">${s}</option>`;
    });
}

// ===== Apply filters =====
function applyFilters() {
  filteredData = allData.filter(row => {
    const okProv =
      !filters.propinsi ||
      row.propinsi === filters.propinsi; // dua-duanya uppercase
    const okSektor =
      !filters.sektor || row.sektorUsaha === filters.sektor;
    const okStatus =
      !filters.status || row.status === filters.status;
    return okProv && okSektor && okStatus;
  });

  updateDashboard();
}

// ===== Update dashboard (total, charts, table, map) =====
function updateDashboard() {
  document.getElementById("totalKoperasi").textContent =
    filteredData.length;

  updateStatusChart();
  updateSektorChart();
  buildTable();
  updateMapColors();
}

// ----- Charts -----
function updateStatusChart() {
  const ctx = document
    .getElementById("statusChart")
    .getContext("2d");

  const statusCounts = {
    "Belum Diklasifikasi": 0,
    "Tidak Berkualitas": 0,
    "Cukup Berkualitas": 0,
    "Berkualitas": 0
  };

  filteredData.forEach(r => {
    if (statusCounts[r.status] === undefined) {
      statusCounts[r.status] = 0;
    }
    statusCounts[r.status]++;
  });

  const labels = Object.keys(statusCounts);
  const values = labels.map(l => statusCounts[l]);

  const colors = labels.map(l => {
    if (l === "Belum Diklasifikasi") return "#95a5a6"; // abu
    if (l === "Tidak Berkualitas") return "#ff4757";   // merah
    if (l === "Cukup Berkualitas") return "#ffd93d";   // kuning
    if (l === "Berkualitas") return "#6bcf7f";         // hijau
    return "#a0aec0";
  });

  if (statusChart) statusChart.destroy();

  statusChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderRadius: 6,
          maxBarThickness: 40
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      onClick: (evt, items) => {
        if (!items.length) return;
        const idx = items[0].index;
        const clickedStatus = labels[idx];

        // toggle filter
        if (filters.status === clickedStatus) {
          filters.status = "";
          document.getElementById("filterStatus").value = "";
        } else {
          filters.status = clickedStatus;
          document.getElementById("filterStatus").value =
            clickedStatus;
        }
        applyFilters();
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1 }
        }
      }
    }
  });
}

function updateSektorChart() {
  const ctx = document
    .getElementById("sektorChart")
    .getContext("2d");

  const sektorMap = {};
  filteredData.forEach(r => {
    if (!r.sektorUsaha) return;
    sektorMap[r.sektorUsaha] =
      (sektorMap[r.sektorUsaha] || 0) + 1;
  });

  const entries = Object.entries(sektorMap).sort(
    (a, b) => b[1] - a[1]
  );
  const top10 = entries.slice(0, 10);

  const labels = top10.map(e => e[0]);
  const values = top10.map(e => e[1]);

  if (sektorChart) sektorChart.destroy();

  sektorChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: "#4a69bd",
          borderRadius: 6,
          maxBarThickness: 30
        }
      ]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { stepSize: 1 }
        }
      }
    }
  });
}

// ----- Table -----
function buildTable() {
  const tbody = document.getElementById("tableBody");
  tbody.innerHTML = "";

  if (!filteredData.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="empty-state">Tidak ada data untuk filter saat ini.</td></tr>';
    return;
  }

  filteredData.forEach((row, i) => {
    const tr = document.createElement("tr");

    // badge status
    let badgeClass = "status-hijau";
    if (row.status === "Tidak Berkualitas") badgeClass = "status-merah";
    else if (row.status === "Cukup Berkualitas") badgeClass = "status-kuning";
    else if (row.status === "Belum Diklasifikasi") badgeClass = "status-abu";

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${row.propinsi}</td>
      <td>${row.namaKoperasi}</td>
      <td>${row.klasifikasi}</td>
      <td>${row.sektorUsaha}</td>
      <td><span class="status-badge ${badgeClass}">${row.status}</span></td>
      <td>${row.keterangan}</td>
    `;

    tbody.appendChild(tr);
  });
}

// ===== Download / Export Excel =====
const downloadBtn = document.getElementById("downloadBtn");
if (downloadBtn) {
  downloadBtn.addEventListener("click", () => {
    if (!allData.length) {
      alert("Upload data dulu sebelum download ya :)");
      return;
    }

    // kalau mau yang lagi ke-filter aja
    const source = filteredData.length ? filteredData : allData;

    const exportData = source.map((row, idx) => ({
      No: idx + 1,
      Propinsi: row.propinsi,
      Koperasi: row.namaKoperasi,
      Klasifikasi: row.klasifikasi,
      Sektor: row.sektorUsaha,
      Status: row.status,
      SaranMitigasi: row.keterangan
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mitigasi");

    XLSX.writeFile(wb, "mitigasi_koperasi_dengan_saran.xlsx");
  });
}

// (Opsional) tombol reset data kalau kamu bikin <button id="resetBtn">
const resetBtn = document.getElementById("resetBtn");
if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    if (!confirm("Yakin mau hapus semua data di dashboard?")) return;
    allData = [];
    filteredData = [];
    localStorage.removeItem(LOCAL_KEY);
    populateFilters();
    applyFilters();
  });
}

// ====== MAP (Leaflet + simple GeoJSON) ======
const indonesiaGeoJSON = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { name: "ACEH" }, geometry: { type: "Polygon", coordinates: [[[95.2, 5.5],[95.2, 6.0],[97.5, 6.0],[97.5, 5.5],[95.2, 5.5]]] } },
    { type: "Feature", properties: { name: "SUMATERA UTARA" }, geometry: { type: "Polygon", coordinates: [[[98.0, 1.0],[98.0, 4.0],[100.0, 4.0],[100.0, 1.0],[98.0, 1.0]]] } },
    { type: "Feature", properties: { name: "SUMATERA BARAT" }, geometry: { type: "Polygon", coordinates: [[[98.5, -1.5],[98.5, 0.5],[101.0, 0.5],[101.0, -1.5],[98.5, -1.5]]] } },
    { type: "Feature", properties: { name: "RIAU" }, geometry: { type: "Polygon", coordinates: [[[100.0, -1.0],[100.0, 2.0],[103.0, 2.0],[103.0, -1.0],[100.0, -1.0]]] } },
    { type: "Feature", properties: { name: "JAMBI" }, geometry: { type: "Polygon", coordinates: [[[101.0, -2.5],[101.0, -0.5],[104.5, -0.5],[104.5, -2.5],[101.0, -2.5]]] } },
    { type: "Feature", properties: { name: "SUMATERA SELATAN" }, geometry: { type: "Polygon", coordinates: [[[102.0, -4.5],[102.0, -2.0],[106.0, -2.0],[106.0, -4.5],[102.0, -4.5]]] } },
    { type: "Feature", properties: { name: "BENGKULU" }, geometry: { type: "Polygon", coordinates: [[[101.0, -4.5],[101.0, -2.5],[103.5, -2.5],[103.5, -4.5],[101.0, -4.5]]] } },
    { type: "Feature", properties: { name: "LAMPUNG" }, geometry: { type: "Polygon", coordinates: [[[103.5, -6.0],[103.5, -3.5],[105.8, -3.5],[105.8, -6.0],[103.5, -6.0]]] } },
    { type: "Feature", properties: { name: "KEPULAUAN BANGKA BELITUNG" }, geometry: { type: "Polygon", coordinates: [[[105.0, -3.5],[105.0, -1.5],[108.0, -1.5],[108.0, -3.5],[105.0, -3.5]]] } },
    { type: "Feature", properties: { name: "KEPULAUAN RIAU" }, geometry: { type: "Polygon", coordinates: [[[103.5, 0.0],[103.5, 3.5],[108.5, 3.5],[108.5, 0.0],[103.5, 0.0]]] } },
    { type: "Feature", properties: { name: "DKI JAKARTA" }, geometry: { type: "Polygon", coordinates: [[[106.7, -6.4],[106.7, -5.9],[107.0, -5.9],[107.0, -6.4],[106.7, -6.4]]] } },
    { type: "Feature", properties: { name: "JAWA BARAT" }, geometry: { type: "Polygon", coordinates: [[[106.0, -7.8],[106.0, -5.9],[108.8, -5.9],[108.8, -7.8],[106.0, -7.8]]] } },
    { type: "Feature", properties: { name: "JAWA TENGAH" }, geometry: { type: "Polygon", coordinates: [[[108.5, -8.0],[108.5, -6.5],[111.5, -6.5],[111.5, -8.0],[108.5, -8.0]]] } },
    { type: "Feature", properties: { name: "DI YOGYAKARTA" }, geometry: { type: "Polygon", coordinates: [[[110.0, -8.2],[110.0, -7.5],[110.8, -7.5],[110.8, -8.2],[110.0, -8.2]]] } },
    { type: "Feature", properties: { name: "JAWA TIMUR" }, geometry: { type: "Polygon", coordinates: [[[111.0, -8.8],[111.0, -6.8],[114.8, -6.8],[114.8, -8.8],[111.0, -8.8]]] } },
    { type: "Feature", properties: { name: "BANTEN" }, geometry: { type: "Polygon", coordinates: [[[105.0, -7.0],[105.0, -5.5],[106.8, -5.5],[106.8, -7.0],[105.0, -7.0]]] } },
    { type: "Feature", properties: { name: "BALI" }, geometry: { type: "Polygon", coordinates: [[[114.4, -8.8],[114.4, -8.0],[115.8, -8.0],[115.8, -8.8],[114.4, -8.8]]] } },
    { type: "Feature", properties: { name: "NUSA TENGGARA BARAT" }, geometry: { type: "Polygon", coordinates: [[[115.5, -9.0],[115.5, -8.0],[119.5, -8.0],[119.5, -9.0],[115.5, -9.0]]] } },
    { type: "Feature", properties: { name: "NUSA TENGGARA TIMUR" }, geometry: { type: "Polygon", coordinates: [[[118.5, -11.0],[118.5, -8.0],[125.5, -8.0],[125.5, -11.0],[118.5, -11.0]]] } },
    { type: "Feature", properties: { name: "KALIMANTAN BARAT" }, geometry: { type: "Polygon", coordinates: [[[108.5, -3.5],[108.5, 3.0],[112.0, 3.0],[112.0, -3.5],[108.5, -3.5]]] } },
    { type: "Feature", properties: { name: "KALIMANTAN TENGAH" }, geometry: { type: "Polygon", coordinates: [[[111.0, -4.0],[111.0, -0.5],[115.5, -0.5],[115.5, -4.0],[111.0, -4.0]]] } },
    { type: "Feature", properties: { name: "KALIMANTAN SELATAN" }, geometry: { type: "Polygon", coordinates: [[[114.5, -4.5],[114.5, -1.5],[116.5, -1.5],[116.5, -4.5],[114.5, -4.5]]] } },
    { type: "Feature", properties: { name: "KALIMANTAN TIMUR" }, geometry: { type: "Polygon", coordinates: [[[115.5, 0.0],[115.5, 3.0],[119.5, 3.0],[119.5, 0.0],[115.5, 0.0]]] } },
    { type: "Feature", properties: { name: "KALIMANTAN UTARA" }, geometry: { type: "Polygon", coordinates: [[[115.5, 3.0],[115.5, 5.0],[119.5, 5.0],[119.5, 3.0],[115.5, 3.0]]] } },
    { type: "Feature", properties: { name: "SULAWESI UTARA" }, geometry: { type: "Polygon", coordinates: [[[123.5, 0.5],[123.5, 2.0],[126.0, 2.0],[126.0, 0.5],[123.5, 0.5]]] } },
    { type: "Feature", properties: { name: "SULAWESI TENGAH" }, geometry: { type: "Polygon", coordinates: [[[119.5, -2.5],[119.5, 1.5],[123.5, 1.5],[123.5, -2.5],[119.5, -2.5]]] } },
    { type: "Feature", properties: { name: "SULAWESI SELATAN" }, geometry: { type: "Polygon", coordinates: [[[118.5, -6.5],[118.5, -2.5],[121.5, -2.5],[121.5, -6.5],[118.5, -6.5]]] } },
    { type: "Feature", properties: { name: "SULAWESI TENGGARA" }, geometry: { type: "Polygon", coordinates: [[[120.5, -6.0],[120.5, -3.0],[123.5, -3.0],[123.5, -6.0],[120.5, -6.0]]] } },
    { type: "Feature", properties: { name: "GORONTALO" }, geometry: { type: "Polygon", coordinates: [[[121.5, 0.0],[121.5, 1.0],[123.5, 1.0],[123.5, 0.0],[121.5, 0.0]]] } },
    { type: "Feature", properties: { name: "SULAWESI BARAT" }, geometry: { type: "Polygon", coordinates: [[[118.5, -3.5],[118.5, -1.5],[120.0, -1.5],[120.0, -3.5],[118.5, -3.5]]] } },
    { type: "Feature", properties: { name: "MALUKU" }, geometry: { type: "Polygon", coordinates: [[[125.0, -8.5],[125.0, -2.5],[131.5, -2.5],[131.5, -8.5],[125.0, -8.5]]] } },
    { type: "Feature", properties: { name: "MALUKU UTARA" }, geometry: { type: "Polygon", coordinates: [[[124.5, -1.0],[124.5, 3.0],[129.5, 3.0],[129.5, -1.0],[124.5, -1.0]]] } },
    { type: "Feature", properties: { name: "PAPUA BARAT" }, geometry: { type: "Polygon", coordinates: [[[130.0, -4.0],[130.0, 1.0],[134.5, 1.0],[134.5, -4.0],[130.0, -4.0]]] } },
    { type: "Feature", properties: { name: "PAPUA" }, geometry: { type: "Polygon", coordinates: [[[134.0, -9.0],[134.0, -1.0],[141.0, -1.0],[141.0, -9.0],[134.0, -9.0]]] } }
  ]
};

function initMap() {
  map = L.map("map").setView([-2.5, 118.0], 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  geoJsonLayer = L.geoJSON(indonesiaGeoJSON, {
    style: () => ({
      fillColor: "#4a69bd",
      weight: 1,
      color: "white",
      fillOpacity: 0.5
    }),
    onEachFeature: (feature, layer) => {
      layer.on({
        mouseover: highlightFeature,
        mouseout: resetHighlight,
        click: onProvinceClick
      });
    }
  }).addTo(map);
}

function highlightFeature(e) {
  const layer = e.target;
  layer.setStyle({
    weight: 2,
    color: "#666",
    fillOpacity: 0.7
  });

  const provName = layer.feature.properties.name.toUpperCase();
  const data = filteredData.filter(
    d => d.propinsi === provName
  );
  const bermasalah = data.filter(
    d => d.status === "Tidak Berkualitas"
  ).length;

  layer
    .bindTooltip(
      `<strong>${provName}</strong><br>Total: ${data.length}<br>Bermasalah: ${bermasalah}`,
      { direction: "top" }
    )
    .openTooltip();
}

function resetHighlight(e) {
  geoJsonLayer.resetStyle(e.target);
}

function onProvinceClick(e) {
  const provName = e.target.feature.properties.name.toUpperCase();
  document.getElementById("filterPropinsi").value = provName;
  filters.propinsi = provName;
  applyFilters();
}

function updateMapColors() {
  if (!geoJsonLayer) return;

  geoJsonLayer.eachLayer(layer => {
    const prov = layer.feature.properties.name.toUpperCase();
    const data = filteredData.filter(
      d => d.propinsi === prov
    );
    const bermasalah = data.filter(
      d => d.status === "Tidak Berkualitas"
    ).length;

    let color = "#4a69bd";
    if (bermasalah > 20) color = "#c0392b";
    else if (bermasalah > 10) color = "#e67e22";
    else if (bermasalah > 5) color = "#f39c12";
    else if (data.length > 0) color = "#27ae60";

    layer.setStyle({
      fillColor: color,
      fillOpacity: 0.6
    });
  });
}

// ===== Init =====
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  loadFromLocal(); // kalau sebelumnya sudah pernah upload, langsung kebaca lagi
});