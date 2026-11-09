// Curated set of popular Direct Plan - Growth schemes, spread across categories
// and fund houses. Scheme codes are MFAPI.in codes: https://api.mfapi.in/mf/{code}
export const CATEGORY_COLORS = {
  Index: "#4c78a8",
  "Large Cap": "#f58518",
  "Flexi Cap": "#54a24b",
  "Multi Cap": "#9d755d",
  Value: "#72b7b2",
  "Mid Cap": "#b279a2",
  "Small Cap": "#e45756",
  Sectoral: "#8c6bb1",
  ELSS: "#eeca3b",
};

export const FUND_UNIVERSE = [
  // Index
  { code: 120716, name: "UTI Nifty 50 Index", category: "Index" },
  { code: 119063, name: "HDFC Nifty 50 Index", category: "Index" },
  { code: 120620, name: "ICICI Pru Nifty 50 Index", category: "Index" },
  { code: 118741, name: "Nippon India Nifty 50 Index", category: "Index" },
  { code: 149373, name: "Axis Nifty 50 Index", category: "Index" },
  { code: 120684, name: "ICICI Pru Nifty Next 50 Index", category: "Index" },
  { code: 143341, name: "UTI Nifty Next 50 Index", category: "Index" },
  { code: 148726, name: "Nippon Nifty Midcap 150 Index", category: "Index" },
  { code: 147622, name: "Motilal Nifty Midcap 150 Index", category: "Index" },
  { code: 150677, name: "SBI Nifty Smallcap 250 Index", category: "Index" },
  { code: 149219, name: "ICICI Pru Nasdaq 100 Index", category: "Index" },

  // Large Cap
  { code: 120586, name: "ICICI Pru Large Cap", category: "Large Cap" },
  { code: 118632, name: "Nippon India Large Cap", category: "Large Cap" },
  { code: 118825, name: "Mirae Asset Large Cap", category: "Large Cap" },
  { code: 119018, name: "HDFC Large Cap", category: "Large Cap" },
  { code: 119598, name: "SBI Large Cap", category: "Large Cap" },
  { code: 120152, name: "Kotak Large Cap", category: "Large Cap" },
  { code: 119528, name: "Aditya Birla SL Large Cap", category: "Large Cap" },
  { code: 118531, name: "Franklin India Large Cap", category: "Large Cap" },

  // Flexi Cap
  { code: 122639, name: "Parag Parikh Flexi Cap", category: "Flexi Cap" },
  { code: 118955, name: "HDFC Flexi Cap", category: "Flexi Cap" },
  { code: 120166, name: "Kotak Flexi Cap", category: "Flexi Cap" },
  { code: 119718, name: "SBI Flexi Cap", category: "Flexi Cap" },
  { code: 120662, name: "UTI Flexi Cap", category: "Flexi Cap" },
  { code: 141925, name: "Axis Flexi Cap", category: "Flexi Cap" },
  { code: 120843, name: "Quant Flexi Cap", category: "Flexi Cap" },

  // Multi Cap
  { code: 118650, name: "Nippon India Multi Cap", category: "Multi Cap" },
  { code: 149185, name: "Kotak Multi Cap", category: "Multi Cap" },
  { code: 149882, name: "SBI Multi Cap", category: "Multi Cap" },
  { code: 149368, name: "HDFC Multi Cap", category: "Multi Cap" },

  // Value / Contra
  { code: 119835, name: "SBI Contra", category: "Value" },
  { code: 120323, name: "ICICI Pru Value", category: "Value" },
  { code: 118935, name: "HDFC Value", category: "Value" },
  { code: 119231, name: "Tata Value", category: "Value" },
  { code: 118494, name: "Templeton India Value", category: "Value" },
  { code: 120348, name: "Invesco India Contra", category: "Value" },

  // Mid Cap
  { code: 120505, name: "Axis Midcap", category: "Mid Cap" },
  { code: 118989, name: "HDFC Mid Cap", category: "Mid Cap" },
  { code: 119775, name: "Kotak Mid Cap", category: "Mid Cap" },
  { code: 118668, name: "Nippon India Growth Mid Cap", category: "Mid Cap" },
  { code: 119716, name: "SBI Midcap", category: "Mid Cap" },
  { code: 119071, name: "DSP Midcap", category: "Mid Cap" },
  { code: 151036, name: "HSBC Midcap", category: "Mid Cap" },

  // Small Cap
  { code: 118778, name: "Nippon India Small Cap", category: "Small Cap" },
  { code: 130503, name: "HDFC Small Cap", category: "Small Cap" },
  { code: 120828, name: "Quant Small Cap", category: "Small Cap" },
  { code: 125497, name: "SBI Small Cap", category: "Small Cap" },
  { code: 125354, name: "Axis Small Cap", category: "Small Cap" },
  { code: 120164, name: "Kotak Small Cap", category: "Small Cap" },
  { code: 119212, name: "DSP Small Cap", category: "Small Cap" },
  { code: 147946, name: "Bandhan Small Cap", category: "Small Cap" },

  // Sectoral / Thematic
  { code: 120594, name: "ICICI Pru Technology", category: "Sectoral" },
  { code: 118759, name: "Nippon India Pharma", category: "Sectoral" },
  { code: 133859, name: "SBI Banking & Financial Services", category: "Sectoral" },
  { code: 120244, name: "ICICI Pru Banking & Financial Services", category: "Sectoral" },
  { code: 119700, name: "SBI Infrastructure", category: "Sectoral" },
  { code: 120728, name: "UTI Infrastructure", category: "Sectoral" },

  // ELSS
  { code: 119242, name: "DSP ELSS Tax Saver", category: "ELSS" },
  { code: 119723, name: "SBI ELSS Tax Saver", category: "ELSS" },
  { code: 119773, name: "Kotak ELSS Tax Saver", category: "ELSS" },
  { code: 120847, name: "Quant ELSS Tax Saver", category: "ELSS" },
  { code: 135781, name: "Mirae Asset ELSS Tax Saver", category: "ELSS" },
];

export const getCategoryColor = (category) => CATEGORY_COLORS[category] || "#8e8e8e";
