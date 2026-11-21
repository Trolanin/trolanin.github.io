// poecraft.exe - Path of Exile 1 crafting-cost engine (CLI). See README for usage and file formats.
#include <algorithm>
#include <atomic>
#include <cstdio>
#include <filesystem>
#include <set>
#include <thread>

#include "core.hpp"

using namespace pc;
namespace fs = std::filesystem;

namespace {
struct Args {
    std::string cmd;
    std::map<std::string, std::string> opt;
    std::string get(const std::string& k, const std::string& d = "") const {
        auto it = opt.find(k);
        return it == opt.end() ? d : it->second;
    }
    bool has(const std::string& k) const { return opt.count(k) != 0; }
};

void usage() {
    std::puts(
        "poecraft <command> --pool FILE --target FILE [options]\n"
        "commands:\n"
        "  eval     --method M [--start SPEC] [--expect P]   success odds per attempt, exact + Monte-Carlo\n"
        "  rank     [--max-fossils 3] [--top 40]             every single-method spam strategy, by expected cost\n"
        "  route    --route FILE [--trials N]                simulate a multi-step plan to completion\n"
        "  outcomes --method M [--start SPEC]                exact next-state distribution of one step\n"
        "  list     [--mods]                                 essences, fossils, bench metamods, mods on this base\n"
        "options: --samples N (default 2000000)  --threads T (default all)  --seed S\n"
        "         --cfg mechanics.cfg  --prices build/prices.txt  --set \"key=v;key=v\" (override cfg)\n"
        "start SPEC: 'normal' | 'magic ...' | 'rare mod:ID mod:ID lockP ...'");
}

const char* fmtCost(double v, char* buf, size_t n) {
    if (std::isnan(v)) std::snprintf(buf, n, "no price");
    else if (std::isinf(v)) std::snprintf(buf, n, "never");
    else if (v >= 1e6) std::snprintf(buf, n, "%.3g", v);
    else if (v < 10) std::snprintf(buf, n, "%.3f", v);
    else std::snprintf(buf, n, "%.1f", v);
    return buf;
}

struct Cand {
    std::string label;
    MethodPtr m;       // what is repeated (cost per attempt)
    State start;       // state each attempt starts from
    MethodPtr exactM;  // method/start used for the exact probability (may differ, e.g. scour,alch -> alch)
    State exactStart;
    ExactResult ex;
    MCResult mc;
    double p() const { return ex.ok ? ex.p : mc.p(); }
    double expected() const {
        double c = mc.n ? mc.meanCost() : m->cost;
        if (std::isnan(c)) return NAN;
        return p() > 0 ? c / p() : INFINITY;
    }
};

int cmdEval(Ctx& c, const Target& t, const Args& a, uint64_t samples, int threads, uint64_t seed) {
    auto m = makeMethod(c, a.get("method"));
    State st;
    if (a.has("start")) st = parseStart(c, a.get("start"));
    else {
        st.it.rarity = RARE;
        Item probe; probe.rarity = MAGIC;
        State sm; sm.it = probe;
        if (!m->applicable(c, st)) st.it.rarity = m->applicable(c, sm) ? MAGIC : NORMAL;
    }
    std::printf("base        %s (ilvl %d, %s)\n", c.pool.base.c_str(), c.pool.ilvl, c.pool.itemClass.c_str());
    std::printf("method      %s\nstart       %s\n", m->name.c_str(), describe(c, st.it).c_str());
    if (!m->applicable(c, st)) { std::printf("NOT APPLICABLE to the start item\n"); return 2; }
    auto ex = exactMethod(c, t, t.all, st, *m);
    auto mc = monteCarlo(c, *m, st, t, t.all, samples, threads, seed);
    double lo, hi;
    mc.wilson(lo, hi);
    char b1[32];
    std::printf("cost/try    %s chaos\n", fmtCost(mc.meanCost(), b1, sizeof b1));
    std::printf("p_mc        %.8f  (95%% CI %.8f .. %.8f)  n=%llu\n", mc.p(), lo, hi, (unsigned long long)mc.n);
    if (ex.ok) std::printf("p_exact     %.8f  (%zu states)\n", ex.p, ex.states);
    else std::printf("p_exact     n/a (%s)\n", ex.why.c_str());
    double p = ex.ok ? ex.p : mc.p();
    if (p > 0) std::printf("expected    %s chaos  (E[tries] %.1f)\n", fmtCost(mc.meanCost() / p, b1, sizeof b1), 1 / p);
    else std::printf("expected    never (p = 0)\n");
    std::printf("throughput  %.1f M rolls/s (%d threads)\n", mc.n / mc.secs / 1e6, threads);
    int rc = 0;
    if (ex.ok) {  // cross-check: MC within 5 sigma of exact
        double sd = std::sqrt(std::max(ex.p * (1 - ex.p), 1e-300) / mc.n);
        double z = (mc.p() - ex.p) / sd;
        std::printf("check       MC vs exact z = %+.2f %s\n", z, std::fabs(z) < 5 ? "OK" : "MISMATCH");
        if (std::fabs(z) >= 5) rc = 1;
    }
    if (a.has("expect")) {
        double e = std::atof(a.get("expect").c_str());
        double sd = std::sqrt(std::max(e * (1 - e), 1e-300) / mc.n);
        double z = (mc.p() - e) / sd;
        bool exOk = !ex.ok || std::fabs(ex.p - e) < 1e-9 + 1e-6 * e;
        std::printf("expect      %.8f: MC z = %+.2f%s %s\n", e, z, ex.ok ? (exOk ? ", exact equal" : ", EXACT DIFFERS") : "",
                    std::fabs(z) < 5 && exOk ? "OK" : "FAIL");
        if (std::fabs(z) >= 5 || !exOk) rc = 1;
    }
    return rc;
}

int cmdOutcomes(Ctx& c, const Target& t, const Args& a) {
    auto m = makeMethod(c, a.get("method"));
    State st = parseStart(c, a.get("start", "rare"));
    if (!m->applicable(c, st)) { std::printf("not applicable\n"); return 2; }
    std::vector<Outcome> out;
    if (!m->outcomes(c, st, out)) { std::printf("%s has no enumerable outcome list (reroll); use eval\n", m->name.c_str()); return 2; }
    std::sort(out.begin(), out.end(), [](auto& x, auto& y) { return x.p > y.p; });
    double hit = 0;
    for (auto& o : out) hit += o.p * t.sat(o.s.it, t.all);
    std::printf("%zu outcomes, P(target) = %.8f\n", out.size(), hit);
    for (size_t i = 0; i < out.size() && i < 25; i++)
        std::printf("  %.6f %s %s\n", out[i].p, t.sat(out[i].s.it, t.all) ? "*" : " ", describe(c, out[i].s.it).c_str());
    return 0;
}

int cmdList(Ctx& c, const Args& a) {
    auto& p = c.pool;
    std::printf("%s ilvl %d (%s) tags: ", p.base.c_str(), p.ilvl, p.itemClass.c_str());
    for (auto& x : p.baseTags) std::printf("%s ", x.c_str());
    std::printf("\n\nessences:\n");
    for (auto& e : p.essences) {
        char b[32];
        std::printf("  %-36s %10s c  %s\n", e.name.c_str(), fmtCost(c.prices.get(e.name), b, sizeof b), p.mods[e.mod].text.c_str());
    }
    std::printf("\nfossils:\n");
    for (auto& f : p.fossils) {
        char b[32];
        std::printf("  %-22s %10s c  %s", f.name.c_str(), fmtCost(c.prices.get(f.name), b, sizeof b), f.modelled ? "" : "[not modelled] ");
        for (auto& [tg, w] : f.wm) std::printf("%s x%g ", tg.c_str(), w / c.rules.fossilScale);
        std::printf("%s\n", f.note == "-" ? "" : f.note.c_str());
    }
    std::printf("\nbench metamods:\n");
    for (auto& b : p.bench)
        if (p.mods[b.mod].meta != M_NONE) {
            char buf[32];
            std::printf("  %-42s %-10s %s (%s c)\n", p.mods[b.mod].text.c_str(), p.mods[b.mod].side == PRE ? "[prefix]" : "[suffix]",
                        b.cost.c_str(), fmtCost(c.prices.recipe(b.cost), buf, sizeof buf));
        }
    std::printf("  (%zu bench crafts in total: bench:<mod id>)\n", p.bench.size());
    if (a.has("mods")) {
        std::printf("\nrollable mods (side tier/ntiers weight id: text):\n");
        for (auto& m : p.mods)
            if (m.kind == K_R)
                std::printf("  %s T%d/%d %6g %-44s %s\n", m.side == PRE ? "P" : "S", m.tier, m.ntiers, m.weight, m.id.c_str(), m.text.c_str());
    }
    if (!c.prices.missing.empty()) {
        std::printf("\nno price for:");
        for (auto& x : c.prices.missing) std::printf(" [%s]", x.c_str());
        std::printf("\n");
    }
    return 0;
}

int cmdRank(Ctx& c, const Target& t, const Args& a, const Config& cfg, uint64_t samples, int threads, uint64_t seed) {
    std::vector<Cand> cands;
    std::vector<std::string> skipped;
    State rare, magic, normal;
    rare.it.rarity = RARE; magic.it.rarity = MAGIC; normal.it.rarity = NORMAL;
    auto add = [&](const std::string& label, const std::string& meth, const State& st, const std::string& exMeth = "",
                   const State* exSt = nullptr) {
        try {
            Cand k;
            k.label = label;
            k.m = makeMethod(c, meth);
            k.start = st;
            k.exactM = exMeth.empty() ? k.m : makeMethod(c, exMeth);
            k.exactStart = exSt ? *exSt : st;
            cands.push_back(std::move(k));
        } catch (std::exception& e) {
            skipped.push_back(label + ": " + e.what());
        }
    };
    add("chaos spam", "chaos", rare);
    add("alch + scour spam", "scour,alch", rare, "alch", &normal);
    add("alteration spam", "alt", magic);
    add("alt + aug spam", "altaug", magic);
    for (auto& e : c.pool.essences)
        if (std::isnan(c.prices.get(e.name))) continue;
        else if (e.level > 0 && e.level < c.rules.essRareMinLevel)  // normal items only: scour between tries
            add("essence " + e.name + " + scour", "scour,essence:" + e.name, rare, "essence:" + e.name, &normal);
        else add("essence " + e.name, "essence:" + e.name, rare);
    for (auto& [k, v] : cfg.kv)
        if (k.rfind("cost.harvest.tag.", 0) == 0) {
            std::string tg = k.substr(17);
            add("harvest reforge incl. " + tg, "harvest:tag:" + tg, rare);
        }
    // fossils: singles exact first, then combos built from the helpful ones
    std::vector<std::string> fos;
    for (auto& f : c.pool.fossils)
        if (f.modelled && !std::isnan(c.prices.get(f.name))) fos.push_back(f.name);
    size_t firstFossil = cands.size();
    for (auto& f : fos) add("fossil " + f, "fossil:" + f, normal);

    auto runExact = [&](size_t from) {
        std::atomic<size_t> next{from};
        int nt = std::min(threads, 8);  // the exact recursion holds a memo table per thread
        std::vector<std::thread> th;
        for (int k = 0; k < nt; k++)
            th.emplace_back([&] {
                for (size_t i; (i = next++) < cands.size();)
                    cands[i].ex = exactMethod(c, t, t.all, cands[i].exactStart, *cands[i].exactM);
            });
        for (auto& x : th) x.join();
    };
    runExact(0);
    double pChaos = cands[0].ex.ok ? cands[0].ex.p : 0;
    std::vector<std::pair<double, std::string>> helpful;
    for (size_t i = firstFossil; i < cands.size(); i++)
        if (cands[i].ex.ok && cands[i].ex.p > pChaos * 1.0001) helpful.push_back({cands[i].ex.p, cands[i].label.substr(7)});
    std::sort(helpful.rbegin(), helpful.rend());
    int maxF = std::atoi(a.get("max-fossils", "3").c_str());
    size_t comboStart = cands.size();
    std::set<std::string> seen;
    auto addCombo = [&](std::vector<std::string> v) {
        std::sort(v.begin(), v.end());
        if (std::adjacent_find(v.begin(), v.end()) != v.end()) return;
        std::string key;
        for (auto& x : v) key += (key.empty() ? "" : "+") + x;
        if (!seen.insert(key).second) return;
        add("fossil " + key, "fossil:" + key, normal);
    };
    if (maxF >= 2)
        for (auto& h : helpful)
            for (auto& f : fos) addCombo({h.second, f});
    size_t nh3 = std::min<size_t>(helpful.size(), 10), nh4 = std::min<size_t>(helpful.size(), 7);
    if (maxF >= 3)
        for (size_t i = 0; i < nh3; i++)
            for (size_t j = i + 1; j < nh3; j++)
                for (size_t k = j + 1; k < nh3; k++) addCombo({helpful[i].second, helpful[j].second, helpful[k].second});
    if (maxF >= 4)
        for (size_t i = 0; i < nh4; i++)
            for (size_t j = i + 1; j < nh4; j++)
                for (size_t k = j + 1; k < nh4; k++)
                    for (size_t l = k + 1; l < nh4; l++)
                        addCombo({helpful[i].second, helpful[j].second, helpful[k].second, helpful[l].second});
    runExact(comboStart);

    // Monte-Carlo for every candidate (cross-check, and the only estimate where exact is n/a)
    double rollSecs = 0;
    uint64_t rolls = 0;
    for (size_t i = 0; i < cands.size(); i++) {
        auto& k = cands[i];
        k.mc = monteCarlo(c, *k.m, k.start, t, t.all, samples, threads, seed + i);
        rolls += k.mc.n; rollSecs += k.mc.secs;
    }
    std::vector<Cand*> order;
    for (auto& k : cands) order.push_back(&k);
    std::stable_sort(order.begin(), order.end(), [](Cand* x, Cand* y) {
        double a = x->expected(), b = y->expected();
        if (std::isnan(a)) a = INFINITY;
        if (std::isnan(b)) b = INFINITY;
        return a < b;
    });
    int top = std::atoi(a.get("top", "40").c_str());
    double div = c.prices.get("Divine Orb");
    std::printf("%s ilvl %d -- %zu strategies (%zu fossil combos), %llu MC rolls/strategy, %.1f M rolls/s\n",
                c.pool.base.c_str(), c.pool.ilvl, cands.size(), cands.size() - comboStart, (unsigned long long)samples,
                rolls / rollSecs / 1e6);
    std::printf("target:");
    for (auto& r : t.reqs) std::printf(" [%s: %d of %zu mods]", r.label.c_str(), r.k, r.mods.size());
    std::printf("\n%-4s %-46s %9s %12s %12s %-25s %11s %8s %s\n", "#", "method", "cost/try", "p exact", "p MC", "  MC 95% CI",
                "E[cost] c", "E[div]", "check");
    int shown = 0, never = 0;
    for (auto* k : order) {
        double e = k->expected();
        if (std::isinf(e)) { never++; continue; }
        if (shown >= top) continue;
        shown++;
        double lo, hi;
        k->mc.wilson(lo, hi);
        char b1[32], b2[32], b3[32];
        std::string chk = "-";
        if (k->ex.ok && k->mc.n && k->m.get() == k->exactM.get()) {
            double sd = std::sqrt(std::max(k->ex.p * (1 - k->ex.p), 1e-300) / k->mc.n);
            double z = (k->mc.p() - k->ex.p) / sd;
            char z1[32];
            std::snprintf(z1, sizeof z1, "z=%+.1f%s", z, std::fabs(z) < 5 ? "" : "!");
            chk = z1;
        } else if (k->ex.ok) {
            double sd = std::sqrt(std::max(k->ex.p * (1 - k->ex.p), 1e-300) / k->mc.n);
            char z1[32];
            std::snprintf(z1, sizeof z1, "z=%+.1f", (k->mc.p() - k->ex.p) / sd);
            chk = z1;
        }
        char pe[32];
        if (k->ex.ok) std::snprintf(pe, sizeof pe, "%.3e", k->ex.p); else std::snprintf(pe, sizeof pe, "n/a");
        char ci[48];
        std::snprintf(ci, sizeof ci, "[%.2e,%.2e]", lo, hi);
        std::printf("%-4d %-46.46s %9s %12s %12.3e %-25s %11s %8s %s\n", shown, k->label.c_str(),
                    fmtCost(k->mc.n ? k->mc.meanCost() : k->m->cost, b1, sizeof b1), pe, k->mc.p(), ci,
                    fmtCost(e, b2, sizeof b2), fmtCost(e / div, b3, sizeof b3), chk.c_str());
    }
    if (never) std::printf("(%d strategies cannot reach the target or lack a price)\n", never);
    for (auto& s : skipped) std::printf("skipped: %s\n", s.c_str());
    std::printf("not ranked (state-dependent, see 'route'): harvest:more/less, metamod + reroll, beastcrafts, exalt/annul chains\n");
    return 0;
}
}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) { usage(); return 1; }
    Args a;
    a.cmd = argv[1];
    for (int i = 2; i < argc; i++) {
        std::string k = argv[i];
        if (k.rfind("--", 0) != 0) { std::fprintf(stderr, "unexpected argument %s\n", k.c_str()); return 1; }
        k = k.substr(2);
        if (i + 1 < argc && std::string(argv[i + 1]).rfind("--", 0) != 0) a.opt[k] = argv[++i];
        else a.opt[k] = "1";
    }
    if (a.cmd == "help" || a.has("help")) { usage(); return 0; }
    try {
        fs::path exe = fs::absolute(fs::path(argv[0])).parent_path();
        fs::path root = exe.filename() == "build" ? exe.parent_path() : fs::current_path();
        std::string cfgPath = a.get("cfg", (root / "mechanics.cfg").string());
        std::string pricePath = a.get("prices", (root / "build" / "prices.txt").string());
        Config cfg = Config::load(cfgPath);
        for (auto& kv : split(a.get("set"), ';')) {  // --set "key=value;key=value" overrides mechanics.cfg
            auto e = kv.find('=');
            if (e != std::string::npos) cfg.kv[trim(kv.substr(0, e))] = trim(kv.substr(e + 1));
        }
        Rules rules = Rules::from(cfg);
        Prices prices = Prices::load(pricePath, cfg);
        if (!a.has("pool")) throw std::runtime_error("--pool is required");
        Pool pool = Pool::load(a.get("pool"));
        Ctx c(pool, rules, prices);
        setMethodConfig(&cfg);
        uint64_t samples = std::stoull(a.get("samples", "2000000"));
        int threads = std::atoi(a.get("threads", std::to_string(std::max(1u, std::thread::hardware_concurrency()))).c_str());
        uint64_t seed = std::stoull(a.get("seed", "12345"));
        if (a.cmd == "list") return cmdList(c, a);
        if (!a.has("target")) throw std::runtime_error("--target is required");
        Target t = Target::load(a.get("target"), pool);
        int rc;
        if (a.cmd == "eval") rc = cmdEval(c, t, a, samples, threads, seed);
        else if (a.cmd == "rank") rc = cmdRank(c, t, a, cfg, samples, threads, seed);
        else if (a.cmd == "outcomes") rc = cmdOutcomes(c, t, a);
        else if (a.cmd == "route") {
            routeCommand(c, t, a.get("route"), std::stoull(a.get("trials", "20000")), threads, seed);
            rc = 0;
        } else { usage(); return 1; }
        if (!prices.missing.empty()) {
            std::fprintf(stderr, "note: no price for:");
            for (auto& x : prices.missing) std::fprintf(stderr, " [%s]", x.c_str());
            std::fprintf(stderr, "\n");
        }
        return rc;
    } catch (std::exception& e) {
        std::fprintf(stderr, "error: %s\n", e.what());
        return 1;
    }
}
