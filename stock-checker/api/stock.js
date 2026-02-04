import fetch from "node-fetch";

const SHOP = "lucy-and-yak-dev-store.myshopify.com";
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN; // your Admin API token

export default async function handler(req, res) {
  const allowedOrigins = [
    "https://lucy-and-yak-dev-store.myshopify.com",
    "https://dev.lucyandyak.com"
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { variant_id, postcode } = req.body;
  if (!variant_id || !postcode) return res.status(400).json({ error: "Missing variant_id or postcode" });

  try {
    // 1️⃣ Get all store locations
    const locationsRes = await fetch(`https://${SHOP}/admin/api/2025-10/locations.json`, {
      headers: { "X-Shopify-Access-Token": TOKEN }
    });
    const locationsData = await locationsRes.json();
    const locations = locationsData.locations || [];

    // 2️⃣ Get variant info to find inventory_item_id
    const variantRes = await fetch(`https://${SHOP}/admin/api/2025-10/variants/${variant_id}.json`, {
      headers: { "X-Shopify-Access-Token": TOKEN }
    });
    const variantData = await variantRes.json();
    const inventoryItemId = variantData.variant.inventory_item_id;

    // 3️⃣ Get inventory levels for that item
    const inventoryRes = await fetch(`https://${SHOP}/admin/api/2025-10/inventory_levels.json?inventory_item_ids=${inventoryItemId}`, {
      headers: { "X-Shopify-Access-Token": TOKEN }
    });
    const inventoryLevelsData = await inventoryRes.json();
    const inventoryLevels = inventoryLevelsData.inventory_levels || [];

    // 4️⃣ Match stock with locations and filter by postcode prefix
    const nearby = inventoryLevels
      .map(level => {
        const location = locations.find(loc => loc.id === level.location_id);
        if (!location) return null;
        return {
          name: location.name,
          stock: level.available,
          address: location.address1,
          distance: Math.floor(Math.random() * 5) + 1, // temporary placeholder
          postcode: location.zip
        };
      })
      .filter(store => store && store.postcode.startsWith(postcode.substring(0, 3)));

    return res.status(200).json({ locations: nearby });
  } catch (err) {
    console.error("Inventory fetch error:", err);
    return res.status(500).json({ error: "Failed to fetch inventory" });
  }
}
