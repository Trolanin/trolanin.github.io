// poe-craft engine: shared types.
//
// Layering:
//   Pool      - the compiled mod pool for one base (compile_pool.py output) + mechanics.cfg rules + prices
//   Ctx       - read-only per-run context: pool, rules, flat per-mod arrays for the hot path
//   Item/State- a crafted item (<=6 explicit mods, POD, copied freely; no heap). An item also carries its
//               influences (bitmask), its Eldritch dominance and how many of its mods are fractured.
//   Method    - "apply method to state": apply() samples one next state (allocation-free),
//               outcomes() enumerates the exact next-state distribution for single-step methods,
//               reroll()/rerollAt()/split() expose the reroll description for the exact success calculation.
//   Target    - requirements ("need k of {mods}") with labels; route conditions are built on them.
//
// Influence: the pool holds every influence's mods (Mod::infl != 0). Such a mod can only roll on an item that
// carries one of its influences; weight tables keep one alias table per item influence mask (built lazily).
#pragma once
#include <array>
#include <atomic>
#include <bit>
#include <cmath>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <tuple>
#include <utility>
#include <vector>

namespace pc {

// ------------------------------------------------------------------ RNG (xoshiro256**)
struct Rng {
    uint64_t s[4];
    explicit Rng(uint64_t seed = 1) {
        for (auto& x : s) {  // splitmix64
            seed += 0x9e3779b97f4a7c15ull;
            uint64_t z = seed;
            z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ull;
            z = (z ^ (z >> 27)) * 0x94d049bb133111ebull;
            x = z ^ (z >> 31);
        }
    }
    static uint64_t rotl(uint64_t x, int k) { return (x << k) | (x >> (64 - k)); }
    uint64_t next() {
        uint64_t r = rotl(s[1] * 5, 7) * 9, t = s[1] << 17;
        s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = rotl(s[3], 45);
        return r;
    }
    double uni() { return (next() >> 11) * 0x1.0p-53; }
    uint32_t below(uint32_t n) { return (uint32_t)(((next() >> 32) * (uint64_t)n) >> 32); }
};

// ------------------------------------------------------------------ pool
enum Side : uint8_t { PRE = 0, SUF = 1 };
// rollable, essence, delve/fossil, crafted, beast aspect, elevated (made only by the Orb of Dominance)
enum Kind : uint8_t { K_R, K_E, K_D, K_C, K_A, K_V };
enum Meta : uint8_t { M_NONE, M_LOCKP, M_LOCKS, M_LOCKP1, M_LOCKP2, M_LOCKS1, M_LOCKS2, M_MULTI, M_NOATTACK, M_NOCASTER };

// influences, one bit each in this order (an item can carry two after an Awakener's Orb)
constexpr int NINFL = 6;
inline constexpr const char* kInflName[NINFL] = {"shaper", "elder", "crusader", "redeemer", "hunter", "warlord"};
uint8_t inflBit(const std::string& name);  // 0 if `name` is not an influence
std::string inflNames(uint8_t mask);       // "shaper+hunter", "-" if none
inline bool isArmourClass(const std::string& cls) {  // Eldritch implicits and the Orb of Dominance
    return cls == "Body Armour" || cls == "Helmet" || cls == "Gloves" || cls == "Boots";
}

struct Mod {
    std::string id, type, text;
    Side side = PRE;
    Kind kind = K_R;
    Meta meta = M_NONE;
    uint8_t infl = 0;  // influences the item needs for this mod to roll (0 = any item)
    double weight = 0;
    uint16_t grp[2] = {0xffff, 0xffff};
    uint8_t ngrp = 0;
    std::vector<std::string> groups, tags;
    int tier = 0, ntiers = 0, reqlvl = 0;
    std::string upId;  // Orb of Dominance: the next tier up of an influence mod (T1 -> Elevated), "" = unknown
    bool hasTag(const std::string& t) const {
        for (auto& x : tags) if (x == t) return true;
        return false;
    }
};
struct Essence {
    std::string name;
    int mod;
    int level = 0;   // essence tier 1-7, 8 = special, 0 = unknown (no rarity restriction)
    int maxLvl = 0;  // random-mod level cap (item_level_restriction below the item level), 0 = none
};
struct Fossil {
    std::string name, note;
    bool modelled = true;
    std::vector<std::pair<std::string, double>> wm;  // tag, raw weight
    std::vector<int> added, forced;
};
struct Bench { int mod; std::string cost; };

struct Pool {
    std::string base, itemClass, influences;
    uint8_t defInfl = 0;  // influences a start item carries unless the start spec says otherwise
    uint8_t avail = 0;    // influences this item class can carry (harvest randomise influence draws from these)
    int ilvl = 0;
    std::vector<std::string> baseTags, groupNames;
    std::vector<Mod> mods;
    std::vector<Essence> essences;
    std::vector<Fossil> fossils;
    std::vector<Bench> bench;
    std::unordered_map<std::string, int> byId;
    int find(const std::string& id) const {
        auto it = byId.find(id);
        return it == byId.end() ? -1 : it->second;
    }
    static Pool load(const std::string& path);
};

// ------------------------------------------------------------------ config / prices / rules
struct Config {
    std::map<std::string, std::string> kv;
    static Config load(const std::string& path);
    bool has(const std::string& k) const { return kv.count(k) != 0; }
    std::string str(const std::string& k, const std::string& def = "") const;
    double num(const std::string& k, double def) const;
};
struct Prices {
    std::unordered_map<std::string, double> chaos;
    std::vector<std::string> missing;  // names that were asked for but not known
    static Prices load(const std::string& path, const Config& cfg);
    double get(const std::string& name);  // NaN if unknown (and remembered in missing)
    double recipe(const std::string& r);  // "qty Name; qty Name" or plain number; NaN if unknown
};
struct CountDist {
    std::vector<std::pair<int, double>> v;  // (count, probability), probabilities sum to 1
    int sample(Rng& r) const {
        double u = r.uni();
        for (auto& [n, p] : v) { if (u < p) return n; u -= p; }
        return v.back().first;
    }
    static CountDist parse(const std::string& s);
};
struct Rules {
    CountDist countRare, countMagic, countAwaken, countNone;
    int capRare[2] = {3, 3}, capMagic[2] = {1, 1};
    int craftedLimit = 1, craftedLimitMulti = 3;
    double fossilScale = 100;
    bool lockedSideCanFill = true, lockSurvivesChaos = true, annulCrafted = true, metaBlocksEF = true;
    bool harvKeep = false;
    int minNew = 0;
    bool fossilAdditive = false;  // fossil.stack = additive: "more" multipliers from several fossils add up
    int essRareMinLevel = 5;      // essences below this tier only work on normal items
    double harvSameMore = 90, harvSameLess = 1.0 / 90;
    bool harvMoreKeepCount = true, harvLessKeepCount = false;  // never fewer mods than before the reforge
    bool randInflExcludeCurrent = false;  // harvest randomise influence never gives back the same influences
    bool eldritchChaosLocks = false;      // Eldritch Chaos honours prefix/suffix locks (A1.4: it ignores them)
    std::map<std::string, std::string> tagAlias;  // harvest tag name -> mod tag
    std::vector<std::string> beastMeta;           // B01 outcome metamods (meta names)
    std::vector<std::pair<uint8_t, double>> conflict;  // Orb of Conflict: resulting dominance, probability
    static Rules from(const Config& c);
};

// ------------------------------------------------------------------ item state
constexpr int MAXA = 6;
enum Rarity : uint8_t { NORMAL = 0, MAGIC = 1, RARE = 2 };
// Eldritch implicits: none, Exarch dominant (Eldritch currency acts on prefixes), Eater dominant (suffixes),
// both implicits at the same tier (no dominance: Eldritch Chaos/Exalted/Annulment cannot be used)
enum Dominance : uint8_t { DOM_NONE = 0, DOM_EXARCH = 1, DOM_EATER = 2, DOM_TIE = 3 };
struct Item {
    uint16_t m[MAXA];
    uint8_t n = 0;
    uint8_t rarity = NORMAL;
    uint8_t nfrac = 0;  // m[0..nfrac) are fractured: no operation removes, rerolls or moves them
    uint8_t infl = 0;   // influence bitmask (kInflName order)
    uint8_t dom = DOM_NONE;
    void add(int mod) { m[n++] = (uint16_t)mod; }
    void removeAt(int i) { m[i] = m[--n]; }  // callers pass i >= nfrac, so the fractured block stays in front
    bool has(int mod) const {
        for (int i = 0; i < n; i++) if (m[i] == mod) return true;
        return false;
    }
};
inline uint8_t domSides(const Item& it) {  // side mask Eldritch currency acts on (0 = no dominance)
    return it.dom == DOM_EXARCH ? 1 : it.dom == DOM_EATER ? 2 : 0;
}
struct State {
    Item it;
    Item imprint;
    uint8_t hasImprint = 0;
};
struct ItemFlags { bool lockP = false, lockS = false, multi = false, noAttack = false, noCaster = false; int crafted = 0; };

// ------------------------------------------------------------------ weight tables (Vose alias)
struct Alias {
    std::vector<uint16_t> idx, alias;
    std::vector<double> prob;
    double total = 0;
    // mods with w > 0 on side sideFilter (-1 both) that may roll on an item with influence mask `mask`
    void build(const std::vector<double>& w, int sideFilter, const std::vector<uint8_t>& side,
               const std::vector<uint8_t>& infl, uint8_t mask);
    int sample(Rng& r) const {
        uint32_t k = r.below((uint32_t)idx.size());
        return r.uni() < prob[k] ? idx[k] : alias[k];
    }
};
struct AliasSet { Alias a[3]; };  // 0: both sides, 1: prefixes only, 2: suffixes only
struct WeightTable {
    std::vector<double> w;  // per pool mod, 0 = cannot roll (influence mods included; filtered per item)
    WeightTable() = default;
    WeightTable(const WeightTable&) = delete;
    WeightTable& operator=(const WeightTable&) = delete;
    // call once after filling w; the alias tables for each item influence mask are then built on first use
    void build(const std::vector<uint8_t>& side, const std::vector<uint8_t>& infl);
    const AliasSet& forMask(uint8_t mask) const {
        mask &= used_;
        if (const AliasSet* s = sets_[mask].load(std::memory_order_acquire)) return *s;
        return slow(mask);
    }

  private:
    const std::vector<uint8_t>* side_ = nullptr;
    const std::vector<uint8_t>* infl_ = nullptr;
    uint8_t used_ = 0;  // influence bits that matter for this table (some mod with weight carries them)
    mutable std::array<std::atomic<const AliasSet*>, 64> sets_{};
    mutable std::mutex mu_;
    mutable std::vector<std::unique_ptr<AliasSet>> owned_;
    const AliasSet& slow(uint8_t mask) const;
};

struct Ctx {
    const Pool& pool;
    Rules rules;
    Prices& prices;
    std::vector<uint8_t> side, kind, meta, isAttack, isCaster, infl;
    std::vector<uint16_t> g0, g1;
    std::vector<int> up;  // Orb of Dominance: the next tier of an influence mod (T1 -> Elevated), -1 if unknown
    WeightTable base;     // the plain random pool (chaos/alt/exalt/...)
    Ctx(const Pool& p, const Rules& r, Prices& pr);

    int count(const Item& it, int s) const {
        int c = 0;
        for (int i = 0; i < it.n; i++) c += side[it.m[i]] == s;
        return c;
    }
    int cap(const Item& it, int s) const {
        return it.rarity == RARE ? rules.capRare[s] : it.rarity == MAGIC ? rules.capMagic[s] : 0;
    }
    int capFor(uint8_t rarity, int s) const {
        return rarity == RARE ? rules.capRare[s] : rarity == MAGIC ? rules.capMagic[s] : 0;
    }
    bool open(const Item& it, int s) const { return count(it, s) < cap(it, s); }
    bool blocked(const Item& it, int mod) const {  // group exclusivity (and the same mod twice)
        uint16_t a = g0[mod], b = g1[mod];
        for (int i = 0; i < it.n; i++) {
            int x = it.m[i];
            if (x == mod) return true;
            if (g0[x] == a || g0[x] == b || (g1[x] != 0xffff && (g1[x] == a || g1[x] == b))) return true;
        }
        return false;
    }
    bool inflOk(const Item& it, int mod) const { return !infl[mod] || (infl[mod] & it.infl); }
    ItemFlags flags(const Item& it) const;
    // Draw one random mod that can be added to `it` (side caps, groups, influence, attack/caster metamods),
    // restricted to sides in sideMask (bit0 prefix, bit1 suffix). wt: static table (alias fast path);
    // boost: optional dynamic multiplier for mods whose group is in boostGroups (harvest same-type).
    // Returns -1 if nothing can be added.
    int draw(const Item& it, const WeightTable& wt, uint8_t sideMask, Rng& r,
             const uint16_t* boostGroups = nullptr, int nBoost = 0, double boost = 1.0) const;
    bool eligible(const Item& it, int mod, const ItemFlags& f) const {
        if (!inflOk(it, mod)) return false;
        if (blocked(it, mod)) return false;
        if (f.noAttack && isAttack[mod]) return false;
        if (f.noCaster && isCaster[mod]) return false;
        return true;
    }
};

// ------------------------------------------------------------------ targets and conditions
struct Req { std::string label; int k = 1; std::vector<int> mods; };
struct Target {
    std::vector<Req> reqs;
    std::vector<uint32_t> modMask;  // per pool mod: bit r set if the mod counts for requirement r
    uint32_t all = 0;
    static Target load(const std::string& path, const Pool& pool);
    bool sat(const Item& it, uint32_t subset) const {
        uint8_t cnt[32] = {0};
        for (int i = 0; i < it.n; i++) {
            uint32_t m = modMask[it.m[i]];
            while (m) { cnt[std::countr_zero(m)]++; m &= m - 1; }
        }
        for (uint32_t s = subset; s;) {
            int b = std::countr_zero(s);
            if (cnt[b] < reqs[b].k) return false;
            s &= s - 1;
        }
        return true;
    }
    int label(const std::string& l) const {
        for (size_t i = 0; i < reqs.size(); i++) if (reqs[i].label == l) return (int)i;
        return -1;
    }
};
// condition = OR of AND-clauses of (possibly negated) atoms
struct Cond {
    enum Atom : uint8_t { REQS, OPENP, OPENS, OPEN, NORMALR, MAGICR, RARER, IMPRINT, LOCKP, LOCKS, FULL, EMPTY, TRUE_,
                          INFLUENCED, INFL, FRACTURED, EXARCH, EATER, ELDRITCH };
    struct Term { Atom a; bool neg; uint32_t reqs; };  // reqs: requirement bits, or the influence bit for INFL
    std::vector<std::vector<Term>> any;
    static Cond parse(const std::string& s, const Target& t);
    bool eval(const Ctx& c, const State& s, const Target& t) const;
};

// ------------------------------------------------------------------ methods
struct RerollSpec {  // a full reforge; shared by sampling (doReroll) and the exact calculation
    const WeightTable* wt = nullptr;
    const WeightTable* first = nullptr;  // if set, the first new mod is drawn from this table
    std::vector<int> forced;             // added before the random mods (essence / fossil)
    bool keepP = false, keepS = false;   // keep that side's mods (harvest keep crafts; Eldritch Chaos)
    bool keepAll = false;                // keep every mod of the input (Awakener's: the pre-step leaves only kept mods)
    bool honourLocks = true;             // prefix/suffix lock metamods protect their side
    bool lockSurvives = false;           // the lock metamod itself is kept
    bool keepCount = false;              // never fewer mods than the item had (harvest more likely)
    uint8_t sides = 3;                   // sides new mods may go to (Eldritch Chaos: the dominant side)
    uint8_t rarityOut = RARE;
    const CountDist* count = nullptr;
    double sameTypeMult = 1;             // harvest more/less likely: weight x mult for groups already on the item
};
struct Outcome { State s; double p; };

struct Method {
    std::string name;
    double cost = 0;  // chaos per application (NaN if a price is missing)
    virtual ~Method() = default;
    virtual bool applicable(const Ctx& c, const State& s) const = 0;
    // apply once (caller checked applicable); returns chaos spent. Must not allocate.
    virtual double apply(const Ctx& c, State& s, Rng& r) const = 0;
    // exact next-state distribution for single-step methods; false if not enumerable
    virtual bool outcomes(const Ctx&, const State&, std::vector<Outcome>&) const { return false; }
    // reroll description (exact success probability via exact.cpp); nullptr if not a reroll
    virtual const RerollSpec* reroll() const { return nullptr; }
    // the reroll used from this state (methods whose reroll depends on the item, e.g. Eldritch dominance)
    virtual const RerollSpec* rerollAt(const State&) const { return reroll(); }
    // "enumerable pre-step, then a reroll" (Awakener's Orb, randomise influence): fills the pre-step
    // outcomes and the reroll that follows each of them; false if the method is not of this shape
    virtual bool split(const Ctx&, const State&, std::vector<Outcome>&, const RerollSpec*&) const { return false; }
    // composite methods (a,b,c): their parts, so exact.cpp can chain outcomes into a final reroll
    virtual const std::vector<std::shared_ptr<Method>>* parts() const { return nullptr; }
};
using MethodPtr = std::shared_ptr<Method>;
// builds a method from its CLI/route name (see README); throws on unknown names
MethodPtr makeMethod(Ctx& c, const std::string& name);
void setMethodConfig(const Config* cfg);  // cost recipes for makeMethod
// shared reroll primitive (used by methods and documented in exact.cpp)
void doReroll(const Ctx& c, Item& it, const RerollSpec& sp, Rng& r);
// harvest more/less: the groups of the item's mods before the reforge (bg needs room for 2*MAXA); 0 if no boost
int sameTypeGroups(const Ctx& c, const Item& it, const RerollSpec& sp, uint16_t* bg);
// builds the start item of a reroll (fractured + kept + forced mods) and the sides new mods may use
struct RerollStart { Item start; int kept = 0; uint8_t sideMask = 3; };
RerollStart rerollStart(const Ctx& c, const Item& from, const RerollSpec& sp);
// the total mod count a reroll aims for, given the drawn count n (protected mods, harvest keep-count)
inline int rerollTarget(const Ctx& c, const Item& from, const RerollSpec& sp, const RerollStart& rs, int n) {
    if (rs.kept > 0) n = std::max(n, rs.kept + c.rules.minNew);
    if (sp.keepCount) n = std::max(n, (int)from.n);
    return n;
}

// ------------------------------------------------------------------ exact / Monte-Carlo
struct ExactResult { bool ok = false; double p = 0; size_t states = 0; std::string why; };
ExactResult exactReroll(const Ctx& c, const Target& t, uint32_t subset, const State& from, const RerollSpec& sp,
                        size_t stateCap = 20'000'000);
ExactResult exactStep(const Ctx& c, const Target& t, uint32_t subset, const State& from, const Method& m);
ExactResult exactMethod(const Ctx& c, const Target& t, uint32_t subset, const State& from, const Method& m);

struct MCResult {
    uint64_t n = 0, succ = 0, inapplicable = 0;
    double costSum = 0, secs = 0;
    double p() const { return n ? (double)succ / n : 0; }
    void wilson(double& lo, double& hi, double z = 1.96) const;
    double meanCost() const { return n ? costSum / n : 0; }
};
MCResult monteCarlo(const Ctx& c, const Method& m, const State& start, const Target& t, uint32_t subset,
                    uint64_t samples, int threads, uint64_t seed);

// route.cpp
void routeCommand(Ctx& c, const Target& t, const std::string& file, uint64_t trials, int threads, uint64_t seed);

// ------------------------------------------------------------------ helpers
std::vector<std::string> split(const std::string& s, char sep);
std::vector<std::string> splitWs(const std::string& s);
std::string trim(const std::string& s);
std::string lower(std::string s);
// "rare mod:ID frac:ID hunter exarch lockP ..." (see README); influences default to the pool's
State parseStart(const Ctx& c, const std::string& spec);
std::string describe(const Ctx& c, const Item& it);

}  // namespace pc
