const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const devicesDbPath = path.resolve(__dirname, "..", "devices.json");

function readDevices() {
  if (!fs.existsSync(devicesDbPath)) return [];

  try {
    const raw = fs.readFileSync(devicesDbPath, "utf8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Failed reading devices.json:", err.message);
    return [];
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeCompareHex(a, b) {
  try {
    const aBuffer = Buffer.from(a, "hex");
    const bBuffer = Buffer.from(b, "hex");
    if (aBuffer.length !== bBuffer.length) return false;
    return crypto.timingSafeEqual(aBuffer, bBuffer);
  } catch (err) {
    return false;
  }
}

function authenticateDevice(req) {
  const deviceId = String(req.header("x-device-id") || "").trim();
  const deviceKey = String(req.header("x-device-key") || "").trim();

  if (!deviceId || !deviceKey) {
    return {
      ok: false,
      status: 401,
      error: "Missing device credentials. Required headers: x-device-id, x-device-key.",
    };
  }

  const devices = readDevices();
  const record = devices.find((item) => item.deviceId === deviceId);
  if (!record) {
    return {
      ok: false,
      status: 403,
      error: "Device is not registered.",
    };
  }

  const keyHash = sha256(deviceKey);
  const valid = safeCompareHex(record.apiKeyHash || "", keyHash);

  if (!valid) {
    return {
      ok: false,
      status: 401,
      error: "Invalid device key.",
    };
  }

  return {
    ok: true,
    record,
  };
}

function deviceAuth(req, res, next) {
  const auth = authenticateDevice(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const { record } = auth;
  req.device = {
    deviceId: record.deviceId,
    factoryId: record.factoryId,
    deviceType: record.deviceType === "demo_device" ? "demo_device" : "iot_module",
    walletAddress: record.walletAddress || null,
  };

  return next();
}

deviceAuth.authenticateDevice = authenticateDevice;

module.exports = deviceAuth;
