---
version: 1
slug: "landing"
primary_target: "landing"
related_targets: ["src/landing"]
---

# Landing page (route `#/welcome`)

Scope: single-page marketing landing inside the existing React frontend, reached at `#/welcome`; the app stays the default route. Mode: Persuade.
Audience: a curious visitor arriving from a link or the promo film, knowing nothing. Job: understand in seconds what Moonrizon shows, then press the one big "Try Moonrizon" button (opens `#/moon`). Educators and planners find their view further down.
Proof on hand: promo film, nine real app screenshots, the pitch verification numbers (97.5% slope agreement with NASA PGDA on 118 of 121 points, 184/184 backend tests, 0.9 s from cache), NASA sources. The horizon scene on this page is illustrative and says so.
Constraints: English only; spacing in steps of 8; no gradients, glow or shadows; Lucide icons; two weights per face; no uppercase; no camera rotations; no claims of landing safety. Landing must not load CesiumJS.
Open decisions: catalog size wording (29 vs 13 + 16 vs 13 + 9), public URL and data mode behind the button, team credits and repo link.

## Direction contract
THESIS: The scroll is time. One lunar month at the south pole passes as you scroll, and the page refuses the headline-plus-feature-cards landing by making the product's own question (when are the Sun and the Earth above the real ridge?) the mechanism of the page.
OWN-WORLD: Night sky #12141e with sparse stars, three flat regolith ridge layers (#2a2e3d, #3a3e4e, #4d5266), Sun ochre #c2964a, Earth sky blue #8aa6d6 with a night limb, indigo #2b2fa8 only on the action, light ground #eceef4 with white cards below the surface, indigo field for the close. Bricolage Grotesque 800 display, Figtree 400/600, JetBrains Mono for measured values only. Pills for every control.
STORY: See the horizon and the offer → scroll and watch the Sun hide behind a hill, then the Earth drop → realise every site has its own answer → see the window where both are up → how the app answers it, for whom, how it was checked → film → the button again.
FIRST VIEWPORT: Full-bleed pinned horizon. "Before you land, look up." at 128px in the sky upper left, one line of explanation, the 80px indigo "Try Moonrizon" pill and a film link under it; mono readout upper right (day, Sun el, Earth el, state); Sun with dotted trail and Earth on the right above the ridge; dashed flat-horizon line; timeline with Sunlight / Earth in view / Sun + Earth rows docked at the bottom, filled to the current day.
FORM: scroll-as-time pinned scene, position 3 of 7, seed:c5aef8c4929088a5
SIGNATURE: the docked timeline fills as you scroll and can be dragged to scrub the month; headlines change with the promo film's word slam as each event arrives; time advances by itself to day 4 on arrival.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
