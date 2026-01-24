const axios = require("axios");

function generatePollutionData() {
  return {
    factoryId: "FACTORY_001",
    location: "Industrial Zone A",

    pm2_5: (50 + Math.random() * 150).toFixed(2),     // µg/m3
    pm10: (80 + Math.random() * 200).toFixed(2),     // µg/m3
    co: (0.5 + Math.random() * 4).toFixed(2),        // ppm
    no2: (20 + Math.random() * 80).toFixed(2),       // ppb
    so2: (10 + Math.random() * 60).toFixed(2),       // ppb
    co2: (400 + Math.random() * 600).toFixed(2),     // ppm

    stack_temperature: (90 + Math.random() * 60).toFixed(2), // °C
    emission_rate: (5 + Math.random() * 20).toFixed(2),     // g/s

    timestamp: new Date().toISOString()
  };
}

async function sendData() {
  const data = generatePollutionData();

  try {
    const res = await axios.post("http://localhost:5000/store", data);
    console.log("Pollution Data Sent:");
    console.table(data);
    console.log("IPFS CID:", res.data.cid);
    console.log("--------------------------------------------------");
  } catch (err) {
    console.error("Send failed:", err.message);
  }
}

setInterval(sendData, 5000);
