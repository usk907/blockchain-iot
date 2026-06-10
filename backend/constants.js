const LIMITS = {
  pm2_5: 60,
  pm10: 100,
  co: 2,
  no2: 40,
  so2: 40,
  co2: 1000,
};

const NORMAL_RANGE = {
  pm2_5: "0 - 60 ug/m3",
  pm10: "0 - 100 ug/m3",
  co: "0 - 2 ppm",
  no2: "0 - 40 ppb",
  so2: "0 - 40 ppb",
  co2: "0 - 1000 ppm",
};

// Retained only for optional demo mode.
const DEMO_FINE_RULES = {
  pm2_5: 50,
  pm10: 40,
  co: 500,
  no2: 30,
  so2: 30,
  co2: 10,
};

// Real-world legal profile (India):
// Air (Prevention and Control of Pollution) Act, 1981 (as amended; effective from 2024-04-01).
// Section 37: penalty range for contravention; additional daily penalty for continuing contravention.
const LEGAL_PENALTY_PROFILE = {
  id: "IN_AIR_ACT_1981_AMD_2023",
  jurisdiction: "India",
  currency: "INR",
  effectiveFrom: process.env.LEGAL_EFFECTIVE_FROM || "AS_NOTIFIED",
  basePenaltyMin: 10000,
  basePenaltyMax: 1500000,
  additionalPerDay: 10000,
  references: [
    {
      act: "Air (Prevention and Control of Pollution) Act, 1981",
      section: "Section 37",
      description: "Penalty for contravention (amended by Jan Vishwas (Amendment of Provisions) Act, 2023).",
      source: "https://www.indiacode.nic.in/bitstream/123456789/2616/1/A1981-14.pdf",
    },
    {
      act: "Environment (Protection) Act, 1986",
      section: "Section 15",
      description: "General penalties and additional daily penalty for continuing contravention.",
      source: "https://www.indiacode.nic.in/bitstream/123456789/4316/1/a1986-29.pdf",
    },
  ],
};

module.exports = {
  LIMITS,
  NORMAL_RANGE,
  DEMO_FINE_RULES,
  LEGAL_PENALTY_PROFILE,
};
