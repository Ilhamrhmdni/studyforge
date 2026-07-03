const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  const pages = ['/login', '/dashboard', '/creator', '/admin', '/quiz', '/result'];
  let hasErrors = false;

  for (const p of pages) {
    console.log(`\n--- Checking ${p} ---`);
    let pageErrors = 0;
    
    // Listen for console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error(`[Console Error] ${msg.text()}`);
        pageErrors++;
        hasErrors = true;
      }
    });

    // Listen for failed network requests
    page.on('response', response => {
      if (response.status() >= 400 && response.request().resourceType() !== 'fetch') {
        console.error(`[Network Error] ${response.status()} ${response.url()}`);
        pageErrors++;
        hasErrors = true;
      }
    });

    try {
      await page.goto(`http://127.0.0.1:8788${p}`, { waitUntil: 'networkidle0' });
      if (pageErrors === 0) {
        console.log(`✅ ${p} loaded without errors.`);
      }
    } catch (err) {
      console.error(`[Navigation Error] ${err.message}`);
      hasErrors = true;
    }
    
    // Clear listeners for next page
    page.removeAllListeners('console');
    page.removeAllListeners('response');
  }

  await browser.close();
  
  if (hasErrors) {
    console.log('\n❌ Ada error yang ditemukan. Lihat log di atas.');
    process.exit(1);
  } else {
    console.log('\n✅ Semua halaman berhasil diload tanpa error JS merah atau 404.');
  }
})();
