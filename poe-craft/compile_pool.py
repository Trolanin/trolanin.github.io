"""Compile the mod pool for one base item into a flat text file the C++ engine reads.

Usage:
  python compile_pool.py --base "Hubris Circlet" --ilvl 86 [--influence shaper ...] [--out FILE]

Reads data/repoe/{mods,base_items,item_classes,essences,fossils,crafting_bench_options}.json
(downloaded by fetch_data.py) and writes build/pools/<base>_<ilvl>[_<influences>].pool.
Standard library only.

Rules applied (see docs/mechanics.md for the game rules themselves):
  * base tags = base_items[base].tags (+ item_classes[class].influence_tags for each
    requested influence, e.g. helmet_shaper);
  * a mod is in the random pool when domain == "item", generation_type is prefix/suffix,
    not is_essence_only, required_level <= ilvl, and its spawn weight is > 0, where the
    spawn weight is the weight of the FIRST spawn_weights entry whose tag the base has
    (no match -> 0);
  * the spawn weight is multiplied by the first matching generation_weights entry / 100
    (no match -> x1);
  * tiers: within (mod type, affix side) the rollable mods are ranked by required_level
    descending (then by the first stat's max), tier 1 = best. Non-rollable mods that the file
    references (essence, fossil, bench) get the tier of the rollable ladder rung their first
    stat's max value would sit on ("equivalent tier"), so a target like
    "type:LocalEnergyShieldPercent<=2" can be met by an essence/bench mod too.

FILE FORMAT (UTF-8 text, one record per line, fields separated by TAB, '#' lines = comments).
Lists inside a field are comma-separated; an empty list is written as '-'.
  H base   <name> <item_class> <ilvl> <influences|->
  H tags   <tag,tag,...>
  M <idx> <mod_id> <P|S> <kind> <weight> <groups> <mod_tags> <type> <tier> <ntiers> <req_lvl> <meta> <text>
       idx    : 0-based, dense, = line order of M records
       kind   : R rollable explicit | E essence-only | D delve/fossil-only | C bench crafted | A beast aspect
       weight : effective random-roll weight on this base (0 for non-R kinds except D, where it is
                the weight the mod has when a fossil adds it to the pool)
       mod_tags: the mod's own tags (RePoE implicit_tags); fossils / harvest / metamods act on these
       meta   : '-' or a bench metamod effect: lockP lockS lockP1 lockP2 lockS1 lockS2 multi noattack nocaster
       text   : human-readable text, newlines replaced by ' / '
  E <essence_name> <mod_idx> <level> <max_mod_level>
       level         : essence tier 1-7 (Whispering..Deafening), 8 = special (Insanity, ...);
                       below 5 the essence only works on normal items (docs/mechanics.md C3)
       max_mod_level : item_level_restriction (35/45/60/75) capping the random mods' level, 0 = none
  F <fossil_name> <modelled 0|1> <weight_mods> <added_mod_idx> <forced_mod_idx> <note>
       weight_mods: tag=w,...  raw fossil weights, multiplier w / fossil.weight_scale (mechanics.cfg).
                    w >= scale are "more" tags, w < scale "less/no" tags. Each fossil affects a mod
                    once: a matching "less/no" tag wins, else the largest matching "more" tag.
                    Pseudo-tags: __tagless (matches mods without tags; Opulent's "no tagless"),
                    __sanctified (Sanctified: x(1 + 0.01*(required_level - 40)) per mod).
       modelled=0 means the fossil has an effect the engine does not simulate (see note)
  B <mod_idx> <cost>                    bench craft; cost = 'qty Name;qty Name' (currency names)
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPOE = ROOT / "data" / "repoe"

INFLUENCE_SUFFIX = {  # user-facing influence name -> suffix of the item-class influence tag
    "shaper": "_shaper", "elder": "_elder", "crusader": "_crusader",
    "redeemer": "_eyrie", "hunter": "_basilisk", "warlord": "_adjudicator",
}
META_GROUPS = {
    "ItemGenerationCannotChangePrefixes": "lockP",
    "ItemGenerationCannotChangeSuffixes": "lockS",
    "ItemGenerationCanHaveMultipleCraftedMods": "multi",
    "ItemGenerationCannotRollAttackAffixes": "noattack",
    "ItemGenerationCannotRollCasterAffixes": "nocaster",
}
# fossils whose effect is not (fully) simulated
UNMODELLED_FOSSIL = {
    "Glyphic Fossil": "corrupt essence mod not modelled",
    "Tangled Fossil": "random fossil outcome not modelled",
    "Fractured Fossil": "fractures a mod (pool unchanged, fracture not tracked)",
}
NOTE_FOSSIL = {
    "Sanctified Fossil": "weights x(1+0.01*(req_level-40)) (wiki formula); lucky values not tracked",
    "Opulent Fossil": "also blocks tagless mods (hand rule)",
    "Bloodstained Fossil": "adds corrupted implicit only (explicit pool unchanged)",
    "Gilded Fossil": "vendor price only (explicit pool unchanged)",
    "Hollow Fossil": "forces abyssal socket mod",
}


def load(name):
    with open(REPOE / f"{name}.json", encoding="utf-8") as f:
        return json.load(f)


def first_match(entries, tags, default):
    for e in entries:
        if e["tag"] in tags:
            return e["weight"]
    return default


def clean(s):
    return re.sub(r"\s+", " ", (s or "").replace("\r", "").replace("\n", " / ").replace("\t", " ")).strip() or "-"


def lst(xs):
    xs = [str(x) for x in xs]
    return ",".join(xs) if xs else "-"


def first_stat_max(mod):
    st = mod.get("stats") or []
    return st[0]["max"] if st else 0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base", required=True, help='base item name, e.g. "Hubris Circlet"')
    ap.add_argument("--ilvl", type=int, required=True)
    ap.add_argument("--influence", nargs="*", default=[], choices=sorted(INFLUENCE_SUFFIX))
    ap.add_argument("--out", help="output file (default build/pools/<base>_<ilvl>.pool)")
    a = ap.parse_args()

    mods, bases, classes = load("mods"), load("base_items"), load("item_classes")
    essences, fossils, bench = load("essences"), load("fossils"), load("crafting_bench_options")

    cands = [(k, v) for k, v in bases.items() if v.get("name") == a.base and v.get("domain") == "item"
             and v.get("release_state") == "released"]
    if not cands:
        cands = [(k, v) for k, v in bases.items() if v.get("name") == a.base]
    if not cands:
        raise SystemExit(f"base item not found: {a.base!r}")
    base_id, base = cands[0]
    item_class = base["item_class"]
    tags = set(base["tags"])
    for inf in a.influence:
        sfx = INFLUENCE_SUFFIX[inf]
        tags.update(t for t in classes.get(item_class, {}).get("influence_tags", []) if t.endswith(sfx))

    def spawn_weight(m):
        w = first_match(m["spawn_weights"], tags, 0)
        if w <= 0:
            return 0.0
        return w * first_match(m["generation_weights"], tags, 100) / 100.0

    # ---- rollable pool
    pool = {}
    for mid, m in mods.items():
        if (m["domain"] != "item" or m["generation_type"] not in ("prefix", "suffix")
                or m["is_essence_only"] or m["required_level"] > a.ilvl):
            continue
        w = spawn_weight(m)
        if w > 0:
            pool[mid] = w

    # ---- tiers
    ladders: dict[tuple, list] = {}
    for mid in pool:
        m = mods[mid]
        ladders.setdefault((m["type"], m["generation_type"]), []).append(mid)
    tier = {}
    for key, ids in ladders.items():
        ids.sort(key=lambda i: (-mods[i]["required_level"], -first_stat_max(mods[i])))
        for t, i in enumerate(ids, 1):
            tier[i] = (t, len(ids))

    def equiv_tier(mid):
        m = mods[mid]
        lad = ladders.get((m["type"], m["generation_type"]))
        if not lad:
            return (0, 0)
        v = first_stat_max(m)
        return (1 + sum(1 for i in lad if first_stat_max(mods[i]) > v), len(lad))

    records = []  # (mod_id, kind, weight)
    index = {}

    def add(mid, kind, weight):
        if mid in index:
            return index[mid]
        index[mid] = len(records)
        records.append((mid, kind, weight))
        return index[mid]

    for mid in sorted(pool, key=lambda i: (mods[i]["generation_type"], mods[i]["type"], tier[i][0])):
        add(mid, "R", pool[mid])

    # ---- essences
    ess_lines = []
    for eid, e in sorted(essences.items(), key=lambda kv: (kv[1]["name"])):
        mid = e["mods"].get(item_class)
        if not mid or mid not in mods:
            continue
        lim = e.get("item_level_restriction") or 0
        ess_lines.append((e["name"], add(mid, "E", 0), e.get("level", 0), lim if lim and lim < a.ilvl else 0))

    # ---- fossils
    fos_lines = []
    for fid, f in sorted(fossils.items(), key=lambda kv: kv[1]["name"]):
        name = f["name"]
        if not name:
            continue  # internal Tangled-fossil outcomes
        if f["allowed_tags"] and not tags.intersection(f["allowed_tags"]):
            continue
        if tags.intersection(f["forbidden_tags"]):
            continue
        wm = [f"{x['tag']}={x['weight']}" for x in f["positive_mod_weights"] + f["negative_mod_weights"]]
        if name == "Opulent Fossil":
            wm.append("__tagless=0")
        if name == "Sanctified Fossil":
            wm.append("__sanctified=100")
        added = []
        for mid in f["added_mods"]:
            m = mods.get(mid)
            if m and m["generation_type"] in ("prefix", "suffix") and m["required_level"] <= a.ilvl:
                w = spawn_weight(m)
                if w > 0:
                    added.append(add(mid, "D", w))
        forced = [add(mid, "D", spawn_weight(mods[mid])) for mid in f["forced_mods"] if mid in mods]
        modelled = 0 if (name in UNMODELLED_FOSSIL or f["mirrors"] or f["corrupted_essence_chance"]) else 1
        note = UNMODELLED_FOSSIL.get(name) or NOTE_FOSSIL.get(name) or "-"
        if name == "Tangled Fossil":
            modelled = 0
        fos_lines.append((name, modelled, lst(wm), lst(added), lst(forced), note))

    # ---- bench crafts (explicit mods only)
    def cname(cid):
        return bases.get(cid, {}).get("name") or cid.rsplit("/", 1)[-1]

    bench_lines = []
    for o in bench:
        mid = o["actions"].get("add_explicit_mod")
        if not mid or item_class not in o["item_classes"] or mid not in mods:
            continue
        m = mods[mid]
        if m["generation_type"] not in ("prefix", "suffix"):
            continue
        cost = ";".join(f"{q} {cname(c)}" for c, q in o["cost"].items()) or "-"
        bench_lines.append((add(mid, "C", 0), cost))

    # ---- beast aspects (occupy a suffix)
    for mid, m in mods.items():
        if mid.startswith("Grants") and mid.endswith("AspectCrafted") and m["domain"] == "item":
            add(mid, "A", 0)

    def meta_of(m):
        for g in m["groups"]:
            if g in META_GROUPS:
                eff = META_GROUPS[g]
                t = m.get("text") or ""
                if eff in ("lockP", "lockS") and t[:1] in "12":
                    eff += t[0]  # "1 Prefix Modifier cannot be changed" variants
                return eff
        return "-"

    out = Path(a.out) if a.out else ROOT / "build" / "pools" / (
        re.sub(r"[^A-Za-z0-9]+", "_", a.base).strip("_") + f"_{a.ilvl}"
        + "".join(f"_{i}" for i in a.influence) + ".pool")
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as fo:
        fo.write("# poe-craft pool v1 -- generated by compile_pool.py; format documented in compile_pool.py\n")
        fo.write(f"H\tbase\t{a.base}\t{item_class}\t{a.ilvl}\t{lst(a.influence)}\n")
        fo.write(f"H\ttags\t{lst(sorted(tags))}\n")
        for i, (mid, kind, w) in enumerate(records):
            m = mods[mid]
            t, nt = tier.get(mid) or equiv_tier(mid)
            side = "P" if m["generation_type"] == "prefix" else "S"
            fo.write("\t".join(["M", str(i), mid, side, kind, f"{w:g}", lst(m["groups"]),
                                lst(m["implicit_tags"]), m["type"] or "-", str(t), str(nt),
                                str(m["required_level"]), meta_of(m), clean(m.get("text"))]) + "\n")
        for name, idx, lvl, lim in ess_lines:
            fo.write(f"E\t{name}\t{idx}\t{lvl}\t{lim}\n")
        for rec in fos_lines:
            fo.write("F\t" + "\t".join(str(x) for x in rec) + "\n")
        for idx, cost in bench_lines:
            fo.write(f"B\t{idx}\t{cost}\n")
    nr = sum(1 for r in records if r[1] == "R")
    print(f"{out}: {nr} rollable mods ({sum(1 for r in records if r[1]=='R' and mods[r[0]]['generation_type']=='prefix')} prefixes), "
          f"{len(ess_lines)} essences, {len(fos_lines)} fossils, {len(bench_lines)} bench crafts; tags={sorted(tags)}")


if __name__ == "__main__":
    main()
