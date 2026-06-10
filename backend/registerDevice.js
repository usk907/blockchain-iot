const axios = require("axios");

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (!found) return fallback;
  return found.slice(prefix.length);
}

async function main() {
  const backendUrl = getArg("backend-url", process.env.BACKEND_URL || "http://127.0.0.1:5000");
  const deviceId = getArg("device-id", process.env.DEVICE_ID || "");
  const factoryId = getArg("factory-id", process.env.FACTORY_ID || "");
  const deviceType = getArg("device-type", process.env.DEVICE_TYPE || "iot_module");
  const walletAddress = getArg("wallet-address", process.env.DEVICE_WALLET_ADDRESS || "");
  const adminKey = getArg("admin-key", process.env.ADMIN_API_KEY || "admin-dev-key");

  if (!deviceId || !factoryId) {
    console.log("Usage:");
    console.log(
      "node registerDevice.js --device-id=ESP32_001 --factory-id=FACTORY_001 --device-type=iot_module --wallet-address=0xabc --backend-url=http://127.0.0.1:5000 --admin-key=admin-dev-key"
    );
    process.exit(1);
  }

  try {
    const res = await axios.post(
      `${backendUrl}/api/devices/register`,
      { deviceId, factoryId, deviceType, walletAddress },
      {
        headers: {
          "x-admin-key": adminKey,
          "Content-Type": "application/json",
        },
      }
    );

    const data = res.data;
    console.log("Device registered successfully.");
    console.log("--------------------------------");
    console.log("deviceId:", data.deviceId);
    console.log("factoryId:", data.factoryId);
    console.log("deviceType:", data.deviceType || "iot_module");
    console.log("walletAddress:", data.walletAddress || "none");
    console.log("registeredOnChain:", data.registeredOnChain);
    if (data.registerError) {
      console.log("registerError:", data.registerError);
    }
    console.log("apiKey:", data.apiKey);
    console.log("--------------------------------");
    console.log("Use headers on device ingest requests:");
    console.log(`x-device-id: ${data.deviceId}`);
    console.log(`x-device-key: ${data.apiKey}`);
  } catch (err) {
    const payload = err.response?.data || err.message;
    console.error("Device registration failed:", payload);
    process.exit(1);
  }
}

main();
