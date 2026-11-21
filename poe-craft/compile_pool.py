"""Compile the mod pool for one base item into a flat text file the C++ engine reads.

Usage:
  python compile_pool.py --base "Hubris Circlet" --ilvl 86 [--influence hunter ...] [--out FILE]

Reads data/repoe/{mods,base_items,item_classes,essences,fossils,crafting_bench_options}.json
(downloaded by fetch_data.py) and writes build/pools/<base>_<ilvl>[_<influences>].pool.
Standard library only.

Rules applied (see docs/mechanics.md for the game rules themselves):
  * base tags = base_items[base].tags;
  * a mod is in the random pool when domain == "item", generation_type is prefix/suffix,
    not is_essence_only, required_level <= ilvl, and its spawn weight is > 0, where the
    spawn weight is the weight of the FIRST spawn_weights entry whose tag the base has
    (no match -> 0);
  * the spawn weight is multiplied by the first matching generation_weights entry / 100
    (no match -> x1);
  * influence mods (docs F1): for every influence the item class can have (item_classes
    influence_tags, e.g. helmet_basilisk = Hunter), the mods whose weight is 0 on the plain base
    but > 0 with that influence tag added. They are always written (with their influence), so
    one pool serves plain and influenced items; the engine lets a mod roll only on an item that
    carries its influence. --influence only sets the influence start items get by default;
  * tiers: within (mod type, affix side, influence) the rollable mods are ranked by required_level
    descending (then by the first stat's max), tier 1 = best. Non-rollable mods that the file
    references (essence, fossil, bench) get the tier of the rollable ladder rung their first
    stat's max value would sit on ("equivalent tier"), so a target like
    "type:LocalEnergyShieldPercent<=2" can be met by an essence/bench mod too;
  * Orb of Dominance upgrades (docs F3): an influence mod's 'up' is the next better tier of its
    ladder; for tier 1 it is the Elevated mod (id ...UberMaven or name "Elevated ...", weight 0
    everywhere) with the same affix side and groups whose spawn tags name this item class's tag
    for the influence - only when exactly one such mod exists (preferring the same mod type).

FILE FORMAT v2 (UTF-8 text, one record per line, fields separated by TAB, '#' lines = comments).
Lists inside a field are comma-separated; an empty list is written as '-'.
  H base   <name> <item_class> <ilvl> <default start influences|->
  H tags   <tag,tag,...>
  H influences <influences the item class can have|->
  M <idx> <mod_id> <P|S> <kind> <weight> <groups> <mod_tags> <type> <tier> <ntiers> <req_lvl> <meta> <text> <infl> <up>
       idx    : 0-based, dense, = line order of M records
       kind   : R rollable explicit | E essence-only | D delve/fossil-only | C bench crafted | A beast aspect
                | V elevated (only made by the Orb of Dominance)
       weight : effective random-roll weight on this base (0 for non-R kinds except D, where it is
                the weight the mod has when a fossil adds it to the pool); for influence mods the
                weight with the influence tag added
       mod_tags: the mod's own tags (RePoE implicit_tags); fossils / harvest / metamods act on these
       meta   : '-' or a bench metamod effect: lockP lockS lockP1 lockP2 lockS1 lockS2 multi noattack nocaster
       text   : human-readable text, newlines replaced by ' / '
       infl   : '-' or the influences that let the mod roll (shaper elder crusader redeemer hunter warlord)
       up     : '-' or the mod id the Orb of Dominance upgrades this influence mod to
     (v1 files end after <text>; the engine reads both)
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
import difflib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPOE = ROOT / "data" / "repoe"

INFLUENCE_SUFFIX = {  # user-facing influence name -> suffix of the item-class influence tag (engine bit order)
    "shaper": "_shaper", "elder": "_elder", "crusader": "_crusader",
    "redeemer": "_eyrie", "hunter": "_basilisk", "warlord": "_adjudicator",
}
INFL_ORDER = list(INFLUENCE_SUFFIX)
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
    "Fractured Fossil": "fractures a mod (pool unchanged, fracture not tracked; use the fracture method)",
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


def find_base(bases, name):
    cands = [(k, v) for k, v in bases.items() if v.get("name") == name and v.get("domain") == "item"
             and v.get("release_state") == "released"]
    if not cands:
        cands = [(k, v) for k, v in bases.items() if v.get("name") == name]
    if cands:
        return cands[0]
    names = sorted({v["name"] for v in bases.values() if v.get("domain") == "item" and v.get("name")
                    and v.get("release_state") == "released"})
    low = name.lower()
    sugg = [n for n in names if n.lower() == low]
    sugg += difflib.get_close_matches(name, names, n=6, cutoff=0.6)
    sugg += [n for n in names if low and low in n.lower()][:6]
    sugg = list(dict.fromkeys(sugg))[:8]
    raise SystemExit(f"base item not found: {name!r}" + (f"\n  did you mean: {', '.join(sugg)}" if sugg else ""))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base", required=True, help='base item name, e.g. "Hubris Circlet"')
    ap.add_argument("--ilvl", type=int, required=True)
    ap.add_argument("--influence", nargs="*", default=[], choices=INFL_ORDER,
                    help="influence(s) start items carry by default (the pool always holds every influence's mods)")
    ap.add_argument("--out", help="output file (default build/pools/<base>_<ilvl>[_<influences>].pool)")
    a = ap.parse_args()

    mods, bases, classes = load("mods"), load("base_items"), load("item_classes")
    essences, fossils, bench = load("essences"), load("fossils"), load("crafting_bench_options")

    base_id, base = find_base(bases, a.base)
    item_class = base["item_class"]
    tags = set(base["tags"])
    class_itags = classes.get(item_class, {}).get("influence_tags") or []
    infl_tags = {inf: {t for t in class_itags if t.endswith(sfx)} for inf, sfx in INFLUENCE_SUFFIX.items()}
    infl_tags = {k: v for k, v in infl_tags.items() if v}
    for inf in a.influence:
        if inf not in infl_tags:
            raise SystemExit(f"{item_class} items cannot have {inf} influence")

    def spawn_weight(m, tg=tags):
        w = first_match(m["spawn_weights"], tg, 0)
        if w <= 0:
            return 0.0
        return w * first_match(m["generation_weights"], tg, 100) / 100.0

    # ---- rollable pool (plain + every influence)
    pool = {}   # mod id -> weight
    infl = {}   # influence mod id -> [influences]
    shifted = 0  # plain mods whose weight changes with an influence tag (not representable; reported)
    for mid, m in mods.items():
        if (m["domain"] != "item" or m["generation_type"] not in ("prefix", "suffix")
                or m["is_essence_only"] or m["required_level"] > a.ilvl):
            continue
        w = spawn_weight(m)
        if w > 0:
            pool[mid] = w
            shifted += any(spawn_weight(m, tags | it) != w for it in infl_tags.values())
            continue
        for inf, it in infl_tags.items():
            wi = spawn_weight(m, tags | it)
            if wi > 0:
                infl.setdefault(mid, []).append(inf)
                pool[mid] = max(pool.get(mid, 0.0), wi)

    def ikey(mid):
        return ",".join(infl.get(mid, []))

    # ---- tiers (ladders per type, side and influence)
    ladders: dict[tuple, list] = {}
    for mid in pool:
        m = mods[mid]
        ladders.setdefault((m["type"], m["generation_type"], ikey(mid)), []).append(mid)
    tier, up = {}, {}
    for key, ids in ladders.items():
        ids.sort(key=lambda i: (-mods[i]["required_level"], -first_stat_max(mods[i])))
        for t, i in enumerate(ids, 1):
            tier[i] = (t, len(ids))
            if key[2] and t > 1:
                up[i] = ids[t - 2]

    def equiv_tier(mid):
        m = mods[mid]
        lad = ladders.get((m["type"], m["generation_type"], ""))
        if not lad:
            lad = next((v for k, v in ladders.items() if k[:2] == (m["type"], m["generation_type"])), None)
        if not lad:
            return (0, 0)
        v = first_stat_max(m)
        return (1 + sum(1 for i in lad if first_stat_max(mods[i]) > v), len(lad))

    # ---- Elevated mods: tier-1 influence mod -> its Elevated version (Orb of Dominance)
    def class_infl(m):  # influences whose tag for THIS item class appears in the mod's spawn tags
        tg = {e["tag"] for e in m["spawn_weights"]}
        return {inf for inf, it in infl_tags.items() if tg & it}

    by_sig: dict[tuple, list] = {}
    for mid, m in mods.items():
        name = m.get("name") or ""
        if (m["domain"] == "item" and m["generation_type"] in ("prefix", "suffix")
                and (mid.endswith("UberMaven") or "Elevated" in name) and class_infl(m)):
            by_sig.setdefault((m["generation_type"], tuple(m["groups"])), []).append(mid)
    elevated = {}  # elevated mod id -> influences
    linked = unmapped = 0
    for key, ids in ladders.items():
        if not key[2]:
            continue
        t1 = mods[ids[0]]
        mine = set(infl[ids[0]])
        cands = [e for e in by_sig.get((t1["generation_type"], tuple(t1["groups"])), []) if class_infl(mods[e]) & mine]
        same = [e for e in cands if mods[e]["type"] == t1["type"]]
        pick = same if len(same) == 1 else cands if len(cands) == 1 else []
        if pick:
            up[ids[0]] = pick[0]
            elevated[pick[0]] = sorted(class_infl(mods[pick[0]]) & mine, key=INFL_ORDER.index)
            linked += 1
        else:
            unmapped += 1

    records = []  # (mod_id, kind, weight)
    index = {}

    def add(mid, kind, weight):
        if mid in index:
            return index[mid]
        index[mid] = len(records)
        records.append((mid, kind, weight))
        return index[mid]

    for mid in sorted(pool, key=lambda i: (ikey(i) != "", ikey(i), mods[i]["generation_type"], mods[i]["type"], tier[i][0])):
        add(mid, "R", pool[mid])
    for mid in sorted(elevated):
        add(mid, "V", 0)

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
        fo.write("# poe-craft pool v2 -- generated by compile_pool.py; format documented in compile_pool.py\n")
        fo.write(f"H\tbase\t{a.base}\t{item_class}\t{a.ilvl}\t{lst(a.influence)}\n")
        fo.write(f"H\ttags\t{lst(sorted(tags))}\n")
        fo.write(f"H\tinfluences\t{lst(sorted(infl_tags, key=INFL_ORDER.index))}\n")
        for i, (mid, kind, w) in enumerate(records):
            m = mods[mid]
            t, nt = (0, 0) if kind == "V" else (tier.get(mid) or equiv_tier(mid))
            side = "P" if m["generation_type"] == "prefix" else "S"
            minf = elevated.get(mid, []) if kind == "V" else infl.get(mid, []) if kind == "R" else []
            fo.write("\t".join(["M", str(i), mid, side, kind, f"{w:g}", lst(m["groups"]),
                                lst(m["implicit_tags"]), m["type"] or "-", str(t), str(nt),
                                str(m["required_level"]), meta_of(m), clean(m.get("text")),
                                lst(minf), up.get(mid, "-") if kind == "R" else "-"]) + "\n")
        for name, idx, lvl, lim in ess_lines:
            fo.write(f"E\t{name}\t{idx}\t{lvl}\t{lim}\n")
        for rec in fos_lines:
            fo.write("F\t" + "\t".join(str(x) for x in rec) + "\n")
        for idx, cost in bench_lines:
            fo.write(f"B\t{idx}\t{cost}\n")
    plain = [r for r in records if r[1] == "R" and r[0] not in infl]
    per = {inf: sum(1 for mid in infl if inf in infl[mid]) for inf in infl_tags}
    print(f"{out}: {len(plain)} rollable mods ({sum(1 for r in plain if mods[r[0]]['generation_type'] == 'prefix')} prefixes), "
          f"{len(ess_lines)} essences, {len(fos_lines)} fossils, {len(bench_lines)} bench crafts; tags={sorted(tags)}")
    if infl_tags:
        print("  influence mods: " + ", ".join(f"{k} {v}" for k, v in per.items())
              + f"; Elevated mod known for {linked} of {linked + unmapped} influence ladders"
              + (f"; default start influence: {', '.join(a.influence)}" if a.influence else ""))
    if shifted:
        print(f"  warning: {shifted} plain mods change weight on influenced items (not modelled)")


if __name__ == "__main__":
    main()
