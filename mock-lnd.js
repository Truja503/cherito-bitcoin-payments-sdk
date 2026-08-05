import { createServer } from 'node:http';
import { parse } from 'node:url';

const MOCK_INVOICES = new Map();
let invoiceCounter = 0;

function generateInvoice(amountSats, expirySeconds = 900) {
  const id = `mock-invoice-${++invoiceCounter}`;
  const paymentRequest = `lnbc${amountSats}u1p${id}pp5exampleinvoice${Date.now()}descriptionhash256example...`;
  const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();
  
  const invoice = {
    id,
    payment_request: paymentRequest,
    value: amountSats.toString(),
    settled: false,
    creation_date: Math.floor(Date.now() / 1000).toString(),
    expiry: expirySeconds.toString(),
    state: 'OPEN',
  };
  
  MOCK_INVOICES.set(id, invoice);
  
  // Auto-settle after 5 seconds for testing
  setTimeout(() => {
    const inv = MOCK_INVOICES.get(id);
    if (inv && inv.state === 'OPEN') {
      inv.state = 'SETTLED';
      inv.settled = true;
      inv.settle_date = Math.floor(Date.now() / 1000).toString();
    }
  }, 5000);
  
  return invoice;
}

const server = createServer((req, res) => {
  const { pathname } = parse(req.url || '', true);
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, grpc-metadata-macaroon');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  if (pathname === '/v1/getinfo' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      identity_pubkey: 'mock-pubkey',
      alias: 'Mock LND',
      version: '0.18.0-beta',
      num_active_channels: 5,
      num_peers: 3,
      block_height: 840000,
      block_hash: '0000000000000000000123456789abcdef',
      synced_to_chain: true,
      synced_to_graph: true,
      chains: [{ network: 'regtest' }],
    }));
    return;
  }
  
  if (pathname === '/v1/invoices' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { value, memo, expiry } = JSON.parse(body);
        const amountSats = value || 25000;
        const invoice = generateInvoice(amountSats, expiry || 900);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          r_hash: 'mock-rhash',
          pay_req: invoice.payment_request,
          add_index: invoiceCounter.toString(),
        }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }
  
  if (pathname?.startsWith('/v1/invoice/') && req.method === 'GET') {
    const id = pathname.split('/').pop();
    const invoice = MOCK_INVOICES.get(id);
    if (invoice) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(invoice));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invoice not found' }));
    }
    return;
  }
  
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = 8081;
server.listen(PORT, () => {
  console.log(`Mock LND REST server running at http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /v1/getinfo');
  console.log('  POST /v1/invoices');
  console.log('  GET  /v1/invoice/:id');
});