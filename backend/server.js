const express = require("express");
const { Web3 } = require("web3");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");
const { storeToIPFS } = require("./ipfs");
const { LIMITS, DEMO_FINE_RULES, LEGAL_PENALTY_PROFILE, NORMAL_RANGE } = require("./constants");
const deviceAuth = require("./middleware/deviceAuth");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const backendPort = Number(process.env.BACKEND_PORT || 5000);
const adminApiKey = process.env.ADMIN_API_KEY || "admin-dev-key";
const penaltyMode = String(process.env.PENALTY_MODE || "LEGAL_IN_AIR_ACT")
  .trim()
  .toUpperCase();
const autoTelemetryEnabled =
  String(process.env.AUTO_TELEMETRY_ENABLED || "true").trim().toLowerCase() !== "false";
const autoTelemetryIntervalMs = Math.max(
  3000,
  Number(process.env.AUTO_TELEMETRY_INTERVAL_MS || 15000)
);
const violationsDbPath = path.resolve(__dirname, "violations.json");
const devicesDbPath = path.resolve(__dirname, "devices.json");
const deviceArchivesDirPath = path.resolve(__dirname, "device-archives");
const deviceArchivesIndexPath = path.resolve(deviceArchivesDirPath, "index.json");
const allowedDeviceTypes = new Set(["demo_device", "iot_module"]);
const autoTelemetryTimers = new Map();

function normalizeDeviceType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "iot_module";
  if (raw === "demo" || raw === "demo_device") return "demo_device";
  if (raw === "iot" || raw === "iot_module") return "iot_module";
  return raw;
}

function toDeviceResponse(item) {
  return {
    deviceId: item.deviceId,
    factoryId: item.factoryId,
    deviceType: normalizeDeviceType(item.deviceType),
    walletAddress: item.walletAddress || "",
    createdAt: item.createdAt,
  };
}

// ---------------- Blockchain ----------------
const web3 = new Web3(process.env.BLOCKCHAIN_RPC || "http://127.0.0.1:7545");
const artifact = JSON.parse(fs.readFileSync(path.resolve(__dirname, "IoTDataABI.json"), "utf8"));
const contractAddress =
  process.env.CONTRACT_ADDRESS || "0x5c4C0c922c9023cd211c934049043c091F0aC024";
const arduinoContractAddress = process.env.ARDUINO_CONTRACT_ADDRESS || contractAddress;
const contract = new web3.eth.Contract(artifact.abi, contractAddress);
const arduinoContract = new web3.eth.Contract(artifact.abi, arduinoContractAddress);

function getContractAddress(contractInstance, fallback = contractAddress) {
  return contractInstance?.options?.address || fallback;
}

async function ensureStoreAccountRegistered(contractInstance, contractLabel) {
  const admin = blockchainAccounts.admin;
  const writer = blockchainAccounts.device;
  if (!admin || !writer || !contractInstance) return;

  try {
    const entity = await contractInstance.methods.entities(writer).call();
    const role = Number(entity?.role || 0);
    const active = Boolean(entity?.active);

    if (role === 1 && active) {
      return;
    }

    await contractInstance.methods.registerDevice(writer).send({
      from: admin,
      gas: 300000,
    });
    console.log(`Registered writer account ${writer} on ${contractLabel} contract.`);
  } catch (err) {
    console.error(
      `Unable to auto-register writer account on ${contractLabel} contract:`,
      err.message
    );
  }
}

let blockchainAccounts = { admin: null, device: null };
web3.eth
  .getAccounts()
  .then(async (accounts) => {
    blockchainAccounts = {
      admin: accounts[0] || null,
      device: accounts[1] || accounts[0] || null,
    };
    console.log("Using blockchain admin account:", blockchainAccounts.admin);
    console.log("Using blockchain store account:", blockchainAccounts.device);
    console.log("Default contract address:", contractAddress);
    console.log("Real Arduino contract address:", arduinoContractAddress);

    await ensureStoreAccountRegistered(contract, "default");
    if (arduinoContractAddress !== contractAddress) {
      await ensureStoreAccountRegistered(arduinoContract, "real-arduino");
    }
  })
  .catch((err) => {
    console.error("Unable to load blockchain accounts:", err.message);
  });

// ---------------- In-memory Notifications ----------------
let notifications = [];

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) return [];

  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error(`Failed reading ${filePath}:`, err.message);
    return [];
  }
}

function writeJsonArray(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function ensureArchiveStorage() {
  if (!fs.existsSync(deviceArchivesDirPath)) {
    fs.mkdirSync(deviceArchivesDirPath, { recursive: true });
  }

  if (!fs.existsSync(deviceArchivesIndexPath)) {
    writeJsonArray(deviceArchivesIndexPath, []);
  }
}

function toFixedNumber(value, fractionDigits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Number(numeric.toFixed(fractionDigits));
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

function generateAutoTelemetryPayload(device) {
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
    location: `Factory ${device.factoryId}`,
    pm2_5: toFixedNumber(pm2_5),
    pm10: toFixedNumber(pm10),
    co: toFixedNumber(co),
    no2: toFixedNumber(no2),
    so2: toFixedNumber(so2),
    co2: toFixedNumber(co2),
    stack_temperature: toFixedNumber(randomBetween(90, 180)),
    emission_rate: toFixedNumber(randomBetween(6, 16)),
    timestamp: new Date().toISOString(),
  };
}

function stopAutoTelemetry(deviceId) {
  const timer = autoTelemetryTimers.get(deviceId);
  if (!timer) return;
  clearInterval(timer);
  autoTelemetryTimers.delete(deviceId);
}

function getRegisteredDevice(deviceId) {
  const devices = readJsonArray(devicesDbPath);
  return devices.find((item) => item.deviceId === deviceId) || null;
}

function isDemoDevice(device) {
  return normalizeDeviceType(device?.deviceType) === "demo_device";
}

async function pushAutoTelemetryForDevice(deviceId) {
  const device = getRegisteredDevice(deviceId);
  if (!device || !isDemoDevice(device)) {
    stopAutoTelemetry(deviceId);
    return;
  }

  const payload = generateAutoTelemetryPayload(device);
  try {
    await storeTelemetry(payload, {
      blockchainFromOverride: device.walletAddress || null,
      contract,
      source: "AUTO_TELEMETRY",
    });
  } catch (err) {
    console.error(`AUTO TELEMETRY ERROR [${device.deviceId}]:`, err.message);
  }
}

function startAutoTelemetry(device) {
  if (!device) return;

  const deviceId = String(device.deviceId || "").trim();
  if (!deviceId) return;

  stopAutoTelemetry(deviceId);
  if (!autoTelemetryEnabled || !isDemoDevice(device)) return;

  pushAutoTelemetryForDevice(deviceId);

  const timer = setInterval(() => {
    pushAutoTelemetryForDevice(deviceId);
  }, autoTelemetryIntervalMs);

  autoTelemetryTimers.set(deviceId, timer);
}

function bootstrapAutoTelemetry() {
  if (!autoTelemetryEnabled) return;
  const devices = readJsonArray(devicesDbPath);
  devices.forEach((device) => startAutoTelemetry(device));
  const demoCount = devices.filter((device) => isDemoDevice(device)).length;
  const iotCount = devices.length - demoCount;
  console.log(
    `Auto telemetry enabled for demo devices only (${demoCount} demo, ${iotCount} iot module).`
  );
}

function sanitizeFilePart(value) {
  return String(value || "device")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_");
}

function escapePdfText(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ");
}

function wrapText(text, maxChars = 95) {
  const normalized = String(text || "").trim();
  if (!normalized) return [""];
  const words = normalized.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines;
}

function buildSimplePdf(lines) {
  const maxLinesPerPage = 45;
  const pages = [];

  for (let i = 0; i < lines.length; i += maxLinesPerPage) {
    pages.push(lines.slice(i, i + maxLinesPerPage));
  }

  if (pages.length === 0) {
    pages.push(["No archive content available."]);
  }

  const objects = {};
  const pageObjectIds = [];
  const contentObjectIds = [];
  let nextId = 3;

  for (let i = 0; i < pages.length; i++) {
    pageObjectIds.push(nextId++);
    contentObjectIds.push(nextId++);
  }
  const fontObjectId = nextId++;
  const lastObjectId = fontObjectId;

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] /Count ${pageObjectIds.length} >>`;

  for (let i = 0; i < pages.length; i++) {
    const pageId = pageObjectIds[i];
    const contentId = contentObjectIds[i];
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentId} 0 R >>`;

    const ops = ["BT", "/F1 10 Tf", "50 760 Td"];
    for (const line of pages[i]) {
      ops.push(`(${escapePdfText(line)}) Tj`);
      ops.push("0 -14 Td");
    }
    ops.push("ET");

    const stream = ops.join("\n");
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`;
  }

  objects[fontObjectId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let output = "%PDF-1.4\n";
  const offsets = [0];

  for (let id = 1; id <= lastObjectId; id++) {
    offsets[id] = Buffer.byteLength(output, "utf8");
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(output, "utf8");
  output += `xref\n0 ${lastObjectId + 1}\n`;
  output += "0000000000 65535 f \n";
  for (let id = 1; id <= lastObjectId; id++) {
    output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${lastObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(output, "utf8");
}

function getRelatedDeviceRecords(device, allRecords) {
  const exact = allRecords.filter((item) => {
    const explicitDeviceId = String(item.deviceId || "").trim();
    const payloadDeviceId = String(item.data?.deviceId || "").trim();
    return explicitDeviceId === device.deviceId || payloadDeviceId === device.deviceId;
  });

  if (exact.length > 0) {
    return { records: exact, relation: "device_id" };
  }

  const fallback = allRecords.filter(
    (item) => String(item.factoryId || "").trim() === String(device.factoryId || "").trim()
  );

  return { records: fallback, relation: fallback.length > 0 ? "factory_fallback" : "none" };
}

function createDeviceArchivePdf(device, relatedRecords, relation) {
  ensureArchiveStorage();

  const removedAt = new Date().toISOString();
  const sortedRecords = relatedRecords
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const lines = [];
  lines.push("Industrial Emission Monitoring System - Device Archive");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Removed Device ID: ${device.deviceId}`);
  lines.push(`Factory ID: ${device.factoryId}`);
  lines.push(`Device Type: ${normalizeDeviceType(device.deviceType)}`);
  lines.push(`Created At: ${device.createdAt || "unknown"}`);
  lines.push(`Removed At: ${removedAt}`);
  lines.push(`Record Match Strategy: ${relation}`);
  lines.push(`Matched Telemetry Records: ${sortedRecords.length}`);
  lines.push("");
  lines.push("Telemetry Snapshot:");

  const maxRecordsInPdf = 50;
  const displayed = sortedRecords.slice(0, maxRecordsInPdf);
  displayed.forEach((row, index) => {
    const stamp = row.timestamp ? new Date(row.timestamp).toISOString() : "unknown_time";
    const summary =
      `#${index + 1} ${stamp} | status=${row.status || "unknown"} | ` +
      `onChain=${row.onChain ? "yes" : "no"} | total=${row.totalFine ?? 0}`;
    lines.push(...wrapText(summary));

    const metrics =
      `pm2_5=${row.data?.pm2_5 ?? "--"} pm10=${row.data?.pm10 ?? "--"} ` +
      `co2=${row.data?.co2 ?? "--"} emission_rate=${row.data?.emission_rate ?? "--"}`;
    lines.push(...wrapText(metrics));

    if (row.cid) {
      lines.push(...wrapText(`cid=${row.cid}`));
    }
    lines.push("");
  });

  if (sortedRecords.length > maxRecordsInPdf) {
    lines.push(`... truncated ${sortedRecords.length - maxRecordsInPdf} additional record(s).`);
  }

  const pdfBuffer = buildSimplePdf(lines);
  const fileName = `${sanitizeFilePart(device.deviceId)}_${Date.now()}.pdf`;
  const absolutePath = path.resolve(deviceArchivesDirPath, fileName);
  fs.writeFileSync(absolutePath, pdfBuffer);

  const archiveEntry = {
    archiveId: `ARCHIVE_${Date.now()}_${sanitizeFilePart(device.deviceId)}`,
    fileName,
    deviceId: device.deviceId,
    factoryId: device.factoryId,
    removedAt,
    relation,
    recordsIncluded: sortedRecords.length,
    createdAt: new Date().toISOString(),
    downloadPath: `/api/devices/archives/${encodeURIComponent(fileName)}`,
  };

  const index = readJsonArray(deviceArchivesIndexPath);
  index.push(archiveEntry);
  writeJsonArray(deviceArchivesIndexPath, index);

  return archiveEntry;
}

function requireAdmin(req, res, next) {
  const key = req.header("x-admin-key");
  if (!key || key !== adminApiKey) {
    return res.status(401).json({
      error: "Unauthorized admin request.",
    });
  }

  return next();
}

// ---------------- Pollution Evaluation ----------------
function toNonNegativeInt(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < 0) return fallback;
  return Math.floor(numeric);
}

function evaluatePollution(data) {
  let violations = [];
  let totalFine = 0;

  for (const key in LIMITS) {
    const value = parseFloat(data[key]);
    if (Number.isNaN(value)) continue;

    if (value > LIMITS[key]) {
      const excess = value - LIMITS[key];

      violations.push({
        parameter: key,
        value,
        limit: LIMITS[key],
        normalRange: NORMAL_RANGE[key],
        excess: Number(excess.toFixed(2)),
        ratePerUnit: null,
        fine: null,
      });
    }
  }

  if (violations.length === 0) {
    return {
      violations,
      totalFine: 0,
      legalPenaltyRange: null,
      penaltyModel: {
        mode: penaltyMode,
        jurisdiction: LEGAL_PENALTY_PROFILE.jurisdiction,
        currency: LEGAL_PENALTY_PROFILE.currency,
        effectiveFrom: LEGAL_PENALTY_PROFILE.effectiveFrom,
        references: LEGAL_PENALTY_PROFILE.references,
      },
    };
  }

  // Optional legacy demo mode
  if (penaltyMode === "DEMO_LINEAR") {
    const enriched = violations.map((entry) => {
      const rate = DEMO_FINE_RULES[entry.parameter] || 0;
      const fine = Number((entry.excess * rate).toFixed(2));
      totalFine += fine;
      return {
        ...entry,
        ratePerUnit: rate,
        fine,
      };
    });

    return {
      violations: enriched,
      totalFine: Number(totalFine.toFixed(2)),
      legalPenaltyRange: null,
      penaltyModel: {
        mode: "DEMO_LINEAR",
        jurisdiction: LEGAL_PENALTY_PROFILE.jurisdiction,
        currency: LEGAL_PENALTY_PROFILE.currency,
        effectiveFrom: null,
        references: [],
      },
    };
  }

  // Legal mode (India Air Act Section 37 based range).
  const continuingDays = toNonNegativeInt(data.continuingDays, 0);
  const minimum =
    LEGAL_PENALTY_PROFILE.basePenaltyMin +
    (LEGAL_PENALTY_PROFILE.additionalPerDay * continuingDays);
  const maximum =
    LEGAL_PENALTY_PROFILE.basePenaltyMax +
    (LEGAL_PENALTY_PROFILE.additionalPerDay * continuingDays);

  // Kept for API backward-compatibility with existing UI fields.
  totalFine = minimum;

  return {
    violations,
    totalFine,
    legalPenaltyRange: {
      minimum,
      maximum,
      currency: LEGAL_PENALTY_PROFILE.currency,
      continuingDays,
      additionalPerDay: LEGAL_PENALTY_PROFILE.additionalPerDay,
      basis: "Per contravention event under legal profile.",
    },
    penaltyModel: {
      mode: "LEGAL_IN_AIR_ACT",
      id: LEGAL_PENALTY_PROFILE.id,
      jurisdiction: LEGAL_PENALTY_PROFILE.jurisdiction,
      currency: LEGAL_PENALTY_PROFILE.currency,
      effectiveFrom: LEGAL_PENALTY_PROFILE.effectiveFrom,
      references: LEGAL_PENALTY_PROFILE.references,
    },
  };
}

async function storeTelemetry(data, options = {}) {
  const { violations, totalFine, legalPenaltyRange, penaltyModel } = evaluatePollution(data);
  const isViolation = violations.length > 0;
  const forceOnChain = Boolean(options.forceOnChain);
  const shouldAnchorOnChain = isViolation || forceOnChain;
  const deviceId = String(data.deviceId || "").trim() || null;
  const blockchainFromOverride = options.blockchainFromOverride || null;
  const targetContract = options.contract || contract;
  const source = String(options.source || "BACKEND").trim() || "BACKEND";
  const targetBlockchainAddress = getContractAddress(targetContract, contractAddress);

  const record = {
    deviceId,
    factoryId: data.factoryId,
    timestamp: data.timestamp || new Date().toISOString(),
    data,
    violations,
    totalFine,
    legalPenaltyRange,
    penaltyModel,
    status: isViolation ? "VIOLATION" : "NORMAL",
    source,
    targetBlockchainAddress,
  };

  let cid = null;
  let onChain = false;
  let onChainContractAddress = null;
  let onChainError = null;

  // Violation records are anchored by default; selected routes can force anchoring.
  if (shouldAnchorOnChain) {
    try {
      cid = await storeToIPFS(record);
    } catch (err) {
      onChainError = `IPFS store failed: ${err.message}`;
    }

    if (cid) {
      const fromAccount = blockchainFromOverride || blockchainAccounts.device || blockchainAccounts.admin;
      if (!fromAccount) {
        onChainError = onChainError || "No blockchain sender account available.";
      } else {
        try {
          await targetContract.methods.storeDataHash(cid).send({
            from: fromAccount,
            gas: 300000,
          });
          onChain = true;
          onChainContractAddress = targetBlockchainAddress;
        } catch (err) {
          onChainError = onChainError || err.message;
        }
      }
    }
  }

  const db = readJsonArray(violationsDbPath);
  db.push({ ...record, cid, onChain, onChainContractAddress, onChainError });
  writeJsonArray(violationsDbPath, db);

  if (isViolation) {
    const penaltyText = legalPenaltyRange
      ? `Penalty range Rs ${legalPenaltyRange.minimum} - Rs ${legalPenaltyRange.maximum}`
      : `Fine Rs ${totalFine}`;
    const note = {
      id: Date.now(),
      factoryId: data.factoryId,
      message: `Pollution limit exceeded. ${penaltyText}`,
      fine: totalFine,
      legalPenaltyRange,
      time: new Date().toISOString(),
      cid,
    };

    notifications.push(note);

    console.log("\nPOLLUTION ALERT");
    console.table(violations);
    if (legalPenaltyRange) {
      console.log(
        `Penalty range Rs: ${legalPenaltyRange.minimum} - ${legalPenaltyRange.maximum}`
      );
    } else {
      console.log("Fine Rs:", totalFine);
    }
    console.log("CID:", cid);
    if (onChainError) {
      console.log("On-chain fallback:", onChainError);
    }
    console.log("--------------------------------");
  }

  return {
    record,
    cid,
    totalFine,
    violations,
    onChain,
    onChainContractAddress,
    onChainError,
    targetBlockchainAddress,
    legalPenaltyRange,
    penaltyModel,
    source,
  };
}

// ---------------- Device Registration ----------------
app.post("/api/devices/register", requireAdmin, async (req, res) => {
  try {
    const deviceId = String(req.body.deviceId || "").trim();
    const factoryId = String(req.body.factoryId || "").trim();
    const walletAddress = String(req.body.walletAddress || "").trim();
    const deviceType = normalizeDeviceType(req.body.deviceType);

    if (!deviceId || !factoryId) {
      return res.status(400).json({
        error: "deviceId and factoryId are required.",
      });
    }

    if (!allowedDeviceTypes.has(deviceType)) {
      return res.status(400).json({
        error: "deviceType must be either demo_device or iot_module.",
      });
    }

    if (walletAddress && !web3.utils.isAddress(walletAddress)) {
      return res.status(400).json({
        error: "walletAddress is not a valid EVM address.",
      });
    }

    const devices = readJsonArray(devicesDbPath);
    const exists = devices.some((item) => item.deviceId === deviceId);
    if (exists) {
      return res.status(409).json({
        error: "deviceId already exists.",
      });
    }

    let registeredOnChain = false;
    if (walletAddress) {
      const admin = blockchainAccounts.admin || (await web3.eth.getAccounts())[0];
      if (!admin) {
        return res.status(503).json({
          error: "No blockchain admin account available for device registration.",
        });
      }

      try {
        await contract.methods.registerDevice(walletAddress).send({
          from: admin,
          gas: 300000,
        });
        registeredOnChain = true;
      } catch (err) {
        return res.status(502).json({
          error: "Failed to register device wallet on blockchain.",
          details: err.message,
        });
      }
    }

    const apiKey = crypto.randomBytes(24).toString("hex");
    const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
    const createdAt = new Date().toISOString();

    const entry = {
      deviceId,
      factoryId,
      deviceType,
      walletAddress,
      apiKeyHash,
      createdAt,
    };

    devices.push(entry);
    writeJsonArray(devicesDbPath, devices);
    startAutoTelemetry(entry);

    return res.status(201).json({
      deviceId,
      factoryId,
      deviceType,
      walletAddress,
      createdAt,
      apiKey,
      registeredOnChain,
      registerError: null,
    });
  } catch (err) {
    console.error("DEVICE REGISTER ERROR:", err);
    return res.status(500).json({ error: err.toString() });
  }
});

app.get("/api/devices/registered", requireAdmin, (req, res) => {
  const devices = readJsonArray(devicesDbPath).map((item) => toDeviceResponse(item));

  return res.json(devices);
});

app.put("/api/devices/:deviceId", requireAdmin, (req, res) => {
  const deviceId = String(req.params.deviceId || "").trim();
  if (!deviceId) {
    return res.status(400).json({ error: "deviceId is required in the route." });
  }

  const devices = readJsonArray(devicesDbPath);
  const index = devices.findIndex((item) => item.deviceId === deviceId);
  if (index < 0) {
    return res.status(404).json({ error: "Device not found." });
  }

  const current = devices[index];

  const nextFactoryId =
    req.body.factoryId === undefined ? String(current.factoryId || "").trim() : String(req.body.factoryId || "").trim();
  if (!nextFactoryId) {
    return res.status(400).json({ error: "factoryId cannot be empty." });
  }

  const nextDeviceType =
    req.body.deviceType === undefined ? normalizeDeviceType(current.deviceType) : normalizeDeviceType(req.body.deviceType);
  if (!allowedDeviceTypes.has(nextDeviceType)) {
    return res.status(400).json({ error: "deviceType must be either demo_device or iot_module." });
  }

  const nextWalletAddress =
    req.body.walletAddress === undefined
      ? String(current.walletAddress || "").trim()
      : String(req.body.walletAddress || "").trim();
  if (nextWalletAddress && !web3.utils.isAddress(nextWalletAddress)) {
    return res.status(400).json({ error: "walletAddress is not a valid EVM address." });
  }

  const updated = {
    ...current,
    factoryId: nextFactoryId,
    deviceType: nextDeviceType,
    walletAddress: nextWalletAddress,
  };

  devices[index] = updated;
  writeJsonArray(devicesDbPath, devices);
  startAutoTelemetry(updated);

  return res.json(toDeviceResponse(updated));
});

app.delete("/api/devices/:deviceId", requireAdmin, (req, res) => {
  const deviceId = String(req.params.deviceId || "").trim();
  if (!deviceId) {
    return res.status(400).json({ error: "deviceId is required in the route." });
  }

  const devices = readJsonArray(devicesDbPath);
  const index = devices.findIndex((item) => item.deviceId === deviceId);
  if (index < 0) {
    return res.status(404).json({ error: "Device not found." });
  }

  const removedDevice = devices[index];
  stopAutoTelemetry(removedDevice.deviceId);
  devices.splice(index, 1);
  writeJsonArray(devicesDbPath, devices);
  let archive = null;
  let archiveError = null;

  try {
    const allRecords = readJsonArray(violationsDbPath);
    const { records: relatedRecords, relation } = getRelatedDeviceRecords(
      removedDevice,
      allRecords
    );
    archive = createDeviceArchivePdf(removedDevice, relatedRecords, relation);
  } catch (err) {
    archiveError = err.message;
    console.error(`ARCHIVE CREATE ERROR [${deviceId}]:`, err.message);
  }

  return res.json({ deletedDeviceId: deviceId, archive, archiveError });
});

app.get("/api/devices/archives", requireAdmin, (req, res) => {
  ensureArchiveStorage();
  const archives = readJsonArray(deviceArchivesIndexPath)
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return res.json(archives);
});

app.get("/api/devices/archives/:fileName", requireAdmin, (req, res) => {
  ensureArchiveStorage();
  const fileName = path.basename(String(req.params.fileName || "").trim());
  if (!fileName || !fileName.toLowerCase().endsWith(".pdf")) {
    return res.status(400).json({ error: "Invalid archive file name." });
  }

  const absolutePath = path.resolve(deviceArchivesDirPath, fileName);
  if (!absolutePath.startsWith(deviceArchivesDirPath)) {
    return res.status(400).json({ error: "Invalid archive path." });
  }

  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ error: "Archive not found." });
  }

  return res.download(absolutePath, fileName);
});

// ---------------- Store IoT Data (existing route) ----------------
app.post("/store", async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.factoryId) {
      return res.status(400).json({ error: "factoryId is required." });
    }

    const {
      record,
      cid,
      totalFine,
      violations,
      onChain,
      onChainContractAddress,
      onChainError,
      targetBlockchainAddress,
      legalPenaltyRange,
      penaltyModel,
      source,
    } = await storeTelemetry(data, {
      contract,
      source: "OPEN_STORE",
    });
    return res.json({
      status: record.status,
      cid,
      totalFine,
      violations,
      onChain,
      onChainContractAddress,
      onChainError,
      targetBlockchainAddress,
      legalPenaltyRange,
      penaltyModel,
      source,
    });
  } catch (err) {
    console.error("STORE ERROR:", err);
    return res.status(500).json({ error: err.toString() });
  }
});

// ---------------- Store IoT Data (real device route with auth) ----------------
app.post("/api/device/store", deviceAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const factoryId = body.factoryId || req.device.factoryId;
    const payloadDeviceId = String(body.deviceId || "").trim();

    if (!factoryId) {
      return res.status(400).json({ error: "factoryId is required." });
    }

    if (req.device.factoryId && factoryId !== req.device.factoryId) {
      return res.status(403).json({ error: "factoryId does not match registered device." });
    }

    if (payloadDeviceId && payloadDeviceId !== req.device.deviceId) {
      return res.status(403).json({ error: "deviceId does not match registered device." });
    }

    const payload = {
      ...body,
      deviceId: req.device.deviceId,
      factoryId,
      timestamp: body.timestamp || new Date().toISOString(),
    };

    const {
      record,
      cid,
      totalFine,
      violations,
      onChain,
      onChainContractAddress,
      onChainError,
      targetBlockchainAddress,
      legalPenaltyRange,
      penaltyModel,
      source,
    } = await storeTelemetry(payload, {
      blockchainFromOverride: req.device.walletAddress || null,
      contract,
      source: "DEVICE_API",
    });

    return res.json({
      status: record.status,
      cid,
      totalFine,
      violations,
      onChain,
      onChainContractAddress,
      onChainError,
      targetBlockchainAddress,
      legalPenaltyRange,
      penaltyModel,
      deviceId: req.device.deviceId,
      source,
    });
  } catch (err) {
    console.error("DEVICE STORE ERROR:", err);
    return res.status(500).json({ error: err.toString() });
  }
});

// ---------------- Store Real Arduino Data (dedicated contract route with auth) ----------------
app.post("/api/arduino/store", deviceAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const factoryId = body.factoryId || req.device.factoryId;
    const payloadDeviceId = String(body.deviceId || "").trim();

    if (!factoryId) {
      return res.status(400).json({ error: "factoryId is required." });
    }

    if (req.device.factoryId && factoryId !== req.device.factoryId) {
      return res.status(403).json({ error: "factoryId does not match registered device." });
    }

    if (payloadDeviceId && payloadDeviceId !== req.device.deviceId) {
      return res.status(403).json({ error: "deviceId does not match registered device." });
    }

    const payload = {
      ...body,
      deviceId: req.device.deviceId,
      factoryId,
      timestamp: body.timestamp || new Date().toISOString(),
    };

    const {
      record,
      cid,
      totalFine,
      violations,
      onChain,
      onChainContractAddress,
      onChainError,
      targetBlockchainAddress,
      legalPenaltyRange,
      penaltyModel,
      source,
    } = await storeTelemetry(payload, {
      contract: arduinoContract,
      source: "REAL_ARDUINO",
      forceOnChain: true,
    });

    return res.json({
      status: record.status,
      cid,
      totalFine,
      violations,
      onChain,
      onChainContractAddress,
      onChainError,
      targetBlockchainAddress,
      legalPenaltyRange,
      penaltyModel,
      deviceId: req.device.deviceId,
      source,
    });
  } catch (err) {
    console.error("ARDUINO STORE ERROR:", err);
    return res.status(500).json({ error: err.toString() });
  }
});

app.get("/api/arduino/records", (req, res) => {
  const deviceId = String(req.query.deviceId || "").trim();
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(1000, Math.max(1, Math.floor(limitRaw)))
    : 300;

  const data = readJsonArray(violationsDbPath);
  const rows = data
    .filter((item) => {
      const source = String(item.source || "").trim().toUpperCase();
      if (source !== "REAL_ARDUINO") return false;
      if (!deviceId) return true;
      const rowDeviceId = String(item.deviceId || item.data?.deviceId || "").trim();
      return rowDeviceId === deviceId;
    })
    .slice()
    .reverse()
    .slice(0, limit);

  return res.json(rows);
});

app.get("/api/blockchain/targets", requireAdmin, (req, res) => {
  return res.json({
    defaultContractAddress: contractAddress,
    arduinoContractAddress,
    blockchainRpc: process.env.BLOCKCHAIN_RPC || "http://127.0.0.1:7545",
  });
});

// ---------------- Get Violations ----------------
app.get("/violations", (req, res) => {
  const data = readJsonArray(violationsDbPath);
  return res.json(data.slice().reverse());
});

// ---------------- Get Notifications ----------------
app.get("/api/notifications", (req, res) => {
  return res.json(notifications.slice().reverse());
});

// ---------------- Existing API for unique factories ----------------
app.get("/api/devices", (req, res) => {
  const data = readJsonArray(violationsDbPath);
  const devicesMap = {};

  data.forEach((row) => {
    if (!devicesMap[row.factoryId]) {
      devicesMap[row.factoryId] = {
        factoryId: row.factoryId,
        lastSeen: row.timestamp,
        status: row.status,
      };
    }
  });

  return res.json(Object.values(devicesMap));
});

// ---------------- Health Check ----------------
app.get("/", (req, res) => {
  res.send("IoT Blockchain Backend Running");
});

// ---------------- Start Server ----------------
app.listen(backendPort, () => {
  console.log(`Backend running on port ${backendPort}`);
  console.log("Admin API key header: x-admin-key");
  ensureArchiveStorage();
  bootstrapAutoTelemetry();
});
