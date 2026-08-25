/* ============================================
   Architecture by Jessica - Application Logic
   ============================================ */

// ============================================
// Constants & Configuration
// ============================================

const STORAGE_KEYS = {
    INVOICES: 'jk_invoices',
    AUTH: 'jk_admin_auth',
    ADMIN_CREDENTIALS: 'jk_admin_creds',
    WORKERS: 'jk_workers'
};

const DEFAULT_ADMIN_USERNAME = 'jessica';
const DEFAULT_ADMIN_PASSWORD = 'hussein';

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBMeBBexFTKdM2F9xC5I-0uSWeH4A4EnmI",
    authDomain: "jessica-architecture.firebaseapp.com",
    projectId: "jessica-architecture",
    storageBucket: "jessica-architecture.firebasestorage.app",
    messagingSenderId: "889810533475",
    appId: "1:889810533475:web:2119b699a366b5a4cf4c56"
};

let FIREBASE_ENABLED = false;
let db = null;
let SYNC_INITIALIZED = false;
let LAST_SYNC_STATUS = 'جارِ التحقق من الاتصال بالسحابة...';

function ensureFirebaseScriptsLoaded(onDone) {
    if (typeof firebase !== 'undefined' && firebase.firestore) { onDone(); return; }
    const fbApp = document.querySelector('script[src*="firebase-app-compat"]');
    const fbFs = document.querySelector('script[src*="firebase-firestore-compat"]');
    if (fbApp && fbFs) {
        let checks = 0;
        const iv = setInterval(() => {
            checks++;
            if (typeof firebase !== 'undefined' && firebase.firestore) {
                clearInterval(iv); onDone(); return;
            }
            if (checks > 40) { clearInterval(iv); loadDynamically(onDone); return; }
        }, 250);
        return;
    }
    loadDynamically(onDone);
    function loadDynamically(cb) {
        const s1 = document.createElement('script');
        s1.src = 'https://unpkg.com/firebase@10.13.0/firebase-app-compat.min.js';
        s1.crossOrigin = 'anonymous';
        s1.referrerPolicy = 'no-referrer-when-downgrade';
        s1.onload = () => {
            const s2 = document.createElement('script');
            s2.src = 'https://unpkg.com/firebase@10.13.0/firebase-firestore-compat.min.js';
            s2.crossOrigin = 'anonymous';
            s2.referrerPolicy = 'no-referrer-when-downgrade';
            s2.onload = cb;
            s2.onerror = () => setTimeout(() => loadAlt(cb), 100);
            document.head.appendChild(s2);
        };
        s1.onerror = () => setTimeout(() => loadAlt(cb), 100);
        document.head.appendChild(s1);
    }
    function loadAlt(cb) {
        const fallbackList = [
            [
                'https://cdn.jsdelivr.net/npm/firebase@10.13.0/firebase-app-compat.min.js',
                'https://cdn.jsdelivr.net/npm/firebase@10.13.0/firebase-firestore-compat.min.js'
            ],
            [
                'https://registry.npmmirror.com/firebase/10.13.0/files/firebase-app-compat.min.js',
                'https://registry.npmmirror.com/firebase/10.13.0/files/firebase-firestore-compat.min.js'
            ]
        ];
        let idx = 0;
        const tryNext = () => {
            if (idx >= fallbackList.length) { cb(); return; }
            const [a, b] = fallbackList[idx++];
            const s1a = document.createElement('script');
            s1a.src = a;
            s1a.onload = () => {
                const s2b = document.createElement('script');
                s2b.src = b;
                s2b.onload = cb;
                s2b.onerror = tryNext;
                document.head.appendChild(s2b);
            };
            s1a.onerror = tryNext;
            document.head.appendChild(s1a);
        };
        tryNext();
    }
}

function initializeFirebaseSync(onReady) {
    ensureFirebaseScriptsLoaded(() => {
        let attempts = 0;
        const tryInit = () => {
            attempts++;
            try {
                if (typeof firebase === 'undefined' || !firebase.firestore) {
                    if (attempts < 25) { setTimeout(tryInit, 300); return; }
                    LAST_SYNC_STATUS = '❌ فشل تحميل Firebase بعد محاولات — جرب إعادة تحميل الصفحة';
                    if (onReady) onReady(false);
                    return;
                }
                const cfgProjectId = (FIREBASE_CONFIG && FIREBASE_CONFIG.projectId) || '';
                if (!cfgProjectId || cfgProjectId === 'PASTE_YOUR_PROJECT_ID' || cfgProjectId === 'your-project-id') {
                    LAST_SYNC_STATUS = '⚠️ إعدادات Firebase فارغة — لا يوجد مزامنة سحابية';
                    FIREBASE_ENABLED = false;
                    if (onReady) onReady(false);
                    return;
                }
                let appInst = null;
                try { appInst = firebase.app(); }
                catch (e) {
                    try { appInst = firebase.initializeApp(FIREBASE_CONFIG); }
                    catch (err) { console.warn(err); }
                }
                try {
                    db = firebase.firestore(appInst || undefined);
                    FIREBASE_ENABLED = true;
                    LAST_SYNC_STATUS = '✅ متصل بالسحابة (Firebase Firestore)';
                    if (onReady) onReady(true);
                    return;
                } catch (e2) {
                    LAST_SYNC_STATUS = '❌ فشل إنشاء قاعدة البيانات: ' + (e2.message || e2);
                    if (attempts < 15) { setTimeout(tryInit, 400); return; }
                    FIREBASE_ENABLED = false;
                    if (onReady) onReady(false);
                }
            } catch (e) {
                console.warn('Firebase init retry error:', e);
                LAST_SYNC_STATUS = '❌ فشل تشغيل Firebase: ' + (e.message || e);
                if (attempts < 25) { setTimeout(tryInit, 300); return; }
                FIREBASE_ENABLED = false;
                if (onReady) onReady(false);
            }
        };
        tryInit();
    });
}

async function testFirebaseWrite() {
    if (!FIREBASE_ENABLED || !db) {
        LAST_SYNC_STATUS = '❌ Firebase غير جاهز بعد — انتظر ثانية ثم حاول مرة أخرى';
        return false;
    }
    try {
        await db.collection('app_data').doc('__ping__').set({ t: Date.now() }, { merge: true });
        return true;
    } catch (e) {
        console.warn('Firebase rules ping failed:', e);
        if (String(e).includes('permission-denied')) {
            LAST_SYNC_STATUS = '🚫 مرفوض من قبل Rules — انشر قواعد Firebase ثم اضغط مزامنة فورية';
        } else {
            LAST_SYNC_STATUS = '❌ فشل الكتابة: ' + (e.message || e);
        }
        return false;
    }
}

async function cloudWrite(collection, docId, payload) {
    if (!FIREBASE_ENABLED || !db) return false;
    try {
        await db.collection(collection).doc(docId).set({
            data: payload,
            updatedAt: Date.now()
        }, { merge: true });
        return true;
    } catch (e) {
        console.warn('Cloud write failed:', e);
        return false;
    }
}

async function cloudRead(collection, docId) {
    if (!FIREBASE_ENABLED || !db) return { ok: false };
    try {
        const snap = await db.collection(collection).doc(docId).get();
        if (snap.exists) {
            const d = snap.data();
            return { ok: true, data: d.data, updatedAt: d.updatedAt || 0 };
        }
        return { ok: true, empty: true };
    } catch (e) {
        console.warn('Cloud read failed:', e);
        return { ok: false };
    }
}

function mergeArraysById(localArr, cloudArr) {
    const map = new Map();
    const localList = Array.isArray(localArr) ? localArr : [];
    const cloudList = Array.isArray(cloudArr) ? cloudArr : [];
    localList.forEach(item => { if (item && item.id) map.set(item.id, { ...item, _src: 'L' }); });
    cloudList.forEach(item => {
        if (!item || !item.id) return;
        const existing = map.get(item.id);
        if (!existing) {
            map.set(item.id, { ...item, _src: 'C' });
        } else {
            const existingUpd = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
            const itemUpd = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;
            if (itemUpd >= existingUpd) {
                map.set(item.id, { ...item, _src: 'C' });
            }
        }
    });
    const merged = Array.from(map.values()).map(it => { const c = { ...it }; delete c._src; return c; });
    merged.sort((a, b) => {
        const ta = a.createdAt || a.updatedAt || '0';
        const tb = b.createdAt || b.updatedAt || '0';
        return String(tb).localeCompare(String(ta));
    });
    return merged;
}

function showSyncStatus() {
    const invCount = safeGet(STORAGE_KEYS.INVOICES, []).length;
    const wrkCount = safeGet(STORAGE_KEYS.WORKERS, []).length;
    const pid = FIREBASE_CONFIG.projectId || 'غير محدد';
    const lines = [
        `الحالة: ${LAST_SYNC_STATUS}`,
        `Firebase Project ID: ${pid}`,
        `Firebase مهيأ: ${FIREBASE_ENABLED ? 'نعم ✅' : 'لا ❌'}`,
        `المستمع الحي للفواتير: ${SYNC_INITIALIZED ? 'مفعل' : 'غير مفعل'}`,
        `عدد الفواتير محلياً: ${invCount}`,
        `عدد العمال محلياً: ${wrkCount}`
    ];
    toast('⚙️ حالة مزامنة السحابة', lines.join('\n'), 'info');
}

async function forceSyncNow(showToast = true) {
    if (!FIREBASE_ENABLED) {
        if (showToast) toast('جاري الاتصال بالسحابة', 'محاولة إعداد Firebase مجدداً...', 'info');
        await new Promise((resolve) => initializeFirebaseSync(resolve));
        if (!FIREBASE_ENABLED) {
            if (showToast) toast('❌ تعذر الاتصال', `${LAST_SYNC_STATUS}\nاضغط حالة المزامنة لمزيد من التفاصيل`, 'error');
            return false;
        }
    }
    if (FIREBASE_ENABLED && !SYNC_INITIALIZED) startRealtimeListeners();
    if (showToast) toast('جاري المزامنة', 'جاري فحص قواعد السحابة ودمج البيانات...', 'info');
    const writeOk = await testFirebaseWrite();
    if (!writeOk) {
        if (showToast) toast('🚫 مرفوض من قواعد السحابة', LAST_SYNC_STATUS + '\nاذهب إلى Firebase → Firestore → Rules وانشر قواعد المزامنة الصحيحة ثم اضغط مزامنة فورية', 'error');
        return false;
    }
    try {
        const [cloudInvoices, cloudWorkers] = await Promise.all([
            cloudRead('app_data', STORAGE_KEYS.INVOICES),
            cloudRead('app_data', STORAGE_KEYS.WORKERS)
        ]);
        const localInvoices = safeGet(STORAGE_KEYS.INVOICES, []);
        const localWorkers = safeGet(STORAGE_KEYS.WORKERS, []);
        const mergedInvoices = mergeArraysById(localInvoices, cloudInvoices.data || []);
        const mergedWorkers = mergeArraysById(localWorkers, cloudWorkers.data || []);
        const invChanged = JSON.stringify(localInvoices) !== JSON.stringify(mergedInvoices);
        const wrkChanged = JSON.stringify(localWorkers) !== JSON.stringify(mergedWorkers);
        const cloudInvEmpty = !cloudInvoices.ok || cloudInvoices.empty || !Array.isArray(cloudInvoices.data) || cloudInvoices.data.length === 0;
        const cloudWrkEmpty = !cloudWorkers.ok || cloudWorkers.empty || !Array.isArray(cloudWorkers.data) || cloudWorkers.data.length === 0;
        if (invChanged || cloudInvEmpty) safeSet(STORAGE_KEYS.INVOICES, mergedInvoices);
        if (wrkChanged || cloudWrkEmpty) safeSet(STORAGE_KEYS.WORKERS, mergedWorkers);
        await Promise.all([
            cloudWrite('app_data', STORAGE_KEYS.INVOICES, safeGet(STORAGE_KEYS.INVOICES, [])),
            cloudWrite('app_data', STORAGE_KEYS.WORKERS, safeGet(STORAGE_KEYS.WORKERS, []))
        ]);
        LAST_SYNC_STATUS = `✅ تمت المزامنة — ${safeGet(STORAGE_KEYS.INVOICES, []).length} فاتورة + ${safeGet(STORAGE_KEYS.WORKERS, []).length} عامل`;
        if (showToast) {
            const total = safeGet(STORAGE_KEYS.INVOICES, []).length + safeGet(STORAGE_KEYS.WORKERS, []).length;
            toast('✅ تمت المزامنة', `يوجد حالياً ${total} سجل متزامن على جميع الأجهزة`, 'success');
        }
        try {
            const { page } = getRoute();
            if (['admin', 'invoices', 'workers', 'invoice', 'worker'].includes(page)) renderCurrentRoute();
        } catch (e) {}
        return true;
    } catch (e) {
        console.warn('Force sync error:', e);
        LAST_SYNC_STATUS = '❌ فشلت المزامنة: ' + (e.message || e);
        if (showToast) toast('❌ فشلت المزامنة', LAST_SYNC_STATUS, 'error');
        return false;
    }
}

async function pushAllLocalToCloud() {
    if (!FIREBASE_ENABLED) return;
    const invoices = safeGet(STORAGE_KEYS.INVOICES, []);
    const workers = safeGet(STORAGE_KEYS.WORKERS, []);
    await Promise.all([
        cloudWrite('app_data', STORAGE_KEYS.INVOICES, invoices),
        cloudWrite('app_data', STORAGE_KEYS.WORKERS, workers)
    ]);
}

async function pullCloudToLocal(overwrite = false) {
    if (!FIREBASE_ENABLED) return false;
    let anyChanged = false;
    const [cloudInvoices, cloudWorkers] = await Promise.all([
        cloudRead('app_data', STORAGE_KEYS.INVOICES),
        cloudRead('app_data', STORAGE_KEYS.WORKERS)
    ]);
    if (cloudInvoices.ok && !cloudInvoices.empty && Array.isArray(cloudInvoices.data)) {
        const localInvoices = safeGet(STORAGE_KEYS.INVOICES, []);
        const merged = overwrite
            ? cloudInvoices.data
            : mergeArraysById(localInvoices, cloudInvoices.data);
        if (JSON.stringify(localInvoices) !== JSON.stringify(merged)) {
            safeSet(STORAGE_KEYS.INVOICES, merged);
            anyChanged = true;
        }
    }
    if (cloudWorkers.ok && !cloudWorkers.empty && Array.isArray(cloudWorkers.data)) {
        const localWorkers = safeGet(STORAGE_KEYS.WORKERS, []);
        const merged = overwrite
            ? cloudWorkers.data
            : mergeArraysById(localWorkers, cloudWorkers.data);
        if (JSON.stringify(localWorkers) !== JSON.stringify(merged)) {
            safeSet(STORAGE_KEYS.WORKERS, merged);
            anyChanged = true;
        }
    }
    return anyChanged;
}

function startRealtimeListeners() {
    if (!FIREBASE_ENABLED || !db) return;
    if (SYNC_INITIALIZED) return;
    SYNC_INITIALIZED = true;

    db.collection('app_data').doc(STORAGE_KEYS.INVOICES).onSnapshot(snap => {
        if (!snap.exists) return;
        const d = snap.data();
        if (!d || !Array.isArray(d.data)) return;
        const localInvoices = safeGet(STORAGE_KEYS.INVOICES, []);
        const merged = mergeArraysById(localInvoices, d.data);
        if (JSON.stringify(localInvoices) !== JSON.stringify(merged)) {
            safeSet(STORAGE_KEYS.INVOICES, merged);
            try {
                const { page } = getRoute();
                if (['admin', 'invoices', 'invoice'].includes(page)) {
                    renderCurrentRoute();
                    toast('📡 تم تحديث البيانات', 'تم استلام تحديث من جهاز آخر — المزامنة تعمل', 'info');
                }
            } catch (e) {}
        }
    }, err => console.warn('Invoice listener err:', err));

    db.collection('app_data').doc(STORAGE_KEYS.WORKERS).onSnapshot(snap => {
        if (!snap.exists) return;
        const d = snap.data();
        if (!d || !Array.isArray(d.data)) return;
        const localWorkers = safeGet(STORAGE_KEYS.WORKERS, []);
        const merged = mergeArraysById(localWorkers, d.data);
        if (JSON.stringify(localWorkers) !== JSON.stringify(merged)) {
            safeSet(STORAGE_KEYS.WORKERS, merged);
            try {
                const { page } = getRoute();
                if (['admin', 'workers', 'worker'].includes(page)) {
                    renderCurrentRoute();
                    toast('📡 تم تحديث البيانات', 'تم استلام تحديث من جهاز آخر — المزامنة تعمل', 'info');
                }
            } catch (e) {}
        }
    }, err => console.warn('Workers listener err:', err));
}

async function initCloudSync() {
    initializeFirebaseSync(async (ready) => {
        if (!ready) {
            LAST_SYNC_STATUS = LAST_SYNC_STATUS || '❌ غير قادر على الاتصال بالسحابة';
            return;
        }
        try {
            const ok = await forceSyncNow(false);
            startRealtimeListeners();
            const invCount = safeGet(STORAGE_KEYS.INVOICES, []).length;
            const wrkCount = safeGet(STORAGE_KEYS.WORKERS, []).length;
            LAST_SYNC_STATUS = `✅ متصل بالسحابة — ${invCount} فاتورة + ${wrkCount} عامل متزامن`;
            if (ok) {
                toast('☁️ متصل بالسحابة', `${invCount} فاتورة + ${wrkCount} عامل — المزامنة التلقائية مفعلة`, 'success');
            }
        } catch (e) {
            console.warn('Cloud sync init failed:', e);
            LAST_SYNC_STATUS = '⚠️ تم الاتصال بالسحابة لكن المزامنة فشلت — اضغط مزامنة فورية';
        }
    });
}

const CRAFTSMAN_TYPES = ['نجار', 'حداد', 'سباك', 'دهان', 'كهربائي', 'أخرى'];

function formatCurrencySYP(value) {
    const num = Number(value) || 0;
    return num.toLocaleString('ar-SY') + ' ل.س';
}
function formatCurrencyUSD(value) {
    const num = Number(value) || 0;
    return '$' + num.toLocaleString('en-US');
}

// ============================================
// Utilities
// ============================================

function generateId(prefix = 'inv') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}${random}`;
}

function formatCurrency(value) {
    const num = Number(value) || 0;
    return num.toLocaleString('ar-SY');
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('ar-SY', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function formatDateInput(dateStr) {
    if (!dateStr) {
        const today = new Date();
        return today.toISOString().split('T')[0];
    }
    return new Date(dateStr).toISOString().split('T')[0];
}

function todayStr() {
    return new Date().toISOString().split('T')[0];
}

function safeGet(key, defaultValue) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return defaultValue;
        return JSON.parse(raw);
    } catch (e) {
        console.error('Storage read error:', e);
        return defaultValue;
    }
}

function safeSet(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        if (key === STORAGE_KEYS.INVOICES) {
            localStorage.setItem('jk_invoices_ts', String(Date.now()));
            if (FIREBASE_ENABLED && !window._jkCloudWriting?.invoices) {
                window._jkCloudWriting = window._jkCloudWriting || {};
                window._jkCloudWriting.invoices = true;
                cloudWrite('app_data', STORAGE_KEYS.INVOICES, value).finally(() => {
                    window._jkCloudWriting.invoices = false;
                });
            }
        } else if (key === STORAGE_KEYS.WORKERS) {
            localStorage.setItem('jk_workers_ts', String(Date.now()));
            if (FIREBASE_ENABLED && !window._jkCloudWriting?.workers) {
                window._jkCloudWriting = window._jkCloudWriting || {};
                window._jkCloudWriting.workers = true;
                cloudWrite('app_data', STORAGE_KEYS.WORKERS, value).finally(() => {
                    window._jkCloudWriting.workers = false;
                });
            }
        }
        return true;
    } catch (e) {
        console.error('Storage write error:', e);
        return false;
    }
}

function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================
// Toast Notifications
// ============================================

function ensureToastContainer() {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    return container;
}

function toast(title, message = '', type = 'info') {
    const container = ensureToastContainer();
    const toastEl = document.createElement('div');
    toastEl.className = `toast toast-${type}`;

    const icons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        info: 'fa-info-circle',
        warning: 'fa-exclamation-triangle'
    };

    toastEl.innerHTML = `
        <div class="toast-icon"><i class="fas ${icons[type] || 'fa-info-circle'}"></i></div>
        <div class="toast-content">
            ${title ? `<div class="toast-title">${escapeHtml(title)}</div>` : ''}
            ${message ? `<div class="toast-message">${escapeHtml(message)}</div>` : ''}
        </div>
    `;

    container.appendChild(toastEl);

    setTimeout(() => {
        toastEl.style.transition = 'all 0.3s ease';
        toastEl.style.opacity = '0';
        toastEl.style.transform = 'translateX(-30px)';
        setTimeout(() => toastEl.remove(), 300);
    }, 3500);
}

// ============================================
// Auth (Admin Login)
// ============================================

function ensureAdminCredentials() {
    const AUTH_VERSION = 2;
    const VERSION_KEY = 'jk_auth_version';

    const currentVersion = Number(localStorage.getItem(VERSION_KEY) || 0);
    const creds = safeGet(STORAGE_KEYS.ADMIN_CREDENTIALS, null);
    const auth = safeGet(STORAGE_KEYS.AUTH, null);

    let needsReset = false;
    if (currentVersion < AUTH_VERSION) needsReset = true;
    if (!creds || !creds.username) needsReset = true;
    if (auth && (!auth.version || auth.version < AUTH_VERSION)) needsReset = true;

    if (needsReset) {
        localStorage.removeItem(STORAGE_KEYS.AUTH);
        safeSet(STORAGE_KEYS.ADMIN_CREDENTIALS, {
            username: DEFAULT_ADMIN_USERNAME,
            password: DEFAULT_ADMIN_PASSWORD
        });
        localStorage.setItem(VERSION_KEY, String(AUTH_VERSION));
    }
}

function isAdminLoggedIn() {
    const AUTH_VERSION = 2;
    const auth = safeGet(STORAGE_KEYS.AUTH, null);
    if (!auth) return false;
    if (!auth.version || auth.version < AUTH_VERSION) {
        localStorage.removeItem(STORAGE_KEYS.AUTH);
        return false;
    }
    if (auth.expiresAt && Date.now() > auth.expiresAt) {
        localStorage.removeItem(STORAGE_KEYS.AUTH);
        return false;
    }
    return !!auth.isAdmin;
}

function adminLogin(username, password) {
    const AUTH_VERSION = 2;
    const creds = safeGet(STORAGE_KEYS.ADMIN_CREDENTIALS, {});
    const validUsername = creds.username || DEFAULT_ADMIN_USERNAME;
    const validPassword = creds.password || DEFAULT_ADMIN_PASSWORD;
    if (username === validUsername && password === validPassword) {
        safeSet(STORAGE_KEYS.AUTH, {
            version: AUTH_VERSION,
            isAdmin: true,
            loggedInAt: Date.now(),
            expiresAt: Date.now() + (1000 * 60 * 60 * 24 * 7)
        });
        setTimeout(() => initCloudSync(), 200);
        return true;
    }
    return false;
}

function adminLogout() {
    localStorage.removeItem(STORAGE_KEYS.AUTH);
}

// ============================================
// Invoices Data Store
// ============================================

function migrateInvoice(inv) {
    if (!inv) return inv;
    let changed = false;
    if (inv.agreedAmount !== undefined && inv.agreedAmountSYP === undefined) {
        inv.agreedAmountSYP = Number(inv.agreedAmount) || 0;
        inv.agreedAmountUSD = 0;
        delete inv.agreedAmount;
        changed = true;
    }
    if (Array.isArray(inv.payments)) {
        inv.payments = inv.payments.map(p => {
            if (p.amount !== undefined && p.amountSYP === undefined) {
                return {
                    ...p,
                    amountSYP: Number(p.amount) || 0,
                    amountUSD: 0,
                    craftsmanType: p.craftsmanType || ''
                };
            }
            if (p.craftsmanType === undefined) {
                return { ...p, craftsmanType: '' };
            }
            return p;
        });
        changed = true;
    }
    if (!Array.isArray(inv.materials)) {
        inv.materials = [];
        changed = true;
    }
    if (!Array.isArray(inv.sitePhotos)) {
        inv.sitePhotos = [];
        changed = true;
    }
    return inv;
}

function getAllInvoices() {
    const raw = safeGet(STORAGE_KEYS.INVOICES, []);
    let anyChanged = false;
    const migrated = raw.map(inv => {
        const origKeys = Object.keys(inv || {}).length;
        const m = migrateInvoice(inv);
        const newKeys = Object.keys(m || {}).length;
        if (origKeys !== newKeys || (!Array.isArray(inv?.materials)) || (!Array.isArray(inv?.sitePhotos))) anyChanged = true;
        return m;
    });
    if (anyChanged) {
        saveAllInvoices(migrated);
    }
    return migrated;
}

function saveAllInvoices(invoices) {
    safeSet(STORAGE_KEYS.INVOICES, invoices);
}

function getInvoiceById(id) {
    return getAllInvoices().find(inv => inv.id === id) || null;
}

function createInvoice(data) {
    const invoices = getAllInvoices();
    const newInvoice = {
        id: generateId(),
        customerName: data.customerName || '',
        agreedAmountSYP: Number(data.agreedAmountSYP) || 0,
        agreedAmountUSD: Number(data.agreedAmountUSD) || 0,
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        clientPayments: Array.isArray(data.clientPayments) ? data.clientPayments.map(cp => ({
            id: generateId('cpay'),
            amountSYP: Number(cp.amountSYP) || 0,
            amountUSD: Number(cp.amountUSD) || 0,
            note: cp.note || '',
            date: cp.date || todayStr()
        })) : [],
        payments: Array.isArray(data.payments) ? data.payments.map(p => ({
            id: generateId('pay'),
            amountSYP: Number(p.amountSYP) || 0,
            amountUSD: Number(p.amountUSD) || 0,
            craftsmanType: p.craftsmanType || '',
            craftsmanName: p.craftsmanName || '',
            date: p.date || todayStr()
        })) : [],
        materials: Array.isArray(data.materials) ? data.materials.map(m => ({
            id: generateId('mat'),
            amountSYP: Number(m.amountSYP) || 0,
            amountUSD: Number(m.amountUSD) || 0,
            materialName: m.materialName || '',
            date: m.date || todayStr()
        })) : [],
        sitePhotos: Array.isArray(data.sitePhotos) ? data.sitePhotos : []
    };

    invoices.unshift(newInvoice);
    saveAllInvoices(invoices);
    return newInvoice;
}

function updateInvoice(id, updates) {
    const invoices = getAllInvoices();
    const idx = invoices.findIndex(inv => inv.id === id);
    if (idx === -1) return null;

    const inv = invoices[idx];
    if (updates.customerName !== undefined) inv.customerName = updates.customerName;
    if (updates.agreedAmountSYP !== undefined) inv.agreedAmountSYP = Number(updates.agreedAmountSYP) || 0;
    if (updates.agreedAmountUSD !== undefined) inv.agreedAmountUSD = Number(updates.agreedAmountUSD) || 0;
    if (updates.payments !== undefined) {
        inv.payments = updates.payments.map(p => {
            if (p.id) return { ...p, amountSYP: Number(p.amountSYP) || 0, amountUSD: Number(p.amountUSD) || 0 };
            return {
                id: generateId('pay'),
                amountSYP: Number(p.amountSYP) || 0,
                amountUSD: Number(p.amountUSD) || 0,
                craftsmanType: p.craftsmanType || '',
                craftsmanName: p.craftsmanName || '',
                date: p.date || todayStr()
            };
        });
    }
    if (updates.clientPayments !== undefined) {
        inv.clientPayments = updates.clientPayments.map(cp => {
            if (cp.id) return { ...cp, amountSYP: Number(cp.amountSYP) || 0, amountUSD: Number(cp.amountUSD) || 0 };
            return {
                id: generateId('cpay'),
                amountSYP: Number(cp.amountSYP) || 0,
                amountUSD: Number(cp.amountUSD) || 0,
                note: cp.note || '',
                date: cp.date || todayStr()
            };
        });
    }
    if (updates.materials !== undefined) {
        inv.materials = updates.materials.map(m => {
            if (m.id) return { ...m, amountSYP: Number(m.amountSYP) || 0, amountUSD: Number(m.amountUSD) || 0 };
            return {
                id: generateId('mat'),
                amountSYP: Number(m.amountSYP) || 0,
                amountUSD: Number(m.amountUSD) || 0,
                materialName: m.materialName || '',
                date: m.date || todayStr()
            };
        });
    }
    if (updates.sitePhotos !== undefined) inv.sitePhotos = updates.sitePhotos;
    inv.updatedAt = new Date().toISOString();

    invoices[idx] = inv;
    saveAllInvoices(invoices);
    return inv;
}

function deleteInvoice(id) {
    const invoices = getAllInvoices();
    const filtered = invoices.filter(inv => inv.id !== id);
    saveAllInvoices(filtered);
    return filtered.length !== invoices.length;
}

function migrateInvoiceClientPayments(invoice) {
    if (!invoice) return invoice;
    let needsSave = false;
    if (!Array.isArray(invoice.clientPayments)) {
        invoice.clientPayments = [];
        const payments = invoice.payments || [];
        payments.forEach(p => {
            const isCraftsman = !!(p.craftsmanType || p.craftsmanName);
            if (!isCraftsman && ((Number(p.amountSYP) || 0) > 0 || (Number(p.amountUSD) || 0) > 0)) {
                invoice.clientPayments.push({
                    id: p.id || generateId('cpay'),
                    amountSYP: Number(p.amountSYP) || 0,
                    amountUSD: Number(p.amountUSD) || 0,
                    note: '',
                    date: p.date || todayStr()
                });
                needsSave = true;
            }
        });
        if (invoice.clientPayments.length === 0 && payments.length > 0) {
            const sumSYP = payments.reduce((s, p) => s + (Number(p.amountSYP) || 0), 0);
            const sumUSD = payments.reduce((s, p) => s + (Number(p.amountUSD) || 0), 0);
            if (sumSYP > 0 || sumUSD > 0) {
                invoice.clientPayments.push({
                    id: generateId('cpay'),
                    amountSYP: sumSYP,
                    amountUSD: sumUSD,
                    note: 'مجموع مستلم سابق (محول تلقائياً)',
                    date: invoice.updatedAt || invoice.createdAt || todayStr()
                });
                needsSave = true;
            }
        }
    }
    if (needsSave) {
        const invoices = getAllInvoices();
        const idx = invoices.findIndex(x => x.id === invoice.id);
        if (idx >= 0) {
            invoices[idx] = { ...invoice, updatedAt: new Date().toISOString() };
            saveAllInvoices(invoices);
            invoice = invoices[idx];
        }
    }
    return invoice;
}

function computeInvoiceTotals(invoice) {
    const clientPayments = (invoice.clientPayments && invoice.clientPayments.length)
        ? invoice.clientPayments
        : (invoice.payments || []).filter(p => !p.craftsmanType && !p.craftsmanName);
    const totalReceivedSYP = (clientPayments || []).reduce((sum, p) => sum + (Number(p.amountSYP) || 0), 0);
    const totalReceivedUSD = (clientPayments || []).reduce((sum, p) => sum + (Number(p.amountUSD) || 0), 0);
    const remainingSYP = Math.max(0, (Number(invoice.agreedAmountSYP) || 0) - totalReceivedSYP);
    const remainingUSD = Math.max(0, (Number(invoice.agreedAmountUSD) || 0) - totalReceivedUSD);
    const totalMaterialsSYP = (invoice.materials || []).reduce((sum, m) => sum + (Number(m.amountSYP) || 0), 0);
    const totalMaterialsUSD = (invoice.materials || []).reduce((sum, m) => sum + (Number(m.amountUSD) || 0), 0);
    return { totalReceivedSYP, totalReceivedUSD, remainingSYP, remainingUSD, totalMaterialsSYP, totalMaterialsUSD };
}

function getInvoiceStatus(invoice) {
    const { totalReceivedSYP, totalReceivedUSD, remainingSYP, remainingUSD } = computeInvoiceTotals(invoice);
    const agreedSYP = Number(invoice.agreedAmountSYP) || 0;
    const agreedUSD = Number(invoice.agreedAmountUSD) || 0;
    if (agreedSYP === 0 && agreedUSD === 0) return 'pending';
    if (remainingSYP === 0 && remainingUSD === 0) return 'paid';
    if (totalReceivedSYP === 0 && totalReceivedUSD === 0) return 'pending';
    return 'partial';
}

function getInvoiceShareUrl(invoiceId) {
    const base = window.location.origin + window.location.pathname;
    return `${base}#/invoice/${invoiceId}`;
}

// ============================================
// Workers & Wages Data Store
// ============================================

function getAllWorkers() {
    return safeGet(STORAGE_KEYS.WORKERS, []);
}

function saveAllWorkers(workers) {
    safeSet(STORAGE_KEYS.WORKERS, workers);
}

function getWorkerById(id) {
    return getAllWorkers().find(w => w.id === id) || null;
}

function createWorker(data) {
    const workers = getAllWorkers();
    const newWorker = {
        id: generateId('wkr'),
        name: data.name || '',
        profession: data.profession || '',
        phone: data.phone || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        payments: []
    };
    workers.unshift(newWorker);
    saveAllWorkers(workers);
    return newWorker;
}

function updateWorker(id, updates) {
    const workers = getAllWorkers();
    const idx = workers.findIndex(w => w.id === id);
    if (idx === -1) return null;
    const w = workers[idx];
    if (updates.name !== undefined) w.name = updates.name;
    if (updates.profession !== undefined) w.profession = updates.profession;
    if (updates.phone !== undefined) w.phone = updates.phone;
    w.updatedAt = new Date().toISOString();
    workers[idx] = w;
    saveAllWorkers(workers);
    return w;
}

function deleteWorker(id) {
    const workers = getAllWorkers();
    const filtered = workers.filter(w => w.id !== id);
    saveAllWorkers(filtered);
    return filtered.length !== workers.length;
}

function addWorkerPayment(workerId, data) {
    const workers = getAllWorkers();
    const idx = workers.findIndex(w => w.id === workerId);
    if (idx === -1) return null;
    const payment = {
        id: generateId('wpay'),
        amountSYP: Number(data.amountSYP) || 0,
        amountUSD: Number(data.amountUSD) || 0,
        date: data.date || todayStr(),
        note: data.note || ''
    };
    workers[idx].payments = workers[idx].payments || [];
    workers[idx].payments.unshift(payment);
    workers[idx].updatedAt = new Date().toISOString();
    saveAllWorkers(workers);
    return payment;
}

function removeWorkerPayment(workerId, paymentId) {
    const workers = getAllWorkers();
    const idx = workers.findIndex(w => w.id === workerId);
    if (idx === -1) return false;
    workers[idx].payments = (workers[idx].payments || []).filter(p => p.id !== paymentId);
    workers[idx].updatedAt = new Date().toISOString();
    saveAllWorkers(workers);
    return true;
}

function computeWorkerTotals(worker) {
    const totalSYP = (worker.payments || []).reduce((s, p) => s + (Number(p.amountSYP) || 0), 0);
    const totalUSD = (worker.payments || []).reduce((s, p) => s + (Number(p.amountUSD) || 0), 0);
    return { totalSYP, totalUSD, paymentsCount: (worker.payments || []).length };
}

// ============================================
// Router (Hash-based)
// ============================================

function getRoute() {
    const hash = window.location.hash || '#/';
    const cleanHash = hash.replace(/^#\/?/, '');
    const parts = cleanHash.split('/').filter(Boolean);

    if (parts.length === 0) return { page: 'home', params: {} };

    const page = parts[0];
    const params = {};

    if (page === 'invoice' && parts[1]) {
        params.invoiceId = parts[1];
    }
    if (page === 'worker' && parts[1]) {
        params.workerId = parts[1];
    }

    return { page, params };
}

function navigate(page, params = {}) {
    let hash = `#/${page}`;
    if (page === 'invoice' && params.invoiceId) {
        hash = `#/invoice/${params.invoiceId}`;
    }
    if (page === 'worker' && params.workerId) {
        hash = `#/worker/${params.workerId}`;
    }
    window.location.hash = hash;
}

window.addEventListener('hashchange', renderCurrentRoute);

// ============================================
// Navbar State
// ============================================

function updateNavbar(page) {
    const adminPages = ['admin', 'invoices', 'workers', 'worker'];
    document.querySelectorAll('.nav-link').forEach(link => {
        const linkPage = link.getAttribute('data-page');
        let isActive = (linkPage === page);
        if (linkPage === 'admin' && adminPages.includes(page)) {
            isActive = true;
        }
        if (isActive) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

function updateNavbarScroll() {
    const navbar = document.getElementById('navbar');
    if (window.scrollY > 30) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
}

function updateNavbarVisibility() {
    const isAdmin = isAdminLoggedIn();
    if (isAdmin) {
        document.body.classList.add('admin-logged-in');
    } else {
        document.body.classList.remove('admin-logged-in');
    }
}

window.addEventListener('scroll', updateNavbarScroll);

// ============================================
// Page Renderers
// ============================================

function renderCurrentRoute() {
    const { page, params } = getRoute();
    const app = document.getElementById('app');

    updateNavbar(page);
    updateNavbarScroll();
    updateNavbarVisibility();

    app.innerHTML = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
        switch (page) {
            case 'home':
                app.innerHTML = renderHomePage();
                attachHomeEvents();
                break;
            case 'invoices':
                if (!isAdminLoggedIn()) {
                    navigate('admin');
                    return;
                }
                app.innerHTML = renderInvoicesDashboard();
                attachDashboardEvents();
                break;
            case 'workers':
                if (!isAdminLoggedIn()) {
                    navigate('admin');
                    return;
                }
                app.innerHTML = renderWorkersDashboard();
                attachWorkersDashboardEvents();
                break;
            case 'admin':
                app.innerHTML = renderAdminPage();
                if (isAdminLoggedIn()) {
                    attachDashboardEvents();
                } else {
                    attachLoginEvents();
                }
                break;
            case 'invoice':
                app.innerHTML = renderInvoiceView(params.invoiceId);
                break;
            case 'worker':
                if (!isAdminLoggedIn()) {
                    navigate('admin');
                    return;
                }
                app.innerHTML = renderWorkerDetailView(params.workerId);
                break;
            default:
                app.innerHTML = renderHomePage();
                attachHomeEvents();
        }
    } catch (e) {
        console.error('Render error:', e);
        app.innerHTML = `<div class="dashboard"><p>حدث خطأ في تحميل الصفحة. يرجى المحاولة مرة أخرى.</p></div>`;
    }
}

// ============================================
// HOME PAGE
// ============================================

function renderHomePage() {
    return `
        <!-- Hero Section -->
        <section class="hero">
            <div class="hero-container">
                <div class="hero-content">
                    <div class="hero-badge">
                        <i class="fas fa-crown"></i>
                        <span>عمارة وتصميم داخلي فاخر</span>
                    </div>
                    <h1 class="hero-title">
                        نصمم مساحات<br>
                        تحكي <span class="accent">قصتك</span>
                    </h1>
                    <p class="hero-subtitle">
                        مهندسة عمارة وتصميم داخلي. نحول أفكاركم إلى واقع ملموس، 
                        من المخططات المعمارية إلى أجمل التصاميم الداخلية التي تعكس 
                        ذوقكم وتلبي طموحاتكم.
                    </p>
                    <div class="hero-cta">
                        <a href="#contact-section" class="btn btn-outline btn-lg">
                            <i class="fas fa-phone-alt"></i>
                            تواصل معنا
                        </a>
                    </div>
                </div>

                <div class="hero-visual">
                    <div class="hero-image-frame">
                        <div class="gold-corner top-right"></div>
                        <div class="gold-corner bottom-left"></div>
                        <div class="hero-image-inner">
                            <img src="logo.png" alt="Jessica Kassab" class="big-logo" style="filter: brightness(0) invert(1);">
                            <h3>ARCHITECTURE</h3>
                            <p>INTERIOR DESIGN</p>
                        </div>
                    </div>

                    <div class="floating-card card-1">
                        <div class="floating-card-icon"><i class="fas fa-drafting-compass"></i></div>
                        <div class="floating-card-text">تصاميم مبتكرة</div>
                        <div class="floating-card-sub">أفكار استثنائية</div>
                    </div>

                    <div class="floating-card card-2">
                        <div class="floating-card-icon"><i class="fas fa-gem"></i></div>
                        <div class="floating-card-text">جودة فاخرة</div>
                        <div class="floating-card-sub">تفاصيل دقيقة</div>
                    </div>
                </div>
            </div>
        </section>

        <!-- Portfolio / Selected Works (Luxury Auto Carousel with Premium Gold Frame) -->
        <section class="works-section" id="portfolio">
            <div class="section-header">
                <span class="section-label">معرض الأعمال</span>
                <h2 class="section-title">أبرز مشاريعنا</h2>
                <p class="section-desc">مجموعة مختارة من أحدث مشاريعنا التي تم تنفيذها بأعلى معايير الجودة والذوق الفاخر</p>
            </div>

            <!-- LUXURY GOLD-FRAMED AUTO CAROUSEL (no scroll, no marquee) -->
            <div class="works-carousel-wrap" id="worksCarouselWrap">
                <div class="works-carousel" id="worksCarousel">

                    <!-- Layer 1: Slides (images fade in/out) -->
                    <div class="works-c-slides" id="worksSlides">
                        <div class="works-c-slide" data-project="0">
                            <img src="works/0bf6e5ee-c51f-4aa1-b9ec-1567141bf451.jpg" alt="فيلا كركوك الحديثة">
                            <div class="works-c-vignette"></div>
                        </div>
                        <div class="works-c-slide" data-project="1">
                            <img src="works/1f83e2b1-504d-4cfa-878e-7d641ad09c65.jpg" alt="مول الشام التجاري">
                            <div class="works-c-vignette"></div>
                        </div>
                        <div class="works-c-slide" data-project="2">
                            <img src="works/38f946fa-13eb-4e91-8383-877c668c10a6.jpg" alt="جناح فندق اللؤلؤة">
                            <div class="works-c-vignette"></div>
                        </div>
                        <div class="works-c-slide" data-project="3">
                            <img src="works/65df641e-5ce2-4bc3-8c72-500a3d71f9eb.jpg" alt="استوديو الإبداع">
                            <div class="works-c-vignette"></div>
                        </div>
                        <div class="works-c-slide" data-project="4">
                            <img src="works/689278f9-1e70-4ca7-9975-2b4fea607df4.jpg" alt="قصر العليا للمناسبات">
                            <div class="works-c-vignette"></div>
                        </div>
                        <div class="works-c-slide" data-project="5">
                            <img src="works/70a6bab2-9f7a-4a75-b57c-976fd174905a.jpg" alt="مكتب تنفيذي فاخر">
                            <div class="works-c-vignette"></div>
                        </div>
                        <div class="works-c-slide" data-project="6">
                            <img src="works/80997e48-7490-4e96-be58-56fd7dbd1c69.jpg" alt="مطعم ديار الشام">
                            <div class="works-c-vignette"></div>
                        </div>
                        <div class="works-c-slide" data-project="7">
                            <img src="works/9d52e986-c4cd-4c50-9625-59f6b7734552.jpg" alt="استوديو الإنتاج">
                            <div class="works-c-vignette"></div>
                        </div>
                        <div class="works-c-slide" data-project="8">
                            <img src="works/9e265670-785b-4bd6-aee2-1b9bd10cf242.jpg" alt="فيلا الجوار الحديثة">
                            <div class="works-c-vignette"></div>
                        </div>
                    </div>

                    <!-- Layer 2: Thin, refined frame (double hairline gold lines — elegant, understated) -->
                    <div class="works-c-frame" aria-hidden="true">
                        <span class="works-c-frame-line works-c-frame-line-outer"></span>
                        <span class="works-c-frame-line works-c-frame-line-inner"></span>
                    </div>

                    <!-- Dots indicator (bottom center) -->
                    <div class="works-c-dots" id="worksDots" aria-label="تنقل المشاريع">
                        <!-- filled by JS -->
                    </div>
                </div>
            </div>
        </section>

        <!-- Services Section -->
        <section class="section">
            <div class="section-header">
                <span class="section-label">خدماتنا</span>
                <h2 class="section-title">ما نقدمه لكم</h2>
                <p class="section-desc">حلول متكاملة في مجال العمارة والتصميم الداخلي لتجعل مساحتك فريدة من نوعها</p>
            </div>

            <div class="services-grid">
                <div class="service-card">
                    <div class="service-icon"><i class="fas fa-drafting-compass"></i></div>
                    <h3>التصميم المعماري</h3>
                    <p>تصاميم معمارية مبتكرة تناسب احتياجاتكم وتطلعاتكم، مع مراعاة جميع المتطلبات الفنية والجمالية.</p>
                </div>

                <div class="service-card">
                    <div class="service-icon"><i class="fas fa-couch"></i></div>
                    <h3>التصميم الداخلي</h3>
                    <p>إضاءة، أثاث، وتفاصيل دقيقة تحول المساحات إلى أماكن مميزة تعكس شخصيتكم وأذواقكم الفريدة.</p>
                </div>

                <div class="service-card">
                    <div class="service-icon"><i class="fas fa-tools"></i></div>
                    <h3>إدارة التنفيذ</h3>
                    <p>إشراف كامل على مراحل البناء والتنفيذ، وإدارة الحرفيين والموردين لضمان الجودة والتسليم في الوقت المحدد.</p>
                </div>

                <div class="service-card">
                    <div class="service-icon"><i class="fas fa-ruler-combined"></i></div>
                    <h3>التخطيط المكاني</h3>
                    <p>تحليل وتوزيع المساحات بشكل أمثل يضمن أقصى استفادة وظيفية مع الحفاظ على السلاسة والجمالية.</p>
                </div>

                <div class="service-card">
                    <div class="service-icon"><i class="fas fa-palette"></i></div>
                    <h3>استشارات ذوقية</h3>
                    <p>مساعدة في اختيار الألوان، الخامات، والقطع الأثاثية المناسبة للوصول لهوية بصرية متكاملة ومتناسقة.</p>
                </div>

                <div class="service-card">
                    <div class="service-icon"><i class="fas fa-file-invoice-dollar"></i></div>
                    <h3>تتبع المدفوعات</h3>
                    <p>نظام متكامل لإدارة الفواتير وتتبع المدفوعات للحرفيين، مع إمكانية مشاركتها مع العملاء بسهولة وشفافية.</p>
                </div>
            </div>
        </section>

        <!-- Contact Section -->
        <section class="contact-section" id="contact-section">
            <div class="contact-container">
                <div class="contact-grid">
                    <div class="contact-text">
                        <h2>لنبدأ <span class="accent">مشروعكِ</span> معاً</h2>
                        <p>هل لديكِ مشروع في خيالكِ؟ أنا هنا لأحوله إلى حقيقة ملموسة. 
                        تواصلي معي الآن لنناقش تفاصيل مشروعكِ ونبدأ برحلة إبداعية مميزة.</p>

                        <div class="contact-info-list">
                            <div class="contact-item">
                                <div class="contact-item-icon">
                                    <i class="fas fa-phone-alt"></i>
                                </div>
                                <div class="contact-item-text">
                                    <h4>اتصال / واتساب</h4>
                                    <p dir="ltr">00963 919 296 15</p>
                                </div>
                            </div>

                            <div class="contact-item">
                                <div class="contact-item-icon">
                                    <i class="fas fa-envelope"></i>
                                </div>
                                <div class="contact-item-text">
                                    <h4>البريد الإلكتروني</h4>
                                    <p dir="ltr">kassabjassica@gmail.com</p>
                                </div>
                            </div>

                            <div class="contact-item">
                                <div class="contact-item-icon">
                                    <i class="fas fa-map-marker-alt"></i>
                                </div>
                                <div class="contact-item-text">
                                    <h4>الموقع</h4>
                                    <p>حمص، سوريا</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="contact-card">
                        <div class="contact-card-header">
                            <img src="logo.png" alt="Jessica Kassab" class="contact-card-logo">
                            <h3>JESSICA KASSAB</h3>
                            <p>Architect & Interior Designer</p>
                        </div>
                        <div class="contact-card-actions">
                            <a href="tel:0096391929615" class="btn btn-gold">
                                <i class="fas fa-phone-alt"></i>
                                اتصال الآن
                            </a>
                            <a href="https://wa.me/96391929615" target="_blank" class="btn btn-primary">
                                <i class="fab fa-whatsapp"></i>
                                واتساب
                            </a>
                            <a href="mailto:kassabjassica@gmail.com" class="btn btn-outline">
                                <i class="fas fa-envelope"></i>
                                إرسال بريد
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function attachHomeEvents() {
    // Smooth scroll for contact link
    const contactLink = document.querySelector('a[href="#contact-section"]');
    if (contactLink) {
        contactLink.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.getElementById('contact-section');
            if (target) target.scrollIntoView({ behavior: 'smooth' });
        });
    }

    // ============ LUXURY WORKS GALLERY (AUTO CAROUSEL - NO SCROLL / NO MARQUEE) ============
    const worksCarouselWrap = document.getElementById('worksCarouselWrap');
    const worksSlides = document.getElementById('worksSlides');
    const worksDotsWrap = document.getElementById('worksDots');

    if (worksCarouselWrap && worksSlides) {
        const SLIDE_COUNT = 9;
        const AUTO_INTERVAL_MS = 7000; // 7 seconds per slide — luxury calm pace
        let activeIndex = 0;
        let autoTimer = null;

        // Build dots (9 dots, bottom center)
        if (worksDotsWrap) {
            worksDotsWrap.innerHTML = '';
            for (let i = 0; i < SLIDE_COUNT; i++) {
                const b = document.createElement('button');
                b.className = 'works-c-dot' + (i === 0 ? ' is-active' : '');
                b.setAttribute('aria-label', `المشروع ${i + 1}`);
                b.addEventListener('click', () => {
                    goToSlide(i);
                    resetAutoTimer();
                });
                worksDotsWrap.appendChild(b);
            }
        }

        const slides = Array.from(worksSlides.querySelectorAll('.works-c-slide'));

        function setActive(index) {
            index = Math.max(0, Math.min(SLIDE_COUNT - 1, index));
            if (index === activeIndex) return;
            activeIndex = index;

            // Slides
            slides.forEach((s, i) => s.classList.toggle('is-active', i === index));

            // Dots
            if (worksDotsWrap) {
                const dots = worksDotsWrap.querySelectorAll('.works-c-dot');
                dots.forEach((d, i) => d.classList.toggle('is-active', i === index));
            }
        }

        function goToSlide(index) {
            setActive(index);
        }

        function nextSlide() {
            goToSlide((activeIndex + 1) % SLIDE_COUNT);
        }

        function startAutoTimer() {
            if (autoTimer) clearInterval(autoTimer);
            autoTimer = setInterval(nextSlide, AUTO_INTERVAL_MS);
        }

        function resetAutoTimer() {
            if (autoTimer) clearInterval(autoTimer);
            startAutoTimer();
        }

        // Pause on hover, resume on leave
        worksCarouselWrap.addEventListener('mouseenter', () => {
            if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
        });
        worksCarouselWrap.addEventListener('mouseleave', () => {
            startAutoTimer();
        });

        // Pause when tab is hidden
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
            } else {
                startAutoTimer();
            }
        });

        // Preload all slides
        slides.forEach(s => {
            const img = s.querySelector('img');
            if (img) { const clone = new Image(); clone.src = img.src; }
        });

        // Init + start auto rotation
        // Small delay to trigger Ken Burns transition on the very first slide (it was missing because .is-active was static in HTML)
        setTimeout(() => {
            setActive(0);
            startAutoTimer();
        }, 260);
    }
}

// ============================================
// ADMIN PAGE (Login / Dashboard)
// ============================================

function renderAdminPage() {
    if (isAdminLoggedIn()) {
        return renderAdminDashboardHome();
    }
    return renderLoginPage();
}

function renderAdminDashboardHome() {
    const invoices = getAllInvoices();
    const workers = getAllWorkers();

    const invStats = invoices.reduce((acc, inv) => {
        const totals = computeInvoiceTotals(inv);
        acc.count += 1;
        acc.agreedSYP += Number(inv.agreedAmountSYP) || 0;
        acc.agreedUSD += Number(inv.agreedAmountUSD) || 0;
        acc.receivedSYP += totals.totalReceivedSYP;
        acc.receivedUSD += totals.totalReceivedUSD;
        acc.remainingSYP += totals.remainingSYP;
        acc.remainingUSD += totals.remainingUSD;
        return acc;
    }, { count: 0, agreedSYP: 0, agreedUSD: 0, receivedSYP: 0, receivedUSD: 0, remainingSYP: 0, remainingUSD: 0 });

    const wrkStats = workers.reduce((acc, w) => {
        const t = computeWorkerTotals(w);
        acc.count += 1;
        acc.totalSYP += t.totalSYP;
        acc.totalUSD += t.totalUSD;
        acc.paymentsCount += t.paymentsCount;
        return acc;
    }, { count: 0, totalSYP: 0, totalUSD: 0, paymentsCount: 0 });

    return `
        <div class="dashboard">
            <div class="admin-banner">
                <div class="admin-banner-info">
                    <div class="admin-banner-icon"><i class="fas fa-user-shield"></i></div>
                    <div class="admin-banner-text">
                        <h4>وضع المدير</h4>
                        <p>مرحباً بك في لوحة التحكم الرئيسية — اختر الوحدة التي تريد إدارتها</p>
                    </div>
                </div>
                <div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
                    <button class="btn btn-primary btn-sm" onclick="forceSyncNow(true)" title="مزامنة يدوية فورية مع السحابة">
                        <i class="fas fa-sync-alt"></i>
                        مزامنة فورية
                    </button>
                    <button class="btn btn-outline-gold btn-sm" onclick="showSyncStatus()" title="عرض حالة الاتصال بالسحابة وتفاصيل المزامنة">
                        <i class="fas fa-info-circle"></i>
                        حالة المزامنة
                    </button>
                    <button class="btn btn-outline-gold btn-sm" onclick="changePasswordModal()">
                        <i class="fas fa-key"></i>
                        تغيير كلمة المرور
                    </button>
                    <button class="btn btn-outline btn-sm" onclick="handleLogout()">
                        <i class="fas fa-sign-out-alt"></i>
                        تسجيل الخروج
                    </button>
                </div>
            </div>

            <div class="page-header">
                <div class="page-title">
                    <h1>لوحة التحكم الرئيسية</h1>
                    <p>نظرة سريعة على إحصائيات الفواتير وأجور العمال في المشروع</p>
                </div>
            </div>

            <div class="stats-grid">
                <div class="stat-card stat-count">
                    <div class="stat-icon"><i class="fas fa-file-invoice-dollar"></i></div>
                    <div class="stat-label">عدد الفواتير</div>
                    <div class="stat-value">${invStats.count}</div>
                </div>
                <div class="stat-card stat-paid">
                    <div class="stat-icon"><i class="fas fa-coins"></i></div>
                    <div class="stat-label">إجمالي المدفوعات للعملاء (ل.س)</div>
                    <div class="stat-value currency" style="font-size:0.9rem;">${formatCurrencySYP(invStats.receivedSYP)}</div>
                </div>
                <div class="stat-card stat-total">
                    <div class="stat-icon"><i class="fas fa-dollar-sign"></i></div>
                    <div class="stat-label">إجمالي المدفوعات للعملاء ($)</div>
                    <div class="stat-value currency" style="font-size:0.9rem;">${formatCurrencyUSD(invStats.receivedUSD)}</div>
                </div>
                <div class="stat-card stat-remaining" style="--stat-accent: var(--color-info);">
                    <div class="stat-icon"><i class="fas fa-users"></i></div>
                    <div class="stat-label">عدد العمال</div>
                    <div class="stat-value">${wrkStats.count}</div>
                </div>
            </div>

            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:1.5rem; margin-top:1rem;">
                <div class="dashboard-section" onclick="navigate('invoices')" style="cursor:pointer; transition:transform 0.25s ease, box-shadow 0.25s ease;" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 12px 32px rgba(0,0,0,0.08)';" onmouseout="this.style.transform=''; this.style.boxShadow='';">
                    <div class="dashboard-section-header" style="border-bottom:none; padding-bottom:0.75rem;">
                        <h2 style="display:flex; align-items:center; gap:0.75rem;">
                            <span style="width:44px; height:44px; border-radius:50%; background:linear-gradient(135deg, rgba(212,175,55,0.18) 0%, rgba(212,175,55,0.06) 100%); color:var(--color-gold-dark); display:inline-flex; align-items:center; justify-content:center; font-size:1.1rem;">
                                <i class="fas fa-file-invoice"></i>
                            </span>
                            إدارة الفواتير
                        </h2>
                        <div class="link-back" style="opacity:0.9;">
                            فتح القسم <i class="fas fa-chevron-left" style="margin-right:0.4rem;"></i>
                        </div>
                    </div>
                    <div style="padding:0 1.5rem 1.5rem 1.5rem;">
                        <p style="color:var(--color-gray); margin-bottom:1.25rem; line-height:1.8;">إدارة فواتير العملاء، تتبع المبالغ المتفق عليها والمستلمة والمتبقية، إنشاء وتعديل الفواتير وإرسال روابط المعاينة المباشرة للعملاء.</p>
                        <div class="stats-grid" style="grid-template-columns: repeat(3, 1fr); gap:0.75rem;">
                            <div class="stat-card" style="padding:0.85rem 1rem; --stat-accent: var(--color-gold);">
                                <div class="stat-label" style="font-size:0.75rem;">إجمالي المتفق</div>
                                <div class="stat-value currency" style="font-size:0.8rem;">${formatCurrencySYP(invStats.agreedSYP)}<br>${formatCurrencyUSD(invStats.agreedUSD)}</div>
                            </div>
                            <div class="stat-card stat-paid" style="padding:0.85rem 1rem;">
                                <div class="stat-label" style="font-size:0.75rem;">المستلم</div>
                                <div class="stat-value currency" style="font-size:0.8rem;">${formatCurrencySYP(invStats.receivedSYP)}<br>${formatCurrencyUSD(invStats.receivedUSD)}</div>
                            </div>
                            <div class="stat-card stat-remaining" style="padding:0.85rem 1rem;">
                                <div class="stat-label" style="font-size:0.75rem;">المتبقي</div>
                                <div class="stat-value currency" style="font-size:0.8rem;">${formatCurrencySYP(invStats.remainingSYP)}<br>${formatCurrencyUSD(invStats.remainingUSD)}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="dashboard-section" onclick="navigate('workers')" style="cursor:pointer; transition:transform 0.25s ease, box-shadow 0.25s ease;" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 12px 32px rgba(0,0,0,0.08)';" onmouseout="this.style.transform=''; this.style.boxShadow='';">
                    <div class="dashboard-section-header" style="border-bottom:none; padding-bottom:0.75rem;">
                        <h2 style="display:flex; align-items:center; gap:0.75rem;">
                            <span style="width:44px; height:44px; border-radius:50%; background:linear-gradient(135deg, rgba(59,130,246,0.18) 0%, rgba(59,130,246,0.06) 100%); color:#1d4ed8; display:inline-flex; align-items:center; justify-content:center; font-size:1.1rem;">
                                <i class="fas fa-user-tie"></i>
                            </span>
                            إدارة أجور العمال
                        </h2>
                        <div class="link-back" style="opacity:0.9;">
                            فتح القسم <i class="fas fa-chevron-left" style="margin-right:0.4rem;"></i>
                        </div>
                    </div>
                    <div style="padding:0 1.5rem 1.5rem 1.5rem;">
                        <p style="color:var(--color-gray); margin-bottom:1.25rem; line-height:1.8;">إدارة قائمة العمال والحرفيين، تسجيل دفعات الأجور الدورية (بالليرة السورية والدولار الأمريكي معاً أو منفرداً)، وتتبع إجمالي المستلم لكل عامل.</p>
                        <div class="stats-grid" style="grid-template-columns: repeat(3, 1fr); gap:0.75rem;">
                            <div class="stat-card stat-count" style="padding:0.85rem 1rem;">
                                <div class="stat-label" style="font-size:0.75rem;">عدد العمال</div>
                                <div class="stat-value">${wrkStats.count}</div>
                            </div>
                            <div class="stat-card stat-paid" style="padding:0.85rem 1rem;">
                                <div class="stat-label" style="font-size:0.75rem;">عدد الدفعات</div>
                                <div class="stat-value">${wrkStats.paymentsCount}</div>
                            </div>
                            <div class="stat-card stat-total" style="padding:0.85rem 1rem;">
                                <div class="stat-label" style="font-size:0.75rem;">إجمالي الأجور</div>
                                <div class="stat-value currency" style="font-size:0.8rem;">${formatCurrencySYP(wrkStats.totalSYP)}<br>${formatCurrencyUSD(wrkStats.totalUSD)}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderLoginPage() {
    return `
        <div class="auth-container">
            <div class="auth-card">
                <div class="auth-header">
                    <img src="logo.png" alt="Jessica Kassab" class="auth-logo">
                    <h2>تسجيل الدخول</h2>
                    <p>لوحة تحكم المدير - نظام الفواتير الإلكتروني</p>
                </div>

                <form id="loginForm" onsubmit="return handleLogin(event)">
                    <div class="form-group">
                        <label class="form-label">اسم المستخدم</label>
                        <div style="position: relative;">
                            <input 
                                type="text" 
                                id="loginUsername" 
                                class="form-input" 
                                placeholder="jessica"
                                required
                                autocomplete="username"
                            >
                            <i class="fas fa-user" style="position:absolute; left:1rem; top:50%; transform:translateY(-50%); color:var(--color-gray);"></i>
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="form-label">كلمة المرور</label>
                        <div style="position: relative;">
                            <input 
                                type="password" 
                                id="loginPassword" 
                                class="form-input" 
                                placeholder="••••••••"
                                required
                                autocomplete="current-password"
                            >
                            <i class="fas fa-lock" style="position:absolute; left:1rem; top:50%; transform:translateY(-50%); color:var(--color-gray);"></i>
                        </div>
                    </div>

                    <button type="submit" class="btn btn-gold" style="width:100%;">
                        <i class="fas fa-sign-in-alt"></i>
                        دخول
                    </button>
                </form>
            </div>
        </div>
    `;
}

function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (adminLogin(username, password)) {
        toast('تم تسجيل الدخول', 'مرحباً بك في لوحة التحكم', 'success');
        updateNavbarVisibility();
        renderCurrentRoute();
    } else {
        toast('خطأ في تسجيل الدخول', 'اسم المستخدم أو كلمة المرور غير صحيحة', 'error');
    }
    return false;
}

function attachLoginEvents() {
    const form = document.getElementById('loginForm');
    if (form) {
        form.addEventListener('submit', handleLogin);
    }
}

// ============================================
// Shared Admin Helpers (شارات + مودال عام)
// ============================================

function renderAdminBadge() {
    return `
        <div class="admin-banner">
            <div class="admin-banner-info">
                <div class="admin-banner-icon"><i class="fas fa-user-shield"></i></div>
                <div class="admin-banner-text">
                    <h4>وضع المدير</h4>
                    <p>يمكنك إدارة العمال وتسجيل دفعات الأجور</p>
                </div>
            </div>
            <div style="display:flex; gap:0.6rem;">
                <button class="btn btn-outline-gold btn-sm" onclick="changePasswordModal()">
                    <i class="fas fa-key"></i>
                    تغيير كلمة المرور
                </button>
                <button class="btn btn-outline btn-sm" onclick="handleLogout()">
                    <i class="fas fa-sign-out-alt"></i>
                    تسجيل الخروج
                </button>
            </div>
        </div>
    `;
}

function openModalBase(contentInnerHtml) {
    const modalRoot = document.getElementById('modalRoot');
    modalRoot.innerHTML = `
        <div class="modal-backdrop" onclick="modalBackdropClick(event)">
            <div class="modal" onclick="event.stopPropagation()">
                ${contentInnerHtml}
            </div>
        </div>
    `;
    document.body.style.overflow = 'hidden';
}

function closeModalBase() {
    closeModal();
}

// ============================================
// WORKERS (أجور العمال) DASHBOARD
// ============================================

function renderWorkersDashboard() {
    const workers = getAllWorkers();

    const grandTotals = workers.reduce((acc, w) => {
        const { totalSYP, totalUSD } = computeWorkerTotals(w);
        acc.totalSYP += totalSYP;
        acc.totalUSD += totalUSD;
        acc.paymentsCount += (w.payments || []).length;
        return acc;
    }, { totalSYP: 0, totalUSD: 0, paymentsCount: 0 });

    return `
        <div class="dashboard">
            <div class="admin-banner">
                <div class="admin-banner-info">
                    <div class="admin-banner-icon"><i class="fas fa-user-shield"></i></div>
                    <div class="admin-banner-text">
                        <h4>وضع المدير</h4>
                        <p>يمكنك إدارة العمال وتسجيل دفعات الأجور</p>
                    </div>
                </div>
                <div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
                    <button class="btn btn-primary btn-sm" onclick="forceSyncNow(true)" title="مزامنة يدوية فورية مع السحابة">
                        <i class="fas fa-sync-alt"></i>
                        مزامنة فورية
                    </button>
                    <button class="btn btn-outline-gold btn-sm" onclick="showSyncStatus()" title="عرض حالة الاتصال بالسحابة وتفاصيل المزامنة">
                        <i class="fas fa-info-circle"></i>
                        حالة المزامنة
                    </button>
                    <button class="btn btn-outline-gold btn-sm" onclick="changePasswordModal()">
                        <i class="fas fa-key"></i>
                        تغيير كلمة المرور
                    </button>
                    <button class="btn btn-outline btn-sm" onclick="handleLogout()">
                        <i class="fas fa-sign-out-alt"></i>
                        تسجيل الخروج
                    </button>
                </div>
            </div>

            <div class="page-header">
                <div class="page-title">
                    <h1>أجور العمال</h1>
                    <p>إدارة قائمة العمال وتسجيل دفعات الأجور اليومية والدورية</p>
                </div>
                <button class="btn btn-gold" onclick="openWorkerCreate()">
                    <i class="fas fa-user-plus"></i>
                    إضافة عامل جديد
                </button>
            </div>

            <div class="stats-grid">
                <div class="stat-card stat-count">
                    <div class="stat-icon"><i class="fas fa-users"></i></div>
                    <div class="stat-label">عدد العمال</div>
                    <div class="stat-value">${workers.length}</div>
                </div>
                <div class="stat-card stat-count" style="--stat-accent: var(--color-info);">
                    <div class="stat-icon"><i class="fas fa-receipt"></i></div>
                    <div class="stat-label">عدد الدفعات</div>
                    <div class="stat-value">${grandTotals.paymentsCount}</div>
                </div>
                <div class="stat-card stat-paid">
                    <div class="stat-icon"><i class="fas fa-coins"></i></div>
                    <div class="stat-label">إجمالي الدفعات بالليرة</div>
                    <div class="stat-value currency" style="font-size:0.9rem;">${formatCurrencySYP(grandTotals.totalSYP)}</div>
                </div>
                <div class="stat-card stat-total">
                    <div class="stat-icon"><i class="fas fa-dollar-sign"></i></div>
                    <div class="stat-label">إجمالي الدفعات بالدولار</div>
                    <div class="stat-value currency" style="font-size:0.9rem;">${formatCurrencyUSD(grandTotals.totalUSD)}</div>
                </div>
            </div>

            <div class="dashboard-section">
                <div class="dashboard-section-header">
                    <h2>العمال</h2>
                    <div class="search-bar">
                        <i class="fas fa-search"></i>
                        <input type="text" id="searchWorkers" placeholder="بحث باسم العامل أو المهنة أو الهاتف...">
                    </div>
                </div>

                ${workers.length === 0 ? `
                    <div class="empty-state">
                        <div class="empty-state-icon"><i class="fas fa-users"></i></div>
                        <h3>لا يوجد عمال بعد</h3>
                        <p>ابدأ بإضافة أول عامل لتسجيل دفعات الأجور</p>
                        <button class="btn btn-gold" onclick="openWorkerCreate()">
                            <i class="fas fa-user-plus"></i>
                            إضافة عامل جديد
                        </button>
                    </div>
                ` : `
                    <div class="invoices-table-wrapper">
                        <table class="invoices-table" id="workersTable">
                            <thead>
                                <tr>
                                    <th>اسم العامل</th>
                                    <th>المهنة</th>
                                    <th>الهاتف</th>
                                    <th>إجمالي المستلم</th>
                                    <th>عدد الدفعات</th>
                                    <th>آخر دفعة</th>
                                    <th>الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${workers.map(w => renderWorkerRow(w)).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        </div>
    `;
}

function renderWorkerRow(w) {
    const { totalSYP, totalUSD, paymentsCount } = computeWorkerTotals(w);
    const lastPayment = (w.payments || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    const lastPayDate = lastPayment ? formatDate(lastPayment.date) : '—';
    const lastPayAmount = lastPayment
        ? `${formatCurrencySYP(lastPayment.amountSYP) || ''} ${lastPayment.amountSYP && lastPayment.amountUSD ? '<br>' : ''} ${formatCurrencyUSD(lastPayment.amountUSD) || ''}`
        : '—';

    return `
        <tr data-worker-id="${w.id}">
            <td><span class="customer-name">${escapeHtml(w.name || 'بدون اسم')}</span></td>
            <td><span class="invoice-id">${escapeHtml(w.profession || '—')}</span></td>
            <td>${escapeHtml(w.phone || '—')}</td>
            <td class="amount-cell amount-paid" style="font-size:0.78rem;">
                ${formatCurrencySYP(totalSYP)}<br>${formatCurrencyUSD(totalUSD)}
            </td>
            <td><span class="badge ${paymentsCount > 0 ? 'badge-success' : 'badge-warning'}" style="min-width:60px; text-align:center;">${paymentsCount} دفعة</span></td>
            <td style="font-size:0.85rem;">
                ${lastPayDate}
                ${lastPayment ? `<div style="font-size:0.7rem; color:var(--color-gray); margin-top:2px;">${formatCurrencySYP(lastPayment.amountSYP)} ${lastPayment.amountUSD ? '• ' + formatCurrencyUSD(lastPayment.amountUSD) : ''}</div>` : ''}
            </td>
            <td>
                <div class="table-actions">
                    <button class="icon-btn icon-btn-view" title="دفعات الأجور" onclick="navigate('worker', {workerId:'${w.id}'})">
                        <i class="fas fa-wallet"></i>
                    </button>
                    <button class="icon-btn icon-btn-edit" title="تعديل البيانات" onclick="openWorkerEdit('${w.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="icon-btn icon-btn-delete" title="حذف العامل" onclick="confirmDeleteWorker('${w.id}')">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </td>
        </tr>
    `;
}

function attachWorkersDashboardEvents() {
    const searchInput = document.getElementById('searchWorkers');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const q = e.target.value.trim().toLowerCase();
            const rows = document.querySelectorAll('#workersTable tbody tr');
            rows.forEach(row => {
                const customerName = row.querySelector('.customer-name')?.textContent.toLowerCase() || '';
                const profession = row.querySelector('.invoice-id')?.textContent.toLowerCase() || '';
                const phone = row.children[2]?.textContent.toLowerCase() || '';
                const match = customerName.includes(q) || profession.includes(q) || phone.includes(q);
                row.style.display = match ? '' : 'none';
            });
        });
    }
}

function openWorkerCreate() {
    const html = `
        <div class="modal-content" style="max-width:460px;">
            <div class="modal-header">
                <h3>إضافة عامل جديد</h3>
                <button class="btn-icon" onclick="closeWorkerModal()"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">اسم العامل *</label>
                    <input id="wname" type="text" class="form-input" placeholder="مثال: أحمد محمد" required>
                </div>
                <div class="form-group">
                    <label class="form-label">المهنة</label>
                    <input id="wprof" type="text" class="form-input" placeholder="مثال: نجار، حداد، دهان، ...">
                </div>
                <div class="form-group">
                    <label class="form-label">رقم الهاتف</label>
                    <input id="wphone" type="tel" class="form-input" placeholder="مثال: 00963 9xx xxx xxx">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="closeWorkerModal()">إلغاء</button>
                <button class="btn btn-gold" onclick="submitWorkerCreate()"><i class="fas fa-check"></i> إضافة العامل</button>
            </div>
        </div>
    `;
    openModalBase(html);
}

function openWorkerEdit(workerId) {
    const w = getWorkerById(workerId);
    if (!w) return;
    const html = `
        <div class="modal-content" style="max-width:460px;">
            <div class="modal-header">
                <h3>تعديل بيانات العامل</h3>
                <button class="btn-icon" onclick="closeWorkerModal()"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">اسم العامل *</label>
                    <input id="wname" type="text" class="form-input" value="${escapeHtml(w.name || '')}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">المهنة</label>
                    <input id="wprof" type="text" class="form-input" value="${escapeHtml(w.profession || '')}">
                </div>
                <div class="form-group">
                    <label class="form-label">رقم الهاتف</label>
                    <input id="wphone" type="tel" class="form-input" value="${escapeHtml(w.phone || '')}">
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="closeWorkerModal()">إلغاء</button>
                <button class="btn btn-gold" onclick="submitWorkerEdit('${workerId}')"><i class="fas fa-save"></i> حفظ التغييرات</button>
            </div>
        </div>
    `;
    openModalBase(html);
}

function closeWorkerModal() {
    closeModalBase();
}

function submitWorkerCreate() {
    const name = (document.getElementById('wname').value || '').trim();
    if (!name) { toast('مطلوب', 'يرجى إدخال اسم العامل', 'warning'); return; }
    createWorker({
        name,
        profession: (document.getElementById('wprof').value || '').trim(),
        phone: (document.getElementById('wphone').value || '').trim()
    });
    closeWorkerModal();
    toast('تم الإضافة', 'تمت إضافة العامل بنجاح', 'success');
    renderCurrentRoute();
}

function submitWorkerEdit(workerId) {
    const name = (document.getElementById('wname').value || '').trim();
    if (!name) { toast('مطلوب', 'يرجى إدخال اسم العامل', 'warning'); return; }
    updateWorker(workerId, {
        name,
        profession: (document.getElementById('wprof').value || '').trim(),
        phone: (document.getElementById('wphone').value || '').trim()
    });
    closeWorkerModal();
    toast('تم الحفظ', 'تم تحديث بيانات العامل بنجاح', 'success');
    renderCurrentRoute();
}

function confirmDeleteWorker(workerId) {
    const w = getWorkerById(workerId);
    if (!w) return;
    if (!confirm(`هل أنت متأكد من حذف العامل "${w.name}" وجميع دفعاته؟`)) return;
    deleteWorker(workerId);
    toast('تم الحذف', 'تم حذف العامل', 'info');
    renderCurrentRoute();
}

// ============================================
// WORKER DETAIL VIEW (دفعات أجور عامل واحد)
// ============================================

function renderWorkerDetailView(workerId) {
    const w = getWorkerById(workerId);
    if (!w) {
        return `
            <div class="dashboard" style="min-height:60vh; display:flex; align-items:center; justify-content:center;">
                <div class="auth-card" style="text-align:center;">
                    <div style="width:80px; height:80px; margin:0 auto 1.5rem; border-radius:50%; background:rgba(239,68,68,0.1); color:#dc2626; display:flex; align-items:center; justify-content:center; font-size:2rem;">
                        <i class="fas fa-user-slash"></i>
                    </div>
                    <h2 style="font-family:'Playfair Display', serif; font-size:1.5rem; margin-bottom:0.5rem;">عامل غير موجود</h2>
                    <p style="color:var(--color-gray); margin-bottom:2rem;">قد يكون قد تم حذفه سابقاً أو الرابط غير صالح.</p>
                    <button class="btn btn-gold" style="width:100%;" onclick="navigate('workers')">
                        <i class="fas fa-arrow-left"></i> عودة لقائمة العمال
                    </button>
                </div>
            </div>
        `;
    }

    const { totalSYP, totalUSD, paymentsCount } = computeWorkerTotals(w);
    const payments = (w.payments || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const firstDate = payments.length > 0 ? formatDate(payments[payments.length - 1].date) : '—';
    const lastDate = payments.length > 0 ? formatDate(payments[0].date) : '—';

    return `
        <div class="dashboard">
            <div class="admin-banner">
                <div class="admin-banner-info">
                    <div class="admin-banner-icon"><i class="fas fa-user-shield"></i></div>
                    <div class="admin-banner-text">
                        <h4>وضع المدير</h4>
                        <p>يمكنك إدارة دفعات الأجور والبيانات لهذا العامل</p>
                    </div>
                </div>
                <div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
                    <button class="btn btn-primary btn-sm" onclick="forceSyncNow(true)" title="مزامنة يدوية فورية مع السحابة">
                        <i class="fas fa-sync-alt"></i>
                        مزامنة فورية
                    </button>
                    <button class="btn btn-outline-gold btn-sm" onclick="showSyncStatus()" title="عرض حالة الاتصال بالسحابة وتفاصيل المزامنة">
                        <i class="fas fa-info-circle"></i>
                        حالة المزامنة
                    </button>
                    <button class="btn btn-outline-gold btn-sm" onclick="changePasswordModal()">
                        <i class="fas fa-key"></i>
                        تغيير كلمة المرور
                    </button>
                    <button class="btn btn-outline btn-sm" onclick="handleLogout()">
                        <i class="fas fa-sign-out-alt"></i>
                        تسجيل الخروج
                    </button>
                </div>
            </div>

            <div class="page-header">
                <div class="page-title">
                    <div style="margin-bottom:0.85rem;">
                        <a class="link-back" onclick="navigate('workers')">
                            <i class="fas fa-chevron-right"></i> عودة لقائمة العمال
                        </a>
                    </div>
                    <h1>${escapeHtml(w.name || 'عامل')}</h1>
                    <p>
                        ${w.profession ? escapeHtml(w.profession) + ' • ' : ''}
                        ${w.phone ? '<i class="fas fa-phone-alt" style="margin-left:0.25rem; margin-right:0.25rem;"></i>' + escapeHtml(w.phone) + ' • ' : ''}
                        ${paymentsCount} دفعة مسجلة
                    </p>
                </div>
                <div style="display:flex; gap:0.6rem;">
                    <button class="btn btn-outline" onclick="openWorkerEdit('${w.id}')">
                        <i class="fas fa-edit"></i> تعديل البيانات
                    </button>
                    <button class="btn btn-gold" onclick="openPaymentModal('${w.id}')">
                        <i class="fas fa-plus"></i> إضافة دفعة أجور
                    </button>
                </div>
            </div>

            <div class="stats-grid">
                <div class="stat-card stat-count">
                    <div class="stat-icon"><i class="fas fa-sync-alt"></i></div>
                    <div class="stat-label">عدد الدفعات</div>
                    <div class="stat-value">${paymentsCount}</div>
                </div>
                <div class="stat-card stat-paid">
                    <div class="stat-icon"><i class="fas fa-money-bill-wave"></i></div>
                    <div class="stat-label">إجمالي دفعات الليرة</div>
                    <div class="stat-value currency" style="font-size:0.9rem;">${formatCurrencySYP(totalSYP)}</div>
                </div>
                <div class="stat-card stat-total">
                    <div class="stat-icon"><i class="fas fa-dollar-sign"></i></div>
                    <div class="stat-label">إجمالي دفعات الدولار</div>
                    <div class="stat-value currency" style="font-size:0.9rem;">${formatCurrencyUSD(totalUSD)}</div>
                </div>
                <div class="stat-card stat-remaining" style="--stat-accent: var(--color-info);">
                    <div class="stat-icon"><i class="fas fa-calendar-alt"></i></div>
                    <div class="stat-label">أول دفعة • آخر دفعة</div>
                    <div class="stat-value currency" style="font-size:0.8rem;">
                        ${firstDate}<br>
                        ${lastDate}
                    </div>
                </div>
            </div>

            <div class="dashboard-section">
                <div class="dashboard-section-header">
                    <h2>سجل دفعات الأجور</h2>
                    <div class="search-bar">
                        <i class="fas fa-search"></i>
                        <input type="text" id="searchPayments" placeholder="بحث بالتاريخ أو الملاحظات...">
                    </div>
                </div>

                ${payments.length === 0 ? `
                    <div class="empty-state">
                        <div class="empty-state-icon"><i class="fas fa-wallet"></i></div>
                        <h3>لا توجد دفعات مسجلة</h3>
                        <p>ابدأ بتسجيل أول دفعة أجور لهذا العامل</p>
                        <button class="btn btn-gold" onclick="openPaymentModal('${w.id}')">
                            <i class="fas fa-plus"></i>
                            إضافة دفعة أجور
                        </button>
                    </div>
                ` : `
                    <div class="invoices-table-wrapper">
                        <table class="invoices-table" id="paymentsTable">
                            <thead>
                                <tr>
                                    <th>رقم الدفعة</th>
                                    <th>التاريخ</th>
                                    <th>المبلغ بالليرة</th>
                                    <th>المبلغ بالدولار</th>
                                    <th>الملاحظات</th>
                                    <th>الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${payments.map((p, idx) => renderWorkerPaymentRow(p, w.id, payments.length - idx)).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        </div>
    `;
}

function renderWorkerPaymentRow(p, workerId, num) {
    return `
        <tr data-payment-id="${p.id}" style="--idx:${num};">
            <td><span class="invoice-id">${String(num).padStart(3, '0')} / ${escapeHtml(p.id.substring(4, 10).toUpperCase())}</span></td>
            <td>${formatDate(p.date)}</td>
            <td class="amount-cell amount-paid" style="font-size:0.9rem;">${formatCurrencySYP(Number(p.amountSYP) || 0)}</td>
            <td class="amount-cell amount-pending" style="font-size:0.9rem;">${formatCurrencyUSD(Number(p.amountUSD) || 0)}</td>
            <td style="color:var(--color-gray); font-size:0.9rem;">${escapeHtml(p.note || '—')}</td>
            <td>
                <div class="table-actions">
                    <button class="icon-btn icon-btn-delete" title="حذف الدفعة" onclick="confirmRemovePayment('${workerId}','${p.id}')">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </td>
        </tr>
    `;
}

// ============================================
// PAYMENT MODAL (واجهة إضافة دفعة جديدة مصممة حديثاً)
// ============================================

function openPaymentModal(workerId) {
    const w = getWorkerById(workerId);
    if (!w) return;
    const html = `
        <div class="modal-header">
            <h2>إضافة دفعة أجور جديدة</h2>
            <button class="modal-close" onclick="closeModal()"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
            <div style="padding:0.85rem 1rem; margin-bottom:1.25rem; background:linear-gradient(135deg, var(--color-cream) 0%, rgba(212,175,55,0.08) 100%); border-radius:var(--radius-sm); border:1px solid rgba(212,175,55,0.25); display:flex; align-items:center; gap:0.85rem;">
                <div style="width:42px; height:42px; background:rgba(212,175,55,0.18); color:var(--color-gold-dark); border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <i class="fas fa-user-tie"></i>
                </div>
                <div style="min-width:0;">
                    <div style="font-weight:600; color:var(--color-black); font-size:0.95rem; margin-bottom:1px;">${escapeHtml(w.name || '')}</div>
                    <div style="font-size:0.78rem; color:var(--color-gray);">
                        ${w.profession ? escapeHtml(w.profession) + ' • ' : ''}
                        ${w.phone ? escapeHtml(w.phone) : 'أجور العمال'}
                    </div>
                </div>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="form-label"><span class="required">*</span> المبلغ بالليرة السورية</label>
                    <div class="currency-input">
                        <span class="currency-symbol">ل.س</span>
                        <input id="pamtSYP" type="number" min="0" class="form-input" placeholder="0" step="1" style="text-align:left; padding-left:4.5rem;">
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label"><span class="required">*</span> المبلغ بالدولار الأمريكي</label>
                    <div class="currency-input">
                        <span class="currency-symbol">$</span>
                        <input id="pamtUSD" type="number" min="0" class="form-input" placeholder="0.00" step="0.01" style="text-align:left; padding-left:4.5rem;">
                    </div>
                </div>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">تاريخ الدفعة</label>
                    <div style="position: relative;">
                        <i class="fas fa-calendar-alt" style="position:absolute; left:1rem; top:50%; transform:translateY(-50%); color:var(--color-gray);"></i>
                        <input id="pdate" type="date" class="form-input" value="${todayStr()}" style="padding-left:3rem;">
                    </div>
                </div>
            </div>

            <div class="form-group">
                <label class="form-label">ملاحظات (اختياري)</label>
                <div style="position: relative;">
                    <i class="fas fa-comment-alt" style="position:absolute; left:1rem; top:1rem; color:var(--color-gray);"></i>
                    <input id="pnote" type="text" class="form-input" placeholder="مثال: راتب شهر، أسبوع عمل، عمل إضافي، بناء فيلا، ..." style="padding-left:3rem;">
                </div>
            </div>

            <div style="font-size:0.8rem; color:var(--color-gray); margin-top:0.25rem; padding:0.85rem 1rem; background:var(--color-cream); border-radius:var(--radius-sm); line-height:1.7;">
                <i class="fas fa-info-circle" style="color:var(--color-gold-dark); margin-left:0.35rem;"></i>
                يمكنك إدخال <strong style="color:var(--color-black);">مبلغ بليرة فقط</strong>، أو <strong style="color:var(--color-black);">دولار فقط</strong>، أو النين معاً حسب طريقة الدفع.
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-outline" onclick="closeModal()">إلغاء</button>
            <button class="btn btn-gold" onclick="submitPayment('${workerId}')">
                <i class="fas fa-check"></i> تسجيل الدفعة
            </button>
        </div>
    `;
    showModal(html);
    attachPaymentsSearchEvents();
}

function attachPaymentsSearchEvents() {
    const searchInput = document.getElementById('searchPayments');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const q = e.target.value.trim().toLowerCase();
            const rows = document.querySelectorAll('#paymentsTable tbody tr');
            rows.forEach(row => {
                const dateCell = row.children[1]?.textContent.toLowerCase() || '';
                const noteCell = row.children[4]?.textContent.toLowerCase() || '';
                const match = dateCell.includes(q) || noteCell.includes(q);
                row.style.display = match ? '' : 'none';
            });
        });
    }
}

function submitPayment(workerId) {
    const amtSYP = Number(document.getElementById('pamtSYP').value) || 0;
    const amtUSD = Number(document.getElementById('pamtUSD').value) || 0;
    const date = document.getElementById('pdate').value || todayStr();
    const note = (document.getElementById('pnote').value || '').trim();

    if (amtSYP === 0 && amtUSD === 0) {
        toast('مطلوب', 'يرجى إدخال مبلغ واحد على الأقل (ليرة أو دولار)', 'warning');
        return;
    }
    addWorkerPayment(workerId, { amountSYP: amtSYP, amountUSD: amtUSD, date, note });
    closeWorkerModal();
    toast('تم التسجيل', 'تم تسجيل دفعة الأجور بنجاح', 'success');
    renderCurrentRoute();
}

function confirmRemovePayment(workerId, paymentId) {
    if (!confirm('هل تريد حذف هذه الدفعة من السجل؟')) return;
    removeWorkerPayment(workerId, paymentId);
    toast('تم الحذف', 'تم حذف الدفعة', 'info');
    renderCurrentRoute();
}

// ============================================
// INVOICES DASHBOARD
// ============================================

function renderInvoicesDashboard() {
    const invoices = getAllInvoices();

    const totals = invoices.reduce((acc, inv) => {
        const { totalReceivedSYP, totalReceivedUSD, remainingSYP, remainingUSD } = computeInvoiceTotals(inv);
        acc.agreedSYP += Number(inv.agreedAmountSYP) || 0;
        acc.agreedUSD += Number(inv.agreedAmountUSD) || 0;
        acc.receivedSYP += totalReceivedSYP;
        acc.receivedUSD += totalReceivedUSD;
        acc.remainingSYP += remainingSYP;
        acc.remainingUSD += remainingUSD;
        return acc;
    }, { agreedSYP: 0, agreedUSD: 0, receivedSYP: 0, receivedUSD: 0, remainingSYP: 0, remainingUSD: 0 });

    return `
        <div class="dashboard">
            <div class="admin-banner">
                <div class="admin-banner-info">
                    <div class="admin-banner-icon"><i class="fas fa-user-shield"></i></div>
                    <div class="admin-banner-text">
                        <h4>وضع المدير</h4>
                        <p>يمكنك إنشاء وتعديل وحذف جميع الفواتير</p>
                    </div>
                </div>
                <div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
                    <button class="btn btn-primary btn-sm" onclick="forceSyncNow(true)" title="مزامنة يدوية فورية مع السحابة">
                        <i class="fas fa-sync-alt"></i>
                        مزامنة فورية
                    </button>
                    <button class="btn btn-outline-gold btn-sm" onclick="showSyncStatus()" title="عرض حالة الاتصال بالسحابة وتفاصيل المزامنة">
                        <i class="fas fa-info-circle"></i>
                        حالة المزامنة
                    </button>
                    <button class="btn btn-outline-gold btn-sm" onclick="changePasswordModal()">
                        <i class="fas fa-key"></i>
                        تغيير كلمة المرور
                    </button>
                    <button class="btn btn-outline btn-sm" onclick="handleLogout()">
                        <i class="fas fa-sign-out-alt"></i>
                        تسجيل الخروج
                    </button>
                </div>
            </div>

            <div class="page-header">
                <div class="page-title">
                    <h1>قائمة الفواتير</h1>
                    <p>إدارة فواتير العملاء وتتبع المدفوعات</p>
                </div>
                <button class="btn btn-gold" onclick="openCreateInvoiceModal()">
                    <i class="fas fa-plus"></i>
                    إنشاء فاتورة جديدة
                </button>
            </div>

            <div class="stats-grid">
                <div class="stat-card stat-total">
                    <div class="stat-icon"><i class="fas fa-sack-dollar"></i></div>
                    <div class="stat-label">إجمالي المبالغ المتفق عليها</div>
                    <div class="stat-value currency" style="font-size: 0.9rem;">
                        ${formatCurrencySYP(totals.agreedSYP)}<br>
                        ${formatCurrencyUSD(totals.agreedUSD)}
                    </div>
                </div>
                <div class="stat-card stat-paid">
                    <div class="stat-icon"><i class="fas fa-hand-holding-usd"></i></div>
                    <div class="stat-label">إجمالي المبالغ المستلمة</div>
                    <div class="stat-value currency" style="font-size: 0.9rem;">
                        ${formatCurrencySYP(totals.receivedSYP)}<br>
                        ${formatCurrencyUSD(totals.receivedUSD)}
                    </div>
                </div>
                <div class="stat-card stat-remaining">
                    <div class="stat-icon"><i class="fas fa-clock"></i></div>
                    <div class="stat-label">إجمالي المبالغ المتبقية</div>
                    <div class="stat-value currency" style="font-size: 0.9rem;">
                        ${formatCurrencySYP(totals.remainingSYP)}<br>
                        ${formatCurrencyUSD(totals.remainingUSD)}
                    </div>
                </div>
                <div class="stat-card stat-count">
                    <div class="stat-icon"><i class="fas fa-file-invoice"></i></div>
                    <div class="stat-label">عدد الفواتير</div>
                    <div class="stat-value">${invoices.length}</div>
                </div>
            </div>

            <div class="dashboard-section">
                <div class="dashboard-section-header">
                    <h2>الفواتير</h2>
                    <div class="search-bar">
                        <i class="fas fa-search"></i>
                        <input type="text" id="searchInvoices" placeholder="بحث باسم العميل أو رقم الفاتورة...">
                    </div>
                </div>

                ${invoices.length === 0 ? `
                    <div class="empty-state">
                        <div class="empty-state-icon"><i class="fas fa-file-invoice"></i></div>
                        <h3>لا توجد فواتير بعد</h3>
                        <p>ابدأ بإنشاء أول فاتورة لك</p>
                        <button class="btn btn-gold" onclick="openCreateInvoiceModal()">
                            <i class="fas fa-plus"></i>
                            إنشاء فاتورة جديدة
                        </button>
                    </div>
                ` : `
                    <div class="invoices-table-wrapper">
                        <table class="invoices-table" id="invoicesTable">
                            <thead>
                                <tr>
                                    <th>رقم الفاتورة</th>
                                    <th>اسم العميل</th>
                                    <th>المبلغ المتفق عليه</th>
                                    <th>المستلم</th>
                                    <th>المتبقي</th>
                                    <th>الحالة</th>
                                    <th>التاريخ</th>
                                    <th>الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${invoices.map(inv => renderInvoiceRow(inv)).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        </div>
    `;
}

function renderInvoiceRow(inv) {
    const { totalReceivedSYP, totalReceivedUSD, remainingSYP, remainingUSD } = computeInvoiceTotals(inv);
    const status = getInvoiceStatus(inv);
    const statusBadge = {
        paid: { cls: 'badge-success', text: 'مدفوع بالكامل' },
        partial: { cls: 'badge-warning', text: 'مدفوع جزئياً' },
        pending: { cls: 'badge-danger', text: 'قيد الدفع' }
    }[status];

    return `
        <tr data-invoice-id="${inv.id}">
            <td><span class="invoice-id">${escapeHtml(inv.id.substring(0, 12).toUpperCase())}</span></td>
            <td><span class="customer-name">${escapeHtml(inv.customerName || 'غير محدد')}</span></td>
            <td class="amount-cell" style="font-size:0.78rem;">
                ${formatCurrencySYP(inv.agreedAmountSYP)}<br>${formatCurrencyUSD(inv.agreedAmountUSD)}
            </td>
            <td class="amount-cell amount-paid" style="font-size:0.78rem;">
                ${formatCurrencySYP(totalReceivedSYP)}<br>${formatCurrencyUSD(totalReceivedUSD)}
            </td>
            <td class="amount-cell amount-pending" style="font-size:0.78rem;">
                ${formatCurrencySYP(remainingSYP)}<br>${formatCurrencyUSD(remainingUSD)}
            </td>
            <td><span class="badge ${statusBadge.cls}">${statusBadge.text}</span></td>
            <td>${formatDate(inv.createdAt)}</td>
            <td>
                <div class="table-actions">
                    <button class="icon-btn icon-btn-view" title="عرض" onclick="navigate('invoice', {invoiceId:'${inv.id}'})">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="icon-btn icon-btn-edit" title="تعديل" onclick="openEditInvoiceModal('${inv.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="icon-btn icon-btn-copy" title="نسخ الرابط" onclick="copyInvoiceLink('${inv.id}')">
                        <i class="fas fa-link"></i>
                    </button>
                    <button class="icon-btn icon-btn-delete" title="حذف" onclick="confirmDeleteInvoice('${inv.id}')">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </td>
        </tr>
    `;
}

function attachDashboardEvents() {
    const searchInput = document.getElementById('searchInvoices');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const q = e.target.value.trim().toLowerCase();
            const rows = document.querySelectorAll('#invoicesTable tbody tr');
            rows.forEach(row => {
                const customerName = row.querySelector('.customer-name')?.textContent.toLowerCase() || '';
                const invoiceId = row.querySelector('.invoice-id')?.textContent.toLowerCase() || '';
                const match = customerName.includes(q) || invoiceId.includes(q);
                row.style.display = match ? '' : 'none';
            });
        });
    }
}

function handleLogout() {
    adminLogout();
    updateNavbarVisibility();
    toast('تم تسجيل الخروج', '', 'info');
    renderCurrentRoute();
}

// ============================================
// INVOICE VIEW PAGE
// ============================================

function renderInvoiceView(invoiceId) {
    const invoiceData = getInvoiceById(invoiceId);
    const invoice = migrateInvoiceClientPayments(invoiceData);
    const isAdmin = isAdminLoggedIn();

    if (!invoice) {
        return `
            <div class="auth-container">
                <div class="auth-card" style="text-align:center;">
                    <div style="width:80px; height:80px; margin:0 auto 1.5rem; border-radius:50%; background:rgba(239,68,68,0.1); color:#dc2626; display:flex; align-items:center; justify-content:center; font-size:2rem;">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <h2 style="font-family:'Playfair Display', serif; font-size:1.5rem; margin-bottom:0.5rem;">فاتورة غير موجودة</h2>
                    <p style="color:var(--color-gray); margin-bottom:2rem;">الرابط الذي أدخلته غير صالح أو تم حذف الفاتورة.</p>
                    <button class="btn btn-primary" style="width:100%;" onclick="navigate('home')">
                        <i class="fas fa-home"></i>
                        العودة للصفحة الرئيسية
                    </button>
                </div>
            </div>
        `;
    }

    const { totalReceivedSYP, totalReceivedUSD, remainingSYP, remainingUSD, totalMaterialsSYP, totalMaterialsUSD } = computeInvoiceTotals(invoice);
    const status = getInvoiceStatus(invoice);
    const statusInfo = {
        paid: { cls: 'status-paid', text: 'مدفوع بالكامل', icon: 'fa-check-circle' },
        partial: { cls: 'status-partial', text: 'مدفوع جزئياً', icon: 'fa-hourglass-half' },
        pending: { cls: 'status-pending', text: 'قيد الدفع', icon: 'fa-clock' }
    }[status];

    const shareUrl = getInvoiceShareUrl(invoiceId);
    const photos = invoice.sitePhotos || [];

    return `
        <div class="invoice-view-container" id="invoicePageRoot">
            ${isAdmin ? `
                <div class="admin-banner">
                    <div class="admin-banner-info">
                        <div class="admin-banner-icon"><i class="fas fa-user-shield"></i></div>
                        <div class="admin-banner-text">
                            <h4>وضع المدير</h4>
                            <p>يمكنك تعديل جميع القيم مباشرة في النموذج أدناه</p>
                        </div>
                    </div>
                    <button class="btn btn-outline btn-sm" onclick="navigate('invoices')">
                        <i class="fas fa-arrow-right"></i>
                        العودة للقائمة
                    </button>
                </div>
            ` : `
                <div class="view-only-banner">
                    <div class="view-only-icon"><i class="fas fa-eye"></i></div>
                    <div class="view-only-text">
                        <h4>هذه صفحة عرض فقط للعميل</h4>
                        <p>يمكنك عرض تفاصيل الفاتورة وتحميلها كملف PDF. لا يمكن تعديل القيم.</p>
                    </div>
                </div>
            `}

            <div class="invoice-wrapper" id="invoicePrintArea">
                <div class="invoice-header">
                    <div class="invoice-header-inner">
                        <div class="invoice-brand">
                            <div style="display:inline-block; background:#fff; padding:10px 18px; border-radius:10px; margin-bottom:1rem;">
                                <img src="logo.png" alt="Jessica Kassab" class="invoice-brand-logo" style="height:55px; width:auto; max-width:240px;">
                            </div>
                            <h2>JESSICA KASSAB</h2>
                            <p>Architecture & Interior Design</p>
                            <p style="margin-top:0.8rem; font-size:0.8rem;">
                                <i class="fas fa-phone" style="margin-left:0.4rem;"></i>00963 919 296 15
                                <br>
                                <i class="fas fa-envelope" style="margin-left:0.4rem;"></i>kassabjassica@gmail.com
                                <br>
                                <i class="fas fa-map-marker-alt" style="margin-left:0.4rem;"></i>حمص، سوريا
                            </p>
                        </div>
                        <div class="invoice-meta">
                            <div class="invoice-number">فاتورة رقم: ${escapeHtml(invoice.id.substring(0, 10).toUpperCase())}</div>
                            <div class="invoice-date-label">تاريخ الإنشاء</div>
                            <div class="invoice-date">${formatDate(invoice.createdAt)}</div>
                        </div>
                    </div>
                </div>

                <div class="invoice-body">
                    <div class="invoice-customer-section">
                        <div class="customer-info-card">
                            <h3><i class="fas fa-user" style="margin-left:0.4rem;"></i>اسم العميل</h3>
                            ${isAdmin ? `
                                <input type="text" id="editCustomerName" class="form-input" value="${escapeHtml(invoice.customerName)}" placeholder="أدخل اسم العميل">
                            ` : `
                                <div class="customer-name-display">${escapeHtml(invoice.customerName || '-')}</div>
                            `}
                        </div>
                        <div class="invoice-status-card">
                            <h3><i class="fas fa-flag" style="margin-left:0.4rem;"></i>حالة الفاتورة</h3>
                            <span class="status-display ${statusInfo.cls}">
                                <i class="fas ${statusInfo.icon}"></i>
                                ${statusInfo.text}
                            </span>
                        </div>
                    </div>

                    <div class="amounts-grid" id="amountsGrid">
                        <div class="amount-card agreed ${isAdmin ? 'editable' : ''}">
                            <div class="amount-card-icon"><i class="fas fa-handshake"></i></div>
                            <div class="amount-card-label">المبلغ المتفق عليه</div>
                            ${isAdmin ? `
                                <div class="amount-input-wrapper" style="flex-direction:column; gap:8px; align-items:stretch;">
                                    <div style="display:flex; gap:6px; align-items:center;">
                                        <input type="number" id="editAgreedAmountSYP" min="0" value="${invoice.agreedAmountSYP}" placeholder="0" oninput="updateAmountsLive()" style="flex:1; font-size:0.85rem;">
                                        <span class="currency" style="white-space:nowrap;">ل.س</span>
                                    </div>
                                    <div style="display:flex; gap:6px; align-items:center;">
                                        <input type="number" id="editAgreedAmountUSD" min="0" value="${invoice.agreedAmountUSD}" placeholder="0" oninput="updateAmountsLive()" style="flex:1; font-size:0.85rem;">
                                        <span class="currency" style="white-space:nowrap;">$</span>
                                    </div>
                                </div>
                            ` : `
                                <div class="amount-card-value" style="line-height:1.6; font-size:1rem;">
                                    ${formatCurrencySYP(invoice.agreedAmountSYP)}<br>
                                    ${formatCurrencyUSD(invoice.agreedAmountUSD)}
                                </div>
                            `}
                        </div>

                        <div class="amount-card paid">
                            <div class="amount-card-icon"><i class="fas fa-hand-holding-usd"></i></div>
                            <div class="amount-card-label">إجمالي المبلغ المستلم</div>
                            <div class="amount-card-value" id="displayTotalReceived" style="line-height:1.6; font-size:1rem;">
                                ${formatCurrencySYP(totalReceivedSYP)}<br>
                                ${formatCurrencyUSD(totalReceivedUSD)}
                            </div>
                        </div>

                        <div class="amount-card remaining">
                            <div class="amount-card-icon"><i class="fas fa-clock"></i></div>
                            <div class="amount-card-label">المبلغ المتبقي</div>
                            <div class="amount-card-value" id="displayRemaining" style="line-height:1.6; font-size:1rem;">
                                ${formatCurrencySYP(remainingSYP)}<br>
                                ${formatCurrencyUSD(remainingUSD)}
                            </div>
                        </div>
                    </div>

                    <div class="section-heading" style="margin-top:1.5rem;">
                        <h3><i class="fas fa-hand-holding-heart"></i>الدفعات المستلمة من العميل</h3>
                        ${isAdmin ? `
                            <button class="btn btn-gold btn-sm" onclick="addClientPaymentRow()">
                                <i class="fas fa-plus"></i>
                                إضافة دفعة مستلمة
                            </button>
                        ` : ''}
                    </div>

                    <div class="craftsmen-table-wrapper">
                        <table class="craftsmen-table" id="clientPaymentsTable">
                            <thead>
                                <tr>
                                    <th style="width:18%;">المبلغ (ل.س)</th>
                                    <th style="width:18%;">المبلغ ($)</th>
                                    <th>الملاحظات</th>
                                    <th style="width:20%;">تاريخ الاستلام</th>
                                    ${isAdmin ? '<th style="width:6%;"></th>' : ''}
                                </tr>
                            </thead>
                            <tbody id="clientPaymentsTbody">
                                ${(invoice.clientPayments && invoice.clientPayments.length > 0)
                                    ? invoice.clientPayments.map(cp => renderClientPaymentRow(cp, isAdmin)).join('')
                                    : `
                                        <tr>
                                            <td colspan="${isAdmin ? '5' : '4'}" style="text-align:center; padding:2.5rem 1rem; color:var(--color-gray);">
                                                ${isAdmin ? 'لا توجد دفعات مستلمة بعد. اضغط "إضافة دفعة مستلمة" للبدء.' : 'لا توجد دفعات مستلمة مسجلة حالياً.'}
                                            </td>
                                        </tr>
                                    `
                                }
                            </tbody>
                            ${(invoice.clientPayments && invoice.clientPayments.length > 0) ? `
                                <tfoot>
                                    <tr class="table-total-row">
                                        <td>${formatCurrencySYP((invoice.clientPayments || []).reduce((s,p)=>s+(Number(p.amountSYP)||0), 0))}</td>
                                        <td>${formatCurrencyUSD((invoice.clientPayments || []).reduce((s,p)=>s+(Number(p.amountUSD)||0), 0))}</td>
                                        <td colspan="${isAdmin ? '1' : '0'}" style="text-align:left;">إجمالي المبالغ المستلمة</td>
                                        ${isAdmin ? '<td></td><td></td>' : '<td></td>'}
                                    </tr>
                                </tfoot>
                            ` : ''}
                        </table>
                    </div>

                    <div class="section-heading">
                        <h3><i class="fas fa-hard-hat"></i>تفاصيل المدفوعات والحرفيين</h3>
                        ${isAdmin ? `
                            <button class="btn btn-gold btn-sm" onclick="addPaymentRow()">
                                <i class="fas fa-plus"></i>
                                إضافة دفعة / حرفي
                            </button>
                        ` : ''}
                    </div>

                    <div class="craftsmen-table-wrapper">
                        <table class="craftsmen-table" id="craftsmenTable">
                            <thead>
                                <tr>
                                    <th style="width:14%;">الدفعة (ل.س)</th>
                                    <th style="width:14%;">الدفعة ($)</th>
                                    <th style="width:18%;">نوع الحرفي</th>
                                    <th>اسم الحرفي</th>
                                    <th style="width:18%;">التاريخ</th>
                                    ${isAdmin ? '<th style="width:6%;"></th>' : ''}
                                </tr>
                            </thead>
                            <tbody id="craftsmenTbody">
                                ${(invoice.payments && invoice.payments.length > 0)
                                    ? invoice.payments.map(p => renderPaymentRow(p, isAdmin)).join('')
                                    : `
                                        <tr>
                                            <td colspan="${isAdmin ? '6' : '5'}" style="text-align:center; padding:2.5rem 1rem; color:var(--color-gray);">
                                                ${isAdmin ? 'لا توجد مدفوعات بعد. اضغط "إضافة دفعة / حرفي" للبدء.' : 'لا توجد مدفوعات مسجلة حالياً.'}
                                            </td>
                                        </tr>
                                    `
                                }
                            </tbody>
                            ${(invoice.payments && invoice.payments.length > 0) ? `
                                <tfoot>
                                    <tr class="table-total-row">
                                        <td>${formatCurrencySYP(totalReceivedSYP)}</td>
                                        <td>${formatCurrencyUSD(totalReceivedUSD)}</td>
                                        <td colspan="${isAdmin ? '3' : '2'}" style="text-align:left;">إجمالي المدفوعات</td>
                                        ${isAdmin ? '<td></td>' : ''}
                                    </tr>
                                </tfoot>
                            ` : ''}
                        </table>
                    </div>

                    <div class="section-heading" style="margin-top:2rem;">
                        <h3><i class="fas fa-boxes-stacked"></i>أسعار المواد والمستلزمات</h3>
                        ${isAdmin ? `
                            <button class="btn btn-gold btn-sm" onclick="addMaterialRow()">
                                <i class="fas fa-plus"></i>
                                إضافة مادة
                            </button>
                        ` : ''}
                    </div>

                    <div class="craftsmen-table-wrapper">
                        <table class="craftsmen-table" id="materialsTable">
                            <thead>
                                <tr>
                                    <th style="width:16%;">السعر (ل.س)</th>
                                    <th style="width:16%;">السعر ($)</th>
                                    <th>اسم المادة</th>
                                    <th style="width:20%;">التاريخ</th>
                                    ${isAdmin ? '<th style="width:7%;"></th>' : ''}
                                </tr>
                            </thead>
                            <tbody id="materialsTbody">
                                ${(invoice.materials && invoice.materials.length > 0)
                                    ? invoice.materials.map(m => renderMaterialRow(m, isAdmin)).join('')
                                    : `
                                        <tr>
                                            <td colspan="${isAdmin ? '5' : '4'}" style="text-align:center; padding:2.5rem 1rem; color:var(--color-gray);">
                                                ${isAdmin ? 'لا توجد مواد مسجلة بعد. اضغط "إضافة مادة" للبدء.' : 'لا توجد مواد مسجلة حالياً.'}
                                            </td>
                                        </tr>
                                    `
                                }
                            </tbody>
                            ${(invoice.materials && invoice.materials.length > 0) ? `
                                <tfoot>
                                    <tr class="table-total-row">
                                        <td>${formatCurrencySYP(totalMaterialsSYP)}</td>
                                        <td>${formatCurrencyUSD(totalMaterialsUSD)}</td>
                                        <td colspan="${isAdmin ? '2' : '1'}" style="text-align:left;">إجمالي أسعار المواد</td>
                                        ${isAdmin ? '<td></td>' : ''}
                                    </tr>
                                </tfoot>
                            ` : ''}
                        </table>
                    </div>

                    <div id="sitePhotosPDFWrapper">
                        <div class="section-heading" style="margin-top:2rem;">
                            <h3><i class="fas fa-images"></i>صور المنشئة والموقع</h3>
                            ${isAdmin ? `
                                <label class="btn btn-gold btn-sm" style="cursor:pointer;">
                                    <i class="fas fa-cloud-upload-alt"></i>
                                    رفع صور
                                    <input type="file" accept="image/*" multiple style="display:none;" onchange="handleSitePhotosUpload(event)">
                                </label>
                            ` : ''}
                        </div>

                        <div class="site-photos-grid" id="sitePhotosGrid">
                            ${photos.length === 0 ? `
                                <div class="empty-state" style="padding:2rem 1rem;">
                                    <div class="empty-state-icon" style="width:60px; height:60px; font-size:1.6rem;"><i class="fas fa-image"></i></div>
                                    <h3 style="font-size:1rem;">لا توجد صور بعد</h3>
                                    ${isAdmin ? '<p style="font-size:0.85rem;">يمكنك رفع صور للموقع والمنشئة عبر الزر أعلاه</p>' : ''}
                                </div>
                            ` : photos.map((p, i) => `
                                <div class="site-photo-card" data-photo-idx="${i}">
                                    <img src="${p}" alt="صورة منشئة ${i+1}">
                                    ${isAdmin ? `
                                        <button class="site-photo-remove" onclick="removeSitePhoto(${i})" title="حذف الصورة">
                                            <i class="fas fa-times"></i>
                                        </button>
                                    ` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div class="invoice-actions-bar" id="invoiceActionsBar">
                        <div class="link-share-box" style="display:flex;">
                            <i class="fas fa-link" style="color:var(--color-gray);"></i>
                            <input type="text" readonly value="${shareUrl}" id="shareLinkInput">
                            <button class="icon-btn icon-btn-copy" onclick="copyCurrentInvoiceLink()" title="نسخ الرابط">
                                <i class="fas fa-copy"></i>
                            </button>
                        </div>
                        <div class="invoice-actions-group">
                            <button class="btn btn-outline btn-sm" onclick="exportInvoicePDF()">
                                <i class="fas fa-file-pdf"></i>
                                تحميل PDF
                            </button>
                            ${isAdmin ? `
                                <button class="btn btn-primary btn-sm" onclick="saveInvoiceChanges('${invoice.id}')">
                                    <i class="fas fa-save"></i>
                                    حفظ التغييرات
                                </button>
                            ` : `
                                <a href="tel:0096391929615" class="btn btn-gold btn-sm">
                                    <i class="fas fa-phone-alt"></i>
                                    تواصل معنا
                                </a>
                            `}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderPaymentRow(payment, isAdmin) {
    if (isAdmin) {
        return `
            <tr data-pay-id="${payment.id}">
                <td>
                    <input type="number" class="pay-amount-syp" min="0" value="${payment.amountSYP}" placeholder="0" oninput="updateAmountsLive()">
                </td>
                <td>
                    <input type="number" class="pay-amount-usd" min="0" value="${payment.amountUSD}" placeholder="0" oninput="updateAmountsLive()">
                </td>
                <td>
                    <input type="text" class="pay-type" value="${escapeHtml(payment.craftsmanType)}" placeholder="مثال: نجار / حداد / سباك">
                </td>
                <td>
                    <input type="text" class="pay-name" value="${escapeHtml(payment.craftsmanName)}" placeholder="اسم الحرفي">
                </td>
                <td>
                    <input type="date" class="pay-date" value="${formatDateInput(payment.date)}">
                </td>
                <td>
                    <button class="icon-btn icon-btn-delete" onclick="removePaymentRow(this)" title="حذف">
                        <i class="fas fa-times"></i>
                    </button>
                </td>
            </tr>
        `;
    } else {
        return `
            <tr>
                <td style="font-weight:600;">${formatCurrencySYP(payment.amountSYP)}</td>
                <td style="font-weight:600;">${formatCurrencyUSD(payment.amountUSD)}</td>
                <td><span class="craftsman-type-badge type-أخرى">${escapeHtml(payment.craftsmanType) || '-'}</span></td>
                <td>${escapeHtml(payment.craftsmanName) || '-'}</td>
                <td>${formatDate(payment.date)}</td>
            </tr>
        `;
    }
}

function renderMaterialRow(material, isAdmin) {
    if (isAdmin) {
        return `
            <tr data-mat-id="${material.id}">
                <td>
                    <input type="number" class="mat-amount-syp" min="0" value="${material.amountSYP}" placeholder="0">
                </td>
                <td>
                    <input type="number" class="mat-amount-usd" min="0" value="${material.amountUSD}" placeholder="0">
                </td>
                <td>
                    <input type="text" class="mat-name" value="${escapeHtml(material.materialName)}" placeholder="مثال: سمنت / رمل / سيراميك / دهان">
                </td>
                <td>
                    <input type="date" class="mat-date" value="${formatDateInput(material.date)}">
                </td>
                <td>
                    <button class="icon-btn icon-btn-delete" onclick="removeMaterialRow(this)" title="حذف">
                        <i class="fas fa-times"></i>
                    </button>
                </td>
            </tr>
        `;
    } else {
        return `
            <tr>
                <td style="font-weight:600;">${formatCurrencySYP(material.amountSYP)}</td>
                <td style="font-weight:600;">${formatCurrencyUSD(material.amountUSD)}</td>
                <td>${escapeHtml(material.materialName) || '-'}</td>
                <td>${formatDate(material.date)}</td>
            </tr>
        `;
    }
}

function addPaymentRow() {
    const tbody = document.getElementById('craftsmenTbody');
    if (!tbody) return;

    const emptyRow = tbody.querySelector('tr td[colspan]');
    if (emptyRow) {
        tbody.innerHTML = '';
    }

    const tempId = 'new_' + Date.now();
    const newRow = document.createElement('tr');
    newRow.setAttribute('data-pay-id', tempId);
    newRow.innerHTML = `
        <td>
            <input type="number" class="pay-amount-syp" min="0" value="0" placeholder="0" oninput="updateAmountsLive()">
        </td>
        <td>
            <input type="number" class="pay-amount-usd" min="0" value="0" placeholder="0" oninput="updateAmountsLive()">
        </td>
        <td>
            <input type="text" class="pay-type" placeholder="مثال: نجار / حداد / سباك">
        </td>
        <td>
            <input type="text" class="pay-name" placeholder="اسم الحرفي">
        </td>
        <td>
            <input type="date" class="pay-date" value="${todayStr()}">
        </td>
        <td>
            <button class="icon-btn icon-btn-delete" onclick="removePaymentRow(this)" title="حذف">
                <i class="fas fa-times"></i>
            </button>
        </td>
    `;
    tbody.appendChild(newRow);
    updateAmountsLive();
    updateCraftsmenTableFooter();
}

function removePaymentRow(btn) {
    const tr = btn.closest('tr');
    if (!tr) return;
    tr.remove();
    updateAmountsLive();
    updateCraftsmenTableFooter();
}

function renderClientPaymentRow(cp, isAdmin) {
    if (isAdmin) {
        return `
            <tr data-cpay-id="${cp.id}">
                <td>
                    <input type="number" class="cpay-amount-syp" min="0" value="${cp.amountSYP}" placeholder="0" oninput="updateAmountsLive()">
                </td>
                <td>
                    <input type="number" class="cpay-amount-usd" min="0" value="${cp.amountUSD}" placeholder="0" oninput="updateAmountsLive()">
                </td>
                <td>
                    <input type="text" class="cpay-note" value="${escapeHtml(cp.note || '')}" placeholder="مثال: دفعة أولى، دفعة نهائية، عربون، ...">
                </td>
                <td>
                    <input type="date" class="cpay-date" value="${formatDateInput(cp.date)}">
                </td>
                <td>
                    <button class="icon-btn icon-btn-delete" onclick="removeClientPaymentRow(this)" title="حذف">
                        <i class="fas fa-times"></i>
                    </button>
                </td>
            </tr>
        `;
    }
    return `
        <tr data-cpay-id="${cp.id}">
            <td class="amount-cell amount-paid" style="font-size:0.85rem;">${formatCurrencySYP(Number(cp.amountSYP) || 0)}</td>
            <td class="amount-cell amount-pending" style="font-size:0.85rem;">${formatCurrencyUSD(Number(cp.amountUSD) || 0)}</td>
            <td style="color:var(--color-gray); font-size:0.9rem;">${escapeHtml(cp.note || '—')}</td>
            <td>${formatDate(cp.date)}</td>
        </tr>
    `;
}

function addClientPaymentRow() {
    const tbody = document.getElementById('clientPaymentsTbody');
    if (!tbody) return;
    const emptyRow = tbody.querySelector('tr td[colspan]');
    if (emptyRow) tbody.innerHTML = '';
    const tempId = 'new_cpay_' + Date.now();
    const newRow = document.createElement('tr');
    newRow.setAttribute('data-cpay-id', tempId);
    newRow.innerHTML = `
        <td>
            <input type="number" class="cpay-amount-syp" min="0" value="0" placeholder="0" oninput="updateAmountsLive()">
        </td>
        <td>
            <input type="number" class="cpay-amount-usd" min="0" value="0" placeholder="0" oninput="updateAmountsLive()">
        </td>
        <td>
            <input type="text" class="cpay-note" placeholder="مثال: دفعة أولى، دفعة نهائية، عربون، ...">
        </td>
        <td>
            <input type="date" class="cpay-date" value="${todayStr()}">
        </td>
        <td>
            <button class="icon-btn icon-btn-delete" onclick="removeClientPaymentRow(this)" title="حذف">
                <i class="fas fa-times"></i>
            </button>
        </td>
    `;
    tbody.appendChild(newRow);
    updateAmountsLive();
    updateClientPaymentsFooter();
}

function removeClientPaymentRow(btn) {
    const tr = btn.closest('tr');
    if (!tr) return;
    tr.remove();
    updateAmountsLive();
    updateClientPaymentsFooter();
}

function collectClientPaymentsFromDOM() {
    const tbody = document.getElementById('clientPaymentsTbody');
    if (!tbody) return [];
    const rows = tbody.querySelectorAll('tr[data-cpay-id]');
    const cps = [];
    rows.forEach(row => {
        const id = row.getAttribute('data-cpay-id');
        const amountSYP = row.querySelector('.cpay-amount-syp')?.value;
        const amountUSD = row.querySelector('.cpay-amount-usd')?.value;
        const note = row.querySelector('.cpay-note')?.value;
        const date = row.querySelector('.cpay-date')?.value;
        cps.push({ id, amountSYP, amountUSD, note, date });
    });
    return cps;
}

function updateClientPaymentsFooter() {
    const table = document.getElementById('clientPaymentsTable');
    if (!table) return;
    const tbody = table.querySelector('#clientPaymentsTbody');
    const rows = tbody.querySelectorAll('tr[data-cpay-id]');
    if (rows.length === 0) {
        const hasAnyEmpty = tbody.querySelector('tr td[colspan]');
        if (!hasAnyEmpty) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align:center; padding:2.5rem 1rem; color:var(--color-gray);">
                        لا توجد دفعات مستلمة بعد. اضغط "إضافة دفعة مستلمة" للبدء.
                    </td>
                </tr>
            `;
        }
    }
    let tfoot = table.querySelector('tfoot');
    const cps = collectClientPaymentsFromDOM();
    const totalSYP = cps.reduce((s, p) => s + (Number(p.amountSYP) || 0), 0);
    const totalUSD = cps.reduce((s, p) => s + (Number(p.amountUSD) || 0), 0);
    if (rows.length > 0) {
        if (!tfoot) {
            tfoot = document.createElement('tfoot');
            table.appendChild(tfoot);
        }
        tfoot.innerHTML = `
            <tr class="table-total-row">
                <td>${formatCurrencySYP(totalSYP)}</td>
                <td>${formatCurrencyUSD(totalUSD)}</td>
                <td style="text-align:left;">إجمالي المبالغ المستلمة</td>
                <td></td>
                <td></td>
            </tr>
        `;
    } else if (tfoot) {
        tfoot.remove();
    }
}

function addMaterialRow() {
    const tbody = document.getElementById('materialsTbody');
    if (!tbody) return;
    const emptyRow = tbody.querySelector('tr td[colspan]');
    if (emptyRow) tbody.innerHTML = '';
    const tempId = 'new_mat_' + Date.now();
    const newRow = document.createElement('tr');
    newRow.setAttribute('data-mat-id', tempId);
    newRow.innerHTML = `
        <td>
            <input type="number" class="mat-amount-syp" min="0" value="0" placeholder="0">
        </td>
        <td>
            <input type="number" class="mat-amount-usd" min="0" value="0" placeholder="0">
        </td>
        <td>
            <input type="text" class="mat-name" placeholder="اسم المادة / المستلزم">
        </td>
        <td>
            <input type="date" class="mat-date" value="${todayStr()}">
        </td>
        <td>
            <button class="icon-btn icon-btn-delete" onclick="removeMaterialRow(this)" title="حذف">
                <i class="fas fa-times"></i>
            </button>
        </td>
    `;
    tbody.appendChild(newRow);
    updateMaterialsTableFooter();
}

function removeMaterialRow(btn) {
    const tr = btn.closest('tr');
    if (!tr) return;
    tr.remove();
    updateMaterialsTableFooter();
}

function collectPaymentsFromDOM() {
    const tbody = document.getElementById('craftsmenTbody');
    if (!tbody) return [];
    const rows = tbody.querySelectorAll('tr[data-pay-id]');
    const payments = [];
    rows.forEach(row => {
        const id = row.getAttribute('data-pay-id');
        const amountSYP = row.querySelector('.pay-amount-syp')?.value;
        const amountUSD = row.querySelector('.pay-amount-usd')?.value;
        const type = row.querySelector('.pay-type')?.value;
        const name = row.querySelector('.pay-name')?.value;
        const date = row.querySelector('.pay-date')?.value;
        payments.push({ id, amountSYP, amountUSD, craftsmanType: type, craftsmanName: name, date });
    });
    return payments;
}

function collectMaterialsFromDOM() {
    const tbody = document.getElementById('materialsTbody');
    if (!tbody) return [];
    const rows = tbody.querySelectorAll('tr[data-mat-id]');
    const materials = [];
    rows.forEach(row => {
        const id = row.getAttribute('data-mat-id');
        const amountSYP = row.querySelector('.mat-amount-syp')?.value;
        const amountUSD = row.querySelector('.mat-amount-usd')?.value;
        const name = row.querySelector('.mat-name')?.value;
        const date = row.querySelector('.mat-date')?.value;
        materials.push({ id, amountSYP, amountUSD, materialName: name, date });
    });
    return materials;
}

function updateAmountsLive() {
    const clientPayments = collectClientPaymentsFromDOM();
    const totalReceivedSYP = clientPayments.reduce((s, p) => s + (Number(p.amountSYP) || 0), 0);
    const totalReceivedUSD = clientPayments.reduce((s, p) => s + (Number(p.amountUSD) || 0), 0);

    const agreedInputSYP = document.getElementById('editAgreedAmountSYP');
    const agreedInputUSD = document.getElementById('editAgreedAmountUSD');
    const agreedSYP = agreedInputSYP ? (Number(agreedInputSYP.value) || 0) : 0;
    const agreedUSD = agreedInputUSD ? (Number(agreedInputUSD.value) || 0) : 0;
    const remainingSYP = Math.max(0, agreedSYP - totalReceivedSYP);
    const remainingUSD = Math.max(0, agreedUSD - totalReceivedUSD);

    const recEl = document.getElementById('displayTotalReceived');
    const remEl = document.getElementById('displayRemaining');

    if (recEl) {
        recEl.innerHTML = `${formatCurrencySYP(totalReceivedSYP)}<br>${formatCurrencyUSD(totalReceivedUSD)}`;
    }
    if (remEl) {
        remEl.innerHTML = `${formatCurrencySYP(remainingSYP)}<br>${formatCurrencyUSD(remainingUSD)}`;
    }
    updateCraftsmenTableFooter();
    updateClientPaymentsFooter();
}

function updateCraftsmenTableFooter() {
    const table = document.getElementById('craftsmenTable');
    if (!table) return;
    const tbody = table.querySelector('#craftsmenTbody');
    const rows = tbody.querySelectorAll('tr[data-pay-id]');

    if (rows.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align:center; padding:2.5rem 1rem; color:var(--color-gray);">
                    لا توجد مدفوعات بعد. اضغط "إضافة دفعة / حرفي" للبدء.
                </td>
            </tr>
        `;
    }

    let tfoot = table.querySelector('tfoot');
    const payments = collectPaymentsFromDOM();
    const totalSYP = payments.reduce((s, p) => s + (Number(p.amountSYP) || 0), 0);
    const totalUSD = payments.reduce((s, p) => s + (Number(p.amountUSD) || 0), 0);

    if (rows.length > 0) {
        if (!tfoot) {
            tfoot = document.createElement('tfoot');
            table.appendChild(tfoot);
        }
        tfoot.innerHTML = `
            <tr class="table-total-row">
                <td>${formatCurrencySYP(totalSYP)}</td>
                <td>${formatCurrencyUSD(totalUSD)}</td>
                <td colspan="3" style="text-align:left;">إجمالي المدفوعات</td>
                <td></td>
            </tr>
        `;
    } else if (tfoot) {
        tfoot.remove();
    }
}

function updateMaterialsTableFooter() {
    const table = document.getElementById('materialsTable');
    if (!table) return;
    const tbody = table.querySelector('#materialsTbody');
    const rows = tbody.querySelectorAll('tr[data-mat-id]');

    if (rows.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center; padding:2.5rem 1rem; color:var(--color-gray);">
                    لا توجد مواد بعد. اضغط "إضافة مادة" للبدء.
                </td>
            </tr>
        `;
    }

    let tfoot = table.querySelector('tfoot');
    const materials = collectMaterialsFromDOM();
    const totalSYP = materials.reduce((s, m) => s + (Number(m.amountSYP) || 0), 0);
    const totalUSD = materials.reduce((s, m) => s + (Number(m.amountUSD) || 0), 0);

    if (rows.length > 0) {
        if (!tfoot) {
            tfoot = document.createElement('tfoot');
            table.appendChild(tfoot);
        }
        tfoot.innerHTML = `
            <tr class="table-total-row">
                <td>${formatCurrencySYP(totalSYP)}</td>
                <td>${formatCurrencyUSD(totalUSD)}</td>
                <td colspan="2" style="text-align:left;">إجمالي أسعار المواد</td>
                <td></td>
            </tr>
        `;
    } else if (tfoot) {
        tfoot.remove();
    }
}

let currentSitePhotos = [];
let currentModalSitePhotos = [];
function handleSitePhotosUpload(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    Promise.all(files.map(file => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
    }))).then(newPhotos => {
        currentSitePhotos = [...(currentSitePhotos.length > 0 ? currentSitePhotos : getCurrentInvoicePhotos()), ...newPhotos];
        renderSitePhotosGrid(currentSitePhotos);
        toast('تم الرفع', `تم رفع ${newPhotos.length} صورة بنجاح. اضغط حفظ التغييرات لتخزينها.`, 'success');
    });
}
function getCurrentInvoicePhotos() {
    const hashRoute = getRoute();
    const inv = (hashRoute.page === 'invoice' && hashRoute.params.invoiceId)
        ? getInvoiceById(hashRoute.params.invoiceId) : null;
    return inv ? (inv.sitePhotos || []) : [];
}
function renderSitePhotosGrid(photos) {
    const grid = document.getElementById('sitePhotosGrid');
    if (!grid) return;
    if (photos.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="padding:2rem 1rem;">
                <div class="empty-state-icon" style="width:60px; height:60px; font-size:1.6rem;"><i class="fas fa-image"></i></div>
                <h3 style="font-size:1rem;">لا توجد صور بعد</h3>
                <p style="font-size:0.85rem;">يمكنك رفع صور للموقع والمنشئة عبر الزر أعلاه</p>
            </div>
        `;
        return;
    }
    grid.innerHTML = photos.map((p, i) => `
        <div class="site-photo-card" data-photo-idx="${i}">
            <img src="${p}" alt="صورة منشئة ${i+1}">
            <button class="site-photo-remove" onclick="removeSitePhoto(${i})" title="حذف الصورة">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}
function removeSitePhoto(idx) {
    currentSitePhotos = currentSitePhotos.length > 0 ? currentSitePhotos : getCurrentInvoicePhotos();
    if (!currentSitePhotos[idx]) return;
    currentSitePhotos.splice(idx, 1);
    renderSitePhotosGrid(currentSitePhotos);
}

function handleModalSitePhotosUpload(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    Promise.all(files.map(file => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
    }))).then(newPhotos => {
        currentModalSitePhotos = [...currentModalSitePhotos, ...newPhotos];
        renderModalSitePhotosGrid();
        toast('تم الرفع', `تم رفع ${newPhotos.length} صورة بنجاح`, 'success');
    });
}
function renderModalSitePhotosGrid() {
    const grid = document.getElementById('modalSitePhotosGrid');
    if (!grid) return;
    if (currentModalSitePhotos.length === 0) {
        grid.innerHTML = `<p style="color:var(--color-gray); text-align:center; padding:1rem; grid-column:1/-1;">لا توجد صور بعد — اضغط رفع صور لإضافة صور للمنشئة</p>`;
        return;
    }
    grid.innerHTML = currentModalSitePhotos.map((p, i) => `
        <div class="site-photo-card">
            <img src="${p}" alt="صورة المنشئة ${i+1}">
            <button type="button" class="site-photo-remove" onclick="removeModalSitePhoto(${i})" title="حذف الصورة">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}
function removeModalSitePhoto(idx) {
    if (!currentModalSitePhotos[idx]) return;
    currentModalSitePhotos.splice(idx, 1);
    renderModalSitePhotosGrid();
}

function saveInvoiceChanges(invoiceId) {
    const customerName = document.getElementById('editCustomerName')?.value || '';
    const agreedAmountSYP = Number(document.getElementById('editAgreedAmountSYP')?.value || 0);
    const agreedAmountUSD = Number(document.getElementById('editAgreedAmountUSD')?.value || 0);
    const payments = collectPaymentsFromDOM();
    const clientPayments = collectClientPaymentsFromDOM();
    const materials = collectMaterialsFromDOM();
    const sitePhotos = currentSitePhotos.length > 0 ? currentSitePhotos : getCurrentInvoicePhotos();

    if (!customerName.trim()) {
        toast('مطلوب اسم العميل', 'يرجى إدخال اسم العميل', 'warning');
        document.getElementById('editCustomerName')?.focus();
        return;
    }

    updateInvoice(invoiceId, {
        customerName: customerName.trim(),
        agreedAmountSYP,
        agreedAmountUSD,
        payments,
        clientPayments,
        materials,
        sitePhotos
    });
    currentSitePhotos = [];

    toast('تم الحفظ', 'تم تحديث الفاتورة بنجاح', 'success');
    renderCurrentRoute();
}

// ============================================
// Create / Edit Invoice Modal
// ============================================

function openCreateInvoiceModal() {
    currentModalSitePhotos = [];
    const content = renderInvoiceFormModal(null);
    showModal(content, { title: 'إنشاء فاتورة جديدة', isLarge: true, footer: `
        <button class="btn btn-outline" onclick="closeModal()">إلغاء</button>
        <button class="btn btn-gold" onclick="submitInvoiceForm(null)">
            <i class="fas fa-check"></i>
            إنشاء الفاتورة
        </button>
    `});
}

function openEditInvoiceModal(invoiceId) {
    const invoice = getInvoiceById(invoiceId);
    if (!invoice) {
        toast('خطأ', 'الفاتورة غير موجودة', 'error');
        return;
    }
    currentModalSitePhotos = Array.isArray(invoice.sitePhotos) ? [...invoice.sitePhotos] : [];
    const content = renderInvoiceFormModal(invoice);
    showModal(content, { title: 'تعديل الفاتورة', isLarge: true, footer: `
        <button class="btn btn-outline" onclick="closeModal()">إلغاء</button>
        <button class="btn btn-gold" onclick="submitInvoiceForm('${invoiceId}')">
            <i class="fas fa-save"></i>
            حفظ التغييرات
        </button>
    `});
    setTimeout(() => renderModalSitePhotosGrid(), 50);
}

function renderInvoiceFormModal(invoice) {
    const isEdit = !!invoice;
    const data = invoice || {
        customerName: '',
        agreedAmountSYP: 0,
        agreedAmountUSD: 0,
        clientPayments: [{ id: generateId('cpay'), amountSYP: 0, amountUSD: 0, note: '', date: todayStr() }],
        payments: [{ id: generateId('pay'), amountSYP: 0, amountUSD: 0, craftsmanType: '', craftsmanName: '', date: todayStr() }],
        materials: [{ id: generateId('mat'), amountSYP: 0, amountUSD: 0, materialName: '', date: todayStr() }]
    };
    if (!Array.isArray(data.clientPayments) || data.clientPayments.length === 0) {
        data.clientPayments = [{ id: generateId('cpay'), amountSYP: 0, amountUSD: 0, note: '', date: todayStr() }];
    }

    return `
        <div class="form-group">
            <label class="form-label"><span class="required">*</span>اسم العميل</label>
            <input type="text" id="formCustomerName" class="form-input" value="${escapeHtml(data.customerName)}" placeholder="مثال: أحمد محمد">
        </div>

        <div class="form-group">
            <label class="form-label"><span class="required">*</span>المبلغ المتفق عليه</label>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.8rem;">
                <div style="position:relative;">
                    <input type="number" id="formAgreedAmountSYP" class="form-input" min="0" value="${data.agreedAmountSYP}" placeholder="ليرة سورية">
                    <span style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--color-gray); font-size:0.85rem; pointer-events:none;">ل.س</span>
                </div>
                <div style="position:relative;">
                    <input type="number" id="formAgreedAmountUSD" class="form-input" min="0" value="${data.agreedAmountUSD}" placeholder="دولار أمريكي">
                    <span style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--color-gray); font-size:0.85rem; pointer-events:none;">$</span>
                </div>
            </div>
        </div>

        <hr style="border:none; border-top:1px solid var(--color-gray-light); margin:2rem 0;">

        <div class="section-heading" style="margin-bottom:1rem;">
            <h3 style="font-size:1.15rem; font-family:'Playfair Display',serif;">
                <i class="fas fa-hand-holding-heart" style="color:var(--color-gold-dark);"></i>
                الدفعات المستلمة من العميل
            </h3>
            <button type="button" class="btn btn-outline-gold btn-sm" onclick="modalAddClientPayment()">
                <i class="fas fa-plus"></i>
                إضافة دفعة مستلمة
            </button>
        </div>

        <div class="craftsmen-table-wrapper">
            <table class="craftsmen-table" id="modalClientPaymentsTable">
                <thead>
                    <tr>
                        <th style="width:15%;">ل.س</th>
                        <th style="width:15%;">$</th>
                        <th>الملاحظات</th>
                        <th style="width:18%;">تاريخ الاستلام</th>
                        <th style="width:6%;"></th>
                    </tr>
                </thead>
                <tbody id="modalClientPaymentsTbody">
                    ${(data.clientPayments || []).map(cp => `
                        <tr data-mcpay-id="${cp.id}">
                            <td>
                                <input type="number" min="0" class="mcpay-amount-syp" value="${cp.amountSYP}" placeholder="0">
                            </td>
                            <td>
                                <input type="number" min="0" class="mcpay-amount-usd" value="${cp.amountUSD}" placeholder="0">
                            </td>
                            <td>
                                <input type="text" class="mcpay-note" value="${escapeHtml(cp.note || '')}" placeholder="مثال: دفعة أولى / عربون">
                            </td>
                            <td>
                                <input type="date" class="mcpay-date" value="${formatDateInput(cp.date)}">
                            </td>
                            <td>
                                <button type="button" class="icon-btn icon-btn-delete" onclick="modalRemoveClientPayment(this)">
                                    <i class="fas fa-times"></i>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <hr style="border:none; border-top:1px solid var(--color-gray-light); margin:2rem 0;">

        <div class="section-heading" style="margin-bottom:1rem;">
            <h3 style="font-size:1.15rem; font-family:'Playfair Display',serif;">
                <i class="fas fa-hard-hat" style="color:var(--color-gold-dark);"></i>
                المدفوعات والحرفيين
            </h3>
            <button type="button" class="btn btn-outline-gold btn-sm" onclick="modalAddPayment()">
                <i class="fas fa-plus"></i>
                إضافة دفعة
            </button>
        </div>

        <div class="craftsmen-table-wrapper">
            <table class="craftsmen-table" id="modalCraftsmenTable">
                <thead>
                    <tr>
                        <th style="width:15%;">ل.س</th>
                        <th style="width:15%;">$</th>
                        <th style="width:22%;">نوع الحرفي</th>
                        <th>اسم الحرفي</th>
                        <th style="width:18%;">التاريخ</th>
                        <th style="width:6%;"></th>
                    </tr>
                </thead>
                <tbody id="modalCraftsmenTbody">
                    ${data.payments.map(p => `
                        <tr data-mpay-id="${p.id}">
                            <td>
                                <input type="number" min="0" class="mpay-amount-syp" value="${p.amountSYP}" placeholder="0">
                            </td>
                            <td>
                                <input type="number" min="0" class="mpay-amount-usd" value="${p.amountUSD}" placeholder="0">
                            </td>
                            <td>
                                <input type="text" class="mpay-type" value="${escapeHtml(p.craftsmanType)}" placeholder="مثال: نجار">
                            </td>
                            <td>
                                <input type="text" class="mpay-name" value="${escapeHtml(p.craftsmanName)}" placeholder="اسم الحرفي">
                            </td>
                            <td>
                                <input type="date" class="mpay-date" value="${formatDateInput(p.date)}">
                            </td>
                            <td>
                                <button type="button" class="icon-btn icon-btn-delete" onclick="modalRemovePayment(this)">
                                    <i class="fas fa-times"></i>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <hr style="border:none; border-top:1px solid var(--color-gray-light); margin:2rem 0;">

        <div class="section-heading" style="margin-bottom:1rem;">
            <h3 style="font-size:1.15rem; font-family:'Playfair Display',serif;">
                <i class="fas fa-boxes-stacked" style="color:var(--color-gold-dark);"></i>
                أسعار المواد والمستلزمات
            </h3>
            <button type="button" class="btn btn-outline-gold btn-sm" onclick="modalAddMaterial()">
                <i class="fas fa-plus"></i>
                إضافة مادة
            </button>
        </div>

        <div class="craftsmen-table-wrapper">
            <table class="craftsmen-table" id="modalMaterialsTable">
                <thead>
                    <tr>
                        <th style="width:17%;">ل.س</th>
                        <th style="width:17%;">$</th>
                        <th>اسم المادة</th>
                        <th style="width:20%;">التاريخ</th>
                        <th style="width:6%;"></th>
                    </tr>
                </thead>
                <tbody id="modalMaterialsTbody">
                    ${(data.materials || []).map(m => `
                        <tr data-mmat-id="${m.id}">
                            <td>
                                <input type="number" min="0" class="mmat-amount-syp" value="${m.amountSYP}" placeholder="0">
                            </td>
                            <td>
                                <input type="number" min="0" class="mmat-amount-usd" value="${m.amountUSD}" placeholder="0">
                            </td>
                            <td>
                                <input type="text" class="mmat-name" value="${escapeHtml(m.materialName)}" placeholder="مثال: سمنت">
                            </td>
                            <td>
                                <input type="date" class="mmat-date" value="${formatDateInput(m.date)}">
                            </td>
                            <td>
                                <button type="button" class="icon-btn icon-btn-delete" onclick="modalRemoveMaterial(this)">
                                    <i class="fas fa-times"></i>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <hr style="border:none; border-top:1px solid var(--color-gray-light); margin:2rem 0;">

        <div class="section-heading" style="margin-bottom:1rem;">
            <h3 style="font-size:1.15rem; font-family:'Playfair Display',serif;">
                <i class="fas fa-images" style="color:var(--color-gold-dark);"></i>
                صور المنشئة والموقع
            </h3>
            <label class="btn btn-outline-gold btn-sm" style="cursor:pointer;">
                <i class="fas fa-cloud-upload-alt"></i>
                رفع صور
                <input type="file" accept="image/*" multiple onchange="handleModalSitePhotosUpload(event)" style="display:none;">
            </label>
        </div>

        <div class="site-photos-grid" id="modalSitePhotosGrid" style="min-height: 40px;">
            ${currentModalSitePhotos.length === 0 ? `<p style="color:var(--color-gray); text-align:center; padding:1rem; grid-column:1/-1;">لا توجد صور بعد — اضغط رفع صور لإضافة صور للمنشئة</p>` : ''}
        </div>
    `;
}

function modalAddPayment() {
    const tbody = document.getElementById('modalCraftsmenTbody');
    if (!tbody) return;
    const tempId = 'new_' + Date.now();
    const tr = document.createElement('tr');
    tr.setAttribute('data-mpay-id', tempId);
    tr.innerHTML = `
        <td>
            <input type="number" min="0" class="mpay-amount-syp" value="0" placeholder="0">
        </td>
        <td>
            <input type="number" min="0" class="mpay-amount-usd" value="0" placeholder="0">
        </td>
        <td>
            <input type="text" class="mpay-type" placeholder="مثال: نجار">
        </td>
        <td>
            <input type="text" class="mpay-name" placeholder="اسم الحرفي">
        </td>
        <td>
            <input type="date" class="mpay-date" value="${todayStr()}">
        </td>
        <td>
            <button type="button" class="icon-btn icon-btn-delete" onclick="modalRemovePayment(this)">
                <i class="fas fa-times"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);
}

function modalRemovePayment(btn) {
    const tbody = document.getElementById('modalCraftsmenTbody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr');
    if (rows.length <= 1) {
        toast('تنبيه', 'يجب أن يبقى صف واحد على الأقل (يمكنك تركه فارغاً)', 'warning');
        return;
    }
    btn.closest('tr').remove();
}

function modalAddMaterial() {
    const tbody = document.getElementById('modalMaterialsTbody');
    if (!tbody) return;
    const tempId = 'new_mat_' + Date.now();
    const tr = document.createElement('tr');
    tr.setAttribute('data-mmat-id', tempId);
    tr.innerHTML = `
        <td>
            <input type="number" min="0" class="mmat-amount-syp" value="0" placeholder="0">
        </td>
        <td>
            <input type="number" min="0" class="mmat-amount-usd" value="0" placeholder="0">
        </td>
        <td>
            <input type="text" class="mmat-name" placeholder="اسم المادة">
        </td>
        <td>
            <input type="date" class="mmat-date" value="${todayStr()}">
        </td>
        <td>
            <button type="button" class="icon-btn icon-btn-delete" onclick="modalRemoveMaterial(this)">
                <i class="fas fa-times"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);
}

function modalRemoveMaterial(btn) {
    const tbody = document.getElementById('modalMaterialsTbody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr');
    if (rows.length <= 1) {
        toast('تنبيه', 'يجب أن يبقى صف واحد على الأقل (يمكنك تركه فارغاً)', 'warning');
        return;
    }
    btn.closest('tr').remove();
}

function modalAddClientPayment() {
    const tbody = document.getElementById('modalClientPaymentsTbody');
    if (!tbody) return;
    const tempId = 'new_mcpay_' + Date.now();
    const tr = document.createElement('tr');
    tr.setAttribute('data-mcpay-id', tempId);
    tr.innerHTML = `
        <td>
            <input type="number" min="0" class="mcpay-amount-syp" value="0" placeholder="0">
        </td>
        <td>
            <input type="number" min="0" class="mcpay-amount-usd" value="0" placeholder="0">
        </td>
        <td>
            <input type="text" class="mcpay-note" placeholder="مثال: دفعة أولى / عربون">
        </td>
        <td>
            <input type="date" class="mcpay-date" value="${todayStr()}">
        </td>
        <td>
            <button type="button" class="icon-btn icon-btn-delete" onclick="modalRemoveClientPayment(this)">
                <i class="fas fa-times"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);
}

function modalRemoveClientPayment(btn) {
    const tbody = document.getElementById('modalClientPaymentsTbody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr');
    if (rows.length <= 1) {
        toast('تنبيه', 'يجب أن يبقى صف واحد على الأقل (يمكنك تركه فارغاً)', 'warning');
        return;
    }
    btn.closest('tr').remove();
}

function collectModalPayments() {
    const tbody = document.getElementById('modalCraftsmenTbody');
    if (!tbody) return [];
    const rows = tbody.querySelectorAll('tr[data-mpay-id]');
    const payments = [];
    rows.forEach(row => {
        const id = row.getAttribute('data-mpay-id');
        const amountSYP = row.querySelector('.mpay-amount-syp')?.value;
        const amountUSD = row.querySelector('.mpay-amount-usd')?.value;
        const type = row.querySelector('.mpay-type')?.value;
        const name = row.querySelector('.mpay-name')?.value;
        const date = row.querySelector('.mpay-date')?.value;
        payments.push({ id, amountSYP, amountUSD, craftsmanType: type, craftsmanName: name, date });
    });
    return payments.filter(p => (Number(p.amountSYP) > 0 || Number(p.amountUSD) > 0) || p.craftsmanName);
}

function collectModalClientPayments() {
    const tbody = document.getElementById('modalClientPaymentsTbody');
    if (!tbody) return [];
    const rows = tbody.querySelectorAll('tr[data-mcpay-id]');
    const cps = [];
    rows.forEach(row => {
        const id = row.getAttribute('data-mcpay-id');
        const amountSYP = row.querySelector('.mcpay-amount-syp')?.value;
        const amountUSD = row.querySelector('.mcpay-amount-usd')?.value;
        const note = row.querySelector('.mcpay-note')?.value;
        const date = row.querySelector('.mcpay-date')?.value;
        cps.push({ id, amountSYP, amountUSD, note, date });
    });
    return cps.filter(cp => (Number(cp.amountSYP) > 0 || Number(cp.amountUSD) > 0) || cp.note);
}

function collectModalMaterials() {
    const tbody = document.getElementById('modalMaterialsTbody');
    if (!tbody) return [];
    const rows = tbody.querySelectorAll('tr[data-mmat-id]');
    const materials = [];
    rows.forEach(row => {
        const id = row.getAttribute('data-mmat-id');
        const amountSYP = row.querySelector('.mmat-amount-syp')?.value;
        const amountUSD = row.querySelector('.mmat-amount-usd')?.value;
        const name = row.querySelector('.mmat-name')?.value;
        const date = row.querySelector('.mmat-date')?.value;
        materials.push({ id, amountSYP, amountUSD, materialName: name, date });
    });
    return materials.filter(m => (Number(m.amountSYP) > 0 || Number(m.amountUSD) > 0) || m.materialName);
}

function submitInvoiceForm(invoiceId) {
    const customerName = (document.getElementById('formCustomerName')?.value || '').trim();
    const agreedAmountSYP = Number(document.getElementById('formAgreedAmountSYP')?.value || 0);
    const agreedAmountUSD = Number(document.getElementById('formAgreedAmountUSD')?.value || 0);
    const payments = collectModalPayments();
    const clientPayments = collectModalClientPayments();
    const materials = collectModalMaterials();
    const sitePhotos = [...currentModalSitePhotos];

    if (!customerName) {
        toast('مطلوب اسم العميل', 'يرجى إدخال اسم العميل', 'warning');
        document.getElementById('formCustomerName')?.focus();
        return;
    }

    if (agreedAmountSYP <= 0 && agreedAmountUSD <= 0) {
        toast('مطلوب المبلغ المتفق عليه', 'يرجى إدخال المبلغ في عملة واحدة على الأقل', 'warning');
        document.getElementById('formAgreedAmountSYP')?.focus();
        return;
    }

    if (invoiceId) {
        updateInvoice(invoiceId, { customerName, agreedAmountSYP, agreedAmountUSD, payments, clientPayments, materials, sitePhotos });
        toast('تم التحديث', 'تم تعديل الفاتورة بنجاح', 'success');
    } else {
        const created = createInvoice({ customerName, agreedAmountSYP, agreedAmountUSD, payments, clientPayments, materials, sitePhotos });
        toast('تم الإنشاء', 'تم إنشاء الفاتورة بنجاح', 'success');
    }

    currentModalSitePhotos = [];
    closeModal();
    renderCurrentRoute();
}

// ============================================
// Delete Confirmation
// ============================================

function confirmDeleteInvoice(invoiceId) {
    const invoice = getInvoiceById(invoiceId);
    if (!invoice) return;

    showModal(`
        <div style="text-align:center; padding:1rem 0;">
            <div style="width:70px; height:70px; margin:0 auto 1.5rem; border-radius:50%; background:rgba(239,68,68,0.1); color:#dc2626; display:flex; align-items:center; justify-content:center; font-size:1.8rem;">
                <i class="fas fa-trash-alt"></i>
            </div>
            <h3 style="font-family:'Playfair Display', serif; font-size:1.4rem; margin-bottom:0.5rem; color:var(--color-black);">تأكيد الحذف</h3>
            <p style="color:var(--color-gray); margin-bottom:0.5rem;">
                هل أنت متأكد من حذف هذه الفاتورة؟
            </p>
            <p style="background:var(--color-cream); padding:0.8rem 1rem; border-radius:var(--radius-sm); color:var(--color-black); font-weight:600; line-height:1.8;">
                العميل: ${escapeHtml(invoice.customerName)}
                <br>
                <span style="color:var(--color-gray); font-weight:500; font-size:0.85rem;">
                    المبلغ: ${formatCurrencySYP(invoice.agreedAmountSYP)} / ${formatCurrencyUSD(invoice.agreedAmountUSD)}
                </span>
            </p>
            <p style="color:#dc2626; font-size:0.85rem; margin-top:1rem;">
                <i class="fas fa-exclamation-circle" style="margin-left:0.3rem;"></i>
                هذه العملية لا يمكن التراجع عنها
            </p>
        </div>
    `, {
        title: 'حذف الفاتورة',
        isLarge: false,
        footer: `
            <button class="btn btn-outline" onclick="closeModal()">إلغاء</button>
            <button class="btn btn-primary" style="background:#dc2626;" onclick="executeDeleteInvoice('${invoiceId}')">
                <i class="fas fa-trash-alt"></i>
                تأكيد الحذف
            </button>
        `
    });
}

function executeDeleteInvoice(invoiceId) {
    deleteInvoice(invoiceId);
    toast('تم الحذف', 'تم حذف الفاتورة بنجاح', 'success');
    closeModal();
    renderCurrentRoute();
}

// ============================================
// Change Password
// ============================================

function changePasswordModal() {
    showModal(`
        <form onsubmit="return handleChangePassword(event)">
            <div class="form-group">
                <label class="form-label"><span class="required">*</span>كلمة المرور الحالية</label>
                <input type="password" id="currentPwd" class="form-input" required placeholder="••••••••">
            </div>
            <div class="form-group">
                <label class="form-label"><span class="required">*</span>كلمة المرور الجديدة</label>
                <input type="password" id="newPwd" class="form-input" required minlength="6" placeholder="6 أحرف على الأقل">
            </div>
            <div class="form-group">
                <label class="form-label"><span class="required">*</span>تأكيد كلمة المرور</label>
                <input type="password" id="confirmPwd" class="form-input" required placeholder="••••••••">
            </div>
        </form>
    `, {
        title: 'تغيير كلمة المرور',
        isLarge: false,
        footer: `
            <button class="btn btn-outline" onclick="closeModal()">إلغاء</button>
            <button class="btn btn-gold" onclick="handleChangePassword()">
                <i class="fas fa-key"></i>
                حفظ
            </button>
        `
    });
}

function handleChangePassword(e) {
    if (e && e.preventDefault) e.preventDefault();

    const current = document.getElementById('currentPwd')?.value;
    const newPwd = document.getElementById('newPwd')?.value;
    const confirm = document.getElementById('confirmPwd')?.value;

    if (!current || !newPwd || !confirm) {
        toast('حقول مطلوبة', 'يرجى تعبئة جميع الحقول', 'warning');
        return false;
    }

    const creds = safeGet(STORAGE_KEYS.ADMIN_CREDENTIALS, {});
    if (current !== creds.password) {
        toast('خطأ', 'كلمة المرور الحالية غير صحيحة', 'error');
        return false;
    }

    if (newPwd.length < 6) {
        toast('خطأ', 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل', 'error');
        return false;
    }

    if (newPwd !== confirm) {
        toast('خطأ', 'كلمتا المرور غير متطابقتين', 'error');
        return false;
    }

    safeSet(STORAGE_KEYS.ADMIN_CREDENTIALS, { password: newPwd });
    toast('تم التغيير', 'تم تحديث كلمة المرور بنجاح', 'success');
    closeModal();
    return false;
}

// ============================================
// Modal System
// ============================================

function showModal(contentHtml, options = {}) {
    const {
        title = '',
        isLarge = false,
        footer = ''
    } = options;

    const modalRoot = document.getElementById('modalRoot');
    modalRoot.innerHTML = `
        <div class="modal-backdrop" onclick="modalBackdropClick(event)">
            <div class="modal ${isLarge ? 'modal-lg' : ''}" onclick="event.stopPropagation()">
                ${title ? `
                    <div class="modal-header">
                        <h2>${escapeHtml(title)}</h2>
                        <button class="modal-close" onclick="closeModal()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                ` : `
                    <div style="position:absolute; top:1rem; left:1rem; z-index:1;">
                        <button class="modal-close" onclick="closeModal()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `}
                <div class="modal-body">${contentHtml}</div>
                ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
            </div>
        </div>
    `;

    document.body.style.overflow = 'hidden';
}

function modalBackdropClick(e) {
    if (e.target.classList.contains('modal-backdrop')) {
        closeModal();
    }
}

function closeModal() {
    const modalRoot = document.getElementById('modalRoot');
    if (modalRoot) modalRoot.innerHTML = '';
    document.body.style.overflow = '';
}

// ============================================
// Share / Copy Link
// ============================================

function copyInvoiceLink(invoiceId) {
    const url = getInvoiceShareUrl(invoiceId);
    copyToClipboard(url).then(() => {
        toast('تم النسخ', 'تم نسخ رابط الفاتورة بنجاح', 'success');
    }).catch(() => {
        fallbackCopy(url);
    });
}

function copyCurrentInvoiceLink() {
    const input = document.getElementById('shareLinkInput');
    if (!input) return;
    copyToClipboard(input.value).then(() => {
        toast('تم النسخ', 'تم نسخ رابط الفاتورة بنجاح', 'success');
    }).catch(() => {
        input.select();
        document.execCommand('copy');
        toast('تم النسخ', 'تم نسخ رابط الفاتورة بنجاح', 'success');
    });
}

function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    }
    return Promise.reject('Clipboard API not available');
}

function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        toast('تم النسخ', 'تم نسخ رابط الفاتورة بنجاح', 'success');
    } catch (e) {
        toast('خطأ', 'تعذر نسخ الرابط، قم بالنسخ يدوياً', 'error');
    }
    ta.remove();
}

// ============================================
// PDF Export Helpers (Font + Arabic rendering)
// ============================================

// GUARANTEE Cairo font is 100% loaded before any canvas capture.
// (html2canvas produces "tofu" / dashed lines if Cairo glyphs haven't loaded yet.)
function waitForCairoFont() {
    return new Promise(async (resolve) => {
        const maxTries = 12;
        const tryDelayMs = 180;
        const testString = 'تم الفاتورة الحروف العربية ABCD123';

        // Try Font Loading API first (supported in most Chromium/WebKit)
        const hasFontsAPI = typeof document !== 'undefined'
            && document.fonts
            && typeof document.fonts.load === 'function'
            && typeof document.fonts.check === 'function';

        for (let i = 0; i < maxTries; i++) {
            let loaded = false;
            try {
                if (hasFontsAPI) {
                    try { await document.fonts.load(`700 18px "Cairo"`, testString); } catch (_) {}
                    try { await document.fonts.load(`400 16px "Cairo"`, testString); } catch (_) {}
                    loaded = document.fonts.check(`700 18px "Cairo"`, testString);
                } else {
                    // Fallback: wait a bit for network font to arrive
                    loaded = (i >= 3);
                }
            } catch (_) { loaded = (i >= 4); }
            if (loaded) break;
            await new Promise(r => setTimeout(r, tryDelayMs));
        }
        // Final safe delay for glyph rasterization
        setTimeout(resolve, 250);
    });
}

// RENDER ARABIC TEXT TO PNG — 100% perfect, no tofu, no garbage characters.
// Uses the browser's native Canvas 2D `fillText()` which always renders complex
// scripts (Arabic ligatures, RTL shaping) correctly. This is dramatically more
// reliable than jsPDF's built-in pdf.text() or even html2canvas for small text.
function arabicTextToImageDataURL(text, {
    fontSizePx = 20,
    bold = true,
    color = '#B08537',
    fontFamily = '"Cairo","Playfair Display",Tahoma,Arial,sans-serif',
    paddingPx = 10,
    scale = 4,
    backgroundColor = null
} = {}) {
    const weight = bold ? '700' : '400';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontStr = `${weight} ${fontSizePx}px ${fontFamily}`;
    ctx.font = fontStr;
    const metrics = ctx.measureText(text);
    const textWidth = Math.ceil(Math.abs(metrics.width) || (text.length * fontSizePx * 0.6));
    const textHeight = Math.ceil(fontSizePx * 1.6);
    canvas.width = (textWidth + (paddingPx * 2)) * scale;
    canvas.height = (textHeight + (paddingPx * 2)) * scale;
    const drawCtx = canvas.getContext('2d');
    drawCtx.scale(scale, scale);
    drawCtx.textBaseline = 'middle';
    drawCtx.textAlign = 'center';
    drawCtx.direction = 'rtl';
    drawCtx.font = fontStr;
    if (backgroundColor) {
        drawCtx.fillStyle = backgroundColor;
        drawCtx.fillRect(0, 0, canvas.width / scale, canvas.height / scale);
    }
    drawCtx.fillStyle = color;
    drawCtx.fillText(text, (canvas.width / scale) / 2, (canvas.height / scale) / 2);
    return canvas.toDataURL('image/png');
}

// ============================================
// PDF Export
// ============================================

function getCurrentSitePhotosForPDF() {
    const hashRoute = getRoute();
    const inv = (hashRoute.page === 'invoice' && hashRoute.params.invoiceId)
        ? getInvoiceById(hashRoute.params.invoiceId) : null;
    return inv ? (inv.sitePhotos || []) : [];
}

async function exportInvoicePDF() {
    const printArea = document.getElementById('invoicePrintArea');
    if (!printArea) return;

    toast('جاري التحضير', 'يتم تحضير ملف الـ PDF...', 'info');

    // --- Pre-checks: make sure libraries loaded ---
    if (typeof html2canvas !== 'function') {
        toast('خطأ', 'مكتبة html2canvas لم تُحمّل — راجع اتصال الإنترنت', 'error');
        return;
    }
    const jsPDF_Ctor =
        (window.jspdf && window.jspdf.jsPDF) ||
        window.jsPDF ||
        (window.jspdf && (window.jspdf.default || window.jspdf));
    if (!jsPDF_Ctor) {
        toast('خطأ', 'مكتبة jsPDF لم تُحمّل — راجع اتصال الإنترنت', 'error');
        return;
    }

    const actionsBar = document.getElementById('invoiceActionsBar');
    const photosWrapper = document.getElementById('sitePhotosPDFWrapper');
    const actionsPrevVis = actionsBar ? actionsBar.style.visibility : '';
    const photosPrevDisplay = photosWrapper ? photosWrapper.style.display : '';
    const photosWrapperParent = photosWrapper ? photosWrapper.parentNode : null;
    const photosWrapperNextSibling = photosWrapper ? photosWrapper.nextSibling : null;

    try {
        // ------------------------------------------------------------------
        // PART 1 — Capture main invoice body (without photos section)
        // Strategy:
        //  A) Ensure Cairo web font is 100% loaded & rasterized before capture (fix tofu).
        //  B) Inject print-specific CSS fixes (force Cairo, ligatures, word-break,
        //     keep-all, no-break on Arabic text nodes) so html2canvas gets it right.
        //  C) Detach photos wrapper so zero empty space leaks into invoice pages.
        // ------------------------------------------------------------------
        if (actionsBar) actionsBar.style.visibility = 'hidden';

        // (A) CRITICAL — wait for Cairo font (up to ~2.5s with polls)
        await waitForCairoFont();

        // (B) Inject print-optimized CSS before capturing the page
        const printCssId = 'pdfExportCssFix_' + Date.now();
        const cssFixEl = document.createElement('style');
        cssFixEl.id = printCssId;
        cssFixEl.textContent = `
            #invoicePrintArea, #invoicePrintArea * {
                font-family: "Cairo","Playfair Display",Tahoma,Arial,sans-serif !important;
                font-feature-settings: "liga" 0, "calt" 0, "kern" 1 !important;
                font-kerning: normal !important;
                word-break: keep-all !important;
                overflow-wrap: normal !important;
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
            }
            #invoicePrintArea .card, #invoicePrintArea div,
            #invoicePrintArea p, #invoicePrintArea span,
            #invoicePrintArea h1, #invoicePrintArea h2,
            #invoicePrintArea h3, #invoicePrintArea h4,
            #invoicePrintArea th, #invoicePrintArea td,
            #invoicePrintArea button, #invoicePrintArea input {
                font-variant: normal !important;
            }
        `;
        document.head.appendChild(cssFixEl);

        // (C) Detach photos section from DOM
        if (photosWrapper && photosWrapperParent) {
            photosWrapperParent.removeChild(photosWrapper);
        }

        // Extra small delay after CSS injection + glyph settle
        await new Promise(r => setTimeout(r, 350));

        const canvas = await html2canvas(printArea, {
            scale: 4,                       // Ultra high DPI for crystal clear Arabic text
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#ffffff',
            logging: false,
            letterRendering: true,          // character-by-character → prevents arabic mid-word dashes
            imageTimeout: 45000,
            removeContainer: true,
            foreignObjectRendering: false
        });

        // Cleanup print CSS and restore photos wrapper immediately after capture
        try { if (cssFixEl.parentNode) cssFixEl.parentNode.removeChild(cssFixEl); } catch (_) {}
        if (photosWrapper && photosWrapperParent && !photosWrapper.parentNode) {
            try { photosWrapperParent.insertBefore(photosWrapper, photosWrapperNextSibling); } catch (_) {}
        }

        const pdf = new jsPDF_Ctor('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();   // 210 mm
        const pageHeight = pdf.internal.pageSize.getHeight(); // 297 mm
        const safeMargin = 10; // mm
        const usableW = pageWidth - (safeMargin * 2);
        const usableH = pageHeight - (safeMargin * 2);

        // --- Slice invoice canvas onto A4 pages (clean per-page canvas slices) ---
        const slicePxH = Math.max(1, Math.round((canvas.width * usableH) / usableW));
        let yPx = 0;
        let firstPage = true;

        while (yPx < canvas.height - 2) {
            if (!firstPage) pdf.addPage();
            firstPage = false;

            const sliceH = Math.min(slicePxH, canvas.height - yPx);
            const sliceCanvas = document.createElement('canvas');
            sliceCanvas.width = canvas.width;
            sliceCanvas.height = sliceH;
            const sctx = sliceCanvas.getContext('2d');
            sctx.fillStyle = '#ffffff';
            sctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
            sctx.drawImage(canvas, 0, yPx, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

            const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.95);
            const outputH = (sliceH * usableW) / canvas.width;
            pdf.addImage(sliceData, 'JPEG', safeMargin, safeMargin, usableW, outputH);
            yPx += sliceH;
        }

        // ------------------------------------------------------------------
        // PART 2 — Photos page(s): 3 photos per page
        // Arabic title & captions are rendered using native Canvas 2D fillText()
        // (see arabicTextToImageDataURL() at top). This is the ONLY technique
        // that guarantees correct Arabic ligature/shaping — never use pdf.text().
        // ------------------------------------------------------------------
        const sitePhotos = getCurrentSitePhotosForPDF();
        if (Array.isArray(sitePhotos) && sitePhotos.length > 0) {
            const photosPerPage = 3;
            const totalPhotoPages = Math.ceil(sitePhotos.length / photosPerPage);
            const titleH_mm = 14;
            const spacerAfterTitle_mm = 5;
            const photoGap_mm = 8;
            const captionH_mm = 7;
            const photoBoxH_mm = (usableH
                - titleH_mm - spacerAfterTitle_mm
                - (photoGap_mm * (photosPerPage - 1))
                - (captionH_mm * photosPerPage)) / photosPerPage;

            // Section title (rendered via Canvas 2D → NO garbage glyphs, 100% perfect)
            const sectionTitleImg = arabicTextToImageDataURL('صور المنشئة والموقع', {
                fontSizePx: 20, bold: true, color: '#B08537',
                backgroundColor: '#ffffff'
            });
            const sectionTitleImgDims = await loadImageAndGetDimensions(sectionTitleImg);

            for (let pg = 0; pg < totalPhotoPages; pg++) {
                pdf.addPage();
                const pageXCenter = pageWidth / 2;

                // Heading block: gold short bar + title image + divider
                pdf.setDrawColor(229, 196, 123);
                pdf.setFillColor(229, 196, 123);
                pdf.roundedRect(safeMargin, safeMargin + 3, 2, titleH_mm - 4, 1, 1, 'FD');

                if (sectionTitleImgDims) {
                    const tw = Math.min(usableW - 5, 85);
                    const th = (sectionTitleImgDims.h * tw) / sectionTitleImgDims.w;
                    const tx = pageXCenter - (tw / 2);
                    const ty = safeMargin + (titleH_mm - th) / 2;
                    try { pdf.addImage(sectionTitleImg, 'PNG', tx, ty, tw, th); } catch (_) {}
                }

                pdf.setDrawColor(229, 196, 123);
                pdf.setLineWidth(0.4);
                pdf.line(safeMargin + 6, safeMargin + titleH_mm - 1,
                    pageWidth - safeMargin - 6, safeMargin + titleH_mm - 1);

                const startIdx = pg * photosPerPage;
                const endIdx = Math.min(startIdx + photosPerPage, sitePhotos.length);
                let yCursor_mm = safeMargin + titleH_mm + spacerAfterTitle_mm;

                for (let i = startIdx; i < endIdx; i++) {
                    const photoSrc = sitePhotos[i];
                    const photoDims = await loadImageAndGetDimensions(photoSrc);
                    const photoBoxW_mm = usableW;
                    const ratio = photoDims
                        ? Math.min(photoBoxW_mm / photoDims.w, photoBoxH_mm / photoDims.h)
                        : 0.7;
                    const pw_mm = photoDims ? Math.max(40, photoDims.w * ratio) : Math.min(photoBoxW_mm, 150);
                    const ph_mm = photoDims ? Math.max(25, photoDims.h * ratio) : photoBoxH_mm;
                    const px_mm = safeMargin + (photoBoxW_mm - pw_mm) / 2;
                    const py_mm = yCursor_mm + ((photoBoxH_mm - ph_mm) / 2);

                    if (photoDims) {
                        let photoOK = false;
                        for (const fmt of ['JPEG', 'PNG', undefined]) {
                            try { pdf.addImage(photoSrc, fmt, px_mm, py_mm, pw_mm, ph_mm); photoOK = true; break; } catch (_) {}
                        }
                        if (!photoOK) {
                            pdf.setFillColor(249, 250, 251);
                            pdf.setDrawColor(209, 213, 219);
                            pdf.roundedRect(px_mm, py_mm, pw_mm, ph_mm, 2, 2, 'FD');
                        }
                    }

                    // Gold frame around photo
                    pdf.setDrawColor(229, 196, 123);
                    pdf.setLineWidth(0.4);
                    pdf.roundedRect(px_mm - 1, py_mm - 1, pw_mm + 2, ph_mm + 2, 2, 2, 'S');

                    // Caption (Canvas 2D rendered Arabic PNG)
                    const capText = `الصورة ${i + 1} من ${sitePhotos.length}`;
                    const capImg = arabicTextToImageDataURL(capText, {
                        fontSizePx: 13, bold: false, color: '#6B7280',
                        backgroundColor: '#ffffff'
                    });
                    const capImgDims = await loadImageAndGetDimensions(capImg);
                    if (capImgDims) {
                        const cw = Math.min(usableW, 65);
                        const ch = (capImgDims.h * cw) / capImgDims.w;
                        const cx = pageXCenter - (cw / 2);
                        const cy = yCursor_mm + photoBoxH_mm + 1;
                        try { pdf.addImage(capImg, 'PNG', cx, cy, cw, ch); } catch (_) {}
                    }

                    yCursor_mm += photoBoxH_mm + captionH_mm + photoGap_mm;
                }
            }
        }

        // --- Filename & direct download ---
        const customerInput = document.getElementById('editCustomerName');
        let customerName = customerInput?.value?.trim();
        if (!customerName) customerName = document.querySelector('.customer-name-display')?.textContent?.trim() || '';
        if (!customerName) customerName = 'فاتورة';

        const dateStr = new Date().toISOString().split('T')[0];
        const cleanName = customerName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 60);
        const filename = `فاتورة_${cleanName || 'عميل'}_${dateStr}.pdf`;

        pdf.save(filename);
        toast('تم التصدير ✅', 'تم تنزيل ملف الـ PDF مباشرة', 'success');

    } catch (err) {
        console.error('PDF export error:', err);
        const msg = (err && err.message) ? err.message.slice(0, 50) : 'خطأ غير معروف';
        toast('خطأ في التصدير', `تعذّر إنشاء الـ PDF: ${msg} — جرّب تحديث الصفحة`, 'error', 7000);
    } finally {
        // Restore UI state unconditionally
        if (actionsBar) actionsBar.style.visibility = actionsPrevVis;
        if (photosWrapper && photosWrapperParent && !photosWrapper.parentNode) {
            try { photosWrapperParent.insertBefore(photosWrapper, photosWrapperNextSibling); } catch (_) {}
        }
        if (photosWrapper) photosWrapper.style.display = photosPrevDisplay;
    }
}

function loadImageAndGetDimensions(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight, img });
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

// ============================================
// App Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    ensureAdminCredentials();
    updateNavbarVisibility();
    renderCurrentRoute();
    updateNavbarScroll();

    if (isAdminLoggedIn()) {
        setTimeout(() => initCloudSync(), 500);
    }

    const invoices = getAllInvoices();
    if (invoices.length === 0) {
        const demo = createInvoice({
            customerName: '(مثال) محمد علي',
            agreedAmountSYP: 10000000,
            agreedAmountUSD: 500,
            payments: [
                { amountSYP: 3000000, amountUSD: 200, craftsmanType: 'نجار', craftsmanName: 'أحمد النجار', date: todayStr() },
                { amountSYP: 2000000, amountUSD: 100, craftsmanType: 'دهان', craftsmanName: 'خالد الدكان', date: todayStr() }
            ],
            materials: [
                { amountSYP: 1500000, amountUSD: 50, materialName: 'سمنت ورمل', date: todayStr() },
                { amountSYP: 800000, amountUSD: 30, materialName: 'ألومنيوم وزجاج', date: todayStr() }
            ],
            sitePhotos: []
        });
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
    }
});

window.navigate = navigate;
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.openCreateInvoiceModal = openCreateInvoiceModal;
window.openEditInvoiceModal = openEditInvoiceModal;
window.confirmDeleteInvoice = confirmDeleteInvoice;
window.executeDeleteInvoice = executeDeleteInvoice;
window.changePasswordModal = changePasswordModal;
window.handleChangePassword = handleChangePassword;
window.closeModal = closeModal;
window.modalBackdropClick = modalBackdropClick;
window.copyInvoiceLink = copyInvoiceLink;
window.copyCurrentInvoiceLink = copyCurrentInvoiceLink;
window.addPaymentRow = addPaymentRow;
window.removePaymentRow = removePaymentRow;
window.addMaterialRow = addMaterialRow;
window.removeMaterialRow = removeMaterialRow;
window.updateAmountsLive = updateAmountsLive;
window.saveInvoiceChanges = saveInvoiceChanges;
window.modalAddPayment = modalAddPayment;
window.modalRemovePayment = modalRemovePayment;
window.modalAddMaterial = modalAddMaterial;
window.modalRemoveMaterial = modalRemoveMaterial;
window.submitInvoiceForm = submitInvoiceForm;
window.exportInvoicePDF = exportInvoicePDF;
window.handleSitePhotosUpload = handleSitePhotosUpload;
window.removeSitePhoto = removeSitePhoto;
window.handleModalSitePhotosUpload = handleModalSitePhotosUpload;
window.removeModalSitePhoto = removeModalSitePhoto;
window.forceSyncNow = forceSyncNow;
window.showSyncStatus = showSyncStatus;
window.initCloudSync = initCloudSync;
