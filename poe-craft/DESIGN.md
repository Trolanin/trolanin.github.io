# poe-craft: design

Goal: given a base item, item level and the stats you want, find the **cheapest expected route** to
craft it in Path of Exile 1, priced from the live economy. That covers single methods (chaos spam,
alt-regal, essences, fossils) and chained routes (alt → regal → metacraft → harvest).

## Data, and where it comes from
| Need | Source | Refresh |
|---|---|---|
| Mods, spawn weights, tags, groups, tiers | [RePoE fork](https://repoe-fork.github.io/) (auto-exported from the game files each patch, 3.30.0.4 at start) | 6 h cache |
| Base items + tags, essences, fossils, bench recipes | RePoE fork | 6 h cache |
| Currency, essence, fossil, resonator, oil prices | poe.ninja exchange overview (`/poe1/api/economy/exchange/current/overview`) | 1 h cache (their cadence) |
| Beasts, lifeforce, base items, harvest crafts | not in that feed; see `docs/mechanics.md` → pricing sources | TBD |
| Rules RePoE doesn't encode (mod-count weights, harvest/beastcraft behaviour, 3.30 changes) | hand-kept table in `docs/mechanics.md`, cited | per patch |

Rules for the price sources: one generic User-Agent, cached, ~1 request/s, no scraping of sites
that don't offer an API (Craft of Exile included). The official trade API is only for spot checks
and is strictly rate-limited.

## Pipeline
1. `fetch_data.py`: downloads game data + prices into `data/` (git-ignored).
2. `compile_pool.py`: base + ilvl + influence → the rollable mod pool, with weights per method
   (normal, each essence, each fossil combo) → compact file in `build/pools/`.
3. `poecraft.exe` (C++20, MSVC): the engine.
   - The item state is a set of explicit mods (≤ 3 prefixes, ≤ 3 suffixes, mod groups exclusive).
   - Each method is `apply(state) → distribution over next states`, sampled allocation-free.
   - `eval`: multithreaded Monte-Carlo success odds with a confidence interval, cross-checked
     against exact formulas where tractable. Expected cost = cost per attempt ÷ p.
   - `rank`: every applicable single method for a target, sorted by expected chaos.
4. **Next: route search.** Model crafting as a Markov decision process over "relevant" states
   (which target mods you already have, open prefix/suffix slots, metamod flags). Transition
   probabilities come from the sampler; value iteration finds the cheapest policy, i.e. what to
   do from each state, including "stop and sell / start over". The state space is kept small by
   tracking only target-relevant mods and slot counts, not the full item.
5. **Later: front end.** A static page on trolanin.github.io. The engine compiles to WebAssembly,
   so it runs in the browser with no server. Prices are fetched by a scheduled GitHub Action into a
   JSON file, so visitors never hit poe.ninja directly.

## Metacrafting is first-class
Every method below is the same kind of object, so the route search can chain any of them:
- **Bench:** metamods (prefixes / suffixes cannot be changed, cannot roll attack / caster mods,
  up to 3 crafted mods) and ordinary bench crafts. Each costs currency and takes up an affix slot.
- **Harvest:** reforges (plain, keep prefixes, keep suffixes, tag-targeted "reforge with X",
  "more likely") and any augment/remove-add crafts that exist in 3.30. Cost is lifeforce × the
  lifeforce price.
- **Bestiary:** imprint, which acts as a retry token in the route search, plus split,
  "remove prefix, add suffix" and the reverse, and aspects. Cost is the beast's price.
- **Eldritch:** eldritch currencies (chaos, exalt, annul).

What's available in 3.30 and the exact numbers (lifeforce amounts, "more likely" multipliers) are
kept in `mechanics.cfg`, which `docs/mechanics.md` backs with sources. That way a patch change is a
data edit, not a recompile.

## Why it's heavy, and how it stays fast
- Rare-item outcome spaces are combinatorial (hundreds of mods, 6 slots, groups), so exact odds
  only work for small cases. Monte-Carlo at tens of millions of rolls/s across 32 threads handles
  the rest.
- Route search multiplies that by states × methods. Transition tables are cached per
  (pool, method, abstract state), so each is sampled once and reused by value iteration.
