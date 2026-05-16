/**
 * Sample surveillance data for the ZonoticWatch dashboard.
 *
 * In production this would be served by the ingestion pipeline
 * (news/social scrapers → NLP classification → geocoding → aggregation).
 * For the prototype it is seeded with representative figures.
 */

/** County-level risk + case counts. `name` matches GADM NAME_1 exactly. */
export const COUNTIES = [
  { id: "nairobi",  name: "Nairobi",  lat: -1.286, lng: 36.818, risk: 0.80, human: 23, animal: 8,  disease: "Rabies",      wx: { temp: 22, hum: 65, rain: 28 } },
  { id: "mombasa",  name: "Mombasa",  lat: -4.045, lng: 39.658, risk: 0.53, human: 12, animal: 4,  disease: "Q Fever",     wx: { temp: 30, hum: 80, rain: 18 } },
  { id: "kisumu",   name: "Kisumu",   lat: -0.102, lng: 34.762, risk: 0.74, human: 18, animal: 15, disease: "Brucellosis", wx: { temp: 26, hum: 82, rain: 62 } },
  { id: "nakuru",   name: "Nakuru",   lat: -0.303, lng: 36.080, risk: 0.48, human: 9,  animal: 6,  disease: "RVF",         wx: { temp: 20, hum: 70, rain: 35 } },
  { id: "baringo",  name: "Baringo",  lat:  0.600, lng: 35.700, risk: 0.93, human: 14, animal: 22, disease: "RVF",         wx: { temp: 32, hum: 78, rain: 45 } },
  { id: "turkana",  name: "Turkana",  lat:  3.119, lng: 35.597, risk: 0.36, human: 5,  animal: 12, disease: "Anthrax",     wx: { temp: 36, hum: 28, rain: 8 } },
  { id: "garissa",  name: "Garissa",  lat: -0.455, lng: 39.646, risk: 0.65, human: 7,  animal: 18, disease: "RVF",         wx: { temp: 38, hum: 45, rain: 15 } },
  { id: "marsabit", name: "Marsabit", lat:  2.328, lng: 37.998, risk: 0.29, human: 2,  animal: 7,  disease: "Anthrax",     wx: { temp: 25, hum: 40, rain: 12 } },
  { id: "isiolo",   name: "Isiolo",   lat:  0.354, lng: 37.582, risk: 0.46, human: 3,  animal: 9,  disease: "Anthrax",     wx: { temp: 29, hum: 52, rain: 20 } },
  { id: "mandera",  name: "Mandera",  lat:  3.936, lng: 41.862, risk: 0.44, human: 6,  animal: 11, disease: "Brucellosis", wx: { temp: 40, hum: 22, rain: 5 } },
  { id: "wajir",    name: "Wajir",    lat:  1.746, lng: 40.058, risk: 0.51, human: 8,  animal: 14, disease: "RVF",         wx: { temp: 37, hum: 30, rain: 10 } },
  { id: "kakamega", name: "Kakamega", lat:  0.283, lng: 34.752, risk: 0.41, human: 6,  animal: 8,  disease: "Brucellosis", wx: { temp: 24, hum: 78, rain: 55 } },
  { id: "kitui",    name: "Kitui",    lat: -1.366, lng: 38.014, risk: 0.34, human: 4,  animal: 5,  disease: "Q Fever",     wx: { temp: 28, hum: 55, rain: 22 } },
  { id: "machakos", name: "Machakos", lat: -1.520, lng: 37.268, risk: 0.52, human: 10, animal: 3,  disease: "Rabies",      wx: { temp: 25, hum: 62, rain: 30 } },
];

/** Incoming raw signals from the scraper feed. */
export const SIGNALS = [
  { id: 1, src: "X/Twitter", handle: "@KisumulFarmer", text: "Several cows dying suddenly around Lake Victoria shores, vet says suspicious. #Kenya #livestock", loc: "Kisumu",  disease: "Rift Valley Fever", conf: 0.82, time: "2m",  sev: "HIGH" },
  { id: 2, src: "X/Twitter", handle: "@BaringoNews",   text: "Mass livestock death in Baringo. County govt rushed vet teams. Residents afraid of contact with carcasses.", loc: "Baringo",  disease: "RVF / Anthrax",     conf: 0.91, time: "8m",  sev: "CRITICAL" },
  { id: 3, src: "News API",  handle: "Daily Nation",   text: "KVS reports suspected anthrax outbreak in Isiolo pastoralist community — herders told to avoid carcasses.", loc: "Isiolo",   disease: "Anthrax",           conf: 0.88, time: "15m", sev: "HIGH" },
  { id: 4, src: "X/Twitter", handle: "@NairobiHealth", text: "Increasing dog bite cases in Kibera, Mathare settlements. Residents reporting unprovoked attacks this week.", loc: "Nairobi",  disease: "Rabies",            conf: 0.72, time: "22m", sev: "MEDIUM" },
  { id: 5, src: "X/Twitter", handle: "@GarissaCounty", text: "Goat herders in Garissa reporting cluster of spontaneous abortions in their flocks this week. No vet yet.", loc: "Garissa",  disease: "Rift Valley Fever", conf: 0.77, time: "31m", sev: "HIGH" },
  { id: 6, src: "Reddit",    handle: "r/Kenya",        text: "Anyone in Wajir area noticed weird animal deaths? Camels and goats dropping for no obvious reason past 3 days.", loc: "Wajir",    disease: "RVF / Unknown",     conf: 0.55, time: "48m", sev: "MEDIUM" },
  { id: 7, src: "News API",  handle: "KBC News",       text: "Ministry of Health confirms 3 human cases with hemorrhagic fever symptoms in Baringo — investigations ongoing.", loc: "Baringo",  disease: "Rift Valley Fever", conf: 0.95, time: "1h",  sev: "CRITICAL" },
];

/** 15-day case trend. */
export const TREND = [
  { day: "May 1",  human: 8,  animal: 15, rvf: 3 },
  { day: "May 3",  human: 9,  animal: 18, rvf: 4 },
  { day: "May 5",  human: 12, animal: 24, rvf: 7 },
  { day: "May 7",  human: 11, animal: 28, rvf: 9 },
  { day: "May 9",  human: 14, animal: 32, rvf: 11 },
  { day: "May 11", human: 18, animal: 38, rvf: 15 },
  { day: "May 13", human: 24, animal: 45, rvf: 19 },
  { day: "May 15", human: 31, animal: 58, rvf: 26 },
  { day: "May 16", human: 38, animal: 72, rvf: 34 },
];

/**
 * Twitter advanced-search queries used by the Apify Tweet Scraper.
 * Shown as chips in the Data Sources tab and sent verbatim to the actor.
 */
export const SCRAPE_KEYWORDS = [
  '"zoonotic disease" Kenya outbreak',
  '"Rift Valley Fever" OR RVF Kenya',
  'anthrax Kenya livestock deaths',
  'brucellosis Kenya cases',
  'rabies Kenya dog bites',
  '"Crimean-Congo Hemorrhagic Fever" OR CCHF Kenya',
  'mifugo wanakufa Kenya',
  'ugonjwa wa mifugo Kenya',
  '(Garissa OR Wajir OR Turkana OR Marsabit) livestock disease',
  '(flooding OR heavy rains OR El Nino) Kenya disease outbreak'
];

/**
 * Verified Kenyan accounts (news outlets + health/research institutions).
 * The Apify scraper pulls topic-relevant tweets from these via a `from:`
 * query — signals from them are treated as authoritative.
 * Usernames only, no leading "@". Verify against X if results look thin.
 */
export const TWITTER_HANDLES = [
  "ntvkenya",       // NTV Kenya
  "citizentvkenya", // Citizen TV Kenya
  "KTNNewsKE",      // KTN News
  "CapitalFMKenya", // Capital FM Kenya
  "MOH_Kenya",      // Ministry of Health Kenya
  "KEMRI_Kenya",    // Kenya Medical Research Institute
  "ILRI",           // International Livestock Research Institute
  "icipe",          // Intl Centre of Insect Physiology & Ecology
];

/** Disease distribution breakdown (example baseline model priors for Kenya context). */
export const DISEASES = [
  { name: "Rift Valley Fever",               total: 38, pct: 0.38 },
  { name: "Anthrax",                         total: 26, pct: 0.26 },
  { name: "Brucellosis",                     total: 14, pct: 0.14 },
  { name: "Rabies",                          total: 10, pct: 0.10 },
  { name: "Crimean-Congo Hemorrhagic Fever", total: 6,  pct: 0.06 },
  { name: "Leptospirosis",                   total: 4,  pct: 0.04 },
  { name: "Q Fever",                         total: 2,  pct: 0.02 },
];
