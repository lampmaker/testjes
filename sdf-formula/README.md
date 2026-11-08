# ShadyTracer-scène → SDF-formule

Zet de geometrie van een ShadyTracer-scène om in één wiskundige functie van het punt
**p = (x, y, z)**: de signed distance `f(x, y, z)` — negatief binnen, positief buiten, nul op
het oppervlak. Geen lichten, materialen, texturen of camera.

Uitvoer in drie vormen:

- **Formule** (tekst), met de onderdelen als benoemde deeltermen (`d_ball = √(...) - 30`);
- **JavaScript**: `sdfXYZ(x, y, z)` en `sdf([x, y, z])`, los bruikbaar;
- **GLSL**: `float sdf(vec3 p)`, bijvoorbeeld voor Shadertoy.

Met `--inline` (of het vinkje op de pagina) wordt het één enkele expressie zonder deeltermen —
de "pure" formule. Die kan veel langer worden, omdat een gedeelde deelterm dan bij elk gebruik
opnieuw wordt uitgeschreven.

## Gebruik

Exporteer in ShadyTracer een scène (File › Export › scene, een `.json` met
`"format": "raytracer-scene"`). Dan:

```
node sdf-formula/cli.mjs scene.json                     # de formule als tekst
node sdf-formula/cli.mjs scene.json --format js -o sdf.js
node sdf-formula/cli.mjs scene.json --format glsl --no-planes
node sdf-formula/cli.mjs scene.json --at 0,0,20         # ook f in dat punt
```

Opties: `--format text|js|glsl`, `--inline`, `--digits N`, `--skip-unsupported` (laat weg wat
niet kan, in plaats van te stoppen), `--no-planes` (laat oneindige vlakken zoals de vloer weg),
`--exclude label1,label2`.

Of in de browser: serveer de repository (`python3 -m http.server` in `testjes/`) en open
`http://localhost:8000/sdf-formula/`. Sleep een scène erin; rechts staat een doorsnede van de
formule zelf (blauw binnen, oranje buiten, wit het oppervlak), zodat je kunt zien dat hij klopt.

Als module:

```js
import { sceneToSDF } from './sdf-formula/src/scene.js'
import { toText, toJS, toGLSL, compile } from './sdf-formula/src/emit.js'
const r = sceneToSDF(sceneJson, { skipUnsupported: true })
console.log(toText(r.d, { labels: r.labels }))
const f = compile(r.d)            // f(x, y, z) -> afstand
```

## Hoe het werkt

ShadyTracer slaat elk object op als WGSL-code (`C = add_new(C, Nsphere(p, radius), MATERIAL);`),
ook de ingebouwde vormen. Deze tool voert die code **symbolisch** uit: een kleine WGSL-interpreter
(`src/interp.js`) rekent met x, y, z als variabelen en alle parameters als getallen, en bouwt zo
een expressie (`src/expr.js`). De vormfuncties zelf (`Nsphere`, `NboxRounded`, `g2Revolve`,
`csgRoundUnion`, ...) worden niet nagebouwd maar uit ShadyTracer gehaald
(`src/prelude.js`, gegenereerd door `tools/sync-prelude.mjs` uit `sdf.js` en `scene_api.js`):
de formule is dus de rekensom van de shader zelf. Ook door de gebruiker aangepaste code en
eigen functies (`functions` in de scène) werken, zolang ze binnen wat hieronder staat blijven.

- **Transformaties**: `q = Rᵀ(p − pos) / schaal`, R = Rz·Ry·Rx (graden), afstand × schaal.
- **Gewone groep**: vereniging, `min`. (De renderer kiest per punt het dichtstbijzijnde
  oppervlak, |d| minimaal; dat is gelijk aan `min` behalve binnen overlappende objecten, waar
  `min` de juiste afstand van de vereniging is.)
- **CSG-groep**: union / subtract / intersect, hard, smooth (blend), round of chamfer, met
  ShadyTracer's eigen functies.
- **Modifiers** (twist, bend, repeat, mirror, circular array, round, shell, displace): hun code
  wordt gewoon uitgevoerd; `warp(k)` vermenigvuldigt de afstand met k, zoals in de renderer.
- **Arrays** (copies): vereniging van de kopieën.
- **Profielen** (extrude, revolve): het profiel wordt in stukken gecompileerd zoals ShadyTracer
  dat doet (`src/profiles.js`).
- Vertakkingen die van het punt afhangen worden `c ? a : b`; lussen worden uitgerold.

## Wat (nog) niet kan

- **Paden**: tube en sweep langs een route.
- **Ruis**: de noise-relief-modifier en noise-functies (`fbm3`, `worley3`, ...).
- **Reliëf van een materiaal** (een textuur die het oppervlak verplaatst): weggelaten, met een melding.
- Lussen of array-indices die van het punt afhangen.

Zo'n object geeft een foutmelding met zijn naam; met `--skip-unsupported` wordt het weggelaten
en staat het in de kop van de uitvoer.

## Controleren

```
node sdf-formula/test/test.mjs ../ShadyTracer
```

Vergelijkt, zonder GPU, met ShadyTracer's eigen JavaScript-tweelingen: elke vorm in
`core/shapes.js` (en de gesloten vormen van `sdf.js`), de joins in `builder/joins.js`, de
transformatie van `builder/transform.js`, de documentafstand van `import/test/docsdf.mjs`
op de voorbeeldscènes die die kan lezen, plus met de hand berekende gevallen voor smooth
blends, arrays en modifiers. Elke voorbeeldscène wordt omgezet en de gecompileerde formule
wordt gelijk gehouden aan dezelfde scène met het punt als getallen.

Na een wijziging van de vormen in ShadyTracer: `node sdf-formula/tools/sync-prelude.mjs ../ShadyTracer`
en daarna de tests.
