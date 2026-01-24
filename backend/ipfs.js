const { create } = require("ipfs-http-client");

const client = create({ url: "http://127.0.0.1:5001" });

async function storeToIPFS(data) {
  const result = await client.add(JSON.stringify(data));
  return result.path;
}

module.exports = { storeToIPFS };
