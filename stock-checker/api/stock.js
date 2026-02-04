// Helper functions at the top
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

async function geocodeAddress(postcode) {
  try {
    if (!postcode) return null;
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
    console.error("Address geocoding error:", err.message);
    return null;
  }
}

// Allowed origins
const allowedOrigins = [
  "https://dev.lucyandyak.com",
  "https://lucy-and-yak-dev-store.myshopify.com",
  "https://lucy-yak-dev.myshopify.com"
];

export default async function handler(req, res) {
  // CRITICAL: Set CORS headers FIRST, before ANY other code
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "https://dev.lucyandyak.com");
  }
  
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Handle OPTIONS preflight
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // Only allow POST
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Wrap everything in try-catch to prevent crashes
  try {
    const { variant_id, postcode } = req.body || {};

    if (!variant_id || !postcode) {
      res.json({ 
        html: '<p class="error">Please provide a variant ID and postcode</p>' 
      });
      return;
    }

    // Get environment variables
    const SHOP = process.env.DEV_SHOP;
    const TOKEN = process.env.DEV_TOKEN;

    if (!SHOP || !TOKEN) {
      console.error("Missing DEV_SHOP or DEV_TOKEN environment variables");
      res.json({ 
        html: '<p class="error">Server configuration error. Please contact support.</p>' 
      });
      return;
    }

    console.log("Processing request for variant:", variant_id, "postcode:", postcode);

    // Step 1: Get variant to find inventory_item_id
    let variantResponse;
    try {
      variantResponse = await fetch(
        `https://${SHOP}/admin/api/2025-10/variants/${variant_id}.json`,
        {
          headers: {
            "X-Shopify-Access-Token": TOKEN,
            "Content-Type": "application/json",
          },
        }
      );
    } catch (fetchError) {
      console.error("Variant fetch error:", fetchError.message);
      res.json({ 
        html: '<p class="error">Unable to connect to store. Please try again.</p>' 
      });
      return;
    }

    if (!variantResponse.ok) {
      console.error("Variant API error:", variantResponse.status);
      res.json({ 
        html: '<p class="error">Product variant not found</p>' 
      });
      return;
    }

    const variantData = await variantResponse.json();
    const inventory_item_id = variantData.variant?.inventory_item_id;

    if (!inventory_item_id) {
      res.json({ 
        html: '<p class="error">Inventory data not available for this product</p>' 
      });
      return;
    }

    console.log("Found inventory_item_id:", inventory_item_id);

    // Step 2: Get inventory levels
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
    
    if (!levelsData.inventory_levels || levelsData.inventory_levels.length === 0) {
      res.json({
        html: '<p class="no-stock">No inventory information available</p>'
      });
      return;
    }

    // Filter for stock > 0
    const locationsWithStock = levelsData.inventory_levels.filter(
      (loc) => loc.available > 0
    );

    console.log("Locations with stock:", locationsWithStock.length);

    if (locationsWithStock.length === 0) {
      res.json({
        html: '<p class="no-stock">Sorry, this item is currently out of stock at all stores.</p>'
      });
      return;
    }

    // Step 3: Get location details
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

    if (!locationsData.locations || locationsData.locations.length === 0) {
      res.json({
        html: '<p class="error">Unable to retrieve store locations</p>'
      });
      return;
    }

    // Step 4: Geocode customer postcode
    const customerCoords = await geocodePostcode(postcode);
    
    if (!customerCoords) {
      res.json({ 
        html: '<p class="error">Invalid UK postcode. Please check and try again.</p>' 
      });
      return;
    }

    console.log("Customer coordinates:", customerCoords);

    // Step 5: Calculate distances
    const locationsWithDistances = [];
    
    for (const invLevel of locationsWithStock) {
      const location = locationsData.locations.find(
        (loc) => loc.id === invLevel.location_id
      );

      if (!location) continue;

      // Skip Unit 22 warehouse
      if (location.name && location.name.toLowerCase().includes("unit 22")) {
        console.log("Skipping warehouse:", location.name);
        continue;
      }

      let distance = null;
      
      if (location.zip) {
        const storeCoords = await geocodeAddress(location.zip);
        if (storeCoords) {
          distance = calculateDistance(
            customerCoords.latitude,
            customerCoords.longitude,
            storeCoords.latitude,
            storeCoords.longitude
          );
        }
      }

      locationsWithDistances.push({
        name: location.name || "Store",
        address1: location.address1 || "",
        city: location.city || "",
        zip: location.zip || "",
        phone: location.phone || "",
        available: invLevel.available,
        distance: distance,
      });
    }

    if (locationsWithDistances.length === 0) {
      res.json({
        html: '<p class="no-stock">No stores found with this item in stock.</p>'
      });
      return;
    }

    // Step 6: Sort by distance and get top 3
    const sorted = locationsWithDistances
      .filter(loc => loc.distance !== null)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);

    // Fallback if no distances calculated
    const finalLocations = sorted.length > 0 ? sorted : locationsWithDistances.slice(0, 3);

    // Step 7: Generate HTML
    const html = `
      <div class="stock-available">
        <h4>${sorted.length > 0 ? 'Available at these nearby stores:' : 'Available at these stores:'}</h4>
        <ul class="store-list">
          ${finalLocations.map(loc => `
            <li class="store-item">
              <div class="store-name">${loc.name}</div>
              <div class="store-address">${loc.address1}${loc.city ? ', ' + loc.city : ''} ${loc.zip}</div>
              ${loc.phone ? `<div class="store-phone">📞 ${loc.phone}</div>` : ''}
              <div class="store-stock">
                <strong>${loc.available}</strong> in stock${loc.distance ? ` • <span class="store-distance">${loc.distance.toFixed(1)} miles away</span>` : ''}
              </div>
            </li>
          `).join('')}
        </ul>
      </div>
    `;

    res.json({ html });

  } catch (error) {
    console.error("Unexpected error:", error.message, error.stack);
    res.json({ 
      html: '<p class="error">An unexpected error occurred. Please try again later.</p>' 
    });
  }
}
