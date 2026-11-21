// Route evaluator: a fixed multi-step crafting plan, simulated end to end (Monte-Carlo) until the
// target is reached, giving the expected total cost. This is the hand-written precursor of the
// MDP route search: each step is a Method applied to the State, so the search can later replace
// the fixed plan with a policy over the same methods.
//
// Route file (one directive per line, '#' comments; method names as in methods.cpp, '_' for spaces):
//   start <spec>              initial item, e.g. "normal", "rare", "magic mod:Foo"   (default normal)
//   restart <method>          charged whenever the plan starts over (e.g. scour); default free
//   success <cond>            stop as soon as this holds (default *, the whole target)
//   maxcost <chaos>           give up a trial beyond this (counted as aborted; default 1e7)
//   do <method>               apply once (not applicable -> start over)
//   repeat <method> until <cond> [max N]   apply until cond holds (max reached -> start over)
//   if <cond> do <method>     apply once if cond holds and the method is applicable
//   check <cond> [else restart | else goto <step> | else <method> goto <step> | else fail]
// Steps are numbered from 1 in file order (directives other than steps are not numbered).
// Conditions: requirement labels from the target joined by '+' (and) and '|' (or), '!' negates;
// '*' = all requirements; also openP openS open normal magic rare imprint lockP lockS full empty.
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <thread>

#include "core.hpp"

namespace pc {

namespace {
struct Step {
    enum K { DO, REPEAT, IF, CHECK } k = DO;
    MethodPtr m, elseM;
    Cond cond;
    uint64_t max = ~0ull;
    int elseKind = 0;  // 0 restart, 1 goto, 2 fail
    int gotoIdx = 0;
    std::string text;
};
struct Route {
    std::string name;
    State start;
    MethodPtr restart;
    Cond success;
    double maxCost = 1e7;
    std::vector<Step> steps;
};

Route parseRoute(Ctx& c, const Target& t, const std::string& path) {
    std::ifstream f(path);
    if (!f) throw std::runtime_error("cannot open route " + path);
    Route r;
    r.name = path;
    r.start.it.rarity = NORMAL;
    r.success = Cond::parse("*", t);
    std::string raw;
    while (std::getline(f, raw)) {
        auto l = trim(raw.substr(0, raw.find('#')));
        if (l.empty()) continue;
        auto w = splitWs(l);
        auto rest = [&](size_t i) {
            std::string s;
            for (; i < w.size(); i++) s += (s.empty() ? "" : " ") + w[i];
            return s;
        };
        auto findKw = [&](const std::string& kw, size_t from) {
            for (size_t i = from; i < w.size(); i++) if (w[i] == kw) return i;
            return w.size();
        };
        Step st;
        st.text = l;
        if (w[0] == "route") { r.name = rest(1); continue; }
        if (w[0] == "start") { r.start = parseStart(c, rest(1)); continue; }
        if (w[0] == "restart") { r.restart = makeMethod(c, rest(1)); continue; }
        if (w[0] == "success") { r.success = Cond::parse(rest(1), t); continue; }
        if (w[0] == "maxcost") { r.maxCost = std::atof(w.at(1).c_str()); continue; }
        if (w[0] == "do") { st.k = Step::DO; st.m = makeMethod(c, rest(1)); }
        else if (w[0] == "repeat") {
            size_t u = findKw("until", 1), mx = findKw("max", u);
            if (u >= w.size()) throw std::runtime_error("route: repeat needs 'until': " + l);
            std::string meth, cond;
            for (size_t i = 1; i < u; i++) meth += (meth.empty() ? "" : " ") + w[i];
            for (size_t i = u + 1; i < mx; i++) cond += w[i];
            st.k = Step::REPEAT;
            st.m = makeMethod(c, meth);
            st.cond = Cond::parse(cond, t);
            if (mx < w.size()) st.max = std::stoull(w.at(mx + 1));
        } else if (w[0] == "if") {
            size_t d = findKw("do", 1);
            std::string cond;
            for (size_t i = 1; i < d; i++) cond += w[i];
            st.k = Step::IF;
            st.cond = Cond::parse(cond, t);
            st.m = makeMethod(c, rest(d + 1));
        } else if (w[0] == "check") {
            size_t e = findKw("else", 1);
            std::string cond;
            for (size_t i = 1; i < e; i++) cond += w[i];
            st.k = Step::CHECK;
            st.cond = Cond::parse(cond, t);
            if (e < w.size()) {
                size_t g = findKw("goto", e);
                if (e + 1 < w.size() && w[e + 1] == "fail") st.elseKind = 2;
                else if (e + 1 < w.size() && w[e + 1] == "restart") st.elseKind = 0;
                else if (g < w.size()) {
                    st.elseKind = 1;
                    st.gotoIdx = std::atoi(w.at(g + 1).c_str()) - 1;
                    std::string meth;
                    for (size_t i = e + 1; i < g; i++) meth += (meth.empty() ? "" : " ") + w[i];
                    if (!meth.empty()) st.elseM = makeMethod(c, meth);
                } else throw std::runtime_error("route: bad else clause: " + l);
            }
        } else throw std::runtime_error("route: unknown directive: " + l);
        r.steps.push_back(std::move(st));
    }
    for (auto& s : r.steps)
        if (s.elseKind == 1 && (s.gotoIdx < 0 || s.gotoIdx >= (int)r.steps.size()))
            throw std::runtime_error("route: goto out of range in: " + s.text);
    if (r.steps.empty()) throw std::runtime_error("route has no steps");
    return r;
}

struct Acc {
    uint64_t trials = 0, ok = 0, aborted = 0, restarts = 0;
    double cost = 0, cost2 = 0;
    std::vector<double> apps, stepCost;
};

// one trial: run the plan (restarting as needed) until success; returns false if aborted
bool trial(const Ctx& c, const Target& t, const Route& r, Rng& rng, Acc& a) {
    State s = r.start;
    double cost = 0;
    size_t pc = 0;
    auto restart = [&] {
        a.restarts++;
        if (r.restart) cost += r.restart->cost;
        s = r.start;
        pc = 0;
    };
    for (;;) {
        if (r.success.eval(c, s, t)) break;
        if (cost > r.maxCost) { a.aborted++; return false; }
        if (pc >= r.steps.size()) { restart(); continue; }
        const Step& st = r.steps[pc];
        switch (st.k) {
            case Step::DO:
                if (!st.m->applicable(c, s)) { restart(); continue; }
                { double k = st.m->apply(c, s, rng); cost += k; a.apps[pc]++; a.stepCost[pc] += k; }
                pc++;
                break;
            case Step::IF:
                if (st.cond.eval(c, s, t) && st.m->applicable(c, s)) {
                    double k = st.m->apply(c, s, rng); cost += k; a.apps[pc]++; a.stepCost[pc] += k;
                }
                pc++;
                break;
            case Step::REPEAT: {
                uint64_t n = 0;
                bool again = false, done = false;
                while (!st.cond.eval(c, s, t)) {
                    if (r.success.eval(c, s, t)) { done = true; break; }
                    if (n >= st.max || !st.m->applicable(c, s) || cost > r.maxCost) { again = true; break; }
                    double k = st.m->apply(c, s, rng);
                    cost += k; a.apps[pc]++; a.stepCost[pc] += k; n++;
                }
                if (done) goto finished;
                if (again) { if (cost > r.maxCost) { a.aborted++; return false; } restart(); continue; }
                pc++;
                break;
            }
            case Step::CHECK:
                if (st.cond.eval(c, s, t)) { pc++; break; }
                if (st.elseKind == 2) { a.aborted++; return false; }
                if (st.elseKind == 0) { restart(); continue; }
                if (st.elseM) {
                    if (!st.elseM->applicable(c, s)) { restart(); continue; }
                    double k = st.elseM->apply(c, s, rng); cost += k; a.stepCost[pc] += k; a.apps[pc]++;
                }
                pc = (size_t)st.gotoIdx;
                break;
        }
    }
finished:
    a.ok++;
    a.cost += cost;
    a.cost2 += cost * cost;
    return true;
}
}  // namespace

void routeCommand(Ctx& c, const Target& t, const std::string& file, uint64_t trials, int threads, uint64_t seed) {
    Route r = parseRoute(c, t, file);
    threads = std::max(1, threads);
    std::vector<Acc> acc(threads);
    for (auto& a : acc) { a.apps.assign(r.steps.size(), 0); a.stepCost.assign(r.steps.size(), 0); }
    auto t0 = std::chrono::steady_clock::now();
    std::vector<std::thread> th;
    for (int k = 0; k < threads; k++)
        th.emplace_back([&, k] {
            Rng rng(seed * 0x9E3779B97F4A7C15ull + (uint64_t)k * 0xD1B54A32D192ED03ull + 7);
            uint64_t n = trials / threads + ((uint64_t)k < trials % threads);
            for (uint64_t i = 0; i < n; i++) { acc[k].trials++; trial(c, t, r, rng, acc[k]); }
        });
    for (auto& x : th) x.join();
    double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    Acc a;
    a.apps.assign(r.steps.size(), 0); a.stepCost.assign(r.steps.size(), 0);
    for (auto& x : acc) {
        a.trials += x.trials; a.ok += x.ok; a.aborted += x.aborted; a.restarts += x.restarts;
        a.cost += x.cost; a.cost2 += x.cost2;
        for (size_t i = 0; i < r.steps.size(); i++) { a.apps[i] += x.apps[i]; a.stepCost[i] += x.stepCost[i]; }
    }
    std::printf("route: %s   (%llu trials, %.2fs)\n", r.name.c_str(), (unsigned long long)a.trials, secs);
    if (a.ok) {
        double mean = a.cost / a.ok, var = std::max(0.0, a.cost2 / a.ok - mean * mean);
        double half = 1.96 * std::sqrt(var / a.ok);
        std::printf("  expected cost: %.1f chaos  (95%% CI %.1f .. %.1f; sd %.1f)   restarts/trial %.2f\n", mean,
                    mean - half, mean + half, std::sqrt(var), (double)a.restarts / a.trials);
    }
    if (a.aborted) std::printf("  ABORTED trials (cost > maxcost or 'else fail'): %llu of %llu - mean excludes them\n",
                               (unsigned long long)a.aborted, (unsigned long long)a.trials);
    std::printf("  %-4s %-48s %12s %12s\n", "step", "directive", "uses/trial", "chaos/trial");
    for (size_t i = 0; i < r.steps.size(); i++)
        std::printf("  %-4zu %-48.48s %12.3f %12.1f\n", i + 1, r.steps[i].text.c_str(), a.apps[i] / a.trials,
                    a.stepCost[i] / a.trials);
}

}  // namespace pc
