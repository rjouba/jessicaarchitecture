import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE.ERROR: ' + m.text()); });

console.log('1️⃣ Loading app (simulating first-time visit - no cache)...');
// Disable cache to simulate real first-visit
await page.context().clearCookies();
await page.goto('http://127.0.0.1:8767/index.html?nocache=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 30000 });

// Take screenshot at T=0 (immediately after DOM loaded, before networkidle)
console.log('2️⃣ Taking screenshot at T=200ms (right after DOM)...');
await page.waitForTimeout(200);
const at200 = await page.evaluate(() => {
    const slides = Array.from(document.querySelectorAll('.works-c-slide'));
    return slides.map((s, i) => ({
        idx: i,
        isActive: s.classList.contains('is-active'),
        opacity: window.getComputedStyle(s).opacity,
        imgComplete: s.querySelector('img') ? s.querySelector('img').complete : false,
        imgNaturalW: s.querySelector('img') ? s.querySelector('img').naturalWidth : 0
    }));
});
console.log('   At T=200ms:', JSON.stringify(at200, null, 2));

console.log('3️⃣ Waiting 1s and re-checking...');
await page.waitForTimeout(1000);
const at1200 = await page.evaluate(() => {
    const active = document.querySelector('.works-c-slide.is-active');
    if (!active) return { active: null };
    const img = active.querySelector('img');
    return {
        dataProject: active.getAttribute('data-project'),
        opacity: window.getComputedStyle(active).opacity,
        imgComplete: img ? img.complete : false,
        imgNaturalW: img ? img.naturalWidth : 0,
        imgSrc: img ? img.getAttribute('src') : null
    };
});
console.log('   At T=1200ms:', JSON.stringify(at1200, null, 2));

console.log('4️⃣ Full networkidle wait then re-check...');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(500);
const atFinal = await page.evaluate(() => {
    const active = document.querySelector('.works-c-slide.is-active');
    if (!active) return { active: null };
    const img = active.querySelector('img');
    return {
        dataProject: active.getAttribute('data-project'),
        opacity: window.getComputedStyle(active).opacity,
        imgComplete: img ? img.complete : false,
        imgNaturalW: img ? img.naturalWidth : 0,
        imgSrc: img ? img.getAttribute('src') : null
    };
});
console.log('   At T=final (after networkidle):', JSON.stringify(atFinal, null, 2));

console.log('5️⃣ Take real screenshot to disk...');
const activeSlide = page.locator('.works-c-slide.is-active').first();
const box = await activeSlide.boundingBox();
if (box) {
    await page.screenshot({ path: 'c:\\Users\\Administrator\\Documents\\trae_projects\\jessica arch\\test-screenshot.png', clip: box, fullPage: false });
    console.log('   Screenshot saved.');
}

console.log('---');
console.log('Errors:', errors.length, errors);
await browser.close();
console.log('✅ DONE');
