// Sound for Barrage online: every effect, synthesised at runtime.
//
// This is the root build's sound section, lifted out of the page. The root
// game ships as a single file and has to keep it inline; this one is served by
// the relay, so it can live beside index.html and keep the page's own script
// about the game. Keep the two in step — a sound tuned in one belongs in both.
//
// It knows nothing about the game. The page tells it what is happening and
// where on screen (0 left edge .. 1 right); the page's updateSoundLoops() is
// what drives the sustained sounds each frame. Loaded as a classic script
// before the game's, it publishes one global, window.BarrageSound.
//
// There are no audio assets and there cannot be: one buffer of noise is
// generated on first use and every burst — cannon, blast, rotor chop, rocket
// motor — is that buffer replayed through different filters and envelopes. A
// browser with no Web Audio, and the test harness's stub DOM, both fall
// through to silence rather than throwing.
(function () {
  'use strict';

  const SOUND = {
    enabled: true,    // false hides the slider and silences the game entirely
    volume: 0.45,     // default master level, 0..1, until the player sets their own
    noiseSeconds: 1   // length of the single generated noise buffer
  };

  let audio = null;        // AudioContext, built on the first gesture
  let master = null;       // everything runs through here, so mute is instant
  let noiseBuf = null;     // white noise: cracks, hiss, debris
  let brownBuf = null;     // brown noise: the rumble white noise cannot make
  let soundOn = true;
  let sfxLevel = SOUND.volume; // the player's level from the slider, 0..1
  let liveVoices = 0;      // sources currently sounding; the test seam reads it
  const loops = new Map(); // sustained sounds by name, so each can be stopped

  // White noise, generated once. Every percussive sound in the game is this
  // buffer shaped differently, which is why there is only one of them.
  function makeNoiseBuffer(ctx) {
    const n = Math.floor(ctx.sampleRate * SOUND.noiseSeconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Brown noise: white noise integrated, so its energy sits in the low end the
  // way a real blast's does. Lowpassing white noise down there leaves almost
  // nothing, which is why the old booms were all hiss and no weight. The drift
  // is taken out so the ends meet — these buffers loop, and a step at the seam
  // would click once a second under every rumble.
  function makeBrownBuffer(ctx) {
    const n = Math.floor(ctx.sampleRate * SOUND.noiseSeconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const drift = d[n - 1] - d[0];
    for (let i = 0; i < n; i++) d[i] -= drift * i / (n - 1);
    return buf;
  }

  // An impulse response for open ground, generated like everything else: a
  // decaying noise tail that darkens as it goes, because distance eats the top
  // end of an echo first. Without it every blast stops dead in a vacuum.
  function makeReverbBuffer(ctx) {
    const seconds = 2.8, pre = 0.012;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < n; i++) {
        const t = i / ctx.sampleRate;
        if (t < pre) { d[i] = 0; continue; }
        const a = 0.55 - 0.5 * (i / n);         // one-pole lowpass, closing
        y += a * ((Math.random() * 2 - 1) - y);
        d[i] = y * Math.exp(-(t - pre) * 2.4);
      }
    }
    return buf;
  }

  // Browsers refuse to start audio before a gesture, so the context cannot be
  // built at boot. Exactly one is ever made: they are a limited resource and a
  // page that creates them per round eventually throws.
  function audioCtx() {
    if (audio) return audio;
    if (!SOUND.enabled) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null; // no Web Audio here — the game simply stays silent
    try {
      audio = new AC();
      master = audio.createGain();
      master.gain.value = soundOn ? sfxLevel : 0;
      // A compressor last, so a big sub-bass blast can be loud without
      // clipping the output, and the whistle ducks under it as a real one would.
      const comp = audio.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 8;
      comp.ratio.value = 5;
      comp.attack.value = 0.003;
      comp.release.value = 0.3;
      master.connect(comp);
      comp.connect(audio.destination);
      noiseBuf = makeNoiseBuffer(audio);
      brownBuf = makeBrownBuffer(audio);
    } catch (e) {
      audio = null;
      return null;
    }
    return audio;
  }

  function soundAvailable() {
    return SOUND.enabled && !!(window.AudioContext || window.webkitAudioContext);
  }

  // Counts a source for its lifetime and releases its nodes when it ends, so a
  // long round does not accumulate a graph. The test seam asserts this returns
  // to zero.
  function trackVoice(src, tail) {
    liveVoices++;
    src.onended = () => {
      liveVoices = Math.max(0, liveVoices - 1);
      try { tail.disconnect(); } catch (e) { /* already torn down */ }
    };
  }

  // The bus every gun and blast plays into. Soft clipping first: perfectly
  // clean synthesis is exactly what reads as plastic, and tanh also turns a sub
  // thump into harmonics a laptop speaker can actually reproduce. Then a send
  // into the generated reverb, which is what makes a shot sound like it went
  // off outdoors, rolling back off the hills. Built once; it feeds master, so
  // mute still governs it.
  let shaper = null;
  function blastBus(ctx) {
    if (shaper) return shaper;
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * 2.4);
    shaper = ctx.createWaveShaper();
    shaper.curve = curve;
    shaper.oversample = '2x';
    shaper.connect(master);
    try {
      const verb = ctx.createConvolver();
      verb.buffer = makeReverbBuffer(ctx);
      const send = ctx.createGain();
      send.gain.value = 0.5;
      shaper.connect(send); send.connect(verb); verb.connect(master);
    } catch (e) { /* no convolver: dry is still a blast */ }
    return shaper;
  }

  // One stereo panner per seat, built once and moved per shot, so a gun is
  // heard from where its tank sits. Per seat rather than per shot, because a
  // panner is a node that would otherwise need tearing down after the longest
  // tail, and one seat's shots never overlap. Kept short of hard left/right,
  // which tires on headphones; a mono phone speaker just sums it back, which is
  // why the reload signatures below carry the identity rather than this.
  const panners = [];
  function gunPanner(ctx, seat, x01) {
    const bus = blastBus(ctx);
    if (!ctx.createStereoPanner || !Number.isFinite(x01)) return bus;
    const i = (seat || 0) % RELOADS.length;
    if (!panners[i]) {
      panners[i] = ctx.createStereoPanner();
      panners[i].connect(bus);
    }
    panners[i].pan.setValueAtTime(panOf(x01), ctx.currentTime);
    return panners[i];
  }

  // Screen position to stereo position: 0 is the left edge, 1 the right, and
  // the edges stop short of hard left/right (see gunPanner).
  function panOf(x01) {
    return Number.isFinite(x01) ? Math.max(-1, Math.min(1, x01 * 2 - 1)) * 0.75 : 0;
  }

  // Steers a sustained sound after the thing making it. A glide rather than a
  // step, or a fast shell zippers across the field once a frame.
  function panLoop(l, x01) {
    if (l && l.pan && audio && Number.isFinite(x01)) {
      l.pan.pan.setTargetAtTime(panOf(x01), audio.currentTime, 0.05);
    }
  }

  // Blasts do not move, but they do overlap — a cluster drops several at once.
  // Rather than a panner per blast, to be torn down after its tail, there is a
  // fixed row of them across the field and each blast plays through its zone's.
  const ZONES = 9;
  const zonePanners = [];
  function zonePanner(ctx, x01) {
    const bus = blastBus(ctx);
    if (!ctx.createStereoPanner || !Number.isFinite(x01)) return bus;
    const z = Math.round(Math.max(0, Math.min(1, x01)) * (ZONES - 1));
    if (!zonePanners[z]) {
      zonePanners[z] = ctx.createStereoPanner();
      zonePanners[z].pan.value = panOf(z / (ZONES - 1));
      zonePanners[z].connect(bus);
    }
    return zonePanners[z];
  }

  // Each seat's gun reloads with its own sound, heard once the report has
  // cleared: that is what tells you who fired, on any speaker and whatever the
  // weapon. They follow the seat, not the weapon.
  const RELOAD_AT = 0.38; // seconds after the shot
  const RELOADS = [
    // P1: a heavy steel breech block. The drag of it sliding home, a dead
    // clunk whose ring the sheer mass chokes off, then the lever latching.
    (dest) => {
      const T = RELOAD_AT;
      noiseBurst({ when: T, dur: 0.17, type: 'bandpass', freq: 800, sweepTo: 1500, q: 1.8,
                   gain: 0.14, attack: 0.1, dest });
      noiseBurst({ brown: true, when: T + 0.17, dur: 0.14, freq: 320, q: 0.7, gain: 0.8, attack: 0.001, dest });
      metalHit({ when: T + 0.17, strike: 0.008, gain: 1,
                 modes: [[190, 1, 10], [505, 0.8, 14], [1130, 0.55, 18], [2080, 0.3, 20]], dest });
      metalHit({ when: T + 0.33, strike: 0.004, gain: 0.5,
                 modes: [[1720, 1, 30], [3080, 0.6, 34], [4700, 0.3, 30]], dest });
    },
    // P2: hydraulics — a hiss falling as the pressure bleeds off, then a thunk
    (dest) => {
      noiseBurst({ when: RELOAD_AT, dur: 0.5, type: 'bandpass', freq: 4200, sweepTo: 1600, q: 1.5,
                   gain: 0.2, attack: 0.05, dest });
      toneHit({ when: RELOAD_AT + 0.5, dur: 0.12, f0: 160, f1: 90, gain: 0.3, attack: 0.002, dest });
    },
    // P3: the big brass casing thrown out onto the ground. A clang that keeps
    // ringing, because a free brass tube barely damps; smaller bounces, each a
    // touch off pitch as it turns over; then a short gritty roll.
    (dest) => {
      const T = RELOAD_AT;
      const tube = [[640, 1, 260], [1590, 0.75, 320], [2870, 0.5, 340], [4310, 0.3, 320]];
      noiseBurst({ brown: true, when: T, dur: 0.07, freq: 500, q: 0.7, gain: 0.6, attack: 0.001, dest });
      // Levels measured off an offline render to sit with the breech and the
      // hydraulics; at unity the clang was no louder than the ratchet clicks.
      const bounces = [[0, 1.6, 1], [0.26, 0.72, 1.012], [0.43, 0.4, 0.994], [0.54, 0.2, 1.006]];
      for (const [dt, g, detune] of bounces) {
        metalHit({ when: T + dt, strike: 0.006, gain: g, detune, modes: tube, dest });
      }
      noiseBurst({ when: T + 0.6, dur: 0.3, type: 'bandpass', freq: 2600, q: 2.5,
                   gain: 0.05, attack: 0.03, dest });
    },
    // P4: a ratchet — quick even clicks as the next round is cranked in
    (dest) => {
      for (let i = 0; i < 6; i++) {
        noiseBurst({ when: RELOAD_AT + i * 0.05, dur: 0.014, type: 'bandpass', freq: 3200, q: 5,
                     gain: 0.45, attack: 0.0006, dest });
      }
    },
    // P5: a bolt worked by hand — snapped back, then run home and locked, the
    // second strike a touch lower as it seats
    (dest) => {
      const bolt = [[2300, 1, 60], [3900, 0.6, 70], [6100, 0.3, 80]];
      metalHit({ when: RELOAD_AT, strike: 0.003, gain: 0.55, modes: bolt, dest });
      noiseBurst({ when: RELOAD_AT + 0.02, dur: 0.12, type: 'bandpass', freq: 1800, sweepTo: 2600, q: 2,
                   gain: 0.08, attack: 0.02, dest });
      metalHit({ when: RELOAD_AT + 0.24, strike: 0.003, gain: 0.7, detune: 0.94, modes: bolt, dest });
    },
    // P6: an autoloader — a motor winding up, then the rammer's clack
    (dest) => {
      toneHit({ when: RELOAD_AT, dur: 0.32, f0: 110, f1: 420, gain: 0.12, attack: 0.04, dest });
      noiseBurst({ when: RELOAD_AT + 0.32, dur: 0.03, type: 'bandpass', freq: 2400, q: 3,
                   gain: 0.5, attack: 0.001, dest });
    }
  ];

  // A shaped burst of the noise buffer: the workhorse behind every impact.
  function noiseBurst(o) {
    const ctx = audioCtx();
    if (!ctx || !soundOn) return null;
    const t = ctx.currentTime + (o.when || 0);
    const dur = o.dur || 0.3;
    const src = ctx.createBufferSource();
    src.buffer = o.brown ? brownBuf : noiseBuf;
    src.loop = true;
    src.playbackRate.value = o.rate || 1;
    const filt = ctx.createBiquadFilter();
    filt.type = o.type || 'lowpass';
    filt.Q.value = o.q || 1;
    filt.frequency.setValueAtTime(o.freq || 900, t);
    if (o.sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(30, o.sweepTo), t + dur);
    const g = ctx.createGain();
    const peak = Math.max(0.0002, o.gain || 0.5);
    g.gain.setValueAtTime(0.0001, t);
    // Attack is the difference between a crack and a whump, so it is a knob.
    g.gain.exponentialRampToValueAtTime(peak, t + (o.attack !== undefined ? o.attack : Math.min(0.015, dur * 0.25)));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(o.dest || master);
    // A random offset into the buffer is what stops repeated shots sounding
    // identical — the cheap variation a fixed audio file could not give.
    src.start(t, Math.random() * SOUND.noiseSeconds * 0.5);
    src.stop(t + dur + 0.03);
    trackVoice(src, g);
    return g;
  }

  // A pitched body, for the thump under a blast and the fall of a dying tank.
  function toneHit(o) {
    const ctx = audioCtx();
    if (!ctx || !soundOn) return null;
    const t = ctx.currentTime + (o.when || 0);
    const dur = o.dur || 0.3;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0 || 180, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
    const g = ctx.createGain();
    const peak = Math.max(0.0002, o.gain || 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (o.attack !== undefined ? o.attack : Math.min(0.02, dur * 0.2)));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.dest || master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
    trackVoice(osc, g);
    return g;
  }

  // Struck metal. A sine is a beep however it is enveloped, which is what the
  // first breech and casing sounds were. Metal is a short strike of noise
  // ringing a handful of resonances that are not harmonics of one another,
  // each dying at its own rate — so this is that: a click of noise into
  // parallel high-Q bandpasses. modes are [freq, level, Q]; Q sets the ring
  // (a heavy damped block is low, a free brass tube is very high).
  function metalHit(o) {
    const ctx = audioCtx();
    if (!ctx || !soundOn) return null;
    const t = ctx.currentTime + (o.when || 0);
    const strikeLen = o.strike || 0.01;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const strike = ctx.createGain();
    strike.gain.setValueAtTime(0.0001, t);
    strike.gain.exponentialRampToValueAtTime(1, t + 0.0008);
    strike.gain.exponentialRampToValueAtTime(0.0001, t + strikeLen);
    src.connect(strike);
    const out = ctx.createGain();
    out.gain.value = o.gain || 1;
    out.connect(o.dest || master);
    let ring = 0;
    for (const [f, level, q] of o.modes) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * (o.detune || 1);
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level;
      strike.connect(bp); bp.connect(g); g.connect(out);
      ring = Math.max(ring, q / (Math.PI * f)); // a resonator's decay constant
    }
    src.start(t, Math.random() * SOUND.noiseSeconds * 0.5);
    // Seven decay constants is past -60dB; the source stopping is what
    // releases the nodes, so it has to outlast the ring, not the strike.
    src.stop(t + strikeLen + ring * 7 + 0.05);
    trackVoice(src, out);
    return out;
  }

  // ---- sustained sounds ----
  // These are the ones that can leak: each has to be stopped at a definite
  // point, and stopAllSound() is the backstop when a round ends mid-flight.
  function startLoop(name, build) {
    if (loops.has(name)) return loops.get(name);
    const ctx = audioCtx();
    if (!ctx || !soundOn) return null;
    // Every sustained sound is something moving, so each gets its own panner,
    // steered from the frame loop by panLoop(). build() plays into it.
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.connect(master);
    const l = build(ctx, pan || master);
    if (l) { l.pan = pan; loops.set(name, l); }
    else if (pan) pan.disconnect();
    return l;
  }

  function stopLoop(name) {
    const l = loops.get(name);
    if (!l) return;
    loops.delete(name);
    const release = () => {
      try { l.out.disconnect(); } catch (e) { /* already torn down */ }
      try { if (l.pan) l.pan.disconnect(); } catch (e) { /* already torn down */ }
    };
    try {
      // Stopping a running oscillator dead leaves a click, so every loop is
      // faded out over a few milliseconds and only then torn down.
      const t = audio.currentTime;
      l.gain.gain.cancelScheduledValues(t);
      l.gain.gain.setValueAtTime(Math.max(0.0001, l.gain.gain.value), t);
      l.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      l.src.onended = release;
      l.src.stop(t + 0.06);
    } catch (e) {
      release();
    }
  }

  function stopAllSound() {
    for (const name of Array.from(loops.keys())) stopLoop(name);
  }

  // A looping noise bed with its own gain, shared by the rotor, the rocket
  // motor and the rolling mine — they differ only in filter and modulation.
  function loopBed(ctx, o) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = o.rate || 1;
    const filt = ctx.createBiquadFilter();
    filt.type = o.type || 'lowpass';
    filt.frequency.value = o.freq || 600;
    filt.Q.value = o.q || 1;
    const g = ctx.createGain();
    if (o.attack) {
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(o.gain || 0.1, ctx.currentTime + o.attack);
    } else {
      g.gain.value = o.gain || 0.1;
    }
    src.connect(filt); filt.connect(g); g.connect(o.dest || master);
    src.start();
    return { src, filt, gain: g, out: g };
  }

  // How each weapon sounds in the air, applied to the whistle every frame.
  // All factors on the standard shell: pitch and level scale the note and its
  // loudness, spin the tumble's rate and tumble its depth, shriek the tone and
  // rush the air. A split MIRV's warheads get their own, so the sound changes
  // at the split.
  const FLIGHT = {
    // the reference: everything else is heard against it
    standard: { pitch: 1,    spin: 1,    tumble: 1,   shriek: 1,   rush: 1,    level: 1 },
    // a heavy bomb: low, slow to tumble, more air moved than shriek
    big:      { pitch: 0.62, spin: 0.55, tumble: 1.2, shriek: 0.7, rush: 1.35, level: 1.2 },
    // a canister of bomblets: a lower rattling tumble, fast and deep
    cluster:  { pitch: 0.85, spin: 1.7,  tumble: 1.8, shriek: 0.75, rush: 1.15, level: 1 },
    // a smooth heavy mine: dull, barely tumbling
    roller:   { pitch: 0.75, spin: 0.4,  tumble: 0.5, shriek: 0.5, rush: 1.2,  level: 1 },
    // the MIRV bus before it splits: a steady, slightly low carrier
    mirv:     { pitch: 0.82, spin: 0.6,  tumble: 0.6, shriek: 0.9, rush: 1.1,  level: 1 },
    // its warheads: small, fast and thin — high, quick spin, little air
    warhead:  { pitch: 1.45, spin: 1.35, tumble: 0.9, shriek: 1.3, rush: 0.7,  level: 0.8 },
    // a missile gliding after its burn: finned, so no tumble, all airflow
    missile:  { pitch: 1.2,  spin: 0.25, tumble: 0.2, shriek: 0.55, rush: 1.45, level: 0.9 },
    // a jet's bomb: finned and heavy, a low steady moan with little tumble
    jet:      { pitch: 0.7,  spin: 0.35, tumble: 0.4, shriek: 0.8, rush: 1.3,  level: 1.05 }
  };

  // A split MIRV keeps weapon 'mirv' and is marked split, so that is what
  // picks the warhead; anything without a profile flies as a standard shell.
  function flightOf(p) {
    if (p.weapon === 'mirv' && p.split) return FLIGHT.warhead;
    return FLIGHT[p.weapon] || FLIGHT.standard;
  }

  // ---- the game's voices ----
  const Sound = {
    available: soundAvailable,
    voices: () => liveVoices,
    loops: () => loops.size,
    loopNames: () => Array.from(loops.keys()), // which sustained sounds are live
    muted: () => !soundOn,
    stopAll: stopAllSound,

    // Gun report. Power sets how much charge went in, so a lob is a pop and a
    // flat-out shot is a thump you feel, with the echo coming back off the
    // ground after it.
    // Seat picks the reload signature and x01 (0 left edge, 1 right) the pan.
    fire(power, seat, x01) {
      const ctx = audioCtx();
      if (!ctx || !soundOn) return;
      const dest = gunPanner(ctx, seat, x01);
      RELOADS[(seat || 0) % RELOADS.length](dest);
      const p = Math.max(0, Math.min(100, power)) / 100;
      // The supersonic crack of the charge leaving the barrel.
      noiseBurst({ dur: 0.07, freq: 1600, q: 0.4, type: 'highpass', gain: 0.45, attack: 0.0006, dest });
      // The concussion: brown noise, so it is a shove of air rather than hiss.
      noiseBurst({ brown: true, dur: 0.4 + p * 0.3, freq: 1000 + p * 600, sweepTo: 220, q: 0.5,
                   gain: 0.75 + p * 0.2, attack: 0.002, dest });
      // The thump in the chest: a sine dropping into the sub range, hit hard.
      toneHit({ dur: 0.35 + p * 0.25, f0: 105 + p * 25, f1: 36, gain: 0.55 + p * 0.3, attack: 0.002, dest });
    },

    // Every detonation in the game comes through here, so blast radius is the
    // single knob: a bomblet cracks, a helicopter crash booms.
    // A real detonation is a shock front you hear before anything else, a sub
    // punch you feel, a body of moving air, a rumble that rolls on after it,
    // and dirt coming back down — then the whole thing echoing off the terrain
    // through the blast bus's reverb. The rumble layers are brown noise: white
    // noise lowpassed that far passes almost nothing, which is what left the
    // old boom sounding thin however it was tuned.
    explode(radius, x01) {
      const ctx = audioCtx();
      if (!ctx || !soundOn) return;
      const dest = zonePanner(ctx, x01);
      const r = Math.max(8, radius);
      const big = Math.min(1, r / 74);                 // 74 is the heli crash blast

      // 1. the shock front: broadband and over in a few milliseconds
      noiseBurst({ dur: 0.03 + big * 0.03, freq: 5500, q: 0.3, gain: 0.5, attack: 0.0005, dest });
      // 2. the punch: a sine falling into the sub range, driven into the
      // clipper so it hits rather than hums
      toneHit({ dur: 0.45 + big * 0.7, f0: 80 - big * 25, f1: 26, gain: 0.8 + big * 0.25,
                attack: 0.003, dest });
      // 3. the body: brown noise with its top closing as the fireball expands
      noiseBurst({ brown: true, dur: 0.6 + big * 1.1, freq: 1500 - big * 500, sweepTo: 200,
                   q: 0.6, gain: 0.85 + big * 0.15, attack: 0.003, dest });
      // 4. the rumble rolling away, slower to arrive and far longer
      noiseBurst({ brown: true, when: 0.03, dur: 1.3 + big * 2.4, freq: 360, sweepTo: 110,
                   q: 0.5, gain: 0.45 + big * 0.5, rate: 0.6, attack: 0.09, dest });
      // 5. debris: dirt and fragments pattering down in the half second after
      const bits = Math.round(3 + big * 14);
      for (let i = 0; i < bits; i++) {
        noiseBurst({ when: 0.1 + Math.random() * (0.35 + big * 1.1),
                     dur: 0.015 + Math.random() * 0.04, type: 'bandpass',
                     freq: 1200 + Math.random() * 3500, q: 1.2,
                     gain: (0.04 + Math.random() * 0.07) * (0.6 + big), attack: 0.001, dest });
      }
    },

    // A tank going up: the hit is already playing, this is its ammunition
    // cooking off a beat later — a second, deeper blast and rounds popping.
    destroyed(x01) {
      const ctx = audioCtx();
      if (!ctx || !soundOn) return;
      const dest = zonePanner(ctx, x01);
      toneHit({ when: 0.18, dur: 1.0, f0: 62, f1: 24, gain: 0.75, attack: 0.004, dest });
      noiseBurst({ brown: true, when: 0.18, dur: 1.7, freq: 900, sweepTo: 130, q: 0.5,
                   gain: 0.8, attack: 0.004, dest });
      for (let i = 0; i < 5; i++) {
        noiseBurst({ brown: true, when: 0.35 + Math.random() * 0.9, dur: 0.06,
                     freq: 1800, q: 0.6, gain: 0.3, attack: 0.001, dest });
      }
    },

    tick() {
      noiseBurst({ dur: 0.035, freq: 3200, gain: 0.16, q: 2, type: 'bandpass' });
    },

    // Rotor chop: a noise bed whose gain is swung by a low-frequency
    // oscillator. Pitch drops and the chop slows as the wreck falls.
    rotor(on, falling, x01) {
      if (!on) { stopLoop('rotor'); return; }
      const l = startLoop('rotor', (ctx, dest) => {
        const bed = loopBed(ctx, { freq: 420, q: 1.2, gain: 0.0001, rate: 0.8, dest });
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.value = 15;
        lfoGain.gain.value = 0.09;
        lfo.connect(lfoGain); lfoGain.connect(bed.gain.gain);
        lfo.start();
        bed.gain.gain.value = 0.09;
        bed.lfo = lfo;
        const stop = bed.src.stop.bind(bed.src);
        bed.src.stop = () => { try { lfo.stop(); } catch (e) {} stop(); };
        return bed;
      });
      if (l && l.lfo) l.lfo.frequency.value = falling ? 7 : 15;
      if (l) l.filt.frequency.value = falling ? 240 : 420;
      panLoop(l, x01);
    },

    // The same craft with no air to beat against: on an airless theme the
    // helicopter is a spaceship, so instead of chop there is a steady ion
    // exhaust over a low drive hum. A wreck loses the hum and the exhaust
    // goes dull and dark, the way the rotor's chop slows.
    thruster(on, falling, x01) {
      if (!on) { stopLoop('thruster'); return; }
      const l = startLoop('thruster', (ctx, dest) => {
        const t = ctx.currentTime;
        const out = ctx.createGain();
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(1, t + 0.25);
        out.connect(dest);

        // the exhaust: a band of noise, unswung — nothing is chopping it
        const bed = loopBed(ctx, { freq: 900, q: 0.7, type: 'bandpass', rate: 1.35, gain: 0.07, dest: out });

        // the drive under it: two saws a fifth apart, rolled off so they read
        // as a hum you feel rather than a tone you can name
        const tone = ctx.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.value = 320;
        tone.Q.value = 0.7;
        const hum = ctx.createGain();
        hum.gain.value = 0.05;
        tone.connect(hum); hum.connect(out);
        const oscs = [66, 99].map(f => {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.base = f;
          o.connect(tone);
          o.start();
          return o;
        });

        const stop = bed.src.stop.bind(bed.src);
        bed.src.stop = () => {
          for (const o of oscs) { try { o.stop(); } catch (e) { /* already stopped */ } }
          stop();
        };
        return { src: bed.src, gain: out, out, filt: bed.filt, hum, oscs };
      });
      if (l) {
        l.filt.frequency.value = falling ? 300 : 900;
        l.hum.gain.value = falling ? 0.02 : 0.05;
        for (const o of l.oscs) o.frequency.value = o.base * (falling ? 0.55 : 1);
      }
      panLoop(l, x01);
    },

    // A jet on its pass: a broad roar under a turbine whine. It is heard
    // across the field, so it fades in over half a second rather than
    // starting on the tick it spawns. A wreck loses the whine and the roar
    // goes dark and ragged.
    jet(on, falling, x01) {
      if (!on) { stopLoop('jet'); return; }
      const l = startLoop('jet', (ctx, dest) => {
        const t = ctx.currentTime;
        const out = ctx.createGain();
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(1, t + 0.5);
        out.connect(dest);
        const bed = loopBed(ctx, { freq: 700, q: 0.6, rate: 0.9, gain: 0.12, dest: out });
        const whine = ctx.createOscillator();
        whine.type = 'triangle';
        whine.frequency.value = 1650;
        const whineGain = ctx.createGain();
        whineGain.gain.value = 0.018;
        whine.connect(whineGain); whineGain.connect(out);
        whine.start(t);
        const stop = bed.src.stop.bind(bed.src);
        bed.src.stop = (when) => { try { whine.stop(when); } catch (e) { /* stopped */ } stop(when); };
        return { src: bed.src, gain: out, out, filt: bed.filt, whine, whineGain };
      });
      if (l) {
        l.filt.frequency.value = falling ? 320 : 700;
        l.whineGain.gain.value = falling ? 0 : 0.018;
      }
      panLoop(l, x01);
    },

    // Rocket motor, for as long as the burn lasts.
    motor(on, x01) {
      if (!on) { stopLoop('motor'); return; }
      panLoop(startLoop('motor', (ctx, dest) =>
        loopBed(ctx, { freq: 1100, q: 0.8, gain: 0.14, type: 'bandpass', rate: 1.6, dest })), x01);
    },

    // The shell's flight, given a shape instead of one long glide. o carries
    // pitch01 (1 climbing .. 0 falling), speed01 (0 hanging still .. 1 a
    // full-power shot), impactIn (seconds to landing), x01 (for the pan) and
    // flight, the weapon's FLIGHT profile.
    //  - Speed is the energy: a fast shell is loud, bright and tumbling, and
    //    one hanging at the top of its arc goes hushed and airy.
    //  - The last second and a half is the approach: it swells and the note
    //    sags, then ducks away just before impact, so the blast lands into a
    //    breath of quiet rather than on top of the whistle.
    //  - Every shell draws its own pitch, beat, wobble and spin as it sets off,
    //    so no two shots whistle alike.
    whistle(on, o) {
      if (!on) { stopLoop('whistle'); return; }
      o = o || {};
      // The voice itself is a shrieking tone and the air rushing past it. A
      // clean sine alone was a person whistling and filtered noise alone was
      // wind; so two sines a few cents apart, beating the way a real shriek
      // wavers, a slow random wobble on their pitch, and a band of noise riding
      // the same pitch for the rush.
      const l = startLoop('whistle', (ctx, dest) => {
        const t = ctx.currentTime;
        const rnd = (a, b) => a + Math.random() * (b - a);
        const shell = { tone: rnd(0.88, 1.12), beat: rnd(1.004, 1.011), spin: rnd(0.8, 1.25) };

        const out = ctx.createGain();            // stopLoop fades this one
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(1, t + 0.15);
        const level = ctx.createGain();          // speed and approach, set per frame
        level.gain.value = 0.08;
        // The tumble: a spinning shell sweeps its noise past you, so the level
        // is swung by an oscillator whose rate and depth follow speed. The
        // swing stays under 1, so the gain never goes negative.
        const flutter = ctx.createGain();
        flutter.gain.value = 1;
        const spin = ctx.createOscillator();
        spin.frequency.value = 8;
        const spinDepth = ctx.createGain();
        spinDepth.gain.value = 0;
        spin.connect(spinDepth); spinDepth.connect(flutter.gain);
        level.connect(flutter); flutter.connect(out); out.connect(dest);

        const osc = ctx.createOscillator(), osc2 = ctx.createOscillator();
        osc.frequency.value = 1000; osc2.frequency.value = 1000 * shell.beat;
        const toneGain = ctx.createGain();
        toneGain.gain.value = 0.55;
        osc.connect(toneGain); osc2.connect(toneGain); toneGain.connect(level);

        // The wobble: brown noise slowed right down and lowpassed, added to
        // both oscillators' frequency.
        const wob = ctx.createBufferSource();
        wob.buffer = brownBuf; wob.loop = true; wob.playbackRate.value = 0.5;
        const wobFilt = ctx.createBiquadFilter();
        wobFilt.type = 'lowpass'; wobFilt.frequency.value = 20;
        const wobDepth = ctx.createGain();
        wobDepth.gain.value = rnd(25, 70);       // Hz of wander, this shell's own
        wob.connect(wobFilt); wobFilt.connect(wobDepth);
        wobDepth.connect(osc.frequency); wobDepth.connect(osc2.frequency);

        // The rush: noise in a band around the tone.
        const rush = ctx.createBufferSource();
        rush.buffer = noiseBuf; rush.loop = true; rush.playbackRate.value = 1.3;
        const filt = ctx.createBiquadFilter();
        filt.type = 'bandpass'; filt.frequency.value = 1000; filt.Q.value = 3;
        const rushGain = ctx.createGain();
        rushGain.gain.value = 0.9;
        rush.connect(filt); filt.connect(rushGain); rushGain.connect(level);

        const offset = Math.random() * SOUND.noiseSeconds * 0.5;
        osc.start(t); osc2.start(t); spin.start(t); wob.start(t, offset); rush.start(t, offset);
        // stopLoop stops l.src; the rest have to go with it.
        const stop = osc.stop.bind(osc);
        osc.stop = (when) => {
          for (const s of [osc2, spin, wob, rush]) { try { s.stop(when); } catch (e) { /* stopped */ } }
          stop(when);
        };
        return { src: osc, gain: out, out, filt, osc, osc2, level, toneGain, rushGain,
                 spin, spinDepth, shell };
      });
      if (l && audio) {
        const now = audio.currentTime;
        const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
        const p = clamp01(o.pitch01);
        const s = clamp01(o.speed01);
        const fl = o.flight || FLIGHT.standard;
        const eta = Number.isFinite(o.impactIn) ? Math.max(0, o.impactIn) : Infinity;
        const approach = eta < 1.5 ? 1 - eta / 1.5 : 0; // 0 until the last 1.5s, 1 at impact
        const a2 = approach * approach;                 // so it gathers rather than ramps

        // Pitch: rising high, falling low, and sagging further on the approach
        // — the drop that says it is coming down on you. setTargetAtTime glides
        // rather than steps, so it slides with the shell instead of zippering.
        const f = (420 + p * 1150) * l.shell.tone * fl.pitch * (1 - 0.3 * a2);
        l.osc.frequency.setTargetAtTime(f, now, 0.05);
        l.osc2.frequency.setTargetAtTime(f * l.shell.beat, now, 0.05);
        l.filt.frequency.setTargetAtTime(f, now, 0.05);

        // Speed: a wider, brighter rush and more shriek when fast; narrow and
        // soft hanging at the apex.
        l.filt.Q.setTargetAtTime(6 - s * 4, now, 0.1);
        l.toneGain.gain.setTargetAtTime((0.25 + s * 0.4) * fl.shriek, now, 0.1);
        l.rushGain.gain.setTargetAtTime((0.5 + s * 0.8) * fl.rush, now, 0.1);

        // Level: speed, swelled by the approach, then the breath before the
        // boom — away over the last tenth of a second, and quickly.
        let lvl = (0.04 + Math.pow(s, 1.5) * 0.14) * (1 + 1.2 * a2) * fl.level;
        if (eta < 0.1) lvl *= Math.max(0.1, eta / 0.1);
        l.level.gain.setTargetAtTime(lvl, now, eta < 0.25 ? 0.02 : 0.1);

        // Tumble: spins faster and swings deeper the faster it goes.
        l.spin.frequency.setTargetAtTime((6 + s * 16) * l.shell.spin * fl.spin, now, 0.1);
        // capped under 1 so a deep tumble never swings the gain negative
        l.spinDepth.gain.setTargetAtTime(Math.min(0.9, (0.08 + s * 0.3) * fl.tumble), now, 0.1);

        panLoop(l, o.x01);
      }
    },

    // Rolling mine: a low rumble that tracks how fast it is actually moving,
    // so it fades out as the mine stalls.
    rumble(on, speed01, x01) {
      if (!on) { stopLoop('rumble'); return; }
      const l = startLoop('rumble', (ctx, dest) => loopBed(ctx, { freq: 220, q: 1.5, gain: 0.02, rate: 0.4, dest }));
      if (l) l.gain.gain.value = 0.02 + Math.max(0, Math.min(1, speed01)) * 0.13;
      panLoop(l, x01);
    }
  };

  // Mute keeps the context alive and drops the master to zero, so unmuting is
  // instant; the sustained sounds are cut as well or they would come back mid
  // note.
  function setSoundOn(on) {
    soundOn = on;
    if (!on) stopAllSound();
    if (master && audio) {
      master.gain.cancelScheduledValues(audio.currentTime);
      master.gain.setValueAtTime(on ? sfxLevel : 0, audio.currentTime);
    }
    try { localStorage.setItem('barrage.sound', on ? '1' : '0'); } catch (e) { /* private mode */ }
  }

  // The slider is a position and the level is a gain. Loudness is heard on a
  // log scale, so a linear mapping does all its audible work in the bottom
  // quarter of the travel; squaring spreads it evenly along the slider.
  const sliderToLevel = (v) => Math.pow(Math.max(0, Math.min(100, Number(v) || 0)) / 100, 2);
  const levelToSlider = (l) => Math.round(Math.sqrt(Math.max(0, Math.min(1, l))) * 100);

  function setSfxLevel(level) {
    sfxLevel = Math.max(0, Math.min(1, level));
    // A short glide rather than a jump, or dragging the slider zippers.
    if (master && audio && soundOn) {
      master.gain.cancelScheduledValues(audio.currentTime);
      master.gain.setTargetAtTime(sfxLevel, audio.currentTime, 0.02);
    }
    try { localStorage.setItem('barrage.sfxLevel', String(sfxLevel)); } catch (e) { /* private mode */ }
  }

  // The player's stored level, read once at boot. The slider is the only
  // control, so off is simply zero; a stored 'barrage.sound' of '0' is the old
  // on/off switch, and whoever turned it off comes back at zero rather than
  // suddenly loud.
  function loadLevel() {
    let stored = null, storedLevel = null;
    try {
      stored = localStorage.getItem('barrage.sound');
      storedLevel = localStorage.getItem('barrage.sfxLevel');
    } catch (e) { /* private mode */ }
    const parsed = storedLevel == null ? NaN : parseFloat(storedLevel);
    sfxLevel = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : SOUND.volume;
    if (stored === '0') sfxLevel = 0;
    soundOn = sfxLevel > 0;
    return sfxLevel;
  }

  // The context can only be created inside a gesture, so the page calls this
  // on the first one it sees; after that it just resumes a context the tab
  // suspended while it was in the background.
  function wake() {
    const ctx = audioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  window.BarrageSound = {
    SOUND, Sound, FLIGHT, RELOADS, flightOf, panOf,
    audioCtx, gunPanner, zonePanner, soundAvailable, stopAllSound,
    setSoundOn, setSfxLevel, sliderToLevel, levelToSlider, loadLevel, wake,
    isOn: () => soundOn,
    level: () => sfxLevel
  };
})();
