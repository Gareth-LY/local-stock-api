import fetch from "node-fetch";

// Helper functions defined FIRST
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
      `https://api.postcodes.io/postcodes/${encodeURIComponent(cleanPostcode)}`,
      { timeout: 5000 }
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

async function geocodeAddress(postcode) {
  try {
    if (!postcode) return null;
    const cleanPostcode = postcode.replace(/\s+/g, '').toUpperCase();
    const response = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(cleanPostcode)}`,
      { timeout: 5000 }
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
    console.error("Address geocoding error:", err);
    return null;
  }
}

// Main handler
export default async function handler(req, res) {
  // Set CORS headers immediately
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { variant_id, postcode } = req.body;

    if (!variant_id || !postcode) {
      return res.status(400).json({ 
        html: '<p class="error">Missing variant ID or postcode</p>' 
      });
    }

    // Use dev credentials
    const SHOP = process.env.DEV_SHOP;
    const TOKEN = process.env.DEV_TOKEN;

    if (!SHOP || !TOKEN) {
      console.error("Missing environment variables");
      return res.json({ 
        html: '<p class="error">Server configuration error</p>' 
      });
    }

    console.log("Fetching variant:", variant_id);

    // Step 1: Get inventory_item_id from variant
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
        html: '<p class="error">Product variant not found</p>' 
      });
    }

    const variantData = await variantResponse.json();
    const inventory_item_id = variantData.variant?.inventory_item_id;

    if (!inventory_item_id) {
      return res.json({ 
        html: '<p class="error">Inventory data not available</p>' 
      });
    }

    console.log("Inventory item ID:", inventory_item_id);

    // Step 2: Fetch inventory levels
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
    console.log("Inventory levels found:", levelsData.inventory_levels?.length || 0);

    // Filter locations with stock
    let locationsWithStock = (levelsData.inventory_levels || []).filter(
      (loc) => loc.available > 0
    );

    if (locationsWithStock.length === 0) {
      return res.json({
        html: '<p class="no-stock">Sorry, this item is currently out of stock at all stores.</p>'
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
    console.log("Locations found:", locationsData.locations?.length || 0);

    // Step 4: Geocode customer postcode
    const customerCoords = await geocodePostcode(postcode);
    
    if (!customerCoords) {
      return res.json({ 
        html: '<p class="error">Invalid postcode. Please enter a valid UK postcode.</p>' 
      });
    }

    console.log("Customer coords:", customerCoords);

    // Step 5: Process locations with distances
    const locationsPromises = locationsWithStock.map(async (invLevel) => {
      const location = locationsData.locations?.find(
        (loc) => loc.id === invLevel.location_id
      );

      if (!location) return null;

      // Skip Unit 22 warehouse
      if (location.name?.toLowerCase().includes("unit 22")) {
        console.log("Skipping Unit 22");
        return null;
      }

      let distance = null;
      
      // Try to geocode store location
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

      return {
        name: location.name || "Store",
        address1: location.address1 || "",
        city: location.city || "",
        zip: location.zip || "",
        phone: location.phone || "",
        available: invLevel.available,
        distance: distance,
      };
    });

    const locations = (await Promise.all(locationsPromises)).filter(Boolean);

    // Step 6: Sort and get top 3
    const sorted = locations
      .filter(loc => loc.distance !== null)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);

    if (sorted.length === 0) {
      // If no distances calculated, just show first 3 with stock
      const fallback = locations.slice(0, 3);
      const html = `
        <div class="stock-available">
          <h4>Available at these stores:</h4>
          <ul class="store-list">
            ${fallback.map(loc => `
              <li class="store-item">
                <div class="store-name">${loc.name}</div>
                <div class="store-address">${loc.address1}, ${loc.city} ${loc.zip}</div>
                ${loc.phone ? `<div class="store-phone">📞 ${loc.phone}</div>` : ''}
                <div class="store-stock"><strong>${loc.available}</strong> in stock</div>
              </li>
            `).join('')}
          </ul>
        </div>
      `;
      return res.json({ html });
    }

    // Step 7: Generate HTML
    const html = `
      <div class="stock-available">
        <h4>Available at these nearby stores:</h4>
        <ul class="store-list">
          ${sorted.map(loc => `
            <li class="store-item">
              <div class="store-name">${loc.name}</div>
              <div class="store-address">${loc.address1}, ${loc.city} ${loc.zip}</div>
              ${loc.phone ? `<div class="store-phone">📞 ${loc.phone}</div>` : ''}
              <div class="store-stock">
                <strong>${loc.available}</strong> in stock • 
                <span class="store-distance">${loc.distance.toFixed(1)} miles away</span>
              </div>
            </li>
          `).join('')}
        </ul>
      </div>
    `;

    return res.json({ html });

  } catch (err) {
    console.error("Error:", err.message, err.stack);
    return res.json({ 
      html: '<p class="error">Unable to check stock. Please try again.</p>' 
    });
  }
}
