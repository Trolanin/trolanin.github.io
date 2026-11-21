// Exact success probabilities and the multithreaded Monte-Carlo estimator.
//
// Exact reroll calculation: the reroll draws mods one at a time from the weighted pool, skipping
// mods whose group is taken and sides that are full (same process as doReroll). Mods that are
// indistinguishable for the outcome - same side, same groups, same target-requirement membership -
// are merged into one "class" with the summed weight, and the probability is computed by a
// memoised recursion over the SET of classes drawn so far (order does not matter for the future).
// The state count is bounded by the side caps (<=3+3 classes), so typical rare pools are exact in
// well under a second; a state cap guards pathological pools.
#include <algorithm>
#include <atomic>
#include <chrono>
#include <thread>

#include "core.hpp"

namespace pc {

namespace {
struct Cls {
    uint8_t side;
    uint16_t g0, g1;
    uint32_t mask;
    double w = 0, wf = 0;
};

struct Dfs {
    const Ctx& c;
    const Target& t;
    uint32_t subset;
    std::vector<Cls> cls;
    std::vector<uint8_t> conf;  // NC*NC conflict matrix
    int nc = 0;
    int startP = 0, startS = 0, capP = 0, capS = 0, startN = 0;
    uint8_t sideMask = 3;
    uint8_t startCnt[32] = {0};
    std::unordered_map<uint64_t, double> memo;
    size_t cap;
    bool overflow = false;
    int tn = 0;

    Dfs(const Ctx& c_, const Target& t_, uint32_t s_, size_t cap_) : c(c_), t(t_), subset(s_), cap(cap_) {}

    bool success(const uint8_t* ch, int k) const {
        uint8_t cnt[32];
        std::copy(startCnt, startCnt + 32, cnt);
        for (int i = 0; i < k; i++)
            for (uint32_t m = cls[ch[i]].mask; m; m &= m - 1) cnt[std::countr_zero(m)]++;
        for (uint32_t s = subset; s; s &= s - 1) {
            int b = std::countr_zero(s);
            if (cnt[b] < t.reqs[b].k) return false;
        }
        return true;
    }
    double rec(uint8_t* ch, int k, int nP, int nS, bool first) {
        if (startN + k >= tn) return success(ch, k);
        uint64_t key = 0;
        if (!first) {
            uint8_t sorted[MAXA];
            std::copy(ch, ch + k, sorted);
            std::sort(sorted, sorted + k);
            for (int i = 0; i < k; i++) key = (key << 8) | (uint64_t)(sorted[i] + 1);
            key |= (uint64_t)tn << 56;
            auto it = memo.find(key);
            if (it != memo.end()) return it->second;
        }
        bool oP = (sideMask & 1) && nP < capP, oS = (sideMask & 2) && nS < capS;
        auto ok = [&](int j) {
            const Cls& x = cls[j];
            if (x.side == PRE ? !oP : !oS) return false;
            for (int i = 0; i < k; i++) if (conf[(size_t)j * nc + ch[i]]) return false;
            return true;
        };
        double tot = 0;
        bool useFirst = first;
        if (useFirst) {
            for (int j = 0; j < nc; j++) if (cls[j].wf > 0 && ok(j)) tot += cls[j].wf;
            if (tot <= 0) useFirst = false;
        }
        if (!useFirst) {
            tot = 0;
            for (int j = 0; j < nc; j++) if (cls[j].w > 0 && ok(j)) tot += cls[j].w;
        }
        double p = 0;
        if (tot <= 0) p = success(ch, k);
        else {
            for (int j = 0; j < nc; j++) {
                double w = useFirst ? cls[j].wf : cls[j].w;
                if (w <= 0 || !ok(j)) continue;
                ch[k] = (uint8_t)j;
                p += w / tot * rec(ch, k + 1, nP + (cls[j].side == PRE), nS + (cls[j].side == SUF), false);
                if (overflow) return 0;
            }
        }
        if (!first) {
            memo[key] = p;
            if (memo.size() > cap) overflow = true;
        }
        return p;
    }
};
}  // namespace

ExactResult exactReroll(const Ctx& c, const Target& t, uint32_t subset, const State& from, const RerollSpec& sp,
                        size_t stateCap) {
    ExactResult res;
    if (sp.sameTypeMult != 1) { res.why = "dynamic weights"; return res; }
    RerollStart rs = rerollStart(c, from.it, sp);
    Dfs d(c, t, subset, stateCap);
    const Item& st = rs.start;
    d.sideMask = rs.sideMask;
    d.startN = st.n;
    d.startP = c.count(st, PRE);
    d.startS = c.count(st, SUF);
    d.capP = c.capFor(sp.rarityOut, PRE);
    d.capS = c.capFor(sp.rarityOut, SUF);
    for (int i = 0; i < st.n; i++)
        for (uint32_t m = t.modMask[st.m[i]]; m; m &= m - 1) d.startCnt[std::countr_zero(m)]++;
    ItemFlags f = c.flags(st);
    // build classes
    std::map<std::tuple<int, int, int, uint32_t>, int> idx;
    for (size_t m = 0; m < c.pool.mods.size(); m++) {
        double w = sp.wt->w[m], wf = sp.first ? sp.first->w[m] : 0;
        if (w <= 0 && wf <= 0) continue;
        if (!(d.sideMask >> c.side[m] & 1)) continue;
        if (!c.eligible(st, (int)m, f)) continue;  // blocked by kept/forced mods for the whole reroll
        auto key = std::make_tuple((int)c.side[m], (int)c.g0[m], (int)c.g1[m], t.modMask[m]);
        auto it = idx.find(key);
        int j;
        if (it == idx.end()) {
            j = (int)d.cls.size();
            idx[key] = j;
            d.cls.push_back({c.side[m], c.g0[m], c.g1[m], t.modMask[m]});
        } else j = it->second;
        d.cls[j].w += w > 0 ? w : 0;
        d.cls[j].wf += wf > 0 ? wf : 0;
    }
    d.nc = (int)d.cls.size();
    if (d.nc > 254) { res.why = "too many mod classes (" + std::to_string(d.nc) + ")"; return res; }
    d.conf.assign((size_t)d.nc * d.nc, 0);
    for (int a = 0; a < d.nc; a++)
        for (int b = 0; b < d.nc; b++) {
            auto& x = d.cls[a];
            auto& y = d.cls[b];
            d.conf[(size_t)a * d.nc + b] = a == b || x.g0 == y.g0 || x.g0 == y.g1 || (x.g1 != 0xffff && (x.g1 == y.g0 || x.g1 == y.g1));
        }
    d.memo.reserve(1 << 16);
    double p = 0;
    for (auto& [n, pn] : sp.count->v) {
        d.tn = rs.kept > 0 ? std::max(n, rs.kept + c.rules.minNew) : n;
        uint8_t ch[16];
        p += pn * d.rec(ch, 0, d.startP, d.startS, sp.first != nullptr);
        if (d.overflow) { res.why = "state cap exceeded"; return res; }
    }
    res.ok = true;
    res.p = p;
    res.states = d.memo.size();
    return res;
}

ExactResult exactStep(const Ctx& c, const Target& t, uint32_t subset, const State& from, const Method& m) {
    ExactResult r;
    std::vector<Outcome> out;
    if (!m.outcomes(c, from, out)) { r.why = "not enumerable"; return r; }
    for (auto& o : out) r.p += o.p * t.sat(o.s.it, subset);
    r.ok = true;
    r.states = out.size();
    return r;
}

ExactResult exactMethod(const Ctx& c, const Target& t, uint32_t subset, const State& from, const Method& m) {
    if (!m.applicable(c, from)) { ExactResult r; r.ok = true; r.why = "not applicable"; return r; }
    if (auto* sp = m.reroll()) return exactReroll(c, t, subset, from, *sp);
    if (auto* parts = m.parts()) {
        // enumerate the single-step parts, then finish with an exact reroll if the last part is one
        std::vector<Outcome> cur{{from, 1.0}}, nxt;
        ExactResult r;
        for (size_t i = 0; i < parts->size(); i++) {
            const Method& p = *(*parts)[i];
            bool last = i + 1 == parts->size();
            nxt.clear();
            for (auto& o : cur) {
                if (!p.applicable(c, o.s)) { nxt.push_back(o); continue; }
                if (last && p.reroll()) {
                    auto e = exactReroll(c, t, subset, o.s, *p.reroll());
                    if (!e.ok) return e;
                    r.p += o.p * e.p;
                    r.states += e.states;
                    continue;
                }
                std::vector<Outcome> sub;
                if (!p.outcomes(c, o.s, sub)) { r.why = p.name + " not enumerable"; return r; }
                for (auto& x : sub) nxt.push_back({x.s, x.p * o.p});
            }
            if (!last || !p.reroll()) std::swap(cur, nxt);
            else cur.clear();
            if (cur.size() > 100000) { r.why = "too many intermediate states"; return r; }
        }
        for (auto& o : cur) r.p += o.p * t.sat(o.s.it, subset);
        r.ok = true;
        return r;
    }
    return exactStep(c, t, subset, from, m);
}

void MCResult::wilson(double& lo, double& hi, double z) const {
    if (!n) { lo = 0; hi = 1; return; }
    double p = this->p(), nn = (double)n, z2 = z * z;
    double den = 1 + z2 / nn, mid = (p + z2 / (2 * nn)) / den;
    double half = z * std::sqrt(p * (1 - p) / nn + z2 / (4 * nn * nn)) / den;
    lo = std::max(0.0, mid - half);
    hi = std::min(1.0, mid + half);
}

MCResult monteCarlo(const Ctx& c, const Method& m, const State& start, const Target& t, uint32_t subset,
                    uint64_t samples, int threads, uint64_t seed) {
    MCResult res;
    if (!m.applicable(c, start)) { res.n = samples; res.inapplicable = samples; return res; }
    threads = std::max(1, threads);
    std::vector<uint64_t> succ(threads), done(threads);
    std::vector<double> cost(threads);
    auto t0 = std::chrono::steady_clock::now();
    std::vector<std::thread> pool;
    for (int k = 0; k < threads; k++) {
        pool.emplace_back([&, k] {
            Rng r(seed * 0x9E3779B97F4A7C15ull + (uint64_t)k * 0xD1B54A32D192ED03ull + 1);
            uint64_t n = samples / threads + ((uint64_t)k < samples % threads);
            uint64_t s = 0;
            double cs = 0;
            for (uint64_t i = 0; i < n; i++) {
                State st = start;
                cs += m.apply(c, st, r);
                s += t.sat(st.it, subset);
            }
            succ[k] = s; done[k] = n; cost[k] = cs;
        });
    }
    for (auto& th : pool) th.join();
    res.secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    for (int k = 0; k < threads; k++) { res.succ += succ[k]; res.n += done[k]; res.costSum += cost[k]; }
    return res;
}

}  // namespace pc
