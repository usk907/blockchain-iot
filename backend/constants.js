module.exports = {
  LIMITS: {
    pm2_5: 60,
    pm10: 100,
    co: 2,
    no2: 40,
    so2: 40,
    co2: 1000
  },

  NORMAL_RANGE: {
    pm2_5: "0 – 60 µg/m³",
    pm10: "0 – 100 µg/m³",
    co: "0 – 2 ppm",
    no2: "0 – 40 ppb",
    so2: "0 – 40 ppb",
    co2: "0 – 1000 ppm"
  },

  FINE_RULES: {
    pm2_5: 50,   // ₹ per µg/m³ exceeded
    pm10: 40,
    co: 500,
    no2: 30,
    so2: 30,
    co2: 10
  }
};
