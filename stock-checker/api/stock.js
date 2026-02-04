import fetch from "node-fetch";

// CORS whitelist
const allowedOrigins = [
  "https://lucy-and-yak-dev-store.myshopify.com",
  "https://dev.lucyandyak.com",
];

// Haversine formula to calculate distance between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles (use 6371 for km)
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

// Geocode UK postcode using postcodes.io (free, no API key needed)
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

// Geocode a full UK address
async function geocodeAddress(address, city, postcode) {
  try {
    const fullAddress = `${address}, ${city}, ${postcode}, UK`;
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
    console.error("Address geocoding error:", err);
    return null;
  }
}

export default async function handler(req, res) {
  // Handle CORS preflight
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

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

    if (host.includes("dev.lucyandyak.com")) {
      SHOP = process.env.DEV_SHOP;
      TOKEN = process.env.DEV_TOKEN;
    } else if (host.includes("lucy-and-yak-dev-store.myshopify.com")) {
      SHOP = process.env.SHOPIFY_SHOP;
      TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
    } else {
      return res.status(403).json({ error: "Unknown origin" });
    }

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
    console.log("RAW inventory_levels response:", levelsData);

    // Filter locations with stock > 0
    let locationsWithStock = (levelsData.inventory_levels || []).filter(
      (loc) => loc.available > 0
    );

    console.log("Filtered locations with stock:", locationsWithStock);

    if (locationsWithStock.length === 0) {
      return res.json({
        html: '<p class="no-stock">Sorry, this item is currently out of stock at all nearby stores.</p>'
      });
    }

    // Step 3: Fetch location details (addresses, coordinates)
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
    console.log("Locations data:", locationsData);

    // Step 4: Geocode the customer's postcode
    const customerCoords = await geocodePostcode(postcode);
    
    if (!customerCoords) {
      return res.json({ 
        html: '<p class="error">Invalid postcode. Please enter a valid UK postcode.</p>' 
      });
    }

    console.log("Customer coordinates:", customerCoords);

    // Step 5: Merge inventory levels with location details and calculate distances
    const locationsWithDistancePromises = locationsWithStock.map(async (invLevel) => {
      const location = locationsData.locations?.find(
        (loc) => loc.id === invLevel.location_id
      );

      if (!location) return null;

      // Filter out Unit 22 warehouse by name
      if (location.name?.toLowerCase().includes("unit 22")) {
        console.log("Excluding Unit 22 warehouse");
        return null;
      }

      // Geocode the store location
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
        location_id: location.id,
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
      .filter(Boolean); // Remove nulls

    // Step 6: Sort by distance and return top 3
    const sortedLocations = locationsWithDistance
      .filter(loc => loc.distance !== null) // Only include locations with valid distances
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);

    if (sortedLocations.length === 0) {
      return res.json({
        html: '<p class="no-stock">Unable to calculate distances to stores. Please try again.</p>'
      });
    }

    // Step 7: Generate HTML for the frontend
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
