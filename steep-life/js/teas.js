// The tea cabinet. `absorb` is a Beer-Lambert absorption vector (r,g,b):
// weak tea comes out pale and golden, strong tea deep and dark, for free.
// `absorbAcid` is what the liquor turns into when lemon arrives.

export const TEAS = [
  {
    id: 'assam', name: 'Assam', sub: 'Breakfast Black', temp: 100, time: 240,
    tin: '#7b2a22', ink: '#f0dcae',
    absorb: [0.55, 1.75, 4.6], absorbAcid: [0.4, 1.25, 3.6],
    leaf: 'black', adjective: ['malty', 'brisk', 'unapologetic'],
  },
  {
    id: 'earl', name: 'Earl Grey', sub: 'Bergamot', temp: 95, time: 210,
    tin: '#5d6a78', ink: '#f2ead8',
    absorb: [0.42, 1.35, 3.9], absorbAcid: [0.3, 0.95, 3.0],
    leaf: 'black', adjective: ['perfumed', 'aristocratic', 'citrus-haunted'],
  },
  {
    id: 'sencha', name: 'Sencha', sub: 'Green, Steamed', temp: 75, time: 120,
    tin: '#3f5a3c', ink: '#ecdfb4',
    absorb: [1.05, 0.38, 2.9], absorbAcid: [0.9, 0.3, 2.3],
    leaf: 'green', adjective: ['grassy', 'serene', 'vegetal'],
  },
  {
    id: 'chamomile', name: 'Chamomile', sub: 'Flowers, Dried', temp: 100, time: 300,
    tin: '#c69a3a', ink: '#3a2a12',
    absorb: [0.12, 0.42, 2.5], absorbAcid: [0.1, 0.36, 2.1],
    leaf: 'herb', adjective: ['drowsy', 'meadow-scented', 'forgiving'],
  },
  {
    id: 'pea', name: 'Butterfly Pea', sub: 'Blue Flower', temp: 95, time: 240,
    tin: '#2a3170', ink: '#e8dcc0',
    absorb: [3.6, 2.1, 0.32], absorbAcid: [0.75, 3.3, 0.55],
    leaf: 'flower', adjective: ['indigo', 'improbable', 'theatrical'],
  },
];

export const teaById = (id) => TEAS.find((t) => t.id === id);

// "Painting time" runs faster than gallery time. Nobody has complained.
export const TIME_SCALE = 6;
