"""Download the game data and live prices the crafting planner needs.

Game data: RePoE fork (repoe-fork.github.io), auto-exported from the game files each patch.
Prices:    poe.ninja exchange overviews for the current league (cached; poe.ninja updates ~hourly).

Usage:  python fetch_data.py [--league NAME] [--force]
Writes data/repoe/*.json, data/prices/<league>/*.json and data/manifest.json. data/ is git-ignored.
Standard library only.
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
UA = "poe-craft-planner/0.1 (hobby crafting calculator; github.com/Trolanin/trolanin.github.io)"

REPOE = "https://repoe-fork.github.io/"
REPOE_FILES = [
    "mods", "base_items", "item_classes", "tags", "stats", "stat_translations",
    "essences", "fossils", "crafting_bench_options", "mod_types",
]
NINJA = "https://poe.ninja/poe1/api/economy/exchange/current/overview"
NINJA_TYPES = ["Currency", "Essence", "Fossil", "Resonator", "Fragment", "Oil"]  # catalysts are in Currency
PRICE_MAX_AGE = 3600  # seconds; matches poe.ninja's update cadence
GAME_DATA_MAX_AGE = 6 * 3600


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def fresh(path: Path, max_age: float) -> bool:
    return path.exists() and time.time() - path.stat().st_mtime < max_age


def current_league() -> str:
    state = json.loads(get("https://poe.ninja/poe1/api/data/index-state"))
    leagues = [l["name"] for l in state["economyLeagues"]
               if not l.get("isPrivate") and l["name"] not in ("Standard", "Hardcore")
               and "hardcore" not in l["name"].lower() and "ssf" not in l["name"].lower()]
    return leagues[0] if leagues else "Standard"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", help="economy league (default: current softcore trade league)")
    ap.add_argument("--force", action="store_true", help="ignore caches")
    a = ap.parse_args()

    manifest = {}
    rdir = DATA / "repoe"
    rdir.mkdir(parents=True, exist_ok=True)
    for name in REPOE_FILES:
        p = rdir / f"{name}.json"
        if a.force or not fresh(p, GAME_DATA_MAX_AGE):
            p.write_bytes(get(f"{REPOE}{name}.min.json"))
            print(f"game data  {name:24} {p.stat().st_size / 1e6:6.1f} MB")
    # The fork's GitHub commits carry the exported game version, e.g. "Export 3.30.0.4".
    try:
        commits = json.loads(get("https://api.github.com/repos/repoe-fork/repoe-fork.github.io/commits?per_page=5"))
        manifest["game_version"] = next((c["commit"]["message"].split()[-1] for c in commits
                                         if "Export" in c["commit"]["message"]), None)
    except Exception as e:  # version is informational only
        manifest["game_version"] = f"unknown ({e.__class__.__name__})"

    league = a.league or current_league()
    pdir = DATA / "prices" / league
    pdir.mkdir(parents=True, exist_ok=True)
    for t in NINJA_TYPES:
        p = pdir / f"{t}.json"
        if a.force or not fresh(p, PRICE_MAX_AGE):
            q = urllib.parse.urlencode({"league": league, "type": t})
            p.write_bytes(get(f"{NINJA}?{q}"))
            n = len(json.loads(p.read_bytes()).get("lines", []))
            print(f"prices     {league}/{t:18} {n:4} lines")
            time.sleep(1)  # be gentle; poe.ninja blocks heavy users
    manifest.update(league=league, fetched_at=time.strftime("%Y-%m-%dT%H:%M:%S%z"))
    (DATA / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"league {league}, game data {manifest['game_version']}")


if __name__ == "__main__":
    main()
