// Zentrale Plan-Zugehörigkeit der Häuser (Bedingung auf h.name).
// Einmal definiert, damit plan.js, cleaningAlert.js und houses.js exakt
// gleich filtern.
//
//  mainstreet = Chalet White Pearl + Chalet Cecilia
//  sonja      = MYALPS Ötztal + (Jordans) Lodge
//  oetztal    = nur MYALPS Ötztal (Reinigungs-Team Ötztal)
//  helga      = nur MYALPS Tirol
//  wiwa       = alle anderen Häuser (Lodge bleibt dabei!), aber OHNE Ötztal und OHNE Tirol
//
// '%tztal%' matcht "Ötztal"/"Otztal"/"Oetztal" – umgeht Umlaut-Stolperfallen.

const IS_WP    = `LOWER(h.name) LIKE '%white pearl%'`;
const IS_CEC   = `LOWER(h.name) LIKE '%cecilia%'`;
const IS_OTZ   = `LOWER(h.name) LIKE '%tztal%'`;
const IS_LODGE = `LOWER(h.name) LIKE '%lodge%'`;
const IS_TIROL = `LOWER(h.name) LIKE '%tirol%'`;

// WHERE-Bedingung (auf h.name) für einen Plan; '' = keine Einschränkung.
function planCondition(plan) {
  if (plan === 'mainstreet') return `(${IS_WP} OR ${IS_CEC})`;
  if (plan === 'sonja')      return `(${IS_OTZ} OR ${IS_LODGE})`;
  if (plan === 'oetztal')    return IS_OTZ;
  if (plan === 'helga')      return IS_TIROL;
  if (plan === 'wiwa')       return `(h.name IS NULL OR NOT (${IS_WP} OR ${IS_CEC} OR ${IS_OTZ} OR ${IS_TIROL}))`;
  return '';
}

// Reihenfolge im Plan Sonja: MYALPS Ötztal zuerst, Lodge danach.
const SONJA_ORDER = `CASE WHEN ${IS_OTZ} THEN 0 WHEN ${IS_LODGE} THEN 1 ELSE 2 END`;

module.exports = { planCondition, SONJA_ORDER };
