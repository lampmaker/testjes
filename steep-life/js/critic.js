// The museum label and the critic. Every cup gets a title, a medium line,
// a review, an auction estimate and a reading of the dregs.
import { mulberry, pick, fmtTime } from './util.js';

const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const num = (n) => (n < NUM.length ? NUM[n] : String(n));
const Num = (n) => { const w = num(n); return w.charAt(0).toUpperCase() + w.slice(1); };

const CRITICS = [
  ['H. van der Kettel', 'De Theepot Courant'],
  ['Marguerite Souchong', 'The Saucer Review'],
  ['Dr. A. Steepwell', 'Quarterly Journal of Lukewarm Studies'],
  ['Pieter Kopje', 'Het Nieuwe Stilleven'],
  ['Oolong Thompson', 'Infusion Weekly'],
  ['B. Bergamot-Hughes', 'Modern Beverage'],
];

const SHAPES = [
  ['a small boat', 'Something you are waiting for is already on its way. It is travelling by boat. Be patient.'],
  ['a bird, possibly a goose', 'A loud friend will bring surprisingly good news.'],
  ['a bicycle with one wheel', 'A journey will be shorter than planned, and better for it.'],
  ['a key', 'You will find something you had stopped looking for. It was in the other coat.'],
  ['a windmill', 'The wind is about to turn in your favour. Hold on to your hat regardless.'],
  ['a second, smaller teacup', 'You will be offered tea. Accept.'],
  ['a cat looking away', 'Someone is pretending not to admire you.'],
  ['a staircase', 'Progress is being made, one biscuit at a time.'],
  ['a comma', 'It is not over; there is merely a pause.'],
  ['a tulip', 'A modest investment will flower. Do not, historically speaking, overdo it.'],
  ['an umbrella', 'It will rain. This is less a fortune than a certainty, but the leaves insist.'],
  ['a moon with a bite taken out', 'Go to bed earlier. The leaves have noticed.'],
  ['a fish wearing a hat', 'An absurd idea of yours deserves a second look.'],
  ['a door, ajar', 'An opportunity is waiting politely for you to notice it.'],
  ['a loaf of bread', 'Simple things will be enough this week.'],
  ['two people sharing an umbrella', 'Someone will make room for you.'],
  ['nothing in particular', 'For once, nothing is about to happen. Enjoy it.'],
  ['a question mark', 'The answer is yes. The leaves did not catch the question.'],
];

function strengthWord(s) {
  if (s < 0.2) return 'Barely-Acquainted';
  if (s < 0.55) return 'Timid';
  if (s < 0.82) return 'Gentle';
  if (s < 1.14) return 'Well-Steeped';
  if (s < 1.36) return 'Robust';
  return 'Over-Steeped';
}

function milkPhrase(m) {
  if (m <= 0.005) return null;
  if (m < 0.06) return 'a rumour of milk';
  if (m < 0.16) return 'a splash of milk';
  if (m < 0.3) return 'milk';
  if (m < 0.5) return 'a great deal of milk';
  return 'mostly milk';
}

function money(v) {
  if (v >= 1e6) return '€' + (v / 1e6).toFixed(1).replace('.0', '') + ' million';
  if (v >= 1000) return '€' + Math.round(v).toLocaleString('en-US');
  if (v >= 20) return '€' + Math.round(v);
  return '€' + v.toFixed(2);
}

// rec: see main.js `record()`
export function appraise(rec) {
  const rnd = mulberry(rec.seed);
  const tea = rec.tea;
  const s = rec.strength;
  const notes = [];           // review sentences, in rough order of importance
  let quality = 50, weird = 0;
  let title, medium = [];

  const hasLiquid = rec.poured > 0.05;
  const milkP = milkPhrase(rec.milk);

  // ---------------------------------------------------------------- the brew
  if (!hasLiquid && !rec.milk) {
    title = rec.bagUsed ? `Still Life with Dry ${tea.name} (Unbegun)` : 'Still Life with No Tea';
    notes.push(pick([
      'The artist has made nothing, and signed it. One admires the nerve.',
      'An empty cup, presented without apology. It is the most honest work in the room.',
      'No water, no leaf, no steam: a meditation on intention. Or a misclick.',
    ], rnd));
    quality = 8; weird += 3;
  } else if (!hasLiquid && rec.milk) {
    title = 'A Cup of Milk, Titled “Tea”';
    notes.push('The artist poured milk into a teacup and stopped. We are invited to consider why. We decline.');
    quality = 15; weird += 4;
  } else if (!tea) {
    title = rec.pourTemp > 60 ? 'Hot Water, a Study' : 'Cold Water in a Good Cup';
    notes.push(rec.pourTemp > 60 ? pick([
      'Technically flawless hot water. The absence of tea is felt, like a chair pulled away.',
      'The artist has omitted the tea. What remains is water, heated with conviction.',
    ], rnd) : 'Cold water, in a very good cup. The kettle was present throughout and was not consulted.');
    quality = 22; weird += 3;
  } else {
    const sw = strengthWord(s);
    title = `Still Life with ${sw} ${tea.name}`;
    const ratio = rec.steepSec / tea.time;
    if (s < 0.2) { notes.push(`The ${tea.name} and the water were introduced but did not get on. The result is ${pick(['a faint memory of tea', 'hot water with ambitions', 'beige in spirit'], rnd)}.`); quality = 30; }
    else if (s < 0.55) { notes.push(`A shy ${tea.name}: ${fmtTime(rec.steepSec)} in the water, which is ${pick(['a visit, not a stay', 'barely long enough to say hello', 'what the Dutch would call “kijken, niet kopen”'], rnd)}.`); quality = 48; }
    else if (s < 0.82) { notes.push(`A gentle ${tea.name}, ${pick(tea.adjective, rnd)} and unhurried. A minute more would not have hurt, but nobody was hurt.`); quality = 66; }
    else if (s < 1.14) { notes.push(pick([
      `The ${tea.name} is exactly as strong as it means to be: ${pick(tea.adjective, rnd)}, composed, sure of itself.`,
      `${fmtTime(rec.steepSec)} of steeping, and not a second of it wasted. The ${tea.name} glows like the varnish on a Vermeer.`,
      `A properly made ${tea.name}. One forgets how rare that is until one sees it hanging on a wall.`,
    ], rnd)); quality = 90; }
    else if (s < 1.36) { notes.push(`A ${tea.name} with opinions. ${pick(['It could hold up a spoon, and possibly a small bridge.', 'Builders would nod at it.', 'It looks back at you.'], rnd)}`); quality = 74; }
    else { notes.push(`The ${tea.name} steeped for ${fmtTime(rec.steepSec)} and has become ${pick(['a tannic abyss', 'more of a wood stain', 'geology'], rnd)}. ${pick(['One respects the commitment.', 'The spoon is afraid.', 'It will outlive us all.'], rnd)}`); quality = 44; weird += 1; }
    if (rec.pourTemp < 45) { notes.push('The water was never heated. A cold infusion, which is either a mistake or very fashionable.'); quality -= 18; weird += 2; title = `Cold ${tea.name}, Bravely`; }
    else if (rec.pourTemp > tea.temp + 12 && tea.temp < 90) { notes.push(`Boiling water on ${tea.name}: the leaves were not so much steeped as startled.`); quality -= 12; }
    else if (rec.pourTemp < tea.temp - 22) { notes.push('The water had cooled its heels a while before pouring, and the leaf was slow to wake.'); quality -= 6; }
    else if (Math.abs(rec.pourTemp - tea.temp) <= 6 && ratio > 0.8 && ratio < 1.25) { quality += 8; }
    if (rec.bagLeftIn && rec.sips > 0) { notes.push('The bag was left in while drinking, bobbing against the lip like a small wet ghost.'); weird += 1; quality -= 4; }
    if (rec.dunks >= 6) { notes.push(`The bag was dunked ${num(rec.dunks)} times. It has asked not to be contacted.`); weird += 1; }
    if (rec.bags > 1) { notes.push(`${Num(rec.bags)} bags were used, in the manner of a person who has been let down before.`); weird += 1; }
  }

  // ---------------------------------------------------------------- additions
  if (hasLiquid) {
    medium.push(tea ? tea.name : null, `water at ${Math.round(rec.pourTemp)} °C`);
    if (milkP) medium.push(milkP);
    if (rec.sugar) medium.push(`${num(rec.sugar)} sugar cube${rec.sugar > 1 ? 's' : ''}`);
    if (rec.lemon) medium.push(rec.lemon > 1 ? `lemon (${num(rec.lemon)} squeezes)` : 'lemon');
    if (tea) medium.push(`${fmtTime(rec.steepSec)} of patience`);
  } else {
    if (rec.milk) medium.push('milk');
    if (rec.sugar) medium.push(`${num(rec.sugar)} dry sugar cube${rec.sugar > 1 ? 's' : ''}`);
    medium.push('intention');
  }
  if (rec.wafels) medium.push(rec.wafels > 1 ? `${num(rec.wafels)} stroopwafels` : 'stroopwafel');

  if (rec.milkFirst && hasLiquid) {
    notes.push(pick(['The milk went in first. Wars have been fought over less; the artist appears unbothered.', 'Milk before water: a declaration of class, or of war, depending on the county.'], rnd));
    weird += 1; if (tea) title += ' (Milk First)';
  }
  if (rec.curdled) {
    notes.push('Lemon and milk were combined, and have curdled into small pale islands. It is, technically, a cheese course.');
    weird += 3; quality -= 22; title = tea ? `${tea.name} with Curds, Regrettably` : 'The Curdling';
  } else if (tea && tea.id === 'pea' && rec.lemon) {
    notes.push('The lemon turned the blue liquor violet before our eyes. The gallery guard gasped. It is chemistry, but one prefers to call it theatre.');
    weird += 2; quality += 6; title = 'Butterfly Pea, Suddenly Violet';
  } else if (rec.lemon >= 4) { notes.push(`${Num(rec.lemon)} squeezes of lemon. This is no longer tea with lemon; it is lemon with a witness.`); weird += 1; }
  if (rec.milk > 0.42 && hasLiquid) { notes.push('There is more milk here than tea. A latte, in denial.'); weird += 1; quality -= 8; }
  if (tea && rec.milk > 0.03 && (tea.id === 'sencha' || tea.id === 'chamomile' || tea.id === 'pea') && !rec.curdled) {
    notes.push(`Milk in ${tea.name}. The artist was told not to and did it anyway, which is how most art gets made.`); weird += 1; quality -= 6;
  }
  if (rec.sugar >= 7) { notes.push(`${Num(rec.sugar)} sugar cubes. The spoon stands unaided. Dentists gather outside the gallery.`); weird += 2; quality -= 10; }
  else if (rec.sugar >= 4) { notes.push(`${Num(rec.sugar)} sugars: less a beverage than a negotiation with syrup.`); weird += 1; }
  if (rec.galaxy) { notes.push(pick(['Stirred, the cup briefly contained a spiral galaxy. The artist did not seem surprised, which is the unsettling part.', 'For a few seconds there were stars in it. We have checked; there are not supposed to be.'], rnd)); weird += 1; quality += 4; }
  else if ((rec.milk > 0.02 || rec.sugar > 0) && !rec.stirred && hasLiquid) { notes.push('Nothing was stirred. The sugar sits at the bottom like a secret.'); quality -= 3; }
  if (rec.overflow) { notes.push('The cup was filled past its rim, and the saucer has become a small lake. Generous.'); weird += 1; quality -= 5; }
  if (rec.reboiled > 1) { notes.push(`The kettle was boiled ${num(rec.reboiled)} times, as if the first boil could not be trusted.`); }

  // ---------------------------------------------------------------- the drinking
  if (hasLiquid && rec.sips > 0) {
    if (rec.firstSipTemp > 78) { notes.push('The first sip was taken at a temperature normally associated with forging. Courage, or a deadline.'); weird += 1; quality -= 5; }
    else if (rec.firstSipTemp < 34) { notes.push(`The tea was left for ${fmtTime(rec.waitSec)} and drunk stone cold, the way it is at the desks of the truly busy.`); weird += 2; quality -= 12; if (tea && !rec.curdled) title = `Nocturne in Lukewarm ${tea.name}`; }
    else if (rec.firstSipTemp >= 52 && rec.firstSipTemp <= 68) { quality += 6; }
  } else if (hasLiquid) {
    notes.push('It was never tasted. A cup of tea made purely to be looked at, which is, after all, what a still life is.');
    weird += 1;
  }
  if (rec.wafelWarm) { notes.push('A stroopwafel was warmed on the rim until the syrup gave in. This is correct, and the Netherlands thanks you.'); quality += 7; }
  else if (rec.wafels >= 3) { notes.push('All three stroopwafels are gone. The plate has been left as evidence.'); weird += 1; }
  else if (rec.wafelCold) { notes.push('The stroopwafel was eaten cold, straight from the plate, like a person with a train to catch.'); }
  if (rec.moth === 'stayed') { notes.push('A moth sat for the portrait and was left in peace, which is more than most sitters get.'); quality += 3; }
  else if (rec.moth === 'shooed') { notes.push('A moth was waved away mid-composition. It has lodged a complaint.'); weird += 1; }
  if (rec.watchTaps >= 5) { notes.push('The artist kept tapping the watch. It did not help; it never does.'); }
  if (rec.totalSec > 600) { notes.push('The whole work took rather a long time. Tea, eventually.'); }

  quality = Math.max(3, Math.min(100, quality));
  // keep the review a sensible length: the brew line, then the juiciest of the rest
  const review = [notes[0], ...notes.slice(1, 4)].filter(Boolean).join(' ');
  const verdict = quality >= 92 ? 'A masterpiece. Do not touch it. (You may drink it.)'
    : quality >= 78 ? 'A fine cup, confidently made.'
    : quality >= 60 ? 'Honest work. It will hang well in a hallway.'
    : quality >= 40 ? 'Brave. We use the word carefully.'
    : quality >= 20 ? 'A challenging piece.'
    : 'A warning to others, beautifully lit.';

  // the art market is not rational and neither is this
  const base = Math.pow(quality / 100, 2.2) * 3800 + 2.4;
  const hype = Math.pow(3.1, weird) * (0.8 + rnd() * 0.5);
  const low = base * (0.7 + rnd() * 0.2) * (weird >= 4 ? hype : Math.sqrt(hype));
  const high = low * (1.6 + rnd() * 1.2) * (weird >= 3 ? 6 : 1);
  const estimate = `${money(low)} – ${money(high)}`;

  const critic = pick(CRITICS, rnd);
  const shape = SHAPES[Math.floor(rnd() * SHAPES.length)];
  const mediumLine = medium.filter(Boolean).join(', ') + ' on porcelain';
  return {
    title, medium: mediumLine.charAt(0).toUpperCase() + mediumLine.slice(1),
    review, verdict, estimate, quality, weird,
    critic: critic[0], paper: critic[1],
    shape: shape[0], fortune: shape[1],
  };
}
