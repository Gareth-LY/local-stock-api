const ALLOWED_ORIGINS = [
  "https://dev.lucyandyak.com",
  "https://lucy-and-yak-dev-store.myshopify.com",
];

export default async function handler(req, res) {
  const origin = req.headers.origin;

  // Always set CORS headers if origin is allowed
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader(
      "Access-Control-Allow-Methods",
      "POST, OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type"
    );
  }

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { variant_id, postcode } = req.body;
  if (!variant_id || !postcode) {
    return res.status(400).json({ error: "Missing variant_id or postcode" });
  }

  let SHOP, TOKEN;
  if (origin === "https://dev.lucyandyak.com") {
    SHOP = process.env.DEV_SHOP;
    TOKEN = process.env.DEV_TOKEN;
  } else if (origin === "https://lucy-and-yak-dev-store.myshopify.com") {
    SHOP = process.env.SHOPIFY_SHOP;
    TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
  } else {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  try {
    // Fetch variant and inventory levels (Shopify Admin API 2025-10)
    const variantRes = await fetch(
      `https://${SHOP}/admin/api/2025-10/variants/${variant_id}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json",
        },
      }
    );
    const variantData = await variantRes.json();
    const inventoryItemId = variantData.variant.inventory_item_id;

    const levelsRes = await fetch(
      `https://${SHOP}/admin/api/2025-10/inventory_levels.json?inventory_item_ids=${inventoryItemId}`,
      {
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json",
        },
      }
    );
    const levelsData = await levelsRes.json();

    const locationsRes = await fetch(
      `https://${SHOP}/admin/api/2025-10/locations.json`,
      {
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json",
        },
      }
    );
    const locations = await locationsRes.json();

    const stores = levelsData.inventory_levels
      .map(level => {
        const loc = locations.locations.find(l => l.id === level.location_id);
        return loc && level.available > 0
          ? {
              name: loc.name,
              stock: level.available,
              address: loc.address1,
              postcode: loc.zip || "",
              distance: Math.floor(Math.random() * 10) + 1,
            }
          : null;
      })
      .filter(Boolean);

    const closest = stores.sort((a, b) => a.distance - b.distance).slice(0, 3);

    const html = closest.length
      ? closest
          .map(
            store => `
      <div class="stock-location">
        <strong>${store.name}</strong>
        <span class="stock-count">${store.stock} in stock</span>
        <div class="address">${store.address}</div>
        <div class="distance">${store.distance} miles away</div>
      </div>
    `
          )
          .join("")
      : "<div>No stock nearby</div>";

    res.status(200).json({ html });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Unable to fetch inventory data" });
  }
}
