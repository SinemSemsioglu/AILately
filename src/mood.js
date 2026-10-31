import { smoothstep } from './scale.js';

// How far a divided topic's wash splits into its two camps.
export const splitAmount = (division) => smoothstep(0.35, 0.85, division);

// The mood actually drawn: with a focus picked, the other axes go neutral.
export function effectiveMood(m, focus) {
  const e = { outlook: m.outlook, belief: m.belief, division: m.division, sides: m.sides ?? [m.outlook, m.outlook] };
  if (focus === 'outlook') Object.assign(e, { belief: 0, division: 0 });
  if (focus === 'belief') Object.assign(e, { outlook: 0, division: 0, sides: [0, 0] });
  if (focus === 'division') e.belief = 0;
  return e;
}

// Outlooks of the two sides: both the topic's outlook when united, each camp's when split.
export function lobeOutlooks(e) {
  const s = splitAmount(e.division);
  return e.sides.map((side) => e.outlook + (side - e.outlook) * s);
}

export function describeMood(m) {
  const words = [];
  if (m.outlook > 0.35) words.push('hopeful');
  else if (m.outlook < -0.35) words.push('worried');
  if (m.belief > 0.35) words.push('believers');
  else if (m.belief < -0.35) words.push('sceptical');
  if (m.division > 0.6) words.push('divided');
  return words.length ? words.join(' · ') : 'mixed';
}
