# poe-craft: cheapest-route crafting planner for Path of Exile 1

> ⚠️ **Heads up:** this is AI vibe-coded (built with Claude) by a dumbass who has no idea what he's doing. Use at your own risk; no warranty, no promises.

You give it a base item, an item level and the mods you want. It ranks crafting methods and multi-step
routes by **expected chaos cost**, priced from the live economy. The methods are chaos, alt/aug/regal,
essences, fossils, Harvest, bench metamods, beastcrafts, influence crafting (influence exalts,
Awakener's Orb, Orb of Dominance), Eldritch currency and fractured mods.

Game data comes from the [RePoE fork](https://repoe-fork.github.io/), which is auto-exported every patch.
Prices come from [poe.ninja](https://poe.ninja/). Crafting rules for 3.30 (Covens), with sources and an
UNVERIFIED list, are in [docs/mechanics.md](docs/mechanics.md). The plan and roadmap are in
[DESIGN.md](DESIGN.md).

Status: a command-line engine on Windows. Route search (MDP) and a browser front end come next.

## Crafting engine (C++)
You need the VS C++ Build Tools and Python 3 (standard library only).

1. `python fetch_data.py` downloads game data and prices into `data/` (cached).
2. `build.bat` builds `build\poecraft.exe`.
3. `python compile_pool.py --base "Hubris Circlet" --ilvl 86 [--influence shaper]` writes `build\pools\Hubris_Circlet_86.pool`.
   Every pool holds all six influences' mods; `--influence` only sets the default start influence.
4. `python prices.py` writes `build\prices.txt` (one `name<TAB>chaos` per line, for the league in `data\manifest.json`).
5. `build\poecraft.exe rank --pool build\pools\Hubris_Circlet_86.pool --target tests\real\es_2p1s.target`

Tests: `python -I tests\run_tests.py` (add `--real` for an end-to-end run on real data).

### Commands
- `eval --method M [--start S] [--expect P]`: one method's success chance, both exact and Monte-Carlo with a 95% confidence interval, and its expected cost.
- `rank [--start TOKENS] [--max-fossils 3] [--top 40] [--check-samples 200000]`: ranks chaos, alch, alt, the essences, Harvest reforges and fossil combos, plus the Harvest influence reforges and Eldritch Chaos when the start allows them. `--start` adds tokens to every start item (for example `--start "hunter frac:SomeModId"`). `--check-samples` is the Monte-Carlo size used as a cross-check when exact odds exist.
- `route --route F [--trials N]`: simulates a multi-step craft.
- `outcomes --method M --start S` and `list [--mods]`.
- `find --pool P --text WORDS [--infl NAME|any] [--kind RECDVA] [--limit N]`: search the pool's mods by id, type or text (no target needed). `_` in a word stands for a space.
- Common options: `--samples`, `--threads`, `--seed`, `--cfg`, `--prices`, `--set "key=value;..."`.

### Method names
- **Currency:** `chaos alch transmute alt aug altaug regal exalt annul scour`
- **Essences and fossils:** `essence:<name>`, `fossil:a+b`
- **Harvest:** `harvest:tag:<t>`, `harvest:more|less`, `harvest:addremove:<t>`
- **Bench:** `bench:<modid>`, `lockprefix locksuffix multimod noattack nocaster benchremove`
- **Beastcrafts:** `beast:imprint|restore|prefix_remove_suffix|suffix_remove_prefix|meta|aspect`, `beast:influence:<infl>`
- **Influence:** `exalt:<infl>` (Shaper's ... Warlord's Exalted Orb), `awaken:<donor infl>[:<donor mod id>]`, `dominance`, `harvest:influence`, `harvest:randomise_influence`
- **Eldritch and fractured:** `eldritch:chaos|exalt|annul`, `conflict`, `fracture`
- Influence names: `shaper elder crusader redeemer hunter warlord`.

To chain methods, join them with commas, for example `lockprefix,chaos`.

### Start state (`--start`)
`normal`, `magic mod:ID`, or `rare mod:ID ... lockP lockS multi noattack nocaster`. Add an influence name (or `noinfl`), `exarch` / `eater` / `eldritch` (tied implicits) for Eldritch armour, and `frac:ID` for a fractured mod. An influence mod in the start adds its influence by itself.

### File formats
- **Target file:** one requirement per line, written `need K [as LABEL] tok...`. Tokens are `mod:ID`, `type:T[<=tier]`, `group:G[<=tier]`, `tag:T[<=tier]`, `infl:<name|any>` (any influence or Elevated mod of it) or `text:words` (case-insensitive, `_` for a space). Every line must be met.
- **Route file:**
  - Header lines: `start S`, `success COND`, `maxcost C`.
  - Steps: `do M`, `repeat M until COND max N`, `if COND do M`, `check COND else restart|goto N|fail|<method> goto N`.
  - A condition (COND) is a target label or a state check (`openP`, `openS`, `rare`, `lockP`, `imprint`, `influenced`, `hunter`, `fractured`, `exarch`, `eater`, `eldritch`, ...). Combine them with `&` (and) and `|` (or).
- **Pool file (v2):** tab-separated, with `H` header, `M` mod, `E` essence, `F` fossil and `B` bench-craft lines. `M` lines carry the mod's influence and the id of its next tier up (T1 -> Elevated) for the Orb of Dominance. The full spec is in the `compile_pool.py` docstring.
- **`mechanics.cfg`:** every rule number, written `key = value`, with sources and TODOs. It covers mod-count odds, side caps, crafted limits, fossil stacking, the essence tier rule, metamod behaviour, the Harvest more/less multipliers, Awakener's mod count, Eldritch and Conflict rules, Harvest/beast/bench/influence/Eldritch costs and manual `price.<Name>` entries. When a patch changes a rule, you fix it here; there's no need to recompile.

### Known gaps
- Not modelled yet:
  - Eldritch implicit tiers: dominance is a start token, and the Orb of Conflict uses flat odds.
  - Veiled mods, Memory Strands, Recombinators.
  - Partial 1- or 2-mod locks, which are treated as ordinary crafted mods.
  - Tangled, Glyphic and Fractured fossils, and Sanctified's lucky rolls.
  - Mod values: tracked only as tiers.
- Some numbers GGG hasn't published are assumptions, marked TODO in `mechanics.cfg`. That includes the Harvest "more likely" x90 (Craft of Exile; maxroll says x10), "less likely" 1/90, Awakener's mod count and the Elevated link for some influence mods (see docs/mechanics.md Part F and its UNVERIFIED list).
