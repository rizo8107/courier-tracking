#!/usr/bin/env node
const { trackCourier, COURIERS } = require('./STCourierTracker');

const trackingNumber = process.argv[2];
const courierKey = process.argv[3] || 'st-courier';

const validKeys = Object.keys(COURIERS).join(', ');

if (!trackingNumber) {
  console.error('Usage: node track-cli.js <tracking-number> [courier]');
  console.error(`Valid couriers: ${validKeys}`);
  console.error('Examples:');
  console.error('  node track-cli.js 64331161156 st-courier');
  console.error('  node track-cli.js EE123456789IN indiapost');
  console.error('  node track-cli.js 123456789 professional');
  console.error('  node track-cli.js 12345678901 bluedart');
  process.exit(1);
}

(async () => {
  try {
    console.log(`Fetching [${courierKey}] tracking for: ${trackingNumber}\n`);
    const result = await trackCourier(trackingNumber, courierKey);

    console.log(`Courier:  ${result.courier}`);
    console.log(`Status:   ${result.status}`);
    console.log(`Tracked:  ${result.trackedAt}`);
    console.log(`URL:      ${result.url}\n`);
    console.log('Events:');
    result.events.forEach((e, i) => {
      console.log(`  [${i + 1}] ${e.date} ${e.time}`);
      console.log(`       ${e.description}`);
      if (e.from || e.to) console.log(`       ${e.from} → ${e.to}`);
    });

    console.log('\nJSON:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
