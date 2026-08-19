// Zentrale Plan-Zugehörigkeit der Häuser (Bedingung auf h.name).
// Einmal definiert, damit plan.js, cleaningAlert.js und houses.js exakt
// gleich filtern.
//
//  mainstreet = Chalet White Pearl + Chalet Cecilia
//  sonja      = MYALPS Ötztal + (Jordans) Lodge
//  oetztal    = nur MYALPS Ötztal (Reinigungs-Team Ötztal)
//  helga      = MYALPS Tirol (zuerst) + Historical + Mühlhof + Pure
//  wiwa       = alle anderen Häuser (Lodge/Historical/Mühlhof/Pure bleiben
//               dabei!), aber OHNE Ötztal und OHNE Tirol
//
// '%tztal%' matcht "Ötztal"/"Otztal"/"Oetztal", '%hlhof%' matcht
// "Mühlhof"/"Muehlhof"/"Muhlhof" – umgeht Umlaut-Stolperfallen.

const IS_WP     = `LOWER(h.name) LIKE '%white pearl%'`;
const IS_CEC    = `LOWER(h.name) LIKE '%cecilia%'`;
const IS_OTZ    = `LOWER(h.name) LIKE '%tztal%'`;
const IS_LODGE  = `LOWER(h.name) LIKE '%lodge%'`;
const IS_TIROL  = `LOWER(h.name) LIKE '%tirol%'`;
const IS_HIST   = `LOWER(h.name) LIKE '%historical%'`;
const IS_MUEHL  = `LOWER(h.name) LIKE '%hlhof%'`;
const IS_PURE   = `LOWER(h.name) LIKE '%pure%'`;

// Häuser des Plans Helga (Tirol + Historical + Mühlhof + Pure)
const IS_HELGA = `(${IS_TIROL} OR ${IS_HIST} OR ${IS_MUEHL} OR ${IS_PURE})`;

// WHERE-Bedingung (auf h.name) für einen Plan; '' = keine Einschränkung.
function planCondition(plan) {
  if (plan === 'mainstreet') return `(${IS_WP} OR ${IS_CEC})`;
  if (plan === 'sonja')      return `(${IS_OTZ} OR ${IS_LODGE})`;
  if (plan === 'oetztal')    return IS_OTZ;
  if (plan === 'helga')      return IS_HELGA;
  if (plan === 'wiwa')       return `(h.name IS NULL OR NOT (${IS_WP} OR ${IS_CEC} OR ${IS_OTZ} OR ${IS_TIROL}))`;
  return '';
}

// Reihenfolge im Plan Sonja: MYALPS Ötztal zuerst, Lodge danach.
const SONJA_ORDER = `CASE WHEN ${IS_OTZ} THEN 0 WHEN ${IS_LODGE} THEN 1 ELSE 2 END`;

// Reihenfolge im Plan Helga: MYALPS Tirol zuerst, Rest alphabetisch danach.
const HELGA_ORDER = `CASE WHEN ${IS_TIROL} THEN 0 ELSE 1 END`;

module.exports = { planCondition, SONJA_ORDER, HELGA_ORDER };
