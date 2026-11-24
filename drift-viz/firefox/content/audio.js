// Audio: taps the YouTube player's own sound with Web Audio and analyses it 100 times a second.
// The analysis is a port of src/audio.cpp (the desktop app records what Windows plays instead).
"use strict";

const WAVE_N = 512, SPEC_N = 128, FFT_N = 2048, RING = 8192;

function newAudioFrame() {
  return {
    wave: new Float32Array(WAVE_N), spec: new Float32Array(SPEC_N),
    level: 0, dbfs: -180, bass: 1, mid: 1, treb: 1, beats: 0, sections: 0, novelty: 0,
    drops: 0, builds: 0, breaks: 0, toneShifts: 0, hatRushes: 0, vocals: 0, tempoChanges: 0, hits: 0,
    bright: 0, beatDensity: 0, bpm: 0, silent: true,
  };
}

const dbOf = (p) => Math.max(-90, 10 * Math.log10(p + 1e-12));

class Analyzer {
  constructor() {
    this.ring = new Float32Array(RING);
    this.pos = 0;
    this.hann = new Float32Array(FFT_N);
    for (let i = 0; i < FFT_N; i++) this.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_N - 1));
    this.re = new Float32Array(FFT_N);
    this.im = new Float32Array(FFT_N);
    this.pw = new Float32Array(FFT_N / 2 + 2);
    // FFT tables
    this.rev = new Uint32Array(FFT_N);
    for (let i = 0, bits = Math.log2(FFT_N); i < FFT_N; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cosT = new Float32Array(FFT_N / 2);
    this.sinT = new Float32Array(FFT_N / 2);
    for (let i = 0; i < FFT_N / 2; i++) { this.cosT[i] = Math.cos((-2 * Math.PI * i) / FFT_N); this.sinT[i] = Math.sin((-2 * Math.PI * i) / FFT_N); }

    this.specPeak = -40; this.spec = new Float32Array(SPEC_N); this.wavePeak = 0.05;
    this.lvlPeak = -40; this.lvl = 0;
    this.bandAvg = [-1, -1, -1]; this.rel = [1, 1, 1];
    this.bassHist = new Float32Array(100); this.hp = 0; this.histN = 0;
    this.lastBeat = 0; this.lastSection = 0; this.quietSince = 0;
    this.beats = 0; this.sections = 0;
    this.fShort = new Float32Array(8); this.fLong = new Float32Array(8); this.fInit = false;
    this.bassS = -90; this.bassL = -90; this.lvlS = -90; this.lvlM = -90; this.lvlL = -90; this.trebM = -90;
    this.cenS = 0; this.cenL = 0; this.midS = 0; this.midL = 0; this.lullMin = 0;
    this.evInit = false; this.inLull = false; this.inBreak = false;
    this.lullStart = 0; this.lastBreak = -100; this.lastBuild = -100; this.lastTone = -100; this.lastHats = -100; this.lastVocal = -100;
    this.lastTempo = -100; this.lastHit = -100; this.lastHist = 0; this.lastOnset = 0; this.tempoOff = -1; this.evStart = 0;
    this.tempoCand = 0;
    this.lvlHist = new Float32Array(20); this.trebHist = new Float32Array(20); this.histAt = 0; this.histCount = 0;
    this.hiHist = [-90, -90, -90]; this.rateS = 0; this.rateL = 0; this.beatRate = 0; this.beatAvg = 0; this.beatAvgInit = false;
    this.ibi = new Float32Array(9); this.ibiN = 0; this.ibiAt = 0; this.bpmLocked = 0;
    this.drops = 0; this.builds = 0; this.breaks = 0; this.toneShifts = 0; this.hatRushes = 0; this.vocals = 0; this.tempoChanges = 0; this.hits = 0;
  }

  push(s, from, n) {
    const ring = this.ring;
    for (let i = 0; i < n; i++) { ring[this.pos] = s[from + i]; this.pos = (this.pos + 1) % RING; }
  }
  at(back) { return this.ring[(this.pos + RING - 1 - back) % RING]; }   // back = 0 is the newest sample

  fft() {
    const re = this.re, im = this.im, rev = this.rev, n = FFT_N;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, step = n / len;
      for (let i = 0; i < n; i += len)
        for (let k = 0; k < half; k++) {
          const wr = this.cosT[k * step], wi = this.sinT[k * step];
          const a = i + k, b = a + half;
          const vr = re[b] * wr - im[b] * wi, vi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - vr; im[b] = im[a] - vi;
          re[a] += vr; im[a] += vi;
        }
    }
  }

  bandPower(f0, f1, binHz) {
    const k0 = f0 / binHz, k1 = f1 / binHz, pw = this.pw;
    if (k1 - k0 < 1) {
      const kc = 0.5 * (k0 + k1), k = clamp(Math.trunc(kc), 0, FFT_N / 2 - 1), fr = kc - k;
      return (pw[k] * (1 - fr) + pw[k + 1] * fr) * (k1 - k0);
    }
    let p = 0;
    for (let k = Math.max(1, Math.trunc(k0)); k < Math.min(FFT_N / 2, Math.trunc(k1)); k++) p += pw[k];
    return p;
  }

  detectEvents(t, f, ap, p3, lvlDb, cen, beat, prevBeat, binHz) {
    const ema = (key, x, a) => { this[key] += (x - this[key]) * a; };
    const es = Math.max(ap.eventSens, 0.05);
    const bassDb = dbOf(p3[0]), trebDb = dbOf(p3[2]), totDb = dbOf(p3[0] + p3[1] + p3[2]);
    const midShare = dbOf(p3[1]) - totDb, lv = clamp(lvlDb, -90, 0);
    const hiDb = dbOf(this.bandPower(5000, 16000, binHz));
    if (!this.evInit || f.silent) {
      this.bassS = this.bassL = bassDb; this.lvlS = this.lvlM = this.lvlL = lv; this.trebM = trebDb;
      this.cenS = this.cenL = cen; this.midS = this.midL = midShare;
      this.inLull = this.inBreak = false; this.histCount = 0; this.ibiN = 0; this.bpmLocked = 0; this.tempoOff = -1; this.beatAvgInit = false;
      this.rateS = this.rateL = this.beatRate = 0;
      this.evInit = true;
      this.evStart = t;
    }
    ema("bassS", bassDb, 0.04); ema("bassL", bassDb, 0.001);
    ema("lvlS", lv, 0.02); ema("lvlM", lv, 0.005); ema("lvlL", lv, 0.001);
    ema("trebM", trebDb, 0.005);
    ema("cenS", cen, 0.01); ema("cenL", cen, 0.0008);
    ema("midS", midShare, 0.007); ema("midL", midShare, 0.0008);
    ema("beatRate", beat ? 100 : 0, 0.003);
    f.beatDensity = clamp(this.beatRate / 3, 0, 1);
    f.bright = clamp((this.cenS - 0.3) / 0.35, 0, 1);

    const onset = hiDb - this.hiHist[1] > 6 && t - this.lastOnset > 0.06;
    this.hiHist[1] = this.hiHist[0]; this.hiHist[0] = hiDb;
    if (onset) this.lastOnset = t;
    ema("rateS", onset ? 100 : 0, 0.01);
    ema("rateL", onset ? 100 : 0, 0.0008);
    if (t - this.evStart <= 5) this.rateL = this.rateS;
    if (!f.silent && t - this.evStart > 5) {
      if (!this.inLull) {
        if (this.bassS < this.bassL - 6 / es) { this.inLull = true; this.lullStart = t; this.lullMin = this.bassS; }
      } else {
        this.lullMin = Math.min(this.lullMin, this.bassS);
        if (this.bassS > this.lullMin + 9 / es && this.bassS > this.bassL - 3) {
          if (t - this.lullStart > 1.5) this.drops++;
          this.inLull = false;
        } else if (t - this.lullStart > 60) this.inLull = false;
      }
      if (!this.inBreak && this.lvlS < this.lvlL - 7 / es && t - this.lastBreak > 8) { this.breaks++; this.inBreak = true; this.lastBreak = t; }
      if (this.inBreak && this.lvlS > this.lvlL - 2) this.inBreak = false;
      if (t - this.lastHist >= 0.25) {
        this.lastHist = t;
        this.lvlHist[this.histAt] = this.lvlM; this.trebHist[this.histAt] = this.trebM;
        this.histAt = (this.histAt + 1) % 20;
        this.histCount++;
      }
      if (this.histCount >= 20) {
        const o = this.histAt, m = (this.histAt + 10) % 20, n = (this.histAt + 19) % 20;
        const dL = this.lvlHist[n] - this.lvlHist[o], dT = this.trebHist[n] - this.trebHist[o];
        const steady = this.trebHist[m] > this.trebHist[o] + 1 && this.trebHist[n] > this.trebHist[m] + 1;
        if (dL > 2.5 / es && dT > 6 / es && steady && t - this.lastBuild > 10) { this.builds++; this.lastBuild = t; }
      }
      if (Math.abs(this.cenS - this.cenL) > 0.07 / es && t - this.lastTone > 6) { this.toneShifts++; this.lastTone = t; this.cenL = this.cenS; }
      if (this.rateS > 2 && this.rateS > this.rateL * (1 + 0.6 / es) + 0.5 && t - this.lastHats > 8) { this.hatRushes++; this.lastHats = t; }
      if (this.midS - this.midL > 3 / es && t - this.lastVocal > 10) { this.vocals++; this.lastVocal = t; this.midL = this.midS; }
      if (beat) {
        const bd = bassDb;
        if (this.beatAvgInit && bd > this.beatAvg + 5 / es && t - this.lastHit > 2) { this.hits++; this.lastHit = t; }
        this.beatAvg = this.beatAvgInit ? this.beatAvg + (bd - this.beatAvg) * 0.1 : bd;
        this.beatAvgInit = true;
        let iv = t - prevBeat;
        if (iv > 0.2 && iv < 2.5) {
          while (iv < 0.4) iv *= 2;
          while (iv >= 0.8) iv *= 0.5;
          this.ibi[this.ibiAt] = iv; this.ibiAt = (this.ibiAt + 1) % 9; this.ibiN = Math.min(this.ibiN + 1, 9);
          if (this.ibiN === 9) {
            const s = Array.from(this.ibi).sort((x, y) => x - y);
            const med = s[4], bpm = 60 / med;
            let agree = 0;
            for (const v of this.ibi) agree += Math.abs(v - med) < 0.04 * med ? 1 : 0;
            if (agree < 7) {
              // irregular: neither confirm nor reject a change
            } else if (this.bpmLocked <= 0) {
              this.bpmLocked = bpm;
            } else if (Math.abs(bpm - this.bpmLocked) / this.bpmLocked > 0.05 / es) {
              if (this.tempoOff < 0 || Math.abs(bpm - this.tempoCand) / this.tempoCand > 0.03) { this.tempoOff = t; this.tempoCand = bpm; }
              if (t - this.tempoOff > 4 && t - this.lastTempo > 15) { this.tempoChanges++; this.lastTempo = t; this.bpmLocked = bpm; this.tempoOff = -1; }
            } else {
              this.tempoOff = -1;
              this.bpmLocked += (bpm - this.bpmLocked) * 0.05;
            }
          }
        }
      }
    }
    f.bpm = this.bpmLocked;
    f.drops = this.drops; f.builds = this.builds; f.breaks = this.breaks; f.toneShifts = this.toneShifts;
    f.hatRushes = this.hatRushes; f.vocals = this.vocals; f.tempoChanges = this.tempoChanges; f.hits = this.hits;
  }

  analyze(rate, hop, t, f, ap) {
    const re = this.re, im = this.im, pw = this.pw;
    for (let i = 0; i < FFT_N; i++) { re[i] = this.at(FFT_N - 1 - i) * this.hann[i]; im[i] = 0; }
    this.fft();
    const norm = 1 / ((FFT_N * FFT_N) / 16), binHz = rate / FFT_N;
    for (let k = 0; k <= FFT_N / 2; k++) pw[k] = (re[k] * re[k] + im[k] * im[k]) * norm;
    pw[FFT_N / 2 + 1] = 0;

    const db = new Float32Array(SPEC_N);
    let maxDb = -200;
    const ratio = 16000 / 30;
    for (let b = 0; b < SPEC_N; b++) {
      const f0 = 30 * Math.pow(ratio, b / SPEC_N), f1 = 30 * Math.pow(ratio, (b + 1) / SPEC_N);
      db[b] = 10 * Math.log10(this.bandPower(f0, f1, binHz) + 1e-12);
      maxDb = Math.max(maxDb, db[b]);
    }
    this.specPeak = Math.max(maxDb, this.specPeak - 0.03, -45);
    const range = Math.max(ap.specRange, 6), fall = 0.97 - 0.22 * clamp(ap.specFall, 0, 1);
    let cenNum = 0, cenDen = 0;
    for (let b = 0; b < SPEC_N; b++) {
      const v = clamp((db[b] - (this.specPeak - range)) / range, 0, 1);
      this.spec[b] = Math.max(v, this.spec[b] * fall);
      f.spec[b] = this.spec[b];
      cenNum += v * b;
      cenDen += v;
    }
    const cen = cenDen > 0.5 ? cenNum / cenDen / SPEC_N : 0;

    const p3 = [this.bandPower(20, 250, binHz), this.bandPower(250, 2000, binHz), this.bandPower(2000, 16000, binHz)];
    for (let i = 0; i < 3; i++) {
      if (this.bandAvg[i] < 0) this.bandAvg[i] = p3[i];
      this.bandAvg[i] += (p3[i] - this.bandAvg[i]) * 0.005;
      const r = clamp(p3[i] / (this.bandAvg[i] + 1e-9), 0, 4);
      this.rel[i] += (r - this.rel[i]) * 0.35;
    }
    f.bass = this.rel[0]; f.mid = this.rel[1]; f.treb = this.rel[2];

    let avg = 0;
    for (const h of this.bassHist) avg += h;
    avg /= 100;
    let beat = false;
    const prevBeat = this.lastBeat;
    if (this.histN >= 100 && p3[0] > (1 + 0.5 / Math.max(ap.beatSens, 0.05)) * avg && p3[0] > 1e-6 && t - this.lastBeat > ap.beatGap) {
      this.lastBeat = t;
      this.beats++;
      beat = true;
    }
    this.bassHist[this.hp] = p3[0]; this.hp = (this.hp + 1) % 100; this.histN++;

    let rms = 0;
    for (let i = 0; i < hop; i++) { const x = this.at(i); rms += x * x; }
    const lvlDb = 20 * Math.log10(Math.sqrt(rms / hop) + 1e-9);
    this.lvlPeak = Math.max(lvlDb, this.lvlPeak - 0.03, -35);
    this.lvl = Math.max(clamp((lvlDb - (this.lvlPeak - 40)) / 40, 0, 1), this.lvl * 0.9);
    f.level = this.lvl;
    f.dbfs = lvlDb;
    if (lvlDb > ap.silenceDb) this.quietSince = t;
    f.silent = t - this.quietSince > 2;

    this.detectEvents(t, f, ap, p3, lvlDb, cen, beat, prevBeat, binHz);

    const fe = new Float32Array(8);
    for (let o = 0; o < 8; o++) fe[o] = Math.max(-90, 10 * Math.log10(this.bandPower(40 * (1 << o), 80 * (1 << o), binHz) + 1e-12));
    let nov = 0;
    for (let o = 0; o < 8; o++) {
      if (!this.fInit || f.silent) this.fShort[o] = this.fLong[o] = fe[o];
      this.fShort[o] += (fe[o] - this.fShort[o]) * 0.02;
      this.fLong[o] += (fe[o] - this.fLong[o]) * 0.0012;
      nov += Math.abs(this.fShort[o] - this.fLong[o]) / 8;
    }
    this.fInit = true;
    if (!f.silent && nov > ap.sectionDb && t - this.lastSection > ap.sectionCool) {
      this.sections++; this.lastSection = t;
      for (let o = 0; o < 8; o++) this.fLong[o] = this.fShort[o];
    }
    f.novelty = nov; f.beats = this.beats; f.sections = this.sections;

    // Waveform: start at a rising zero crossing so it stands still like a triggered scope.
    let start = WAVE_N + 511;
    for (let b = WAVE_N + 1; b < WAVE_N + 512; b++)
      if (this.at(b) <= 0 && this.at(b - 1) > 0) { start = b; break; }
    let peak = 0;
    for (let j = 0; j < WAVE_N; j++) {
      const b = start - j;
      const x = 0.25 * this.at(b + 1) + 0.5 * this.at(b) + 0.25 * this.at(b > 0 ? b - 1 : 0);
      f.wave[j] = x;
      peak = Math.max(peak, Math.abs(x));
    }
    this.wavePeak = Math.max(peak, this.wavePeak * 0.995);
    const gain = 1 / Math.max(this.wavePeak, 0.02);
    for (let j = 0; j < WAVE_N; j++) f.wave[j] = clamp(f.wave[j] * gain, -1, 1);
  }
}

// Taps a <video> element: its sound keeps playing through the speakers as before, and a copy goes
// to the analyser. Web Audio can only tap an element once, so the tap stays for the page's life;
// "off" just stops analysing.
class AudioTap {
  constructor() {
    this.ctx = null;
    this.video = null;
    this.source = null;
    this.proc = null;
    this.frame = newAudioFrame();
    this.an = new Analyzer();
    this.pending = 0;   // samples since the last analysis step
    this.samples = 0;
    this.params = { beatSens: 1, beatGap: 0.18, sectionDb: 5, sectionCool: 6, eventSens: 1, silenceDb: -80, specFall: 0.5, specRange: 48 };
    this.error = "";
    this.running = false;
  }

  setParams(x) {
    const p = this.params;
    p.beatSens = x[XF.BEAT_SENS]; p.beatGap = x[XF.BEAT_GAP]; p.sectionDb = x[XF.SECTION_DB]; p.sectionCool = x[XF.SECTION_COOL];
    p.eventSens = x[XF.EVENT_SENS]; p.silenceDb = x[XF.SILENCE_DB]; p.specFall = x[XF.SPEC_FALL]; p.specRange = x[XF.SPEC_RANGE];
  }

  // Resolves true once the video is tapped. Only taps while the audio context is running:
  // tapping into a suspended context would silence the video until the page is clicked.
  async attach(video) {
    if (this.video === video && this.source) { this.start(); return true; }
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      if (!(await this.running3s())) { this.error = "waiting for a click on the page to start the sound tap"; return false; }
      if (this.source) { try { this.source.disconnect(); } catch (e) { /* old element */ } }
      this.video = video;
      this.source = this.ctx.createMediaElementSource(video);
      this.source.connect(this.ctx.destination);   // the sound itself, unchanged
      this.error = "";
      this.start();
      return true;
    } catch (e) {
      this.error = "could not tap the sound: " + e.message;
      return false;
    }
  }

  // Opening the sound device can take a moment, so wait for the context to report "running".
  // It stays suspended if the browser wants a click on the page first.
  running3s() {
    const ctx = this.ctx;
    if (ctx.state === "running") return Promise.resolve(true);
    ctx.resume().catch(() => {});
    return new Promise((done) => {
      const finish = (ok) => { clearTimeout(timer); ctx.removeEventListener("statechange", check); done(ok); };
      const check = () => { if (ctx.state === "running") finish(true); };
      const timer = setTimeout(() => finish(ctx.state === "running"), 3000);
      ctx.addEventListener("statechange", check);
    });
  }

  start() {
    if (this.running || !this.source) return;
    // ScriptProcessor hands over every sample (an AnalyserNode only gives snapshots), so the analysis
    // steps exactly every 10 ms of audio, like the desktop app.
    this.proc = this.ctx.createScriptProcessor(2048, 2, 1);
    this.proc.onaudioprocess = (ev) => this.onAudio(ev);
    this.source.connect(this.proc);
    this.proc.connect(this.ctx.destination);   // outputs silence; needed for the node to run
    this.running = true;
  }

  stop() {
    if (!this.running) return;
    try { this.source.disconnect(this.proc); this.proc.disconnect(); } catch (e) { /* already gone */ }
    this.proc.onaudioprocess = null;
    this.proc = null;
    this.running = false;
  }

  onAudio(ev) {
    const inb = ev.inputBuffer, n = inb.length, rate = inb.sampleRate;
    const out = ev.outputBuffer.getChannelData(0);
    out.fill(0);
    const ch = inb.numberOfChannels;
    const l = inb.getChannelData(0), r = ch > 1 ? inb.getChannelData(1) : l;
    if (!this.mono || this.mono.length !== n) this.mono = new Float32Array(n);
    const m = this.mono;
    for (let i = 0; i < n; i++) m[i] = 0.5 * (l[i] + r[i]);
    const hop = Math.round(rate / 100);
    let i = 0;
    while (i < n) {
      const take = Math.min(hop - this.pending, n - i);
      this.an.push(m, i, take);
      i += take;
      this.pending += take;
      if (this.pending >= hop) {
        this.pending = 0;
        this.samples += hop;
        this.an.analyze(rate, hop, this.samples / rate, this.frame, this.params);
      }
    }
  }
}
