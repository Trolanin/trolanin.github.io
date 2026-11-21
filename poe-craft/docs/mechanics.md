# PoE1 crafting mechanics spec (3.30 "Covens of Umbra") for the poe-craft engine

Status: DRAFT written 2026-11-20; influence / Eldritch / fractured / technique pass 2026-11-21 (Parts F, G). Game data: RePoE-fork export 3.30.0.4 in `data/repoe/`. Latest patch seen: **3.30.0d** (patchbot lists 3.30.0b hotfixes 1-4, 3.30.0c, 3.30.0d + 2 hotfixes, 2026-11-14..20; the task brief said 3.30.0c is latest - it is not, but 0c/0d contain no crafting-cost changes).
Conventions: **VERIFIED** = stated by official patch notes / game data / two sources agree. **UNVERIFIED** = single secondary source, inference, or not published. "c" = Chaos Orb. Prices are poe.ninja snapshot 2026-11-20 (1 Divine = 221.4c).

Sources (fetched 2026-11-20): [official 3.30.0 notes](https://www.pathofexile.com/forum/view-thread/4013680) | [patchbot 3.30.0 mirror (full text)](https://patchbot.io/games/path-of-exile/articles/2188-content-update-3300-path-of-exile-covens-of-umbra) | [3.30.0b hotfix 4](https://www.pathofexile.com/forum/view-thread/4016174) | [3.30.0c](https://patchbot.io/games/path-of-exile/articles/2297-3300c-patch-notes) | [3.30.0d](https://patchbot.io/games/path-of-exile/articles/2319-3300d-patch-notes) | [poedb Horticrafting (live 3.30 costs)](https://poedb.tw/us/Horticrafting) | [poewiki Beastcrafting](https://www.poewiki.net/wiki/Beastcrafting) | [poewiki Metamod](https://www.poewiki.net/wiki/Metamod) | [poewiki Harvest crafting](https://www.poewiki.net/wiki/Harvest_crafting) | [poewiki Crafting Bench](https://www.poewiki.net/wiki/Crafting_Bench) | [Exiled Bench: metacrafting](https://www.exiledbench.com/blog/metacrafting-locking-prefixes-suffixes) | [Exiled Bench: bench guide](https://www.exiledbench.com/blog/poe-crafting-bench-guide) | [Vtomes 3.30 crafting changes](https://vtomes.com/poe/guides/3-30-crafting-changes/).

Layout: Part A metacrafting (bench, Harvest, Bestiary) -> Part B core roll rules -> Part C other currencies/methods -> Part D RePoE field map + hand-maintained tables -> Part E pricing sources -> Part F influence, Eldritch, fractured, Memory Strands -> Part G technique catalogue.

---
# PART A - METACRAFTING (highest-detail section)

## A1. Crafting bench and metamods

### A1.1 General bench rules
* A bench craft adds one **crafted** mod (`mods.json` domain `"crafted"`, `generation_type` prefix or suffix). Normal affix rules: needs an open prefix/suffix slot of the right kind; cannot duplicate a mod **group** already on the item (rolled or crafted); limits 3+3 (rare), 1+1 (magic). Availability depends only on the craft's `item_classes` list (no ilvl gate). [Exiled Bench](https://www.exiledbench.com/blog/poe-crafting-bench-guide), [poewiki](https://www.poewiki.net/wiki/Crafting_Bench). VERIFIED.
* Normally **1 crafted mod per item**. Cap becomes 3 only with metamod "Can have up to 3 Crafted Modifiers", which itself is a crafted mod (one of the 3) and occupies a suffix: so at most 2 additional bench mods. VERIFIED.
* Replacing: crafting onto an item that already has a crafted mod replaces it for an **extra Orb of Scouring**; "Remove Crafted Mods" = 1 Orb of Scouring (RePoE `remove_crafted_mods`). Impossible if the item has several crafted mods or the crafted mod is fractured, or the item is corrupted/mirrored. VERIFIED.
* Bench pays from inventory then stash. Recipes are one-time unlocks (a per-craft "unlocked" flag the user sets; not in RePoE).
* Rerolling currency (Chaos, Alteration, Scouring) removes crafted mods like any non-fractured mod, except where a metamod protects them (A1.4).
* **3.30 bench changes (official notes, VERIFIED):** (a) every bench cost that used Orbs of Chance now costs "an equivalent amount" of Orbs of Alteration (RePoE 3.30.0.4 has no `CurrencyUpgradeToUnique` costs; only `reroll_rarity` still lists `CurrencyUpgradeRandomly` x1 and Exiled Bench says the game still asks for a Chance - UNVERIFIED which is right, irrelevant to mod crafting); (b) new option: set all sockets white = 1 Orb of Scouring (+1 Vaal Orb on corrupted); (c) four new metamods (A1.2); (d) full-side lock costs now depend on item type (A1.3); (e) all metamod recipes moved from Unique Maps to **Nightmare Maps**; (f) "Cannot roll Caster/Attack Modifiers" no longer stops Annulment-type currencies from *removing* such mods; (g) bug fix: bench "reroll 1 / reroll 3 random modifiers on a Rare" now respect metamods.
* Bench "reroll N random mods" (RePoE `reroll_rare_mods` N=1 costs 8 Chaos; N=3 costs 3 Chaos; added 3.29): you do not choose which mods change. Algorithm UNVERIFIED - model as: pick N mods uniformly among non-protected non-fractured mods, replace each with a fresh mod of the same affix type.

### A1.2 Metamod catalogue (RePoE `crafting_bench_options.json` + `mods.json`; VERIFIED vs 3.30 notes)
All are `domain: crafted`, stat-less (a single `item_generation_*` flag stat). **The slot a metamod occupies is the OPPOSITE affix type to what it protects.**

| Metamod (text) | mod id (RePoE; B/C suffix = class-group variant) | occupies | mod group (one per item) | classes |
|---|---|---|---|---|
| Prefix Modifiers cannot be changed (full) | `StrMasterItemGenerationCannotChangePrefixes` (+`B`,`C`) | **suffix** | `ItemGenerationCannotChangePrefixes` | A/B/C |
| 1 Prefix Modifier cannot be changed (NEW 3.30) | `StrMasterItemGenerationCannotChangeOnePrefixes` (+B,C) | suffix | same group -> only ONE prefix-lock of any size per item | A/B/C |
| 2 Prefix Modifiers cannot be changed (NEW) | `...CannotChangeTwoPrefixes` (+B,C) | suffix | same | A/B/C |
| Suffix Modifiers cannot be changed (full) | `DexMasterItemGenerationCannotChangeSuffixes` (+B,C) | **prefix** | `ItemGenerationCannotChangeSuffixes` | A/B/C |
| 1 Suffix Modifier cannot be changed (NEW) | `...CannotChangeOneSuffixes` (+B,C) | prefix | same group | A/B/C |
| 2 Suffix Modifiers cannot be changed (NEW) | `...CannotChangeTwoSuffixes` (+B,C) | prefix | same | A/B/C |
| Cannot roll Attack Modifiers | `IntMasterItemGenerationCannotRollAttackAffixes` | suffix | `ItemGenerationCannotRollAttackAffixes` | all 24 |
| Cannot roll Caster Modifiers | `StrDexMasterItemGenerationCannotRollCasterAffixes` | suffix | `ItemGenerationCannotRollCasterAffixes` | all 24 |
| Can have up to 3 Crafted Modifiers | `StrIntMasterItemGenerationCanHaveMultipleCraftedMods` | suffix | `ItemGenerationCanHaveMultipleCraftedMods` | all 24 |
| (legacy) "of Dueling": cannot roll mods with required level > 28 | not in bench data | suffix | - | existing items only |

Class groups: **A (15 weapon classes)** Dagger, Rune Dagger, 1H Axe/Mace/Sword, Thrusting 1H Sword, Claw, Sceptre, 2H Axe/Mace/Sword, Staff, Warstaff, Wand, Bow. **B (6)** Body Armour, Gloves, Boots, Helmet, Shield, Quiver. **C (3)** Ring, Amulet, Belt.
Engine model: a metamod is a pseudo-mod occupying 1 affix slot of the stated type. It is deletable by operations that remove that affix type and are not themselves protected: Scouring on a prefix-locked item removes **all suffixes including the lock** and keeps every prefix; Annulment may hit it ([poewiki](https://www.poewiki.net/wiki/Metamod), [Exiled Bench](https://www.exiledbench.com/blog/metacrafting-locking-prefixes-suffixes)).
**Which mods a "1/2 ... cannot be changed" lock protects (NEW 3.30):** when the protected side holds more mods than the lock number, Exiled Bench reports the game picks **at random** ("checked in the game"); the official notes say nothing. Model: choose k of the existing mods on that side uniformly at craft time (whether it re-rolls per operation: UNVERIFIED). Only unambiguous when the side has exactly k mods. I found **no** official hotfix text about a "randomly selected prefix" fix in 3.30.0b hotfixes 1-4, 3.30.0c or 3.30.0d (hotfix 4 only has the Veiled Chaos change).

### A1.3 Bench cost table (VERIFIED: official notes + RePoE `cost` dict; id names in D3)
| Craft | cost | ~chaos |
|---|---|---|
| 1 Prefix OR 1 Suffix cannot be changed | 1 Divine | 221 |
| 2 Prefix OR 2 Suffix cannot be changed | 2 Divine | 443 |
| Full Prefix/Suffix cannot be changed - weapons (A) | 4 Divine + 1 Sacred Orb (`CurrencyRerollDefences`) | ~902 |
| ... armour + quiver (B) | 4 Divine + 4 Blessed Orb (`CurrencyRerollImplicit`) | ~887 |
| ... jewellery + belt (C) | 4 Divine + 8 Exalted Orb (`CurrencyAddModToRare`) | ~892 |
| Cannot roll Attack / Caster | 1 Divine each | 221 |
| Can have up to 3 Crafted Modifiers | 2 Divine | 443 |
| Remove crafted mods / replace existing crafted mod | 1 Scouring / +1 Scouring | 0.8 |
| Set all sockets white (NEW) | 1 Scouring (+1 Vaal if corrupted) | 0.8 |

Before 3.30 a full lock cost 2 Divine on any item. `CurrencyRerollDefences = Sacred Orb` is inferred from the patch note matching the RePoE cost pattern (weapon class group has 4 Divine + 1 of this id).
Ordinary bench mods: `crafting_bench_options.json` entries with `actions.add_explicit_mod = <mod id>`, `cost` = {currency metadata id: count}, `item_classes`, `bench_tier` (unlock label 0-5 only). 748 add-mod options. RePoE's `master` field is unreliable (labels almost everything "Niko").

### A1.4 Which operations respect which metamod (poewiki Metamod table, last edited 2026-11-19; page flagged "needs update for 3.30")
R = respected; R* = respected, but **open slots on the protected side can still be filled with new mods**; I = ignored; X = cannot be used on the item; "-" = n/a.

| Operation | Prefixes locked | Suffixes locked | No Attack | No Caster |
|---|---|---|---|---|
| Alteration | R* | R* | - | - |
| Augmentation, Regal | - | - | R | R |
| Scouring | R | R | I | I |
| Divine | R | R | - | - |
| Chaos | R* | R* | R when "Suffixes locked" also present (else the flag, a suffix, is rerolled away) | same |
| Annulment | R | R | **I since 3.30** (can remove attack/caster mods) | **I since 3.30** |
| Exalted (and Hunter/Warlord/... variants) | R* | R* | R | R |
| Eldritch Chaos | I | I | R | R |
| Eldritch Exalted | R* | R* | R | R |
| Eldritch Annulment | R | R | I | I |
| Orb of Dominance | R | R | I | I |
| Awakener's Orb | I | I | I | I |
| Tainted Exalted (corrupted) | R* | R* | I when removing | I when removing |
| Tainted Divine Teardrop | I | I | I | I |
| **Fossils / resonators** | X | X | X | X |
| **Essences** | X | X | X | X |
| Veiled Exalted | R | R | I | I |
| Veiled Chaos | R; since 3.30.0b hotfix 4 it works on an item that already has a veiled mod unless that mod is protected by fracture or metamod | R | UNVERIFIED | UNVERIFIED |
| Harvest "Add new [type] mod, remove another" | R* | R* | R adding, I removing | same |
| Harvest "Reforge including [type] mod" | R* | R* | R (since 3.27) | R |
| Harvest "Change resistance/damage type" | R | R | - | - |
| Harvest "more/less likely" reforge | R* | R* | R with suffix lock (unconfirmed) | same |
| Harvest "Randomise influence + reforge" | R*, blocked if a locked-side mod is influenced | same | unknown | unknown |
| Fracturing Orb | I | I | I | I |
| Beast "Add Prefix, Remove Suffix" | R* | adds without removing | I ("does not protect") | I |
| Beast "Add Suffix, Remove Prefix" | adds without removing | R* | I | I |
| Bench "reroll 1/3 random mods" | R (3.30 bugfix) | R | UNVERIFIED | UNVERIFIED |

Notes: (1) Essences/fossils refuse to apply when the item has any outcome-affecting metamod **except** the multi-craft one (poewiki). Treat metamods as a precondition check there, not a weight change. (2) "R*" = the operation rerolls everything except the protected side's *existing* mods; users plug open slots on the protected side with a temporary crafted mod (needs the 3-crafted-mods metamod). (3) Awakener's Orb ignores all metamods (since 3.9.1b). (4) Engine mapping: Eldritch Chaos ignores side locks unless `eldritch.chaos_honours_locks = 1`; Eldritch Exalted behaves like Exalted on the dominant side only; Eldritch Annulment and Dominance respect side locks; Awakener's and Fracturing ignore all metamods.

### A1.5 Metamod economics (for the optimiser)
* Standard patterns: **lock + Scour** (keep one side, wipe the other incl. the lock; re-buy lock each cycle), **lock + Chaos spam** (community practice: the lock stays while the unprotected side is rerolled - UNVERIFIED in the sources I fetched; expose a flag `lock_survives_chaos`, default true, and `lock_survives_exalt` true), **lock + Annul** (Annul can pick only from the unprotected side, and the lock itself lives there, so it is a legal target - include in probability).
* A full lock at 3.30 prices costs ~890c; the 1-mod lock 221c; 2-mod lock 443c; so a 1- or 2-mod lock is much cheaper when the side to keep has exactly 1 or 2 mods. Count lock re-purchases per cycle.

---
## A2. Harvest / Horticrafting in 3.30

### A2.1 How crafts are obtained (VERIFIED: [3.30 notes](https://patchbot.io/games/path-of-exile/articles/2188-content-update-3300-path-of-exile-covens-of-umbra), [poewiki](https://www.poewiki.net/wiki/Harvest_crafting))
* Since 3.19 there are **no stored crafts**: you acquire **Crystallised Lifeforce** (tradable currency; Wild/Vivid/Primal stack 50 000; Sacred stack 10; **Crystallised Rancour** stack 10), and at the **Horticrafting Station** hideout decoration you pick any craft from the full list and pay its cost. Unlimited uses while you hold the lifeforce.
* 3.30 rework: no separate Sacred Grove subarea; **Sacred Flora** spawn within Maps, each tied to one lifeforce colour; killing the Sacred Fauna drops lifeforce (3.30.0d: at the end of the encounter, around the tree). Tier-1 monsters no longer drop lifeforce, tier-2 less often, stacks bigger ("same total, fewer pickups"). The Horticrafting Station unlocks the first time you complete a Sacred Flora encounter (tutorial quest removed). High-tier maps may spawn a Sacred Specimen -> Harvest boss.
* Lifeforce is bought via trade/Currency Exchange (priced in A2.5). There is no other purchase route.
* **Removed crafts the engine must NOT offer:** "reforge keeping prefixes/suffixes" (not in the current list; metamods replaced them), fracture a mod (3.20), Synthesise item (3.29), white-socket (3.29), flask enchants (3.28), type-specific Annul/Divine/augment crafts (3.14), scarab swap + map Sextant enchant (3.24), Sacrifice/Mortal fragment swap (3.30).

### A2.2 3.30 cost changes (VERIFIED, official)
Resistance swaps: **300 of two different lifeforce colours** (was 500 of one). Damage-type swaps: **300 of two colours + 1 Crystallised Rancour** (was 500 of one + Rancour). Divination-card double-or-nothing: 1000 each of Primal+Wild+Vivid (was 1500 Vivid).

### A2.3 Full craft list (73 crafts; poedb Horticrafting Station = live 3.30 values)
Colours: **Wild** = fire/life/attack, **Vivid** = cold/physical/chaos/speed, **Primal** = lightning/defence/caster/critical/minion/mana. `arg` of `reforge_including` / `add_remove` is the mod tag as shown with Alt on the item; in RePoE that is `mods.json[*].implicit_tags` (e.g. `Strength1.implicit_tags == ["attribute"]`). Tags used: fire, cold, lightning, physical, life, defence(s), chaos, attack, caster, speed, critical, minion, elemental, attribute, mana, drop. `~chaos` = costs x poe.ninja unit prices (A2.5). Costs are per craft (not per stack) except "stack conversion" crafts, which scale with stack size.
The **Rancour (113c) and Sacred (13.8c) dominate**: damage swaps ~128c, add/remove crafts 350-560c; resistance swaps ~15c; the 10 basic reforge-including crafts (fire..critical) cost 1-4c, but minion/elemental/attribute/mana/drop need 1-3 Rancour (117-343c).

| id | kind | arg | Wild | Vivid | Primal | Sacred | Rancour | ~chaos (2026-11-20) |
|---|---|---|---|---|---|---|---|---|
| H01 | reforge_including | fire | 50 | 0 | 0 | 0 | 0 | 1.1 |
| H02 | reforge_including | cold | 0 | 50 | 0 | 0 | 0 | 1.4 |
| H03 | reforge_including | lightning | 0 | 0 | 50 | 0 | 0 | 1.3 |
| H04 | reforge_including | physical | 0 | 50 | 0 | 0 | 0 | 1.4 |
| H05 | reforge_including | life | 75 | 0 | 0 | 0 | 0 | 1.7 |
| H06 | reforge_including | defence | 0 | 0 | 75 | 0 | 0 | 2.0 |
| H07 | reforge_including | chaos | 0 | 100 | 0 | 0 | 0 | 2.7 |
| H08 | reforge_including | attack | 75 | 0 | 0 | 0 | 0 | 1.7 |
| H09 | reforge_including | caster | 0 | 0 | 75 | 0 | 0 | 2.0 |
| H10 | reforge_including | speed | 0 | 150 | 0 | 0 | 0 | 4.1 |
| H11 | reforge_including | critical | 0 | 0 | 150 | 0 | 0 | 4.0 |
| H12 | reforge_including | minion | 0 | 0 | 200 | 0 | 3 | 343.4 |
| H13 | reforge_including | elemental | 200 | 0 | 0 | 0 | 1 | 117.1 |
| H14 | reforge_including | attribute | 0 | 200 | 0 | 0 | 2 | 230.8 |
| H15 | reforge_including | mana | 0 | 0 | 200 | 0 | 2 | 230.7 |
| H16 | reforge_including | drop | 0 | 200 | 0 | 0 | 1 | 118.1 |
| H17 | reforge_more_likely | same_tags | 200 | 0 | 0 | 0 | 0 | 4.4 |
| H18 | reforge_less_likely | same_tags | 200 | 0 | 0 | 0 | 0 | 4.4 |
| H28 | swap_resistance | cold->fire | 300 | 0 | 300 | 0 | 0 | 14.6 |
| H29 | swap_resistance | lightning->fire | 300 | 300 | 0 | 0 | 0 | 14.8 |
| H30 | swap_resistance | fire->cold | 300 | 0 | 300 | 0 | 0 | 14.6 |
| H31 | swap_resistance | lightning->cold | 0 | 300 | 300 | 0 | 0 | 16.1 |
| H32 | swap_resistance | fire->lightning | 300 | 300 | 0 | 0 | 0 | 14.8 |
| H33 | swap_resistance | cold->lightning | 0 | 300 | 300 | 0 | 0 | 16.1 |
| H34 | swap_damage | cold->fire | 300 | 0 | 300 | 0 | 1 | 127.3 |
| H35 | swap_damage | lightning->fire | 300 | 300 | 0 | 0 | 1 | 127.5 |
| H36 | swap_damage | fire->cold | 300 | 0 | 300 | 0 | 1 | 127.3 |
| H37 | swap_damage | lightning->cold | 0 | 300 | 300 | 0 | 1 | 128.8 |
| H38 | swap_damage | fire->lightning | 300 | 300 | 0 | 0 | 1 | 127.5 |
| H39 | swap_damage | cold->lightning | 0 | 300 | 300 | 0 | 1 | 128.8 |
| H46 | randomise_influence_reforge |  | 0 | 0 | 1000 | 0 | 0 | 26.3 |
| H47 | enchant_quality | +1 Maximum Life per 2% quality | 3250 | 0 | 0 | 0 | 0 | 72.2 |
| H48 | enchant_quality | +1 Maximum Mana per 2% quality | 0 | 0 | 3250 | 0 | 0 | 85.6 |
| H49 | enchant_quality | +1 Strength per 2% quality | 3250 | 0 | 0 | 0 | 0 | 72.2 |
| H50 | enchant_quality | +1 Dexterity per 2% quality | 0 | 3250 | 0 | 0 | 0 | 88.3 |
| H51 | enchant_quality | +1 Intelligence per 2% quality | 0 | 0 | 3250 | 0 | 0 | 85.6 |
| H52 | enchant_quality | +1% to Fire Resistance per 2% quality | 3250 | 0 | 0 | 0 | 0 | 72.2 |
| H53 | enchant_quality | +1% to Cold Resistance per 2% quality | 0 | 3250 | 0 | 0 | 0 | 88.3 |
| H54 | enchant_quality | +1% to Lightning Resistance per 2% quality | 0 | 0 | 3250 | 0 | 0 | 85.6 |
| H55 | enchant_quality | +0.1 metres to Weapon Range per 10% Quality | 5000 | 0 | 0 | 0 | 0 | 111.2 |
| H56 | enchant_quality | 1% increased Area of Effect per 4% Quality | 5000 | 0 | 0 | 0 | 0 | 111.2 |
| H57 | enchant_quality | 1% increased Accuracy per 2% Quality | 0 | 5000 | 0 | 0 | 0 | 135.8 |
| H58 | enchant_quality | 1% increased Attack Speed per 8% Quality | 0 | 5000 | 0 | 0 | 0 | 135.8 |
| H59 | enchant_quality | 1% increased Critical Strike Chance per 4% Quali | 0 | 0 | 5000 | 0 | 0 | 131.8 |
| H60 | enchant_quality | 1% increased Elemental Damage per 2% Quality | 0 | 0 | 5000 | 0 | 0 | 131.8 |
| H62 | add_remove | fire | 15000 | 0 | 0 | 1 | 0 | 347.2 |
| H63 | add_remove | cold | 0 | 15000 | 0 | 1 | 0 | 421.3 |
| H64 | add_remove | lightning | 0 | 0 | 15000 | 1 | 0 | 409.0 |
| H65 | add_remove | physical | 0 | 15000 | 0 | 1 | 0 | 421.3 |
| H66 | add_remove | life | 17500 | 0 | 0 | 1 | 0 | 402.8 |
| H67 | add_remove | defence | 0 | 0 | 17500 | 1 | 0 | 474.9 |
| H68 | add_remove | chaos | 0 | 17500 | 0 | 1 | 0 | 489.2 |
| H69 | add_remove | attack | 17500 | 0 | 0 | 1 | 0 | 402.8 |
| H70 | add_remove | caster | 0 | 0 | 17500 | 1 | 0 | 474.9 |
| H71 | add_remove | speed | 0 | 20000 | 0 | 1 | 0 | 557.2 |
| H72 | add_remove | critical | 0 | 0 | 20000 | 1 | 0 | 540.8 |
| H73 | reforge_influenced | influence | 0 | 0 | 5000 | 1 | 0 | 145.5 |

Non-mod crafts (stack conversions etc.), same column order:

| id | craft | Wild | Vivid | Primal | Sacred | Rancour |
|---|---|---|---|---|---|---|
| H19 | Sacrifice a Rare Corrupted Map. Create a new Corrupted Map of the same tier and rarity. | 200 | 0 | 0 | 0 | 0 |
| H20 | Change a stack of Fossils into a different type of Fossil. The new Fossil type may have a  | 30 | 0 | 0 | 0 | 0 |
| H21 | Change a stack of Oils into a different colour of Oil. Cost is proportional to stack size. | 0 | 30 | 0 | 0 | 0 |
| H22 | Change a stack of Catalysts into a different type of Catalyst. Cost is proportional to sta | 0 | 30 | 0 | 0 | 0 |
| H23 | Change a stack of Essences into a different type of the same tier. Cost is proportional to | 0 | 0 | 30 | 0 | 0 |
| H24 | Change a stack of Timeless Splinters or a Timeless Emblem into Splinters or an Emblem of a | 0 | 0 | 4 | 0 | 0 |
| H25 | Change a stack of Delirium Orbs into a different type of Delirium Orb. Cost is proportiona | 0 | 0 | 30 | 0 | 0 |
| H26 | Change a stack of League-Specific Astrolabes into a different type of League-Specific Astr | 0 | 0 | 400 | 0 | 0 |
| H27 | Change a Divination Card into another random Divination Card | 0 | 75 | 0 | 0 | 0 |
| H40 | Change a stack of Shaper Fragments into other random Shaper Fragments. Cost is proportiona | 500 | 0 | 0 | 0 | 0 |
| H41 | Change a stack of Elder Fragments into other random Elder Fragments. Cost is proportional  | 0 | 0 | 500 | 0 | 0 |
| H42 | Change a stack of Conqueror Fragments into other random Conqueror Fragments. Cost is propo | 0 | 500 | 0 | 0 | 0 |
| H43 | Change a stack of Fragments of Terror or Emptiness into the other Fragment. Or change a st | 0 | 800 | 0 | 0 | 0 |
| H44 | Sacrifice up to half a stack of Divination Cards to receive between 0 and twice that amoun | 1000 | 1000 | 1000 | 0 | 0 |
| H45 | Sacrifice a Corrupted Gem to gain 50% of the gem's total experience stored as a Facetor's  | 0 | 4000 | 0 | 0 | 0 |
| H61 | Transform a Support Gem to be a random Support Gem of the same colour | 0 | 500 | 0 | 0 | 1 |

Resistance/damage swap colour pairs (from poedb, transcribed literally; colour pairing is not intuitive so treat as data, UNVERIFIED vs in-game): Cold->Fire Primal+Wild; Lightning->Fire Vivid+Wild; Fire->Cold Wild+Primal; Lightning->Cold Vivid+Primal; Fire->Lightning Wild+Vivid; Cold->Lightning Primal+Vivid (the six `swap_*` rows above list the same).

### A2.4 What each craft does
| kind | behaviour | confidence |
|---|---|---|
| `reforge_including(tag)` | Works on Normal/Magic/Rare (3.16+). Item becomes Rare; all non-protected mods rerolled like a Chaos Orb (4/5/6 mod count, B2) with **at least one mod carrying `tag`** guaranteed; respects metamods incl. cannot-roll attack/caster (3.27). Draw order (guaranteed mod first from tag-filtered pool by normal spawn weights, then the rest) UNVERIFIED. | structure VERIFIED |
| `reforge_more_likely` / `reforge_less_likely` | Chaos-style reroll in which mods sharing a mod group with mods on the item get higher/lower weight. Not officially published (3.19.0e: cost 300 -> 200 and "increased the chance"). [Craft of Exile FAQ](https://www.craftofexile.com/faq) (Harvest datamine): "more likely" = **x90** on present mod types, and the item never ends with fewer mods than before (very rarely more); [maxroll crafting resources](https://maxroll.gg/poe/resources/crafting-resources) says x10. Engine: `harvest.same_type_more_mult = 90`, `_less_mult = 1/90` (less UNVERIFIED), `harvest.more_keeps_count = 1`, `harvest.less_keeps_count = 0`; exact odds in `eval`. | x90 single source; less UNVERIFIED |
| `add_remove(tag)` | Non-influenced items only. Adds one mod from the tag-filtered pool (normal spawn weights), then removes "another random modifier" (the new mod is safe). | wording VERIFIED; removal pool UNVERIFIED |
| `swap_resistance`, `swap_damage` | Replaces a mod granting X by the same-tier mod granting Y; value rerolled; respects locks; damage swap excludes crit-multiplier mods (3.28). | partly UNVERIFIED |
| `reforge_influenced` | "Reforge an Influenced Rare item ... including a Influence modifier" (poedb): 5000 Primal + 1 Sacred. Engine `harvest:influence`: first new mod drawn from the item's influence mods, the rest as Chaos. | VERIFIED text; draw order UNVERIFIED |
| `randomise_influence_reforge` | "Randomise the Influence types on an Influenced Normal, Magic or Rare Item, as well as reforging..." (poedb): 1000 Primal. A1.4: R*, blocked if a locked-side mod is influenced. Engine `harvest:randomise_influence`: new influence set uniform among sets of the same size the base can take (`exclude_current` flag), then a same-rarity reroll. | VERIFIED text; distribution UNVERIFIED |
| `enchant_quality` | Quality-enchant on body armour/weapons (quality gives a stat instead of defence/phys). Not a mod roll. | VERIFIED |
All modifying crafts are blocked on corrupted/mirrored items (standard rule, UNVERIFIED for 3.30 specifically).

### A2.5 Pricing lifeforce
poe.ninja **Currency** exchange overview already contains lifeforce: ids `wild-lifeforce`, `vivid-lifeforce`, `primal-lifeforce`, `sacred-lifeforce`, `sandswept-lifeforce` (= **Crystallised Rancour**). `primaryValue` = chaos per **single unit** (300 Wild = 300 x 0.02223 = 6.7c). Snapshot 2026-11-20: Wild 0.02223, Vivid 0.02717, Primal 0.02635, Sacred 13.76, Rancour 112.7. There is no `type=Lifeforce`; that returns an empty list.

---
## A3. Beastcrafting (Bestiary) in 3.30

### A3.1 Rules (VERIFIED: [3.30 notes](https://patchbot.io/games/path-of-exile/articles/2188-content-update-3300-path-of-exile-covens-of-umbra), [poewiki, edited 2026-11-12](https://www.poewiki.net/wiki/Beastcrafting))
* Crafting happens at the **Blood Altar** in the Menagerie by sacrificing **4 beasts** (the named red/boss beasts plus filler "any rare"), then killing them in the arena. Death = recipe fails, beasts lost.
* 3.30: **Yellow beasts are no longer captured** and are no longer required by any recipe; existing yellow beasts/Bestiary Orbs deleted; Bestiary screen lists only red beasts and bosses. Flask-mod crafts need **any Red beast**.
* Output item level = level of the main sacrificed beast. EXCEPTION: "Add a Prefix, Remove a Random Suffix" / "Add a Suffix, Remove a Random Prefix" use the **beast's level** (not the item's ilvl) to decide eligible mods; other add-mod recipes use item ilvl. The engine therefore needs a `beast_level` input (default 83; UNVERIFIED typical value for a captured red beast in T16).
* Recently removed/changed (engine must not offer old forms): Split item (3.29 -> Fracture on Rare Talisman), Imprint of a *Rare* (3.29: only Magic item or Rare Talisman), 2 Orbs of Binding -> 2 Orbs of Regret (3.30), 8 Chromatic -> Rare 4-linked helmet (3.29).

### A3.2 Recipes relevant to item crafting
Prices = sum of poe.ninja `chaosValue` for the named beasts (stash `type=Beast`, snapshot 2026-11-20); filler beasts ~0c; "1" is poe.ninja's floor ("essentially free").

| id | Recipe | Rules / notes | Required beasts | ~chaos |
|---|---|---|---|---|
| B01 | **Add a crafted Meta-modifier to a non-Unique item** | Randomly crafts one of: Cannot roll Attack, Cannot roll Caster, Prefixes cannot be changed, Suffixes cannot be changed, Can have up to 3 crafted mods (uniform? UNVERIFIED). Needs an empty affix slot of the type the metamod occupies and that a crafted mod "could normally be added without removing another" (5 normal + 1 crafted blocks it). Can force a lock when that side is full. The new 1/2-locks do not appear in the recipe text (UNVERIFIED). | Wild Bristle Matron | 260 |
| B02 | **Add a Prefix, Remove a Random Suffix** | Rare items only; eligible prefixes by beast level; chosen by normal spawn weights over all eligible prefixes (UNVERIFIED but standard); removes a random suffix (A1.4 for locks) | Farric Wolf Alpha | 3 |
| B03 | **Add a Suffix, Remove a Random Prefix** | mirror | Farric Lynx Alpha | 3 |
| B04 | Add a mod to a Shaper / Elder / Crusader / Hunter / Redeemer / Warlord item | adds a mod from that influence pool (item must already carry it) | Shaper: Fenumal Devourer + Craicic Maw; Elder: Saqawine Blood Viper + Craicic Maw; Crusader: Farric Goliath + Craicic Maw; Hunter: Craicic Watcher + Craicic Maw; Redeemer: Fenumal Queen + Craicic Maw; Warlord: Fenumal Scrabbler + Craicic Maw | ~4 each |
| B05 | Add a mod to a Rare Map | maps only | Craicic Savage Crab + Saqawine Cobra | 2 |
| B06 | Imprint of a Magic item | restore with Eternal Orb; since 3.30 imprinting is not "modifying" | Craicic Croaker | 220 |
| B07 | Imprint of a Rare Talisman | | Fenumal Plagued Arachnid | 125 |
| B08 | Apply Hinekora's Lock to a Magic item | not on corrupted | Craicic Croaker + Black Mórrigan | 270 |
| B09 | Fracture 1 mod on Rare **Talisman** (>=4 mods) | not influenced/fractured | Farric Frost Hellion Alpha | 3 |
| B10 | Fracture 2 mods on Rare Talisman (>=6 mods) | | Fenumal Plagued Arachnid + Black Mórrigan | 175 |
| B11 | Reroll Talisman base type (keeps mods) | | Craicic Squid | 2 |
| B12 | Reroll a Watcher's Eye aura mod | not life/mana/ES | Wild Hellion Alpha | 200 |
| B13 | Max possible links | | Craicic Sand Spitter + Black Mórrigan | 54 |
| B14 | Max possible sockets | | Craicic Shield Crab + Black Mórrigan | 51 |
| B15 | 6-link rare / Rare 4-linked helmet | | Saqawine Vulture / Saqawine Rhoa | ~1 |
| B16 | Currency: 10 random / 2 Regret / 3 Unmaking / 4 Jeweller's / 1 Fusing | | Saqawine Chimeral / Craicic Sand Spitter+Craicic Shield Crab / Farric Frost Hellion Alpha+Farric Gargantuan / Craicic Shield Crab / Craicic Sand Spitter | 1-5 |
| B17 | Flask suffix: Life/Mana flask (of Convection, Damping, Earthing, Sealing, the Antitoxin, Warding) or Utility flask (of the Conger, Deer, Lizard, Skunk, Urchin) | flask must have no suffix; weights in poewiki (Warding 3000, others 750; utility 1000 each) | any Red beast lvl 20+ | ~3 |
| B18 | Create Unique <class> | Amulet=Farric Chieftain, Belt=Farric Ape, Body=Farric Ursa, Boots=Saqawine Retch, Bow=Farric Goliath, Claw/Dagger=Craicic Watcher, Flask=Farric Goatman, Gloves=Fenumal Widow, Helmet=Farric Gargantuan, any item=Craicic Savage Crab, Mace/Sceptre=Saqawine Cobra, Map=Farric Taurus, Ring=Farric Flame Hellion Alpha, Shield/Quiver=Fenumal Devourer, Staff=Fenumal Queen, Sword/Axe=Saqawine Blood Viper, Wand=Fenumal Scrabbler, Talisman=Black Mórrigan | | ~1 (Talisman 50) |
| B19 | Convert unique into another random unique | | Fenumal Scorpion | 1 |
| B20 | Not mod crafting: Aspect skills (4 "First of" beasts; Lv30 + Black Mórrigan), portals, scarab/Nightmare/guardian/synthesis maps, corrupted gems, map corruption | | see wiki | - |

### A3.3 Beast route vs bench for metamods
B01 costs 260c per attempt; if the five outcomes are uniform (UNVERIFIED) a specific metamod costs ~1300c expected, versus 221c (attack/caster), 443c (multimod), ~890c (full lock) at the bench. At 2026-11-20 prices the beast route loses everywhere except when the bench recipe is not unlocked. It is only needed to force a lock onto a side that is full (bench cannot, needs an open slot of the opposite type - the beast craft has the same slot requirement per the rule text above, so treat B01 as same slot rules, UNVERIFIED).

### A3.4 Pricing beasts
poe.ninja serves beasts only on the **stash overview** endpoint (not the exchange endpoint): `https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=Covens&type=Beast` (HTTP 200 tested, 51 lines; fields `name, baseType, chaosValue, divineValue, listingCount, count`). Floor value 1c. Spelling: `Black Mórrigan`.

---

# PART B - CORE ROLL RULES

## B1. Affix limits (VERIFIED unless noted)
| Item | max prefixes | max suffixes | rarity notes |
|---|---|---|---|
| Magic equipment | 1 | 1 | |
| Rare equipment | 3 | 3 | |
| Rare jewel / abyss jewel | 2 | 2 | rare max 4 explicit ([poewiki](https://www.poewiki.net/wiki/Jewel)) |
| Cluster jewel | UNVERIFIED (treat as jewel 2/2) | | |
| Flask / tincture | 1 | 1 | cannot be rare |
Items with implicit "+1 Prefix/Suffix allowed" (Cogwork/Geodesic-type rings 3.30): implicit stat adds +1/-1 to caps; Recombinator output still capped at 3/3 ([poewiki](https://www.poewiki.net/wiki/Recombinator)). RePoE: those caps live in base item implicit stats (`base_items.json` implicits -> `mods.json` stats), not a dedicated field.

## B2. Number of explicit mods per method
| Method | resulting count | source |
|---|---|---|
| Chaos / Alchemy / Veiled Chaos / chaotic resonator / Harvest "reforge including" (normal gear) | rare with **4, 5 or 6 mods at weights 8:3:1** (66.7% / 25% / 8.3%) | [poewiki Chaos](https://www.poewiki.net/wiki/Chaos_Orb), VERIFIED |
| Same on jewels | 3 or 4 mods (ratio not published) | [poewiki Alchemy](https://www.poewiki.net/wiki/Orb_of_Alchemy); ratio UNVERIFIED |
| Essence (tier>=5 on rare, any tier on normal), Fossil-in-resonator | same 4/5/6 draw; the guaranteed/essence mod counts toward the total (community consensus; UNVERIFIED in wiki) | |
| Transmutation / Alteration (magic) | 1 or 2 mods; community simulation ~25% prefix-only, 25% suffix-only, 50% both (UNVERIFIED single forum report) | [forum](https://www.pathofexile.com/forum/view-thread/1897121) |
| Augmentation / Regal / Exalted / Eldritch Exalted | +1 mod each | VERIFIED |
| Chaos with protected mods (metamod) | total count draw vs protected count: UNVERIFIED; model: draw N in {4,5,6}, keep protected mods, fill N - protected; if N < protected, no new mods | UNVERIFIED |

## B3. How one mod is chosen (data model = RePoE `mods.json`)
1. **Candidate set**: mods with `domain` matching the item (`item` for equipment, `jewel`, `abyss_jewel`, `flask`; `affliction_jewel` for cluster/timeless jewel mods), `generation_type` in {`prefix`,`suffix`}, `is_essence_only == false`, and effective weight > 0. Special domains only through special currency: `crafted` (bench), `veiled`/`unveiled`, `delve` (fossil `added_mods`), `essence` (essence), `eater_of_worlds_implicit` / `searing_exarch_implicit` (Eldritch currency), `corrupted` (Vaal), `synthesis_*`, `brequel_graft`, `necropolis_*`.
2. **Item level gate**: `mod.required_level <= item_level` (item level of the item being crafted; Beast prefix/suffix crafts use beast level; low-tier essences cap random-mod level at `essences.json[*].item_level_restriction` = min(ilvl, restriction), see C3).
3. **Spawn weight** `w_spawn`: walk `mod.spawn_weights` in listed order; the **first entry whose `tag` is in the item's tag set** (`base_items.json[base].tags`, plus influence/state tags such as `shaper_*`, `fractured_item`, `default`) gives the weight; `default` is the last entry. Weight 0 = cannot spawn ([poewiki Modifier](https://www.poewiki.net/wiki/Modifier) "left-most tag wins"). VERIFIED.
4. **generation_weights** (365 prefix/suffix item mods have them, e.g. LifeLeechPermyriadSuffix1: attack_dagger 100, dagger 50, ..., default 100): second table with the same first-match rule; the effective weight is `w_spawn * w_gen / 100` (so 50 halves it). Community-standard reading (poedb/CoE), UNVERIFIED in official docs.
5. **Group exclusivity**: a candidate is dropped if any of its `groups` equals a group of a mod already on the item (rolled, crafted, implicit-excluded). RePoE `groups` is a list; tiers of the same family share a group.
6. **Metamods / fossils**: multiply or zero the weight as in A1.4 / C4.
7. **Affix slot availability**: prefix candidates only if prefixes < cap; suffix likewise. Both are drawn from **one combined pool** weighted by effective weight (no 50/50 prefix-vs-suffix coin; a side that is full simply removes its mods from the pool). The 50/50 "fill prefixes first" rule belongs to the Recombinator only. Combined-pool reading is the standard model; UNVERIFIED in the wiki text I fetched.
8. **Tier within a family**: each tier is its own RePoE mod id with its own weight and `required_level`; pick among all eligible mod ids directly (no two-stage family pick). 3.30 "Modifier Tier Rating" rework applies to *item generation* (drops, Kingsmarch, Foulborn currency) only, not to Chaos/Exalt/essence; Foulborn Exalted/Regal/Augmentation ("higher level modifiers more likely") block a percentage of the lowest tiers of each mod family; the exact percentage is UNVERIFIED (pre-3.30 community model: block fraction = 1 - 100/(x+100) with x = +75).
9. **Value roll**: each stat value uniform integer in [min,max] (`stats[].min/max`); Divine re-rolls all random mods' values; Sanctified Fossil makes values lucky (roll twice, keep higher; UNVERIFIED exact form).
10. Influence mods: an influenced item adds its class's influence tag (`<class>_shaper`, `_elder`, `_crusader`, `_eyrie` = Redeemer, `_basilisk` = Hunter, `_adjudicator` = Warlord). Influence mods have weight only under that tag (no mod spawns under two influences, and no plain mod changes weight when the tag is added; checked over RePoE 3.30.0.4), so on an influenced item they simply join the normal pool of every reroll and add. Ways in: influence exalts, Harvest influence reforge, Awakener's Orb, beastcraft B04, or any reroll of an already influenced item. Elevated mods have weight 0 and come only from Orb of Dominance (F3). Eldritch items are *not* influenced. Details in Part F. *(Corrected 2026-11-21.)*

## B4. Removal / reroll primitives
* Annulment: removes one explicit mod uniformly at random among removable mods (not fractured; when metamods exist, per A1.4; the metamod itself counts as an explicit mod). 3.30: no longer protected by Cannot-roll-attack/caster. Does not downgrade rarity.
* Scouring: removes all non-fractured explicit mods (and crafted), -> normal; protected side survives with prefix/suffix locks (A1.4).
* Fractured mods: immune to Chaos/Scour/Annul/Harvest; created by Fracturing Orb or Fractured Fossil. They still count toward the mod count and affix caps (F6).

---
# PART C - OTHER CURRENCIES AND METHODS

## C1. Basic orbs (what the engine needs)
| Orb | effect | constraints |
|---|---|---|
| Transmutation | normal -> magic, 1-2 mods | |
| Augmentation | magic with 1 mod -> adds a mod | (Foulborn variant: higher tiers more likely) |
| Alteration | rerolls magic mods; Alt-click = Augmentation | |
| Regal | magic -> rare, +1 mod, keeps existing | (Foulborn variant) |
| Alchemy | normal -> rare 4-6 mods | stack 20; **Orb of Binding removed in 3.30** |
| Chaos | rare reroll 4-6 mods (8:3:1) | respects metamods A1.4 |
| Exalted | +1 random mod on rare with open slot | |
| Annulment | -1 random mod | |
| Divine | rerolls values | |
| Scouring | rare/magic -> normal; costs 4 Fusing at vendor (3.30) | |
| Orb of Chance / reroll-rarity bench | 3.30: much higher unique chance; rarer; not vendor-sold | not a mod-crafting tool |
| Vaal | corrupts (outcomes in RePoE domain `corrupted`) | |
Vendor changes affecting cost (VERIFIED, official): 2 same-name rares -> 1 Chaos; 3 same-name rares -> 1 Exalted; 1 Augmentation buys 1 Transmutation; Alteration can be bought for 4 Augmentations (poewiki); Magic vs Rare currency drop pools now split by monster rarity.

## C2. Foulborn / special exalted orbs (3.30.0d)
Foulborn Exalted / Regal / Augmentation are now in the core drop pool (poe.ninja: 27.5c / 1.9c / 2.0c). Primordial Exalted Orb -> random Exotic Exalted (Hunter/Warlord/Eldritch/Foulborn/Originator...). Originator's Exalted Orb works only on Nightmare Maps. Shaper's/Elder's/Crusader's/Redeemer's/Hunter's/Warlord's Exalted Orbs add that influence **and** one of its mods to a rare item with **no** influence ([poedb](https://poedb.tw/us/Crusaders_Exalted_Orb): "Adds Crusader influence and a new Crusader modifier to a rare item"). Shaper's and Elder's versions were added in 3.26. *(Corrected 2026-11-21: an earlier draft said the item must already carry the influence.)* Details in F1.

## C3. Essences
* Mechanics ([poewiki Essence](https://www.poewiki.net/wiki/Essence)): on a **normal** item = Alchemy + one guaranteed mod; on a **rare** only tier >=5 (Screaming, Shrieking, Deafening) and the special tier-6/7/8 essences reforge like a Chaos Orb with the guaranteed mod. Cannot be used if the item has any outcome-affecting metamod (A1.4). All other mods are random as Chaos.
* Guaranteed mod: `essences.json[<essence id>].mods[<item class name>] = <mod id>` (class names like "Body Armour", "One Hand Sword", "Ring"; absent class = essence unusable on that class). That mod has `generation_type: essence`/`is_essence_only` in `mods.json`.
* Random-mod level cap: `essences.json[id].item_level_restriction` (35 Whispering, 45 Muttering, 60 Weeping, 75 Wailing; absent for tiers >=5) -> random mods use `min(item_level, restriction)`. Poewiki's "minimum required level of crafted item" per tier = 1/8/20/33/46/59/65 for tiers 1-7 (not in RePoE; UNVERIFIED vs data).
* RePoE `essences.json` has 107 entries (keys = item metadata ids, e.g. `CurrencyEssenceGreed7`): `level` = essence tier number 1-7 (Whispering..Deafening; 8 for the special ones), `type.tier` = essence *group* (1-5 ~ A-E, 6 = Desolation, 7 = Trickery; NOT the name tier), `type.is_corruption_only` true for Essence of Hysteria/Insanity/Horror/Delirium (obtained only by corrupting group-E essence monsters) and Trickery. `Remnant of Corruption` is a monolith item with no mods; Desolation has `item_level_restriction` 15 in RePoE (semantics unclear, UNVERIFIED). 3.30 added Essence of Trickery (belt only: "affected by Delirium Fog") and Essence of Desolation to the exchange; "Essences now have a base chance to spawn in Maps".
* Tier names: Whispering 1, Muttering 2, Weeping 3, Wailing 4, Screaming 5, Shrieking 6, Deafening 7; Harvest can convert an essence to another of the same tier (30 Primal per unit).
* Glyphic Fossil forces a corrupted-essence mod (`corrupted_essence_chance: 100`, allowed tags in fossils.json); Tangled gives 10%.

## C4. Fossils and resonators
* Resonators in 3.30: only **Chaotic** (Primitive 1 socket, Potent 2, Powerful 3, Prime 4; socket counts from the names, UNVERIFIED in wiki; Alchemical only in Ruthless). Act like a Chaos Orb (rare reroll, 4/5/6 counts) and like essences cannot be used on items with metamods (X in A1.4). Fossil count = sockets used (<= sockets).
* Weight model: for each candidate mod, for each socketed fossil, if any of the mod's tags (`mods.json[*].implicit_tags`, the Alt-tags) matches a fossil `positive_mod_weights[tag]`, multiplier = weight/100 (1000 -> x10, 600 -> x6); `negative_mod_weights[tag]` -> multiplier weight/100 (0 = block, 15 = x0.15). "Each fossil affects a mod once" even with several matching tags. Whether multipliers from different fossils stack additively or multiplicatively is **disputed (UNVERIFIED)**; engine flag `fossil_stack = "multiplicative"|"additive"` ([poewiki Fossil](https://www.poewiki.net/wiki/Fossil)).
* Fossil tag table (RePoE `fossils.json`, VERIFIED = RePoE; positives are weight/100): Scorched fire x10 / cold 0; Frigid cold x10 / fire 0; Metallic lightning x10 / physical 0; Jagged physical x10 / chaos 0; Aberrant chaos x10 / lightning 0; Pristine life x10 / defences 0; Dense defences x10 / life 0; Corroded bleed+poison x10 / elemental 0; Prismatic elemental x6 / bleed,poison 0; Aetheric caster x10 / attack x0.15; Serrated attack x10 / caster x0.15; Lucent mana x10 / speed 0; Shuddering speed x10 / mana 0; Bound minion,aura,curse x10; Opulent drop x10 (wiki: also blocks tagless mods; not in RePoE fields -> hand rule); Deft critical x10 / attribute 0; Fundamental attribute x10 / critical 0; Faceted gem x10 + `added_mods` (3 `Delve*GemLevel1` mods); Tangled: 11 `added_mods` (Vaal-themed delve mods) + random tag x30 and random blocked tag (revealed when resonator filled) - hand rule; Sanctified `rolls_lucky=true` + all mods x(1+0.01*(required_level-40)) (wiki formula, hand rule); Glyphic corrupted-essence mod; Hollow: `forced_mods` 1 (abyssal socket) restricted to weapon/helmet/boots/gloves/body_armour; Bloodstained: corrupted implicit, forbids heist items; Fractured: fractures one random mod (not on influenced/fractured); Gilded: sell-price implicit; names Enchanted = Deft, Encrusted = Fundamental, Perfect = Opulent, Resonating = Bound.
* `added_mods` / `forced_mods` reference `mods.json` ids (`domain: delve`); they enter the candidate pool with the fossil-weight multipliers applied.
* RePoE gaps: positives/negatives for Opulent "no tagless", Tangled random tags, Sanctified formula, fossil stacking rule, resonator socket counts.

## C5. Eldritch currency (Exarch / Eater) - [poewiki](https://www.poewiki.net/wiki/Eldritch_implicit), [Conflict](https://www.poewiki.net/wiki/Orb_of_Conflict)
* Items: body armour/helmet/gloves/boots only; not on influenced items; implicits replace existing implicits; two implicit slots (Exarch + Eater), each tiered Lesser, Greater, Grand, Exceptional, Exquisite (T5), Perfect (T6). Embers (Exarch) / Ichors (Eater) of Lesser/Greater/Grand/Exceptional tier apply the implicit; poe.ninja has them.
* **Dominance**: the side with the higher implicit tier is dominant; equal tiers = no dominance (Eldritch Chaos/Exalted/Annulment cannot be used).
* Eldritch Chaos (rare only): rerolls **prefixes** if Exarch dominant, **suffixes** if Eater dominant (others kept); since 3.17.2 the prefix/suffix counts are no longer preserved. Eldritch Exalted (rare): adds a prefix (Exarch) / suffix (Eater); 3.26.0d hotfix 3 allows it with Exarch dominance and full suffixes. Eldritch Annulment (**magic or rare**): removes a prefix (Exarch) / suffix (Eater); fractured mods cannot be removed. All are one-sided versions of Chaos/Exalt/Annul; metamod interplay in A1.4; count model in F5. Fractured items are allowed, synthesised items are not ([poedb](https://poedb.tw/us/Eldritch_Chaos_Orb)).
* Orb of Conflict: raises the tier of one implicit and lowers the other; with equal tiers 50%; each tier of difference shifts about +-11 points (5/3 item ~28% upgrade to 6/2). Only source of Exquisite/Perfect.
* RePoE: `generation_type` `eater_of_worlds_implicit` (2070 mods) / `searing_exarch_implicit` (2016), weights per item tag. Ember/Ichor tier->mod-tier mapping is not a RePoE field (hand table: Lesser=1 .. Exceptional=4, Conflict reaches 5-6).

## C6. Awakener's Orb, Dominance ("Maven's Orb"), Veiled, Fracturing, Hinekora, catalysts, recombinators
| Item | Rules (3.30) | Source |
|---|---|---|
| Awakener's Orb (poe.ninja 150c) | donor + target of same class, each with exactly **one** influence (different); donor destroyed; target becomes rare with both influences; one influenced mod from each item is kept (random if several; same mod group -> one dropped); everything else rerolled (forum: 2 kept + 2-4 new); keeps base, ilvl, sockets and links; **ignores metamods**; not on corrupted. See F2 | [poewiki](https://www.poewiki.net/wiki/Awakener%27s_Orb) |
| Orb of Dominance (ninja id `mavens-orb`, 481c) | body/boots/gloves/helmet magic or rare with >=2 influenced mods: upgrades one influenced mod one tier (T1 -> Elevated; Elevated -> reroll values) and removes another influenced mod; respects "cannot be changed"; maxroll: a 50/50 for the right mod with two influence mods. See F3 | [poewiki](https://www.poewiki.net/wiki/Orb_of_Dominance) |
| Veiled Chaos Orb (ninja 12.1c) | Chaos reroll with one random **veiled** mod; since 3.30.0b hotfix 4 usable on items that already have a veiled mod unless protected by fracture/metamod; RePoE domain `veiled` (22 mods) -> unveil choices in domain `unveiled` (311 mods) | [poewiki](https://www.poewiki.net/wiki/Veiled_Chaos_Orb) |
| Veiled Exalted Orb (ninja 708c) | removes one random mod, adds one veiled mod | poewiki |
| Unveiling (Jun/Aisling, Syndicate bench) | veiled mod -> choose among 3 random `unveiled` mods; Aisling T4 benches/Secrets Unveiled give more choices or two veiled mods; weights not in RePoE UNVERIFIED | poewiki Veiled modifier |
| Fracturing Orb (ninja 1334c; Shard 57c) | one random explicit mod on a rare with >=4 mods is fractured (selection uniform, UNVERIFIED), not on influenced/synthesised/fractured items, **ignores metamods**; allowed on Eldritch implicit items; 3.30 removed most drop sources | [poewiki](https://www.poewiki.net/wiki/Fracturing_Orb) |
| Hinekora's Lock (ninja 12 952c) | foreseeing: preview next currency outcome; preview identical for same currency type; any applied currency / bench / Harvest / beast / Recombinator removes the state; 3.30: Imprint and Mirror no longer count as modifying | [poewiki](https://www.poewiki.net/wiki/Hinekora%27s_Lock), notes |
| Catalysts | quality up to 20% increases the magnitude of mods with the catalyst tag (Abrasive attack, Imbued caster, Tempering defences, Fertile life/mana/ES ("resource"), Prismatic resistance, Intrinsic attribute, Noxious physical+chaos, Accelerating speed, Unstable critical, Turbulent elemental); since 3.15 they do **not** change mod roll odds; Dextral/Sinistral (3.30 on exchange) = suffix/prefix magnitudes (UNVERIFIED) | [poewiki Catalyst](https://www.poewiki.net/wiki/Catalyst), poedb |
| Recombinator (Kingsmarch; costs Gold + Thaumaturgic Dust) | 2 magic/rare items of same class; **3.30: output ilvl = ilvl of the chosen base (no averaging); cannot be used on corrupted items; only ONE "exclusive" mod (essence mods w/o tier, veiled, crafted, metacrafted, delve, beast aspects, Elevated, breach/incursion drop-only) survives per output**; output base picked 50/50; prefix and suffix counts rolled from pool size (table below); fill prefix or suffix side first 50/50; modifier pick weighted (formula unknown); same-group mods block | [poewiki](https://www.poewiki.net/wiki/Recombinator), [3.30 notes](https://patchbot.io/games/path-of-exile/articles/2188-content-update-3300-path-of-exile-covens-of-umbra) |
Recombinator count table (pre-3.30; 3.30 "1-3 mod pool results in fewer mods, table not republished" => pools of 1-3 UNVERIFIED): pool 4 -> 10% 1 / 60% 2 / 30% 3; pool 5 -> 43% 2 / 57% 3; pool 6 -> 30% 2 / 70% 3 (pools 4-6 unchanged by 3.30). Pre-3.30 for 1-3: pool1 41% 0 / 59% 1; pool2 66.7% 1 / 33.3% 2; pool3 40% 1 / 50% 2 / 10% 3. Predictable mode: user picks mods, success chance shown by game (formula unknown).

## C7. Other 3.30 changes that touch crafting (VERIFIED, official notes)
* Gwennen: gambling removed; pay 1 Astragali, pick one of 3 pairs of crafts (cost in Broken Circle Artifacts), a coin flip applies one of the two to a Rare equipment item (empty sockets required). Craft list not documented; treat as a non-deterministic bench, UNVERIFIED.
* Rog (Kingsmarch/Gwennen-adjacent deals): reroll prefixes/suffixes 1, 3 or 5 times keeping the best (was 3/6/10); upgrade deals rarer.
* Altar/Lapidary Lens: second corruption, can destroy; Djinn-Touched Vaal Orb = twice corrupted; Mirror/Eternal Orb no longer usable on "can be modified while corrupted".
* Item Tiers (act 6+): rare/magic drops roll Item Tier 2-5 improving modifier tier rating, bases, quality, sockets; tier-5 can drop Fractured Magic; most fractured drop sources removed (raises the value of Fracturing Orbs).
* Vendors/Gold: Scouring = 4 Fusing; Orb of Binding gone; Orb of Chance rarer. No crafting cost changes in 3.30.0b/c/d (verified from patch text); 3.30.0c/d add Fate rewards (extra Divines, Mirror Shard, Fracturing Orb, Hinekora's Lock).

---
# PART D - REPOE FIELD MAP AND HAND-MAINTAINED TABLES

## D1. Which file/field encodes what
| Method | RePoE source | fields |
|---|---|---|
| Natural rolling (all rarity ops) | `mods.json` + `base_items.json` + `tags.json` | `domain, generation_type, groups, required_level, spawn_weights[{tag,weight}], generation_weights, implicit_tags, adds_tags, is_essence_only, stats[{id,min,max}], text`; item side: `base_items[*].tags, item_class, drop_level, domain` |
| Essences | `essences.json` | `mods{class->mod id}, item_level_restriction, level, spawn_level_min, type{tier,is_corruption_only}, name` |
| Fossils / resonators | `fossils.json` | `positive_mod_weights, negative_mod_weights, added_mods, forced_mods, allowed_tags, forbidden_tags, corrupted_essence_chance, rolls_lucky, changes_quality, mirrors, rolls_white_sockets, sell_price_mods, descriptions` |
| Bench & metamods | `crafting_bench_options.json` | `actions{add_explicit_mod\|add_enchant_mod\|change_socket_count\|link_sockets\|color_sockets\|remove_crafted_mods\|remove_enchantments\|reroll_rarity\|reroll_rare_mods}, cost{currency metadata id: n}, item_classes, bench_tier, master`; the metamod mod ids resolve in `mods.json` (domain `crafted`) |
| Eldritch implicits | `mods.json` | `generation_type in {eater_of_worlds_implicit, searing_exarch_implicit}` |
| Veiled / unveil | `mods.json` | `domain veiled` (22), `unveiled` (311) |
| Delve fossil mods | `mods.json` | `domain delve` (177) |
| Abyss/cluster/flask | `mods.json` | domains `abyss_jewel`, `affliction_jewel`, `flask`, `jewel` |
| Item classes | `item_classes.json` | |

## D2. NOT in RePoE (engine needs a hand-maintained config)
| Data | Value / location in this spec |
|---|---|
| Rare mod-count weights | 4:5:6 = 8:3:1 (B2); jewel 3/4 ratio UNVERIFIED |
| Magic mod-count (Transmute/Alt) | 1 or 2; split UNVERIFIED (B2) |
| Affix caps per class | B1 |
| Essence tier names, min item level per tier, reforge-capable tiers | C3 |
| Resonator sockets and fossil stacking rule | C4 |
| Fossil special rules: Opulent tagless block, Tangled randoms, Sanctified formula, Fractured/Gilded/Hollow/Bloodstained/Glyphic behaviour | C4 |
| Harvest crafts, lifeforce costs, behaviour | A2 |
| Beastcrafts and beast requirements | A3 |
| Metamod interaction matrix, lock semantics | A1.4 |
| Eldritch ember/ichor -> tier, dominance, Conflict odds | C5 |
| Awakener/Dominance/Fracturing/Recombinator behaviours | C6, F2, F3, F6 |
| Influence tag per item class, influence-mod ownership, Elevated mod for each T1 influence mod | F1, F3 (compile_pool.py derives them; the Elevated link is partly heuristic) |
| Memory Strand cost per currency and tier breakpoints | F7 |
| Veiled unveil choice weights | UNVERIFIED |
| Vendor recipes (Scouring = 4 Fusing; Alt = 4 Aug; Transmute = 1 Aug; Chaos = 2 same-name rares; Exalt = 3) | C1 |
| Gold/Thaumaturgic Dust costs for Recombinator | not published |
| Bench recipe unlock state per user | user flag |

## D3. Currency metadata id -> name (for RePoE bench `cost` keys, VERIFIED unless noted)
CurrencyUpgradeToMagic=Orb of Transmutation; CurrencyAddModToMagic=Orb of Augmentation; CurrencyRerollMagic=Orb of Alteration; CurrencyUpgradeToRare=Orb of Alchemy; CurrencyUpgradeMagicToRare=Regal Orb; CurrencyRerollRare=Chaos Orb; CurrencyAddModToRare=Exalted Orb; CurrencyModValues=Divine Orb; CurrencyRerollImplicit=Blessed Orb; CurrencyRerollDefences=Sacred Orb (inferred, A1.3); CurrencyConvertToNormal=Orb of Scouring; CurrencyCorrupt=Vaal Orb; CurrencyRerollSocketNumbers=Jeweller's Orb; CurrencyRerollSocketLinks=Orb of Fusing; CurrencyRerollSocketColours=Chromatic Orb; CurrencyUpgradeRandomly=Orb of Chance; CurrencyFlaskQuality=Glassblower's Bauble; CurrencyArmourQuality=Armourer's Scrap; CurrencyGemQuality=Gemcutter's Prism; CurrencyInstillingOrb=Instilling Orb (UNVERIFIED names for quality items). poe.ninja ids: `transmute, aug, alt, alch, regal, chaos, exalted, divine, blessed, sacred-orb, scour, vaal, jewellers, fusing, chrome, chance, bauble, scrap, gcp, instilling-orb`.

---
# PART E - PRICING SOURCES

| Input | Best source (legit) | Notes |
|---|---|---|
| Currency, catalysts, influence exalts (Shaper's ... Warlord's), Eldritch/Veiled/Foulborn/Fracturing/Hinekora/Awakener/Dominance/Conflict, **lifeforce incl. Sacred + Rancour**, Sacred/Blessed/Exalted etc. | poe.ninja exchange `type=Currency` | 105 lines, units = chaos per 1; Divine 221.4c; snapshot 2026-11-20 |
| Essences | exchange `type=Essence` (104 lines) | all tiers incl. Deafening, Delirium/Horror/Hysteria/Insanity; Desolation 21.3c / Trickery 15.1c are on the Essence overview (`essence-of-desolation`, `essence-of-trickery`); Delirium 8.6c, Horror 12.2c, Hysteria 7.9c, Insanity 7.4c |
| Fossils | exchange `type=Fossil` (25 lines) | includes Sanctified, Tangled, Glyphic, Fractured, Gilded, Hollow, Bloodstained |
| Resonators | exchange `type=Resonator` (4 lines: only Chaotic: primitive 1.08c, potent 0.64c, powerful 2.48c, prime 402c) | prime anomalously high |
| Oils/fragments | exchange `type=Oil`, `type=Fragment` | not needed for item crafting |
| **Beasts** | `https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=Covens&type=Beast` (HTTP 200, 51 lines) | fields name, chaosValue, divineValue, listingCount; floor 1c; exchange endpoint returns empty for Beast |
| **Base items (ilvl-specific bases, influenced/fractured variants)** | `...stash/current/item/overview?league=Covens&type=BaseType` (200, 8 MB, 17 425 lines; `name, variant ("Shaper/Hunter"), levelRequired (ilvl), itemType, chaosValue, listingCount`) | large; cache; lacks mod-specific bases |
| Lifeforce | poe.ninja Currency lines (above); official exchange hourly digest has no lifeforce markets seen but contains `CurrencyDelveCrafting*` fossils and essences | |
| Bench costs | derive: RePoE `cost` x currency prices | no separate price |
| Harvest crafts | derive: A2.3 table x lifeforce prices (no market for crafts) | |
| Gold / Thaumaturgic Dust, Gwennen artifacts, Rog deals | none | treat as user-supplied constants |
| Unique/rare item sale values | official trade site | |

**Official sources and rules**
* **Currency Exchange digest (VERIFIED working, unauthenticated):** `GET https://web.poecdn.com/api/currency-exchange[/<hour unix ts>]` returns hourly aggregate per market per league (fields `league, market_id, market_pair, volume_traded, lowest/highest_stock, lowest/highest_ratio`); no data for the current hour; I tested hour 1795222800 with 1235 `Covens` markets using User-Agent `poe-craft-planner/0.1`. The brief's "/api/currency-exchange with service:cxapi scope" is **not in the current docs**: the documented endpoint is public (no scope) at web.poecdn.com; `https://www.pathofexile.com/api/currency-exchange` returns 401. ([developer docs](https://www.pathofexile.com/developer/docs/reference)). New OAuth application registrations are currently closed ("We are currently unable to process new applications").
* **User-Agent rule (docs):** must be `User-Agent: OAuth {clientId}/{version} (contact: {contact})` for OAuth apps; third-party tools should carry the "not affiliated with GGG" notice. Rate limits are dynamic: honour `X-Rate-Limit-*` headers and `Retry-After`; repeated violations revoke access ([docs](https://www.pathofexile.com/developer/docs)).
* **Trade website API** (`/api/trade/search/<league>` POST, `/api/trade/fetch/...`): not in the documented API; docs say reverse-engineering undocumented endpoints violates ToS 7i - policy status UNVERIFIED, use sparingly if at all. Observed headers on one search call: `X-Rate-Limit-Policy: trade-search-request-limit`, `X-Rate-Limit-Ip: 5:10:60,15:60:300,30:300:1800,600:21600:3600` (requests:period s:penalty s). Identifiable User-Agent mandatory.
* poe.ninja: unofficial but public; updates about hourly; send an identifying UA (`poe-craft-planner/0.1`); cache >= 1 h. League name `Covens` (HC: `Hardcore Covens`; SSF/Ruthless variants listed in `https://poe.ninja/poe1/api/data/index-state`).

---
# PART F - INFLUENCE, ELDRITCH, FRACTURED, MEMORY STRANDS (added 2026-11-21)

Sources: [poedb Shaper's Exalted Orb](https://poedb.tw/us/Shapers_Exalted_Orb), [Crusader's Exalted Orb](https://poedb.tw/us/Crusaders_Exalted_Orb), [Awakener's Orb](https://poedb.tw/us/Awakeners_Orb), [Orb of Dominance](https://poedb.tw/us/Orb_of_Dominance), [Eldritch Chaos](https://poedb.tw/us/Eldritch_Chaos_Orb) / [Exalted](https://poedb.tw/us/Eldritch_Exalted_Orb) / [Annulment](https://poedb.tw/us/Eldritch_Orb_of_Annulment), [Orb of Conflict](https://poedb.tw/us/Orb_of_Conflict), [Horticrafting](https://poedb.tw/us/Horticrafting), [Bestiary league](https://poedb.tw/us/Bestiary_league), [Memory Strands](https://poedb.tw/us/Memory_Strands), [maxroll double-influence](https://maxroll.gg/poe/crafting/double-influence-crafting), [maxroll Eldritch](https://maxroll.gg/poe/crafting/eldritch-crafting), [maxroll metacrafting](https://maxroll.gg/poe/crafting/metacrafting) (3.23-era), [maxroll crafting resources](https://maxroll.gg/poe/resources/crafting-resources), [forum thread 3155188](https://www.pathofexile.com/forum/view-thread/3155188), [Craft of Exile FAQ](https://www.craftofexile.com/faq). Older-patch sources are used where the mechanic has not changed since.

## F1. Influence mods and influence exalts
* Influences: Shaper, Elder, Crusader, Redeemer (tag `_eyrie`), Hunter (`_basilisk`), Warlord (`_adjudicator`). An item normally has at most one; two only through Awakener's Orb (F2). Engine bits: shaper 1, elder 2, crusader 4, redeemer 8, hunter 16, warlord 32.
* Mod data (RePoE 3.30.0.4, checked by script): influence mods have weight only with their influence tag; none spawns under two influences; adding an influence tag changes no plain mod's weight. Hubris Circlet ilvl 86 influence mods (prefix/suffix count, weight sums): Shaper 11/20 (5600/11100), Elder 21/12 (13200/8000), Crusader 4/8 (2000/4625), Redeemer 5/11 (1750/5250), Hunter 15/6 (7500/2750), Warlord 8/10 (3625/4750); plain pool 54275/69400.
* Influence Exalted Orbs (all six): rare item **with no influence** -> sets the influence and adds one mod of it (the usual Exalt draw restricted to that influence's mods). poe.ninja 2026-11-20: Shaper 70.1c, Hunter 63.0c, Warlord 46.6c, Crusader 26.2c, Redeemer 13.8c, Elder 13.3c. The ilvl gate is not documented (the mods themselves need about ilvl 68). Engine `exalt:<influence>`.
* Beastcraft B04 "Add a Mod to a <influence> Item": Shaper = Fenumal Devourer, Elder = Saqawine Blood Viper, Crusader = Farric Goliath, Redeemer = Fenumal Queen, Hunter = Craicic Watcher, Warlord = Fenumal Scrabbler (Craicic Maw also listed); about 4c each. Adds one mod of that influence to an item that already has it; rarity requirement unknown (engine: rare only). Engine `beast:influence:<influence>`.
* Harvest influence crafts: A2.4 (`harvest:influence`, `harvest:randomise_influence`). The 11 Harvest add/remove crafts say "from a non-Influenced item" (the engine refuses them on influenced items).
* Influenced items cannot take Eldritch implicits or a Fracturing Orb.

## F2. Awakener's Orb
* Donor and target: same item class, each with exactly one influence, different influences. The donor is destroyed (click order matters). The target keeps base, ilvl, sockets and links, and becomes rare with both influences.
* One influence mod is kept from each item (random if several; if the two share a mod group one is dropped at random); all other mods are rerolled. Forum: 2 kept + 2-4 new = 4-6 total. Ignores metamods; not usable on corrupted items. 150.6c.
* Engine `awaken:<donor influence>[:<donor mod id>]` (or `awaken:<mod id>`): enumerates the kept-mod states, then a keep-all reroll with total count `count.awaken` (default = count.rare). Without a mod id the donor's kept mod is uniform over that influence's mods. Refuses fractured targets (UNVERIFIED).

## F3. Orb of Dominance and Elevated mods
* Body armour, boots, gloves, helmets; magic or rare; needs >= 2 influence mods. Picks two at random: removes one, upgrades the other one tier (T1 -> Elevated; Elevated -> reroll values). Side locks protect (A1.4: R R I I). 480.9c.
* Elevated mods have weight 0 in RePoE (`...UberMaven` ids or "Elevated" names). `compile_pool.py` links each T1 influence mod to its Elevated version by same affix side and mod groups plus this class's influence tag (prefer a unique same-type candidate, else a single candidate). Hubris Circlet: 56 of 59 influence ladders linked; Two-Stone Ring: 1 of 50 (an unknown link means "no upgrade"). Engine `dominance`; target token `infl:<name|any>`; kind V in `find`.

## F4. Harvest more/less likely (corrected)
See A2.4: x90 (CoE) instead of the earlier 3.0 placeholder; "more likely" keeps the mod count. The engine now computes these exactly; they stay out of `rank` because consecutive tries depend on the previous item.

## F5. Eldritch currency, engine model
* Start tokens `exarch` / `eater` (dominant side) / `eldritch` (tied: no Eldritch Chaos/Exalt/Annul). Armour classes only; cannot be combined with an influence.
* Eldritch Chaos count model: total count drawn from count.rare as usual; the non-dominant side and fractured mods are kept and counted; new mods go only to the dominant side. This matches maxroll ("1-2 modifiers are added and sometimes 3"; with a fractured mod on the dominant side "usually none are added").
* Orb of Conflict: raises one implicit and lowers the other; equal tiers 50%, each tier of difference shifts the odds by about 11 points (C5). The engine draws the new dominance from `eldritch.conflict_outcomes` (default 50/50) and does not track implicit tiers.

## F6. Fractured mods, engine model
* Start token `frac:<mod id>`; fractured mods sit first, are never removed (Chaos, Scour, Annul, Harvest, Eldritch) and count toward the mod count and caps. Scouring an item with only fractured mods left gives a normal item that keeps them.
* `fracture` (Fracturing Orb, 1334c): rare with >= 4 mods, not influenced, no fractured mod yet; one non-crafted mod, chosen uniformly (UNVERIFIED), becomes fractured.

## F7. Memory Strands (not modelled)
* Items carry 0-100 strands. Currency consumes strands and uses them to raise the lowest tier it can roll. Orb of Remembrance (93.9c) randomises the count on normal items; Orb of Unravelling (10.6c) consumes them to upgrade tiers. In 3.30 the Originator Voidstone no longer adds strands.
* Strands used per use: Transmutation/Augmentation/Alteration 8; Regal/Exalted 16; Alchemy/Chaos/Binding/Chance 50; influence exalts 16; Awakener's 100; Tainted Chaos 60 / Exalted 16; Eldritch Chaos 60 / Exalted 16; Veiled Chaos 80; essences 80; Foulborn Augmentation 32 / Regal 48 / Exalted 28; Cyaxan's Ducat 80. Fossils and Harvest use none (maxroll: fossils/Harvest first, basic orbs last).
* Tiers still possible for a 13-tier mod (community findings): 0 strands 13; 1 -> 9; 2-9 -> 8; 10-21 -> 7; 22-37 -> 6; 38-61 -> 5; 62+ -> 4.
* Engine: every item is treated as strand-free. A future `strands` start token would apply the tier floor to every draw.

---
# PART G - TECHNIQUE CATALOGUE (maxroll; 3.23-3.30 era, mechanics unchanged unless noted)
How each maps onto the engine (`route` files chain steps; `eval` gives one-step odds).

| # | Technique | Steps and published odds | Engine |
|---|---|---|---|
| G1 | Essence first, metamods after | Essences refuse items with metamods, so build the essence side first, then lock. Elder RF helmet: Essence of Horror until a Burning Damage suffix (1/25); bench a mana prefix so Exalt can't hit it; Exalt for Concentrated Effect (1/22); after 2 misses lock suffixes + Scour; about 11 suffix locks (22 Divine at 3.23 prices; the full lock is now item-dependent, A1.3) | route: essence, bench, exalt, lockS + scour |
| G2 | Deterministic Exalt with Cannot-roll-Attack | Quiver: suffixes full incl. the metamod; only two non-attack prefixes exist, so every Exalt adds one of them | `exalt` on a start with `noattack` |
| G3 | Annul cycling under Cannot-roll-Attack | Used the metamod to shield attack mods from Annul. **Obsolete since 3.30**: Annul can now remove them (A1.4) | not applicable |
| G4 | Multimod finish | 3 good mods + "Can have up to 3 Crafted Modifiers" + 2 bench mods | `multi` + bench |
| G5 | Lock + Harvest add/remove (+2 physical amulet) | Prefix lock + Cannot-roll-Attack; Harvest "add physical, remove another": the removal can only hit a suffix or metamod, the add can only be +1 physical gems | `harvest:addremove:physical` with `lockP noattack` |
| G6 | Mod-group blocking | Bench a mod of an unwanted group so Exalt / Eldritch Exalt / Veiled can't roll it | bench step before the slam |
| G7 | Veiled Exalt behind a lock | 3 wanted + 1 junk on a side: lock, Veiled Exalt = 50% to keep the wanted mod; 2 open suffixes with multimod + prefix lock = 66% | not modelled (veiled pool) |
| G8 | 7-step meta recipe | 3 wanted mods (Harvest/fossil/essence/Awakener's) -> prefix lock -> Harvest reforge with a tag -> Veiled cycles -> block + unveil -> bench finish | route |
| G9 | Eldritch suffix craft (10 steps) | Essence suffix -> Veiled Exalt + suffix lock to 2 good suffixes -> Ember for Exarch dominance -> bench-block the heaviest prefix -> Eldritch Exalt, Eldritch Annul misses -> repeat -> unblock, final Eldritch Exalt -> bench last prefix | `eldritch:exalt`, `eldritch:annul`, bench, route |
| G10 | Awakener's + Dominance | Dominance each base until the wanted influence mod is Elevated (50/50 with two influence mods), then merge with Awakener's; then lock + Veiled / Harvest | `dominance`, `awaken:<infl>:<mod>` |
| G11 | Fossil combos | Bow: Corroded + Jagged + Metallic on ilvl 64+ -> +2 bow gems and +1 socketed gems, 1/8, about 1131c | `rank` (fossil combos) |
| G12 | Eldritch implicit climbing | Grand Ember/Ichor until the wanted implicit -> Exceptional on the other side -> Conflict -> repeat until Perfect. Desired implicit 3-5% with Lesser, 1-3% with Greater+ | not modelled (implicits) |

# SUMMARY OF UNVERIFIED ITEMS (checklist for the implementer)
1. Which mods a 1/2-slot lock protects when more exist (random per Exiled Bench; undocumented officially). 2. `more/less likely` Harvest multipliers. 3. Whether Chaos Orb keeps a prefix/suffix lock (assumed yes). 4. Jewel mod-count ratio, magic 1-vs-2 split. 5. Fossil multi-fossil stacking. 6. Recombinator 3.30 count table for pools 1-3. 7. Foulborn tier-block percentage. 8. Resist/damage swap lifeforce colour pairing. 9. Beast B01 metamod outcome distribution and whether 1/2 locks are included. 10. Sacred Orb = `CurrencyRerollDefences`. 11. Gwennen craft list. 12. Harvest "more likely" x90 (CoE) vs x10 (maxroll); "less likely" multiplier and its mod-count rule. 13. Awakener's Orb total mod count (engine: count.rare, kept mods included) and whether a fractured target is allowed (engine refuses). 14. Harvest randomise-influence distribution (uniform over same-size sets? may it keep the current set?). 15. Beast B04 rarity requirement (engine: rare only). 16. Orb of Conflict odds per tier gap (engine: flat `eldritch.conflict_outcomes`). 17. Eldritch Chaos new-mod count (engine model F5). 18. Elevated mod mapping for ladders with no unique same-type candidate (F3). 19. Fracturing Orb pick uniform over non-crafted mods. 20. Memory Strand breakpoints are community findings (F7).

**Sources blocked during the 2026-11-21 pass** (facts above come from mirrors instead): poewiki.net (Anubis bot challenge on every page tried), pathofexile.fandom.com (HTTP 402), poedb.tw/us/Beastcrafting (404).
