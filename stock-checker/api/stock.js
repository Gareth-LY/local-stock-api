export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { variant_id, postcode } = req.body;
  if (!variant_id || !postcode) {
    return res.status(400).json({ error: "Missing variant_id or postcode" });
  }

  const shop = process.env.SHOPIFY_SHOP;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  const headers = {
    "X-Shopify-Access-Token": token,
    "Content-Type": "application/json",
  };

  /* -------------------------------
     1. Get inventory_item_id
  -------------------------------- */
  const variantRes = await fetch(
    `https://${shop}/admin/api/2024-01/variants/${variant_id}.json`,
    { headers }
  );
  const variantJson = await variantRes.json();
  const inventoryItemId = variantJson.variant.inventory_item_id;

  /* -------------------------------
     2. Get inventory levels
  -------------------------------- */
  const inventoryRes = await fetch(
    `https://${shop}/admin/api/2024-01/inventory_levels.json?inventory_item_ids=${inventoryItemId}`,
    { headers }
  );
  const inventoryJson = await inventoryRes.json();

  /* -------------------------------
     3. Get locations
  -------------------------------- */
  const locationsRes = await fetch(
    `https://${shop}/admin/api/2024-01/locations.json`,
    { headers }
  );
  const locationsJson = await locationsRes.json();

  const locationsById = Object.fromEntries(
    locationsJson.locations.map(loc => [loc.id, loc])
  );

  /* -------------------------------
     4. Merge + filter
  -------------------------------- */
  const results = inventoryJson.inventory_levels
    .filter(level => level.available > 0)
    .map(level => {
      const loc = locationsById[level.location_id];
      return {
        name: loc.name,
        stock: level.available,
        address: `${loc.address1}, ${loc.city}`,
        postcode: loc.zip,
      };
    });

  return res.status(200).json({ locations: results });
}
