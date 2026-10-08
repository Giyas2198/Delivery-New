// ===================================================
// 1. KONFIGURASI FIREBASE & FONNTE API
// ===================================================
const firebaseConfig = {
    apiKey: "AIzaSyB3cGe04xRlhvnN2Kx7xjX_ktGfLf-zQwI",
    authDomain: "monitoring-delivery-369fb.firebaseapp.com",
    projectId: "monitoring-delivery-369fb",
    storageBucket: "monitoring-delivery-369fb.firebasestorage.app",
    messagingSenderId: "951925658055",
    appId: "1:951925658055:web:6df8a1367492fc2a2649e2",
    measurementId: "G-MHC5GCH4Z1"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const archivesCol = db.collection('tms_archives');

// Token Fonnte
const FONNTE_TOKEN = "1Tr7c2U56yJuAMoK7S6j";

const WA_GROUP_IDS = {
    "PT WIRA TRANS MANDIRI-": "6282135357171-1528080056@g.us",
    "PT RESWARA PRIMA EXPRESS": "120363071747934145@g.us",
    "MAERSK": "120363423423967682@g.us",
    "PT HUMALA GIAT MANDIRI": "6282135357171-1536552759@g.us"
};

const BASE_UPDATE_URL = window.location.origin + window.location.pathname.replace("index.html", "") + "update.html";

// State Global Dashboard
let globalData = [];
let filteredData = [];
let statusChartInstance = null;
let transporterChartInstance = null;
let firebaseList = [];
let overdueGroups = {};
let currentActiveDocId = null;

// Scanner State
let codeReader = null;
let isScanning = false;

const excelUpload = document.getElementById('excelUpload');
const statusBadge = document.getElementById('statusBadge');
const searchInput = document.getElementById('searchInput');
const btnSaveCard = document.getElementById('btnSaveCard');
const btnOpenReminder = document.getElementById('btnOpenReminder');

// Listener Realtime Firestore
archivesCol.orderBy('createdAt', 'desc').onSnapshot(snapshot => {
    firebaseList = [];
    snapshot.forEach(doc => {
        firebaseList.push({ id: doc.id, ...doc.data() });
    });
    renderArchiveGrid();
}, err => {
    console.error("Gagal sinkronisasi data Firestore:", err);
});

function generateAutoTitle() {
    const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const now = new Date();
    return `Pengiriman tanggal ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
}

// ATURAN SLA EKSPEDISI
function getTransporterSLA(transporterName) {
    if (!transporterName) return 7;
    const t = transporterName.toUpperCase();
    if (t.includes("WIRA TRANS MANDIRI")) return 1;
    if (t.includes("RESWARA PRIMA EXPRESS")) return 2;
    if (t.includes("MAERSK")) return 2;
    if (t.includes("HUMALA GIAT MANDIRI")) return 3;
    return 7;
}

function extractDateFromRow(row) {
    for (let k in row) {
        const val = String(row[k]);
        const match = val.match(/20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
        if (match) {
            const str = match[0];
            const y = parseInt(str.substring(0, 4));
            const m = parseInt(str.substring(4, 6)) - 1;
            const d = parseInt(str.substring(6, 8));
            return new Date(y, m, d);
        }
    }

    for (let k in row) {
        const lk = k.toLowerCase();
        if (lk.includes('date') || lk.includes('tanggal')) {
            const val = String(row[k]);
            const parts = val.split('-');
            if (parts.length === 3) {
                return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
            }
        }
    }
    return new Date();
}

function switchTab(tab) {
    const tabOverview = document.getElementById('tabOverview');
    const tabTransporter = document.getElementById('tabTransporter');
    const tabScan = document.getElementById('tabScan');
    const tabArchive = document.getElementById('tabArchive');
    
    const navOverview = document.getElementById('navOverview');
    const navTransporter = document.getElementById('navTransporter');
    const navScan = document.getElementById('navScan');
    const navArchive = document.getElementById('navArchive');
    
    const headerTitle = document.getElementById('headerTitle');
    const headerSub = document.getElementById('headerSub');

    tabOverview.classList.add('hidden');
    tabTransporter.classList.add('hidden');
    tabScan.classList.add('hidden');
    tabArchive.classList.add('hidden');
    
    const activeNav = "flex items-center gap-3.5 px-3.5 py-3 bg-indigo-600 text-white rounded-xl font-medium text-xs shadow-sm shadow-indigo-500/20 transition-all";
    const inactiveNav = "flex items-center gap-3.5 px-3.5 py-3 hover:bg-slate-900 text-slate-400 hover:text-slate-100 rounded-xl font-medium text-xs transition-all";

    navOverview.className = inactiveNav;
    navTransporter.className = inactiveNav;
    navScan.className = inactiveNav;
    navArchive.className = inactiveNav;

    if (tab === 'overview') {
        tabOverview.classList.remove('hidden');
        navOverview.className = activeNav;
        headerTitle.innerText = "Status Pengiriman & Delivery Ticket";
        headerSub.innerText = "Monitoring muatan, tracking SLA batas kirim, dan auto reminder Fonnte WhatsApp";
        stopCameraScanner();
    } else if (tab === 'transporter') {
        tabTransporter.classList.remove('hidden');
        navTransporter.className = activeNav;
        headerTitle.innerText = "Performance Per Transporter";
        headerSub.innerText = "Evaluasi rasio keberhasilan vendor dan muatan berjalan";
        renderTransporterCards(filteredData);
        stopCameraScanner();
    } else if (tab === 'scan') {
        tabScan.classList.remove('hidden');
        navScan.className = activeNav;
        headerTitle.innerText = "Scan Pengembalian Delivery Ticket (Loket)";
        headerSub.innerText = "Pindai barcode fisik surat jalan yang kembali di loket gudang";
        populateSampleBarcodes();
    } else if (tab === 'archive') {
        tabArchive.classList.remove('hidden');
        navArchive.className = activeNav;
        headerTitle.innerText = "Arsip Kartu Pengiriman (Firebase)";
        headerSub.innerText = "Riwayat data pengiriman harian yang tersimpan di cloud database";
        renderArchiveGrid();
        stopCameraScanner();
    }
}

function formatDateValue(val) {
    if (!val) return "";
    if (val instanceof Date && !isNaN(val)) {
        let d = String(val.getDate()).padStart(2, '0');
        let m = String(val.getMonth() + 1).padStart(2, '0');
        return `${d}-${m}-${val.getFullYear()}`;
    }
    let p = new Date(val);
    if (!isNaN(p) && String(val).includes('GMT')) {
        let d = String(p.getDate()).padStart(2, '0');
        let m = String(p.getMonth() + 1).padStart(2, '0');
        return `${d}-${m}-${p.getFullYear()}`;
    }
    return val;
}

// Upload Excel & Auto-Save
excelUpload.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(evt) {
        try {
            statusBadge.className = "text-xs bg-indigo-50 text-indigo-600 px-3 py-2 rounded-xl font-semibold border border-indigo-100 flex items-center gap-2";
            statusBadge.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i><span>Membaca data...</span>`;

            const data = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(data, {type: 'array', cellDates: true});
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            let parsedData = XLSX.utils.sheet_to_json(worksheet, {defval: ""});

            if (parsedData.length === 0) {
                alert("File Excel kosong atau format tidak sesuai.");
                return;
            }

            globalData = parsedData.map(row => {
                let newRow = {};
                for (let k in row) {
                    let lk = k.toLowerCase();
                    if (lk.includes('date') || lk.includes('tanggal')) {
                        newRow[k] = formatDateValue(row[k]);
                    } else {
                        newRow[k] = row[k];
                    }
                }
                return newRow;
            });

            filteredData = [...globalData];
            processDashboard(filteredData);

            btnSaveCard.disabled = false;
            btnSaveCard.className = "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 cursor-pointer px-4 py-2.5 rounded-xl text-xs font-semibold shadow-xs transition flex items-center gap-2";

            statusBadge.innerHTML = `<i class="fa-solid fa-cloud-arrow-up fa-fade"></i><span>Menyimpan ke Firebase...</span>`;
            const autoTitle = generateAutoTitle();
            const newDocId = await saveRecordToFirebase(autoTitle, filteredData);
            currentActiveDocId = newDocId;

            statusBadge.className = "text-xs bg-emerald-50 text-emerald-700 px-3 py-2 rounded-xl font-semibold border border-emerald-100 flex items-center gap-2";
            statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span><span>Tersimpan (${globalData.length} Baris)</span>`;

        } catch (err) {
            console.error("Gagal memproses file:", err);
            alert("Terjadi kesalahan saat memproses data.");
        }
    };
    reader.readAsArrayBuffer(file);
});

async function saveRecordToFirebase(title, dataset) {
    let delivered = 0, onDelivery = 0, canceled = 0;
    dataset.forEach(row => {
        let s = "";
        for (let k in row) {
            if (k.toLowerCase() === 'status') {
                s = String(row[k]).trim().toUpperCase();
                break;
            }
        }
        if (s.includes('DELIVERED') || s.includes('RETURNED')) delivered++;
        else if (s.includes('ON_DELIVERY') || s.includes('ON DELIVERY')) onDelivery++;
        else if (s.includes('CANCELED') || s.includes('CANCEL')) canceled++;
    });

    const dateStr = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    const cacheKey = `cache_${Date.now()}`;
    try {
        sessionStorage.setItem(cacheKey, JSON.stringify(dataset));
    } catch(e) {}

    const docData = {
        title: title,
        total: dataset.length,
        delivered: delivered,
        onDelivery: onDelivery,
        canceled: canceled,
        dateStr: dateStr,
        cacheKey: cacheKey,
        sampleData: JSON.stringify(dataset),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const res = await archivesCol.add(docData);
    return res.id;
}

function processDashboard(data) {
    let delivered = 0, onDelivery = 0, canceled = 0, totalOverdue = 0;
    let transporterCounts = {};
    let transporterListSet = new Set();
    overdueGroups = {};

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    data.forEach(row => {
        let statusVal = "";
        let transpVal = "Lainnya";
        let ttSJ = "";
        let driver = "";
        let truck = "";
        let shipTo = "";

        for (let key in row) {
            let lKey = key.toLowerCase();
            if (lKey === 'status') statusVal = String(row[key]).trim().toUpperCase();
            if (lKey.includes('transporter')) transpVal = String(row[key]).trim() || "Lainnya";
            if (lKey.includes('ttsj')) ttSJ = String(row[key]).trim();
            if (lKey.includes('driver')) driver = String(row[key]).trim();
            if (lKey.includes('truck')) truck = String(row[key]).trim();
            if (lKey.includes('ship to') || lKey.includes('area')) shipTo = String(row[key]).trim();
        }

        if (statusVal.includes('DELIVERED') || statusVal.includes('RETURNED')) delivered++;
        else if (statusVal.includes('ON_DELIVERY') || statusVal.includes('ON DELIVERY')) {
            onDelivery++;

            const ticketDate = extractDateFromRow(row);
            ticketDate.setHours(0, 0, 0, 0);
            const diffDays = Math.max(0, Math.floor((today - ticketDate) / (1000 * 60 * 60 * 24)));
            const maxSla = getTransporterSLA(transpVal);

            if (diffDays > maxSla) {
                totalOverdue++;
                if (!overdueGroups[transpVal]) overdueGroups[transpVal] = [];
                overdueGroups[transpVal].push({
                    ttsj: ttSJ || 'N/A',
                    transporter: transpVal,
                    truck: truck || '-',
                    driver: driver || '-',
                    destination: shipTo || '-',
                    daysRunning: diffDays,
                    slaLimit: maxSla,
                    overdueBy: diffDays - maxSla
                });
            }
        }
        else if (statusVal.includes('CANCELED') || statusVal.includes('CANCEL')) canceled++;

        transporterCounts[transpVal] = (transporterCounts[transpVal] || 0) + 1;
        transporterListSet.add(transpVal);
    });

    let selectTransp = document.getElementById('transporterFilterSelect');
    if (selectTransp) {
        let selectHTML = '<option value="ALL">Semua Transporter</option>';
        transporterListSet.forEach(t => { selectHTML += `<option value="${t}">${t}</option>`; });
        selectTransp.innerHTML = selectHTML;
    }

    document.getElementById('statTotal').innerText = data.length.toLocaleString('id-ID');
    document.getElementById('statDelivered').innerText = delivered.toLocaleString('id-ID');
    document.getElementById('statOnDelivery').innerText = onDelivery.toLocaleString('id-ID');
    document.getElementById('statOverdue').innerText = totalOverdue.toLocaleString('id-ID');
    document.getElementById('statCanceled').innerText = canceled.toLocaleString('id-ID');
    document.getElementById('overdueCountBadge').innerText = totalOverdue;

    if (totalOverdue > 0) {
        btnOpenReminder.disabled = false;
        btnOpenReminder.className = "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer px-4 py-2.5 rounded-xl text-xs font-semibold shadow-xs transition flex items-center gap-2 animate-pulse";
    } else {
        btnOpenReminder.disabled = true;
        btnOpenReminder.className = "bg-slate-100 text-slate-400 cursor-not-allowed px-4 py-2.5 rounded-xl text-xs font-semibold transition flex items-center gap-2";
    }

    renderStatusChart(delivered, onDelivery, canceled);
    renderTransporterChart(transporterCounts);
    renderTableWithSLA(data);
}

function renderTableWithSLA(data) {
    if (data.length === 0) {
        document.getElementById('tableHeader').innerHTML = `<tr><th class="p-4 text-center text-slate-400">Tidak ada data</th></tr>`;
        document.getElementById('tableBody').innerHTML = `<tr><td class="p-8 text-center text-slate-400">Data kosong sesuai filter.</td></tr>`;
        return;
    }
    const columns = Object.keys(data[0]);
    let headerHTML = '<tr>';
    columns.forEach(col => { headerHTML += `<th class="p-3.5 whitespace-nowrap">${col}</th>`; });
    headerHTML += `<th class="p-3.5 whitespace-nowrap bg-slate-100 text-indigo-900">SLA & Return Status</th>`;
    headerHTML += '</tr>';
    document.getElementById('tableHeader').innerHTML = headerHTML;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let bodyHTML = '';
    data.forEach(row => {
        bodyHTML += '<tr class="hover:bg-slate-50/70 transition-colors">';
        let statusVal = "";
        let transpVal = "";

        for (let key in row) {
            let val = row[key];
            let lk = key.toLowerCase();
            if (lk === 'status') statusVal = String(val).toUpperCase();
            if (lk.includes('transporter')) transpVal = String(val);

            if (lk === 'status') {
                let dot = 'bg-slate-400';
                let badgeStyle = 'bg-slate-50 text-slate-600 border-slate-200';
                if (statusVal.includes('DELIVERED') || statusVal.includes('RETURNED')) {
                    dot = 'bg-emerald-500';
                    badgeStyle = 'bg-emerald-50 text-emerald-700 border-emerald-100';
                } else if (statusVal.includes('ON_DELIVERY') || statusVal.includes('ON DELIVERY')) {
                    dot = 'bg-amber-500';
                    badgeStyle = 'bg-amber-50 text-amber-700 border-amber-100';
                } else if (statusVal.includes('CANCELED')) {
                    dot = 'bg-rose-500';
                    badgeStyle = 'bg-rose-50 text-rose-700 border-rose-100';
                }

                val = `
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${badgeStyle}">
                        <span class="w-1.5 h-1.5 rounded-full ${dot}"></span>
                        ${val}
                    </span>
                `;
            }
            bodyHTML += `<td class="p-3.5 whitespace-nowrap">${val !== null && val !== undefined ? val : ''}</td>`;
        }

        let slaBadge = `<span class="text-slate-400">-</span>`;
        if (statusVal.includes('RETURNED')) {
            slaBadge = `<span class="text-emerald-700 font-bold text-[11px] bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200"><i class="fa-solid fa-barcode"></i> Returned (Di Loket)</span>`;
        } else if (statusVal.includes('ON_DELIVERY') || statusVal.includes('ON DELIVERY')) {
            const ticketDate = extractDateFromRow(row);
            ticketDate.setHours(0, 0, 0, 0);
            const diffDays = Math.max(0, Math.floor((today - ticketDate) / (1000 * 60 * 60 * 24)));
            const maxSla = getTransporterSLA(transpVal);

            if (diffDays > maxSla) {
                slaBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-200"><i class="fa-solid fa-triangle-exclamation"></i> Overdue ${diffDays - maxSla} Hari</span>`;
            } else {
                slaBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100"><i class="fa-solid fa-clock"></i> On-Track (${diffDays}/${maxSla} Hari)</span>`;
            }
        } else if (statusVal.includes('DELIVERED')) {
            slaBadge = `<span class="text-emerald-600 font-semibold text-[11px]"><i class="fa-solid fa-check"></i> Selesai</span>`;
        }

        bodyHTML += `<td class="p-3.5 whitespace-nowrap bg-slate-50/40">${slaBadge}</td>`;
        bodyHTML += '</tr>';
    });
    document.getElementById('tableBody').innerHTML = bodyHTML;
}

// ===================================================
// 2. SCAN LOKET / RETURN TRACKING LOGIC
// ===================================================
function startCameraScanner() {
    if (!codeReader) {
        codeReader = new ZXing.BrowserBarcodeReader();
    }
    const placeholder = document.getElementById('scannerPlaceholder');
    placeholder.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin text-2xl text-indigo-500 mb-2"></i><p>Menghubungkan ke kamera...</p>`;

    codeReader.decodeFromVideoDevice(null, 'interactive', (result, err) => {
        if (result) {
            handleScannedBarcode(result.text);
        }
        if (err && !(err instanceof ZXing.NotFoundException)) {
            console.warn(err);
        }
    }).then(() => {
        placeholder.classList.add('hidden');
    }).catch(err => {
        console.error(err);
        placeholder.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-rose-500 text-2xl mb-2"></i><p class="text-rose-400">Gagal mengakses kamera. Gunakan simulator di bawah.</p>`;
    });
}

function stopCameraScanner() {
    if (codeReader) {
        codeReader.reset();
    }
    const placeholder = document.getElementById('scannerPlaceholder');
    if (placeholder) {
        placeholder.classList.remove('hidden');
        placeholder.innerHTML = `<i class="fa-solid fa-barcode text-3xl mb-2 text-slate-500"></i><p>Kamera belum aktif. Klik "Mulai Kamera Scanner".</p>`;
    }
}

function populateSampleBarcodes() {
    const container = document.getElementById('sampleBarcodeList');
    if (!globalData || globalData.length === 0) {
        container.innerHTML = `<span class="text-xs text-slate-400">Belum ada data Excel dimuat. Silakan upload file terlebih dahulu.</span>`;
        return;
    }

    let html = '';
    let count = 0;
    globalData.forEach(row => {
        if (count >= 10) return;
        for (let k in row) {
            let lk = k.toLowerCase();
            if (lk.includes('ticket') || lk.includes('dt') || lk.includes('order')) {
                let val = String(row[k]).trim();
                if (val && val.length > 3) {
                    html += `<button onclick="handleScannedBarcode('${val}')" class="px-3 py-1.5 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded-xl text-xs font-mono font-bold text-slate-700 transition border border-slate-200 shadow-xs">${val}</button>`;
                    count++;
                    break;
                }
            }
        }
    });
    container.innerHTML = html || '<span class="text-xs text-slate-400">Kolom DT / Order tidak ditemukan pada Excel.</span>';
}

async function handleScannedBarcode(barcodeText) {
    // 1. Bersihkan teks: Hapus kata "Lastpage" dan trim spasi agar murni kodenya saja (Misal: W20985568)
    let cleanText = barcodeText.replace(/lastpage/gi, "").trim();
    let foundIndex = -1;

    // 2. Cari kecocokan barcode pada globalData (DT No atau Order No)
    globalData.forEach((row, idx) => {
        for (let k in row) {
            let val = String(row[k]).trim();
            if (val === cleanText) {
                foundIndex = idx;
                break;
            }
        }
    });

    const logContainer = document.getElementById('scanLogContainer');
    const timeNow = new Date().toLocaleTimeString('id-ID');

    if (foundIndex !== -1) {
        // Update status row menjadi RETURNED
        for (let k in globalData[foundIndex]) {
            let lk = k.toLowerCase();
            if (lk === 'status') {
                globalData[foundIndex][k] = 'RETURNED';
            }
            if (lk.includes('return') || lk.includes('tanggal kembali')) {
                globalData[foundIndex][k] = new Date().toLocaleDateString('id-ID');
            }
        }

        filteredData = [...globalData];
        processDashboard(filteredData);

        // Update realtime ke Firebase jika dokumen aktif ada
        if (currentActiveDocId) {
            try {
                await archivesCol.doc(currentActiveDocId).update({
                    sampleData: JSON.stringify(globalData),
                    lastUpdatedByScan: firebase.firestore.FieldValue.serverTimestamp()
                });
            } catch (e) {
                console.error("Gagal sync firebase saat scan:", e);
            }
        }

        logContainer.innerHTML = `
            <div class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1">
                <div class="flex justify-between font-bold text-emerald-800 text-[11px]">
                    <span><i class="fa-solid fa-circle-check"></i> BERHASIL SCAN: ${cleanText}</span>
                    <span>${timeNow}</span>
                </div>
                <p class="text-[11px] text-emerald-600">Status surat jalan diubah menjadi <b>RETURNED</b>.</p>
            </div>
        ` + logContainer.innerHTML;
    } else {
        logContainer.innerHTML = `
            <div class="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1">
                <div class="flex justify-between font-bold text-rose-800 text-[11px]">
                    <span><i class="fa-solid fa-triangle-exclamation"></i> TIDAK DIKENALI: ${cleanText}</span>
                    <span>${timeNow}</span>
                </div>
                <p class="text-[11px] text-rose-600">Nomor barcode tidak terdaftar di database.</p>
            </div>
        ` + logContainer.innerHTML;
    }
}

function clearScanLog() {
    document.getElementById('scanLogContainer').innerHTML = `<div class="text-slate-400 italic">Log dibersihkan...</div>`;
}

// ===================================================
// 3. WHATSAPP AUTO REMINDER (FONNTE)
// ===================================================
function openReminderModal() {
    const container = document.getElementById('reminderContent');
    const keys = Object.keys(overdueGroups);

    if (keys.length === 0) {
        container.innerHTML = `
            <div class="p-8 text-center text-slate-400">
                <i class="fa-solid fa-circle-check text-emerald-500 text-3xl mb-2"></i>
                <p class="font-bold text-slate-700 text-sm">Semua Pengiriman Masih Sesuai SLA!</p>
                <p class="text-xs text-slate-400">Tidak ada pengiriman ON_DELIVERY yang melewati batas waktu.</p>
            </div>
        `;
    } else {
        let html = '';
        keys.forEach(transp => {
            const items = overdueGroups[transp];
            const count = items.length;
            const docParam = currentActiveDocId || (firebaseList[0] ? firebaseList[0].id : '');
            const updateLink = `${BASE_UPDATE_URL}?docId=${docParam}&vendor=${encodeURIComponent(transp)}`;

            let listTTSJ = items.map((item, idx) => `${idx + 1}. *${item.ttsj}* (Tujuan: ${item.destination})`).join("\n");
            let textWA = `Hi Tim *${transp}*,\n\nMohon bantuannya untuk TTSJ berikut apakah sudah terkirim semua?\n${listTTSJ}\n\nSilakan klik link berikut untuk update status pengiriman dan nomor Delivery Ticket (DT):\n👉 ${updateLink}\n\nTerima kasih atas kerja samanya! 🙏`;

            const encodedText = encodeURIComponent(textWA);

            html += `
                <div class="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 space-y-3">
                    <div class="flex flex-wrap justify-between items-center gap-2">
                        <div>
                            <h4 class="font-bold text-slate-900 text-xs flex items-center gap-2">
                                <i class="fa-solid fa-truck text-indigo-600"></i> ${transp}
                            </h4>
                            <p class="text-[11px] text-rose-500 font-semibold">${count} Tiket Melewati SLA</p>
                        </div>
                        <div class="flex items-center gap-2">
                            <button onclick="sendFonnteBlast('${transp}')" class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition">
                                <i class="fa-solid fa-paper-plane"></i> Blast Fonnte
                            </button>
                            <a href="https://wa.me/?text=${encodedText}" target="_blank" class="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition">
                                <i class="fa-brands fa-whatsapp"></i> Manual WA
                            </a>
                        </div>
                    </div>
                    <div class="bg-white p-3 rounded-xl border border-slate-200 text-[11px] font-mono text-slate-600 whitespace-pre-wrap max-h-36 overflow-y-auto leading-relaxed">${textWA}</div>
                </div>
            `;
        });
        container.innerHTML = html;
    }
    document.getElementById('reminderModal').classList.remove('hidden');
}

function closeReminderModal() {
    document.getElementById('reminderModal').classList.add('hidden');
}

async function sendFonnteBlast(transporterName) {
    const targetGroup = WA_GROUP_IDS[transporterName];
    if (!targetGroup) {
        alert(`ID Grup WhatsApp untuk ${transporterName} belum dikonfigurasi.`);
        return;
    }

    const docParam = currentActiveDocId || (firebaseList[0] ? firebaseList[0].id : '');
    const updateLink = `${BASE_UPDATE_URL}?docId=${docParam}&vendor=${encodeURIComponent(transporterName)}`;
    const items = overdueGroups[transporterName] || [];
    let listTTSJ = items.map((item, idx) => `${idx + 1}. *${item.ttsj}* (Tujuan: ${item.destination})`).join("\n");
    const message = `Hi Tim *${transporterName}*,\n\nMohon bantuannya untuk TTSJ berikut apakah sudah terkirim semua?\n${listTTSJ}\n\nSilakan klik link berikut untuk update status pengiriman dan nomor Delivery Ticket (DT):\n👉 ${updateLink}\n\nTerima kasih atas kerja samanya! 🙏`;

    try {
        const response = await fetch("https://api.fonnte.com/send", {
            method: "POST",
            headers: { "Authorization": FONNTE_TOKEN },
            body: new URLSearchParams({ target: targetGroup, message: message, countryCode: "62" })
        });
        const result = await response.json();
        if (result.status) alert(`Pesan berhasil dikirim via Fonnte ke grup WhatsApp ${transporterName}!`);
        else alert(`Fonnte respon: ${result.reason || "Pastikan device connected"}`);
    } catch (err) {
        console.error(err);
        alert("Gagal koneksi ke server Fonnte.");
    }
}

// Chart Logic
function renderStatusChart(del, onDel, can) {
    const ctx = document.getElementById('statusChart').getContext('2d');
    if (statusChartInstance) statusChartInstance.destroy();

    statusChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Delivered / Returned', 'On Delivery', 'Canceled'],
            datasets: [{
                data: [del, onDel, can],
                backgroundColor: ['#10b981', '#f59e0b', '#f43f5e'],
                borderWidth: 3,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { family: 'Plus Jakarta Sans', size: 11, weight: '500' } } } },
            cutout: '72%'
        }
    });
}

function renderTransporterChart(transpMap) {
    const sorted = Object.entries(transpMap).sort((a,b) => b[1] - a[1]).slice(0, 5);
    const labels = sorted.map(item => item[0]);
    const counts = sorted.map(item => item[1]);

    const ctx = document.getElementById('transporterChart').getContext('2d');
    if (transporterChartInstance) transporterChartInstance.destroy();

    transporterChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{ label: 'Jumlah Shipment', data: counts, backgroundColor: '#6366f1', borderRadius: 10 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { family: 'Plus Jakarta Sans', size: 10 } } },
                x: { grid: { display: false }, ticks: { font: { family: 'Plus Jakarta Sans', size: 10, weight: '600' } } }
            }
        }
    });
}

searchInput.addEventListener('keyup', function(e) {
    const term = e.target.value.toLowerCase();
    const searched = filteredData.filter(row => {
        return Object.values(row).some(val => String(val).toLowerCase().includes(term));
    });
    renderTableWithSLA(searched);
});

function applyDateFilters() {
    if (globalData.length === 0) return;
    const monthVal = document.getElementById('filterMonth').value;
    const startDateVal = document.getElementById('filterStartDate').value;
    const endDateVal = document.getElementById('filterEndDate').value;

    filteredData = globalData.filter(row => {
        let rowDateStr = "";
        for (let key in row) {
            if (key.toLowerCase().includes('date') || key.toLowerCase().includes('tanggal')) {
                rowDateStr = String(row[key]);
                break;
            }
        }
        if (!rowDateStr) return true;
        let parts = rowDateStr.split('-');
        if (parts.length !== 3) return true;
        let rDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        if (isNaN(rDate)) return true;

        if (monthVal !== "ALL" && parts[1] !== monthVal) return false;
        if (startDateVal && rDate < new Date(startDateVal)) return false;
        if (endDateVal && rDate > new Date(endDateVal)) return false;
        return true;
    });

    processDashboard(filteredData);
}

function resetDateFilters() {
    document.getElementById('filterMonth').value = "ALL";
    document.getElementById('filterStartDate').value = "";
    document.getElementById('filterEndDate').value = "";
    filteredData = [...globalData];
    processDashboard(filteredData);
}

function renderTransporterCards(data, filterTransp = "ALL") {
    const grid = document.getElementById('transporterCardsGrid');
    if (!data || data.length === 0) {
        grid.innerHTML = `<div class="col-span-full bg-white p-12 rounded-3xl text-center text-slate-400 border border-slate-200/80">Belum ada data transporter dimuat.</div>`;
        return;
    }

    let mapTransp = {};
    data.forEach(row => {
        let transp = "Lainnya";
        let status = "";
        for (let k in row) {
            let lk = k.toLowerCase();
            if (lk.includes('transporter')) transp = String(row[k]).trim() || "Lainnya";
            if (lk === 'status') status = String(row[k]).trim().toUpperCase();
        }

        if (filterTransp !== "ALL" && transp !== filterTransp) return;

        if (!mapTransp[transp]) mapTransp[transp] = { total: 0, delivered: 0, onDelivery: 0, canceled: 0 };
        mapTransp[transp].total++;
        if (status.includes('DELIVERED') || status.includes('RETURNED')) mapTransp[transp].delivered++;
        else if (status.includes('ON_DELIVERY') || status.includes('ON DELIVERY')) mapTransp[transp].onDelivery++;
        else if (status.includes('CANCELED')) mapTransp[transp].canceled++;
    });

    let html = '';
    for (let [name, stat] of Object.entries(mapTransp)) {
        let successRate = stat.total > 0 ? Math.round((stat.delivered / stat.total) * 100) : 0;
        let slaHari = getTransporterSLA(name);
        html += `
            <div class="bg-white rounded-3xl border border-slate-200/80 p-6 flex flex-col justify-between card-subtle-glow">
                <div>
                    <div class="flex items-center justify-between mb-5">
                        <div class="flex items-center gap-3.5">
                            <div class="w-11 h-11 bg-slate-50 text-indigo-600 rounded-2xl flex items-center justify-center font-bold border border-slate-100">
                                <i class="fa-solid fa-truck text-base"></i>
                            </div>
                            <div>
                                <h3 class="font-bold text-slate-900 text-sm">${name}</h3>
                                <p class="text-[11px] text-slate-400 font-medium">Batas SLA: <b>${slaHari} Hari</b></p>
                            </div>
                        </div>
                    </div>

                    <div class="space-y-3 mb-6">
                        <div class="flex justify-between text-xs font-semibold text-slate-600 bg-slate-50/80 p-3 rounded-2xl border border-slate-100">
                            <span>Total Shipment:</span>
                            <span class="text-slate-900 font-bold">${stat.total} Muatan</span>
                        </div>
                        <div class="grid grid-cols-3 gap-2 text-center text-xs">
                            <div class="bg-emerald-50/50 text-emerald-700 p-2.5 rounded-2xl border border-emerald-100/60">
                                <p class="font-extrabold text-sm">${stat.delivered}</p>
                                <span class="text-[10px] font-medium text-emerald-600">Selesai/Return</span>
                            </div>
                            <div class="bg-amber-50/50 text-amber-700 p-2.5 rounded-2xl border border-amber-100/60">
                                <p class="font-extrabold text-sm">${stat.onDelivery}</p>
                                <span class="text-[10px] font-medium text-amber-600">On Delivery</span>
                            </div>
                            <div class="bg-rose-50/50 text-rose-700 p-2.5 rounded-2xl border border-rose-100/60">
                                <p class="font-extrabold text-sm">${stat.canceled}</p>
                                <span class="text-[10px] font-medium text-rose-600">Canceled</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div>
                    <div class="flex justify-between items-center text-xs mb-1.5 font-semibold text-slate-400">
                        <span>Tingkat Keberhasilan Kirim</span>
                        <span class="text-slate-800 font-bold">${successRate}%</span>
                    </div>
                    <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div class="bg-indigo-600 h-full rounded-full transition-all duration-500" style="width: ${successRate}%"></div>
                    </div>
                </div>
            </div>
        `;
    }
    grid.innerHTML = html;
}

function filterTransporterDetail(val) {
    renderTransporterCards(filteredData, val);
}

// Render Arsip Firebase
function renderArchiveGrid() {
    const grid = document.getElementById('archiveGrid');
    if (!grid) return;

    if (firebaseList.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full bg-white p-12 rounded-3xl border border-slate-200/80 text-center text-slate-400">
                <div class="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mx-auto mb-3 text-slate-400 text-xl border border-slate-100">
                    <i class="fa-solid fa-box-archive"></i>
                </div>
                <p class="font-semibold text-sm text-slate-700">Belum ada kartu tersimpan</p>
            </div>
        `;
        return;
    }

    let html = '';
    firebaseList.forEach(item => {
        const totalCount = item.total || (item.data ? item.data.length : 0);
        html += `
            <div class="bg-white rounded-3xl border border-slate-200/80 p-6 flex flex-col justify-between card-subtle-glow">
                <div>
                    <div class="flex items-start justify-between gap-3 mb-3">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-base border border-indigo-100/60 font-bold">
                                <i class="fa-regular fa-calendar-check"></i>
                            </div>
                            <div>
                                <h3 class="font-bold text-slate-900 text-sm tracking-tight line-clamp-1">${item.title || 'Pengiriman'}</h3>
                                <p class="text-[11px] text-slate-400">${item.dateStr || '-'}</p>
                            </div>
                        </div>
                        <button onclick="deleteCard('${item.id}')" class="text-slate-400 hover:text-rose-500 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-rose-50 transition">
                            <i class="fa-regular fa-trash-can text-xs"></i>
                        </button>
                    </div>

                    <div class="grid grid-cols-3 gap-2.5 my-5">
                        <div class="bg-slate-50 p-3 rounded-2xl border border-slate-100 text-center">
                            <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total</p>
                            <p class="text-base font-extrabold text-slate-800 mt-0.5">${totalCount}</p>
                        </div>
                        <div class="bg-emerald-50/60 p-3 rounded-2xl border border-emerald-100/60 text-center">
                            <p class="text-[10px] text-emerald-600 font-bold uppercase tracking-wider">Delivered</p>
                            <p class="text-base font-extrabold text-emerald-700 mt-0.5">${item.delivered || 0}</p>
                        </div>
                        <div class="bg-amber-50/60 p-3 rounded-2xl border border-amber-100/60 text-center">
                            <p class="text-[10px] text-amber-600 font-bold uppercase tracking-wider">On Delivery</p>
                            <p class="text-base font-extrabold text-amber-600 mt-0.5">${item.onDelivery || 0}</p>
                        </div>
                    </div>
                </div>

                <button onclick="loadCard('${item.id}')" class="w-full py-2.5 bg-slate-900 hover:bg-indigo-600 text-white rounded-xl text-xs font-semibold shadow-xs transition duration-200 flex items-center justify-center gap-2">
                    <i class="fa-solid fa-arrow-up-right-from-square text-[11px]"></i>
                    <span>Buka Data Kartu Ini</span>
                </button>
            </div>
        `;
    });
    grid.innerHTML = html;
}

function loadCard(id) {
    const item = firebaseList.find(x => x.id === id);
    if (!item) return;

    currentActiveDocId = id;
    let loadedRows = null;
    if (item.sampleData) loadedRows = JSON.parse(item.sampleData);
    else if (item.cacheKey && sessionStorage.getItem(item.cacheKey)) loadedRows = JSON.parse(sessionStorage.getItem(item.cacheKey));

    if (loadedRows) {
        globalData = loadedRows;
        filteredData = [...globalData];
        statusBadge.className = "text-xs bg-indigo-50 text-indigo-700 px-3 py-2 rounded-xl font-semibold border border-indigo-100 flex items-center gap-2";
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-indigo-500"></span><span>Memuat: ${item.title}</span>`;
        processDashboard(filteredData);
        switchTab('overview');
    } else {
        alert("Rincian baris data pada kartu ini tidak tersedia.");
    }
}

async function deleteCard(id) {
    if (!confirm("Hapus kartu arsip ini dari database?")) return;
    try {
        await archivesCol.doc(id).delete();
    } catch(e) {
        alert("Gagal menghapus kartu.");
    }
}

function openSaveModal() {
    if (globalData.length === 0) return;
    document.getElementById('modalTotalRows').innerText = filteredData.length;
    document.getElementById('archiveTitleInput').value = generateAutoTitle();
    document.getElementById('saveModal').classList.remove('hidden');
}

function closeSaveModal() {
    document.getElementById('saveModal').classList.add('hidden');
}

async function confirmManualSave() {
    const title = document.getElementById('archiveTitleInput').value.trim() || generateAutoTitle();
    closeSaveModal();
    statusBadge.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i><span>Menyimpan...</span>`;
    currentActiveDocId = await saveRecordToFirebase(title, filteredData);
    statusBadge.className = "text-xs bg-emerald-50 text-emerald-700 px-3 py-2 rounded-xl font-semibold border border-emerald-100 flex items-center gap-2";
    statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span><span>Kartu Baru Disimpan!</span>`;
    switchTab('archive');
}
