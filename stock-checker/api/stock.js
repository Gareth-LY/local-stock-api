export default async function handler(req, res) {
  // ALWAYS set headers first
  res.setHeader("Access-Control-Allow-Origin", "https://lucy-and-yak-dev-store.myshopify.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { variant_id, postcode } = req.body;
    if (!variant_id || !postcode) {
      return res.status(400).json({ error: "Missing variant_id or postcode" });
    }

    const shop = process.env.SHOPIFY_SHOP;
    const token = process.env.SHOPIFY_ADMIN_TOKEN;

    if (!shop || !token) {
      throw new Error("Missing Shopify env vars");
    }

    const headers = {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    };

    // 1. Variant → inventory_item_id
    const variantRes = await fetch(
      `https://${shop}/admin/api/2024-01/variants/${variant_id}.json`,
      { headers }
    );

    if (!variantRes.ok) {
      throw new Error("Failed to fetch variant");
    }

    const variantJson = await variantRes.json();
    const inventoryItemId = variantJson.variant.inventory_item_id;

    // 2. Inventory levels
    const inventoryRes = await fetch(
      `https://${shop}/admin/api/2024-01/inventory_levels.json?inventory_item_ids=${inventoryItemId}`,
      { headers }
    );

    const inventoryJson = await inventoryRes.json();

    // 3. Locations
    const locationsRes = await fetch(
      `https://${shop}/admin/api/2024-01/locations.json`,
      { headers }
    );

    const locationsJson = await locationsRes.json();

    const locationsById = Object.fromEntries(
      locationsJson.locations.map(l => [l.id, l])
    );

    const locations = inventoryJson.inventory_levels
      .filter(l => l.available > 0)
      .map(l => {
        const loc = locationsById[l.location_id];
        return {
          name: loc.name,
          stock: l.available,
          address: `${loc.address1}, ${loc.city}`,
          postcode: loc.zip,
        };
      });

    return res.status(200).json({ locations });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Server error",
      message: err.message,
    });
  }
}
