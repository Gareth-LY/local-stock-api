// api/stock.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { variant_id, postcode } = req.body;

  if (!variant_id || !postcode) {
    return res.status(400).json({ error: "Missing variant_id or postcode" });
  }

  // TODO: Replace with real Shopify Admin API call
  const inventoryData = [
    { id: 1, name: "Brighton Store", stock: 5, postcode: "BN1", address: "Unit 22, Valley Road" },
    { id: 2, name: "London Store", stock: 0, postcode: "LN1", address: "123 London St" },
  ];

  // Filter stores by postcode prefix (simple example)
  const nearby = inventoryData
    .filter(store => store.postcode.toUpperCase().startsWith(postcode.substring(0, 3).toUpperCase()))
    .map(store => ({
      name: store.name,
      stock: store.stock,
      address: store.address,
      distance: Math.floor(Math.random() * 5) + 1, // placeholder distance
    }));

  return res.status(200).json({ locations: nearby });
}
