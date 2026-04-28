const http = require('http');
const { trackCourier, COURIERS } = require('./STCourierTracker');
const { trackSTCourierDirect } = require('./STCourierDirectScraper');

const PORT = process.env.PORT || 3456;

const VALID_COURIERS = [
  ...new Set(Object.values(COURIERS).map(c => c.label)),
  'ST Courier (direct)',
].join(', ');

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);

  if (parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
  }

  if (parsed.pathname !== '/track') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      error: 'Not found.',
      usage: 'GET /track?number=TRACKING_NUMBER&courier=COURIER',
      couriers: VALID_COURIERS,
      examples: [
        '/track?number=64331161156&courier=st-direct',
        '/track?number=64331161156&courier=st-courier',
        '/track?number=EE123456789IN&courier=indiapost',
        '/track?number=123456789&courier=professional',
        '/track?number=12345678901&courier=bluedart',
      ],
    }));
  }

  const trackingNumber = parsed.searchParams.get('number') || parsed.searchParams.get('id');
  const courierKey = parsed.searchParams.get('courier') || 'st-direct';

  if (!trackingNumber) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      error: 'Missing query param: number',
      usage: 'GET /track?number=TRACKING_NUMBER&courier=COURIER',
      validCouriers: VALID_COURIERS,
    }));
  }

  try {
    console.log(`[${new Date().toISOString()}] Tracking ${courierKey}: ${trackingNumber}`);

    let data;
    if (courierKey === 'st-direct') {
      data = await trackSTCourierDirect(trackingNumber);
    } else {
      data = await trackCourier(trackingNumber, courierKey);
    }

    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    const status = err.message.startsWith('Unknown courier') ? 400 : 500;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`\nCourier Tracker API — http://localhost:${PORT}`);
  console.log(`\nSupported couriers: ${VALID_COURIERS}`);
  console.log(`\nExamples:`);
  console.log(`  GET /track?number=64331161156&courier=st-direct     ← direct from stcourier.com`);
  console.log(`  GET /track?number=64331161156&courier=st-courier    ← via trackcourier.io`);
  console.log(`  GET /track?number=EE123456789IN&courier=indiapost`);
  console.log(`  GET /track?number=123456789&courier=professional`);
  console.log(`  GET /track?number=12345678901&courier=bluedart`);
  console.log('');
});
