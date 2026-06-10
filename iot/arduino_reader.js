const axios = require("axios");
const { SerialPort } = require("serialport");

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((item) => item.startsWith(prefix));
  if (!match) return fallback;
  return match.slice(prefix.length);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round2(value) {
  return Number(Number(value).toFixed(2));
}

function mapGasToTelemetry(gasRaw, temperature, humidity) {
  const gas = clamp(toNumber(gasRaw, 0), 0, 1023);
  const ratio = gas / 1023;

  return {
    pm2_5: round2(20 + ratio * 120),
    pm10: round2(40 + ratio * 160),
    co: round2(0.3 + ratio * 3.2),
    no2: round2(8 + ratio * 70),
    so2: round2(6 + ratio * 60),
    co2: round2(420 + ratio * 1380),
    stack_temperature: round2(toNumber(temperature, 30)),
    emission_rate: round2(6 + ratio * 12),
    temperature: round2(toNumber(temperature, 30)),
    humidity: round2(toNumber(humidity, 50)),
    gas: round2(gas),
  };
}

function parseIncomingLine(line) {
  const text = String(line || "").trim();
  if (!text) return null;

  // Exact labeled format from Arduino Serial:
  // "Temperature: 25.20 Humidity: 47.00 Gas: 212"
  const labeled = text.match(
    /temperature\s*:\s*([-+]?[0-9]*\.?[0-9]+)\s*[,\s;|]+humidity\s*:\s*([-+]?[0-9]*\.?[0-9]+)\s*[,\s;|]+gas\s*:\s*([-+]?[0-9]*\.?[0-9]+)/i
  );
  if (labeled) {
    const temperature = toNumber(labeled[1], NaN);
    const humidity = toNumber(labeled[2], NaN);
    const gas = toNumber(labeled[3], NaN);
    if (Number.isFinite(temperature) && Number.isFinite(humidity) && Number.isFinite(gas)) {
      return { kind: "sensor", temperature, humidity, gas };
    }
  }

  // Joystick labeled format:
  // "X: 512 Y: 431 SW: 1"
  const joystickLabeled = text.match(
    /x\s*:\s*([-+]?[0-9]*\.?[0-9]+)\s*[,\s;|]+y\s*:\s*([-+]?[0-9]*\.?[0-9]+)(?:\s*[,\s;|]+(?:sw|switch|button)\s*:\s*([-+]?[0-9]*\.?[0-9]+))?/i
  );
  if (joystickLabeled) {
    const joystickX = toNumber(joystickLabeled[1], NaN);
    const joystickY = toNumber(joystickLabeled[2], NaN);
    const joystickButton = toNumber(joystickLabeled[3], 0);

    if (Number.isFinite(joystickX) && Number.isFinite(joystickY)) {
      return {
        kind: "joystick",
        joystick_x: round2(joystickX),
        joystick_y: round2(joystickY),
        joystick_button: round2(joystickButton),
      };
    }
  }

  // First try JSON payloads.
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const temperature = toNumber(parsed.temperature, NaN);
      const humidity = toNumber(parsed.humidity, NaN);
      const gas = toNumber(parsed.gas ?? parsed.mq ?? parsed.air ?? parsed.gas_raw, NaN);

      if (Number.isFinite(temperature) && Number.isFinite(humidity) && Number.isFinite(gas)) {
        return { kind: "sensor", temperature, humidity, gas };
      }

      const joystickX = toNumber(parsed.joystick_x ?? parsed.x ?? parsed.joy_x, NaN);
      const joystickY = toNumber(parsed.joystick_y ?? parsed.y ?? parsed.joy_y, NaN);
      const joystickButton = toNumber(
        parsed.joystick_button ?? parsed.button ?? parsed.sw ?? parsed.switch,
        0
      );
      if (Number.isFinite(joystickX) && Number.isFinite(joystickY)) {
        return {
          kind: "joystick",
          joystick_x: round2(joystickX),
          joystick_y: round2(joystickY),
          joystick_button: round2(joystickButton),
        };
      }
    }
  } catch (err) {
    // Continue with numeric extraction.
  }

  // Fallback format: any line containing numbers.
  const values = text.match(/[-+]?[0-9]*\.?[0-9]+/g);
  if (!values || values.length < 2) return null;

  if (values.length >= 3) {
    return {
      kind: "sensor",
      temperature: toNumber(values[0], NaN),
      humidity: toNumber(values[1], NaN),
      gas: toNumber(values[2], NaN),
    };
  }

  return {
    kind: "joystick",
    joystick_x: toNumber(values[0], NaN),
    joystick_y: toNumber(values[1], NaN),
    joystick_button: 0,
  };
}

async function listPortsAndExit() {
  const ports = await SerialPort.list();
  if (!ports.length) {
    console.log("No serial ports found.");
    return;
  }

  console.log("Available serial ports:");
  for (const item of ports) {
    console.log(
      `- ${item.path}` +
        (item.manufacturer ? ` | ${item.manufacturer}` : "") +
        (item.friendlyName ? ` | ${item.friendlyName}` : "")
    );
  }
}

async function main() {
  const listOnly = process.argv.includes("--list-ports");
  if (listOnly) {
    await listPortsAndExit();
    return;
  }

  const portPath =
    getArg("port", process.env.ARDUINO_PORT || "") ||
    getArg("com", process.env.ARDUINO_PORT || "") ||
    "COM3";
  const baudRate = Number(getArg("baud", process.env.ARDUINO_BAUD || 9600)) || 9600;

  const backendBaseUrl = String(
    getArg("backend-url", process.env.BACKEND_URL || "http://127.0.0.1:5000")
  ).trim();
  const endpointPath = String(
    getArg("path", process.env.BACKEND_PATH || "/api/arduino/store")
  ).trim();
  const endpointUrl = `${backendBaseUrl.replace(/\/+$/, "")}/${endpointPath.replace(/^\/+/, "")}`;

  const deviceId = String(
    getArg("device-id", process.env.DEVICE_ID || "ARDUINO_NANO_001")
  ).trim();
  const deviceKey = String(getArg("device-key", process.env.DEVICE_KEY || "")).trim();
  const factoryId = String(
    getArg("factory-id", process.env.FACTORY_ID || "FACTORY_001")
  ).trim();
  const location = String(
    getArg("location", process.env.LOCATION || "Arduino Station")
  ).trim();

  if (!factoryId) {
    throw new Error("factoryId is required. Pass --factory-id or FACTORY_ID env.");
  }

  const authRequiredPaths = new Set(["/api/device/store", "/api/arduino/store"]);
  if (authRequiredPaths.has(endpointPath) && (!deviceId || !deviceKey)) {
    throw new Error(
      "For secure device routes you must provide --device-id and --device-key from device registration."
    );
  }

  console.log(`Serial bridge starting on ${portPath} @ ${baudRate} baud`);
  console.log(`Backend endpoint: ${endpointUrl}`);
  console.log(`Device ID: ${deviceId || "(not set)"}`);
  console.log(`Factory ID: ${factoryId}`);

  const port = new SerialPort({
    path: portPath,
    baudRate,
    autoOpen: true,
  });

  let buffer = "";

  const sendTelemetry = async (line) => {
    const parsed = parseIncomingLine(line);
    if (!parsed) {
      return;
    }

    const basePayload = {
      deviceId,
      factoryId,
      location,
      timestamp: new Date().toISOString(),
    };

    const payload =
      parsed.kind === "sensor"
        ? {
            ...basePayload,
            ...mapGasToTelemetry(parsed.gas, parsed.temperature, parsed.humidity),
          }
        : {
            ...basePayload,
            joystick_x: parsed.joystick_x,
            joystick_y: parsed.joystick_y,
            joystick_button: parsed.joystick_button,
          };

    const headers = {
      "Content-Type": "application/json",
    };

    if (deviceId) headers["x-device-id"] = deviceId;
    if (deviceKey) headers["x-device-key"] = deviceKey;

    try {
      const response = await axios.post(endpointUrl, payload, { headers, timeout: 10000 });
      console.log(
        `Sent | status=${response.data?.status || "ok"} | onChain=${response.data?.onChain ? "yes" : "no"} | cid=${response.data?.cid || "none"}`
      );
    } catch (err) {
      const details = err.response?.data || err.message;
      console.error("Backend post failed:", details);
    }
  };

  port.on("open", () => {
    console.log("Serial port opened.");
  });

  port.on("error", (err) => {
    console.error("Serial port error:", err.message);
  });

  port.on("data", async (chunk) => {
    buffer += chunk.toString("utf8");

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);

      if (line.trim()) {
        console.log(`Serial: ${line}`);
      }

      await sendTelemetry(line);
      newlineIndex = buffer.indexOf("\n");
    }
  });
}

main().catch((err) => {
  console.error("arduino_reader failed:", err.message);
  process.exit(1);
});
