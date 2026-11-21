// Loading: pool file, mechanics.cfg, prices; Ctx hot-path helpers; targets and conditions.
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>

#include "core.hpp"

namespace pc {

std::vector<std::string> split(const std::string& s, char sep) {
    std::vector<std::string> out;
    size_t a = 0;
    for (;;) {
        size_t b = s.find(sep, a);
        out.push_back(s.substr(a, b == std::string::npos ? std::string::npos : b - a));
        if (b == std::string::npos) break;
        a = b + 1;
    }
    return out;
}
std::vector<std::string> splitWs(const std::string& s) {
    std::vector<std::string> out;
    std::istringstream is(s);
    std::string w;
    while (is >> w) out.push_back(w);
    return out;
}
std::string trim(const std::string& s) {
    size_t a = s.find_first_not_of(" \t\r\n"), b = s.find_last_not_of(" \t\r\n");
    return a == std::string::npos ? "" : s.substr(a, b - a + 1);
}
std::string lower(std::string s) {
    for (auto& c : s) c = (char)tolower((unsigned char)c);
    return s;
}
static std::vector<std::string> readLines(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("cannot open " + path);
    std::vector<std::string> v;
    std::string l;
    while (std::getline(f, l)) {
        if (!l.empty() && l.back() == '\r') l.pop_back();
        v.push_back(l);
    }
    return v;
}
static std::vector<std::string> listField(const std::string& s) {
    if (s == "-" || s.empty()) return {};
    return split(s, ',');
}

// ------------------------------------------------------------------ influences
uint8_t inflBit(const std::string& nameIn) {
    std::string n = lower(trim(nameIn));
    for (int i = 0; i < NINFL; i++)
        if (n == kInflName[i]) return (uint8_t)(1u << i);
    // the game's internal tag names (helmet_eyrie, ...)
    if (n == "eyrie") return 1u << 3;
    if (n == "basilisk") return 1u << 4;
    if (n == "adjudicator") return 1u << 5;
    return 0;
}
std::string inflNames(uint8_t mask) {
    std::string s;
    for (int i = 0; i < NINFL; i++)
        if (mask >> i & 1) s += (s.empty() ? "" : "+") + std::string(kInflName[i]);
    return s.empty() ? "-" : s;
}
static uint8_t inflField(const std::string& field) {  // "shaper,hunter" or "-"
    uint8_t m = 0;
    for (auto& x : listField(field)) {
        uint8_t b = inflBit(x);
        if (!b) throw std::runtime_error("unknown influence '" + x + "'");
        m |= b;
    }
    return m;
}

// ------------------------------------------------------------------ pool
Pool Pool::load(const std::string& path) {
    Pool p;
    std::unordered_map<std::string, uint16_t> gid;
    bool availSeen = false;
    for (auto& line : readLines(path)) {
        if (line.empty() || line[0] == '#') continue;
        auto f = split(line, '\t');
        const std::string& rec = f[0];
        if (rec == "H" && f.size() >= 3) {
            if (f[1] == "base" && f.size() >= 6) {
                p.base = f[2]; p.itemClass = f[3]; p.ilvl = std::atoi(f[4].c_str()); p.influences = f[5];
                p.defInfl = inflField(f[5]);
            } else if (f[1] == "tags") {
                p.baseTags = listField(f[2]);
            } else if (f[1] == "influences") {
                p.avail = inflField(f[2]);
                availSeen = true;
            }
        } else if (rec == "M") {
            if (f.size() < 14) throw std::runtime_error("bad M record: " + line);
            Mod m;
            int idx = std::atoi(f[1].c_str());
            if (idx != (int)p.mods.size()) throw std::runtime_error("M records out of order");
            m.id = f[2];
            m.side = f[3] == "P" ? PRE : SUF;
            switch (f[4][0]) {
                case 'R': m.kind = K_R; break; case 'E': m.kind = K_E; break; case 'D': m.kind = K_D; break;
                case 'C': m.kind = K_C; break; case 'V': m.kind = K_V; break; default: m.kind = K_A; break;
            }
            m.weight = std::atof(f[5].c_str());
            m.groups = listField(f[6]);
            m.tags = listField(f[7]);
            m.type = f[8];
            m.tier = std::atoi(f[9].c_str()); m.ntiers = std::atoi(f[10].c_str()); m.reqlvl = std::atoi(f[11].c_str());
            static const std::pair<const char*, Meta> metas[] = {
                {"lockP", M_LOCKP}, {"lockS", M_LOCKS}, {"lockP1", M_LOCKP1}, {"lockP2", M_LOCKP2}, {"lockS1", M_LOCKS1},
                {"lockS2", M_LOCKS2}, {"multi", M_MULTI}, {"noattack", M_NOATTACK}, {"nocaster", M_NOCASTER}};
            for (auto& [n, v] : metas) if (f[12] == n) m.meta = v;
            m.text = f[13];
            if (f.size() >= 15) m.infl = inflField(f[14]);         // pool v2: influence of the mod
            if (f.size() >= 16 && f[15] != "-") m.upId = f[15];    // pool v2: Orb of Dominance upgrade
            for (auto& g : m.groups) {
                auto it = gid.find(g);
                uint16_t id;
                if (it == gid.end()) { id = (uint16_t)p.groupNames.size(); gid[g] = id; p.groupNames.push_back(g); }
                else id = it->second;
                if (m.ngrp < 2) m.grp[m.ngrp++] = id;
            }
            if (m.ngrp == 0) {  // ungrouped mod: give it a private group so the same mod can't stack
                uint16_t id = (uint16_t)p.groupNames.size();
                p.groupNames.push_back("#" + m.id);
                m.grp[m.ngrp++] = id;
            }
            p.byId[m.id] = idx;
            p.mods.push_back(std::move(m));
        } else if (rec == "E" && f.size() >= 3) {
            Essence e{f[1], std::atoi(f[2].c_str())};
            if (f.size() >= 5) { e.level = std::atoi(f[3].c_str()); e.maxLvl = std::atoi(f[4].c_str()); }
            p.essences.push_back(e);
        } else if (rec == "F" && f.size() >= 7) {
            Fossil fo;
            fo.name = f[1];
            fo.modelled = f[2] == "1";
            for (auto& kv : listField(f[3])) {
                auto e = kv.find('=');
                fo.wm.push_back({kv.substr(0, e), std::atof(kv.c_str() + e + 1)});
            }
            for (auto& x : listField(f[4])) fo.added.push_back(std::atoi(x.c_str()));
            for (auto& x : listField(f[5])) fo.forced.push_back(std::atoi(x.c_str()));
            fo.note = f[6];
            p.fossils.push_back(std::move(fo));
        } else if (rec == "B" && f.size() >= 3) {
            p.bench.push_back({std::atoi(f[1].c_str()), f[2]});
        }
    }
    if (p.mods.empty()) throw std::runtime_error("pool has no mods: " + path);
    if (p.mods.size() >= 0xffff) throw std::runtime_error("pool too large");
    if (!availSeen) {  // v1 pool or hand-made: the influences its mods use, else all six
        for (auto& m : p.mods) p.avail |= m.infl;
        if (!p.avail) p.avail = (1u << NINFL) - 1;
    }
    for (auto& m : p.mods)
        if (!m.upId.empty() && p.find(m.upId) < 0) throw std::runtime_error("pool: unknown upgrade mod " + m.upId);
    return p;
}

// ------------------------------------------------------------------ config / prices / rules
Config Config::load(const std::string& path) {
    Config c;
    for (auto& raw : readLines(path)) {
        auto l = raw.substr(0, raw.find('#'));
        auto e = l.find('=');
        if (e == std::string::npos) continue;
        c.kv[trim(l.substr(0, e))] = trim(l.substr(e + 1));
    }
    return c;
}
std::string Config::str(const std::string& k, const std::string& def) const {
    auto it = kv.find(k);
    return it == kv.end() ? def : it->second;
}
double Config::num(const std::string& k, double def) const {
    auto it = kv.find(k);
    return it == kv.end() ? def : std::atof(it->second.c_str());
}
Prices Prices::load(const std::string& path, const Config& cfg) {
    Prices p;
    try {
        for (auto& l : readLines(path)) {
            if (l.empty() || l[0] == '#') continue;
            auto t = l.find('\t');
            if (t != std::string::npos) p.chaos[l.substr(0, t)] = std::atof(l.c_str() + t + 1);
        }
    } catch (std::exception& e) {
        std::fprintf(stderr, "warning: %s (run prices.py); costs may be missing\n", e.what());
    }
    for (auto& [k, v] : cfg.kv)
        if (k.rfind("price.", 0) == 0) p.chaos[k.substr(6)] = std::atof(v.c_str());
    p.chaos["Chaos Orb"] = 1.0;
    return p;
}
double Prices::get(const std::string& name) {
    auto it = chaos.find(name);
    if (it != chaos.end()) return it->second;
    if (std::find(missing.begin(), missing.end(), name) == missing.end()) missing.push_back(name);
    return NAN;
}
double Prices::recipe(const std::string& r) {
    std::string s = trim(r);
    if (s.empty() || s == "-") return NAN;
    char* end = nullptr;
    double v = std::strtod(s.c_str(), &end);
    if (end && trim(end).empty()) return v;  // plain number = chaos
    double total = 0;
    for (auto& part : split(s, ';')) {
        auto t = trim(part);
        if (t.empty()) continue;
        auto sp = t.find(' ');
        double q = std::atof(t.substr(0, sp).c_str());
        total += q * get(trim(t.substr(sp + 1)));
    }
    return total;
}
CountDist CountDist::parse(const std::string& s) {
    CountDist d;
    double tot = 0;
    for (auto& w : splitWs(s)) {
        auto c = w.find(':');
        if (c == std::string::npos) continue;
        double p = std::atof(w.c_str() + c + 1);
        d.v.push_back({std::atoi(w.substr(0, c).c_str()), p});
        tot += p;
    }
    if (d.v.empty() || tot <= 0) throw std::runtime_error("bad count distribution: " + s);
    for (auto& x : d.v) x.second /= tot;
    return d;
}
Rules Rules::from(const Config& c) {
    Rules r;
    r.countRare = CountDist::parse(c.str("count.rare", "4:8 5:3 6:1"));
    r.countMagic = CountDist::parse(c.str("count.magic", "1:1 2:1"));
    r.countAwaken = CountDist::parse(c.str("count.awaken", c.str("count.rare", "4:8 5:3 6:1")));
    r.countNone = CountDist::parse("0:1");
    auto cr = splitWs(c.str("cap.rare", "3 3")), cm = splitWs(c.str("cap.magic", "1 1"));
    r.capRare[0] = std::atoi(cr.at(0).c_str()); r.capRare[1] = std::atoi(cr.at(1).c_str());
    r.capMagic[0] = std::atoi(cm.at(0).c_str()); r.capMagic[1] = std::atoi(cm.at(1).c_str());
    r.craftedLimit = (int)c.num("crafted.limit", 1);
    r.craftedLimitMulti = (int)c.num("crafted.limit_multimod", 3);
    r.fossilScale = c.num("fossil.weight_scale", 100);
    r.lockedSideCanFill = c.num("meta.locked_side_can_fill", 1) != 0;
    r.lockSurvivesChaos = c.num("meta.lock_survives_chaos", 1) != 0;
    r.annulCrafted = c.num("annul.can_remove_crafted", 1) != 0;
    r.metaBlocksEF = c.num("meta.blocks_essence_fossil", 1) != 0;
    r.minNew = (int)c.num("reroll.min_new", 0);
    {
        std::string st = lower(trim(c.str("fossil.stack", "multiplicative")));
        if (st != "multiplicative" && st != "additive") throw std::runtime_error("fossil.stack must be multiplicative or additive");
        r.fossilAdditive = st == "additive";
    }
    r.essRareMinLevel = (int)c.num("essence.rare_min_level", 5);
    r.harvKeep = c.num("harvest.available.keep", 0) != 0;
    r.harvSameMore = c.num("harvest.same_type_more_mult", 90);
    r.harvSameLess = c.num("harvest.same_type_less_mult", 1.0 / 90);
    r.harvMoreKeepCount = c.num("harvest.more_keeps_count", 1) != 0;
    r.harvLessKeepCount = c.num("harvest.less_keeps_count", 0) != 0;
    r.randInflExcludeCurrent = c.num("harvest.randomise_influence.exclude_current", 0) != 0;
    r.eldritchChaosLocks = c.num("eldritch.chaos_honours_locks", 0) != 0;
    for (auto& [k, v] : c.kv)
        if (k.rfind("harvest.tagalias.", 0) == 0) r.tagAlias[k.substr(17)] = v;
    r.beastMeta = splitWs(c.str("beast.meta_outcomes", "noattack nocaster lockP lockS multi"));
    double tot = 0;
    for (auto& w : splitWs(c.str("eldritch.conflict_outcomes", "exarch:1 eater:1"))) {
        auto k = w.find(':');
        std::string n = lower(w.substr(0, k));
        uint8_t d = n == "exarch" ? DOM_EXARCH : n == "eater" ? DOM_EATER : n == "tie" ? DOM_TIE : 0xff;
        if (d == 0xff || k == std::string::npos) throw std::runtime_error("eldritch.conflict_outcomes: expected exarch:w eater:w tie:w");
        double p = std::atof(w.c_str() + k + 1);
        r.conflict.push_back({d, p});
        tot += p;
    }
    if (tot <= 0) throw std::runtime_error("eldritch.conflict_outcomes: weights sum to 0");
    for (auto& x : r.conflict) x.second /= tot;
    return r;
}

// ------------------------------------------------------------------ alias tables
void Alias::build(const std::vector<double>& w, int sideFilter, const std::vector<uint8_t>& side,
                  const std::vector<uint8_t>& infl, uint8_t mask) {
    idx.clear(); alias.clear(); prob.clear(); total = 0;
    for (size_t i = 0; i < w.size(); i++)
        if (w[i] > 0 && (sideFilter < 0 || side[i] == sideFilter) && (!infl[i] || (infl[i] & mask))) {
            idx.push_back((uint16_t)i);
            total += w[i];
        }
    size_t n = idx.size();
    if (!n) return;
    std::vector<double> q(n);
    std::vector<size_t> small, large;
    for (size_t k = 0; k < n; k++) {
        q[k] = w[idx[k]] * n / total;
        (q[k] < 1 ? small : large).push_back(k);
    }
    prob.assign(n, 1.0);
    std::vector<uint16_t> al(idx);
    while (!small.empty() && !large.empty()) {
        size_t s = small.back(); small.pop_back();
        size_t l = large.back();
        prob[s] = q[s];
        al[s] = idx[l];
        q[l] -= 1 - q[s];
        if (q[l] < 1) { large.pop_back(); small.push_back(l); }
    }
    for (auto k : large) { prob[k] = 1; al[k] = idx[k]; }
    for (auto k : small) { prob[k] = 1; al[k] = idx[k]; }
    alias = std::move(al);
}
void WeightTable::build(const std::vector<uint8_t>& side, const std::vector<uint8_t>& infl) {
    std::lock_guard<std::mutex> g(mu_);
    side_ = &side;
    infl_ = &infl;
    used_ = 0;
    for (size_t i = 0; i < w.size(); i++)
        if (w[i] > 0) used_ |= infl[i];
    for (auto& s : sets_) s.store(nullptr, std::memory_order_relaxed);
    owned_.clear();
}
const AliasSet& WeightTable::slow(uint8_t mask) const {  // first use of an influence mask: build its tables
    std::lock_guard<std::mutex> g(mu_);
    if (const AliasSet* s = sets_[mask].load(std::memory_order_acquire)) return *s;
    if (!side_) throw std::logic_error("WeightTable used before build()");
    auto set = std::make_unique<AliasSet>();
    set->a[0].build(w, -1, *side_, *infl_, mask);
    set->a[1].build(w, PRE, *side_, *infl_, mask);
    set->a[2].build(w, SUF, *side_, *infl_, mask);
    const AliasSet* p = set.get();
    owned_.push_back(std::move(set));
    sets_[mask].store(p, std::memory_order_release);
    return *p;
}

// ------------------------------------------------------------------ Ctx
Ctx::Ctx(const Pool& p, const Rules& r, Prices& pr) : pool(p), rules(r), prices(pr) {
    size_t n = p.mods.size();
    side.resize(n); kind.resize(n); meta.resize(n); isAttack.resize(n); isCaster.resize(n); infl.resize(n);
    g0.resize(n); g1.resize(n); up.assign(n, -1);
    base.w.assign(n, 0);
    for (size_t i = 0; i < n; i++) {
        auto& m = p.mods[i];
        side[i] = m.side; kind[i] = m.kind; meta[i] = m.meta; infl[i] = m.infl;
        isAttack[i] = m.hasTag("attack"); isCaster[i] = m.hasTag("caster");
        g0[i] = m.grp[0]; g1[i] = m.ngrp > 1 ? m.grp[1] : 0xffff;
        if (m.kind == K_R) base.w[i] = m.weight;
        if (!m.upId.empty()) up[i] = p.find(m.upId);
    }
    base.build(side, infl);
}
ItemFlags Ctx::flags(const Item& it) const {
    ItemFlags f;
    for (int i = 0; i < it.n; i++) {
        int m = it.m[i];
        if (kind[m] == K_C) f.crafted++;
        switch (meta[m]) {
            case M_LOCKP: f.lockP = true; break;
            case M_LOCKS: f.lockS = true; break;
            case M_MULTI: f.multi = true; break;
            case M_NOATTACK: f.noAttack = true; break;
            case M_NOCASTER: f.noCaster = true; break;
            default: break;
        }
    }
    return f;
}
int Ctx::draw(const Item& it, const WeightTable& wt, uint8_t sideMask, Rng& r, const uint16_t* bg, int nb,
              double boost) const {
    bool oP = (sideMask & 1) && open(it, PRE), oS = (sideMask & 2) && open(it, SUF);
    if (!oP && !oS) return -1;
    ItemFlags f = flags(it);
    if (nb == 0) {  // fast path: alias draw (influence-filtered table) + rejection = exact conditional sampling
        const AliasSet& as = wt.forMask(it.infl);
        const Alias& a = oP && oS ? as.a[0] : oP ? as.a[1] : as.a[2];
        if (a.total <= 0) return -1;
        for (int t = 0; t < 48; t++) {
            int m = a.sample(r);
            if (eligible(it, m, f)) return m;
        }
    }
    // slow path: explicit scan of the eligible weights
    auto weightOf = [&](size_t m) -> double {
        double w = wt.w[m];
        if (w <= 0) return 0;
        if (side[m] == PRE ? !oP : !oS) return 0;
        if (!eligible(it, (int)m, f)) return 0;
        for (int k = 0; k < nb; k++)
            if (g0[m] == bg[k] || g1[m] == bg[k]) { w *= boost; break; }
        return w;
    };
    double tot = 0;
    size_t n = wt.w.size();
    for (size_t m = 0; m < n; m++) tot += weightOf(m);
    if (tot <= 0) return -1;
    double u = r.uni() * tot;
    int last = -1;
    for (size_t m = 0; m < n; m++) {
        double w = weightOf(m);
        if (w <= 0) continue;
        last = (int)m;
        if (u < w) return (int)m;
        u -= w;
    }
    return last;
}

// ------------------------------------------------------------------ targets
static bool tierOk(const Mod& m, int maxTier) { return maxTier <= 0 || (m.tier > 0 && m.tier <= maxTier); }

Target Target::load(const std::string& path, const Pool& pool) {
    Target t;
    t.modMask.assign(pool.mods.size(), 0);
    for (auto& raw : readLines(path)) {
        auto l = trim(raw.substr(0, raw.find('#')));
        if (l.empty()) continue;
        auto w = splitWs(l);
        if (w[0] != "need" || w.size() < 3) throw std::runtime_error("target: expected 'need <k> [as LABEL] <tokens>': " + l);
        Req r;
        r.k = std::atoi(w[1].c_str());
        size_t i = 2;
        if (w[i] == "as" && i + 1 < w.size()) { r.label = w[i + 1]; i += 2; }
        if (r.label.empty()) r.label = "R" + std::to_string(t.reqs.size() + 1);
        for (; i < w.size(); i++) {
            std::string tok = w[i], kind, val;
            int maxTier = 0;
            auto c = tok.find(':');
            if (c == std::string::npos) { kind = "mod"; val = tok; }
            else { kind = tok.substr(0, c); val = tok.substr(c + 1); }
            auto le = val.find("<=");
            if (le != std::string::npos) { maxTier = std::atoi(val.c_str() + le + 2); val = val.substr(0, le); }
            uint8_t ib = 0;
            if (kind == "infl") {
                ib = lower(val) == "any" ? (uint8_t)((1u << NINFL) - 1) : inflBit(val);
                if (!ib) throw std::runtime_error("target: unknown influence '" + val + "' (shaper elder crusader redeemer hunter warlord any)");
            }
            if (kind == "text") {  // case-insensitive substring of the mod text; '_' stands for a space
                val = lower(val);
                std::replace(val.begin(), val.end(), '_', ' ');
            }
            size_t before = r.mods.size();
            for (size_t m = 0; m < pool.mods.size(); m++) {
                auto& mod = pool.mods[m];
                bool hit = false;
                if (kind == "mod") hit = mod.id == val;
                else if (kind == "type") hit = mod.type == val && tierOk(mod, maxTier);
                else if (kind == "group") hit = std::find(mod.groups.begin(), mod.groups.end(), val) != mod.groups.end() && tierOk(mod, maxTier);
                else if (kind == "tag") hit = mod.hasTag(val) && mod.kind == K_R && tierOk(mod, maxTier);
                else if (kind == "infl") hit = (mod.infl & ib) && (mod.kind == K_R || mod.kind == K_V) && tierOk(mod, maxTier);
                else if (kind == "text") hit = lower(mod.text).find(val) != std::string::npos && tierOk(mod, maxTier);
                else throw std::runtime_error("target: unknown token kind '" + kind + "' (use mod:, type:, group:, tag:, infl:, text:)");
                if (hit && std::find(r.mods.begin(), r.mods.end(), (int)m) == r.mods.end()) r.mods.push_back((int)m);
            }
            if (r.mods.size() == before) std::fprintf(stderr, "warning: target token '%s' matches no mod on this base\n", tok.c_str());
        }
        if (t.reqs.size() >= 32) throw std::runtime_error("target: at most 32 requirements");
        for (int m : r.mods) t.modMask[m] |= 1u << t.reqs.size();
        t.all |= 1u << t.reqs.size();
        t.reqs.push_back(std::move(r));
    }
    if (t.reqs.empty()) throw std::runtime_error("target has no 'need' lines: " + path);
    return t;
}

Cond Cond::parse(const std::string& s, const Target& t) {
    Cond c;
    for (auto& alt : split(s, '|')) {
        std::vector<Term> clause;
        for (auto& raw : split(alt, '+')) {
            auto a = trim(raw);
            if (a.empty()) continue;
            Term term{TRUE_, false, 0};
            if (a[0] == '!') { term.neg = true; a = a.substr(1); }
            static const std::pair<const char*, Atom> atoms[] = {
                {"openP", OPENP}, {"openS", OPENS}, {"open", OPEN}, {"normal", NORMALR}, {"magic", MAGICR},
                {"rare", RARER}, {"imprint", IMPRINT}, {"lockP", LOCKP}, {"lockS", LOCKS}, {"full", FULL},
                {"empty", EMPTY}, {"true", TRUE_}, {"influenced", INFLUENCED}, {"fractured", FRACTURED},
                {"exarch", EXARCH}, {"eater", EATER}, {"eldritch", ELDRITCH}};
            bool found = false;
            for (auto& [n, v] : atoms) if (a == n) { term.a = v; found = true; }
            if (!found && t.label(a) < 0 && a != "*") {
                if (uint8_t b = inflBit(a)) { term.a = INFL; term.reqs = b; found = true; }
            }
            if (!found) {
                term.a = REQS;
                if (a == "*") term.reqs = t.all;
                else {
                    int l = t.label(a);
                    if (l < 0) throw std::runtime_error("condition: unknown label '" + a + "'");
                    term.reqs = 1u << l;
                }
            }
            clause.push_back(term);
        }
        c.any.push_back(std::move(clause));
    }
    return c;
}
bool Cond::eval(const Ctx& c, const State& s, const Target& t) const {
    for (auto& clause : any) {
        bool ok = true;
        for (auto& term : clause) {
            bool v = true;
            const Item& it = s.it;
            switch (term.a) {
                case REQS: v = t.sat(it, term.reqs); break;
                case OPENP: v = c.open(it, PRE); break;
                case OPENS: v = c.open(it, SUF); break;
                case OPEN: v = c.open(it, PRE) || c.open(it, SUF); break;
                case NORMALR: v = it.rarity == NORMAL; break;
                case MAGICR: v = it.rarity == MAGIC; break;
                case RARER: v = it.rarity == RARE; break;
                case IMPRINT: v = s.hasImprint != 0; break;
                case LOCKP: v = c.flags(it).lockP; break;
                case LOCKS: v = c.flags(it).lockS; break;
                case FULL: v = !c.open(it, PRE) && !c.open(it, SUF); break;
                case EMPTY: v = it.n == 0; break;
                case TRUE_: v = true; break;
                case INFLUENCED: v = it.infl != 0; break;
                case INFL: v = (it.infl & term.reqs) != 0; break;
                case FRACTURED: v = it.nfrac > 0; break;
                case EXARCH: v = it.dom == DOM_EXARCH; break;
                case EATER: v = it.dom == DOM_EATER; break;
                case ELDRITCH: v = it.dom != DOM_NONE; break;
            }
            if (v == term.neg) { ok = false; break; }
        }
        if (ok) return true;
    }
    return false;
}

// ------------------------------------------------------------------ misc
State parseStart(const Ctx& c, const std::string& spec) {
    State s;
    s.it.rarity = RARE;
    uint8_t infl = c.pool.defInfl;
    bool explicitInfl = false;
    std::vector<int> frac, mods;
    for (auto& w : splitWs(spec)) {
        std::string lw = lower(w);
        if (lw == "normal") s.it.rarity = NORMAL;
        else if (lw == "magic") s.it.rarity = MAGIC;
        else if (lw == "rare") s.it.rarity = RARE;
        else if (lw == "noinfl" || lw == "uninfluenced") { infl = 0; explicitInfl = true; }
        else if (lw == "exarch") s.it.dom = DOM_EXARCH;
        else if (lw == "eater") s.it.dom = DOM_EATER;
        else if (lw == "eldritch") s.it.dom = DOM_TIE;
        else if (uint8_t b = c.pool.find(w) < 0 ? inflBit(lw) : 0) {
            if (!explicitInfl) infl = 0;
            explicitInfl = true;
            infl |= b;
        } else {
            bool fr = w.rfind("frac:", 0) == 0;
            std::string id = fr ? w.substr(5) : w.rfind("mod:", 0) == 0 ? w.substr(4) : w;
            int m = c.pool.find(id);
            if (m < 0 && !fr) {  // metamod shorthand: lockP, lockS, multi, noattack, nocaster
                static const std::pair<const char*, Meta> metas[] = {
                    {"lockP", M_LOCKP}, {"lockS", M_LOCKS}, {"multi", M_MULTI}, {"noattack", M_NOATTACK}, {"nocaster", M_NOCASTER}};
                for (auto& [n, v] : metas)
                    if (id == n)
                        for (size_t k = 0; k < c.pool.mods.size(); k++)
                            if (c.pool.mods[k].meta == v) { m = (int)k; break; }
            }
            if (m < 0) throw std::runtime_error("start: unknown mod or word '" + id + "' (try: poecraft find --text ...)");
            (fr ? frac : mods).push_back(m);
        }
    }
    if (frac.size() + mods.size() > (size_t)MAXA) throw std::runtime_error("start: too many mods");
    if (frac.size() > 1) std::fprintf(stderr, "warning: start: an item normally has at most one fractured mod\n");
    for (int m : frac) s.it.add(m);
    s.it.nfrac = (uint8_t)frac.size();
    for (int m : mods) s.it.add(m);
    if (s.it.dom && !explicitInfl) infl = 0;  // Eldritch implicits and influence exclude each other
    for (int i = 0; i < s.it.n; i++) {        // an influence mod brings its influence along
        uint8_t mi = c.infl[s.it.m[i]];
        if (!mi || (mi & infl)) continue;
        if (explicitInfl || s.it.dom)
            throw std::runtime_error("start: " + c.pool.mods[s.it.m[i]].id + " needs influence " + inflNames(mi));
        infl |= (uint8_t)(mi & -mi);
    }
    s.it.infl = infl;
    if (s.it.infl && s.it.dom) throw std::runtime_error("start: an item cannot have both influence and Eldritch implicits");
    if (s.it.dom && !isArmourClass(c.pool.itemClass))
        throw std::runtime_error("start: Eldritch implicits only exist on body armours, helmets, gloves and boots");
    if (std::popcount(s.it.infl) > 2) std::fprintf(stderr, "warning: start: more than two influences\n");
    return s;
}
std::string describe(const Ctx& c, const Item& it) {
    static const char* rn[] = {"normal", "magic", "rare"};
    std::string s = rn[it.rarity];
    if (it.infl) s += " " + inflNames(it.infl);
    if (it.dom) s += it.dom == DOM_EXARCH ? " exarch" : it.dom == DOM_EATER ? " eater" : " eldritch(tie)";
    s += ":";
    for (int i = 0; i < it.n; i++) {
        auto& m = c.pool.mods[it.m[i]];
        s += std::string(" [") + (m.side == PRE ? "P" : "S") + (m.kind == K_C ? "c" : "") + (i < it.nfrac ? "f" : "") + "] " + m.id;
        if (m.tier) s += " T" + std::to_string(m.tier);
    }
    return s;
}

}  // namespace pc
