// Crafting methods. Every method is a Method: applicable(state), apply(state, rng) -> chaos spent
// (one sampled transition, allocation-free), and where the next-state distribution is small,
// outcomes(state) -> exact list of (next state, probability). Rerolls expose a RerollSpec instead,
// which exact.cpp turns into an exact success probability; "pre-step + reroll" methods (Awakener's
// Orb, harvest randomise influence) expose split().
//
// Method names (CLI, routes and rank all use these; spaces in names may be written as '_'):
//   chaos alch transmute alt aug regal exalt annul scour altaug
//   essence:<essence name>              fossil:<a>[+<b>...]   (e.g. fossil:dense+frigid)
//   bench:<mod id> | bench:remove | lockprefix | locksuffix | multimod | noattack | nocaster
//   harvest:tag:<tag> | harvest:more | harvest:less | harvest:addremove:<tag>
//   harvest:influence | harvest:randomise_influence
//   harvest:keep_prefixes | harvest:keep_suffixes   (only if harvest.available.keep = 1)
//   beast:imprint | beast:restore | beast:prefix_remove_suffix | beast:suffix_remove_prefix
//   beast:meta | beast:aspect | beast:influence:<influence>
//   exalt:<influence>                   Shaper's/Elder's/Crusader's/Redeemer's/Hunter's/Warlord's Exalted Orb
//   awaken:<influence>[:<mod id>]       Awakener's Orb; the donor has that influence (and keeps that mod)
//   dominance                           Orb of Dominance
//   eldritch:chaos | eldritch:exalt | eldritch:annul | conflict
//   fracture                            Fracturing Orb
//   <m1>,<m2>,...                       sequence applied as one step (e.g. lockprefix,chaos)
#include <algorithm>
#include <cstdio>

#include "core.hpp"

namespace pc {

// ------------------------------------------------------------------ reroll primitive
RerollStart rerollStart(const Ctx& c, const Item& from, const RerollSpec& sp) {
    RerollStart rs;
    Item& o = rs.start;
    o.n = 0;
    o.rarity = sp.rarityOut;
    o.infl = from.infl;
    o.dom = from.dom;
    ItemFlags f = c.flags(from);
    bool lockP = sp.honourLocks && f.lockP, lockS = sp.honourLocks && f.lockS;
    bool keepP = sp.keepAll || sp.keepP || lockP, keepS = sp.keepAll || sp.keepS || lockS;
    for (int i = 0; i < from.nfrac; i++) o.add(from.m[i]);  // fractured mods are never rerolled
    o.nfrac = from.nfrac;
    for (int i = from.nfrac; i < from.n; i++) {
        int m = from.m[i];
        bool keep = c.side[m] == PRE ? keepP : keepS;
        if (!keep && sp.lockSurvives && ((c.meta[m] == M_LOCKP && lockP) || (c.meta[m] == M_LOCKS && lockS))) keep = true;
        if (keep) o.add(m);
    }
    rs.kept = o.n;
    rs.sideMask = sp.sides;
    if (!c.rules.lockedSideCanFill) {
        if (lockP) rs.sideMask &= ~1;
        if (lockS) rs.sideMask &= ~2;
    }
    for (int m : sp.forced)
        if (c.count(o, c.side[m]) < c.capFor(o.rarity, c.side[m]) && !c.blocked(o, m) && o.n < MAXA) o.add(m);
    return rs;
}

int sameTypeGroups(const Ctx& c, const Item& it, const RerollSpec& sp, uint16_t* bg) {
    int nb = 0;
    if (sp.sameTypeMult != 1)
        for (int i = 0; i < it.n; i++) {
            bg[nb++] = c.g0[it.m[i]];
            if (c.g1[it.m[i]] != 0xffff) bg[nb++] = c.g1[it.m[i]];
        }
    return nb;
}

void doReroll(const Ctx& c, Item& it, const RerollSpec& sp, Rng& r) {
    uint16_t bg[2 * MAXA];
    int nb = sameTypeGroups(c, it, sp, bg);
    RerollStart rs = rerollStart(c, it, sp);
    Item o = rs.start;
    int n = rerollTarget(c, it, sp, rs, sp.count->sample(r));
    bool first = sp.first != nullptr;
    while (o.n < n) {
        int m = -1;
        if (first) {
            first = false;
            m = c.draw(o, *sp.first, rs.sideMask, r);
        }
        if (m < 0) m = c.draw(o, *sp.wt, rs.sideMask, r, nb ? bg : nullptr, nb, sp.sameTypeMult);
        if (m < 0) break;
        o.add(m);
    }
    it = o;
}

// ------------------------------------------------------------------ helpers
static uint8_t rmask(std::initializer_list<int> rs) {
    uint8_t m = 0;
    for (int r : rs) m |= (uint8_t)(1 << r);
    return m;
}
static bool hasOutcomeMeta(const ItemFlags& f) { return f.lockP || f.lockS || f.noAttack || f.noCaster; }
static bool sameGroup(const Ctx& c, int a, int b) {
    return a == b || c.g0[a] == c.g0[b] || c.g0[a] == c.g1[b] || (c.g1[a] != 0xffff && (c.g1[a] == c.g0[b] || c.g1[a] == c.g1[b]));
}
static bool onLockedSide(const Ctx& c, int m, const ItemFlags& f) {
    return (c.side[m] == PRE && f.lockP) || (c.side[m] == SUF && f.lockS);
}

// can a crafted mod be added right now?
static bool canCraft(const Ctx& c, const Item& it, int mod) {
    if (it.rarity == NORMAL) return false;
    if (!c.open(it, c.side[mod]) || c.blocked(it, mod)) return false;
    ItemFlags f = c.flags(it);
    int limit = f.multi ? c.rules.craftedLimitMulti : c.rules.craftedLimit;
    return f.crafted < limit;
}
// can the mod at position pos be removed (fractured mods, lock metamods, crafted rule)
static bool removable(const Ctx& c, const Item& it, int pos, const ItemFlags& f, bool craftedOk) {
    if (pos < it.nfrac) return false;
    int m = it.m[pos];
    if (onLockedSide(c, m, f)) return false;
    if (c.kind[m] == K_C && !craftedOk) return false;
    return true;
}
// enumerate "add one random mod from wt" outcomes
static void addOutcomes(const Ctx& c, const State& s, const WeightTable& wt, uint8_t rarityOut, double pIn,
                        std::vector<Outcome>& out, uint8_t sideMask = 3) {
    State base = s;
    base.it.rarity = rarityOut;
    ItemFlags f = c.flags(base.it);
    auto ok = [&](size_t m) {
        return wt.w[m] > 0 && (sideMask >> c.side[m] & 1) && c.open(base.it, c.side[m]) && c.eligible(base.it, (int)m, f);
    };
    double tot = 0;
    for (size_t m = 0; m < wt.w.size(); m++) if (ok(m)) tot += wt.w[m];
    if (tot <= 0) { out.push_back({base, pIn}); return; }
    for (size_t m = 0; m < wt.w.size(); m++)
        if (ok(m)) {
            State n = base;
            n.it.add((int)m);
            out.push_back({n, pIn * wt.w[m] / tot});
        }
}

// ------------------------------------------------------------------ reroll methods
struct RerollMethod : Method {
    RerollSpec spec;
    uint8_t inRarity = 0;        // bitmask of allowed input rarities
    bool blockedByMeta = false;  // essences / fossils refuse items with outcome metamods
    int8_t needInfl = -1;        // -1 any item, 1 influenced items only (harvest influence reforge)
    std::shared_ptr<WeightTable> own, ownFirst;  // tables owned by this method (fossils / harvest)
    bool applicable(const Ctx& c, const State& s) const override {
        if (!(inRarity >> s.it.rarity & 1)) return false;
        if (needInfl == 1 && !s.it.infl) return false;
        if (blockedByMeta && c.rules.metaBlocksEF && hasOutcomeMeta(c.flags(s.it))) return false;
        return true;
    }
    double apply(const Ctx& c, State& s, Rng& r) const override {
        doReroll(c, s.it, spec, r);
        return cost;
    }
    const RerollSpec* reroll() const override { return &spec; }
};

// Eldritch Chaos Orb: rerolls the dominant side only (Exarch: prefixes, Eater: suffixes); the other side
// and fractured mods stay; the total count is drawn as for Chaos (docs C5); prefix/suffix locks are ignored
struct EldritchChaosMethod : Method {
    RerollSpec pre, suf;
    bool applicable(const Ctx&, const State& s) const override { return s.it.rarity == RARE && domSides(s.it); }
    const RerollSpec* rerollAt(const State& s) const override { return s.it.dom == DOM_EXARCH ? &pre : &suf; }
    double apply(const Ctx& c, State& s, Rng& r) const override {
        doReroll(c, s.it, *rerollAt(s), r);
        return cost;
    }
};

// ------------------------------------------------------------------ add-one methods (aug/regal/exalt/Eldritch Exalted)
struct AddMethod : Method {
    const WeightTable* wt = nullptr;
    uint8_t inRarity = 0, outRarity = RARE;
    bool dominantSide = false;  // Eldritch Exalted: only the dominant side
    uint8_t sides(const Item& it) const { return dominantSide ? domSides(it) : 3; }
    bool applicable(const Ctx& c, const State& s) const override {
        if (!(inRarity >> s.it.rarity & 1)) return false;
        uint8_t sm = sides(s.it);
        Item t = s.it;
        t.rarity = outRarity;
        return ((sm & 1) && c.open(t, PRE)) || ((sm & 2) && c.open(t, SUF));
    }
    double apply(const Ctx& c, State& s, Rng& r) const override {
        s.it.rarity = outRarity;
        int m = c.draw(s.it, *wt, sides(s.it), r);
        if (m >= 0) s.it.add(m);
        return cost;
    }
    bool outcomes(const Ctx& c, const State& s, std::vector<Outcome>& out) const override {
        addOutcomes(c, s, *wt, outRarity, 1.0, out, sides(s.it));
        return true;
    }
};

// Influence Exalted Orbs (setInfl): a rare item without influence or Eldritch implicits gets the influence and
// one random mod of it (docs F1). Influence beastcrafts (!setInfl): a rare item that already has the influence
// gets one more random mod of it.
struct InflAddMethod : Method {
    uint8_t bit = 0;
    bool setInfl = true;
    std::shared_ptr<WeightTable> own;  // this influence's mods only
    bool applicable(const Ctx& c, const State& s) const override {
        if (s.it.rarity != RARE) return false;
        if (setInfl ? (s.it.infl || s.it.dom) : !(s.it.infl & bit)) return false;
        Item t = s.it;
        t.infl |= bit;
        ItemFlags f = c.flags(t);
        for (size_t m = 0; m < own->w.size(); m++)
            if (own->w[m] > 0 && c.open(t, c.side[m]) && c.eligible(t, (int)m, f)) return true;
        return false;
    }
    double apply(const Ctx& c, State& s, Rng& r) const override {
        s.it.infl |= bit;
        int m = c.draw(s.it, *own, 3, r);
        if (m >= 0) s.it.add(m);
        return cost;
    }
    bool outcomes(const Ctx& c, const State& s, std::vector<Outcome>& out) const override {
        State b = s;
        b.it.infl |= bit;
        addOutcomes(c, b, *own, RARE, 1.0, out);
        return true;
    }
};

struct AnnulMethod : Method {
    bool dominantSide = false;  // Eldritch Annulment: only mods on the dominant side
    bool can(const Ctx& c, const Item& it, int i, const ItemFlags& f) const {
        if (!removable(c, it, i, f, c.rules.annulCrafted)) return false;
        return !dominantSide || (domSides(it) >> c.side[it.m[i]] & 1);
    }
    bool applicable(const Ctx& c, const State& s) const override {
        if (s.it.rarity == NORMAL) return false;
        ItemFlags f = c.flags(s.it);
        for (int i = 0; i < s.it.n; i++) if (can(c, s.it, i, f)) return true;
        return false;
    }
    double apply(const Ctx& c, State& s, Rng& r) const override {
        ItemFlags f = c.flags(s.it);
        int cand[MAXA], k = 0;
        for (int i = 0; i < s.it.n; i++) if (can(c, s.it, i, f)) cand[k++] = i;
        if (k) s.it.removeAt(cand[r.below(k)]);
        return cost;
    }
    bool outcomes(const Ctx& c, const State& s, std::vector<Outcome>& out) const override {
        ItemFlags f = c.flags(s.it);
        int k = 0;
        for (int i = 0; i < s.it.n; i++) k += can(c, s.it, i, f);
        for (int i = 0; i < s.it.n; i++)
            if (can(c, s.it, i, f)) {
                State n = s;
                n.it.removeAt(i);
                out.push_back({n, 1.0 / k});
            }
        if (!k) out.push_back({s, 1.0});
        return true;
    }
};

struct ScourMethod : Method {
    bool applicable(const Ctx&, const State& s) const override { return s.it.rarity != NORMAL; }
    static void scour(const Ctx& c, Item& it) {
        ItemFlags f = c.flags(it);
        Item o = it;  // keeps influence, implicits and the fractured block (fractured mods are not removable)
        o.n = 0;
        for (int i = 0; i < it.n; i++) if (!removable(c, it, i, f, true)) o.add(it.m[i]);
        if (o.n == o.nfrac) o.rarity = NORMAL;  // nothing (or only fractured mods) left
        it = o;
    }
    double apply(const Ctx& c, State& s, Rng&) const override { scour(c, s.it); return cost; }
    bool outcomes(const Ctx& c, const State& s, std::vector<Outcome>& out) const override {
        State n = s;
        scour(c, n.it);
        out.push_back({n, 1.0});
        return true;
    }
};

struct BenchMethod : Method {
    int mod = -1;
    bool applicable(const Ctx& c, const State& s) const override { return canCraft(c, s.it, mod); }
    double apply(const Ctx&, State& s, Rng&) const override { s.it.add(mod); return cost; }
    bool outcomes(const Ctx&, const State& s, std::vector<Outcome>& out) const override {
        State n = s;
        n.it.add(mod);
        out.push_back({n, 1.0});
        return true;
    }
};
struct BenchRemoveMethod : Method {
    bool applicable(const Ctx& c, const State& s) const override { return c.flags(s.it).crafted > 0; }
    static void strip(const Ctx& c, Item& it) {
        Item o = it;
        o.n = 0;
        for (int i = 0; i < it.n; i++) if (c.kind[it.m[i]] != K_C) o.add(it.m[i]);
        it = o;
    }
    double apply(const Ctx& c, State& s, Rng&) const override { strip(c, s.it); return cost; }
    bool outcomes(const Ctx& c, const State& s, std::vector<Outcome>& out) const override {
        State n = s;
        strip(c, n.it);
        out.push_back({n, 1.0});
        return true;
    }
};

// harvest "add a <tag> mod, remove another random mod" (new mod is safe); also used for the
// beast "add prefix, remove random suffix" crafts (removeSide restricts the removal).
struct AddRemoveMethod : Method {
    const WeightTable* wt = nullptr;
    std::shared_ptr<WeightTable> own;
    uint8_t addSides = 3;
    int removeSide = -1;      // -1 any side
    bool needNoInfl = false;  // harvest add/remove crafts: "from a non-Influenced item"
    bool applicable(const Ctx& c, const State& s) const override {
        if (s.it.rarity != RARE) return false;
        if (needNoInfl && s.it.infl) return false;
        return (addSides & 1 && c.open(s.it, PRE)) || (addSides & 2 && c.open(s.it, SUF));
    }
    bool canRemove(const Ctx& c, const Item& it, int pos, const ItemFlags& f) const {
        return (removeSide < 0 || c.side[it.m[pos]] == removeSide) && removable(c, it, pos, f, c.rules.annulCrafted);
    }
    double apply(const Ctx& c, State& s, Rng& r) const override {
        int m = c.draw(s.it, *wt, addSides, r);
        if (m < 0) return cost;
        ItemFlags f = c.flags(s.it);
        int cand[MAXA], k = 0;
        for (int i = 0; i < s.it.n; i++) if (canRemove(c, s.it, i, f)) cand[k++] = i;
        if (k) s.it.removeAt(cand[r.below(k)]);
        s.it.add(m);
        return cost;
    }
    bool outcomes(const Ctx& c, const State& s, std::vector<Outcome>& out) const override {
        ItemFlags f = c.flags(s.it);
        int cand[MAXA], k = 0;
        for (int i = 0; i < s.it.n; i++) if (canRemove(c, s.it, i, f)) cand[k++] = i;
        std::vector<Outcome> adds;
        addOutcomes(c, s, *wt, s.it.rarity, 1.0, adds, addSides);
        for (auto& a : adds) {
            if (a.s.it.n == s.it.n) { out.push_back(a); continue; }  // nothing could be added
            if (!k) { out.push_back(a); continue; }
            for (int j = 0; j < k; j++) {
                State n = a.s;
                n.it.removeAt(cand[j]);  // the new mod is the last one; cand[j] < s.it.n
                out.push_back({n, a.p / k});
            }
        }
        return true;
    }
};

struct ImprintMethod : Method {
    bool applicable(const Ctx&, const State& s) const override { return s.it.rarity == MAGIC; }
    double apply(const Ctx&, State& s, Rng&) const override { s.imprint = s.it; s.hasImprint = 1; return cost; }
    bool outcomes(const Ctx&, const State& s, std::vector<Outcome>& out) const override {
        State n = s; n.imprint = s.it; n.hasImprint = 1;
        out.push_back({n, 1.0});
        return true;
    }
};
struct RestoreMethod : Method {
    bool applicable(const Ctx&, const State& s) const override { return s.hasImprint != 0; }
    double apply(const Ctx&, State& s, Rng&) const override { s.it = s.imprint; s.hasImprint = 0; return cost; }
    bool outcomes(const Ctx&, const State& s, std::vector<Outcome>& out) const override {
        State n = s; n.it = s.imprint; n.hasImprint = 0;
        out.push_back({n, 1.0});
        return true;
    }
};
// beast B01: one of several metamods, uniformly; no change if the chosen one cannot be added
struct BeastMetaMethod : Method {
    std::vector<int> mods;
    bool applicable(const Ctx& c, const State& s) const override {
        if (s.it.rarity == NORMAL) return false;
        for (int m : mods) if (canCraft(c, s.it, m)) return true;
        return false;
    }
    double apply(const Ctx& c, State& s, Rng& r) const override {
        int m = mods[r.below((uint32_t)mods.size())];
        if (canCraft(c, s.it, m)) s.it.add(m);
        return cost;
    }
    bool outcomes(const Ctx& c, const State& s, std::vector<Outcome>& out) const override {
        for (int m : mods) {
            State n = s;
            if (canCraft(c, s.it, m)) n.it.add(m);
            out.push_back({n, 1.0 / mods.size()});
        }
        return true;
    }
};
struct AspectMethod : Method {
    int mod = -1;
    bool applicable(const Ctx& c, const State& s) const override {
        return s.it.rarity != NORMAL && c.open(s.it, SUF) && !c.blocked(s.it, mod);
    }
    double apply(const Ctx&, State& s, Rng&) const override { s.it.add(mod); return cost; }
    bool outcomes(const Ctx&, const State& s, std::vector<Outcome>& out) const override {
        State n = s;
        n.it.add(mod);
        out.push_back({n, 1.0});
        return true;
    }
};

// Awakener's Orb (docs F2): the target (current item, one influence) is reforged as a rare with its own and the
// donor's influence, keeping one random influence mod of the target and the donor's mod (same group: one of
// the two at random); the rest is a normal rare reroll that ignores metamods.
struct AwakenMethod : Method {
    uint8_t donorBit = 0;
    int donorMod = -1;
    RerollSpec spec;
    bool applicable(const Ctx&, const State& s) const override {
        const Item& it = s.it;
        return std::popcount(it.infl) == 1 && !(it.infl & donorBit) && !it.dom && !it.nfrac;
    }
    static int inflPositions(const Ctx& c, const Item& it, int* pos) {
        int k = 0;
        for (int i = 0; i < it.n; i++) if (c.infl[it.m[i]]) pos[k++] = i;
        return k;
    }
    Item pre(const Item& it, int keep, bool keepDonor) const {  // keep: target mod id or -1
        Item o = it;
        o.n = 0; o.nfrac = 0; o.dom = DOM_NONE;
        o.rarity = RARE;
        o.infl = it.infl | donorBit;
        if (keep >= 0) o.add(keep);
        if (keepDonor && donorMod >= 0) o.add(donorMod);
        return o;
    }
    bool split(const Ctx& c, const State& s, std::vector<Outcome>& out, const RerollSpec*& sp) const override {
        sp = &spec;
        int pos[MAXA];
        int k = inflPositions(c, s.it, pos);
        auto push = [&](int keep, double p) {
            State n = s;
            if (keep >= 0 && donorMod >= 0 && sameGroup(c, keep, donorMod)) {
                n.it = pre(s.it, keep, false); out.push_back({n, p / 2});
                n.it = pre(s.it, -1, true); out.push_back({n, p / 2});
                return;
            }
            n.it = pre(s.it, keep, true);
            out.push_back({n, p});
        };
        if (!k) push(-1, 1.0);
        for (int j = 0; j < k; j++) push(s.it.m[pos[j]], 1.0 / k);
        return true;
    }
    double apply(const Ctx& c, State& s, Rng& r) const override {
        int pos[MAXA];
        int k = inflPositions(c, s.it, pos);
        int keep = k ? s.it.m[pos[r.below(k)]] : -1;
        bool keepDonor = true;
        if (keep >= 0 && donorMod >= 0 && sameGroup(c, keep, donorMod)) {
            if (r.below(2)) keepDonor = false;
            else keep = -1;
        }
        s.it = pre(s.it, keep, keepDonor);
        doReroll(c, s.it, spec, r);
        return cost;
    }
};

// Harvest "randomise the influence types ... and reforge" (docs F4): the new influences are drawn uniformly
// among the sets of the same size the item class can have; the item is rerolled at its rarity, honouring
// prefix/suffix locks; refused if a protected (locked-side or fractured) mod is an influence mod.
struct RandInflMethod : Method {
    RerollSpec spec[3];  // by rarity: normal (no mods), magic, rare
    bool exclude = false;
    uint8_t avail = 0x3f;
    bool okMask(uint8_t cur, unsigned m) const {
        return (m & ~(unsigned)avail) == 0 && std::popcount(m) == std::popcount(cur) && !(exclude && m == cur);
    }
    int nMasks(uint8_t cur) const {
        int n = 0;
        for (unsigned m = 1; m < 64; m++) n += okMask(cur, m);
        return n;
    }
    uint8_t maskAt(uint8_t cur, int k) const {
        for (unsigned m = 1; m < 64; m++)
            if (okMask(cur, m) && k-- == 0) return (uint8_t)m;
        return cur;
    }
    bool applicable(const Ctx& c, const State& s) const override {
        const Item& it = s.it;
        if (!it.infl) return false;
        ItemFlags f = c.flags(it);
        for (int i = 0; i < it.n; i++) {
            int m = it.m[i];
            if (c.infl[m] && (i < it.nfrac || onLockedSide(c, m, f))) return false;
        }
        return nMasks(it.infl) > 0;
    }
    bool split(const Ctx&, const State& s, std::vector<Outcome>& out, const RerollSpec*& sp) const override {
        sp = &spec[s.it.rarity];
        int n = nMasks(s.it.infl);
        for (int k = 0; k < n; k++) {
            State x = s;
            x.it.infl = maskAt(s.it.infl, k);
            out.push_back({x, 1.0 / n});
        }
        return true;
    }
    double apply(const Ctx& c, State& s, Rng& r) const override {
        int n = nMasks(s.it.infl);
        s.it.infl = maskAt(s.it.infl, (int)r.below((uint32_t)n));
        doReroll(c, s.it, spec[s.it.rarity], r);
        return cost;
    }
};

// Orb of Dominance (docs F3): body armour/helmet/gloves/boots, magic or rare, >= 2 influence mods that can be
// changed (not fractured, not on a locked side): one of them goes up one tier (T1 -> Elevated when the pool
// knows the Elevated mod; otherwise, and for Elevated mods, only the values change = no change here) and
// another one is removed. Both picks uniform.
struct DominanceMethod : Method {
    bool armour = false;
    static int cands(const Ctx& c, const Item& it, int* pos) {
        ItemFlags f = c.flags(it);
        int k = 0;
        for (int i = it.nfrac; i < it.n; i++)
            if (c.infl[it.m[i]] && !onLockedSide(c, it.m[i], f)) pos[k++] = i;
        return k;
    }
    bool applicable(const Ctx& c, const State& s) const override {
        if (!armour || s.it.rarity == NORMAL) return false;
        int pos[MAXA];
        return cands(c, s.it, pos) >= 2;
    }
    static void step(const Ctx& c, Item& it, int u, int d) {  // upgrade position u, remove position d
        int up = c.up[it.m[u]];
        if (up >= 0) it.m[u] = (uint16_t)up;
        it.removeAt(d);
    }
    double apply(const Ctx& c, State& s, Rng& r) const override {
        int pos[MAXA];
        int k = cands(c, s.it, pos);
        int a = (int)r.below(k), b = (int)r.below(k - 1);
        if (b >= a) b++;
        step(c, s.it, pos[a], pos[b]);
        return cost;
    }
    bool outcomes(const Ctx& c, const State& s, std::vector<Outcome>& out) const override {
        int pos[MAXA];
        int k = cands(c, s.it, pos);
        for (int a = 0; a < k; a++)
            for (int b = 0; b < k; b++)
                if (a != b) {
                    State n = s;
                    step(c, n.it, pos[a], pos[b]);
                    out.push_back({n, 1.0 / (k * (k - 1))});
                }
        return true;
    }
};

// Fracturing Orb (docs C6): rare with >= 4 mods, not influenced, not already fractured; one random
// non-crafted mod becomes fractured (uniform, UNVERIFIED). Ignores metamods.
struct FractureMethod : Method {
    static int cands(const Ctx& c, const Item& it, int* pos) {
        int k = 0;
        for (int i = 0; i < it.n; i++) if (c.kind[it.m[i]] != K_C) pos[k++] = i;
        return k;
    }
    bool applicable(const Ctx& c, const State& s) const override {
        const Item& it = s.it;
        int pos[MAXA];
        return it.rarity == RARE && it.n >= 4 && !it.nfrac && !it.infl && cands(c, it, pos) > 0;
    }
    static void frac(Item& it, int i) {
        std::swap(it.m[0], it.m[i]);
        it.nfrac = 1;
    }
    double apply(const Ctx& c, State& s, Rng& r) const override {
        int pos[MAXA];
        int k = cands(c, s.it, pos);
        frac(s.it, pos[r.below(k)]);
        return cost;
    }
    bool outcomes(const Ctx& c, const State& s, std::vector<Outcome>& out) const override {
        int pos[MAXA];
        int k = cands(c, s.it, pos);
        for (int j = 0; j < k; j++) {
            State n = s;
            frac(n.it, pos[j]);
            out.push_back({n, 1.0 / k});
        }
        return true;
    }
};

// Orb of Conflict (docs C5): changes the implicit tiers; modelled as a new dominance drawn from
// eldritch.conflict_outcomes (the real odds depend on the implicit tiers, which are not tracked)
struct ConflictMethod : Method {
    const std::vector<std::pair<uint8_t, double>>* dist = nullptr;
    bool applicable(const Ctx&, const State& s) const override { return s.it.dom != DOM_NONE; }
    double apply(const Ctx&, State& s, Rng& r) const override {
        double u = r.uni();
        for (auto& [d, p] : *dist) {
            if (u < p) { s.it.dom = d; return cost; }
            u -= p;
        }
        s.it.dom = dist->back().first;
        return cost;
    }
    bool outcomes(const Ctx&, const State& s, std::vector<Outcome>& out) const override {
        for (auto& [d, p] : *dist) {
            State n = s;
            n.it.dom = d;
            out.push_back({n, p});
        }
        return true;
    }
};

// alteration, then augmentation if the magic item has an open slot
struct AltAugMethod : Method {
    MethodPtr alt, aug;
    bool applicable(const Ctx& c, const State& s) const override { return alt->applicable(c, s); }
    double apply(const Ctx& c, State& s, Rng& r) const override {
        double k = alt->apply(c, s, r);
        if (aug->applicable(c, s)) k += aug->apply(c, s, r);
        return k;
    }
};
// several methods applied in order as one step; later ones are skipped if not applicable
struct SeqMethod : Method {
    std::vector<MethodPtr> seq;
    const std::vector<MethodPtr>* parts() const override { return &seq; }
    bool applicable(const Ctx& c, const State& s) const override { return seq[0]->applicable(c, s); }
    double apply(const Ctx& c, State& s, Rng& r) const override {
        double k = 0;
        for (auto& p : seq)
            if (p->applicable(c, s)) k += p->apply(c, s, r);
        return k;
    }
    bool outcomes(const Ctx& c, const State& s, std::vector<Outcome>& out) const override {
        std::vector<Outcome> cur{{s, 1.0}}, nxt;
        for (auto& p : seq) {
            nxt.clear();
            for (auto& o : cur) {
                if (!p->applicable(c, o.s)) { nxt.push_back(o); continue; }
                std::vector<Outcome> sub;
                if (!p->outcomes(c, o.s, sub)) return false;
                for (auto& x : sub) nxt.push_back({x.s, x.p * o.p});
            }
            std::swap(cur, nxt);
            if (cur.size() > 200000) return false;
        }
        out.insert(out.end(), cur.begin(), cur.end());
        return true;
    }
};

// ------------------------------------------------------------------ factory
static std::string norm(std::string s) {
    for (auto& ch : s) if (ch == '_') ch = ' ';
    return lower(trim(s));
}

static const Config* gCfg = nullptr;  // set by makeMethod's caller via setMethodConfig
void setMethodConfig(const Config* cfg) { gCfg = cfg; }

static double costKey(Ctx& c, const Config* cfg, const std::string& key) {
    if (!cfg || !cfg->has(key)) {
        std::fprintf(stderr, "warning: no cost entry '%s' in mechanics.cfg\n", key.c_str());
        return NAN;
    }
    return c.prices.recipe(cfg->str(key));
}

static std::string harvestTag(const Ctx& c, const std::string& t) {
    auto it = c.rules.tagAlias.find(t);
    return it == c.rules.tagAlias.end() ? t : it->second;
}
// One fossil's weight multiplier for one mod (docs C4). Pseudo-tags from compile_pool.py:
// __tagless (mods without tags; Opulent), __sanctified (x(1 + 0.01*(required_level - 40))).
static double fossilFactor(const Fossil& f, const Mod& m, double scale) {
    double more = 1, less = 1, extra = 1;
    bool anyLess = false;
    for (auto& [tag, w] : f.wm) {
        if (tag == "__sanctified") { extra *= std::max(0.0, 1 + 0.01 * (m.reqlvl - 40)); continue; }
        if (!(tag == "__tagless" ? m.tags.empty() : m.hasTag(tag))) continue;
        double x = w / scale;
        if (x < 1) { less = anyLess ? std::min(less, x) : x; anyLess = true; }
        else more = std::max(more, x);
    }
    return (anyLess ? less : more) * extra;
}

// a table holding the base weights of the rollable mods that pass `keep`
template <class F>
static std::shared_ptr<WeightTable> subTable(const Ctx& c, F keep, const std::string& what) {
    auto t = std::make_shared<WeightTable>();
    t->w.assign(c.pool.mods.size(), 0);
    size_t n = 0;
    for (size_t m = 0; m < t->w.size(); m++)
        if (c.base.w[m] > 0 && keep(m)) { t->w[m] = c.base.w[m]; n++; }
    if (!n) throw std::runtime_error("no rollable mod on this base " + what);
    t->build(c.side, c.infl);
    return t;
}
static std::shared_ptr<WeightTable> tagTable(const Ctx& c, const std::string& tag) {
    return subTable(c, [&](size_t m) { return c.pool.mods[m].hasTag(tag); }, "has tag '" + tag + "'");
}
static std::shared_ptr<WeightTable> inflTable(const Ctx& c, uint8_t bits) {
    return subTable(c, [&](size_t m) { return (c.infl[m] & bits) != 0; },
                    "is a " + inflNames(bits) + " mod (recompile the pool with this compile_pool.py)");
}
static int findMeta(const Ctx& c, Meta meta) {
    for (auto& b : c.pool.bench)
        if (c.pool.mods[b.mod].meta == meta) return b.mod;
    return -1;
}
static uint8_t needInflName(const std::string& s, const std::string& what) {
    uint8_t b = inflBit(s);
    if (!b) throw std::runtime_error(what + ": unknown influence '" + s + "' (shaper elder crusader redeemer hunter warlord)");
    return b;
}

MethodPtr makeMethod(Ctx& c, const std::string& nameIn) {
    const Config* cfg = gCfg;
    std::string name = trim(nameIn);
    if (name.find(',') != std::string::npos) {
        auto m = std::make_shared<SeqMethod>();
        m->name = name;
        for (auto& p : split(name, ',')) {
            m->seq.push_back(makeMethod(c, p));
            m->cost += m->seq.back()->cost;
        }
        return m;
    }
    std::string ln = lower(name);
    auto spec = [&](RerollSpec& s, uint8_t out, const CountDist* cnt) {
        s.wt = &c.base;
        s.rarityOut = out;
        s.count = cnt;
        s.lockSurvives = c.rules.lockSurvivesChaos;
    };
    auto reroll = [&](const std::string& key, uint8_t in, uint8_t out, const CountDist* cnt) {
        auto m = std::make_shared<RerollMethod>();
        m->name = name;
        spec(m->spec, out, cnt);
        m->inRarity = in;
        m->cost = costKey(c, cfg, key);
        return m;
    };
    if (ln == "chaos") return reroll("cost.chaos", rmask({RARE}), RARE, &c.rules.countRare);
    if (ln == "alch") return reroll("cost.alch", rmask({NORMAL}), RARE, &c.rules.countRare);
    if (ln == "transmute") return reroll("cost.transmute", rmask({NORMAL}), MAGIC, &c.rules.countMagic);
    if (ln == "alt") return reroll("cost.alt", rmask({MAGIC}), MAGIC, &c.rules.countMagic);
    auto adder = [&](const std::string& key, uint8_t in, uint8_t out) {
        auto m = std::make_shared<AddMethod>();
        m->name = name; m->wt = &c.base; m->inRarity = in; m->outRarity = out;
        m->cost = costKey(c, cfg, key);
        return m;
    };
    if (ln == "aug") return adder("cost.aug", rmask({MAGIC}), MAGIC);
    if (ln == "regal") return adder("cost.regal", rmask({MAGIC}), RARE);
    if (ln == "exalt") return adder("cost.exalt", rmask({RARE}), RARE);
    if (ln == "annul") { auto m = std::make_shared<AnnulMethod>(); m->name = name; m->cost = costKey(c, cfg, "cost.annul"); return m; }
    if (ln == "scour") { auto m = std::make_shared<ScourMethod>(); m->name = name; m->cost = costKey(c, cfg, "cost.scour"); return m; }
    if (ln == "altaug") {
        auto m = std::make_shared<AltAugMethod>();
        m->name = name; m->alt = makeMethod(c, "alt"); m->aug = makeMethod(c, "aug");
        m->cost = m->alt->cost;
        return m;
    }
    if (ln.rfind("exalt:", 0) == 0) {  // influence Exalted Orbs
        auto m = std::make_shared<InflAddMethod>();
        m->name = name;
        m->bit = needInflName(ln.substr(6), name);
        m->own = inflTable(c, m->bit);
        m->cost = costKey(c, cfg, "cost.exalt." + std::string(kInflName[std::countr_zero(m->bit)]));
        return m;
    }
    if (ln.rfind("awaken:", 0) == 0) {
        auto m = std::make_shared<AwakenMethod>();
        m->name = name;
        for (auto& x : split(name.substr(7), ':')) {
            if (uint8_t b = inflBit(x)) { m->donorBit = b; continue; }
            int k = c.pool.find(trim(x));
            if (k < 0) throw std::runtime_error(name + ": '" + x + "' is neither an influence nor a mod id");
            if (!c.infl[k]) throw std::runtime_error(name + ": donor mod " + x + " is not an influence mod");
            m->donorMod = k;
        }
        if (m->donorMod >= 0) {
            uint8_t mi = c.infl[m->donorMod];
            if (!m->donorBit) m->donorBit = (uint8_t)(mi & -mi);
            else if (!(mi & m->donorBit)) throw std::runtime_error(name + ": the donor mod has another influence");
        }
        if (!m->donorBit) throw std::runtime_error(name + ": name the donor's influence, e.g. awaken:hunter[:<mod id>]");
        spec(m->spec, RARE, &c.rules.countAwaken);
        m->spec.keepAll = true;        // the pre-step leaves exactly the kept influence mods
        m->spec.honourLocks = false;   // ignores metamods (A1.4)
        m->cost = costKey(c, cfg, "cost.awaken");
        return m;
    }
    if (ln == "dominance") {
        auto m = std::make_shared<DominanceMethod>();
        m->name = name;
        m->armour = isArmourClass(c.pool.itemClass);
        if (!m->armour) std::fprintf(stderr, "warning: the Orb of Dominance only works on body armours, helmets, gloves and boots\n");
        m->cost = costKey(c, cfg, "cost.dominance");
        return m;
    }
    if (ln == "fracture") {
        auto m = std::make_shared<FractureMethod>();
        m->name = name; m->cost = costKey(c, cfg, "cost.fracture");
        return m;
    }
    if (ln == "conflict") {
        auto m = std::make_shared<ConflictMethod>();
        m->name = name; m->dist = &c.rules.conflict; m->cost = costKey(c, cfg, "cost.conflict");
        return m;
    }
    if (ln.rfind("eldritch:", 0) == 0) {
        std::string rest = ln.substr(9);
        if (rest == "chaos") {
            auto m = std::make_shared<EldritchChaosMethod>();
            m->name = name;
            for (RerollSpec* s : {&m->pre, &m->suf}) {
                spec(*s, RARE, &c.rules.countRare);
                s->honourLocks = c.rules.eldritchChaosLocks;
            }
            m->pre.keepS = true; m->pre.sides = 1;  // Exarch: new prefixes, suffixes stay
            m->suf.keepP = true; m->suf.sides = 2;  // Eater: new suffixes, prefixes stay
            m->cost = costKey(c, cfg, "cost.eldritch.chaos");
            return m;
        }
        if (rest == "exalt") {
            auto m = adder("cost.eldritch.exalt", rmask({RARE}), RARE);
            m->dominantSide = true;
            return m;
        }
        if (rest == "annul") {
            auto m = std::make_shared<AnnulMethod>();
            m->name = name; m->dominantSide = true; m->cost = costKey(c, cfg, "cost.eldritch.annul");
            return m;
        }
        throw std::runtime_error("unknown Eldritch method: " + name + " (eldritch:chaos | eldritch:exalt | eldritch:annul)");
    }
    if (ln.rfind("essence:", 0) == 0) {
        std::string want = norm(name.substr(8));
        const Essence* hit = nullptr;
        std::vector<const Essence*> partial;
        for (auto& e : c.pool.essences) {
            if (lower(e.name) == want) hit = &e;
            else if (lower(e.name).find(want) != std::string::npos) partial.push_back(&e);
        }
        if (!hit && partial.size() == 1) hit = partial[0];
        if (!hit) {
            std::string msg = "essence not usable on this base or ambiguous: " + want;
            for (auto* p : partial) msg += "\n  candidate: " + p->name;
            throw std::runtime_error(msg);
        }
        bool onRare = hit->level == 0 || hit->level >= c.rules.essRareMinLevel;
        auto m = reroll("cost.chaos", onRare ? rmask({NORMAL, RARE}) : rmask({NORMAL}), RARE, &c.rules.countRare);
        m->name = "essence:" + hit->name;
        if (hit->maxLvl > 0) {  // low-tier essence: random mods roll as if the item level were maxLvl (C3)
            m->own = subTable(c, [&](size_t i) { return c.pool.mods[i].reqlvl <= hit->maxLvl; }, "below the essence level cap");
            m->spec.wt = m->own.get();
        }
        m->spec.forced = {hit->mod};
        m->blockedByMeta = true;
        m->cost = c.prices.get(hit->name);
        return m;
    }
    if (ln.rfind("fossil:", 0) == 0) {
        auto names = split(name.substr(7), '+');
        if (names.size() > 4) throw std::runtime_error("at most 4 fossils");
        auto m = reroll("cost.chaos", rmask({NORMAL, MAGIC, RARE}), RARE, &c.rules.countRare);
        m->blockedByMeta = true;
        m->own = std::make_shared<WeightTable>();
        m->own->w = c.base.w;
        double cost = 0;
        std::vector<const Fossil*> used;
        std::string full = "fossil:";
        for (size_t k = 0; k < names.size(); k++) {
            std::string want = norm(names[k]);
            if (want.find("fossil") == std::string::npos) want += " fossil";
            const Fossil* f = nullptr;
            for (auto& x : c.pool.fossils) if (lower(x.name) == want) f = &x;
            if (!f) throw std::runtime_error("fossil not usable on this base: " + want);
            used.push_back(f);
            if (!f->modelled) std::fprintf(stderr, "warning: %s: %s\n", f->name.c_str(), f->note.c_str());
            for (int a : f->added) m->own->w[a] = std::max(m->own->w[a], c.pool.mods[a].weight);
            for (int fm : f->forced) m->spec.forced.push_back(fm);
            cost += c.prices.get(f->name);
            full += (k ? "+" : "") + f->name.substr(0, f->name.find(' '));
        }
        // fossil multipliers (docs C4): each fossil affects a mod once - a matching "less/no" tag wins,
        // else the largest matching "more" tag. Several fossils multiply (fossil.stack = multiplicative)
        // or add their "more" bonuses (additive; "less" multipliers still multiply).
        for (size_t i = 0; i < m->own->w.size(); i++) {
            if (m->own->w[i] <= 0) continue;
            double prod = 1, bonus = 0;
            for (const Fossil* f : used) {
                double x = fossilFactor(*f, c.pool.mods[i], c.rules.fossilScale);
                if (c.rules.fossilAdditive && x > 1) bonus += x - 1;
                else prod *= x;
            }
            m->own->w[i] *= prod * (1 + bonus);
        }
        m->own->build(c.side, c.infl);
        m->spec.wt = m->own.get();
        m->cost = cost + costKey(c, cfg, "cost.resonator." + std::to_string(names.size()));
        m->name = full;
        return m;
    }
    if (ln.rfind("harvest:", 0) == 0) {
        std::string rest = ln.substr(8);
        if (rest.rfind("tag:", 0) == 0) {
            std::string t = rest.substr(4);
            auto m = reroll("cost.harvest.tag." + t, rmask({NORMAL, MAGIC, RARE}), RARE, &c.rules.countRare);
            m->ownFirst = tagTable(c, harvestTag(c, t));
            m->spec.first = m->ownFirst.get();
            return m;
        }
        if (rest == "influence") {  // "Reforge an Influenced Rare item ... including an Influence modifier"
            auto m = reroll("cost.harvest.influence", rmask({RARE}), RARE, &c.rules.countRare);
            m->needInfl = 1;
            m->ownFirst = inflTable(c, (1u << NINFL) - 1);  // filtered to the item's influences when drawn
            m->spec.first = m->ownFirst.get();
            return m;
        }
        if (rest == "randomise_influence" || rest == "randomize_influence") {
            auto m = std::make_shared<RandInflMethod>();
            m->name = name;
            spec(m->spec[NORMAL], NORMAL, &c.rules.countNone);
            spec(m->spec[MAGIC], MAGIC, &c.rules.countMagic);
            spec(m->spec[RARE], RARE, &c.rules.countRare);
            m->exclude = c.rules.randInflExcludeCurrent;
            m->avail = c.pool.avail;
            m->cost = costKey(c, cfg, "cost.harvest.randomise_influence");
            return m;
        }
        if (rest == "more" || rest == "less") {
            auto m = reroll("cost.harvest." + rest, rmask({RARE}), RARE, &c.rules.countRare);
            bool more = rest == "more";
            m->spec.sameTypeMult = more ? c.rules.harvSameMore : c.rules.harvSameLess;
            m->spec.keepCount = more ? c.rules.harvMoreKeepCount : c.rules.harvLessKeepCount;
            return m;
        }
        if (rest == "keep_prefixes" || rest == "keep_suffixes") {
            if (!c.rules.harvKeep) throw std::runtime_error(name + " is not available in this patch (harvest.available.keep = 0)");
            auto m = reroll("cost.harvest." + rest, rmask({RARE}), RARE, &c.rules.countRare);
            (rest == "keep_prefixes" ? m->spec.keepP : m->spec.keepS) = true;
            return m;
        }
        if (rest.rfind("addremove:", 0) == 0) {
            std::string t = rest.substr(10);
            auto m = std::make_shared<AddRemoveMethod>();
            m->name = name;
            m->own = tagTable(c, harvestTag(c, t));
            m->wt = m->own.get();
            m->needNoInfl = true;
            m->cost = costKey(c, cfg, "cost.harvest.addremove." + t);
            return m;
        }
        throw std::runtime_error("unknown harvest craft: " + name);
    }
    if (ln.rfind("bench:", 0) == 0 || ln == "lockprefix" || ln == "locksuffix" || ln == "multimod" || ln == "noattack" ||
        ln == "nocaster") {
        if (ln == "bench:remove") {
            auto m = std::make_shared<BenchRemoveMethod>();
            m->name = name; m->cost = costKey(c, cfg, "cost.bench.remove");
            return m;
        }
        int mod = -1;
        if (ln == "lockprefix") mod = findMeta(c, M_LOCKP);
        else if (ln == "locksuffix") mod = findMeta(c, M_LOCKS);
        else if (ln == "multimod") mod = findMeta(c, M_MULTI);
        else if (ln == "noattack") mod = findMeta(c, M_NOATTACK);
        else if (ln == "nocaster") mod = findMeta(c, M_NOCASTER);
        else mod = c.pool.find(name.substr(6));
        const Bench* b = nullptr;
        for (auto& x : c.pool.bench) if (x.mod == mod) b = &x;
        if (mod < 0 || !b) throw std::runtime_error("no bench craft for this base: " + name);
        auto m = std::make_shared<BenchMethod>();
        m->name = name; m->mod = mod; m->cost = c.prices.recipe(b->cost);
        return m;
    }
    if (ln.rfind("beast:", 0) == 0) {
        std::string rest = ln.substr(6);
        if (rest == "imprint") { auto m = std::make_shared<ImprintMethod>(); m->name = name; m->cost = costKey(c, cfg, "cost.beast.imprint"); return m; }
        if (rest == "restore") { auto m = std::make_shared<RestoreMethod>(); m->name = name; m->cost = costKey(c, cfg, "cost.beast.restore"); return m; }
        if (rest == "prefix_remove_suffix" || rest == "suffix_remove_prefix") {
            auto m = std::make_shared<AddRemoveMethod>();
            m->name = name; m->wt = &c.base;
            bool p = rest == "prefix_remove_suffix";
            m->addSides = p ? 1 : 2;
            m->removeSide = p ? SUF : PRE;
            m->cost = costKey(c, cfg, "cost.beast." + rest);
            return m;
        }
        if (rest == "meta") {
            auto m = std::make_shared<BeastMetaMethod>();
            m->name = name; m->cost = costKey(c, cfg, "cost.beast.meta");
            static const std::pair<const char*, Meta> metas[] = {
                {"lockP", M_LOCKP}, {"lockS", M_LOCKS}, {"multi", M_MULTI}, {"noattack", M_NOATTACK}, {"nocaster", M_NOCASTER}};
            for (auto& o : c.rules.beastMeta)
                for (auto& [n, v] : metas)
                    if (o == n) { int k = findMeta(c, v); if (k >= 0) m->mods.push_back(k); }
            if (m->mods.empty()) throw std::runtime_error("beast:meta: no metamods for this base");
            return m;
        }
        if (rest == "aspect") {
            auto m = std::make_shared<AspectMethod>();
            m->name = name; m->mod = c.pool.find("GrantsCatAspectCrafted");
            if (m->mod < 0) throw std::runtime_error("aspect mod missing from pool");
            m->cost = costKey(c, cfg, "cost.beast.aspect");
            return m;
        }
        if (rest.rfind("influence:", 0) == 0) {  // B04 "Add a Mod to a <influence> Item"
            auto m = std::make_shared<InflAddMethod>();
            m->name = name;
            m->bit = needInflName(rest.substr(10), name);
            m->setInfl = false;
            m->own = inflTable(c, m->bit);
            m->cost = costKey(c, cfg, "cost.beast.influence." + std::string(kInflName[std::countr_zero(m->bit)]));
            return m;
        }
        throw std::runtime_error("unknown beastcraft: " + name);
    }
    throw std::runtime_error("unknown method: " + name);
}

}  // namespace pc
