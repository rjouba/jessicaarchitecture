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
    WORKERS: 'jk_workers',
    PROFESSIONS: 'jk_professions'
};

const DEFAULT_PROFESSIONS = [
    { id: 'p_najjar',    name: 'النجار',         order: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'p_hajar',     name: 'معلم الحجر',    order: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'p_alum',      name: 'الالمنيوم',      order: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'p_dehan',     name: 'الدهان',         order: 4, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'p_keh',       name: 'الكهربائي',      order: 5, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'p_sehhi',     name: 'الصحية',         order: 6, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'p_rikham',    name: 'منشرة الرخام',   order: 7, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'p_nattur',    name: 'الناطور',        order: 8, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'p_sabb',      name: 'معلم الصب',      order: 9, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
];

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
let SYNC_INITIALIZED = false;
let LAST_SYNC_STATUS = 'جارِ التحقق من الاتصال بالسحابة...';
let POLLING_HANDLE = null;
let LAST_POLL_TS = { invoices: 0, workers: 0, professions: 0 };

function getFirestoreBase() {
    const pid = (FIREBASE_CONFIG && FIREBASE_CONFIG.projectId) || '';
    if (!pid || pid === 'PASTE_YOUR_PROJECT_ID') return null;
    return `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents`;
}

function docPath(col, doc) {
    return `${getFirestoreBase()}/${col}/${doc}`;
}

function apiKeyParam() {
    const k = (FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey) || '';
    if (!k || k === 'PASTE_YOUR_API_KEY') return '';
    return `?key=${encodeURIComponent(k)}`;
}

function firebaseConfigValid() {
    const base = getFirestoreBase();
    const key = FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey;
    return !!(base && key && key.length > 10 && key !== 'PASTE_YOUR_API_KEY');
}

function jsonToFields(value) {
    if (value === null || value === undefined) return { nullValue: null };
    const t = typeof value;
    if (t === 'boolean') return { booleanValue: value };
    if (t === 'number') {
        if (Number.isInteger(value)) return { integerValue: String(value) };
        return { doubleValue: value };
    }
    if (t === 'string') return { stringValue: value };
    if (value instanceof Date) return { timestampValue: value.toISOString() };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(jsonToFields) } };
    if (t === 'object') {
        const fields = {};
        Object.keys(value).forEach(k => { fields[k] = jsonToFields(value[k]); });
        return { mapValue: { fields } };
    }
    return { stringValue: String(value) };
}

function fieldsToJson(fields) {
    if (!fields || typeof fields !== 'object') return null;
    const keys = Object.keys(fields);
    if (!keys.length) return null;
    const firstKey = keys[0];
    const val = fields[firstKey];
    switch (firstKey) {
        case 'nullValue': return null;
        case 'booleanValue': return !!val;
        case 'integerValue': return Number(val);
        case 'doubleValue': return Number(val);
        case 'stringValue': return String(val);
        case 'timestampValue': return new Date(val).getTime();
        case 'bytesValue': return String(val);
        case 'referenceValue': return String(val);
        case 'geoPointValue': return val;
        case 'arrayValue': {
            if (!val || !Array.isArray(val.values)) return [];
            return val.values.map(item => fieldsToJson(item));
        }
        case 'mapValue': {
            if (!val || !val.fields || typeof val.fields !== 'object') return {};
            const out = {};
            Object.keys(val.fields).forEach(k => { out[k] = fieldsToJson(val.fields[k]); });
            return out;
        }
        default: return null;
    }
}

async function cloudWrite(collection, docId, payload) {
    if (!firebaseConfigValid()) return false;
    try {
        const wrapper = {
            data: payload,
            updatedAt: Date.now()
        };
        const encodedAll = jsonToFields(wrapper);
        const body = { fields: encodedAll.mapValue.fields };
        const allKeys = Object.keys(body.fields || {});
        const updateParam = allKeys.length
            ? '&' + allKeys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&')
            : '';
        const url = docPath(collection, docId) + apiKeyParam() + updateParam;
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            let errText = '';
            try { errText = await res.text(); } catch {}
            if (res.status === 403 || res.status === 401 || (errText && errText.includes('PERMISSION_DENIED'))) {
                LAST_SYNC_STATUS = '🚫 مرفوض من Rules — انشر قواعد Firebase ثم اضغط مزامنة فورية';
            } else {
                LAST_SYNC_STATUS = `❌ فشل الكتابة للسحابة (HTTP ${res.status})`;
            }
            console.warn('Firestore REST write error:', res.status, (errText || '').slice(0, 200));
            return false;
        }
        if (!FIREBASE_ENABLED) FIREBASE_ENABLED = true;
        return true;
    } catch (e) {
        console.warn('Cloud write REST failed:', e);
        LAST_SYNC_STATUS = '❌ فشل الكتابة للسحابة: ' + (e.message || String(e)).slice(0, 80);
        return false;
    }
}

async function cloudRead(collection, docId) {
    if (!firebaseConfigValid()) return { ok: false };
    try {
        const url = docPath(collection, docId) + apiKeyParam();
        const res = await fetch(url, { method: 'GET' });
        if (res.status === 404) return { ok: true, empty: true };
        if (!res.ok) {
            if (res.status === 403) LAST_SYNC_STATUS = '🚫 مرفوض من Rules — انشر قواعد Firebase';
            const errText = await res.text().catch(() => '');
            console.warn('Firestore REST read error:', res.status, errText.slice(0, 200));
            return { ok: false, status: res.status };
        }
        const doc = await res.json();
        if (!doc || !doc.fields) return { ok: true, empty: true };
        const parsed = fieldsToJson({ mapValue: { fields: doc.fields || {} } }) || {};
        const dataArr = parsed.data;
        const updatedAt = Number(parsed.updatedAt || 0);
        return { ok: true, data: Array.isArray(dataArr) ? dataArr : null, updatedAt };
    } catch (e) {
        console.warn('Cloud read REST failed:', e);
        return { ok: false };
    }
}

async function cloudDelete(collection, docId) {
    if (!firebaseConfigValid()) return false;
    try {
        const url = docPath(collection, docId) + apiKeyParam();
        const res = await fetch(url, { method: 'DELETE' });
        if (res.status === 404) return true; // already gone
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.warn('Firestore REST delete error:', res.status, errText.slice(0, 200));
            return false;
        }
        return true;
    } catch (e) {
        console.warn('Cloud delete REST failed:', e);
        return false;
    }
}

async function testFirebaseWrite() {
    if (!firebaseConfigValid()) {
        LAST_SYNC_STATUS = '⚠️ إعدادات Firebase غير مكتملة — apiKey أو projectId مفقود';
        FIREBASE_ENABLED = false;
        return false;
    }
    try {
        const url = docPath('app_data', 'ping_test') + apiKeyParam();
        const body = { fields: { t: { integerValue: String(Date.now()) } } };
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            let txt = '';
            try { txt = await res.text(); } catch {}
            if (res.status === 403 || res.status === 401 || (txt && txt.includes('PERMISSION_DENIED'))) {
                LAST_SYNC_STATUS = '🚫 مرفوض من قواعد السحابة (Rules) — انشر قواعد Firebase ثم اضغط مزامنة فورية';
            } else if (res.status >= 400 && res.status < 500) {
                let detail = 'تأكد من أن Firestore مهيأ وأن القواعد منشورة';
                try {
                    const j = JSON.parse(txt || '{}');
                    if (j && j.error && j.error.message) detail = j.error.message.slice(0, 120);
                } catch {}
                LAST_SYNC_STATUS = `❌ فشل إعداد السحابة (HTTP ${res.status}) — ${detail}`;
            } else {
                LAST_SYNC_STATUS = `❌ خادم السحابة غير متاح (HTTP ${res.status})`;
            }
            FIREBASE_ENABLED = false;
            return false;
        }
        FIREBASE_ENABLED = true;
        return true;
    } catch (e) {
        LAST_SYNC_STATUS = '❌ فشل فحص الاتصال: ' + (e.message || String(e)).slice(0, 80);
        FIREBASE_ENABLED = false;
        return false;
    }
}

async function initializeFirebaseSync(onReady) {
    setTimeout(async () => {
        if (!firebaseConfigValid()) {
            LAST_SYNC_STATUS = '⚠️ إعدادات Firebase فارغة أو غير صحيحة';
            if (onReady) onReady(false);
            return;
        }
        const ok = await testFirebaseWrite();
        if (ok) LAST_SYNC_STATUS = '✅ متصل بالسحابة (Firebase Firestore REST)';
        if (onReady) onReady(!!ok);
    }, 50);
}

function showSyncStatus() {
    const invCount = safeGet(STORAGE_KEYS.INVOICES, []).length;
    const wrkCount = safeGet(STORAGE_KEYS.WORKERS, []).length;
    const pid = FIREBASE_CONFIG.projectId || 'غير محدد';
    const lastAuto = LAST_POLL_TS.lastAutoSync ? new Date(LAST_POLL_TS.lastAutoSync).toLocaleTimeString('ar-EG') : 'لم تتم بعد';
    const lines = [
        `الحالة: ${LAST_SYNC_STATUS}`,
        `Firebase Project ID: ${pid}`,
        `Firebase مهيأ: ${FIREBASE_ENABLED ? 'نعم ✅' : 'لا ❌'}`,
        `🔄 المزامنة التلقائية كل 5 دقائق: ${SYNC_INITIALIZED ? 'مفعل ✅' : 'غير مفعل ❌'}`,
        `⏰ آخر مزامنة تلقائية: ${lastAuto}`,
        `عدد الفواتير محلياً: ${invCount}`,
        `عدد العمال محلياً: ${wrkCount}`
    ];
    toast('⚙️ حالة مزامنة السحابة', lines.join('\n'), 'info');
}

function mergeArraysById(a, b) {
    const arrA = Array.isArray(a) ? a : [];
    const arrB = Array.isArray(b) ? b : [];
    const map = new Map();
    const ts = (x) => Number(x && (x.updatedAt || x.createdAt || x.lastModified || (x.deletedAt ? Number(x.deletedAt) : 0))) || 0;
    const isTombstone = (x) => !!(x && (x.__tombstone || x.deletedAt));
    const arrayMaxTs = (arr) => arr.reduce((m, x) => Math.max(m, ts(x)), 0);
    const setMaxTs = (arr, stamp) => {
        if (stamp <= 0) return arr;
        return arr.map(x => ({ ...x, updatedAt: ts(x) >= stamp ? (x.updatedAt || new Date(stamp).toISOString()) : new Date(stamp).toISOString() }));
    };
    const tA = arrayMaxTs(arrA);
    const tB = arrayMaxTs(arrB);
    const DIFF_THRESHOLD_MS = 3000; // أكثر من 3 ثواني فرق = الجهاز الأحدث يفوز كلياً (حتى لو كان أصغر = حذف)
    const absDiff = Math.abs(tA - tB);
    if (absDiff > DIFF_THRESHOLD_MS) {
        const tNewer = Math.max(tA, tB);
        const newerArr = tA > tB ? arrA : arrB;
        return setMaxTs(newerArr, tNewer).sort((x, y) => ts(y) - ts(x));
    }
    for (const item of arrA) {
        if (item && item.id) map.set(String(item.id), { ...item });
    }
    for (const item of arrB) {
        if (!item || !item.id) continue;
        const key = String(item.id);
        const existing = map.get(key);
        if (!existing) {
            map.set(key, { ...item });
        } else {
            const tAi = ts(existing);
            const tBi = ts(item);
            if (tBi > tAi) {
                map.set(key, { ...item });
            } else {
                map.set(key, { ...existing, ...item, id: existing.id });
            }
        }
    }
    // 🪦 TOMBSTONES: أي سجل عنده deletedAt أو __tombstone → احذفه نهائياً من النتيجة
    // (السحابة أكّدت الحذف، أو الحذف من نفس الجهاز وصلت للسحابة)
    const final = Array.from(map.values()).filter(item => !isTombstone(item));
    return final.sort((x, y) => ts(y) - ts(x));
}

async function forceSyncNow(showToast = true) {
    if (!firebaseConfigValid()) {
        if (showToast) toast('❌ إعدادات Firebase مفقودة', LAST_SYNC_STATUS || 'تحقق من FIREBASE_CONFIG', 'error');
        return false;
    }
    if (showToast) toast('جاري الاتصال بالسحابة', 'جاري فحص قواعد السحابة ودمج البيانات...', 'info');
    const writeOk = await testFirebaseWrite();
    if (!writeOk) {
        if (showToast) toast('🚫 مرفوض من قواعد السحابة', LAST_SYNC_STATUS + '\nاذهب إلى Firebase → Firestore → Rules وانشر القواعد الصحيحة ثم عد وهنا واضغط مزامنة فورية', 'error');
        return false;
    }
    try {
        const [cloudInvoices, cloudWorkers, cloudProfessions] = await Promise.all([
            cloudRead('app_data', STORAGE_KEYS.INVOICES),
            cloudRead('app_data', STORAGE_KEYS.WORKERS),
            cloudRead('app_data', STORAGE_KEYS.PROFESSIONS)
        ]);
        // 🪦 استخدم Raw versions لنحافظ على tombstones (شواهد الحذف) في الدمج
        const localInvoices = getAllInvoicesRaw();
        const localWorkers = getAllWorkersRaw();
        const localProfessions = getAllProfessionsRaw() || JSON.parse(JSON.stringify(DEFAULT_PROFESSIONS));

        // 🪦 تنظيف tombstones قديمة (> 7 أيام) محلياً قبل الدمج
        const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 أيام
        const cleanTombstones = (arr) => arr.filter(x => {
            if (!x) return false;
            if (x.__tombstone || x.deletedAt) {
                const t = Number(x.deletedAt || x.updatedAt || 0);
                if (t > 0 && (Date.now() - t) > TOMBSTONE_TTL_MS) return false; // قديمة → احذف
                return true; // حديثة → ابقها
            }
            return true;
        });
        const cleanedInvoices = cleanTombstones(localInvoices);
        const cleanedWorkers = cleanTombstones(localWorkers);
        const cleanedProfessions = cleanTombstones(localProfessions);
        if (cleanedInvoices.length !== localInvoices.length) safeSet(STORAGE_KEYS.INVOICES, cleanedInvoices);
        if (cleanedWorkers.length !== localWorkers.length) safeSet(STORAGE_KEYS.WORKERS, cleanedWorkers);
        if (cleanedProfessions.length !== localProfessions.length) safeSet(STORAGE_KEYS.PROFESSIONS, cleanedProfessions);

        // 🪦 ادفع tombstones المحلية الحديثة للسحابة فوراً (قبل الدمج) لتُحذف من كل الأجهزة
        const pushTombstones = async (key, local) => {
            const tombstones = local.filter(x => x && (x.__tombstone || x.deletedAt));
            if (tombstones.length > 0) {
                await cloudWrite('app_data', key, local);
            }
        };
        await Promise.all([
            pushTombstones(STORAGE_KEYS.INVOICES, cleanedInvoices),
            pushTombstones(STORAGE_KEYS.WORKERS, cleanedWorkers),
            pushTombstones(STORAGE_KEYS.PROFESSIONS, cleanedProfessions)
        ]);

        // الآن ندمج — mergeArraysById يحذف tombstones تلقائياً
        const mergedInvoices = mergeArraysById(cleanedInvoices, cloudInvoices.data || []);
        const mergedWorkers = mergeArraysById(cleanedWorkers, cloudWorkers.data || []);
        let mergedProfessions = mergeArraysById(cleanedProfessions, cloudProfessions.data || []);
        // 🔥 HARD GUARANTEE — إذا كانت نتيجة الدمج للمهن فارغة والـ DEFAULT موجودة → نستعيد الـ DEFAULT ولا نسمح بمصفوفة فارغة أبداً
        if ((!mergedProfessions || !Array.isArray(mergedProfessions) || mergedProfessions.length === 0) && Array.isArray(DEFAULT_PROFESSIONS) && DEFAULT_PROFESSIONS.length > 0) {
            console.warn('%c⚠️ [FORCE SYNC] mergedProfessions was EMPTY after merge → overriding with DEFAULT_PROFESSIONS to avoid data loss!', 'background:#fd7e14;color:#fff;font-weight:bold;');
            mergedProfessions = JSON.parse(JSON.stringify(DEFAULT_PROFESSIONS));
        }
        // #region debug-point forceSyncNow-professions
        console.group('%c🔄 [DEBUG SYNC] forceSyncNow — Professions merge summary', 'background:#e2e3e5;color:#383d41;font-weight:bold;');
        console.log('localProfessions count (before):', Array.isArray(cleanedProfessions) ? cleanedProfessions.length : 'N/A');
        console.log('cloudProfessions.data count (cloud):', (cloudProfessions.ok && Array.isArray(cloudProfessions.data)) ? cloudProfessions.data.length : 'N/A');
        console.log('mergedProfessions count (after):', Array.isArray(mergedProfessions) ? mergedProfessions.length : 'N/A');
        console.groupEnd();
        // #endregion
        const invChanged = JSON.stringify(cleanedInvoices) !== JSON.stringify(mergedInvoices);
        const wrkChanged = JSON.stringify(cleanedWorkers) !== JSON.stringify(mergedWorkers);
        const prfChanged = JSON.stringify(cleanedProfessions) !== JSON.stringify(mergedProfessions);
        const cloudInvEmpty = !cloudInvoices.ok || cloudInvoices.empty || !Array.isArray(cloudInvoices.data) || cloudInvoices.data.length === 0;
        const cloudWrkEmpty = !cloudWorkers.ok || cloudWorkers.empty || !Array.isArray(cloudWorkers.data) || cloudWorkers.data.length === 0;
        const cloudPrfEmpty = !cloudProfessions.ok || cloudProfessions.empty || !Array.isArray(cloudProfessions.data) || cloudProfessions.data.length === 0;
        if (invChanged || cloudInvEmpty) safeSet(STORAGE_KEYS.INVOICES, mergedInvoices);
        if (wrkChanged || cloudWrkEmpty) safeSet(STORAGE_KEYS.WORKERS, mergedWorkers);
        if (prfChanged || cloudPrfEmpty) safeSet(STORAGE_KEYS.PROFESSIONS, mergedProfessions);
        await Promise.all([
            cloudWrite('app_data', STORAGE_KEYS.INVOICES, safeGet(STORAGE_KEYS.INVOICES, [])),
            cloudWrite('app_data', STORAGE_KEYS.WORKERS, safeGet(STORAGE_KEYS.WORKERS, [])),
            cloudWrite('app_data', STORAGE_KEYS.PROFESSIONS, safeGet(STORAGE_KEYS.PROFESSIONS, []))
        ]);
        LAST_POLL_TS.invoices = Date.now();
        LAST_POLL_TS.workers = Date.now();
        LAST_POLL_TS.professions = Date.now();
        const visibleInv = mergedInvoices.filter(i => !(i.__tombstone || i.deletedAt)).length;
        const visibleWrk = mergedWorkers.filter(w => !(w.__tombstone || w.deletedAt)).length;
        const visiblePrf = mergedProfessions.filter(p => !(p.__tombstone || p.deletedAt)).length;
        LAST_SYNC_STATUS = `✅ تمت المزامنة — ${visibleInv} فاتورة + ${visibleWrk} عامل + ${visiblePrf} وظيفة`;
        if (showToast) {
            toast('✅ تمت المزامنة', `${visibleInv} فاتورة + ${visibleWrk} عامل + ${visiblePrf} وظيفة — الحذف تام على جميع الأجهزة 🪦`, 'success');
        }
        try {
            const { page } = getRoute();
            if (['admin', 'invoices', 'workers', 'invoice', 'worker', 'professions'].includes(page)) renderCurrentRoute();
        } catch (e) {}
        if (!SYNC_INITIALIZED) startRealtimeListeners();
        return true;
    } catch (e) {
        console.warn('Force sync error:', e);
        LAST_SYNC_STATUS = '❌ فشلت المزامنة: ' + (e.message || e).toString().slice(0, 80);
        if (showToast) toast('❌ فشلت المزامنة', LAST_SYNC_STATUS, 'error');
        return false;
    }
}

function startRealtimeListeners() {
    if (SYNC_INITIALIZED) return;
    SYNC_INITIALIZED = true;
    if (POLLING_HANDLE) clearInterval(POLLING_HANDLE);
    // كل 5 دقائق: sync كامل push/pull ثنائي الاتجاه
    POLLING_HANDLE = setInterval(async () => {
        if (!FIREBASE_ENABLED) return;
        try {
            const [cloudInvoices, cloudWorkers, cloudProfessions] = await Promise.all([
                cloudRead('app_data', STORAGE_KEYS.INVOICES),
                cloudRead('app_data', STORAGE_KEYS.WORKERS),
                cloudRead('app_data', STORAGE_KEYS.PROFESSIONS)
            ]);
            let changed = false;
            // 🪦 استخدم Raw versions للدمج (لإبقاء tombstones حتى تنتشر)
            if (cloudInvoices.ok && !cloudInvoices.empty && Array.isArray(cloudInvoices.data)) {
                const local = getAllInvoicesRaw();
                const merged = mergeArraysById(local, cloudInvoices.data);
                if (JSON.stringify(local) !== JSON.stringify(merged)) {
                    safeSet(STORAGE_KEYS.INVOICES, merged);
                    changed = true;
                    const { page } = getRoute();
                    if (['admin', 'invoices', 'invoice'].includes(page)) {
                        renderCurrentRoute();
                        toast('📡 تم تحديث البيانات', 'تم استلام تحديث من جهاز آخر — الحذف تام 🪦', 'info');
                    }
                }
            }
            if (cloudWorkers.ok && !cloudWorkers.empty && Array.isArray(cloudWorkers.data)) {
                const local = getAllWorkersRaw();
                const merged = mergeArraysById(local, cloudWorkers.data);
                if (JSON.stringify(local) !== JSON.stringify(merged)) {
                    safeSet(STORAGE_KEYS.WORKERS, merged);
                    changed = true;
                    const { page } = getRoute();
                    if (['admin', 'workers', 'worker'].includes(page)) {
                        renderCurrentRoute();
                        toast('📡 تم تحديث البيانات', 'تم استلام تحديث من جهاز آخر — الحذف تام 🪦', 'info');
                    }
                }
            }
            if (cloudProfessions.ok && !cloudProfessions.empty && Array.isArray(cloudProfessions.data)) {
                const local = getAllProfessionsRaw() || JSON.parse(JSON.stringify(DEFAULT_PROFESSIONS));
                let merged = mergeArraysById(local, cloudProfessions.data);
                if ((!merged || !Array.isArray(merged) || merged.length === 0) && Array.isArray(DEFAULT_PROFESSIONS) && DEFAULT_PROFESSIONS.length > 0) {
                    console.warn('%c⚠️ [AUTO POLL SYNC] merged professions EMPTY → overriding with DEFAULT_PROFESSIONS', 'background:#fd7e14;color:#fff;font-weight:bold;');
                    merged = JSON.parse(JSON.stringify(DEFAULT_PROFESSIONS));
                }
                if (JSON.stringify(local) !== JSON.stringify(merged)) {
                    safeSet(STORAGE_KEYS.PROFESSIONS, merged);
                    changed = true;
                    const { page } = getRoute();
                    if (['admin', 'professions'].includes(page)) {
                        renderCurrentRoute();
                    }
                }
            }
            if (changed) { LAST_POLL_TS.invoices = Date.now(); LAST_POLL_TS.workers = Date.now(); LAST_POLL_TS.professions = Date.now(); }
            LAST_POLL_TS.lastAutoSync = Date.now();
            console.log('🔄 Auto-sync (كل 5 دقائق) مكتمل:', new Date().toLocaleTimeString('ar-EG'));
        } catch (e) {
            console.warn('Poll sync error:', e);
        }
    }, 300000); // 5 دقائق = 300,000 ms
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
            LAST_SYNC_STATUS = `✅ متصل بالسحابة — ${invCount} فاتورة + ${wrkCount} عامل متزامن (REST Polling)`;
            if (ok) toast('☁️ متصل بالسحابة', `${invCount} فاتورة + ${wrkCount} عامل — المزامنة التلقائية مفعلة كل 3 ثواني`, 'success');
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

// آمنة للاستخدام داخل سمات HTML (مثل value="...") — تستعمل escapeHtml نفس منطقها
function escapeAttr(str) {
    return escapeHtml(str);
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
    if (!Array.isArray(inv.clientPayments)) inv.clientPayments = [];
    // ===== Retrocompat: نقل old top-level payments (الحرفيين القديمة) إلى nested داخل أولى دفعة مستلمة =====
    const legacyPayments = Array.isArray(inv.payments) ? inv.payments.filter(Boolean) : [];
    // ===== Retrocompat: نقل old top-level materials (المواد القديمة) إلى nested داخل أولى دفعة مستلمة =====
    const legacyMaterials = Array.isArray(inv.materials) ? inv.materials.filter(Boolean) : [];
    const hasLegacy = legacyPayments.length > 0 || legacyMaterials.length > 0;
    if (hasLegacy) {
        let targetCpay = inv.clientPayments.find(cp => (Array.isArray(cp.craftsmen) && cp.craftsmen.length === 0) || (Array.isArray(cp.materials) && cp.materials.length === 0));
        if (!targetCpay && inv.clientPayments.length > 0) targetCpay = inv.clientPayments[0];
        if (!targetCpay) {
            targetCpay = {
                id: generateId('cpay'),
                amountSYP: (legacyPayments.reduce((s, x) => s + (Number(x.amountSYP) || 0), 0)) + (legacyMaterials.reduce((s, x) => s + (Number(x.amountSYP) || 0), 0)),
                amountUSD: (legacyPayments.reduce((s, x) => s + (Number(x.amountUSD) || 0), 0)) + (legacyMaterials.reduce((s, x) => s + (Number(x.amountUSD) || 0), 0)),
                materialName: 'مستلمة محولة من البيانات القديمة',
                date: new Date().toISOString().slice(0, 10),
                craftsmen: [],
                materials: []
            };
            inv.clientPayments.push(targetCpay);
        }
        if (!Array.isArray(targetCpay.craftsmen)) targetCpay.craftsmen = [];
        if (!Array.isArray(targetCpay.materials)) targetCpay.materials = [];
        legacyPayments.forEach(lp => {
            targetCpay.craftsmen.push({
                id: lp.id || generateId('ncraft'),
                amountSYP: Number(lp.amountSYP) || 0,
                amountUSD: Number(lp.amountUSD) || 0,
                craftsmanType: lp.craftsmanType || '',
                craftsmanName: lp.craftsmanName || '',
                description: lp.description || '',
                date: lp.date || new Date().toISOString().slice(0, 10)
            });
        });
        legacyMaterials.forEach(lm => {
            targetCpay.materials.push({
                id: lm.id || generateId('nmat'),
                amountSYP: Number(lm.amountSYP) || 0,
                amountUSD: Number(lm.amountUSD) || 0,
                materialName: lm.materialName || lm.name || '',
                date: lm.date || new Date().toISOString().slice(0, 10)
            });
        });
        delete inv.payments;
        delete inv.materials;
        changed = true;
    }
    // التأكد من أن كل دفعة لديها craftsmen + materials كمصفوفات (حتى الفارغة)
    inv.clientPayments = inv.clientPayments.map(cp => {
        let c = { ...cp };
        let innerChanged = false;
        if (!Array.isArray(c.craftsmen)) { c.craftsmen = []; innerChanged = true; }
        if (!Array.isArray(c.materials)) { c.materials = []; innerChanged = true; }
        if (innerChanged) changed = true;
        return c;
    });
    if (!Array.isArray(inv.sitePhotos)) {
        inv.sitePhotos = [];
        changed = true;
    }
    return inv;
}

function getAllInvoices() {
    // تصفية الـ tombstones (السجلات المحذوفة) — لا تظهر في الواجهة
    return getAllInvoicesRaw().filter(inv => !(inv && (inv.__tombstone || inv.deletedAt)));
}

function getAllInvoicesRaw() {
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
    // مزامنة فورية للسحابة (بدون setTimeout — ننتظر الرد) + إعادة المحاولة 3 مرات
    (async () => {
        if (!(FIREBASE_ENABLED || firebaseConfigValid())) return;
        for (let i = 0; i < 3; i++) {
            const ok = await cloudWrite('app_data', STORAGE_KEYS.INVOICES, invoices);
            if (ok) break;
            await new Promise(r => setTimeout(r, 200 * (i + 1)));
        }
    })();
}

function getInvoiceById(id) {
    return getAllInvoices().find(inv => inv.id === id) || null;
}

function createInvoice(data) {
    const invoices = getAllInvoices();

    // 1. إعداد clientPayments مع nested craftsmen/materials لكل دفعة
    let clientPayments = Array.isArray(data.clientPayments) ? [...data.clientPayments] : [];
    clientPayments = clientPayments.map(cp => ({
        id: cp.id || generateId('cpay'),
        amountSYP: Number(cp.amountSYP) || 0,
        amountUSD: Number(cp.amountUSD) || 0,
        materialName: cp.materialName || '',
        note: cp.note || '',
        date: cp.date || todayStr(),
        craftsmen: Array.isArray(cp.craftsmen) ? cp.craftsmen.map(c => ({
            id: c.id || generateId('ncraft'),
            amountSYP: Number(c.amountSYP) || 0,
            amountUSD: Number(c.amountUSD) || 0,
            craftsmanType: c.craftsmanType || '',
            craftsmanName: c.craftsmanName || '',
            description: c.description || '',
            date: c.date || todayStr()
        })) : [],
        materials: Array.isArray(cp.materials) ? cp.materials.map(m => ({
            id: m.id || generateId('nmat'),
            amountSYP: Number(m.amountSYP) || 0,
            amountUSD: Number(m.amountUSD) || 0,
            materialName: m.materialName || '',
            date: m.date || todayStr()
        })) : []
    }));

    // 2. Retrocompat: إذا جاءت payments (الحرفيين) بشكل flat مستقل → ندمجها داخل أولى clientPayment
    const flatPayments = Array.isArray(data.payments) ? data.payments : [];
    const flatMaterials = Array.isArray(data.materials) ? data.materials : [];
    if (flatPayments.length > 0 || flatMaterials.length > 0) {
        if (clientPayments.length === 0) {
            clientPayments.push({
                id: generateId('cpay'),
                amountSYP: 0,
                amountUSD: 0,
                materialName: '',
                note: '',
                date: todayStr(),
                craftsmen: [],
                materials: []
            });
        }
        const target = clientPayments[0];
        flatPayments.forEach(p => {
            target.craftsmen.push({
                id: p.id || generateId('ncraft'),
                amountSYP: Number(p.amountSYP) || 0,
                amountUSD: Number(p.amountUSD) || 0,
                craftsmanType: p.craftsmanType || '',
                craftsmanName: p.craftsmanName || '',
                description: p.description || '',
                date: p.date || todayStr()
            });
        });
        flatMaterials.forEach(m => {
            target.materials.push({
                id: m.id || generateId('nmat'),
                amountSYP: Number(m.amountSYP) || 0,
                amountUSD: Number(m.amountUSD) || 0,
                materialName: m.materialName || '',
                date: m.date || todayStr()
            });
        });
    }

    const newInvoice = {
        id: generateId(),
        customerName: data.customerName || '',
        agreedAmountSYP: Number(data.agreedAmountSYP) || 0,
        agreedAmountUSD: Number(data.agreedAmountUSD) || 0,
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        clientPayments,
        payments: [],  // تفريغ نهائي للمصفوفة القديمة
        materials: [], // تفريغ نهائي للمصفوفة القديمة
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

    // ===== clientPayments مع nested craftsmen/materials =====
    if (updates.clientPayments !== undefined) {
        inv.clientPayments = updates.clientPayments.map(cp => {
            const base = cp.id ? { ...cp } : { id: generateId('cpay') };
            return {
                ...base,
                id: base.id,
                amountSYP: Number(cp.amountSYP) || 0,
                amountUSD: Number(cp.amountUSD) || 0,
                materialName: cp.materialName || '',
                note: cp.note || '',
                date: cp.date || todayStr(),
                craftsmen: Array.isArray(cp.craftsmen) ? cp.craftsmen.map(c => ({
                    id: c.id || generateId('ncraft'),
                    amountSYP: Number(c.amountSYP) || 0,
                    amountUSD: Number(c.amountUSD) || 0,
                    craftsmanType: c.craftsmanType || '',
                    craftsmanName: c.craftsmanName || '',
                    description: c.description || '',
                    date: c.date || todayStr()
                })) : (Array.isArray(base.craftsmen) ? base.craftsmen : []),
                materials: Array.isArray(cp.materials) ? cp.materials.map(m => ({
                    id: m.id || generateId('nmat'),
                    amountSYP: Number(m.amountSYP) || 0,
                    amountUSD: Number(m.amountUSD) || 0,
                    materialName: m.materialName || '',
                    date: m.date || todayStr()
                })) : (Array.isArray(base.materials) ? base.materials : [])
            };
        });
    }

    // ===== Retrocompat: flat payments + flat materials → دمجها في أولى clientPayment =====
    const flatPayments = Array.isArray(updates.payments) ? updates.payments : null;
    const flatMaterials = Array.isArray(updates.materials) ? updates.materials : null;

    if (flatPayments || flatMaterials) {
        if (!Array.isArray(inv.clientPayments)) inv.clientPayments = [];
        if (inv.clientPayments.length === 0) {
            inv.clientPayments.push({
                id: generateId('cpay'),
                amountSYP: 0,
                amountUSD: 0,
                materialName: '',
                note: '',
                date: todayStr(),
                craftsmen: [],
                materials: []
            });
        }
        const target = inv.clientPayments[0];
        if (!Array.isArray(target.craftsmen)) target.craftsmen = [];
        if (!Array.isArray(target.materials)) target.materials = [];
        if (flatPayments) {
            flatPayments.forEach(p => {
                target.craftsmen.push({
                    id: p.id || generateId('ncraft'),
                    amountSYP: Number(p.amountSYP) || 0,
                    amountUSD: Number(p.amountUSD) || 0,
                    craftsmanType: p.craftsmanType || '',
                    craftsmanName: p.craftsmanName || '',
                    description: p.description || '',
                    date: p.date || todayStr()
                });
            });
        }
        if (flatMaterials) {
            flatMaterials.forEach(m => {
                target.materials.push({
                    id: m.id || generateId('nmat'),
                    amountSYP: Number(m.amountSYP) || 0,
                    amountUSD: Number(m.amountUSD) || 0,
                    materialName: m.materialName || '',
                    date: m.date || todayStr()
                });
            });
        }
    }

    // تفريغ نهائي للمصفوفات القديمة على مستوى الفاتورة
    inv.payments = [];
    inv.materials = [];

    if (updates.sitePhotos !== undefined) inv.sitePhotos = updates.sitePhotos;
    inv.updatedAt = new Date().toISOString();

    invoices[idx] = inv;
    saveAllInvoices(invoices);
    return inv;
}

function deleteInvoice(id) {
    const invoices = getAllInvoicesRaw();
    const idx = invoices.findIndex(inv => inv.id === id);
    if (idx === -1) return false;
    const now = Date.now();
    const iso = new Date(now).toISOString();
    // 🪦 TOMBSTONE: ضع علامة حذف (لا تحذف نهائياً الآن — ادفعها للسحابة لتُحذف من كل الأجهزة)
    invoices[idx] = {
        ...invoices[idx],
        __tombstone: true,
        deletedAt: now,
        updatedAt: iso
    };
    saveAllInvoices(invoices);

    // احذف دفعات هذه الفاتورة من سجلات العمال محلياً أيضاً
    const workers = getAllWorkersRaw();
    let workersDirty = false;
    workers.forEach(w => {
        if (!Array.isArray(w.payments) || w.payments.length === 0) return;
        const before = w.payments.length;
        w.payments = w.payments.filter(p => p.invoiceId !== id);
        if (w.payments.length !== before) {
            w.updatedAt = new Date().toISOString();
            workersDirty = true;
        }
    });
    if (workersDirty) saveAllWorkers(workers);

    return true;
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
    // حساب المجاميع من الهيكل الجديد: nested craftsmen + materials داخل كل clientPayment
    const clientPayments = Array.isArray(invoice.clientPayments) ? invoice.clientPayments : [];

    // المستلم من العميل: المستحق المباشر للدفعات
    const totalReceivedSYP = clientPayments.reduce((sum, p) => sum + (Number(p.amountSYP) || 0), 0);
    const totalReceivedUSD = clientPayments.reduce((sum, p) => sum + (Number(p.amountUSD) || 0), 0);

    // المتبقي
    const remainingSYP = Math.max(0, (Number(invoice.agreedAmountSYP) || 0) - totalReceivedSYP);
    const remainingUSD = Math.max(0, (Number(invoice.agreedAmountUSD) || 0) - totalReceivedUSD);

    // المواد والمستلزمات: مجموع nested materials عبر كل الدفعات
    let totalMaterialsSYP = 0;
    let totalMaterialsUSD = 0;
    clientPayments.forEach(cp => {
        if (Array.isArray(cp.materials)) {
            cp.materials.forEach(m => {
                totalMaterialsSYP += Number(m.amountSYP) || 0;
                totalMaterialsUSD += Number(m.amountUSD) || 0;
            });
        }
    });

    // Retrocompat fallback: لو لسه فيه بيانات قديمة top-level (قبل أن ينظفها migrateInvoice)
    const legacyMaterials = Array.isArray(invoice.materials) ? invoice.materials : [];
    if (legacyMaterials.length > 0 && totalMaterialsSYP === 0 && totalMaterialsUSD === 0) {
        totalMaterialsSYP = legacyMaterials.reduce((sum, m) => sum + (Number(m.amountSYP) || 0), 0);
        totalMaterialsUSD = legacyMaterials.reduce((sum, m) => sum + (Number(m.amountUSD) || 0), 0);
    }

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
    // تصفية الـ tombstones
    return getAllWorkersRaw().filter(w => !(w && (w.__tombstone || w.deletedAt)));
}

function getAllWorkersRaw() {
    return safeGet(STORAGE_KEYS.WORKERS, []);
}

function saveAllWorkers(workers) {
    safeSet(STORAGE_KEYS.WORKERS, workers);
    // مزامنة فورية للسحابة (بدون setTimeout — ننتظر الرد) + إعادة المحاولة 3 مرات
    (async () => {
        if (!(FIREBASE_ENABLED || firebaseConfigValid())) return;
        for (let i = 0; i < 3; i++) {
            const ok = await cloudWrite('app_data', STORAGE_KEYS.WORKERS, workers);
            if (ok) break;
            await new Promise(r => setTimeout(r, 200 * (i + 1)));
        }
    })();
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
    const workers = getAllWorkersRaw();
    const idx = workers.findIndex(w => w.id === id);
    if (idx === -1) return false;
    const now = Date.now();
    const iso = new Date(now).toISOString();
    // 🪦 TOMBSTONE: ضع علامة حذف
    workers[idx] = {
        ...workers[idx],
        __tombstone: true,
        deletedAt: now,
        updatedAt: iso
    };
    saveAllWorkers(workers);
    return true;
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
// PROFESSIONS (الوظائف / المهن) CRUD + Sync
// ============================================
function getAllProfessions() {
    // تصفية الـ tombstones
    const raw = getAllProfessionsRaw();
    return _normalizeAndReturnProfessions(raw.filter(p => !(p && (p.__tombstone || p.deletedAt))));
}

function getAllProfessionsRaw() {
    return safeGet(STORAGE_KEYS.PROFESSIONS, null);
}

function _normalizeAndReturnProfessions(list) {
    // (المساعدة المنطقية المستخرجة من getAllProfessions الأصلي)
    if (!list || !Array.isArray(list) || list.length === 0) {
        console.group('%c⚠️ [DEBUG PROFESSIONS] _normalizeAndReturnProfessions — EMPTY/CORRUPTED', 'background:#fff3cd;color:#856404;font-weight:bold;');
        console.log('safeGet raw value:', list);
        console.log('DEFAULT_PROFESSIONS count:', Array.isArray(DEFAULT_PROFESSIONS) ? DEFAULT_PROFESSIONS.length : 'NOT_ARRAY');
        if (Array.isArray(DEFAULT_PROFESSIONS) && DEFAULT_PROFESSIONS.length > 0) {
            console.log('Will RE-SEED storage with DEFAULT_PROFESSIONS:', DEFAULT_PROFESSIONS.map(p => p.name).join('، '));
        }
        console.groupEnd();
        list = JSON.parse(JSON.stringify(DEFAULT_PROFESSIONS));
        try { saveAllProfessions(list); } catch(e1) { try { safeSet(STORAGE_KEYS.PROFESSIONS, list); } catch(e2) {} }
    }
    if (!list || !Array.isArray(list) || list.length === 0) {
        if (Array.isArray(DEFAULT_PROFESSIONS) && DEFAULT_PROFESSIONS.length > 0) {
            console.warn('%c🚨 [CRITICAL FALLBACK] returning DEFAULT directly because storage repeatedly returned empty!', 'background:#dc3545;color:#fff;font-weight:bold;');
            list = JSON.parse(JSON.stringify(DEFAULT_PROFESSIONS));
        }
    }
    const sorted = list.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    console.group('%c✅ [DEBUG PROFESSIONS] _normalizeAndReturnProfessions RETURN', 'background:#d4edda;color:#155724;font-weight:bold;');
    console.log('Count returned:', sorted.length);
    sorted.forEach((p, i) => console.log(`  [${i+1}] id=${p.id} | name="${p.name}" | order=${p.order}`));
    console.groupEnd();
    return sorted;
}

function saveAllProfessions(profs) {
    safeSet(STORAGE_KEYS.PROFESSIONS, profs);
    (async () => {
        if (!(FIREBASE_ENABLED || firebaseConfigValid())) return;
        for (let i = 0; i < 3; i++) {
            const ok = await cloudWrite('app_data', STORAGE_KEYS.PROFESSIONS, profs);
            if (ok) break;
            await new Promise(r => setTimeout(r, 200 * (i + 1)));
        }
    })();
}

function getProfessionById(id) {
    return getAllProfessions().find(p => p.id === id) || null;
}

function createProfession(data) {
    const profs = getAllProfessions();
    const newProf = {
        id: data.id || generateId('prf'),
        name: (data.name || '').trim(),
        order: Number(data.order) || (profs.length > 0 ? (Math.max(...profs.map(x => Number(x.order) || 0)) + 1) : 1),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    if (!newProf.name) return null;
    if (profs.some(x => x.name === newProf.name)) {
        toast('اسم مكرر', 'هناك وظيفة بنفس الاسم موجودة من قبل', 'warning');
        return null;
    }
    profs.push(newProf);
    saveAllProfessions(profs);
    return newProf;
}

function updateProfession(id, updates) {
    const profs = getAllProfessions();
    const idx = profs.findIndex(p => p.id === id);
    if (idx === -1) return null;
    if (updates.name !== undefined) profs[idx].name = (updates.name + '').trim();
    if (updates.order !== undefined) profs[idx].order = Number(updates.order);
    profs[idx].updatedAt = new Date().toISOString();
    saveAllProfessions(profs);
    return profs[idx];
}

function deleteProfession(id) {
    const profs = getAllProfessionsRaw();
    const idx = profs.findIndex(p => p.id === id);
    if (idx === -1) return false;
    const now = Date.now();
    const iso = new Date(now).toISOString();
    // 🪦 TOMBSTONE: ضع علامة حذف
    profs[idx] = {
        ...profs[idx],
        __tombstone: true,
        deletedAt: now,
        updatedAt: iso
    };
    saveAllProfessions(profs);
    return true;
}

function reorderProfession(id, direction) {
    const profs = getAllProfessions();
    const sorted = profs.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    const idx = sorted.findIndex(p => p.id === id);
    if (idx === -1) return false;
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= sorted.length) return false;
    const a = sorted[idx].order;
    sorted[idx].order = sorted[target].order;
    sorted[target].order = a;
    const now = new Date().toISOString();
    sorted[idx].updatedAt = now;
    sorted[target].updatedAt = now;
    saveAllProfessions(sorted);
    return true;
}

function getProfessionSelectHtml(selectedName, extraAttrs, includeOther) {
    try {
        let profs;
        try { profs = getAllProfessions(); } catch(e1) {
            try { profs = JSON.parse(JSON.stringify(DEFAULT_PROFESSIONS)); } catch(e2) { profs = []; }
        }
        if (!Array.isArray(profs)) profs = [];
        // #region debug-point getProfessionSelectHtml-preCheck
        console.group('%c🔍 [DEBUG PROFESSIONS] getProfessionSelectHtml PRE-CHECK', 'background:#cce5ff;color:#004085;font-weight:bold;');
        console.log('getAllProfessions returned count:', profs.length);
        console.log('selectedName argument:', selectedName);
        console.log('includeOther:', includeOther);
        if (profs.length > 0) console.log('First 3 names:', profs.slice(0,3).map(p=>p.name).join('، '));
        console.groupEnd();
        // #endregion
        // 🔥🔥🔥 ABSOLUTE FINAL GUARANTEE — مينفعش نخسر هنا تحت أي ظرف
        // لو عدد المهن = 0 في أي مرحلة → نأخذ DEFAULT_PROFESSIONS بالقوة ونتجاهل أي شيء تاني، ونحفظهم فوراً للتخزين والسحابة
        if (profs.length === 0 && Array.isArray(DEFAULT_PROFESSIONS) && DEFAULT_PROFESSIONS.length > 0) {
            console.group('%c🚨🚨🚨 [GUARANTEE TRIGGERED] FINAL FALLBACK IN getProfessionSelectHtml', 'background:#dc3545;color:#fff;font-weight:bold;font-size:14px;');
            console.warn('profs.length was 0 even after getAllProfessions() — injecting DEFAULT_PROFESSIONS BY FORCE right now!');
            console.warn('DEFAULT_PROFESSIONS items:', DEFAULT_PROFESSIONS.map(p => `${p.name}(order=${p.order})`).join(' | '));
            console.groupEnd();
            profs = JSON.parse(JSON.stringify(DEFAULT_PROFESSIONS));
            // حفظ فوري وعدم انتظار أي مزامنة
            try { saveAllProfessions(profs); } catch(guaranteeErr1) {
                try { safeSet(STORAGE_KEYS.PROFESSIONS, profs); } catch(guaranteeErr2) {
                    // حتى لو فشل التخزين، نكمل على الأقل لعرض القائمة في واجهة المستخدم حالياً
                }
            }
        }
        const sel = selectedName || '';
        const otherEnabled = includeOther !== false;
        let html = `<select ${extraAttrs || ''}>`;
        html += `<option value="" ${!sel ? 'selected' : ''} disabled>-- اختر نوع الوظيفة --</option>`;
        // #region debug-point getProfessionSelectHtml-forEachCheck
        console.log('%c🎯 [DEBUG PROFESSIONS] Building <option> nodes now — profs.length to iterate =', 'background:#e2e3e5;color:#383d41;font-weight:bold;', profs.length);
        // #endregion
        profs.forEach(p => {
            try {
                const nm = (p && p.name) ? String(p.name) : '';
                if (!nm) return;
                html += `<option value="${escapeAttr(nm)}" ${sel === nm ? 'selected' : ''}>${escapeHtml(nm)}</option>`;
                console.log(`  → added option: ${nm}`);
            } catch(_) {}
        });
        if (otherEnabled) {
            let otherSel = false;
            try { otherSel = sel && !profs.some(p => p && p.name === sel); } catch(_) { otherSel = !!sel; }
            html += `<option value="__other__" ${otherSel ? 'selected' : ''}>أخرى (اكتب يدوي)</option>`;
        }
        html += `</select>`;
        // #region debug-point getProfessionSelectHtml-final
        console.group('%c🏁 [DEBUG PROFESSIONS] getProfessionSelectHtml FINAL OUTPUT', 'background:#d4edda;color:#155724;font-weight:bold;');
        const tempCount = (html.match(/<option/g) || []).length;
        console.log('Total <option> tags in generated SELECT:', tempCount, '(= 1 placeholder +', (tempCount - 2), 'professions + 1 Other)');
        console.log('First 500 chars of generated HTML:', html.substring(0, 500));
        console.groupEnd();
        // #endregion
        return html;
    } catch (bigErr) {
        // آخر حصار: إذا فشل أي شيء حتى فوق، نرجع input نصي بسيط عشان نضمن عدم فجور المودال
        console.warn('getProfessionSelectHtml TOTAL FALLBACK, error:', bigErr && bigErr.message);
        return `<input type="text" ${extraAttrs || ''} value="${escapeAttr(selectedName || '')}" placeholder="اكتب نوع الوظيفة (مثل: نجار / كهربائي)">`;
    }
}

function getCraftsmanProfessionFromRow(rowEl, typeClass, otherClass) {
    if (!rowEl) return '';
    const sel = rowEl.querySelector('.' + (typeClass || 'modal-nested-craftsman-type'));
    if (!sel) return '';
    if (sel.tagName === 'SELECT') {
        const v = sel.value || '';
        if (v !== '__other__') return v.trim();
        const other = rowEl.querySelector('.' + (otherClass || 'modal-nested-craftsman-type-other'));
        return other ? (other.value || '').trim() : '';
    }
    return (sel.value || '').trim();
}

function attachCraftsmanProfessionToggle(rowEl, typeClass, otherClass) {
    if (!rowEl) return;
    const sel = rowEl.querySelector('.' + (typeClass || 'modal-nested-craftsman-type'));
    const other = rowEl.querySelector('.' + (otherClass || 'modal-nested-craftsman-type-other'));
    if (!sel || !other || sel.tagName !== 'SELECT') return;
    const apply = () => {
        other.style.display = sel.value === '__other__' ? '' : 'none';
        if (sel.value !== '__other__') { other.value = ''; }
    };
    apply();
    sel.addEventListener('change', apply);
    other.addEventListener('input', () => {
        if (other.value.trim()) sel.value = '__other__';
    });
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
            case 'professions':
                if (!isAdminLoggedIn()) {
                    navigate('admin');
                    return;
                }
                app.innerHTML = renderProfessionsDashboard();
                attachProfessionsDashboardEvents();
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
                setTimeout(() => {
                    document.querySelectorAll('tr[data-nested-craftsman]').forEach(tr => {
                        try { attachCraftsmanProfessionToggle(tr, 'nested-craftsman-type', 'nested-craftsman-type-other'); } catch (_) {}
                    });
                }, 60);
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

                    <!-- Layer 1: Slides (images fade in/out) — 8 صور حقيقية من أعمالنا بمجلد works/ -->
                    <!-- ⚠️ slide[0] يبدأ بـ is-active مباشرة ليظهر فوراً — لا انتظار لـ JS -->
                    <!-- أسماء بسيطة بدون مسافات أو GUIDs لتوافق كامل مع Chrome و Render -->
                    <div class="works-c-slides" id="worksSlides">
                        <div class="works-c-slide is-active" data-project="0">
                            <img src="works/01.jpg" alt="مشروع 1" loading="eager" fetchpriority="high">
                            <div class="works-c-vignette"></div>
                        </div>
                        <div class="works-c-slide" data-project="1">
                            <img src="works/02.jpg" alt="مشروع 2" loading="lazy">
                            <div class="works-c-vignette"></div>
                        </div>
                        <div class="works-c-slide" data-project="2">
                            <img src="works/03.jpg" alt="مشروع 3" loading="lazy">
                            <div class="works-c-vignette"></div>
                        </div>
                        <div class="works-c-slide" data-project="3">
                            <img src="works/04.jpg" alt="مشروع 4" loading="lazy">
                            <div class="works-c-vignette"></div>
                        </div>
                        <div class="works-c-slide" data-project="4">
                            <img src="works/05.jpg" alt="مشروع 5" loading="lazy">
                            <div class="works-c-vignette"></div>
                        </div>
                        <div class="works-c-slide" data-project="5">
                            <img src="works/06.jpg" alt="مشروع 6" loading="lazy">
                            <div class="works-c-vignette"></div>
                        </div>
                        <div class="works-c-slide" data-project="6">
                            <img src="works/07.jpg" alt="مشروع 7" loading="lazy">
                            <div class="works-c-vignette"></div>
                        </div>
                        <div class="works-c-slide" data-project="7">
                            <img src="works/08.jpg" alt="مشروع 8" loading="lazy">
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
        const SLIDE_COUNT = 8;
        const AUTO_INTERVAL_MS = 7000; // 7 seconds per slide — luxury calm pace
        let activeIndex = 0;
        let autoTimer = null;

        // Build dots (8 dots, bottom center) — NO LABELS, images-only design
        if (worksDotsWrap) {
            worksDotsWrap.innerHTML = '';
            for (let i = 0; i < SLIDE_COUNT; i++) {
                const b = document.createElement('button');
                b.className = 'works-c-dot' + (i === 0 ? ' is-active' : '');
                b.setAttribute('aria-label', '');
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
        // (slide[0] يبدأ بـ is-active من HTML مباشرة، فلا حاجة لـ setTimeout)
        // نبدأ الـ auto timer فوراً، وتأثير Ken Burns يبدأ طبيعياً من transition الـ CSS
        setActive(0);
        startAutoTimer();
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

                <div class="dashboard-section" onclick="navigate('professions')" style="cursor:pointer; transition:transform 0.25s ease, box-shadow 0.25s ease;" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 12px 32px rgba(0,0,0,0.08)';" onmouseout="this.style.transform=''; this.style.boxShadow='';">
                    <div class="dashboard-section-header" style="border-bottom:none; padding-bottom:0.75rem;">
                        <h2 style="display:flex; align-items:center; gap:0.75rem;">
                            <span style="width:44px; height:44px; border-radius:50%; background:linear-gradient(135deg, rgba(212,169,66,0.22) 0%, rgba(212,169,66,0.07) 100%); color:#946812; display:inline-flex; align-items:center; justify-content:center; font-size:1.1rem;">
                                <i class="fas fa-list-check"></i>
                            </span>
                            إدارة الوظائف والمهن
                        </h2>
                        <div class="link-back" style="opacity:0.9;">
                            فتح القسم <i class="fas fa-chevron-left" style="margin-right:0.4rem;"></i>
                        </div>
                    </div>
                    <div style="padding:0 1.5rem 1.5rem 1.5rem;">
                        <p style="color:var(--color-gray); margin-bottom:1.25rem; line-height:1.8;">ترتيب وإضافة وحذف قائمة المهن (النجار / الحداد / الكهربائي... إلخ). هذه القائمة تظهر تلقائياً كقائمة منسدلة عند إنشاء فاتورة جديدة أو إضافة عامل جديد.</p>
                        <div class="stats-grid" style="grid-template-columns: repeat(2, 1fr); gap:0.75rem;">
                            <div class="stat-card stat-count" style="padding:0.85rem 1rem;">
                                <div class="stat-label" style="font-size:0.75rem;">عدد المهن الحالي</div>
                                <div class="stat-value">${getAllProfessions().length}</div>
                            </div>
                            <div class="stat-card stat-total" style="padding:0.85rem 1rem;">
                                <div class="stat-label" style="font-size:0.75rem;">آخر مهنة مضافة</div>
                                <div class="stat-value" style="font-size:0.9rem;">${getAllProfessions().length > 0 ? escapeHtml(getAllProfessions().reduce((a, b) => new Date(a.createdAt) > new Date(b.createdAt) ? a : b).name.slice(0, 10)) : 'لا يوجد'}</div>
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
    try {
        let profSelectHtml;
        try {
            profSelectHtml = getProfessionSelectHtml('', `id="wprof" class="form-input" style="font-size:1rem; padding:0.65rem 0.9rem; min-height:42px;"`, true);
        } catch (e) {
            profSelectHtml = `<input id="wprof" type="text" class="form-input" placeholder="اكتب اسم المهنة: مثلاً نجار / كهربائي" style="font-size:1rem; padding:0.65rem 0.9rem; min-height:42px;">`;
        }
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
                        ${profSelectHtml}
                        <input id="wprof_other" type="text" class="form-input" placeholder="اكتب اسم الوظيفة هنا..." style="display:none; margin-top:0.5rem; font-size:0.95rem;" oninput="if(this.value.trim()){try{document.getElementById('wprof').value='__other__';}catch(e){}}">
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
        setTimeout(() => {
            const sel = document.getElementById('wprof');
            const other = document.getElementById('wprof_other');
            if (sel && other && sel.tagName === 'SELECT') {
                sel.addEventListener('change', () => {
                    other.style.display = sel.value === '__other__' ? '' : 'none';
                    if (sel.value !== '__other__') other.value = '';
                });
            }
        }, 50);
    } catch (err) {
        console.error('openWorkerCreate CRASH:', err);
        toast('خطأ جسيم', 'تعذر فتح إضافة عامل: ' + (err.message || err), 'error');
    }
}

function openWorkerEdit(workerId) {
    try {
        const w = getWorkerById(workerId);
        if (!w) return;
        let profSelectHtml;
        try {
            profSelectHtml = getProfessionSelectHtml(w.profession || '', `id="wprof" class="form-input" style="font-size:1rem; padding:0.65rem 0.9rem; min-height:42px;"`, true);
        } catch (e) {
            profSelectHtml = `<input id="wprof" type="text" class="form-input" value="${escapeHtml(w.profession || '')}" placeholder="اكتب اسم المهنة" style="font-size:1rem; padding:0.65rem 0.9rem; min-height:42px;">`;
        }
        let profs;
        try { profs = getAllProfessions(); } catch(e) { profs = []; }
        const isCustom = w.profession && profs.length && !profs.some(p => p.name === w.profession);
        const otherValue = isCustom ? escapeHtml(w.profession) : '';
        const otherDisplay = isCustom ? '' : 'display:none;';
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
                        ${profSelectHtml}
                        <input id="wprof_other" type="text" class="form-input" value="${otherValue}" placeholder="اكتب اسم الوظيفة هنا..." style="${otherDisplay} margin-top:0.5rem; font-size:0.95rem;" oninput="if(this.value.trim()){try{document.getElementById('wprof').value='__other__';}catch(e){}}">
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
        setTimeout(() => {
            const sel = document.getElementById('wprof');
            const other = document.getElementById('wprof_other');
            if (sel && other && sel.tagName === 'SELECT') {
                sel.addEventListener('change', () => {
                    other.style.display = sel.value === '__other__' ? '' : 'none';
                    if (sel.value !== '__other__') other.value = '';
                });
            }
        }, 50);
    } catch (err) {
        console.error('openWorkerEdit CRASH:', err);
        toast('خطأ جسيم', 'تعذر فتح تعديل العامل: ' + (err.message || err), 'error');
    }
}

function closeWorkerModal() {
    closeModalBase();
}

function getWorkerProfessionFromForm() {
    const sel = document.getElementById('wprof');
    if (!sel) return '';
    const v = sel.value || '';
    if (v !== '__other__') return v.trim();
    const otherInput = document.getElementById('wprof_other');
    return otherInput ? (otherInput.value || '').trim() : '';
}

function submitWorkerCreate() {
    const name = (document.getElementById('wname').value || '').trim();
    if (!name) { toast('مطلوب', 'يرجى إدخال اسم العامل', 'warning'); return; }
    const prof = getWorkerProfessionFromForm();
    createWorker({
        name,
        profession: prof,
        phone: (document.getElementById('wphone').value || '').trim()
    });
    closeWorkerModal();
    toast('تم الإضافة', 'تمت إضافة العامل بنجاح' + (prof ? ` (${prof})` : ''), 'success');
    renderCurrentRoute();
}

function submitWorkerEdit(workerId) {
    const name = (document.getElementById('wname').value || '').trim();
    if (!name) { toast('مطلوب', 'يرجى إدخال اسم العامل', 'warning'); return; }
    const prof = getWorkerProfessionFromForm();
    updateWorker(workerId, {
        name,
        profession: prof,
        phone: (document.getElementById('wphone').value || '').trim()
    });
    closeWorkerModal();
    toast('تم الحفظ', 'تم تحديث بيانات العامل بنجاح' + (prof ? ` (${prof})` : ''), 'success');
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
// PROFESSIONS (الوظائف) DASHBOARD + Events
// ============================================

function renderProfessionsDashboard() {
    const profs = getAllProfessions();
    const invCount = getAllInvoices().length;
    const wrkCount = getAllWorkers().length;
    const workerProfsDist = {};
    getAllWorkers().forEach(w => { if (w.profession) workerProfsDist[w.profession] = (workerProfsDist[w.profession] || 0) + 1; });

    return `
    <div class="dashboard">
        <div class="dashboard-header">
            <div class="dashboard-header-inner">
                <div style="display:flex; align-items:center; gap:1rem;">
                    <button class="icon-btn icon-btn-back" onclick="navigate('admin')" aria-label="رجوع للوحة التحكم">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                    <div>
                        <h1 style="margin:0; font-family:'Cairo',sans-serif;">إدارة الوظائف والمهن</h1>
                        <p style="margin:0.25rem 0 0; color:var(--color-gray); font-size:0.9rem;">
                            ترتيب وإضافة وحذف المهن — تظهر تلقائياً كقائمة منسدلة في الفواتير وفي إضافة عامل جديد.
                        </p>
                    </div>
                </div>
                <button class="btn btn-gold" onclick="openProfessionCreate()">
                    <i class="fas fa-plus"></i>
                    إضافة وظيفة جديدة
                </button>
            </div>
        </div>

        <div class="dashboard-stats" style="grid-template-columns: repeat(3,1fr); margin-bottom:1.5rem;">
            <div class="stat-card stat-count">
                <div class="stat-icon"><i class="fas fa-list-ol"></i></div>
                <div class="stat-value">${profs.length}</div>
                <div class="stat-label">عدد الوظائف الموجودة</div>
            </div>
            <div class="stat-card stat-paid">
                <div class="stat-icon"><i class="fas fa-user-tie"></i></div>
                <div class="stat-value">${wrkCount}</div>
                <div class="stat-label">عدد العمال الكلي</div>
            </div>
            <div class="stat-card stat-total">
                <div class="stat-icon"><i class="fas fa-file-invoice-dollar"></i></div>
                <div class="stat-value">${invCount}</div>
                <div class="stat-label">عدد الفواتير</div>
            </div>
        </div>

        <div style="background:#fff9e8; border:1.5px solid #f0d98a; border-radius:10px; padding:0.9rem 1.1rem; margin-bottom:1.25rem; line-height:1.9; font-size:0.92rem; color:#6a4d0c;">
            <strong><i class="fas fa-info-circle" style="margin-left:0.3rem;"></i> كيف الشغل هون؟</strong>
            <br>
            1. استخدم الأسهم <span style="padding:0.1rem 0.5rem; background:#fff; border:1px solid #e8d18a; border-radius:6px; font-weight:700;">↑</span> و <span style="padding:0.1rem 0.5rem; background:#fff; border:1px solid #e8d18a; border-radius:6px; font-weight:700;">↓</span> عشان ترتب المهن بنفس الترتيب اللي بدك ياه يبان بالفواتير.
            <br>
            2. لو أضفت وظيفة جديدة هون → رح تظهر تلقائياً في قائمة "نوع الوظيفة" داخل كل فاتورة وفي صفحة إدارة العمال.
            <br>
            3. لو ما كنت عارف اسم الوظيفة → بالفواتير بكون في خيار "أخرى (اكتب يدوي)" يعطيك مربع تكتب فيه الاسم اللي بدك.
        </div>

        <div class="craftsmen-table-wrapper">
            <table class="craftsmen-table" id="professionsTable">
                <thead>
                    <tr>
                        <th style="width:8%;">الترتيب</th>
                        <th>اسم الوظيفة</th>
                        <th style="width:14%;">عدد العمال</th>
                        <th style="width:22%;">التحكم</th>
                    </tr>
                </thead>
                <tbody>
                    ${profs.length === 0 ? `
                        <tr>
                            <td colspan="4" style="text-align:center; padding:2rem 1rem; color:var(--color-gray);">
                                لا توجد وظائف. اضغط "إضافة وظيفة جديدة".
                            </td>
                        </tr>
                    ` : profs.map((p, idx) => {
                        const cnt = workerProfsDist[p.name] || 0;
                        return `
                        <tr data-prof-id="${p.id}">
                            <td style="text-align:center; font-weight:700; font-size:1.05rem;">
                                <span style="display:inline-block; min-width:36px; padding:0.3rem 0.5rem; background:#fdf3d6; border-radius:8px; color:#8a6613;">
                                    ${Number(p.order) || (idx + 1)}
                                </span>
                            </td>
                            <td style="font-weight:700; font-size:1.05rem; padding:0.7rem 1rem;">
                                <i class="fas fa-briefcase" style="color:var(--color-gold-dark); margin-left:0.4rem;"></i>
                                ${escapeHtml(p.name)}
                            </td>
                            <td style="text-align:center; font-size:0.95rem;">
                                ${cnt > 0 ? `
                                    <button type="button" onclick="openProfessionWorkersModal('${p.id}')" style="all:unset; cursor:pointer; display:inline-block; padding:0.3rem 0.7rem; background:linear-gradient(135deg,rgba(59,130,246,0.18) 0%,rgba(59,130,246,0.06) 100%); color:#1d4ed8; border-radius:20px; font-weight:700; transition:transform 0.15s ease, box-shadow 0.15s ease;" onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 12px rgba(29,78,216,0.25)';" onmouseout="this.style.transform=''; this.style.boxShadow='';" title="اضغط لعرض العمال المسجلين في هذه الوظيفة">
                                        <i class="fas fa-users" style="margin-left:0.3rem;"></i>
                                        ${cnt} عامل
                                    </button>
                                ` : `
                                    <span style="color:var(--color-gray); font-size:0.85rem;">بدون عمال بعد</span>
                                `}
                            </td>
                            <td>
                                <div style="display:flex; align-items:center; justify-content:center; gap:0.35rem;">
                                    <button class="icon-btn icon-btn-save" title="نقل للأعلى" onclick="handleReorderProfession('${p.id}','up')" ${idx === 0 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''}>
                                        <i class="fas fa-arrow-up"></i>
                                    </button>
                                    <button class="icon-btn icon-btn-save" title="نقل للأسفل" onclick="handleReorderProfession('${p.id}','down')" ${idx === profs.length - 1 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''}>
                                        <i class="fas fa-arrow-down"></i>
                                    </button>
                                    <button class="icon-btn icon-btn-edit" title="تعديل الاسم" onclick="openProfessionEdit('${p.id}')">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                    <button class="icon-btn icon-btn-delete" title="حذف الوظيفة" onclick="confirmDeleteProfession('${p.id}')">
                                        <i class="fas fa-trash-alt"></i>
                                    </button>
                                </div>
                            </td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>

        <div class="dashboard-footer-actions" style="margin-top:1.5rem; display:flex; gap:0.75rem; flex-wrap:wrap;">
            <button class="btn btn-outline" onclick="navigate('admin')">
                <i class="fas fa-chevron-right"></i> رجوع للوحة التحكم
            </button>
            <button class="btn btn-outline" onclick="navigate('workers')">
                <i class="fas fa-user-tie"></i> فتح إدارة أجور العمال
            </button>
            <button class="btn btn-outline-gold" onclick="navigate('invoices')">
                <i class="fas fa-file-invoice-dollar"></i> فتح قائمة الفواتير
            </button>
        </div>
    </div>
    `;
}

function openProfessionWorkersModal(professionId) {
    try {
        const prof = getProfessionById(professionId);
        if (!prof) {
            toast('خطأ', 'الوظيفة غير موجودة', 'error');
            return;
        }
        const allWorkers = getAllWorkers();

        // 🤖 تطبيع ذكي لمطابقة اسم الوظيفة في كل سجلات العمال
        // نطبّع بإزالة الفروقات البسيطة: مسافات زائدة، همزات، تشكيل، حالات حروف
        const normalizeKey = (s) => {
            return (s || '')
                .toString()
                .replace(/[\u064B-\u0652\u0670\u0640]/g, '') // إزالة التشكيل والتطويل
                .replace(/[إأآا]/g, 'ا')                      // توحيد الألف
                .replace(/[ىي]/g, 'ي')                        // توحيد الياء
                .replace(/ة/g, 'ه')                           // توحيد التاء المربوط
                .replace(/\s+/g, ' ')                          // توحيد المسافات
                .trim()
                .toLowerCase();
        };
        const profKey = normalizeKey(prof.name);

        // تصفية العمال الذين وظيفتهم تطابق اسم الوظيفة الحالية
        const workers = allWorkers
            .filter(w => normalizeKey(w.profession) === profKey)
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));

        // إحصائيات سريعة
        let totalSYP = 0, totalUSD = 0, totalPayments = 0;
        workers.forEach(w => {
            const pays = w.payments || [];
            totalPayments += pays.length;
            pays.forEach(p => {
                totalSYP += Number(p.amountSYP) || 0;
                totalUSD += Number(p.amountUSD) || 0;
            });
        });

        // بناء HTML للمودال
        const html = `
            <div style="padding:0.25rem 0.25rem 0.5rem;">
                <!-- رأس المودال: اسم الوظيفة + الإحصائيات -->
                <div style="background:linear-gradient(135deg, rgba(212,175,55,0.10) 0%, rgba(212,175,55,0.02) 100%);
                            border:1px solid rgba(212,175,55,0.30); border-radius:12px; padding:1rem 1.25rem;
                            margin-bottom:1.25rem; display:flex; align-items:center; gap:1rem; flex-wrap:wrap;">
                    <div style="width:54px; height:54px; border-radius:50%;
                                background:rgba(212,175,55,0.20); color:var(--color-gold-dark);
                                display:flex; align-items:center; justify-content:center; font-size:1.5rem; flex-shrink:0;">
                        <i class="fas fa-briefcase"></i>
                    </div>
                    <div style="flex:1; min-width:200px;">
                        <h2 style="margin:0; font-family:'Cairo',sans-serif; font-size:1.4rem; color:var(--color-black);">
                            عمال وظيفة: ${escapeHtml(prof.name)}
                        </h2>
                        <p style="margin:0.3rem 0 0; color:var(--color-gray); font-size:0.88rem;">
                            <i class="fas fa-users" style="margin-left:0.3rem;"></i> ${workers.length} عامل مسجّل
                            &nbsp;•&nbsp;
                            <i class="fas fa-wallet" style="margin-left:0.3rem;"></i> ${totalPayments} دفعة
                        </p>
                    </div>
                    <div style="display:flex; gap:0.75rem; flex-wrap:wrap;">
                        <div style="text-align:center; padding:0.55rem 0.85rem; background:#fff;
                                    border:1px solid rgba(212,175,55,0.35); border-radius:10px;">
                            <div style="font-size:0.72rem; color:var(--color-gray);">إجمالي الليرة</div>
                            <div style="font-weight:700; color:var(--color-gold-dark); font-size:0.95rem;">${formatCurrencySYP(totalSYP)}</div>
                        </div>
                        <div style="text-align:center; padding:0.55rem 0.85rem; background:#fff;
                                    border:1px solid rgba(212,175,55,0.35); border-radius:10px;">
                            <div style="font-size:0.72rem; color:var(--color-gray);">إجمالي الدولار</div>
                            <div style="font-weight:700; color:var(--color-gold-dark); font-size:0.95rem;">${formatCurrencyUSD(totalUSD)}</div>
                        </div>
                    </div>
                </div>

                ${workers.length === 0 ? `
                    <!-- لا يوجد عمال بعد -->
                    <div style="text-align:center; padding:3rem 1rem; color:var(--color-gray);">
                        <div style="font-size:3rem; margin-bottom:0.75rem; opacity:0.5;">
                            <i class="fas fa-user-tie"></i>
                        </div>
                        <h3 style="margin:0 0 0.4rem; color:var(--color-black); font-family:'Cairo',sans-serif;">
                            ما في عمال مسجّلين بهالوظيفة لسا
                        </h3>
                        <p style="margin:0 0 1rem; font-size:0.9rem;">
                            لما تحفظ فاتورة فيها اسم عامل واخترت وظيفته "${escapeHtml(prof.name)}"
                            <br>الاسم بيظهر هنا تلقائياً مع كل دفعاته.
                        </p>
                        <button class="btn btn-outline-gold" onclick="closeModal(); navigate('workers');">
                            <i class="fas fa-plus"></i> إدارة العمال
                        </button>
                    </div>
                ` : `
                    <!-- قائمة العمال مع دفعاتهم -->
                    <div style="display:flex; flex-direction:column; gap:0.85rem;">
                        ${workers.map((w, wIdx) => {
                            const pays = (w.payments || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
                            const wSYP = pays.reduce((s, p) => s + (Number(p.amountSYP) || 0), 0);
                            const wUSD = pays.reduce((s, p) => s + (Number(p.amountUSD) || 0), 0);
                            const wPhone = w.phone ? `<i class="fas fa-phone-alt" style="margin-left:0.3rem; color:var(--color-gold-dark);"></i>${escapeHtml(w.phone)}` : '';
                            return `
                            <div style="background:#fff; border:1px solid #ececec; border-radius:12px; overflow:hidden;
                                        box-shadow:0 2px 6px rgba(0,0,0,0.04);">
                                <!-- رأس العامل -->
                                <div style="padding:0.85rem 1rem; background:linear-gradient(135deg, #fafafa 0%, #f5f3ee 100%);
                                            border-bottom:1px solid #ececec; display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap;">
                                    <div style="width:42px; height:42px; border-radius:50%;
                                                background:linear-gradient(135deg, var(--color-gold-dark) 0%, #8a6613 100%);
                                                color:#fff; display:flex; align-items:center; justify-content:center;
                                                font-weight:700; font-size:1.05rem; flex-shrink:0;">
                                        ${escapeHtml((w.name || '?').charAt(0))}
                                    </div>
                                    <div style="flex:1; min-width:160px;">
                                        <div style="font-weight:700; color:var(--color-black); font-size:1.02rem;">
                                            ${escapeHtml(w.name || '—')}
                                        </div>
                                        <div style="font-size:0.78rem; color:var(--color-gray); margin-top:2px;">
                                            ${wPhone ? wPhone + ' • ' : ''}
                                            ${pays.length} دفعة • ${formatCurrencySYP(wSYP)} • ${formatCurrencyUSD(wUSD)}
                                        </div>
                                    </div>
                                    <button class="icon-btn icon-btn-edit" title="فتح صفحة العامل الكاملة" onclick="closeModal(); navigate('worker/${w.id}');">
                                        <i class="fas fa-external-link-alt"></i>
                                    </button>
                                </div>

                                ${pays.length === 0 ? `
                                    <div style="padding:1rem 1.25rem; color:var(--color-gray); font-size:0.88rem; text-align:center;">
                                        <i class="fas fa-info-circle" style="margin-left:0.3rem;"></i>
                                        لسا ما استلم ولا دفعة — بس بظهر بالفواتير لما تنحفظ.
                                    </div>
                                ` : `
                                    <div style="max-height:260px; overflow-y:auto;">
                                        <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                                            <thead>
                                                <tr style="background:#fcfbf7;">
                                                    <th style="padding:0.55rem 0.85rem; text-align:right; color:var(--color-gray); font-weight:600; font-size:0.78rem; border-bottom:1px solid #ececec;">التاريخ</th>
                                                    <th style="padding:0.55rem 0.85rem; text-align:right; color:var(--color-gray); font-weight:600; font-size:0.78rem; border-bottom:1px solid #ececec;">ل.س</th>
                                                    <th style="padding:0.55rem 0.85rem; text-align:right; color:var(--color-gray); font-weight:600; font-size:0.78rem; border-bottom:1px solid #ececec;">$</th>
                                                    <th style="padding:0.55rem 0.85rem; text-align:right; color:var(--color-gray); font-weight:600; font-size:0.78rem; border-bottom:1px solid #ececec;">الملاحظة</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${pays.slice(0, 8).map(p => `
                                                    <tr>
                                                        <td style="padding:0.5rem 0.85rem; border-bottom:1px solid #f3f3f3;">${formatDate(p.date)}</td>
                                                        <td style="padding:0.5rem 0.85rem; border-bottom:1px solid #f3f3f3; font-weight:600; color:var(--color-gold-dark);">${formatCurrencySYP(Number(p.amountSYP) || 0)}</td>
                                                        <td style="padding:0.5rem 0.85rem; border-bottom:1px solid #f3f3f3; font-weight:600; color:#1d4ed8;">${formatCurrencyUSD(Number(p.amountUSD) || 0)}</td>
                                                        <td style="padding:0.5rem 0.85rem; border-bottom:1px solid #f3f3f3; color:var(--color-gray); font-size:0.78rem;">${escapeHtml(p.note || '—')}</td>
                                                    </tr>
                                                `).join('')}
                                            </tbody>
                                        </table>
                                        ${pays.length > 8 ? `
                                            <div style="padding:0.5rem 0.85rem; text-align:center; font-size:0.78rem; color:var(--color-gray); background:#fafafa; border-top:1px solid #ececec;">
                                                + ${pays.length - 8} دفعة إضافية — اضغط أيقونة العرض الكامل فوق
                                            </div>
                                        ` : ''}
                                    </div>
                                `}
                            </div>
                            `;
                        }).join('')}
                    </div>

                    <div style="margin-top:1.25rem; padding:0.75rem 1rem; background:#fff9e8; border:1px dashed #e8d18a;
                                border-radius:10px; color:#6a4d0c; font-size:0.85rem; line-height:1.7;">
                        <i class="fas fa-lightbulb" style="margin-left:0.3rem;"></i>
                        <strong>حماية ذكية مفعّلة:</strong>
                        لو كتبت بنفس الاسم ونفس الوظيفة بفواتير ثانية، الدفعات بتتخزن عند نفس الموظف
                        (ما بنشئ سجل مكرر جديد).
                    </div>
                `}
            </div>
        `;

        showModal(html, {
            title: 'عمال وظيفة ' + prof.name,
            isLarge: true
        });
    } catch (err) {
        console.error('openProfessionWorkersModal CRASH:', err);
        toast('خطأ', 'تعذر فتح قائمة العمال: ' + (err.message || err), 'error');
    }
}

function attachProfessionsDashboardEvents() {
    // (لا أحداث إضافية حالياً - كل شيء عبر onclick مباشر)
}

function handleReorderProfession(id, dir) {
    if (reorderProfession(id, dir)) {
        toast('تم الترتيب', dir === 'up' ? 'نقلت الوظيفة للأعلى' : 'نقلت الوظيفة للأسفل', 'success');
        renderCurrentRoute();
    }
}

function openProfessionCreate() {
    const html = `
        <div class="modal-content" style="max-width:440px;">
            <div class="modal-header">
                <h3>إضافة وظيفة جديدة</h3>
                <button class="btn-icon" onclick="closeModal()"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">اسم الوظيفة *</label>
                    <input id="pname" type="text" class="form-input" placeholder="مثال: حداد، سباك، عامل صب...">
                </div>
                <div style="background:#fff9e8; border:1px dashed #e8d18a; padding:0.7rem 1rem; border-radius:8px; color:#6a4d0c; font-size:0.88rem; line-height:1.7;">
                    <i class="fas fa-lightbulb" style="margin-left:0.3rem;"></i>
                    بعد الإضافة رح تظهر الوظيفة تلقائياً في قائمة "نوع الوظيفة" في الفواتير وفي صفحة العمال.
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="closeModal()">إلغاء</button>
                <button class="btn btn-gold" onclick="submitProfessionCreate()">
                    <i class="fas fa-check"></i>
                    إضافة الوظيفة
                </button>
            </div>
        </div>
    `;
    showModal(html, { title: 'إضافة وظيفة', isLarge: false });
}

function submitProfessionCreate() {
    const name = (document.getElementById('pname').value || '').trim();
    if (!name) { toast('مطلوب', 'يرجى كتابة اسم الوظيفة', 'warning'); return; }
    const p = createProfession({ name });
    if (p) {
        toast('تم الإضافة', `تمت إضافة وظيفة "${p.name}" بنجاح`, 'success');
        closeModal();
        renderCurrentRoute();
    }
}

function openProfessionEdit(id) {
    const p = getProfessionById(id);
    if (!p) return;
    const html = `
        <div class="modal-content" style="max-width:440px;">
            <div class="modal-header">
                <h3>تعديل اسم الوظيفة</h3>
                <button class="btn-icon" onclick="closeModal()"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">اسم الوظيفة *</label>
                    <input id="pname" type="text" class="form-input" value="${escapeAttr(p.name)}">
                </div>
                <div style="background:#fff4f4; border:1px dashed #f5b3b3; padding:0.7rem 1rem; border-radius:8px; color:#9b1c1c; font-size:0.88rem; line-height:1.7;">
                    <i class="fas fa-exclamation-triangle" style="margin-left:0.3rem;"></i>
                    ملاحظة: تغيير الاسم هنا لا يؤثر تلقائياً على أسماء الوظائف في الفواتير أو العمال القديمة.
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="closeModal()">إلغاء</button>
                <button class="btn btn-gold" onclick="submitProfessionEdit('${id}')">
                    <i class="fas fa-save"></i>
                    حفظ التعديل
                </button>
            </div>
        </div>
    `;
    showModal(html, { title: 'تعديل الوظيفة', isLarge: false });
}

function submitProfessionEdit(id) {
    const name = (document.getElementById('pname').value || '').trim();
    if (!name) { toast('مطلوب', 'يرجى كتابة اسم الوظيفة', 'warning'); return; }
    const p = updateProfession(id, { name });
    if (p) {
        toast('تم الحفظ', `تم تحديث اسم الوظيفة إلى "${p.name}"`, 'success');
        closeModal();
        renderCurrentRoute();
    }
}

function confirmDeleteProfession(id) {
    const p = getProfessionById(id);
    if (!p) return;
    const workersInProf = getAllWorkers().filter(w => w.profession === p.name).length;
    const warningBlock = workersInProf > 0 ? `
        <div style="background:#fff4f4; border:1.5px dashed #ef4444; border-radius:10px; padding:0.7rem 1rem; margin-top:1rem; color:#9b1c1c; line-height:1.8; font-size:0.88rem;">
            <i class="fas fa-exclamation-circle" style="margin-left:0.3rem;"></i>
            <strong>تنبيه:</strong> يوجد <strong>${workersInProf}</strong> عامل / عمالة بالوظيفة "${p.name}".
            <br>
            حذف الوظيفة هنا من القائمة بس، مو بحذف العمال من صفحة العمال، بس بعد الحذف رح تظهر اسم وظيفتهم كـ "أخرى" في القوائم.
        </div>
    ` : '';
    showModal(`
        <div style="text-align:center; padding:1rem 0;">
            <div style="width:70px; height:70px; margin:0 auto 1.5rem; border-radius:50%; background:rgba(239,68,68,0.1); color:#dc2626; display:flex; align-items:center; justify-content:center; font-size:1.8rem;">
                <i class="fas fa-trash-alt"></i>
            </div>
            <h3 style="font-family:'Cairo',sans-serif; font-size:1.3rem; margin-bottom:0.5rem; font-weight:700;">حذف وظيفة: ${escapeHtml(p.name)}</h3>
            <p style="color:var(--color-gray);">هل أنت متأكد من حذف هالوظيفة من القائمة؟</p>
            ${warningBlock}
        </div>
    `, {
        title: 'حذف وظيفة',
        isLarge: false,
        footer: `
            <button class="btn btn-outline" onclick="closeModal()">إلغاء</button>
            <button class="btn btn-primary" style="background:#dc2626;" onclick="executeDeleteProfession('${id}')">
                <i class="fas fa-trash-alt"></i>
                نعم، احذف الوظيفة
            </button>
        `
    });
}

function executeDeleteProfession(id) {
    const p = getProfessionById(id);
    const name = p ? p.name : '';
    if (deleteProfession(id)) {
        toast('تم الحذف', `تم حذف الوظيفة "${name}" من القائمة بنجاح`, 'success');
        closeModal();
        renderCurrentRoute();
    }
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
                        <h3><i class="fas fa-hand-holding-heart"></i>الدفعات المستلمة من العميل (مدفوعات + مواد ضمن كل دفعة)</h3>
                        ${isAdmin ? `
                            <button class="btn btn-gold btn-sm" onclick="addClientPaymentRow()">
                                <i class="fas fa-plus"></i>
                                إضافة دفعة مستقلة
                            </button>
                        ` : ''}
                    </div>

                    <div class="craftsmen-table-wrapper" id="clientPaymentsFullWrap">
                        <table class="craftsmen-table" id="clientPaymentsTable">
                            <thead>
                                <tr>
                                    <th style="width:14%;">المبلغ (ل.س)</th>
                                    <th style="width:14%;">المبلغ ($)</th>
                                    <th style="width:30%;">اسم / وصف الدفعة</th>
                                    <th style="width:18%;">تاريخ الاستلام</th>
                                    ${isAdmin ? '<th style="width:6%;"></th>' : ''}
                                </tr>
                            </thead>
                            <tbody id="clientPaymentsTbody">
                                ${(invoice.clientPayments && invoice.clientPayments.length > 0)
                                    ? invoice.clientPayments.map((cp, idx) => renderClientPaymentRowFull(cp, idx, isAdmin)).join('')
                                    : `
                                        <tr>
                                            <td colspan="${isAdmin ? '5' : '4'}" style="text-align:center; padding:2.5rem 1rem; color:var(--color-gray);">
                                                ${isAdmin ? 'لا توجد دفعات مستلمة بعد. اضغط "إضافة دفعة مستقلة" للبدء — تحت كل دفعة تستطيع تسجيل مدفوعات الحرفيين وأسعار المواد مباشرة.' : 'لا توجد دفعات مستلمة مسجلة حالياً.'}
                                            </td>
                                        </tr>
                                    `
                                }
                            </tbody>
                            ${(invoice.clientPayments && invoice.clientPayments.length > 0) ? `
                                <tfoot>
                                    <tr class="table-total-row">
                                        <td><strong>${formatCurrencySYP((invoice.clientPayments || []).reduce((s,p)=>s+(Number(p.amountSYP)||0), 0))}</strong></td>
                                        <td><strong>${formatCurrencyUSD((invoice.clientPayments || []).reduce((s,p)=>s+(Number(p.amountUSD)||0), 0))}</strong></td>
                                        <td colspan="2" style="text-align:left;"><strong>إجمالي المبالغ المستلمة</strong></td>
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
    const totalSYP = Number(payment.amountSYP) || 0;
    const totalUSD = Number(payment.amountUSD) || 0;
    if (isAdmin) {
        return `
            <tr data-pay-id="${payment.id}">
                <td>
                    <input type="number" class="pay-amount-syp big-price" min="0" value="${totalSYP}" placeholder="0" oninput="updateAmountsLive()">
                </td>
                <td>
                    <input type="number" class="pay-amount-usd big-price" min="0" value="${totalUSD}" placeholder="0" oninput="updateAmountsLive()">
                </td>
                <td>
                    <input type="text" class="pay-type" value="${escapeHtml(payment.craftsmanType)}" placeholder="مثال: نجار / حداد / سباك">
                </td>
                <td>
                    <input type="text" class="pay-name" value="${escapeHtml(payment.craftsmanName)}" placeholder="اسم الحرفي">
                </td>
                <td>
                    <input type="text" class="pay-description" value="${escapeHtml(payment.description || '')}" placeholder="التفاصيل">
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
                <td style="font-weight:600;">${formatCurrencySYP(totalSYP)}</td>
                <td style="font-weight:600;">${formatCurrencyUSD(totalUSD)}</td>
                <td><span class="craftsman-type-badge type-أخرى">${escapeHtml(payment.craftsmanType) || '-'}</span></td>
                <td>${escapeHtml(payment.craftsmanName) || '-'}</td>
                <td>${escapeHtml(payment.description || '—')}</td>
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
            <input type="number" class="pay-amount-syp big-price" min="0" value="0" placeholder="0" oninput="updateAmountsLive()">
        </td>
        <td>
            <input type="number" class="pay-amount-usd big-price" min="0" value="0" placeholder="0" oninput="updateAmountsLive()">
        </td>
        <td>
            <input type="text" class="pay-type" placeholder="مثال: نجار / حداد / سباك">
        </td>
        <td>
            <input type="text" class="pay-name" placeholder="اسم الحرفي">
        </td>
        <td>
            <input type="text" class="pay-description" placeholder="التفاصيل">
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
    return renderClientPaymentRowFull(cp, 0, isAdmin, true);
}

function renderClientPaymentRowFull(cp, idx, isAdmin, standalone = false) {
    const totalSYP = Number(cp.amountSYP) || 0;
    const totalUSD = Number(cp.amountUSD) || 0;
    const nestedCraftsmen = Array.isArray(cp.craftsmen) ? cp.craftsmen : [];
    const nestedMaterials = Array.isArray(cp.materials) ? cp.materials : [];
    const totalCraftSYP = nestedCraftsmen.reduce((s, x) => s + (Number(x.amountSYP) || 0), 0);
    const totalCraftUSD = nestedCraftsmen.reduce((s, x) => s + (Number(x.amountUSD) || 0), 0);
    const totalMatSYP = nestedMaterials.reduce((s, x) => s + (Number(x.amountSYP) || 0), 0);
    const totalMatUSD = nestedMaterials.reduce((s, x) => s + (Number(x.amountUSD) || 0), 0);
    const cpayBlockId = 'cpay-block-' + (cp.id || ('tmp' + Date.now()));
    if (isAdmin) {
        const effectiveCraftsmen = nestedCraftsmen.length > 0
            ? nestedCraftsmen
            : [{ id: 'nc_starter', amountSYP: 0, amountUSD: 0, craftsmanType: '', craftsmanName: '', date: todayStr() }];
        const effectiveMaterials = nestedMaterials.length > 0
            ? nestedMaterials
            : [{ id: 'nm_starter', amountSYP: 0, amountUSD: 0, materialName: '', date: todayStr() }];
        const craftsmenRowsHtml = effectiveCraftsmen.map(cr => nestedCraftsmanRowHtml(cr, isAdmin)).join('');
        const materialsRowsHtml = effectiveMaterials.map(mr => nestedMaterialRowHtml(mr, isAdmin)).join('');
        const showCraftFooter = nestedCraftsmen.length > 0;
        const showMatFooter = nestedMaterials.length > 0;
        return `
            <tr data-cpay-id="${cp.id}" data-cpay-block="${cpayBlockId}">
                <td>
                    <input type="number" class="cpay-amount-syp big-price" min="0" value="${totalSYP}" placeholder="0" oninput="updateAmountsLive()">
                </td>
                <td>
                    <input type="number" class="cpay-amount-usd big-price" min="0" value="${totalUSD}" placeholder="0" oninput="updateAmountsLive()">
                </td>
                <td>
                    <input type="text" class="cpay-material-name" value="${escapeHtml(cp.materialName || '')}" placeholder="اسم / وصف هذه الدفعة">
                </td>
                <td>
                    <input type="date" class="cpay-date" value="${formatDateInput(cp.date)}">
                </td>
                <td>
                    <button class="icon-btn icon-btn-delete" onclick="removeClientPaymentRow(this)" title="حذف الدفعة بالكامل">
                        <i class="fas fa-times"></i>
                    </button>
                </td>
            </tr>
            <tr class="cpay-nested-block" data-cpay-nested="${cpayBlockId}">
                <td colspan="5" style="padding:1rem 1.2rem 1.6rem; background:#fbf9f4; border-top:1px dashed #e8dfc8;">
                    <div class="cpay-nested-grid" style="display:flex; flex-direction:column; gap:1.2rem;">
                        <div class="cpay-nested-section" style="width:100%;">
                            <div class="cpay-nested-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem; padding-bottom:0.5rem; border-bottom:1px solid #e8dfc8;">
                                <h4 style="margin:0; font-size:1rem; color:var(--color-black); font-weight:700;">مدفوعات الحرفيين لهذه الدفعة</h4>
                                <button class="btn btn-outline-gold btn-sm" onclick="addNestedCraftsmanRow('${cpayBlockId}')"><i class="fas fa-plus"></i>إضافة حرفي</button>
                            </div>
                            <div class="craftsmen-table-wrapper" style="box-shadow:none; border:1px solid #eadfc4; border-radius:10px; overflow:hidden;">
                                <table class="craftsmen-table" data-nested-craftsmen-table="${cpayBlockId}">
                                    <thead>
                                        <tr>
                                            <th style="width:16%;padding:0.5rem;font-size:0.8rem; background:#fdf7e7;">ل.س</th>
                                            <th style="width:16%;padding:0.5rem;font-size:0.8rem; background:#fdf7e7;">$</th>
                                            <th style="padding:0.5rem;font-size:0.8rem; background:#fdf7e7;">نوع الشغل + اسم الحرفي</th>
                                            <th style="width:17%;padding:0.5rem;font-size:0.8rem; background:#fdf7e7;">التاريخ</th>
                                            <th style="width:5%;padding:0.5rem; background:#fdf7e7;"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${craftsmenRowsHtml}
                                    </tbody>
                                    ${showCraftFooter ? `
                                        <tfoot>
                                            <tr style="background:#fff6dc; font-weight:600; font-size:0.85rem;">
                                                <td>${formatCurrencySYP(totalCraftSYP)}</td>
                                                <td>${formatCurrencyUSD(totalCraftUSD)}</td>
                                                <td colspan="2" style="text-align:left;"><strong>إجمالي مدفوعات الحرفيين للدفعة</strong></td>
                                                <td></td>
                                            </tr>
                                        </tfoot>
                                    ` : ''}
                                </table>
                            </div>
                        </div>
                        <div class="cpay-nested-section" style="width:100%;">
                            <div class="cpay-nested-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem; padding-bottom:0.5rem; border-bottom:1px solid #e8dfc8;">
                                <h4 style="margin:0; font-size:1rem; color:var(--color-black); font-weight:700;">مواد / مستلزمات هذه الدفعة</h4>
                                <button class="btn btn-outline-gold btn-sm" onclick="addNestedMaterialRow('${cpayBlockId}')"><i class="fas fa-plus"></i>إضافة مادة</button>
                            </div>
                            <div class="craftsmen-table-wrapper" style="box-shadow:none; border:1px solid #eadfc4; border-radius:10px; overflow:hidden;">
                                <table class="craftsmen-table" data-nested-materials-table="${cpayBlockId}">
                                    <thead>
                                        <tr>
                                            <th style="width:16%;padding:0.5rem;font-size:0.8rem; background:#fdf7e7;">ل.س</th>
                                            <th style="width:16%;padding:0.5rem;font-size:0.8rem; background:#fdf7e7;">$</th>
                                            <th style="padding:0.5rem;font-size:0.8rem; background:#fdf7e7;">اسم المادة</th>
                                            <th style="width:17%;padding:0.5rem;font-size:0.8rem; background:#fdf7e7;">التاريخ</th>
                                            <th style="width:5%;padding:0.5rem; background:#fdf7e7;"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${materialsRowsHtml}
                                    </tbody>
                                    ${showMatFooter ? `
                                        <tfoot>
                                            <tr style="background:#fff6dc; font-weight:600; font-size:0.85rem;">
                                                <td>${formatCurrencySYP(totalMatSYP)}</td>
                                                <td>${formatCurrencyUSD(totalMatUSD)}</td>
                                                <td colspan="2" style="text-align:left;"><strong>إجمالي المواد للدفعة</strong></td>
                                                <td></td>
                                            </tr>
                                        </tfoot>
                                    ` : ''}
                                </table>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }
    const craftsmenViewHtml = (nestedCraftsmen && nestedCraftsmen.length > 0) || (nestedMaterials && nestedMaterials.length > 0)
        ? `<tr><td colspan="5" style="padding:0.8rem 1rem; background:#fbf9f4; border-top:1px dashed #e8dfc8;">
            <div style="display:flex; flex-direction:column; gap:1rem;">
                <div style="width:100%;">
                    <h4 style="margin:0 0 0.5rem; font-size:0.95rem; font-weight:700;">مدفوعات الحرفيين لهذه الدفعة</h4>
                    ${(nestedCraftsmen && nestedCraftsmen.length > 0) ? nestedCraftsmen.map(c => `<div style="display:flex; gap:1rem; padding:0.4rem 0; border-bottom:1px solid #f0e6cc; font-size:0.88rem;"><span>${escapeHtml(c.craftsmanType || '')} • ${escapeHtml(c.craftsmanName || c.description || '—')}</span><span style="margin-right:auto; font-weight:600;">${formatCurrencySYP(Number(c.amountSYP)||0)} / ${formatCurrencyUSD(Number(c.amountUSD)||0)}</span><span style="color:var(--color-gray);">${formatDate(c.date)}</span></div>`).join('') : '<div style="color:var(--color-gray); font-size:0.85rem;">لا توجد مدفوعات حرفيين.</div>'}
                </div>
                <div style="width:100%;">
                    <h4 style="margin:0 0 0.5rem; font-size:0.95rem; font-weight:700;">مواد هذه الدفعة</h4>
                    ${(nestedMaterials && nestedMaterials.length>0) ? nestedMaterials.map(m => `<div style="display:flex; gap:1rem; padding:0.4rem 0; border-bottom:1px solid #f0e6cc; font-size:0.88rem;"><span>${escapeHtml(m.materialName || '—')}</span><span style="margin-right:auto; font-weight:600;">${formatCurrencySYP(Number(m.amountSYP)||0)} / ${formatCurrencyUSD(Number(m.amountUSD)||0)}</span><span style="color:var(--color-gray);">${formatDate(m.date)}</span></div>`).join('') : '<div style="color:var(--color-gray); font-size:0.85rem;">لا توجد مواد.</div>'}
                </div>
            </div>
        </td></tr>`
        : '';
    return `
        <tr data-cpay-id="${cp.id}">
            <td class="amount-cell amount-paid">${formatCurrencySYP(totalSYP)}</td>
            <td class="amount-cell amount-pending">${formatCurrencyUSD(totalUSD)}</td>
            <td>${escapeHtml(cp.materialName || '—')}</td>
            <td>${formatDate(cp.date)}</td>
        </tr>
        ${craftsmenViewHtml}
    `;
}

function nestedCraftsmanRowHtml(cr, isAdmin) {
    if (!isAdmin) return '';
    const t = cr.craftsmanType || '';
    const nm = cr.craftsmanName || '';
    let profs;
    try { profs = getAllProfessions(); } catch(e) { profs = DEFAULT_PROFESSIONS; }
    const isCustom = t && profs.length && !profs.some(p => p.name === t);
    let profSelectHtml;
    try {
        profSelectHtml = getProfessionSelectHtml(t, `class="nested-craftsman-type" style="width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.96rem !important; min-height:38px !important; border:1.5px solid #d4af37 !important; background:#fff !important; color:#000 !important; display:block !important;"`, true);
    } catch (e) {
        profSelectHtml = `<input type="text" class="nested-craftsman-type" value="${escapeHtml(t)}" placeholder="نوع الوظيفة (مثل: نجار / كهربائي)" style="width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.96rem !important; min-height:38px !important; border:1.5px solid #d4af37 !important; background:#fff !important; color:#000 !important; display:block !important;">`;
    }
    return `
        <tr data-nested-craftsman="${cr.id || ('nc_' + Date.now())}">
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="number" class="nested-craftsman-syp" min="0" value="${Number(cr.amountSYP) || 0}" placeholder="مثل 200000" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.95rem !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important; min-height:40px;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="number" class="nested-craftsman-usd" min="0" value="${Number(cr.amountUSD) || 0}" placeholder="مثل 100" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.95rem !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important; min-height:40px;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;">
                <div style="display:flex; flex-direction:column; gap:0.35rem; min-width:0;">
                    ${profSelectHtml}
                    <input type="text" class="nested-craftsman-type-other" value="${escapeHtml(isCustom ? t : '')}" placeholder="اكتب نوع الوظيفة هنا..." style="${isCustom ? '' : 'display:none;'} width:100%; padding:0.5rem 0.65rem; font-size:0.9rem; min-height:36px; border:1.5px solid #c9a235; background:#ffffff; color:#000000;">
                    <input type="text" class="nested-craftsman-name" value="${escapeHtml(nm || '')}" placeholder="اسم الحرفي: مثلاً أبو محمد" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.96rem !important; min-height:38px !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000 !important;">
                </div>
            </td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell; width:17%;"><input type="date" class="nested-craftsman-date" value="${formatDateInput(cr.date)}" style="display:block !important; width:100% !important; padding:0.4rem 0.5rem !important; font-size:0.85rem !important; min-height:38px; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell; width:5%;">
                <button type="button" class="icon-btn icon-btn-delete" style="padding:0.3rem 0.45rem; font-size:0.85rem; min-width:32px; min-height:32px;" onclick="removeNestedCraftsman(this)"><i class="fas fa-times"></i></button>
            </td>
        </tr>
    `;
}

function nestedMaterialRowHtml(mr, isAdmin) {
    if (!isAdmin) return '';
    return `
        <tr data-nested-material="${mr.id || ('nm_' + Date.now())}">
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="number" class="nested-material-syp" min="0" value="${Number(mr.amountSYP) || 0}" placeholder="مثل 150000" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.95rem !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important; min-height:40px;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="number" class="nested-material-usd" min="0" value="${Number(mr.amountUSD) || 0}" placeholder="مثل 50" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.95rem !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important; min-height:40px;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="text" class="nested-material-name" value="${escapeHtml(mr.materialName || '')}" placeholder="اسم المادة: مثلاً أسمنت / حديد / طوب" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.96rem !important; min-height:38px; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell; width:17%;"><input type="date" class="nested-material-date" value="${formatDateInput(mr.date)}" style="display:block !important; width:100% !important; padding:0.4rem 0.5rem !important; font-size:0.85rem !important; min-height:38px; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell; width:5%;">
                <button type="button" class="icon-btn icon-btn-delete" style="padding:0.3rem 0.45rem; font-size:0.85rem; min-width:32px; min-height:32px;" onclick="removeNestedMaterial(this)"><i class="fas fa-times"></i></button>
            </td>
        </tr>
    `;
}

function addNestedCraftsmanRow(cpayBlockId) {
    try {
        const table = document.querySelector(`table[data-nested-craftsmen-table="${cpayBlockId}"]`);
        if (!table) { toast('خطأ تقني', 'لم يتم إيجاد جدول الحرفيين — جرب تحديث الصفحة', 'error'); return; }
        let tbody = table.querySelector('tbody');
        if (!tbody) { tbody = document.createElement('tbody'); table.appendChild(tbody); }
        const emptyMsg = tbody.querySelector(`tr[data-empty-nested-craftsmen="${cpayBlockId}"]`);
        if (emptyMsg) emptyMsg.remove();
        const tempId = 'new_nc_' + Date.now() + Math.floor(Math.random() * 10000);
        const tr = document.createElement('tr');
        tr.setAttribute('data-nested-craftsman', tempId);
        let profSelectHtml;
        try {
            profSelectHtml = getProfessionSelectHtml('', `class="nested-craftsman-type" style="width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.96rem !important; min-height:38px !important; border:1.5px solid #d4af37 !important; background:#fff !important; color:#000 !important; display:block !important;"`, true);
        } catch (e) {
            profSelectHtml = `<input type="text" class="nested-craftsman-type" placeholder="نوع الوظيفة (مثل: نجار / كهربائي)" style="width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.96rem !important; min-height:38px !important; border:1.5px solid #d4af37 !important; background:#fff !important; color:#000 !important; display:block !important;">`;
        }
        tr.innerHTML = `
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="number" class="nested-craftsman-syp" min="0" value="0" placeholder="مثل 200000" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.95rem !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important; min-height:40px;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="number" class="nested-craftsman-usd" min="0" value="0" placeholder="مثل 100" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.95rem !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important; min-height:40px;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;">
                <div style="display:flex; flex-direction:column; gap:0.35rem; min-width:0;">
                    ${profSelectHtml}
                    <input type="text" class="nested-craftsman-type-other" placeholder="اكتب نوع الوظيفة هنا..." style="display:none; width:100%; padding:0.5rem 0.65rem; font-size:0.9rem; min-height:36px; border:1.5px solid #c9a235; background:#ffffff; color:#000000;">
                    <input type="text" class="nested-craftsman-name" placeholder="اسم الحرفي: مثلاً أبو محمد" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.96rem !important; min-height:38px !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000 !important;">
                </div>
            </td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell; width:17%;"><input type="date" class="nested-craftsman-date" value="${todayStr()}" style="display:block !important; width:100% !important; padding:0.4rem 0.5rem !important; font-size:0.85rem !important; min-height:38px; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell; width:5%;">
                <button type="button" class="icon-btn icon-btn-delete" style="padding:0.3rem 0.45rem; font-size:0.85rem; min-width:32px; min-height:32px;" onclick="removeNestedCraftsman(this)"><i class="fas fa-times"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
        try { attachCraftsmanProfessionToggle(tr, 'nested-craftsman-type', 'nested-craftsman-type-other'); } catch (_) {}
    } catch (err) {
        console.error('addNestedCraftsmanRow error:', err);
        toast('خطأ', 'تعذر إضافة حرفي جديد: ' + (err.message || 'خطأ غير معروف'), 'error');
    }
    updateAmountsLive();
}

function removeNestedCraftsman(btn) {
    const tr = btn.closest('tr');
    if (!tr) return;
    const tbody = tr.parentElement;
    const table = tbody?.parentElement;
    const cpayBlockId = table ? table.getAttribute('data-nested-craftsmen-table') : null;
    tr.remove();
    if (cpayBlockId && tbody) {
        const remaining = tbody.querySelectorAll('tr[data-nested-craftsman]');
        const tfoot = table ? table.querySelector('tfoot') : null;
        if (remaining.length === 0) {
            const oldEmpty = tbody.querySelector(`tr[data-empty-nested-craftsmen="${cpayBlockId}"]`);
            if (oldEmpty) oldEmpty.remove();
            if (tfoot) tfoot.remove();
            setTimeout(() => addNestedCraftsmanRow(cpayBlockId), 0);
        }
    }
    updateAmountsLive();
}

function addNestedMaterialRow(cpayBlockId) {
    try {
        const table = document.querySelector(`table[data-nested-materials-table="${cpayBlockId}"]`);
        if (!table) { toast('خطأ تقني', 'لم يتم إيجاد جدول المواد — جرب تحديث الصفحة', 'error'); return; }
        let tbody = table.querySelector('tbody');
        if (!tbody) { tbody = document.createElement('tbody'); table.appendChild(tbody); }
        const emptyMsg = tbody.querySelector(`tr[data-empty-nested-materials="${cpayBlockId}"]`);
        if (emptyMsg) emptyMsg.remove();
        const tempId = 'new_nm_' + Date.now() + Math.floor(Math.random() * 10000);
        const tr = document.createElement('tr');
        tr.setAttribute('data-nested-material', tempId);
        tr.innerHTML = `
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="number" class="nested-material-syp" min="0" value="0" placeholder="مثل 150000" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.95rem !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important; min-height:40px;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="number" class="nested-material-usd" min="0" value="0" placeholder="مثل 50" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.95rem !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important; min-height:40px;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="text" class="nested-material-name" placeholder="اسم المادة: مثلاً أسمنت / حديد / طوب" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.96rem !important; min-height:38px; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell; width:17%;"><input type="date" class="nested-material-date" value="${todayStr()}" style="display:block !important; width:100% !important; padding:0.4rem 0.5rem !important; font-size:0.85rem !important; min-height:38px; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell; width:5%;">
                <button type="button" class="icon-btn icon-btn-delete" style="padding:0.3rem 0.45rem; font-size:0.85rem; min-width:32px; min-height:32px;" onclick="removeNestedMaterial(this)"><i class="fas fa-times"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    } catch (err) {
        console.error('addNestedMaterialRow error:', err);
        toast('خطأ', 'تعذر إضافة مادة جديدة: ' + (err.message || 'خطأ غير معروف'), 'error');
    }
    updateAmountsLive();
}

function removeNestedMaterial(btn) {
    const tr = btn.closest('tr');
    if (!tr) return;
    const tbody = tr.parentElement;
    const table = tbody?.parentElement;
    const cpayBlockId = table ? table.getAttribute('data-nested-materials-table') : null;
    tr.remove();
    if (cpayBlockId && tbody) {
        const remaining = tbody.querySelectorAll('tr[data-nested-material]');
        const tfoot = table ? table.querySelector('tfoot') : null;
        if (remaining.length === 0) {
            const oldEmpty = tbody.querySelector(`tr[data-empty-nested-materials="${cpayBlockId}"]`);
            if (oldEmpty) oldEmpty.remove();
            if (tfoot) tfoot.remove();
            setTimeout(() => addNestedMaterialRow(cpayBlockId), 0);
        }
    }
    updateAmountsLive();
}

function addClientPaymentRow() {
    const tbody = document.getElementById('clientPaymentsTbody');
    if (!tbody) return;
    const emptyRow = tbody.querySelector('tr td[colspan]');
    if (emptyRow) tbody.innerHTML = '';
    const tempId = 'new_cpay_' + Date.now();
    const dummyCp = {
        id: tempId,
        amountSYP: 0,
        amountUSD: 0,
        materialName: '',
        date: todayStr(),
        craftsmen: [],
        materials: []
    };
    const wrapHtml = renderClientPaymentRowFull(dummyCp, 0, true);
    const tempContainer = document.createElement('tbody');
    tempContainer.innerHTML = wrapHtml;
    const nodes = Array.from(tempContainer.children);
    nodes.forEach(n => tbody.appendChild(n));
    setTimeout(() => {
        const block = document.querySelector(`tr[data-cpay-nested="cpay-block-${tempId}"]`);
        if (block) {
            block.querySelectorAll('tr[data-nested-craftsman]').forEach(r => {
                try { attachCraftsmanProfessionToggle(r, 'nested-craftsman-type', 'nested-craftsman-type-other'); } catch (_) {}
            });
        }
    }, 20);
    updateAmountsLive();
    updateClientPaymentsFooter();
}

function removeClientPaymentRow(btn) {
    const tr = btn.closest('tr');
    if (!tr) return;
    const blockId = tr.getAttribute('data-cpay-block');
    const nested = blockId ? document.querySelector(`tr[data-cpay-nested="${blockId}"]`) : null;
    if (nested) nested.remove();
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
        const blockId = row.getAttribute('data-cpay-block');
        const amountSYP = row.querySelector('.cpay-amount-syp')?.value;
        const amountUSD = row.querySelector('.cpay-amount-usd')?.value;
        const materialName = row.querySelector('.cpay-material-name')?.value;
        const date = row.querySelector('.cpay-date')?.value;
        const craftsmenArr = [];
        const materialsArr = [];
        if (blockId) {
            const craftTable = document.querySelector(`table[data-nested-craftsmen-table="${blockId}"]`);
            if (craftTable) {
                craftTable.querySelectorAll('tbody tr[data-nested-craftsman]').forEach(ctr => {
                    const cid = ctr.getAttribute('data-nested-craftsman') || generateId('ncraft');
                    const cSYP = Number(ctr.querySelector('.nested-craftsman-syp')?.value) || 0;
                    const cUSD = Number(ctr.querySelector('.nested-craftsman-usd')?.value) || 0;
                    const cType = getCraftsmanProfessionFromRow(ctr, 'nested-craftsman-type', 'nested-craftsman-type-other');
                    const cName = (ctr.querySelector('.nested-craftsman-name')?.value || '').trim();
                    const cDate = ctr.querySelector('.nested-craftsman-date')?.value;
                    if (cSYP === 0 && cUSD === 0 && !cType && !cName) return;
                    craftsmenArr.push({ id: cid, amountSYP: cSYP, amountUSD: cUSD, craftsmanType: cType, craftsmanName: cName, date: cDate, description: (cType || '') + ' ' + (cName || '') });
                });
            }
            const matTable = document.querySelector(`table[data-nested-materials-table="${blockId}"]`);
            if (matTable) {
                matTable.querySelectorAll('tbody tr[data-nested-material]').forEach(mtr => {
                    const mid = mtr.getAttribute('data-nested-material') || generateId('nmat');
                    const mSYP = Number(mtr.querySelector('.nested-material-syp')?.value) || 0;
                    const mUSD = Number(mtr.querySelector('.nested-material-usd')?.value) || 0;
                    const mName = (mtr.querySelector('.nested-material-name')?.value || '').trim();
                    const mDate = mtr.querySelector('.nested-material-date')?.value;
                    if (mSYP === 0 && mUSD === 0 && !mName) return;
                    materialsArr.push({ id: mid, amountSYP: mSYP, amountUSD: mUSD, materialName: mName, date: mDate });
                });
            }
        }
        cps.push({ id, amountSYP, amountUSD, materialName, date, craftsmen: craftsmenArr, materials: materialsArr });
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
                        لا توجد دفعات مستلمة بعد. اضغط "إضافة دفعة مستقلة" للبدء — تحت كل دفعة تستطيع تسجيل مدفوعات الحرفيين والمواد مباشرة.
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
                <td><strong>${formatCurrencySYP(totalSYP)}</strong></td>
                <td><strong>${formatCurrencyUSD(totalUSD)}</strong></td>
                <td colspan="2" style="text-align:left;"><strong>إجمالي المبالغ المستلمة</strong></td>
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
        const description = row.querySelector('.pay-description')?.value;
        const date = row.querySelector('.pay-date')?.value;
        payments.push({ id, amountSYP, amountUSD, craftsmanType: type, craftsmanName: name, description, date });
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
                <td colspan="7" style="text-align:center; padding:2.5rem 1rem; color:var(--color-gray);">
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
                <td><strong>${formatCurrencySYP(totalSYP)}</strong></td>
                <td><strong>${formatCurrencyUSD(totalUSD)}</strong></td>
                <td colspan="4" style="text-align:left;"><strong>إجمالي المدفوعات</strong></td>
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
    const clientPayments = collectClientPaymentsFromDOM();
    const sitePhotos = currentSitePhotos.length > 0 ? currentSitePhotos : getCurrentInvoicePhotos();

    if (!customerName.trim()) {
        toast('مطلوب اسم العميل', 'يرجى إدخال اسم العميل', 'warning');
        document.getElementById('editCustomerName')?.focus();
        return;
    }

    const finalInvoice = updateInvoice(invoiceId, {
        customerName: customerName.trim(),
        agreedAmountSYP,
        agreedAmountUSD,
        clientPayments,
        payments: [],
        materials: [],
        sitePhotos
    });
    currentSitePhotos = [];

    if (finalInvoice) {
        const syncRes = syncInvoiceCraftsmenToWorkers(finalInvoice.id, customerName.trim(), finalInvoice.clientPayments || []);
        const totalSync = syncRes.linked + syncRes.updated + syncRes.removed;
        if (totalSync > 0) {
            let parts = [];
            if (syncRes.linked) parts.push(`${syncRes.linked} دفعة جديدة`);
            if (syncRes.updated) parts.push(`${syncRes.updated} تحديث`);
            if (syncRes.removed) parts.push(`${syncRes.removed} حذف`);
            setTimeout(() => toast('🔗 ربط تلقائي بأجور العمال', parts.join('، ') + ' تحت أسماء العمال المطابقة', 'info'), 500);
        }
    }

    toast('تم الحفظ', 'تم تحديث الفاتورة بنجاح', 'success');
    renderCurrentRoute();
}

// ============================================
// ربط تلقائي: حرفيين الفاتورة ↔ أجور العمال
// ============================================
function syncInvoiceCraftsmenToWorkers(invoiceId, customerName, clientPayments) {
    if (!invoiceId || !Array.isArray(clientPayments)) return { linked: 0, updated: 0, removed: 0, skipped: 0 };
    const workers = getAllWorkers();
    let dirty = false;
    let linkedCount = 0;
    let updatedCount = 0;
    let removedCount = 0;
    let skippedCount = 0;
    const seenSourceIds = new Set();

    // 🤖 تطبيع ذكي + قوي: يوحد الألف/الياء/التاء/الهمزات ويزيل التشكيل والمسافات الزائدة
    // هذا يضمن "محمد" و "محمّد" و "محم د" يعتبرون نفس الاسم، و"الالمنيوم" و"الألمنيوم" نفس الوظيفة
    const cNorm = (s) => {
        return (s == null ? '' : s.toString())
            .replace(/[\u064B-\u0652\u0670\u0640]/g, '') // إزالة التشكيل + التطويل
            .replace(/[إأآا]/g, 'ا')                      // توحيد الألف
            .replace(/[ىي]/g, 'ي')                        // توحيد الياء
            .replace(/ة/g, 'ه')                           // توحيد التاء المربوطة
            .replace(/\s+/g, ' ')                          // توحيد المسافات
            .trim()
            .toLowerCase();
    };

    clientPayments.forEach(cp => {
        const crafts = Array.isArray(cp.craftsmen) ? cp.craftsmen : [];
        crafts.forEach(c => {
            const amtSYP = Number(c.amountSYP) || 0;
            const amtUSD = Number(c.amountUSD) || 0;
            if (amtSYP <= 0 && amtUSD <= 0) { skippedCount++; return; }
            const cName = cNorm(c.craftsmanName);
            const cProf = cNorm(c.craftsmanType);
            if (!cName) { skippedCount++; return; }
            const sourceId = String(c.id || '');
            if (!sourceId) { skippedCount++; return; }
            seenSourceIds.add(sourceId);

            // 🛡️ مطابقة صارمة بالاسم + الوظيفة (التطبيع الذكي يلتقط الفروقات البسيطة)
            let wIdx = workers.findIndex(w =>
                cNorm(w.name) === cName &&
                cNorm(w.profession) === cProf
            );
            // ⛔ ملاحظة: تم حذف بحث "بالاسم فقط" السابق عمداً لمنع دمج دفعات موظف بوظيفة مختلفة
            // (مثلاً "أحمد الحداد" و "أحمد النجار" صاروا منفصلين بدل دمج دفعاتهم خطأً)
            if (wIdx === -1) {
                // حماية ذكية: الموظف مش مسجّل بعد → ما بنشئ سجل مكرر، فقط نتجاهل الدفعة بأمان
                skippedCount++;
                return;
            }
            const w = workers[wIdx];
            w.payments = w.payments || [];
            const payIdx = w.payments.findIndex(p =>
                p.sourceId === sourceId && p.invoiceId === invoiceId
            );
            const noteText = `من فاتورة العميل: ${customerName || '—'}${cp.materialName ? ' • ' + cp.materialName : ''}`;
            if (payIdx >= 0) {
                const p = w.payments[payIdx];
                if ((Number(p.amountSYP) || 0) !== amtSYP ||
                    (Number(p.amountUSD) || 0) !== amtUSD ||
                    (p.date || '') !== (c.date || '') ||
                    (p.note || '') !== noteText) {
                    w.payments[payIdx] = {
                        ...p,
                        amountSYP: amtSYP,
                        amountUSD: amtUSD,
                        date: c.date || p.date || todayStr(),
                        note: noteText,
                        updatedAt: new Date().toISOString()
                    };
                    w.updatedAt = new Date().toISOString();
                    dirty = true;
                    updatedCount++;
                }
            } else {
                w.payments.unshift({
                    id: generateId('wpay'),
                    sourceId: sourceId,
                    invoiceId: invoiceId,
                    amountSYP: amtSYP,
                    amountUSD: amtUSD,
                    date: c.date || todayStr(),
                    note: noteText,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
                w.updatedAt = new Date().toISOString();
                dirty = true;
                linkedCount++;
            }
        });
    });

    workers.forEach((w, idx) => {
        if (!Array.isArray(w.payments) || w.payments.length === 0) return;
        const before = w.payments.length;
        w.payments = w.payments.filter(p => {
            if (p.invoiceId !== invoiceId || !p.sourceId) return true;
            return seenSourceIds.has(p.sourceId);
        });
        if (w.payments.length !== before) {
            removedCount += (before - w.payments.length);
            w.updatedAt = new Date().toISOString();
            dirty = true;
        }
    });

    if (dirty) saveAllWorkers(workers);

    // 🪵 تشخيص للتطوير
    if (linkedCount > 0 || updatedCount > 0 || removedCount > 0 || skippedCount > 0) {
        console.log(
            `%c[SyncCrafts→Workers v3.16]%c invoice=${invoiceId} | linked=${linkedCount} updated=${updatedCount} removed=${removedCount} skipped=${skippedCount}`,
            'background:#1d4ed8;color:#fff;font-weight:bold;padding:2px 6px;border-radius:4px;',
            'color:#1d4ed8;'
        );
    }

    return { linked: linkedCount, updated: updatedCount, removed: removedCount, skipped: skippedCount };
}

// ============================================
// Create / Edit Invoice Modal
// ============================================

function openCreateInvoiceModal() {
    try {
        currentModalSitePhotos = [];
        const content = renderInvoiceFormModal(null);
        showModal(content, { title: 'إنشاء فاتورة جديدة', isLarge: true, footer: `
            <button class="btn btn-outline" onclick="closeModal()">إلغاء</button>
            <button class="btn btn-gold" onclick="submitInvoiceForm(null)">
                <i class="fas fa-check"></i>
                إنشاء الفاتورة
            </button>
        `});
        setTimeout(() => {
            document.querySelectorAll('tr[data-modal-nested-craftsman]').forEach(tr => {
                try { attachCraftsmanProfessionToggle(tr, 'modal-nested-craftsman-type', 'modal-nested-craftsman-type-other'); } catch(_) {}
            });
        }, 80);
    } catch (err) {
        console.error('openCreateInvoiceModal CRASH:', err);
        toast('خطأ جسيم', 'تعذر فتح نموذج إنشاء الفاتورة: ' + (err.message || err), 'error');
    }
}

function openEditInvoiceModal(invoiceId) {
    try {
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
        setTimeout(() => {
            renderModalSitePhotosGrid();
            document.querySelectorAll('tr[data-modal-nested-craftsman]').forEach(tr => {
                try { attachCraftsmanProfessionToggle(tr, 'modal-nested-craftsman-type', 'modal-nested-craftsman-type-other'); } catch(_) {}
            });
        }, 80);
    } catch (err) {
        console.error('openEditInvoiceModal CRASH:', err);
        toast('خطأ جسيم', 'تعذر فتح نموذج تعديل الفاتورة: ' + (err.message || err), 'error');
    }
}

// ===== Renderer خاص بالمودال: nested حرفيين + مواد تحت كل clientPayment =====
function renderModalClientPaymentRowFull(cp, idx) {
    const totalSYP = Number(cp.amountSYP) || 0;
    const totalUSD = Number(cp.amountUSD) || 0;
    const nestedCraftsmen = Array.isArray(cp.craftsmen) ? cp.craftsmen : [];
    const nestedMaterials = Array.isArray(cp.materials) ? cp.materials : [];
    const totalCraftSYP = nestedCraftsmen.reduce((s, x) => s + (Number(x.amountSYP) || 0), 0);
    const totalCraftUSD = nestedCraftsmen.reduce((s, x) => s + (Number(x.amountUSD) || 0), 0);
    const totalMatSYP = nestedMaterials.reduce((s, x) => s + (Number(x.amountSYP) || 0), 0);
    const totalMatUSD = nestedMaterials.reduce((s, x) => s + (Number(x.amountUSD) || 0), 0);
    const mcpayBlockId = 'mcpay-block-' + (cp.id || ('tmp' + Date.now() + '_' + idx));

    const modalNestedCraftsmanRowHtml = (c) => {
        const t = c.craftsmanType || '';
        const nm = c.craftsmanName || '';
        let profs;
        try { profs = getAllProfessions(); } catch(e) { try { profs = DEFAULT_PROFESSIONS; } catch(e2) { profs = []; } }
        const isCustom = t && profs.length && !profs.some(p => p.name === t);
        let profSelectHtml;
        try {
            profSelectHtml = getProfessionSelectHtml(t, `class="modal-nested-craftsman-type" style="width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.96rem !important; min-height:38px !important; border:1.5px solid #d4af37 !important; background:#fff !important; color:#000 !important; display:block !important;"`, true);
        } catch (e) {
            profSelectHtml = `<input type="text" class="modal-nested-craftsman-type" value="${escapeHtml(t)}" placeholder="نوع الوظيفة (مثل: نجار / كهربائي)" style="width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.96rem !important; min-height:38px !important; border:1.5px solid #d4af37 !important; background:#fff !important; color:#000 !important; display:block !important;">`;
        }
        const cid = c.id || ('mnc_' + Date.now() + Math.random());
        return `
        <tr data-modal-nested-craftsman="${cid}">
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="number" class="modal-nested-craftsman-syp" min="0" value="${Number(c.amountSYP) || 0}" placeholder="مثل 200000" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.95rem !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important; min-height:40px;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="number" class="modal-nested-craftsman-usd" min="0" value="${Number(c.amountUSD) || 0}" placeholder="مثل 100" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.95rem !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important; min-height:40px;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;">
                <div style="display:flex; flex-direction:column; gap:0.35rem; min-width:0;">
                    ${profSelectHtml}
                    <input type="text" class="modal-nested-craftsman-type-other" value="${escapeHtml(isCustom ? t : '')}" placeholder="اكتب نوع الوظيفة هنا..." style="${isCustom ? '' : 'display:none;'} width:100%; padding:0.5rem 0.65rem; font-size:0.9rem; min-height:36px; border:1.5px solid #c9a235; background:#ffffff; color:#000000;">
                    <input type="text" class="modal-nested-craftsman-name" value="${escapeHtml(nm || '')}" placeholder="اسم الحرفي: مثلاً أبو محمد" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.96rem !important; min-height:38px !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000 !important;">
                </div>
            </td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell; width:17%;"><input type="date" class="modal-nested-craftsman-date" value="${formatDateInput(c.date)}" style="display:block !important; width:100% !important; padding:0.4rem 0.5rem !important; font-size:0.85rem !important; min-height:38px; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell; width:5%;">
                <button type="button" class="icon-btn icon-btn-delete" style="padding:0.3rem 0.45rem; font-size:0.85rem; min-width:32px; min-height:32px;" onclick="modalRemoveNestedCraftsman(this)"><i class="fas fa-times"></i></button>
            </td>
        </tr>
    `};
    const effectiveCraftsmen = nestedCraftsmen.length > 0
        ? nestedCraftsmen
        : [{ id: 'mnc_starter', amountSYP: 0, amountUSD: 0, craftsmanType: '', craftsmanName: '', date: todayStr() }];
    const craftsmenRowsHtml = effectiveCraftsmen.map(cr => modalNestedCraftsmanRowHtml(cr)).join('');
    const showCraftFooter = nestedCraftsmen.length > 0;
    const modalNestedMaterialRowHtml = (m) => `
        <tr data-modal-nested-material="${m.id || ('mnm_' + Date.now() + Math.random())}">
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="number" class="modal-nested-material-syp" min="0" value="${Number(m.amountSYP) || 0}" placeholder="مثل 150000" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.95rem !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important; min-height:40px;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="number" class="modal-nested-material-usd" min="0" value="${Number(m.amountUSD) || 0}" placeholder="مثل 50" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.95rem !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important; min-height:40px;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="text" class="modal-nested-material-name" value="${escapeHtml(m.materialName || '')}" placeholder="اسم المادة: مثلاً أسمنت / حديد / طوب" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.96rem !important; min-height:38px; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell; width:17%;"><input type="date" class="modal-nested-material-date" value="${formatDateInput(m.date)}" style="display:block !important; width:100% !important; padding:0.4rem 0.5rem !important; font-size:0.85rem !important; min-height:38px; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell; width:5%;">
                <button type="button" class="icon-btn icon-btn-delete" style="padding:0.3rem 0.45rem; font-size:0.85rem; min-width:32px; min-height:32px;" onclick="modalRemoveNestedMaterial(this)"><i class="fas fa-times"></i></button>
            </td>
        </tr>
    `;
    const effectiveMaterials = nestedMaterials.length > 0
        ? nestedMaterials
        : [{ id: 'mnm_starter', amountSYP: 0, amountUSD: 0, materialName: '', date: todayStr() }];
    const materialsRowsHtml = effectiveMaterials.map(mr => modalNestedMaterialRowHtml(mr)).join('');
    const showMatFooter = nestedMaterials.length > 0;

    return `
        <tr data-mcpay-id="${cp.id}" data-mcpay-block="${mcpayBlockId}" style="background:linear-gradient(90deg,#fffdf5 0%,#faf4e2 100%); border-top:2px solid var(--color-gold-dark);">
            <td style="padding:0.6rem;">
                <input type="number" min="0" class="mcpay-amount-syp big-price" value="${totalSYP}" placeholder="الدفعة بالليرة" style="font-size:1.1rem; padding:0.7rem 0.85rem; border-color:#c9a235;">
            </td>
            <td style="padding:0.6rem;">
                <input type="number" min="0" class="mcpay-amount-usd big-price" value="${totalUSD}" placeholder="الدفعة بالدولار" style="font-size:1.1rem; padding:0.7rem 0.85rem; border-color:#c9a235;">
            </td>
            <td style="padding:0.6rem;">
                <input type="text" class="mcpay-material-name" value="${escapeHtml(cp.materialName || '')}" placeholder="وصف الدفعة: مثلاً دفعة أولى / دفعة سقف / دفعة نهائية" style="font-size:1rem; padding:0.6rem 0.8rem; min-height:42px; border-color:#e0c57a;">
            </td>
            <td style="padding:0.6rem; width:15%;">
                <input type="date" class="mcpay-date" value="${formatDateInput(cp.date)}" style="font-size:0.85rem; padding:0.45rem 0.55rem; min-height:40px;">
            </td>
            <td style="padding:0.6rem;">
                <button type="button" class="icon-btn icon-btn-delete" onclick="modalRemoveClientPayment(this)" title="حذف هالدفعة بأكملها">
                    <i class="fas fa-times"></i>
                </button>
            </td>
        </tr>
        <tr class="cpay-nested-block" data-mcpay-nested="${mcpayBlockId}">
            <td colspan="5" style="padding:1rem 1.2rem 1.4rem; background:#fefaf0; border-top:2px dashed #d4a942; border-bottom:2px solid #e8dfc8;">
                <div style="background:#fff; border:1.5px solid #eadfc4; border-radius:12px; padding:1rem 1.1rem; box-shadow:0 2px 6px rgba(180,150,70,0.08);">
                <div class="cpay-nested-grid" style="display:flex; flex-direction:column; gap:1.2rem;">
                    <!-- القسم الأول: أجور الحرفيين للدفعة هذه (بعرض كامل فوق) -->
                    <div class="cpay-nested-section" style="width:100%;">
                        <div class="cpay-nested-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.7rem; padding-bottom:0.55rem; border-bottom:1.5px solid #e8dfc8;">
                            <h4 style="margin:0; font-size:1.05rem; color:var(--color-black); font-weight:700;">
                                أجور الحرفيين (من هالدفعة)
                            </h4>
                            <button type="button" class="btn btn-outline-gold btn-sm" style="font-size:0.82rem; padding:0.3rem 0.7rem;" onclick="modalAddNestedCraftsman('${mcpayBlockId}')">
                                <i class="fas fa-plus"></i>
                                إضافة حرفي
                            </button>
                        </div>
                        <div class="craftsmen-table-wrapper" style="box-shadow:none; border:1px solid #eadfc4; border-radius:10px; overflow:hidden;">
                            <table class="craftsmen-table" data-modal-nested-craftsmen-table="${mcpayBlockId}">
                                <thead>
                                    <tr>
                                        <th style="width:16%; padding:0.5rem; font-size:0.85rem; background:#fdf7e7;">ل.س</th>
                                        <th style="width:16%; padding:0.5rem; font-size:0.85rem; background:#fdf7e7;">$</th>
                                        <th style="padding:0.5rem; font-size:0.85rem; background:#fdf7e7;">نوع الشغل + اسم الحرفي</th>
                                        <th style="width:16%; padding:0.5rem; font-size:0.85rem; background:#fdf7e7;">التاريخ</th>
                                        <th style="width:5%; padding:0.5rem; background:#fdf7e7;"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${craftsmenRowsHtml}
                                </tbody>
                                ${showCraftFooter ? `
                                    <tfoot>
                                        <tr style="background:#fff0c7; font-weight:700; font-size:0.88rem;">
                                            <td style="padding:0.6rem;">${formatCurrencySYP(totalCraftSYP)}</td>
                                            <td style="padding:0.6rem;">${formatCurrencyUSD(totalCraftUSD)}</td>
                                            <td colspan="2" style="text-align:left; padding:0.6rem;">إجمالي أجور الحرفيين من هالدفعة</td>
                                            <td style="padding:0.6rem;"></td>
                                        </tr>
                                    </tfoot>
                                ` : ''}
                            </table>
                        </div>
                    </div>
                    <!-- القسم الثاني: مواد / مستلزمات للدفعة هذه (تحت الحرفيين بعرض كامل) -->
                    <div class="cpay-nested-section" style="width:100%;">
                        <div class="cpay-nested-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.7rem; padding-bottom:0.55rem; border-bottom:1.5px solid #e8dfc8;">
                            <h4 style="margin:0; font-size:1.05rem; color:var(--color-black); font-weight:700;">
                                مواد ومستلزمات (من هالدفعة)
                            </h4>
                            <button type="button" class="btn btn-outline-gold btn-sm" style="font-size:0.82rem; padding:0.3rem 0.7rem;" onclick="modalAddNestedMaterial('${mcpayBlockId}')">
                                <i class="fas fa-plus"></i>
                                إضافة مادة
                            </button>
                        </div>
                        <div class="craftsmen-table-wrapper" style="box-shadow:none; border:1px solid #eadfc4; border-radius:10px; overflow:hidden;">
                            <table class="craftsmen-table" data-modal-nested-materials-table="${mcpayBlockId}">
                                <thead>
                                    <tr>
                                        <th style="width:16%; padding:0.5rem; font-size:0.85rem; background:#fdf7e7;">ل.س</th>
                                        <th style="width:16%; padding:0.5rem; font-size:0.85rem; background:#fdf7e7;">$</th>
                                        <th style="padding:0.5rem; font-size:0.85rem; background:#fdf7e7;">اسم المادة</th>
                                        <th style="width:16%; padding:0.5rem; font-size:0.85rem; background:#fdf7e7;">التاريخ</th>
                                        <th style="width:5%; padding:0.5rem; background:#fdf7e7;"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${materialsRowsHtml}
                                </tbody>
                                ${showMatFooter ? `
                                    <tfoot>
                                        <tr style="background:#fff0c7; font-weight:700; font-size:0.88rem;">
                                            <td style="padding:0.6rem;">${formatCurrencySYP(totalMatSYP)}</td>
                                            <td style="padding:0.6rem;">${formatCurrencyUSD(totalMatUSD)}</td>
                                            <td colspan="2" style="text-align:left; padding:0.6rem;">إجمالي المواد المشتراة من هالدفعة</td>
                                            <td style="padding:0.6rem;"></td>
                                        </tr>
                                    </tfoot>
                                ` : ''}
                            </table>
                        </div>
                    </div>
                </div>
                </div>
            </td>
        </tr>
    `;
}

function renderInvoiceFormModal(invoice) {
    const isEdit = !!invoice;
    // ===== نقل البيانات القديمة flat إلى nested عند فتح المودال (retrocompat) =====
    let baseData = invoice ? { ...invoice } : null;
    if (baseData) {
        // Retrocompat: إذا وجدنا payments/materials flat و clientPayments nested فيهما فارغين → ندمج
        const flatPayments = Array.isArray(baseData.payments) ? baseData.payments : [];
        const flatMaterials = Array.isArray(baseData.materials) ? baseData.materials : [];
        if ((flatPayments.length > 0 || flatMaterials.length > 0) && Array.isArray(baseData.clientPayments)) {
            // تجهيز cpays مع nested فارغة إن لزم
            baseData.clientPayments = baseData.clientPayments.map(cp => ({
                ...cp,
                craftsmen: Array.isArray(cp.craftsmen) ? cp.craftsmen : [],
                materials: Array.isArray(cp.materials) ? cp.materials : []
            }));
            if (baseData.clientPayments.length === 0) {
                baseData.clientPayments.push({
                    id: generateId('cpay'),
                    amountSYP: 0,
                    amountUSD: 0,
                    materialName: '',
                    date: todayStr(),
                    craftsmen: [],
                    materials: []
                });
            }
            const target = baseData.clientPayments[0];
            flatPayments.forEach(p => {
                target.craftsmen.push({
                    id: p.id || generateId('ncraft'),
                    amountSYP: Number(p.amountSYP) || 0,
                    amountUSD: Number(p.amountUSD) || 0,
                    craftsmanType: p.craftsmanType || '',
                    craftsmanName: p.craftsmanName || '',
                    description: p.description || '',
                    date: p.date || todayStr()
                });
            });
            flatMaterials.forEach(m => {
                target.materials.push({
                    id: m.id || generateId('nmat'),
                    amountSYP: Number(m.amountSYP) || 0,
                    amountUSD: Number(m.amountUSD) || 0,
                    materialName: m.materialName || '',
                    date: m.date || todayStr()
                });
            });
            // بعد الدمج، فارغ المسطحات حتى لا يعيد دمجها createInvoice/updateInvoice
            baseData.payments = [];
            baseData.materials = [];
        }
        // التأكد من أن كل clientPayment لديه craftsmen + materials كمصفوفات
        if (Array.isArray(baseData.clientPayments)) {
            baseData.clientPayments = baseData.clientPayments.map(cp => ({
                ...cp,
                craftsmen: Array.isArray(cp.craftsmen) ? cp.craftsmen : [],
                materials: Array.isArray(cp.materials) ? cp.materials : []
            }));
        }
    }
    const data = baseData || {
        customerName: '',
        agreedAmountSYP: 0,
        agreedAmountUSD: 0,
        clientPayments: [{ id: generateId('cpay'), amountSYP: 0, amountUSD: 0, materialName: '', note: '', date: todayStr(), craftsmen: [], materials: [] }],
        payments: [],
        materials: []
    };
    if (!Array.isArray(data.clientPayments) || data.clientPayments.length === 0) {
        data.clientPayments = [{ id: generateId('cpay'), amountSYP: 0, amountUSD: 0, materialName: '', note: '', date: todayStr(), craftsmen: [], materials: [] }];
    }
    // التأكد النهائي أن كل cpay لديه nested arrays
    data.clientPayments = data.clientPayments.map(cp => ({
        ...cp,
        craftsmen: Array.isArray(cp.craftsmen) ? cp.craftsmen : [],
        materials: Array.isArray(cp.materials) ? cp.materials : []
    }));

    return `
        <div class="form-group">
            <label class="form-label"><span class="required">*</span>اسم العميل</label>
            <input type="text" id="formCustomerName" class="form-input" value="${escapeHtml(data.customerName)}" placeholder="مثال: أحمد محمد - صاحب الفيلا" style="font-size:1.05rem; padding:0.75rem 0.95rem;">
        </div>

        <div class="form-group">
            <label class="form-label" style="font-size:1rem;">
                <i class="fas fa-handshake" style="color:var(--color-gold-dark); margin-left:0.3rem;"></i>
                <span class="required">*</span>المبلغ المتفق عليه (السعر الكلي للمشروع)
            </label>
            <div style="display:flex; flex-direction:column; gap:0.75rem;">
                <div style="position:relative;">
                    <input type="number" id="formAgreedAmountSYP" class="form-input big-price" min="0" value="${data.agreedAmountSYP}" placeholder="مثال: 5000000 (خمسة ملايين ليرة)" style="font-size:1.15rem; padding:0.9rem 1rem 0.9rem 3.6rem; border-width:2px;">
                    <span style="position:absolute; left:16px; top:50%; transform:translateY(-50%); color:var(--color-gold-dark); font-size:1rem; font-weight:700; pointer-events:none; letter-spacing:0.3px;">ل.س</span>
                </div>
                <div style="position:relative;">
                    <input type="number" id="formAgreedAmountUSD" class="form-input big-price" min="0" value="${data.agreedAmountUSD}" placeholder="مثال: 2000 (ألفين دولار)" style="font-size:1.15rem; padding:0.9rem 1rem 0.9rem 3.6rem; border-width:2px;">
                    <span style="position:absolute; left:16px; top:50%; transform:translateY(-50%); color:var(--color-gold-dark); font-size:1rem; font-weight:700; pointer-events:none; letter-spacing:0.3px;">$</span>
                </div>
            </div>
        </div>

        <hr style="border:none; border-top:1.5px solid var(--color-gold-dark); margin:1.7rem 0;">

        <div class="section-heading" style="margin-bottom:1rem;">
            <h3 style="font-size:1.2rem; font-family:'Cairo',sans-serif; font-weight:700; color:var(--color-black);">
                <i class="fas fa-money-bill-wave" style="color:var(--color-gold-dark); margin-left:0.3rem;"></i>
                الدفعات اللي استلمناها من العميل (واضح تحت كل دفعة وين صار الفلوس)
            </h3>
            <button type="button" class="btn btn-outline-gold btn-sm" onclick="modalAddClientPayment()">
                <i class="fas fa-plus"></i>
                إضافة دفعة جديدة
            </button>
        </div>
        <div style="background:#fff6e6; border:1.5px dashed #d4a942; border-radius:10px; padding:0.8rem 1rem; margin-bottom:1rem; font-size:0.9rem; color:#7a5a1a; line-height:1.7;">
            <i class="fas fa-lightbulb" style="color:#d4a942; margin-left:0.3rem;"></i>
            <strong>كيف العمل:</strong> لكل دفعة مستلمة (مثلاً 1,000,000 ليرة) اكتب تحتها بالتفصيل وين صار الفلوس: كم أخذ النجار، كم أخذ الحداد، كم أنفقت على مواد البناء... وهكذا.
        </div>

        <div class="craftsmen-table-wrapper">
            <table class="craftsmen-table" id="modalClientPaymentsTable">
                <thead>
                    <tr>
                        <th style="width:14%;">ل.س</th>
                        <th style="width:14%;">$</th>
                        <th>اسم / وصف الدفعة</th>
                        <th style="width:15%;">تاريخ الاستلام</th>
                        <th style="width:6%;"></th>
                    </tr>
                </thead>
                <tbody id="modalClientPaymentsTbody">
                    ${(data.clientPayments || []).map((cp, idx) => renderModalClientPaymentRowFull(cp, idx)).join('')}
                </tbody>
            </table>
        </div>

        <hr style="border:none; border-top:1px solid var(--color-gray-light); margin:1.5rem 0;">

        <div class="section-heading" style="margin-bottom:1rem;">
            <h3 style="font-size:1.1rem; font-family:'Playfair Display',serif;">
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

// ============================================
// دوال المودال Nested الخاصة (حرفيين + مواد)
// ============================================

function modalAddNestedCraftsman(mcpayBlockId) {
    try {
        const table = document.querySelector(`table[data-modal-nested-craftsmen-table="${mcpayBlockId}"]`);
        if (!table) { toast('خطأ تقني', 'لم يتم إيجاد جدول الحرفيين — جرب إغلاق المودال وفتحه مرة ثانية', 'error'); return; }
        let tbody = table.querySelector('tbody');
        if (!tbody) { tbody = document.createElement('tbody'); table.appendChild(tbody); }
        const emptyMsg = tbody.querySelector(`tr[data-modal-empty-nested-craftsmen="${mcpayBlockId}"]`);
        if (emptyMsg) emptyMsg.remove();
        const tempId = 'new_mnc_' + Date.now() + Math.floor(Math.random() * 10000);
        const tr = document.createElement('tr');
        tr.setAttribute('data-modal-nested-craftsman', tempId);
        let profSelectHtml;
        try {
            profSelectHtml = getProfessionSelectHtml('', `class="modal-nested-craftsman-type" style="width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.96rem !important; min-height:38px !important; border:1.5px solid #d4af37 !important; background:#fff !important; color:#000 !important; display:block !important;"`, true);
        } catch (e) {
            profSelectHtml = `<input type="text" class="modal-nested-craftsman-type" placeholder="نوع الوظيفة (مثل: نجار / كهربائي)" style="width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.96rem !important; min-height:38px !important; border:1.5px solid #d4af37 !important; background:#fff !important; color:#000 !important; display:block !important;">`;
        }
        tr.innerHTML = `
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="number" class="modal-nested-craftsman-syp" min="0" value="0" placeholder="مثل 200000" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.95rem !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important; min-height:40px;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="number" class="modal-nested-craftsman-usd" min="0" value="0" placeholder="مثل 100" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.95rem !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important; min-height:40px;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;">
                <div style="display:flex; flex-direction:column; gap:0.35rem; min-width:0;">
                    ${profSelectHtml}
                    <input type="text" class="modal-nested-craftsman-type-other" placeholder="اكتب نوع الوظيفة هنا..." style="display:none; width:100%; padding:0.5rem 0.65rem; font-size:0.9rem; min-height:36px; border:1.5px solid #c9a235; background:#ffffff; color:#000000;">
                    <input type="text" class="modal-nested-craftsman-name" placeholder="اسم الحرفي: مثلاً أبو محمد" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.96rem !important; min-height:38px !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000 !important;">
                </div>
            </td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell; width:17%;"><input type="date" class="modal-nested-craftsman-date" value="${todayStr()}" style="display:block !important; width:100% !important; padding:0.4rem 0.5rem !important; font-size:0.85rem !important; min-height:38px; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell; width:5%;">
                <button type="button" class="icon-btn icon-btn-delete" style="padding:0.3rem 0.45rem; font-size:0.85rem; min-width:32px; min-height:32px;" onclick="modalRemoveNestedCraftsman(this)"><i class="fas fa-times"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
        try { attachCraftsmanProfessionToggle(tr, 'modal-nested-craftsman-type', 'modal-nested-craftsman-type-other'); } catch (_) {}
    } catch (err) {
        console.error('modalAddNestedCraftsman error:', err);
        toast('خطأ', 'تعذر إضافة حرفي جديد: ' + (err.message || 'خطأ غير معروف'), 'error');
    }
}

function modalRemoveNestedCraftsman(btn) {
    const tr = btn.closest('tr');
    if (!tr) return;
    const tbody = tr.parentElement;
    const table = tbody?.parentElement;
    const mcpayBlockId = table ? table.getAttribute('data-modal-nested-craftsmen-table') : null;
    tr.remove();
    if (mcpayBlockId && tbody) {
        const remaining = tbody.querySelectorAll('tr[data-modal-nested-craftsman]');
        const tfoot = table ? table.querySelector('tfoot') : null;
        if (remaining.length === 0) {
            const oldEmpty = tbody.querySelector(`tr[data-modal-empty-nested-craftsmen="${mcpayBlockId}"]`);
            if (oldEmpty) oldEmpty.remove();
            if (tfoot) tfoot.remove();
            setTimeout(() => modalAddNestedCraftsman(mcpayBlockId), 0);
        }
    }
}

function modalAddNestedMaterial(mcpayBlockId) {
    try {
        const table = document.querySelector(`table[data-modal-nested-materials-table="${mcpayBlockId}"]`);
        if (!table) { toast('خطأ تقني', 'لم يتم إيجاد جدول المواد — جرب إغلاق المودال وفتحه مرة ثانية', 'error'); return; }
        let tbody = table.querySelector('tbody');
        if (!tbody) { tbody = document.createElement('tbody'); table.appendChild(tbody); }
        const emptyMsg = tbody.querySelector(`tr[data-modal-empty-nested-materials="${mcpayBlockId}"]`);
        if (emptyMsg) emptyMsg.remove();
        const tempId = 'new_mnm_' + Date.now() + Math.floor(Math.random() * 10000);
        const tr = document.createElement('tr');
        tr.setAttribute('data-modal-nested-material', tempId);
        tr.innerHTML = `
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="number" class="modal-nested-material-syp" min="0" value="0" placeholder="مثل 150000" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.95rem !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important; min-height:40px;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="number" class="modal-nested-material-usd" min="0" value="0" placeholder="مثل 50" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.95rem !important; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important; min-height:40px;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell;"><input type="text" class="modal-nested-material-name" placeholder="اسم المادة: مثلاً أسمنت / حديد / طوب" style="display:block !important; width:100% !important; padding:0.5rem 0.65rem !important; font-size:0.96rem !important; min-height:38px; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell; width:17%;"><input type="date" class="modal-nested-material-date" value="${todayStr()}" style="display:block !important; width:100% !important; padding:0.4rem 0.5rem !important; font-size:0.85rem !important; min-height:38px; border:1.5px solid #c9a235 !important; background:#ffffff !important; color:#000000 !important;"></td>
            <td style="padding:0.5rem; vertical-align:middle; display:table-cell; width:5%;">
                <button type="button" class="icon-btn icon-btn-delete" style="padding:0.3rem 0.45rem; font-size:0.85rem; min-width:32px; min-height:32px;" onclick="modalRemoveNestedMaterial(this)"><i class="fas fa-times"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    } catch (err) {
        console.error('modalAddNestedMaterial error:', err);
        toast('خطأ', 'تعذر إضافة مادة جديدة: ' + (err.message || 'خطأ غير معروف'), 'error');
    }
}

function modalRemoveNestedMaterial(btn) {
    const tr = btn.closest('tr');
    if (!tr) return;
    const tbody = tr.parentElement;
    const table = tbody?.parentElement;
    const mcpayBlockId = table ? table.getAttribute('data-modal-nested-materials-table') : null;
    tr.remove();
    if (mcpayBlockId && tbody) {
        const remaining = tbody.querySelectorAll('tr[data-modal-nested-material]');
        const tfoot = table ? table.querySelector('tfoot') : null;
        if (remaining.length === 0) {
            const oldEmpty = tbody.querySelector(`tr[data-modal-empty-nested-materials="${mcpayBlockId}"]`);
            if (oldEmpty) oldEmpty.remove();
            if (tfoot) tfoot.remove();
            setTimeout(() => modalAddNestedMaterial(mcpayBlockId), 0);
        }
    }
}

function modalAddClientPayment() {
    const tbody = document.getElementById('modalClientPaymentsTbody');
    if (!tbody) return;
    const tempId = 'new_mcpay_' + Date.now();
    const dummyCp = {
        id: tempId,
        amountSYP: 0,
        amountUSD: 0,
        materialName: '',
        date: todayStr(),
        craftsmen: [],
        materials: []
    };
    const wrapHtml = renderModalClientPaymentRowFull(dummyCp, 0);
    const tempContainer = document.createElement('tbody');
    tempContainer.innerHTML = wrapHtml;
    const nodes = Array.from(tempContainer.children);
    nodes.forEach(n => tbody.appendChild(n));
    setTimeout(() => {
        const block = document.querySelector(`tr[data-mcpay-block="mcpay-block-${tempId}"]`);
        if (block) {
            document.querySelectorAll(`tr[data-mcpay-nested="mcpay-block-${tempId}"] tr[data-modal-nested-craftsman]`).forEach(r => {
                try { attachCraftsmanProfessionToggle(r, 'modal-nested-craftsman-type', 'modal-nested-craftsman-type-other'); } catch (_) {}
            });
        }
    }, 20);
}

function modalRemoveClientPayment(btn) {
    const tr = btn.closest('tr');
    if (!tr) return;
    const tbody = document.getElementById('modalClientPaymentsTbody');
    if (!tbody) return;
    const rowsWithId = tbody.querySelectorAll('tr[data-mcpay-id]');
    if (rowsWithId.length <= 1) {
        toast('تنبيه', 'يجب أن يبقى دفعة واحدة على الأقل (يمكنك تركها فارغة)', 'warning');
        return;
    }
    const blockId = tr.getAttribute('data-mcpay-block');
    const nested = blockId ? document.querySelector(`tr[data-mcpay-nested="${blockId}"]`) : null;
    if (nested) nested.remove();
    tr.remove();
}

function collectModalClientPayments() {
    const tbody = document.getElementById('modalClientPaymentsTbody');
    if (!tbody) return [];
    const rows = tbody.querySelectorAll('tr[data-mcpay-id]');
    const cps = [];
    rows.forEach(row => {
        const id = row.getAttribute('data-mcpay-id');
        const blockId = row.getAttribute('data-mcpay-block');
        const amountSYP = row.querySelector('.mcpay-amount-syp')?.value;
        const amountUSD = row.querySelector('.mcpay-amount-usd')?.value;
        const materialName = row.querySelector('.mcpay-material-name')?.value;
        const date = row.querySelector('.mcpay-date')?.value;
        const craftsmenArr = [];
        const materialsArr = [];
        if (blockId) {
            const craftTable = document.querySelector(`table[data-modal-nested-craftsmen-table="${blockId}"]`);
            if (craftTable) {
                craftTable.querySelectorAll('tbody tr[data-modal-nested-craftsman]').forEach(ctr => {
                    const cid = ctr.getAttribute('data-modal-nested-craftsman') || generateId('ncraft');
                    const cSYP = Number(ctr.querySelector('.modal-nested-craftsman-syp')?.value) || 0;
                    const cUSD = Number(ctr.querySelector('.modal-nested-craftsman-usd')?.value) || 0;
                    const cType = getCraftsmanProfessionFromRow(ctr, 'modal-nested-craftsman-type', 'modal-nested-craftsman-type-other');
                    const cName = (ctr.querySelector('.modal-nested-craftsman-name')?.value || '').trim();
                    const cDate = ctr.querySelector('.modal-nested-craftsman-date')?.value;
                    if (cSYP === 0 && cUSD === 0 && !cType && !cName) return;
                    craftsmenArr.push({ id: cid, amountSYP: cSYP, amountUSD: cUSD, craftsmanType: cType, craftsmanName: cName, date: cDate, description: (cType || '') + ' ' + (cName || '') });
                });
            }
            const matTable = document.querySelector(`table[data-modal-nested-materials-table="${blockId}"]`);
            if (matTable) {
                matTable.querySelectorAll('tbody tr[data-modal-nested-material]').forEach(mtr => {
                    const mid = mtr.getAttribute('data-modal-nested-material') || generateId('nmat');
                    const mSYP = Number(mtr.querySelector('.modal-nested-material-syp')?.value) || 0;
                    const mUSD = Number(mtr.querySelector('.modal-nested-material-usd')?.value) || 0;
                    const mName = (mtr.querySelector('.modal-nested-material-name')?.value || '').trim();
                    const mDate = mtr.querySelector('.modal-nested-material-date')?.value;
                    if (mSYP === 0 && mUSD === 0 && !mName) return;
                    materialsArr.push({ id: mid, amountSYP: mSYP, amountUSD: mUSD, materialName: mName, date: mDate });
                });
            }
        }
        cps.push({ id, amountSYP, amountUSD, materialName, date, craftsmen: craftsmenArr, materials: materialsArr });
    });
    return cps;
}

function submitInvoiceForm(invoiceId) {
    const customerName = (document.getElementById('formCustomerName')?.value || '').trim();
    const agreedAmountSYP = Number(document.getElementById('formAgreedAmountSYP')?.value || 0);
    const agreedAmountUSD = Number(document.getElementById('formAgreedAmountUSD')?.value || 0);
    const clientPayments = collectModalClientPayments();
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

    let finalInvoice = null;
    if (invoiceId) {
        finalInvoice = updateInvoice(invoiceId, { customerName, agreedAmountSYP, agreedAmountUSD, clientPayments, payments: [], materials: [], sitePhotos });
        toast('تم التحديث', 'تم تعديل الفاتورة بنجاح', 'success');
    } else {
        finalInvoice = createInvoice({ customerName, agreedAmountSYP, agreedAmountUSD, clientPayments, payments: [], materials: [], sitePhotos });
        toast('تم الإنشاء', 'تم إنشاء الفاتورة بنجاح', 'success');
    }

    if (finalInvoice) {
        const syncRes = syncInvoiceCraftsmenToWorkers(finalInvoice.id, customerName, finalInvoice.clientPayments || []);
        const totalSync = syncRes.linked + syncRes.updated + syncRes.removed;
        if (totalSync > 0) {
            let parts = [];
            if (syncRes.linked) parts.push(`${syncRes.linked} دفعة جديدة`);
            if (syncRes.updated) parts.push(`${syncRes.updated} تحديث`);
            if (syncRes.removed) parts.push(`${syncRes.removed} حذف`);
            setTimeout(() => toast('🔗 ربط تلقائي بأجور العمال', parts.join('، ') + ' تحت أسماء العمال المطابقة', 'info'), 600);
        }
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
            <h3 style="font-family:'Cairo', sans-serif; font-size:1.4rem; margin-bottom:0.5rem; color:var(--color-black); font-weight:700;">تأكيد حذف الفاتورة</h3>
            <p style="color:var(--color-gray); margin-bottom:0.8rem;">
                هل أنت متأكد 100% من حذف هالفاتورة؟
            </p>
            <p style="background:var(--color-cream); padding:0.8rem 1rem; border-radius:var(--radius-sm); color:var(--color-black); font-weight:600; line-height:1.8;">
                العميل: ${escapeHtml(invoice.customerName)}
                <br>
                <span style="color:var(--color-gray); font-weight:500; font-size:0.85rem;">
                    السعر المتفق عليه: ${formatCurrencySYP(invoice.agreedAmountSYP)} / ${formatCurrencyUSD(invoice.agreedAmountUSD)}
                </span>
            </p>
            <div style="background:#fff4f4; border:1.5px dashed #ef4444; border-radius:10px; padding:0.8rem 1rem; margin-top:1rem; text-align:right;">
                <p style="color:#b91c1c; font-size:0.88rem; margin:0; line-height:1.9; font-weight:600;">
                    🔴 <strong>مهم جداً:</strong> بعد تأكيد الحذف → الفاتورة رح تنمسح نهائياً من:<br>
                    &nbsp;&nbsp;✅ جهازك الحالي<br>
                    &nbsp;&nbsp;✅ جميع الأجهزة التانية (جهاز جيسيكا وجهاز حسين) بعد أي مزامنة (مزامنة تلقائية كل 5 دقائق أو زر "مزامنة فورية")<br>
                    &nbsp;&nbsp;✅ من قاعدة البيانات السحابية على الفايربيز
                </p>
                <p style="color:#dc2626; font-size:0.85rem; margin-top:0.7rem;">
                    <i class="fas fa-exclamation-triangle" style="margin-left:0.3rem;"></i>
                    هذه العملية نهائية ومفيش رجوع فيها
                </p>
            </div>
        </div>
    `, {
        title: 'حذف الفاتورة نهائياً',
        isLarge: false,
        footer: `
            <button class="btn btn-outline" onclick="closeModal()">
                <i class="fas fa-times"></i>
                إلغاء - لا تحذف
            </button>
            <button class="btn btn-primary" style="background:#dc2626; border-color:#dc2626;" onclick="executeDeleteInvoice('${invoiceId}')">
                <i class="fas fa-trash-alt"></i>
                نعم، احذف الفاتورة من كل مكان
            </button>
        `
    });
}

function executeDeleteInvoice(invoiceId) {
    deleteInvoice(invoiceId);
    toast('🗑️ تم حذف الفاتورة من كل الأجهزة', 'الفاتورة انمسحت نهائياً. بعد 5 دقائق أو مزامنة فورية رح تختفي من كل الأجهزة التانية.', 'success', 5000);
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
// ====== دوال إدارة الوظائف والمهن (v3.16) ======
window.openProfessionWorkersModal = openProfessionWorkersModal;
window.openProfessionCreate = openProfessionCreate;
window.openProfessionEdit = openProfessionEdit;
window.handleReorderProfession = handleReorderProfession;
window.confirmDeleteProfession = confirmDeleteProfession;
window.reorderProfession = reorderProfession;
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
// ⚠️ تم حذف السطور المكسورة: modalAddPayment/RemovePayment/AddMaterial/RemoveMaterial
// (دوال محذوفة سابقاً لكن بقيت window assignments → كانت توقف تنفيذ كل التسجيلات اللاحقة)
window.submitInvoiceForm = submitInvoiceForm;
window.exportInvoicePDF = exportInvoicePDF;
window.handleSitePhotosUpload = handleSitePhotosUpload;
window.removeSitePhoto = removeSitePhoto;
window.handleModalSitePhotosUpload = handleModalSitePhotosUpload;
window.removeModalSitePhoto = removeModalSitePhoto;
window.forceSyncNow = forceSyncNow;
window.showSyncStatus = showSyncStatus;
window.initCloudSync = initCloudSync;

// ====== دوال nested لصفحة الفاتورة (onclick exposure) ======
window.addClientPaymentRow = addClientPaymentRow;
window.removeClientPaymentRow = removeClientPaymentRow;
window.addNestedCraftsmanRow = addNestedCraftsmanRow;
window.removeNestedCraftsman = removeNestedCraftsman;
window.addNestedMaterialRow = addNestedMaterialRow;
window.removeNestedMaterial = removeNestedMaterial;

// ====== دوال nested للمودال (onclick exposure) ======
window.modalAddClientPayment = modalAddClientPayment;
window.modalRemoveClientPayment = modalRemoveClientPayment;
window.modalAddNestedCraftsman = modalAddNestedCraftsman;
window.modalRemoveNestedCraftsman = modalRemoveNestedCraftsman;
window.modalAddNestedMaterial = modalAddNestedMaterial;
window.modalRemoveNestedMaterial = modalRemoveNestedMaterial;
