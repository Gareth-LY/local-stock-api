import fetch from "node-fetch";

const allowedOrigins = [
  "https://lucy-and-yak-dev-store.myshopify.com",
  "https://dev.lucyandyak.com",
];

export default async function handler(req, res) {
  const origin = req.headers.origin;

  // Always set CORS headers if origin matches
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
  }

  // Respond to preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { variant_id, postcode } = req.body;

    if (!variant_id || !postcode) {
      return res.status(400).json({ error: "Missing variant_id or postcode" });
    }

    // Determine shop/token
    let SHOP, TOKEN;
    if (origin?.includes("dev.lucyandyak.com")) {
      SHOP = process.env.DEV_SHOP;
      TOKEN = process.env.DEV_TOKEN;
    } else if (origin?.includes("lucy-and-yak-dev-store.myshopify.com")) {
      SHOP = process.env.SHOPIFY_SHOP;
      TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
    } else {
      return res.status(403).json({ error: "Unknown origin" });
    }

    // Fetch inventory levels from Shopify
    const inventoryResponse = await fetch(
      `https://${SHOP}/admin/api/2025-10/inventory_levels.json?inventory_item_ids=${variant_id}`,
      {
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const levelsData = await inventoryResponse.json();

    console.log("RAW inventory_levels response:", levelsData);

    const locationsWithStock = (levelsData.inventory_levels || []).filter(
      (loc) => loc.available > 0
    );

    console.log("Filtered locations with stock:", locationsWithStock);

    // If none in stock, return all for debug
    if (locationsWithStock.length === 0) {
      return res.json({
        message: "No stock nearby yet, showing all locations for debug",
        locations: levelsData.inventory_levels || [],
      });
    }

    return res.json({
      message: "Stock found",
      locations: locationsWithStock,
    });
  } catch (err) {
    console.error("Error fetching stock:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
