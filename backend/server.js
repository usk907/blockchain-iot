const express = require("express");
const { Web3 } = require("web3");
const fs = require("fs");
const bodyParser = require("body-parser");
const cors = require("cors");
const { storeToIPFS } = require("./ipfs");
const { LIMITS, FINE_RULES, NORMAL_RANGE } = require("./constants");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ---------------- Blockchain ----------------
const web3 = new Web3("http://127.0.0.1:7545");

const artifact = JSON.parse(fs.readFileSync("./IoTDataABI.json"));
const contractAddress = "0x5c4C0c922c9023cd211c934049043c091F0aC024"; // update if redeployed

const contract = new web3.eth.Contract(artifact.abi, contractAddress);

let deviceAccount;
web3.eth.getAccounts().then(acc => {
  deviceAccount = acc[1];
  console.log("Using device account:", deviceAccount);
});

// ---------------- In-memory Notifications ----------------
let notifications = [];

// ---------------- Pollution Evaluation ----------------
function evaluatePollution(data) {
  let violations = [];
  let totalFine = 0;

  for (let key in LIMITS) {
    const value = parseFloat(data[key]);

    if (value > LIMITS[key]) {
      const excess = value - LIMITS[key];
      const rate = FINE_RULES[key];
      const fine = excess * rate;

      violations.push({
        parameter: key,
        value,
        limit: LIMITS[key],
        normalRange: NORMAL_RANGE[key],
        excess: Number(excess.toFixed(2)),
        ratePerUnit: rate,
        fine: Number(fine.toFixed(2))
      });

      totalFine += fine;
    }
  }

  return { violations, totalFine: Number(totalFine.toFixed(2)) };
}

// ---------------- Store IoT Data ----------------
app.post("/store", async (req, res) => {
  try {
    const data = req.body;

    const { violations, totalFine } = evaluatePollution(data);

    const record = {
      factoryId: data.factoryId,
      timestamp: data.timestamp,
      data,
      violations,
      totalFine,
      status: violations.length > 0 ? "VIOLATION" : "NORMAL"
    };

    const cid = await storeToIPFS(record);

    await contract.methods.storeDataHash(cid).send({
      from: deviceAccount,
      gas: 300000
    });

    // Save violations history
    let db = [];
    if (fs.existsSync("violations.json")) {
      db = JSON.parse(fs.readFileSync("violations.json"));
    }

    db.push({ ...record, cid });
    fs.writeFileSync("violations.json", JSON.stringify(db, null, 2));

    // Create notification
    if (violations.length > 0) {
      const note = {
        id: Date.now(),
        factoryId: data.factoryId,
        message: `Pollution limit exceeded. Fine ₹${totalFine}`,
        fine: totalFine,
        time: new Date().toISOString(),
        cid
      };

      notifications.push(note);

      console.log("\n🚨 POLLUTION ALERT!");
      console.table(violations);
      console.log("💰 Fine: ₹", totalFine);
      console.log("📄 CID:", cid);
      console.log("--------------------------------");
    }

    res.json({ status: record.status, cid, totalFine, violations });

  } catch (err) {
    console.error("STORE ERROR:", err);
    res.status(500).json({ error: err.toString() });
  }
});

// ---------------- Get Violations ----------------
app.get("/violations", (req, res) => {
  if (!fs.existsSync("violations.json")) return res.json([]);
  const data = JSON.parse(fs.readFileSync("violations.json"));
  res.json(data.reverse());
});

// ---------------- Get Notifications ----------------
app.get("/api/notifications", (req, res) => {
  res.json(notifications.slice().reverse());
});

// ---------------- Health Check ----------------
app.get("/", (req, res) => {
  res.send("IoT Blockchain Backend Running");
});

// ---------------- Start Server ----------------
app.listen(5000, () => {
  console.log("Backend running on port 5000");
});
app.get("/api/devices", (req, res) => {
  // Read from violations.json to extract unique devices/factories
  if (!fs.existsSync("violations.json")) return res.json([]);

  const data = JSON.parse(fs.readFileSync("violations.json"));

  const devicesMap = {};

  data.forEach(r => {
    if (!devicesMap[r.factoryId]) {
      devicesMap[r.factoryId] = {
        factoryId: r.factoryId,
        lastSeen: r.timestamp,
        status: r.status
      };
    }
  });

  res.json(Object.values(devicesMap));
});
