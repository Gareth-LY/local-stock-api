// api/stock.js
export default async function handler(req, res) {
  // CORS headers
  const allowedOrigins = [
    'https://dev.lucyandyak.com',
    'https://lucy-and-yak-dev-store.myshopify.com',
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { variant_id, postcode } = req.body;

    if (!variant_id || !postcode) {
      return res.status(400).json({ error: 'Missing variant_id or postcode' });
    }

    // Pick credentials based on origin
    let shop, token;
    if (origin === 'https://dev.lucyandyak.com') {
      shop = process.env.DEV_SHOP;
      token = process.env.DEV_TOKEN;
    } else if (origin === 'https://lucy-and-yak-dev-store.myshopify.com') {
      shop = process.env.SHOPIFY_SHOP;
      token = process.env.SHOPIFY_ADMIN_TOKEN;
    } else {
      return res.status(403).json({ error: 'Unauthorized origin' });
    }

    // Fetch locations from Shopify Admin API 2025-10
    const locationsRes = await fetch(`https://${shop}/admin/api/2025-10/locations.json`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });
    const locationsData = await locationsRes.json();

    // Fetch inventory levels for the variant
    const inventoryPromises = locationsData.locations.map(async (loc) => {
      const invRes = await fetch(
        `https://${shop}/admin/api/2025-10/inventory_levels.json?inventory_item_ids=${variant_id}&location_ids=${loc.id}`,
        { headers: { 'X-Shopify-Access-Token': token } }
      );
      const invData = await invRes.json();
      const stock = invData.inventory_levels?.[0]?.available || 0;

      return {
        name: loc.name,
        stock,
        address: loc.address1,
        distance: Math.floor(Math.random() * 5) + 1, // placeholder for postcode distance
      };
    });

    const locationsWithStock = await Promise.all(inventoryPromises);
    return res.status(200).json({ locations: locationsWithStock });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
