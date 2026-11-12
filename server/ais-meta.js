// AIS reference tables: ship type codes (ITU-R M.1371) and MMSI MID → flag state.
export function typeLabel(t) {
  if (t == null) return 'Unknown';
  if (t === 30) return 'Fishing';
  if (t === 31 || t === 32) return 'Towing';
  if (t === 33) return 'Dredging / underwater ops';
  if (t === 34) return 'Diving ops';
  if (t === 35) return 'Military';
  if (t === 36) return 'Sailing';
  if (t === 37) return 'Pleasure craft';
  if (t >= 40 && t <= 49) return 'High-speed craft';
  if (t === 50) return 'Pilot';
  if (t === 51) return 'Search & rescue';
  if (t === 52) return 'Tug';
  if (t === 53) return 'Port tender';
  if (t === 54) return 'Anti-pollution';
  if (t === 55) return 'Law enforcement';
  if (t === 58) return 'Medical';
  if (t >= 60 && t <= 69) return 'Passenger';
  if (t >= 70 && t <= 79) return 'Cargo';
  if (t >= 80 && t <= 89) return 'Tanker';
  if (t >= 90 && t <= 99) return 'Other';
  return 'Unknown';
}

// Types whose job involves slow work over the seabed or loitering: behaviour signals are "explained".
export const WORK_TYPES = new Set([30, 31, 32, 33, 34, 35, 50, 51, 52, 53, 54, 55, 58]);
export const isTankerOrCargo = (t) => t >= 70 && t <= 89;

const MID = {
  '205': ['BE', 'Belgium'], '209': ['CY', 'Cyprus'], '210': ['CY', 'Cyprus'], '211': ['DE', 'Germany'], '212': ['CY', 'Cyprus'],
  '215': ['MT', 'Malta'], '218': ['DE', 'Germany'], '219': ['DK', 'Denmark'], '220': ['DK', 'Denmark'], '224': ['ES', 'Spain'],
  '225': ['ES', 'Spain'], '226': ['FR', 'France'], '227': ['FR', 'France'], '228': ['FR', 'France'], '229': ['MT', 'Malta'],
  '230': ['FI', 'Finland'], '231': ['FO', 'Faroe Islands'], '232': ['GB', 'United Kingdom'], '233': ['GB', 'United Kingdom'],
  '235': ['GB', 'United Kingdom'], '236': ['GI', 'Gibraltar'], '237': ['GR', 'Greece'], '239': ['GR', 'Greece'], '240': ['GR', 'Greece'],
  '241': ['GR', 'Greece'], '244': ['NL', 'Netherlands'], '245': ['NL', 'Netherlands'], '246': ['NL', 'Netherlands'],
  '247': ['IT', 'Italy'], '248': ['MT', 'Malta'], '249': ['MT', 'Malta'], '250': ['IE', 'Ireland'], '251': ['IS', 'Iceland'],
  '255': ['PT', 'Portugal (Madeira)'], '256': ['MT', 'Malta'], '257': ['NO', 'Norway'], '258': ['NO', 'Norway'], '259': ['NO', 'Norway'],
  '261': ['PL', 'Poland'], '263': ['PT', 'Portugal'], '265': ['SE', 'Sweden'], '266': ['SE', 'Sweden'], '271': ['TR', 'Türkiye'],
  '273': ['RU', 'Russia'], '275': ['LV', 'Latvia'], '276': ['EE', 'Estonia'], '277': ['LT', 'Lithuania'],
  '304': ['AG', 'Antigua & Barbuda'], '305': ['AG', 'Antigua & Barbuda'], '308': ['BS', 'Bahamas'], '309': ['BS', 'Bahamas'],
  '311': ['BS', 'Bahamas'], '312': ['BZ', 'Belize'], '314': ['BB', 'Barbados'], '341': ['KN', 'St Kitts & Nevis'],
  '351': ['PA', 'Panama'], '352': ['PA', 'Panama'], '353': ['PA', 'Panama'], '354': ['PA', 'Panama'], '355': ['PA', 'Panama'],
  '356': ['PA', 'Panama'], '357': ['PA', 'Panama'], '370': ['PA', 'Panama'], '371': ['PA', 'Panama'], '372': ['PA', 'Panama'],
  '373': ['PA', 'Panama'], '374': ['PA', 'Panama'], '375': ['VC', 'St Vincent & Grenadines'], '376': ['VC', 'St Vincent & Grenadines'],
  '377': ['VC', 'St Vincent & Grenadines'], '412': ['CN', 'China'], '413': ['CN', 'China'], '414': ['CN', 'China'],
  '477': ['HK', 'Hong Kong'], '511': ['PW', 'Palau'], '518': ['CK', 'Cook Islands'], '538': ['MH', 'Marshall Islands'],
  '563': ['SG', 'Singapore'], '564': ['SG', 'Singapore'], '565': ['SG', 'Singapore'], '566': ['SG', 'Singapore'],
  '572': ['TV', 'Tuvalu'], '613': ['CM', 'Cameroon'], '620': ['KM', 'Comoros'], '626': ['GA', 'Gabon'], '636': ['LR', 'Liberia'],
  '637': ['LR', 'Liberia'], '667': ['SL', 'Sierra Leone'], '671': ['TG', 'Togo'], '677': ['TZ', 'Tanzania'],
};
export function flagOf(mmsi) {
  const m = String(mmsi);
  if (m.length !== 9) return [null, null];
  return MID[m.slice(0, 3)] || [null, null];
}

// Registries repeatedly named in shadow-fleet reporting. A weak, identity-only signal.
export const FOC_SHADOW = new Set(['CK', 'GA', 'KM', 'SL', 'CM', 'PW', 'TG', 'TZ', 'BB']);

export const RU_GOF_DEST = /PRIMORSK|UST.?LUGA|PETERSBURG|SPB|VYSOTSK|RU ?PRI|RU ?ULU|RU ?LED|RU ?VYS/i;
