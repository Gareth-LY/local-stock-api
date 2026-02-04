// Import at the very top
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Helper functions
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function geocodePostcode(postcode) {
  try {
    const cleanPostcode = postcode.replace(/\s+/g, '').toUpperCase();
    const response = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(cleanPostcode)}`
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    
    if (data.status === 200 && data.result) {
      return {
        latitude: data.result.latitude,
        longitude: data.result.longitude,
      };
    }
    return null;
  } catch (err) {
    console.error("Geocoding error:", err.message);
    return null;
  }
}

const allowedOrigins = [
  "https://dev.lucyandyak.com",
  "https://lucy-and-yak-dev-store.myshopify.com",
  "https://lucy-yak-dev.myshopify.com"
];

export default async function handler(req, res) {
  // Set CORS headers first
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "https://dev.lucyandyak.com");
  }
  
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { variant_id, postcode } = req.body || {};

    if (!variant_id || !postcode) {
      return res.json({ 
        html: '<p class="error">Please provide variant ID and postcode</p>' 
      });
    }

    const SHOP = process.env.DEV_SHOP;
    const TOKEN = process.env.DEV_TOKEN;

    if (!SHOP || !TOKEN) {
      console.error("Missing environment variables");
      return res.json({ 
        html: '<p class="error">Configuration error</p>' 
      });
    }

    // Get variant
    const variantResponse = await fetch(
      `https://${SHOP}/admin/api/2025-10/variants/${variant_id}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    if (!variantResponse.ok) {
      return res.json({ 
        html: '<p class="error">Variant not found</p>' 
      });
    }

    const variantData = await variantResponse.json();
    const inventory_item_id = variantData.variant?.inventory_item_id;

    if (!inventory_item_id) {
      return res.json({ 
        html: '<p class="error">No inventory data</p>' 
      });
    }

    // Get inventory levels
    const inventoryResponse = await fetch(
      `https://${SHOP}/admin/api/2025-10/inventory_levels.json?inventory_item_ids=${inventory_item_id}`,
      {
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const levelsData = await inventoryResponse.json();
    
    const locationsWithStock = (levelsData.inventory_levels || []).filter(
      (loc) => loc.available > 0
    );

    if (locationsWithStock.length === 0) {
      return res.json({
        html: '<p class="no-stock">Out of stock at all stores</p>'
      });
    }

    // Get locations
    const locationIds = locationsWithStock.map((loc) => loc.location_id).join(",");
    const locationsResponse = await fetch(
      `https://${SHOP}/admin/api/2025-10/locations.json?ids=${locationIds}`,
      {
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const locationsData = await locationsResponse.json();

    // Geocode customer
    const customerCoords = await geocodePostcode(postcode);
    
    if (!customerCoords) {
      return res.json({ 
        html: '<p class="error">Invalid postcode</p>' 
      });
    }

    // Process locations
    const results = [];
    
    for (const invLevel of locationsWithStock) {
      const location = locationsData.locations?.find(
        (loc) => loc.id === invLevel.location_id
      );

      if (!location) continue;
      if (location.name?.toLowerCase().includes("unit 22")) continue;

      let distance = null;
      
      if (location.zip) {
        const storeCoords = await geocodePostcode(location.zip);
        if (storeCoords) {
          distance = calculateDistance(
            customerCoords.latitude,
            customerCoords.longitude,
            storeCoords.latitude,
            storeCoords.longitude
          );
        }
      }

      results.push({
        name: location.name || "Store",
        address: `${location.address1 || ''}, ${location.city || ''} ${location.zip || ''}`,
        phone: location.phone || "",
        available: invLevel.available,
        distance: distance,
      });
    }

    if (results.length === 0) {
      return res.json({
        html: '<p class="no-stock">No stores found</p>'
      });
    }

    // Sort and get top 3
    const sorted = results
      .filter(loc => loc.distance !== null)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);

    const final = sorted.length > 0 ? sorted : results.slice(0, 3);

    // Generate HTML
    const html = `
      <div class="stock-available">
        <h4>Available at nearby stores:</h4>
        <ul class="store-list">
          ${final.map(loc => `
            <li class="store-item">
              <div class="store-name">${loc.name}</div>
              <div class="store-address">${loc.address}</div>
              ${loc.phone ? `<div class="store-phone">📞 ${loc.phone}</div>` : ''}
              <div class="store-stock">
                <strong>${loc.available}</strong> in stock${loc.distance ? ` • ${loc.distance.toFixed(1)} miles` : ''}
              </div>
            </li>
          `).join('')}
        </ul>
      </div>
    `;

    return res.json({ html });

  } catch (error) {
    console.error("Error:", error);
    return res.json({ 
      html: '<p class="error">Error checking stock</p>' 
    });
  }
}
