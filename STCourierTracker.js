const puppeteer = require('puppeteer');

const LOAD_TIMEOUT = 25000;

const COURIERS = {
  'indiapost':            { label: 'India Post',            slug: 'india-post-domestic' },
  'india-post':           { label: 'India Post',            slug: 'india-post-domestic' },
  'st':                   { label: 'ST Courier',            slug: 'st-courier' },
  'st-courier':           { label: 'ST Courier',            slug: 'st-courier' },
  'professional':         { label: 'Professional Courier',  slug: 'professional-courier' },
  'professional-courier': { label: 'Professional Courier',  slug: 'professional-courier' },
  'bluedart':             { label: 'Blue Dart',             slug: 'blue-dart-courier' },
  'blue-dart':            { label: 'Blue Dart',             slug: 'blue-dart-courier' },
};

function resolveCourier(courierKey) {
  const key = (courierKey || '').toLowerCase().trim();
  const match = COURIERS[key];
  if (!match) {
    const valid = [...new Set(Object.values(COURIERS).map(c => c.label))];
    throw new Error(`Unknown courier "${courierKey}". Valid options: ${valid.join(', ')}`);
  }
  return match;
}

function decodeHtml(str) {
  return (str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * @param {string} trackingNumber
 * @param {string} courierKey  — 'st' | 'st-courier' | 'indiapost' | 'india-post' | 'professional' | 'bluedart' | 'blue-dart'
 * @returns {Promise<TrackingResult>}
 */
async function trackCourier(trackingNumber, courierKey = 'st-courier') {
  if (!trackingNumber || typeof trackingNumber !== 'string') {
    throw new Error('Invalid tracking number');
  }

  const courier = resolveCourier(courierKey);
  const url = `https://trackcourier.io/track-and-trace/${courier.slug}/${trackingNumber.trim()}`;
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--disable-crash-reporter',
        '--disable-extensions',
        '--disable-software-rasterizer',
        '--disable-features=VizDisplayCompositor',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.goto(url, { waitUntil: 'networkidle2', timeout: LOAD_TIMEOUT });

    // Wait for AngularJS to finish its API fetch (ctrl.waiting becomes false)
    await page.waitForFunction(() => {
      try {
        const el = document.querySelector('[ng-controller]');
        const scope = angular.element(el).scope();
        return scope && scope.ctrl && scope.ctrl.waiting === false;
      } catch (e) {
        return false;
      }
    }, { timeout: LOAD_TIMEOUT });

    // Read directly from Angular scope — no DOM parsing needed
    const raw = await page.evaluate(() => {
      const el = document.querySelector('[ng-controller]');
      const scope = angular.element(el).scope();
      const ctrl = scope.ctrl;
      const table = ctrl.CheckpointsTable || {};
      return {
        status: table.MostRecentStatus || 'UNKNOWN',
        shipmentState: table.ShipmentState || ctrl.ShipmentState || '',
        trackingNumber: table.TrackingNumber || '',
        courierName: (table.Checkpoints && table.Checkpoints[0] && table.Checkpoints[0].CourierName) || '',
        checkpoints: (table.Checkpoints || []).map(c => ({
          date: c.Date,
          time: c.Time,
          activity: c.Activity,
          location: c.Location,
          state: c.CheckpointState,
        })),
        result: table.Result || '',
      };
    });

    const events = raw.checkpoints.map(c => {
      const locMatch = (c.location || '').match(/(.+?)\s+-to-\s+(.+)/i);
      return {
        date: c.date,
        time: c.time,
        description: decodeHtml(c.activity),
        from: locMatch ? locMatch[1].trim() : '',
        to: locMatch ? locMatch[2].trim() : '',
        state: c.state,
      };
    });

    return {
      trackingNumber: trackingNumber.trim(),
      courier: raw.courierName || courier.label,
      status: decodeHtml(raw.status),
      shipmentState: raw.shipmentState,
      events,
      trackedAt: new Date().toISOString(),
      url,
    };
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { trackCourier, COURIERS };
