# Steep Life

*A still life you can drink.*

You are standing in front of a 17th-century Dutch still life. On the table: a
Delft cup, five tins of tea, a stoneware jug, a lemon, three stroopwafels and —
for reasons the museum declines to discuss — an electric copper kettle.

Visitors are kindly requested to **touch the painting**.

Make a cup of tea. Fill the kettle, boil it (it sings), pick a tin, pour, steep,
dunk, add milk and watch it bloom, stir until the cup briefly contains a galaxy,
warm a stroopwafel on the rim, and sip — the cup leaves the painting for a
moment; this is normal. When you stop touching it, the paint dries.

When the cup is empty the dregs are read, the work is signed and hung, and a
critic reviews it. There is no wrong way to make tea here. There are, however,
opinions.

## Play

It is a static site: no build step, no dependencies to install.

```sh
cd steep-life
python3 -m http.server 8000     # or any static file server
# open http://localhost:8000
```

(It must be served over http(s); browsers will not load ES modules from `file://`.)
Works with mouse or touch, landscape or portrait. Needs WebGL 2.

| You do | The painting does |
| --- | --- |
| **Hold** the stoneware jug | fills the kettle |
| **Tap** the kettle / **hold** it | switches it on / pours |
| **Tap** a tin | chooses a tea (the label says what it likes) |
| **Tap** the tag / **hold** it | dunks the bag / lifts it out |
| **Hold** the creamer | milk |
| **Tap** sugar, lemon, stroopwafel | a cube, a squeeze, a lid for the cup |
| **Draw circles** in the cup | stirs |
| **Tap** the cup | a sip |
| **Sign & hang it** | ends the sitting at any moment |

Things worth trying: Butterfly Pea with lemon. Milk first. Lemon *and* milk.
Twelve sugars. Leaving it for a very long time. Doing nothing at all and signing it.

## How it is made

Everything is procedural — there is not a single image, model or sound file.

- **Rendering** — [three.js](https://threejs.org) (vendored in `vendor/`), physically
  based materials, a hand-built "dark room with one window" environment map, a
  window-pane light cookie, soft shadows, HDR bloom and an ACES grade.
- **The oil pass** — a rotated Kuwahara filter, impasto, linen weave and craquelure
  (`js/post.js`). It fades in when the scene is left alone, so the photoreal render
  dries into a painting. The picture that is hung in the gallery is taken through it.
- **The tea** — a small GPU simulation (`js/liquid.js`): milk, lemon and tea liquor are
  dyes advected by a swirl-plus-curl velocity field; colour comes from Beer–Lambert
  absorption (weak tea is pale gold, strong tea is nearly black, butterfly pea turns
  violet with acid); a wave-equation heightfield gives ripples from pours and plops.
- **Geometry and textures** — lathes, tubes and canvas-painted textures
  (`js/scene.js`, `js/textures.js`): Delft windmills, tin labels, stroopwafel lattice.
- **Sound** — Web Audio synthesis (`js/audio.js`): filtered-noise kettle, a pour whose
  pitch rises as the cup fills, Karplus–Strong lute, a slurp.
- **The critic** — `js/critic.js` turns what you did into a title, a medium line, a
  review, an auction estimate and a fortune.

Brewing runs at six times real speed ("time runs fast inside paintings"), so a
four-minute Assam takes forty seconds. Your gallery is kept in `localStorage`.

## Files

```
index.html  style.css
js/main.js      game loop, interactions, state
js/scene.js     the table and everything on it
js/liquid.js    the surface of the tea
js/post.js      bloom, grade, oil-paint pass
js/fx.js        steam, poured streams
js/textures.js  procedural textures
js/audio.js     synthesised sound
js/critic.js    titles, reviews, fortunes
js/ui.js        captions, placard, gallery, share card
js/teas.js      the tea cabinet
vendor/         three.js (MIT)
```
