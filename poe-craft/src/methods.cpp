// Crafting methods. Every method is a Method: applicable(state), apply(state, rng) -> chaos spent
// (one sampled transition, allocation-free), and where the next-state distribution is small,
// outcomes(state) -> exact list of (next state, probability). Rerolls expose a RerollSpec instead,
// which exact.cpp turns into an exact success probability.
//
// Method names (CLI, routes and rank all use these; spaces in names may be written as '_'):
//   chaos alch transmute alt aug regal exalt annul scour altaug
//   essence:<essence name>              fossil:<a>[+<b>...]   (e.g. fossil:dense+frigid)
//   bench:<mod id> | bench:remove | lockprefix | locksuffix | multimod | noattack | nocaster
//   harvest:tag:<tag> | harvest:more | harvest:less | harvest:addremove:<tag>
//   harvest:keep_prefixes | harvest:keep_suffixes   (only if harvest.available.keep = 1)
//   beast:imprint | beast:restore | beast:prefix_remove_suffix | beast:suffix_remove_prefix
//   beast:meta | beast:aspect
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
    ItemFlags f = c.flags(from);
    bool lockP = sp.honourLocks && f.lockP, lockS = sp.honourLocks && f.lockS;
    bool keepP = sp.keepP || lockP, keepS = sp.keepS || lockS;
    for (int i = 0; i < from.n; i++) {
        int m = from.m[i];
        bool keep = c.side[m] == PRE ? keepP : keepS;
        if (!keep && sp.lockSurvives && ((c.meta[m] == M_LOCKP && lockP) || (c.meta[m] == M_LOCKS && lockS))) keep = true;
        if (keep) o.add(m);
    }
    rs.kept = o.n;
    if (!c.rules.lockedSideCanFill) {
        if (lockP) rs.sideMask &= ~1;
        if (lockS) rs.sideMask &= ~2;
    }
    for (int m : sp.forced)
        if (c.count(o, c.side[m]) < c.capFor(o.rarity, c.side[m]) && !c.blocked(o, m) && o.n < MAXA) o.add(m);
    return rs;
}

void doReroll(const Ctx& c, Item& it, const RerollSpec& sp, Rng& r) {
    uint16_t bg[2 * MAXA];
    int nb = 0;
    if (sp.sameTypeMult != 1)
        for (int i = 0; i < it.n; i++) {
            bg[nb++] = c.g0[it.m[i]];
            if (c.g1[it.m[i]] != 0xffff) bg[nb++] = c.g1[it.m[i]];
        }
    RerollStart rs = rerollStart(c, it, sp);
    Item o = rs.start;
    int n = sp.count->sample(r);
    if (rs.kept > 0) n = std::max(n, rs.kept + c.rules.minNew);
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

// can a crafted mod be added right now?
static bool canCraft(const Ctx& c, const Item& it, int mod) {
    if (it.rarity == NORMAL) return false;
    if (!c.open(it, c.side[mod]) || c.blocked(it, mod)) return false;
    ItemFlags f = c.flags(it);
    int limit = f.multi ? c.rules.craftedLimitMulti : c.rules.craftedLimit;
    return f.crafted < limit;
}
// is mod index i (position in item) protected from removal (lock metamods; crafted rule)
static bool removable(const Ctx& c, const Item& it, int pos, const ItemFlags& f, bool craftedOk) {
    int m = it.m[pos];
    if (c.side[m] == PRE && f.lockP) return false;
    if (c.side[m] == SUF && f.lockS) return false;
    if (c.kind[m] == K_C && !craftedOk) return false;
    return true;
}
// enumerate "add one random mod from wt" outcomes
static void addOutcomes(const Ctx& c, const State& s, const WeightTable& wt, uint8_t rarityOut, double pIn,
                        std::vector<Outcome>& out, uint8_t sideMask = 3) {
    State base = s;
    base.it.rarity = rarityOut;
    ItemFlags f = c.flags(base.it);
    double tot = 0;
    for (size_t m = 0; m < wt.w.size(); m++)
        if (wt.w[m] > 0 && (sideMask >> c.side[m] & 1) && c.open(base.it, c.side[m]) && c.eligible(base.it, (int)m, f)) tot += wt.w[m];
    if (tot <= 0) { out.push_back({base, pIn}); return; }
    for (size_t m = 0; m < wt.w.size(); m++)
        if (wt.w[m] > 0 && (sideMask >> c.side[m] & 1) && c.open(base.it, c.side[m]) && c.eligible(base.it, (int)m, f)) {
            State n = base;
            n.it.add((int)m);
            out.push_back({n, pIn * wt.w[m] / tot});
        }
}

// ------------------------------------------------------------------ reroll methods
struct RerollMethod : Method {
    RerollSpec spec;
    uint8_t inRarity = 0;     // bitmask of allowed input rarities
    bool blockedByMeta = false;  // essences / fossils refuse items with outcome metamods
    std::shared_ptr<WeightTable> own, ownFirst;  // tables owned by this method (fossils / harvest)
    bool applicable(const Ctx& c, const State& s) const override {
        if (!(inRarity >> s.it.rarity & 1)) return false;
        if (blockedByMeta && c.rules.metaBlocksEF && hasOutcomeMeta(c.flags(s.it))) return false;
        return true;
    }
    double apply(const Ctx& c, State& s, Rng& r) const override {
        doReroll(c, s.it, spec, r);
        return cost;
    }
    const RerollSpec* reroll() const override { return spec.sameTypeMult == 1 ? &spec : nullptr; }
};

// ------------------------------------------------------------------ add-one methods (aug/regal/exalt)
struct AddMethod : Method {
    const WeightTable* wt = nullptr;
    uint8_t inRarity = 0, outRarity = RARE;
    bool applicable(const Ctx& c, const State& s) const override {
        if (!(inRarity >> s.it.rarity & 1)) return false;
        Item t = s.it;
        t.rarity = outRarity;
        return c.open(t, PRE) || c.open(t, SUF);
    }
    double apply(const Ctx& c, State& s, Rng& r) const override {
        s.it.rarity = outRarity;
        int m = c.draw(s.it, *wt, 3, r);
        if (m >= 0) s.it.add(m);
        return cost;
    }
    bool outcomes(const Ctx& c, const State& s, std::vector<Outcome>& out) const override {
        addOutcomes(c, s, *wt, outRarity, 1.0, out);
        return true;
    }
};

struct AnnulMethod : Method {
    bool applicable(const Ctx& c, const State& s) const override {
        if (s.it.rarity == NORMAL) return false;
        ItemFlags f = c.flags(s.it);
        for (int i = 0; i < s.it.n; i++) if (removable(c, s.it, i, f, c.rules.annulCrafted)) return true;
        return false;
    }
    double apply(const Ctx& c, State& s, Rng& r) const override {
        ItemFlags f = c.flags(s.it);
        int cand[MAXA], k = 0;
        for (int i = 0; i < s.it.n; i++) if (removable(c, s.it, i, f, c.rules.annulCrafted)) cand[k++] = i;
        if (k) s.it.removeAt(cand[r.below(k)]);
        return cost;
    }
    bool outcomes(const Ctx& c, const State& s, std::vector<Outcome>& out) const override {
        ItemFlags f = c.flags(s.it);
        int k = 0;
        for (int i = 0; i < s.it.n; i++) k += removable(c, s.it, i, f, c.rules.annulCrafted);
        for (int i = 0; i < s.it.n; i++)
            if (removable(c, s.it, i, f, c.rules.annulCrafted)) {
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
        Item o;
        o.rarity = it.rarity;
        for (int i = 0; i < it.n; i++) if (!removable(c, it, i, f, true)) o.add(it.m[i]);
        if (o.n == 0) o.rarity = NORMAL;
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
        Item o;
        o.rarity = it.rarity;
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
    int removeSide = -1;  // -1 any side
    bool needRemoval = true;
    bool applicable(const Ctx& c, const State& s) const override {
        if (s.it.rarity != RARE) return false;
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
static double costKey(Ctx& c, const Config* cfg, const std::string& key);

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

static std::shared_ptr<WeightTable> tagTable(const Ctx& c, const std::string& tag) {
    auto t = std::make_shared<WeightTable>();
    t->w.assign(c.pool.mods.size(), 0);
    size_t n = 0;
    for (size_t m = 0; m < t->w.size(); m++)
        if (c.base.w[m] > 0 && c.pool.mods[m].hasTag(tag)) { t->w[m] = c.base.w[m]; n++; }
    if (!n) throw std::runtime_error("no rollable mod on this base has tag '" + tag + "'");
    t->build(c.side);
    return t;
}
static int findMeta(const Ctx& c, Meta meta) {
    for (auto& b : c.pool.bench)
        if (c.pool.mods[b.mod].meta == meta) return b.mod;
    return -1;
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
    auto reroll = [&](const char* key, uint8_t in, uint8_t out, const CountDist* cnt) {
        auto m = std::make_shared<RerollMethod>();
        m->name = name;
        m->spec.wt = &c.base;
        m->spec.rarityOut = out;
        m->spec.count = cnt;
        m->spec.lockSurvives = c.rules.lockSurvivesChaos;
        m->inRarity = in;
        m->cost = costKey(c, cfg, key);
        return m;
    };
    if (ln == "chaos") return reroll("cost.chaos", rmask({RARE}), RARE, &c.rules.countRare);
    if (ln == "alch") return reroll("cost.alch", rmask({NORMAL}), RARE, &c.rules.countRare);
    if (ln == "transmute") return reroll("cost.transmute", rmask({NORMAL}), MAGIC, &c.rules.countMagic);
    if (ln == "alt") return reroll("cost.alt", rmask({MAGIC}), MAGIC, &c.rules.countMagic);
    auto adder = [&](const char* key, uint8_t in, uint8_t out) {
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
            m->own = std::make_shared<WeightTable>();
            m->own->w = c.base.w;
            for (size_t i = 0; i < m->own->w.size(); i++)
                if (c.pool.mods[i].reqlvl > hit->maxLvl) m->own->w[i] = 0;
            m->own->build(c.side);
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
        m->own->build(c.side);
        m->spec.wt = m->own.get();
        m->cost = cost + costKey(c, cfg, "cost.resonator." + std::to_string(names.size()));
        m->name = full;
        return m;
    }
    if (ln.rfind("harvest:", 0) == 0) {
        std::string rest = ln.substr(8);
        if (rest.rfind("tag:", 0) == 0) {
            std::string t = rest.substr(4);
            auto m = reroll(("cost.harvest.tag." + t).c_str(), rmask({NORMAL, MAGIC, RARE}), RARE, &c.rules.countRare);
            m->ownFirst = tagTable(c, harvestTag(c, t));
            m->spec.first = m->ownFirst.get();
            return m;
        }
        if (rest == "more" || rest == "less") {
            auto m = reroll(("cost.harvest." + rest).c_str(), rmask({RARE}), RARE, &c.rules.countRare);
            m->spec.sameTypeMult = rest == "more" ? c.rules.harvSameMore : c.rules.harvSameLess;
            return m;
        }
        if (rest == "keep_prefixes" || rest == "keep_suffixes") {
            if (!c.rules.harvKeep) throw std::runtime_error(name + " is not available in this patch (harvest.available.keep = 0)");
            auto m = reroll(("cost.harvest." + rest).c_str(), rmask({RARE}), RARE, &c.rules.countRare);
            (rest == "keep_prefixes" ? m->spec.keepP : m->spec.keepS) = true;
            return m;
        }
        if (rest.rfind("addremove:", 0) == 0) {
            std::string t = rest.substr(10);
            auto m = std::make_shared<AddRemoveMethod>();
            m->name = name;
            m->own = tagTable(c, harvestTag(c, t));
            m->wt = m->own.get();
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
        throw std::runtime_error("unknown beastcraft: " + name);
    }
    throw std::runtime_error("unknown method: " + name);
}

}  // namespace pc
