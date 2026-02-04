import fetch from "node-fetch";

// CORS whitelist
const allowedOrigins = [
  "https://lucy-and-yak-dev-store.myshopify.com",
  "https://dev.lucyandyak.com",
  "https://lucy-yak-dev.myshopify.com", // Added this one too
];

export default async function handler(req, res) {
  // Handle CORS - set headers FIRST before any other logic
  const origin = req.headers.origin || req.headers.referer;
  
  // Check if origin is allowed
  const isAllowed = allowedOrigins.some(allowed => 
    origin && origin.includes(allowed.replace('https://', ''))
  );

  if (isAllowed || allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || allowedOrigins[0]);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours
  }

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { variant_id, postcode } = req.body;

    if (!variant_id || !postcode) {
      return res.status(400).json({ error: "Missing variant_id or postcode" });
    }

    // Determine which store/token to use
    const host = origin || "";
    let SHOP, TOKEN;

    if (host.includes("dev.lucyandyak.com") || host.includes("lucy-yak-dev")) {
      SHOP = process.env.DEV_SHOP;
      TOKEN = process.env.DEV_TOKEN;
    } else if (host.includes("lucy-and-yak-dev-store.myshopify.com")) {
      SHOP = process.env.SHOPIFY_SHOP;
      TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
    } else {
      // Default to dev if origin not matched
      SHOP = process.env.DEV_SHOP;
      TOKEN = process.env.DEV_TOKEN;
    }

    console.log("Using shop:", SHOP);

    // Step 1: Get the variant to retrieve inventory_item_id
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
      console.error("Variant fetch failed:", variantResponse.status);
      return res.json({ 
        html: '<p class="error">Variant not found</p>' 
      });
    }

    const variantData = await variantResponse.json();
    const inventory_item_id = variantData.variant?.inventory_item_id;

    if (!inventory_item_id) {
      return res.json({ 
        html: '<p class="error">Inventory item not found</p>' 
      });
    }

    console.log("Inventory item ID:", inventory_item_id);

    // Step 2: Fetch inventory levels using inventory_item_id
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
    console.log("Inventory levels:", levelsData);

    // Filter locations with stock > 0
    let locationsWithStock = (levelsData.inventory_levels || []).filter(
      (loc) => loc.available > 0
    );

    if (locationsWithStock.length === 0) {
      return res.json({
        html: '<p class="no-stock">Sorry, this item is currently out of stock at all nearby stores.</p>'
      });
    }

    // Step 3: Fetch location details
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

    // Step 4: Geocode the customer's postcode
    const customerCoords = await geocodePostcode(postcode);
    
    if (!customerCoords) {
      return res.json({ 
        html: '<p class="error">Invalid postcode. Please enter a valid UK postcode.</p>' 
      });
    }

    // Step 5: Calculate distances for each location
    const locationsWithDistancePromises = locationsWithStock.map(async (invLevel) => {
      const location = locationsData.locations?.find(
        (loc) => loc.id === invLevel.location_id
      );

      if (!location) return null;

      // Filter out Unit 22 warehouse
      if (location.name?.toLowerCase().includes("unit 22")) {
        return null;
      }

      let distance = null;
      if (location.zip) {
        const storeCoords = await geocodeAddress(
          location.address1 || "",
          location.city || "",
          location.zip
        );

        if (storeCoords) {
          distance = calculateDistance(
            customerCoords.latitude,
            customerCoords.longitude,
            storeCoords.latitude,
            storeCoords.longitude
          );
        }
      }

      return {
        name: location.name,
        address1: location.address1 || "",
        city: location.city || "",
        zip: location.zip || "",
        phone: location.phone || "",
        available: invLevel.available,
        distance: distance,
      };
    });

    const locationsWithDistance = (await Promise.all(locationsWithDistancePromises))
      .filter(Boolean);

    // Step 6: Sort by distance and get top 3
    const sortedLocations = locationsWithDistance
      .filter(loc => loc.distance !== null)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);

    if (sortedLocations.length === 0) {
      return res.json({
        html: '<p class="no-stock">Unable to find nearby stores with stock.</p>'
      });
    }

    // Step 7: Generate HTML
    const html = `
      <div class="stock-available">
        <h4>Available at these nearby stores:</h4>
        <ul class="store-list">
          ${sortedLocations.map(loc => `
            <li class="store-item">
              <div class="store-name">${loc.name}</div>
              <div class="store-address">${loc.address1}, ${loc.city} ${loc.zip}</div>
              ${loc.phone ? `<div class="store-phone">📞 ${loc.phone}</div>` : ''}
              <div class="store-stock">
                <strong>${loc.available}</strong> in stock
                ${loc.distance ? ` • <span class="store-distance">${loc.distance.toFixed(1)} miles away</span>` : ''}
              </div>
            </li>
          `).join('')}
        </ul>
      </div>
    `;

    return res.json({ html });

  } catch (err) {
    console.error("Error fetching stock:", err);
    return res.json({ 
      html: '<p class="error">Unable to check stock. Please try again later.</p>' 
    });
  }
}

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
    const response = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`
    );
    const data = await response.json();
    
    if (data.status === 200 && data.result) {
      return {
        latitude: data.result.latitude,
        longitude: data.result.longitude,
      };
    }
    return null;
  } catch (err) {
    console.error("Geocoding error:", err);
    return null;
  }
}

async function geocodeAddress(address, city, postcode) {
  try {
    const response = await fetch(
      `https://api.postcodes.io/postcodes?q=${encodeURIComponent(postcode)}`
    );
    const data = await response.json();
    
    if (data.status === 200 && data.result && data.result.length > 0) {
      return {
        latitude: data.result[0].latitude,
        longitude: data.result[0].longitude,
      };
    }
    return null;
  } catch (err) {
    return null;
  }
}
