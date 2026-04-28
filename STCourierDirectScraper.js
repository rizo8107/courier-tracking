const https = require('https');
const querystring = require('querystring');

const TIMEOUT = 15000;

function httpRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(TIMEOUT, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function decodeHtml(str) {
  return (str || '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function parseStatusTable(html) {
  const result = {};
  const pairs = [
    ['status', /Current Status<\/td>\s*<td[^>]*class="font-normal"[^>]*>([^<]+)</i],
    ['origin', /Orgin SRC<\/td>\s*<td[^>]*class="font-normal"[^>]*>([^<]+)</i],
    ['destination', /Destination\s*<\/td>\s*<td[^>]*class="font-normal"[^>]*>([^<]+)</i],
    ['consignment', /Consignment\s*<\/td>\s*<td[^>]*class="font-normal"[^>]*>([^<]+)</i],
  ];
  for (const [key, regex] of pairs) {
    const m = html.match(regex);
    result[key] = m ? m[1].trim() : '';
  }
  return result;
}

function parseTimeline(html) {
  const events = [];

  // Split on tl28 class — each chunk is one event block
  const parts = html.split(/class="[^"]*\btl28\b[^"]*"/);
  parts.shift(); // drop content before the first tl28

  for (const block of parts) {
    // Date/time: "Apr 28, 2026<br>10:49 AM"
    const dtMatch = block.match(/([A-Za-z]+ \d{1,2},\s*\d{4})<br[^>]*>(\d{1,2}:\d{2}\s*[AP]M)/i);

    // The content div is float:right (width:65%) — last meaningful inner div
    // Match all inner <div>...</div> pairs and take the last one with real content
    const innerDivs = [...block.matchAll(/<div[^>]*style="[^"]*float:\s*right[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi)];
    const contentRaw = innerDivs.length > 0
      ? innerDivs[innerDivs.length - 1][1]
      : '';

    const decoded = decodeHtml(contentRaw);
    const lines = decoded.split('\n').map(l => l.trim()).filter(Boolean);

    if (!dtMatch && lines.length === 0) continue;

    const description = lines[0] || '';
    const rawLocation = lines.slice(1).join(' ').trim();
    const locMatch = rawLocation.match(/(.+?)\s+-to-\s+(.+)/i);

    events.push({
      date: dtMatch ? dtMatch[1].trim() : '',
      time: dtMatch ? dtMatch[2].trim() : '',
      description,
      from: locMatch ? locMatch[1].trim() : (rawLocation || ''),
      to: locMatch ? locMatch[2].trim() : '',
    });
  }

  return events;
}

/**
 * Track a shipment directly from stcourier.com (no Puppeteer)
 * @param {string} awbNumber
 * @returns {Promise<TrackingResult>}
 */
async function trackSTCourierDirect(awbNumber) {
  if (!awbNumber || typeof awbNumber !== 'string') {
    throw new Error('Invalid AWB number');
  }

  const awb = awbNumber.trim();
  const postData = querystring.stringify({ awb_no: awb });

  // Step 1: POST to doCheck — establishes session
  const postRes = await httpRequest({
    hostname: 'stcourier.com',
    path: '/track/doCheck',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://stcourier.com/track/shipment',
      'Origin': 'https://stcourier.com',
    },
  }, postData);

  let parsed;
  try { parsed = JSON.parse(postRes.body); } catch (e) { parsed = {}; }

  if (parsed.code !== 200) {
    throw new Error(parsed.msg || 'ST Courier rejected the AWB number');
  }

  const rawCookies = postRes.headers['set-cookie'] || [];
  if (rawCookies.length === 0) throw new Error('No session cookie returned from ST Courier');
  const cookieStr = rawCookies.map(c => c.split(';')[0]).join('; ');

  // Step 2: GET the tracking page with session cookie
  const pageRes = await httpRequest({
    hostname: 'stcourier.com',
    path: '/track/shipment',
    method: 'GET',
    headers: {
      'Cookie': cookieStr,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://stcourier.com/track/shipment',
    },
  });

  const html = pageRes.body;

  if (!html.includes('AWB No') && !html.includes('tl28')) {
    throw new Error('No tracking data found for AWB: ' + awb);
  }

  const statusTable = parseStatusTable(html);
  const events = parseTimeline(html);

  return {
    trackingNumber: awb,
    courier: 'ST Courier',
    source: 'stcourier.com',
    status: statusTable.status || 'UNKNOWN',
    origin: statusTable.origin,
    destination: statusTable.destination,
    consignment: statusTable.consignment,
    events,
    trackedAt: new Date().toISOString(),
    url: 'https://stcourier.com/track/shipment',
  };
}

module.exports = { trackSTCourierDirect };
