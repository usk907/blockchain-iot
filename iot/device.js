const axios = require("axios");
const fs = require("fs");
const path = require("path");

const backendUrl = String(process.env.BACKEND_URL || "http://localhost:5000").trim();
const sendIntervalMs = Math.max(3000, Number(process.env.SEND_INTERVAL_MS || 5000));
const locationPrefix = String(process.env.LOCATION_PREFIX || "Industrial Zone").trim();
const devicesDbPath = path.resolve(__dirname, "..", "backend", "devices.json");

function readRegisteredDevices() {
  if (!fs.existsSync(devicesDbPath)) return [];

  try {
    const raw = fs.readFileSync(devicesDbPath, "utf8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item, index) => {
        const deviceId = String(item?.deviceId || "").trim();
        const factoryId = String(item?.factoryId || "").trim();
        const deviceType = String(item?.deviceType || "").trim().toLowerCase();
        if (!deviceId || !factoryId) return null;
        if (deviceType !== "demo_device") return null;
        return {
          deviceId,
          factoryId,
          location: `${locationPrefix} ${index + 1}`,
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.error("Unable to read backend/devices.json:", err.message);
    return [];
  }
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomFromBands(bands) {
  const roll = Math.random() * 100;
  let cumulative = 0;

  for (const band of bands) {
    cumulative += band.weight;
    if (roll <= cumulative) {
      return randomBetween(band.min, band.max);
    }
  }

  const fallback = bands[bands.length - 1];
  return randomBetween(fallback.min, fallback.max);
}

function generatePollutionData(device) {
  const pm2_5 = randomFromBands([
    { weight: 70, min: 20, max: 60 },
    { weight: 20, min: 60, max: 95 },
    { weight: 10, min: 95, max: 140 },
  ]);

  const pm10 = randomFromBands([
    { weight: 70, min: 40, max: 100 },
    { weight: 20, min: 100, max: 150 },
    { weight: 10, min: 20, max: 40 },
  ]);

  const co = randomFromBands([
    { weight: 75, min: 0.5, max: 2.0 },
    { weight: 15, min: 2.0, max: 3.0 },
    { weight: 10, min: 0.2, max: 0.5 },
  ]);

  const no2 = randomFromBands([
    { weight: 70, min: 15, max: 40 },
    { weight: 20, min: 40, max: 60 },
    { weight: 10, min: 5, max: 15 },
  ]);

  const so2 = randomFromBands([
    { weight: 75, min: 10, max: 40 },
    { weight: 15, min: 40, max: 55 },
    { weight: 10, min: 5, max: 10 },
  ]);

  const co2 = randomFromBands([
    { weight: 80, min: 500, max: 900 },
    { weight: 15, min: 900, max: 1200 },
    { weight: 5, min: 400, max: 500 },
  ]);

  return {
    deviceId: device.deviceId,
    factoryId: device.factoryId,
    location: device.location,
    pm2_5: pm2_5.toFixed(2),
    pm10: pm10.toFixed(2),
    co: co.toFixed(2),
    no2: no2.toFixed(2),
    so2: so2.toFixed(2),
    co2: co2.toFixed(2),
    stack_temperature: randomBetween(90, 180).toFixed(2),
    emission_rate: randomBetween(6, 16).toFixed(2),
    timestamp: new Date().toISOString(),
  };
}

async function sendForDevice(device) {
  const payload = generatePollutionData(device);

  try {
    const res = await axios.post(`${backendUrl}/store`, payload);
    console.log(`[${device.deviceId}] sent | status=${res.data?.status || "unknown"} | cid=${res.data?.cid || "none"}`);
  } catch (err) {
    const apiError = err.response?.data?.error || err.message;
    console.error(`[${device.deviceId}] send failed:`, apiError);
  }
}

async function sendDataCycle() {
  const devices = readRegisteredDevices();
  if (devices.length === 0) {
    console.log("No demo devices found in backend/devices.json");
    return;
  }

  await Promise.allSettled(devices.map((device) => sendForDevice(device)));
}

sendDataCycle();
setInterval(sendDataCycle, sendIntervalMs);
