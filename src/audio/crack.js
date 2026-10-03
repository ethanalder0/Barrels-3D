/* ---------------------------------------------------------------------------
   Bat contact audio.

   THREE VARIANTS, one per tier of contact. Each is a real recording under
   assets/audios/, served from /audio/<variant>.mp3:

     'barrel'  — flush contact on the sweet spot. The crack.
     'muffled' — solid but off the sweet spot: the energy is going into the bat
                 rather than the ball. A duller, shorter report.
     'miffed'  — mishit. Jam shot, end of the bat, off the handle: almost no
                 crack left, just the thunk.

   Which one a batted ball gets is decided ONLY by exit velocity, in
   contactVariantFor() near the bottom of this file — that is where the
   thresholds live and the one place to change them.

   Each variant also has a SYNTHESIZED fallback, used when its recording cannot
   be fetched or decoded, so a hit is never silent. Each synthesized hit is
   built from four layers:
     1. transient  — the contact edge, a few milliseconds of filtered noise
     2. crack body — a band of noise sweeping downward, the bulk of the "crack"
     3. bat modes  — decaying sinusoids at a wood bat's real bending-mode
                     frequencies (~170 / 600 / 1180 / 1900 Hz)
     4. thud       — the ball's own low compression thump
   ...then soft saturation for loudness, and two early reflections so it sounds
   like it happened in a ballpark rather than in a padded box.

   The synthesized tiers differ in shape, not just in level: 'barrel' is short +
   bright + weak modes, 'muffled' is dull + long + strong modes, and 'miffed' is
   the same again with the last of the brightness gone. Turning one into another
   by changing the gain alone is exactly why the old version didn't convince.
--------------------------------------------------------------------------- */

let ctx = null;
let noiseBuffer = null;
let saturationCurves = {};

/* --- Recorded samples -----------------------------------------------------
   Every number below is MEASURED off the decoded file, not assumed, because
   both of them change how it has to be played:

     transientOffsetMs  Where the hit actually peaks inside the recording. Each
                        file has a lead-in before it. Start the file ON the
                        contact frame and the hit arrives that much AFTER the
                        bat visibly meets the ball, so we start it EARLY by this
                        much and the peak lands on contact.
     gain               What to multiply the file by. These are quiet recordings
                        (-27.7, -13.4 and -19.2 dBFS peak), so at unity they are
                        inaudible next to everything else.

   The gains are NOT all normalised to the same peak. A mishit that comes out of
   the speakers as loud as a barrel throws away the one thing this tiering is
   for, so each target peak steps down with the tier — the same 0.68 / 0.4 sense
   the synthesized presets already had:

     variant   file peak   x gain   -> output peak
     barrel      0.041      22.0        ~0.90
     muffled     0.213       2.9        ~0.62
     miffed      0.110       4.1        ~0.45

   Re-measure (decode, find max |sample| and its index) if a file is replaced.
-------------------------------------------------------------------------- */

const SAMPLES = {
  barrel: {
    url: '/audio/barrel.mp3',
    transientOffsetMs: 338,
    gain: 22,
  },
  muffled: {
    url: '/audio/muffled.mp3',
    transientOffsetMs: 196,
    gain: 2.9,
  },
  miffed: {
    url: '/audio/miffed.mp3',
    transientOffsetMs: 107,
    gain: 4.1,
  },
};

const sampleBuffers = {};   // variant -> decoded AudioBuffer
const sampleBytes = {};     // variant -> Promise<ArrayBuffer>
const sampleDecodes = {};   // variant -> Promise<AudioBuffer>

// Start fetching immediately, at module load: this needs no AudioContext and
// no user gesture, so by the time anyone clicks, the bytes are already here and
// only the (sub-millisecond) decode is left.
function fetchSample(variant) {
  if (!sampleBytes[variant]) {
    sampleBytes[variant] = fetch(SAMPLES[variant].url)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.arrayBuffer();
      });
  }
  return sampleBytes[variant];
}

if (typeof window !== 'undefined') {
  Object.keys(SAMPLES).forEach((v) => {
    fetchSample(v).catch(() => {
      /* fall back to the synth; reported when playback is attempted */
    });
  });
}

/** Decode a fetched sample into the live context. Resolves to null on failure. */
function ensureSample(ac, variant) {
  if (sampleBuffers[variant]) return Promise.resolve(sampleBuffers[variant]);
  if (!sampleDecodes[variant]) {
    sampleDecodes[variant] = fetchSample(variant)
      // decodeAudioData detaches the buffer it is given, so hand it a copy —
      // otherwise a second decode (after disposeAudio) gets an empty one.
      .then((bytes) => ac.decodeAudioData(bytes.slice(0)))
      .then((buf) => {
        sampleBuffers[variant] = buf;
        return buf;
      })
      .catch((err) => {
        console.warn(`[crack] ${variant} sample unavailable, using synth:`, err.message);
        return null;
      });
  }
  return sampleDecodes[variant];
}

/**
 * Schedule a recorded hit so its transient lands exactly on `contactAt`.
 * Returns the source node, or null if the buffer is not ready — the node is
 * what lets a caller call the hit off again before it sounds (see playContact).
 */
function scheduleSample(ac, variant, contactAt, volume) {
  const buf = sampleBuffers[variant];
  if (!buf) return null;

  const spec = SAMPLES[variant];
  const startAt = contactAt - spec.transientOffsetMs / 1000;
  const src = ac.createBufferSource();
  src.buffer = buf;

  const gain = ac.createGain();
  gain.gain.value = spec.gain * Math.max(0, Math.min(1, volume));
  src.connect(gain).connect(ac.destination);

  if (startAt >= ac.currentTime) {
    src.start(startAt);
  } else {
    // Asked for contact sooner than the lead-in allows (e.g. delay: 0 from the
    // Settings preview). Start now and skip into the file so the transient is
    // still as close to on-time as possible.
    src.start(ac.currentTime, Math.min(ac.currentTime - startAt, buf.duration - 0.01));
  }
  return src;
}

/* --- Presets --------------------------------------------------------------
   freq values in Hz, decay values in seconds, peaks are relative 0..1.
   Bat bending-mode frequencies are taken from the measured values for a wood
   bat rather than ideal beam theory, which is why they aren't neat ratios. */

const PRESETS = {
  barrel: {
    // Pushed hard into the saturator and loud coming out.
    //
    // `level` is set by measurement, not by taste: the saturator bounds itself
    // to ±1, but the low shelf and the two reflections all sum in AFTER it, so
    // the real peak lands well above the saturator's own ceiling. At level 0.95
    // this rendered at 1.325 — hard clipping. 0.68 puts the peak just under
    // full scale. Re-measure if you touch the shelf or the reflections.
    drive: 1.0,
    level: 0.68,
    // Bright, violent, and over almost immediately.
    transient: { type: 'highpass', freq: 2300, peak: 1.0, decay: 0.016 },
    snap: { freq: 3600, q: 0.9, peak: 0.85, decay: 0.035 },
    body: { from: 4200, to: 1400, q: 1.4, peak: 0.95, decay: 0.075 },
    // Sweet spot = node → the bat hardly rings. Short decays, modest peaks.
    modes: [
      { freq: 172, peak: 0.30, decay: 0.055 },
      { freq: 610, peak: 0.22, decay: 0.040 },
      { freq: 1180, peak: 0.16, decay: 0.028 },
      { freq: 1950, peak: 0.10, decay: 0.020 },
    ],
    thud: { freq: 120, drop: 82, peak: 0.45, decay: 0.075 },
    saturation: 2.6,
    reflections: [
      { time: 0.026, gain: 0.17, lowpass: 3200 },
      { time: 0.059, gain: 0.09, lowpass: 2200 },
    ],
  },

  muffled: {
    // Barely saturated and well down in level — this should feel like the
    // energy went into the bat rather than the ball.
    drive: 0.4,
    level: 0.4,
    // The bright edge is gone — lowpassed instead of highpassed.
    transient: { type: 'lowpass', freq: 1100, peak: 0.5, decay: 0.022 },
    snap: { freq: 900, q: 1.0, peak: 0.38, decay: 0.055 },
    body: { from: 1500, to: 480, q: 1.1, peak: 0.55, decay: 0.115 },
    // Off the sweet spot → the bending modes get driven hard and ring on.
    modes: [
      { freq: 168, peak: 0.58, decay: 0.34 },
      { freq: 598, peak: 0.34, decay: 0.20 },
      { freq: 1150, peak: 0.13, decay: 0.10 },
      { freq: 1880, peak: 0.05, decay: 0.05 },
    ],
    thud: { freq: 104, drop: 70, peak: 0.58, decay: 0.16 },
    saturation: 1.15,
    reflections: [
      { time: 0.03, gain: 0.1, lowpass: 1400 },
      { time: 0.066, gain: 0.05, lowpass: 1000 },
    ],
  },

  miffed: {
    // A mishit, not a quiet barrel. Barely driven at all and quieter again than
    // 'muffled', with the crack layers pulled down to almost nothing and the
    // bat modes left ringing — a ball off the handle is nearly all bat.
    drive: 0.28,
    level: 0.3,
    transient: { type: 'lowpass', freq: 700, peak: 0.34, decay: 0.028 },
    snap: { freq: 560, q: 1.0, peak: 0.2, decay: 0.07 },
    body: { from: 900, to: 300, q: 1.0, peak: 0.32, decay: 0.15 },
    modes: [
      { freq: 165, peak: 0.66, decay: 0.42 },
      { freq: 590, peak: 0.38, decay: 0.26 },
      { freq: 1140, peak: 0.1, decay: 0.12 },
      { freq: 1870, peak: 0.03, decay: 0.05 },
    ],
    thud: { freq: 96, drop: 62, peak: 0.6, decay: 0.2 },
    saturation: 1.0,
    reflections: [
      { time: 0.032, gain: 0.08, lowpass: 1100 },
      { time: 0.07, gain: 0.04, lowpass: 820 },
    ],
  },
};

export const CONTACT_VARIANTS = Object.keys(PRESETS);

/* --- Context plumbing ---------------------------------------------------- */

function getContext() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function getNoiseBuffer(ac) {
  if (noiseBuffer && noiseBuffer.sampleRate === ac.sampleRate) return noiseBuffer;
  const length = Math.floor(ac.sampleRate * 0.5);
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

/**
 * Soft-clip curve: adds harmonics, so the hit reads as loud without clipping.
 * tanh is bounded by ±1, which makes this the limiter as well — no compressor
 * needed, and the dynamic gap between a barrel and a mishit survives intact.
 *
 * Length is ODD and the mapping is i/(n-1), so there is a sample exactly at
 * x = 0 that maps to 0. With an even length, silence lands between two samples
 * either side of zero and the shaper emits a small constant DC offset instead
 * (measured: -0.0034 after the shelf and reflections). Inaudible on its own,
 * but it eats headroom, can click when the graph starts and stops, and it
 * makes every level measurement wrong.
 */
function getSaturationCurve(ac, amount) {
  const key = String(amount);
  if (saturationCurves[key]) return saturationCurves[key];
  const n = 2049;
  const curve = new Float32Array(n);
  const norm = Math.tanh(amount);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / norm;
  }
  saturationCurves[key] = curve;
  return curve;
}

/** Percussive envelope: effectively instant attack, exponential tail. */
function envelope(param, { peak, attack = 0.0008, decay, at }) {
  const safePeak = Math.max(peak, 0.0002);
  param.setValueAtTime(0.0001, at);
  param.exponentialRampToValueAtTime(safePeak, at + attack);
  param.exponentialRampToValueAtTime(0.0001, at + attack + decay);
}

/* --- The hit ------------------------------------------------------------- */

/**
 * Play a bat/ball contact.
 *
 * @param {'barrel'|'muffled'|'miffed'} [variant='barrel']
 * @param {object}  [opts]
 * @param {number}  [opts.volume=1]  0–1 trim on top of the preset
 * @param {number}  [opts.delay=0]   seconds to wait before the hit
 * @returns {() => void} cancels the hit if it has not sounded yet
 */
export function playContact(variant = 'barrel', { volume = 1, delay = 0 } = {}) {
  const ac = getContext();
  if (!ac) return () => {};

  // Pin the target moment on the audio clock straight away, so a decode that
  // resolves a few milliseconds from now still schedules against the instant
  // the caller asked for rather than drifting late.
  const contactAt = ac.currentTime + delay;

  /* A hit is scheduled ahead of the moment it lands on, so between scheduling
     and sounding the replay can be paused, scrubbed, or replaced by another
     at-bat. `cancel` is how a caller calls it back off — a crack with no swing
     under it is worse than no sound at all. */
  let cancelled = false;
  let node = null;
  const cancel = () => {
    cancelled = true;
    try {
      node?.stop();
    } catch {
      /* already finished */
    }
  };

  if (SAMPLES[variant]) {
    node = scheduleSample(ac, variant, contactAt, volume);
    if (node) return cancel;
    ensureSample(ac, variant).then((buf) => {
      if (cancelled) return;
      node = buf ? scheduleSample(ac, variant, contactAt, volume) : null;
      if (!node) {
        playSynthContact(variant, { volume, delay: Math.max(0, contactAt - ac.currentTime) });
      }
    });
    return cancel;
  }

  playSynthContact(variant, { volume, delay });
  return cancel;
}

/**
 * The fully-synthesized hit — the fallback for every variant, used when that
 * variant's recording cannot be fetched or decoded.
 */
export function playSynthContact(variant = 'barrel', { volume = 1, delay = 0 } = {}) {
  const preset = PRESETS[variant] ?? PRESETS.barrel;
  const ac = getContext();
  if (!ac) return;

  const t = ac.currentTime + delay;
  const trim = Math.max(0, Math.min(1, volume));

  // drive → saturation → warmth → level → out
  //
  // `drive` and `level` are separate on purpose: drive is how hard the signal
  // hits the saturator (character — a barrel is meant to sound pushed), level
  // is the final loudness. One knob for each keeps a barrel both dirtier AND
  // much louder than a mishit, instead of trading one against the other.
  const drive = ac.createGain();
  drive.gain.value = preset.drive;

  const shaper = ac.createWaveShaper();
  shaper.curve = getSaturationCurve(ac, preset.saturation);
  shaper.oversample = '2x';

  const warmth = ac.createBiquadFilter();
  warmth.type = 'lowshelf';
  warmth.frequency.value = 260;
  warmth.gain.value = 3.5;

  const level = ac.createGain();
  level.gain.value = preset.level * trim;

  drive.connect(shaper).connect(warmth).connect(level).connect(ac.destination);

  // Early reflections — cheap ballpark ambience. Fed from the shaped signal so
  // they carry the same character as the direct hit.
  preset.reflections.forEach(({ time, gain, lowpass }) => {
    const delayNode = ac.createDelay(0.5);
    delayNode.delayTime.value = time;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const g = ac.createGain();
    g.gain.value = gain;
    warmth.connect(delayNode).connect(filter).connect(g).connect(level);
  });

  // Every layer below feeds `drive`.
  const master = drive;

  // 1. Contact transient.
  const tr = preset.transient;
  const transient = ac.createBufferSource();
  transient.buffer = getNoiseBuffer(ac);
  const trFilter = ac.createBiquadFilter();
  trFilter.type = tr.type;
  trFilter.frequency.value = tr.freq;
  const trGain = ac.createGain();
  envelope(trGain.gain, { peak: tr.peak, attack: 0.0004, decay: tr.decay, at: t });
  transient.connect(trFilter).connect(trGain).connect(master);
  transient.start(t);
  transient.stop(t + tr.decay + 0.05);

  // 2. Snap — a fixed bright band that gives the hit its "pop".
  const snap = ac.createBufferSource();
  snap.buffer = getNoiseBuffer(ac);
  const snapFilter = ac.createBiquadFilter();
  snapFilter.type = 'bandpass';
  snapFilter.frequency.value = preset.snap.freq;
  snapFilter.Q.value = preset.snap.q;
  const snapGain = ac.createGain();
  envelope(snapGain.gain, { peak: preset.snap.peak, decay: preset.snap.decay, at: t });
  snap.connect(snapFilter).connect(snapGain).connect(master);
  snap.start(t);
  snap.stop(t + preset.snap.decay + 0.05);

  // 3. Crack body — noise band sweeping down, the bulk of the sound.
  const body = ac.createBufferSource();
  body.buffer = getNoiseBuffer(ac);
  const bodyFilter = ac.createBiquadFilter();
  bodyFilter.type = 'bandpass';
  bodyFilter.Q.value = preset.body.q;
  bodyFilter.frequency.setValueAtTime(preset.body.from, t);
  bodyFilter.frequency.exponentialRampToValueAtTime(preset.body.to, t + preset.body.decay);
  const bodyGain = ac.createGain();
  envelope(bodyGain.gain, { peak: preset.body.peak, decay: preset.body.decay, at: t });
  body.connect(bodyFilter).connect(bodyGain).connect(master);
  body.start(t);
  body.stop(t + preset.body.decay + 0.1);

  // 4. Bat bending modes — this is what makes it wood rather than a snare hit.
  preset.modes.forEach(({ freq, peak, decay }) => {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    // Struck wood drops slightly in pitch as the amplitude falls.
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.94, t + decay);
    const g = ac.createGain();
    envelope(g.gain, { peak, decay, at: t });
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  });

  // 5. The ball's own low thump.
  const thud = ac.createOscillator();
  thud.type = 'triangle';
  thud.frequency.setValueAtTime(preset.thud.freq, t);
  thud.frequency.exponentialRampToValueAtTime(preset.thud.drop, t + preset.thud.decay);
  const thudGain = ac.createGain();
  envelope(thudGain.gain, { peak: preset.thud.peak, decay: preset.thud.decay, at: t });
  thud.connect(thudGain).connect(master);
  thud.start(t);
  thud.stop(t + preset.thud.decay + 0.05);
}

/** Flush contact — the loud one. */
export function playBarrelCrack(opts) {
  playContact('barrel', opts);
}

/** Off the sweet spot — the dull one. */
export function playMuffledContact(opts) {
  playContact('muffled', opts);
}

/** A mishit — the quiet thunk. */
export function playMiffedContact(opts) {
  playContact('miffed', opts);
}

/* ---------------------------------------------------------------------------
   THE THRESHOLDS  <-- the one place contact tiers are decided.

   Purely exit velocity, in mph:

     over 105        'barrel'   the crack
     90 to 105       'muffled'  solid, off the sweet spot
     under 90        'miffed'   a mishit

   Exactly 105 and exactly 90 fall to the LOWER tier, so "greater than 105" and
   "greater than 90" mean what they say.
--------------------------------------------------------------------------- */
export const CONTACT_THRESHOLDS = { barrel: 105, muffled: 90 };

/**
 * Which contact sound a batted ball should get.
 *
 * A foul is a mishit by definition — it is what a ball off the end of the bat
 * does — so it takes the tier below whatever its exit velocity earned, and an
 * untracked ball (no exit velocity at all) gets the middle one rather than
 * claiming a barrel nothing measured.
 *
 * This is what the replay engine calls when it plays a hit back; the at-bat
 * payload already carries `exitVelo` (see ReplayViewport.jsx).
 */
export function contactVariantFor({ exitVelo, isFoul = false } = {}) {
  if (exitVelo == null) return isFoul ? 'miffed' : 'muffled';
  if (isFoul) return exitVelo > CONTACT_THRESHOLDS.barrel ? 'muffled' : 'miffed';
  if (exitVelo > CONTACT_THRESHOLDS.barrel) return 'barrel';
  if (exitVelo > CONTACT_THRESHOLDS.muffled) return 'muffled';
  return 'miffed';
}

/** Convenience: pick the variant from a batted ball and play it. */
export function playContactFor(batted, opts) {
  playContact(contactVariantFor(batted), opts);
}

/**
 * The bat cutting air just before contact — a short filtered noise swell.
 * Deliberately quiet; it exists to give the crack somewhere to land.
 */
export function playSwoosh({ volume = 0.5, delay = 0, duration = 0.22 } = {}) {
  const ac = getContext();
  if (!ac) return;

  const t = ac.currentTime + delay;

  const src = ac.createBufferSource();
  src.buffer = getNoiseBuffer(ac);

  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(500, t);
  filter.frequency.exponentialRampToValueAtTime(2400, t + duration);

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.16 * volume, t + duration * 0.75);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  src.connect(filter).connect(gain).connect(ac.destination);
  src.start(t);
  src.stop(t + duration + 0.05);
}

/** Close the context (e.g. on unmount) so we don't leak an audio graph. */
export function disposeAudio() {
  // Not every context type has close() — OfflineAudioContext doesn't in Chrome,
  // which matters because rendering these sounds offline is how they get tested.
  if (ctx && ctx.state !== 'closed' && typeof ctx.close === 'function') {
    try {
      ctx.close();
    } catch {
      /* already closing */
    }
  }
  ctx = null;
  saturationCurves = {};
  // Decoded buffers belong to the context being closed; drop them so the next
  // context re-decodes. The fetched bytes are kept, so this costs no network.
  Object.keys(sampleBuffers).forEach((k) => delete sampleBuffers[k]);
  Object.keys(sampleDecodes).forEach((k) => delete sampleDecodes[k]);
}
