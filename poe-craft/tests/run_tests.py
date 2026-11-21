"""poe-craft engine tests.  Usage:  python tests/run_tests.py [--real] [--exe build/poecraft.exe]

1. Hand-made pools with analytically known probabilities. Each case runs
   `poecraft eval --expect P`, which fails (exit 1) unless the Monte-Carlo estimate is within
   5 sigma of P AND the exact calculation (when the method has one) equals P.
2. --real: the real-data run (needs fetch_data.py data): compiles the Hubris Circlet ilvl 86
   pool, flattens prices, cross-checks chaos odds, ranks single-method strategies for a
   T1/T2 %ES prefix and simulates the metacraft routes in tests/real/.
Standard library only.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from fractions import Fraction as Fr
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "build" / "tests"

# mod: (id, side P/S, kind R/E/D/C/A/V, weight, groups, tags, meta, influence, dominance upgrade, type, tier)
def M(i, side, w=1, groups=None, tags="-", kind="R", meta="-", infl="-", up="-", typ=None, tier=1):
    return (i, side, kind, w, groups or "G_" + i, tags, meta, infl, up, typ or i, tier)

POOLS = {
    "two": [M("A", "P"), M("B", "P")],
    "grp": [M("A1", "P", 1, "G"), M("A2", "P", 1, "G"), M("B", "P", 2, "H")],
    "caps": [M("P1", "P", 3), M("P2", "P", 1), M("S1", "S", 1), M("S2", "S", 3)],
    "six": [M(f"P{i}", "P") for i in (1, 2, 3)] + [M(f"S{i}", "S") for i in (1, 2, 3)],
    "ess": [M("A", "P", 1, "G"), M("B", "P", 1, "H"), M("S", "S", 1, "K"), M("E1", "P", 0, "G", kind="E"),
            M("LOCK", "S", 0, "LockGroup", kind="C", meta="lockP")],
    "fos": [M("A", "P", 1, tags="fire"), M("B", "P", 1, tags="cold"), M("C", "P", 1, tags="fire,cold")],
    "lock": [M("P1", "P"), M("P2", "P"), M("S1", "S"), M("S2", "S"),
             M("LOCK", "S", 0, "LockGroup", kind="C", meta="lockP"),
             M("NOATK", "S", 0, "NoAtkGroup", kind="C", meta="noattack")],
    "harv": [M("A", "P", 1, tags="fire"), M("B", "P", 9), M("S", "S", 10)],
    "alt": [M("P1", "P"), M("P2", "P"), M("S1", "S", 2)],
    "atk": [M("A", "P", 1, tags="attack"), M("B", "P"),
            M("NOATK", "S", 0, "NoAtkGroup", kind="C", meta="noattack")],
    # influence: SA rolls only on Shaper items, HA only on Hunter items
    "inf": [M("A", "P", 1, tags="fire"), M("B", "P"), M("SA", "P", 2, infl="shaper"), M("HA", "P", 1, infl="hunter"),
            M("S", "S")],
    "awk": [M("SA", "P", 1, "G", infl="shaper"), M("HA", "P", 1, "G", infl="hunter"), M("A", "P"), M("S", "S")],
    "eld": [M(f"P{i}", "P") for i in (1, 2, 3, 4)] + [M("S1", "S"), M("S2", "S")],
    "harv2": [M("A", "P"), M("B", "P"), M("C", "P"), M("S", "S")],
    # Orb of Dominance ladder: SA2 (T2) -> SA1 (T1) -> SAE (Elevated)
    "dom": [M("SA1", "P", 1, "GSA", infl="shaper", up="SAE", typ="ST", tier=1),
            M("SA2", "P", 1, "GSA", infl="shaper", up="SA1", typ="ST", tier=2),
            M("HB", "S", 1, infl="hunter"), M("S", "S"),
            M("SAE", "P", 0, "GSA", kind="V", infl="shaper", typ="STE", tier=0)],
}
EXTRA = {
    "ess": ["E\tTest Essence\t3", "E\tLow Essence\t3\t2\t45"],
    "fos": ["F\tFire Fossil\t1\tfire=1000\t-\t-\t-", "F\tNocold Fossil\t1\tcold=0\t-\t-\t-",
            "F\tCold Fossil\t1\tcold=1000\t-\t-\t-", "F\tBoth Fossil\t1\tfire=1000,cold=1000\t-\t-\t-",
            "F\tMixed Fossil\t1\tfire=1000,cold=0\t-\t-\t-"],
    "lock": ["B\t4\t1 Divine Orb", "B\t5\t1 Divine Orb"],
    "atk": ["B\t2\t1 Divine Orb"],
}

C1 = "count.rare=1:1"
C2 = "count.rare=2:1"
HARV = "harvest.same_type_more_mult=90;harvest.same_type_less_mult=0.011111111111111112;harvest.more_keeps_count=1"
CONF = "eldritch.conflict_outcomes=exarch:1 eater:1"
# (name, pool, target lines, method, start, cfg overrides, expected probability, why)
CASES = [
    ("exalt: 2 equal prefixes", "two", ["need 1 mod:A"], "exalt", "rare", "", Fr(1, 2), "1/2"),
    ("group exclusivity: A1 via either order", "grp", ["need 1 mod:A1"], "chaos", "rare", C2, Fr(1, 2),
     "1/4 + 1/2*1/2"),
    ("group exclusivity: A1 and A2 never together", "grp", ["need 2 mod:A1 mod:A2"], "chaos", "rare", C2, Fr(0), "same group"),
    ("group exclusivity: B always", "grp", ["need 1 mod:B"], "chaos", "rare", C2, Fr(1), "after an A only B fits"),
    ("side caps 1/1", "caps", ["need 2 mod:P1 mod:S1"], "chaos", "rare", "cap.rare=1 1;" + C2, Fr(3, 16),
     "3/8*1/4 + 1/8*3/4"),
    ("mod count 4/5/6 = 8/3/1: six mods", "six", ["need 6 P1 P2 P3 S1 S2 S3"], "chaos", "rare", "", Fr(1, 12), "1/12"),
    ("mod count 4/5/6 = 8/3/1: >=5 mods", "six", ["need 5 P1 P2 P3 S1 S2 S3"], "chaos", "rare", "", Fr(4, 12), "4/12"),
    ("alchemy = same distribution", "six", ["need 5 P1 P2 P3 S1 S2 S3"], "alch", "normal", "", Fr(4, 12), "4/12"),
    ("essence: forced mod blocks its group", "ess", ["need 1 mod:A"], "essence:Test_Essence", "normal",
     C2 + ";price.Test Essence=1", Fr(0), "A shares E1's group"),
    ("essence: forced + 1 random", "ess", ["need 1 mod:B"], "essence:Test_Essence", "normal", C2 + ";price.Test Essence=1",
     Fr(1, 2), "B or S"),
    ("fossil x10", "fos", ["need 1 mod:A"], "fossil:fire", "normal", "count.rare=1:1", Fr(10, 21), "10/(10+1+10)"),
    ("fossil x10 * x0", "fos", ["need 1 mod:A"], "fossil:fire+nocold", "normal", "count.rare=1:1", Fr(1), "C = 10*0"),
    ("fossil x10 * x10 multiplicative", "fos", ["need 1 mod:C"], "fossil:fire+cold", "normal", "count.rare=1:1",
     Fr(100, 120), "100/(10+10+100)"),
    ("fossil additive stacking", "fos", ["need 1 mod:C"], "fossil:fire+cold", "normal",
     "count.rare=1:1;fossil.stack=additive", Fr(19, 39), "19/(10+10+19)"),
    ("fossil affects a mod once", "fos", ["need 1 mod:C"], "fossil:both", "normal", "count.rare=1:1", Fr(1, 3),
     "10/(10+10+10)"),
    ("fossil: less/no tag wins", "fos", ["need 1 mod:A"], "fossil:mixed", "normal", "count.rare=1:1", Fr(1),
     "A x10, B x0, C x0"),
    ("prefix lock + chaos keeps P1, 1 new mod", "lock", ["need 2 mod:P1 mod:S1"], "chaos", "rare mod:P1 lockP",
     C2 + ";reroll.min_new=1", Fr(1, 3), "kept 2 + min 1 new from P2/S1/S2"),
    ("prefix lock + chaos, N <= kept: nothing new", "lock", ["need 1 mod:S1"], "chaos", "rare mod:P1 lockP", C2,
     Fr(0), "min_new 0 (doc model)"),
    ("prefix lock + chaos, N = 3: one new", "lock", ["need 1 mod:S1"], "chaos", "rare mod:P1 lockP",
     "count.rare=3:1", Fr(1, 3), "P2/S1/S2"),
    ("prefix lock survives chaos (cfg)", "lock", ["need 1 mod:LOCK"], "chaos", "rare mod:P1 lockP", C2, Fr(1), "flag on"),
    ("prefix lock removed by chaos (cfg off)", "lock", ["need 1 mod:LOCK"], "chaos", "rare mod:P1 lockP",
     C2 + ";meta.lock_survives_chaos=0", Fr(0), "flag off"),
    ("annul under prefix lock: suffix side only", "lock", ["need 1 mod:S1"], "annul", "rare mod:P1 mod:S1 lockP", "",
     Fr(1, 2), "S1 or the lock"),
    ("annul under prefix lock: prefix safe", "lock", ["need 1 mod:P1"], "annul", "rare mod:P1 mod:S1 lockP", "", Fr(1), ""),
    ("scour under prefix lock keeps prefixes", "lock", ["need 1 mod:P1"], "scour", "rare mod:P1 mod:S1 lockP", "", Fr(1), ""),
    ("scour under prefix lock wipes suffixes+lock", "lock", ["need 1 mod:S1 mod:LOCK"], "scour", "rare mod:P1 mod:S1 lockP", "",
     Fr(0), ""),
    ("bench lockprefix then chaos", "lock", ["need 2 mod:P1 mod:S1"], "lockprefix,chaos", "rare mod:P1 mod:S2", "count.rare=3:1",
     Fr(1, 3), "sequence method"),
    ("harvest reforge incl. fire", "harv", ["need 1 mod:A"], "harvest:tag:fire", "rare",
     "count.rare=1:1;cost.harvest.tag.fire=1", Fr(1), "first mod from fire pool"),
    ("harvest reforge incl. fire, 2 mods", "harv", ["need 2 mod:A mod:S"], "harvest:tag:fire", "rare",
     C2 + ";cost.harvest.tag.fire=1", Fr(10, 19), "then S 10/(9+10)"),
    ("alteration 1-2 mods, magic caps", "alt", ["need 1 mod:P1"], "alt", "magic", "", Fr(3, 8), "(1/4 + 1/2)/2"),
    ("noattack metamod blocks exalt", "atk", ["need 1 mod:A"], "exalt", "rare noattack", "", Fr(0), ""),
    ("noattack metamod: B certain", "atk", ["need 1 mod:B"], "exalt", "rare noattack", "", Fr(1), ""),
    ("beast add prefix remove suffix", "lock", ["need 1 mod:S1"], "beast:prefix_remove_suffix", "rare mod:P1 mod:S1 mod:S2",
     "cost.beast.prefix_remove_suffix=3", Fr(1, 2), "removes S1 or S2"),
    ("beast add prefix remove suffix: adds P2", "lock", ["need 1 mod:P2"], "beast:prefix_remove_suffix",
     "rare mod:P1 mod:S1 mod:S2", "cost.beast.prefix_remove_suffix=3", Fr(1), "only free prefix"),
    # ---- influence (docs F)
    ("influence mods need the influence", "inf", ["need 1 mod:SA"], "exalt", "rare", "", Fr(0), "plain item"),
    ("chaos on a Shaper item", "inf", ["need 1 mod:SA"], "chaos", "rare shaper", C1, Fr(2, 5), "2/(1+1+2+1)"),
    ("target token infl:shaper", "inf", ["need 1 infl:shaper"], "chaos", "rare shaper", C1, Fr(2, 5), "= SA"),
    ("target token text:", "inf", ["need 1 text:sa"], "chaos", "rare shaper", C1, Fr(2, 5), "= SA"),
    ("Shaper's Exalted Orb", "inf", ["need 1 mod:SA"], "exalt:shaper", "rare", "", Fr(1), "only Shaper mod"),
    ("harvest influence reforge", "inf", ["need 1 mod:HA"], "harvest:influence", "rare hunter", C2, Fr(1), "first mod"),
    ("Awakener's Orb keeps both influence mods", "inf", ["need 2 mod:HA mod:SA"], "awaken:HA", "rare shaper mod:SA mod:S",
     "", Fr(1), "SA + donor HA"),
    ("Awakener's Orb: same group, one dropped", "awk", ["need 1 mod:SA"], "awaken:HA", "rare shaper mod:SA",
     "count.awaken=1:1", Fr(1, 2), "SA or HA"),
    ("harvest randomise influence", "inf", ["need 1 mod:SA"], "harvest:randomise_influence", "rare hunter", C1,
     Fr(1, 15), "1/6 Shaper * 2/5"),
    ("beast: add a mod to a Shaper item", "inf", ["need 1 mod:SA"], "beast:influence:shaper", "rare shaper", "", Fr(1), ""),
    # ---- Eldritch (docs C5)
    ("Eldritch Exalted, Exarch: a prefix", "eld", ["need 1 mod:P1"], "eldritch:exalt", "rare exarch mod:S1", "",
     Fr(1, 4), "1 of 4 prefixes"),
    ("Eldritch Chaos, Exarch: new prefixes only", "eld", ["need 1 mod:P1"], "eldritch:chaos",
     "rare exarch mod:P1 mod:S1 mod:S2", "count.rare=4:1", Fr(1, 2), "2 of 4 prefixes"),
    ("Eldritch Annulment, Eater: a suffix", "eld", ["need 1 mod:S1"], "eldritch:annul", "rare eater mod:P1 mod:S1 mod:S2",
     "", Fr(1, 2), "S1 or S2"),
    ("Eldritch Annulment, Eater: prefix safe", "eld", ["need 1 mod:P1"], "eldritch:annul",
     "rare eater mod:P1 mod:S1 mod:S2", "", Fr(1), ""),
    ("Orb of Conflict then Eldritch Exalted: S2", "eld", ["need 1 mod:S2"], "conflict,eldritch:exalt", "rare exarch mod:S1",
     CONF, Fr(1, 2), "Eater 1/2"),
    ("Orb of Conflict then Eldritch Exalted: P1", "eld", ["need 1 mod:P1"], "conflict,eldritch:exalt", "rare exarch mod:S1",
     CONF, Fr(1, 8), "Exarch 1/2 * 1/4"),
    # ---- fractured mods
    ("fractured mod survives chaos", "six", ["need 1 mod:P1"], "chaos", "rare frac:P1", C1, Fr(1), ""),
    ("fractured mod counts toward the mod count", "six", ["need 1 mod:S1"], "chaos", "rare frac:P1", C1, Fr(0), "1 total"),
    ("fractured + 1 new mod", "six", ["need 1 mod:S1"], "chaos", "rare frac:P1", C2, Fr(1, 5), "1 of P2 P3 S1 S2 S3"),
    ("annul never removes a fractured mod", "six", ["need 1 mod:P1"], "annul", "rare frac:P1 mod:S1", "", Fr(1), ""),
    ("Fracturing Orb picks 1 of 4, scour keeps it", "six", ["need 1 mod:P1"], "fracture,scour",
     "rare mod:P1 mod:P2 mod:S1 mod:S2", "", Fr(1, 4), "uniform"),
    ("fractured mod survives scour + alch", "six", ["need 1 mod:P1"], "scour,alch", "rare frac:P1 mod:S1", C1, Fr(1), ""),
    # ---- harvest more/less likely (exact now: static x90 boost of the old item's groups)
    ("harvest more likely: x90", "harv2", ["need 1 mod:A"], "harvest:more", "rare mod:A", C1 + ";" + HARV, Fr(30, 31),
     "90/(90+3)"),
    ("harvest less likely: /90", "harv2", ["need 1 mod:A"], "harvest:less", "rare mod:A", C1 + ";" + HARV, Fr(1, 271),
     "(1/90)/(1/90+3)"),
    ("harvest more likely keeps the mod count", "harv2", ["need 4 mod:A mod:B mod:C mod:S"], "harvest:more",
     "rare mod:A mod:B mod:C mod:S", C1 + ";" + HARV, Fr(1), "4 before -> 4 after"),
    # ---- Orb of Dominance (docs F3)
    ("Orb of Dominance: T2 -> T1", "dom", ["need 1 mod:SA1"], "dominance", "rare shaper hunter mod:SA2 mod:HB", "",
     Fr(1, 2), "upgrade SA2, remove HB"),
    ("Orb of Dominance: T1 -> Elevated", "dom", ["need 1 mod:SAE"], "dominance", "rare shaper hunter mod:SA1 mod:HB", "",
     Fr(1, 2), ""),
]
# methods that must be refused (rc 2) or accepted (rc 0) on a start item: (what, pool, method, start, cfg, rc)
APPLICABLE = [
    ("Shaper's Exalted Orb on a Hunter item", "inf", "exalt:shaper", "rare hunter", "", 2),
    ("harvest add/remove on an influenced item", "inf", "harvest:addremove:fire", "rare hunter mod:A", "", 2),
    ("harvest add/remove on a plain item", "inf", "harvest:addremove:fire", "rare mod:B", "", 0),
    ("beast Shaper craft on a plain item", "inf", "beast:influence:shaper", "rare", "", 2),
    ("Fracturing Orb on an influenced item", "inf", "fracture", "rare hunter mod:A mod:B mod:HA mod:S", "", 2),
    ("Awakener's Orb with a same-influence donor", "inf", "awaken:HA", "rare hunter mod:HA", "", 2),
    ("Eldritch Chaos without dominance", "eld", "eldritch:chaos", "rare mod:P1", "", 2),
    ("Eldritch Exalted with tied implicits", "eld", "eldritch:exalt", "rare eldritch mod:P1", "", 2),
    ("Orb of Dominance with one influence mod", "dom", "dominance", "rare shaper mod:SA1", "", 2),
]


def write_pool(name):
    p = WORK / f"{name}.pool"
    lines = ["# test pool", f"H\tbase\tTest {name}\tHelmet\t86\t-", "H\ttags\tdefault",
             "H\tinfluences\tshaper,elder,crusader,redeemer,hunter,warlord"]
    for i, (mid, side, kind, w, groups, tags, meta, infl, up, typ, tier) in enumerate(POOLS[name]):
        lines.append("\t".join(["M", str(i), mid, side, kind, str(w), groups, tags, typ, str(tier), "1", "1", meta, mid,
                                infl, up]))
    lines += EXTRA.get(name, [])
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return p


def run(exe, args):
    r = subprocess.run([str(exe)] + args, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def unit(exe, samples):
    WORK.mkdir(parents=True, exist_ok=True)
    pools = {n: write_pool(n) for n in POOLS}
    fails = 0
    n = 0
    for i, (name, pool, tgt, meth, start, sets, exp, why) in enumerate(CASES):
        n += 1
        tf = WORK / f"case{i}.target"
        tf.write_text("\n".join(tgt) + "\n", encoding="utf-8")
        args = ["eval", "--pool", str(pools[pool]), "--target", str(tf), "--method", meth, "--start", start,
                "--samples", str(samples), "--expect", f"{float(exp):.12f}", "--seed", str(1000 + i)]
        if sets:
            args += ["--set", sets]
        rc, out = run(exe, args)
        pm = next((l.split()[1] for l in out.splitlines() if l.startswith("p_mc")), "?")
        pe = next((l.split()[1] for l in out.splitlines() if l.startswith("p_exact")), "?")
        ok = rc == 0 and pe not in ("n/a", "?")  # every case here has an exact calculation
        fails += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {name:46} expect {float(exp):.6f} ({why or exp})  exact {pe:10}  mc {pm}")
        if not ok:
            print("      " + out.replace("\n", "\n      "))
    for what, pool, meth, start, sets, want in APPLICABLE:
        tf = WORK / f"app_{pool}.target"
        tf.write_text(f"need 1 mod:{POOLS[pool][0][0]}\n", encoding="utf-8")
        args = ["eval", "--pool", str(pools[pool]), "--target", str(tf), "--method", meth, "--start", start,
                "--samples", "20000"] + (["--set", sets] if sets else [])
        rc, out = run(exe, args)
        n += 1
        ok = rc == want
        fails += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {what}: {'applies' if want == 0 else 'refused'}")
        if not ok:
            print("      " + out.replace("\n", "\n      "))
    # essences / fossils refuse items with an outcome-affecting metamod (docs A1.4 note 1)
    for start, want in (("rare mod:B", 0), ("rare mod:B lockP", 2)):
        rc, out = run(exe, ["eval", "--pool", str(pools["ess"]), "--target", str(WORK / "case9.target"), "--method",
                            "essence:Test_Essence", "--start", start, "--samples", "1000", "--set", "price.Test Essence=1"])
        n += 1
        ok = rc == want
        fails += not ok
        print(f"{'PASS' if ok else 'FAIL'}  essence on '{start}': {'applies' if want == 0 else 'refused (metamod)'}")
    # essences below tier 5 work only on normal items (docs C3)
    for start, want in (("normal", 0), ("rare mod:B", 2)):
        rc, out = run(exe, ["eval", "--pool", str(pools["ess"]), "--target", str(WORK / "case9.target"), "--method",
                            "essence:Low_Essence", "--start", start, "--samples", "1000", "--set", "price.Low Essence=1"])
        n += 1
        ok = rc == want
        fails += not ok
        print(f"{'PASS' if ok else 'FAIL'}  tier-2 essence on '{start}': {'applies' if want == 0 else 'refused (rare)'}")
    return n, fails


def real(exe, samples):
    py = sys.executable
    print("\n== real run: Hubris Circlet ilvl 86 ==")
    for cmd in ([py, "-I", str(ROOT / "compile_pool.py"), "--base", "Hubris Circlet", "--ilvl", "86"],
                [py, "-I", str(ROOT / "prices.py")]):
        r = subprocess.run(cmd, capture_output=True, text=True)
        print(r.stdout.strip() or r.stderr.strip())
        if r.returncode:
            return 1
    pool = str(ROOT / "build" / "pools" / "Hubris_Circlet_86.pool")
    rd = ROOT / "tests" / "real"
    fails = 0
    rc, out = run(exe, ["eval", "--pool", pool, "--target", str(rd / "es_percent.target"), "--method", "chaos",
                        "--samples", str(max(samples, 50_000_000))])
    print(out)
    fails += rc != 0
    rc, out = run(exe, ["rank", "--pool", pool, "--target", str(rd / "es_percent.target"), "--samples", "1000000",
                        "--top", "25"])
    print(out)
    fails += rc != 0
    rc, out = run(exe, ["rank", "--pool", pool, "--target", str(rd / "es_2p1s.target"), "--samples", "1000000",
                        "--top", "12"])
    print(out)
    fails += rc != 0
    for route in sorted(rd.glob("*.route")):
        rc, out = run(exe, ["route", "--pool", pool, "--target", str(rd / "es_2p1s.target"), "--route", str(route),
                            "--trials", "20000"])
        print(out)
        fails += rc != 0
    return fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", default=str(ROOT / "build" / "poecraft.exe"))
    ap.add_argument("--samples", type=int, default=2_000_000)
    ap.add_argument("--real", action="store_true", help="also run the real-data example (needs data/)")
    a = ap.parse_args()
    exe = Path(a.exe)
    if not exe.exists():
        sys.exit(f"{exe} not found: run build.bat first")
    n, fails = unit(exe, a.samples)
    print(f"\n{n - fails}/{n} unit cases passed")
    if a.real:
        fails += real(exe, a.samples)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
