// poe-craft engine: shared types.
//
// Layering:
//   Pool      - the compiled mod pool for one base (compile_pool.py output) + mechanics.cfg rules + prices
//   Ctx       - read-only per-run context: pool, rules, flat per-mod arrays for the hot path
//   Item/State- a crafted item (<=6 explicit mods, POD, copied freely; no heap)
//   Method    - "apply method to state": apply() samples one next state (allocation-free),
//               outcomes() enumerates the exact next-state distribution for single-step methods,
//               reroll() exposes the reroll description for the exact success calculation.
//   Target    - requirements ("need k of {mods}") with labels; route conditions are built on them.
#pragma once
#include <array>
#include <bit>
#include <cmath>
#include <cstdint>
#include <map>
#include <memory>
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
enum Kind : uint8_t { K_R, K_E, K_D, K_C, K_A };  // rollable, essence, delve/fossil, crafted, aspect
enum Meta : uint8_t { M_NONE, M_LOCKP, M_LOCKS, M_LOCKP1, M_LOCKP2, M_LOCKS1, M_LOCKS2, M_MULTI, M_NOATTACK, M_NOCASTER };

struct Mod {
    std::string id, type, text;
    Side side = PRE;
    Kind kind = K_R;
    Meta meta = M_NONE;
    double weight = 0;
    uint16_t grp[2] = {0xffff, 0xffff};
    uint8_t ngrp = 0;
    std::vector<std::string> groups, tags;
    int tier = 0, ntiers = 0, reqlvl = 0;
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
    CountDist countRare, countMagic;
    int capRare[2] = {3, 3}, capMagic[2] = {1, 1};
    int craftedLimit = 1, craftedLimitMulti = 3;
    double fossilScale = 100;
    bool lockedSideCanFill = true, lockSurvivesChaos = true, annulCrafted = true, metaBlocksEF = true;
    bool harvKeep = false;
    int minNew = 0;
    bool fossilAdditive = false;  // fossil.stack = additive: "more" multipliers from several fossils add up
    int essRareMinLevel = 5;      // essences below this tier only work on normal items
    double harvSameMore = 3, harvSameLess = 1.0 / 3;
    std::map<std::string, std::string> tagAlias;  // harvest tag name -> mod tag
    std::vector<std::string> beastMeta;           // B01 outcome metamods (meta names)
    static Rules from(const Config& c);
};

// ------------------------------------------------------------------ item state
constexpr int MAXA = 6;
enum Rarity : uint8_t { NORMAL = 0, MAGIC = 1, RARE = 2 };
struct Item {
    uint16_t m[MAXA];
    uint8_t n = 0;
    uint8_t rarity = NORMAL;
    void add(int mod) { m[n++] = (uint16_t)mod; }
    void removeAt(int i) { m[i] = m[--n]; }
    bool has(int mod) const {
        for (int i = 0; i < n; i++) if (m[i] == mod) return true;
        return false;
    }
};
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
    void build(const std::vector<double>& w, int sideFilter, const std::vector<uint8_t>& side);
    int sample(Rng& r) const {
        uint32_t k = r.below((uint32_t)idx.size());
        return r.uni() < prob[k] ? idx[k] : alias[k];
    }
};
struct WeightTable {
    std::vector<double> w;  // per pool mod, 0 = cannot roll
    Alias a[3];             // 0: both sides, 1: prefixes only, 2: suffixes only
    void build(const std::vector<uint8_t>& side) {
        a[0].build(w, -1, side); a[1].build(w, PRE, side); a[2].build(w, SUF, side);
    }
};

struct Ctx {
    const Pool& pool;
    Rules rules;
    Prices& prices;
    std::vector<uint8_t> side, kind, meta, isAttack, isCaster;
    std::vector<uint16_t> g0, g1;
    WeightTable base;  // the plain random pool (chaos/alt/exalt/...)
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
    ItemFlags flags(const Item& it) const;
    // Draw one random mod that can be added to `it` (side caps, groups, attack/caster metamods),
    // restricted to sides in sideMask (bit0 prefix, bit1 suffix). wt: static table (alias fast path);
    // boost: optional dynamic multiplier for mods whose group is in boostGroups (harvest same-type).
    // Returns -1 if nothing can be added.
    int draw(const Item& it, const WeightTable& wt, uint8_t sideMask, Rng& r,
             const uint16_t* boostGroups = nullptr, int nBoost = 0, double boost = 1.0) const;
    bool eligible(const Item& it, int mod, const ItemFlags& f) const {
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
    enum Atom : uint8_t { REQS, OPENP, OPENS, OPEN, NORMALR, MAGICR, RARER, IMPRINT, LOCKP, LOCKS, FULL, EMPTY, TRUE_ };
    struct Term { Atom a; bool neg; uint32_t reqs; };
    std::vector<std::vector<Term>> any;
    static Cond parse(const std::string& s, const Target& t);
    bool eval(const Ctx& c, const State& s, const Target& t) const;
};

// ------------------------------------------------------------------ methods
struct RerollSpec {  // a full reforge; shared by sampling (doReroll) and the exact calculation
    const WeightTable* wt = nullptr;
    const WeightTable* first = nullptr;  // if set, the first new mod is drawn from this table
    std::vector<int> forced;             // added before the random mods (essence / fossil)
    bool keepP = false, keepS = false;   // harvest "keeping prefixes/suffixes" (removed in 3.30)
    bool honourLocks = true;             // prefix/suffix lock metamods protect their side
    bool lockSurvives = false;           // the lock metamod itself is kept
    uint8_t rarityOut = RARE;
    const CountDist* count = nullptr;
    double sameTypeMult = 1;             // harvest more/less likely (dynamic weights, no exact calc)
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
    // composite methods (a,b,c): their parts, so exact.cpp can chain outcomes into a final reroll
    virtual const std::vector<std::shared_ptr<Method>>* parts() const { return nullptr; }
};
using MethodPtr = std::shared_ptr<Method>;
// builds a method from its CLI/route name (see README); throws on unknown names
MethodPtr makeMethod(Ctx& c, const std::string& name);
void setMethodConfig(const Config* cfg);  // cost recipes for makeMethod
// shared reroll primitive (used by methods and documented in exact.cpp)
void doReroll(const Ctx& c, Item& it, const RerollSpec& sp, Rng& r);
// builds the start item of a reroll (kept + forced mods) and the per-count target sizes
struct RerollStart { Item start; int kept = 0; uint8_t sideMask = 3; };
RerollStart rerollStart(const Ctx& c, const Item& from, const RerollSpec& sp);

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
State parseStart(const Ctx& c, const std::string& spec);  // "rare mod:ID mod:ID ..."
std::string describe(const Ctx& c, const Item& it);

}  // namespace pc
