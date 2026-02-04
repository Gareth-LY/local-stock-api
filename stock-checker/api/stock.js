export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { variant_id, postcode } = req.body;

  if (!variant_id || !postcode) {
    return res.status(400).json({ error: "Missing variant_id or postcode" });
  }

  const SHOP = process.env.SHOPIFY_SHOP;
  const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

  try {
    // Fetch inventory levels for this variant
    const inventoryRes = await fetch(`https://${SHOP}/admin/api/2025-10/variants/${variant_id}.json`, {
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      }
    });
    const variantData = await inventoryRes.json();
    const inventoryItemId = variantData.variant.inventory_item_id;

    // Fetch inventory levels at each location
    const levelsRes = await fetch(`https://${SHOP}/admin/api/2025-10/inventory_levels.json?inventory_item_ids=${inventoryItemId}`, {
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      }
    });
    const levelsData = await levelsRes.json(); // levelsData.inventory_levels

    // Fetch location details to get names and addresses
    const locationRes = await fetch(`https://${SHOP}/admin/api/2025-10/locations.json`, {
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      }
    });
    const locations = await locationRes.json(); // locations.locations

    // Merge levels with locations
    const stores = levelsData.inventory_levels
      .map(level => {
        const loc = locations.locations.find(l => l.id === level.location_id);
        return loc && level.available > 0 ? {
          name: loc.name,
          stock: level.available,
          address: loc.address1,
          postcode: loc.zip || "",
          distance: Math.floor(Math.random() * 10) + 1 // temp: random distance
        } : null;
      })
      .filter(Boolean);

    // Filter and sort closest 3 stores
    const closest = stores
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);

    // Return HTML for front-end
    const html = closest.map(store => `
      <div class="stock-location">
        <strong>${store.name}</strong>
        <span class="stock-count">${store.stock} in stock</span>
        <div class="address">${store.address}</div>
        <div class="distance">${store.distance} miles away</div>
      </div>
    `).join("");

    res.setHeader("Access-Control-Allow-Origin", "*"); // or restrict to your domains
    res.status(200).json({ html });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Unable to fetch inventory data" });
  }
}
