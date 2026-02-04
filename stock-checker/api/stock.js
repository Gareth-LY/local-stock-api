// api/stock.js
export default async function handler(req, res) {
  // ✅ Handle preflight CORS requests first
  res.setHeader("Access-Control-Allow-Origin", "https://lucy-and-yak-dev-store.myshopify.com"); // only your Shopify domain
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end(); // respond to preflight
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { variant_id, postcode } = req.body;

  if (!variant_id || !postcode) {
    res.status(400).json({ error: "Missing variant_id or postcode" });
    return;
  }

  // Example inventory data
  const inventoryData = [
    { id: 1, name: "Brighton Store", stock: 5, address: "Unit 22, Valley Road", postcode: "BN1" },
    { id: 2, name: "London Store", stock: 0, address: "123 London St", postcode: "LN1" },
  ];

  const nearby = inventoryData
    .filter(store => store.postcode.toUpperCase().startsWith(postcode.substring(0, 3).toUpperCase()))
    .map(store => ({
      name: store.name,
      stock: store.stock,
      address: store.address,
      distance: Math.floor(Math.random() * 5) + 1,
    }));

  res.status(200).json({ locations: nearby });
}
