# Polar H10 ECG Waveform Notes

This project now renders a live Polar H10 ECG waveform using raw PMD ECG samples, while preserving the existing monitor-style UI and the flatline-to-live transition behavior.

## What the app does

- Connects to a Polar H10 over Web Bluetooth
- Starts the Polar PMD ECG stream at 130 Hz
- Parses signed 24-bit little-endian microvolt samples
- Feeds those raw samples into:
  - the ECG waveform display
  - the respiratory-rate estimator
- Morphs from the simulated flatline into the live ECG trace once raw ECG is available

## Current rendering model

The waveform renderer lives in [src/lib/components/HeartWaveform.svelte](/c:/Users/1234c/deltoideus/src/lib/components/HeartWaveform.svelte:1).

The current approach is intentionally simple:

1. Incoming ECG packets provide raw microvolt samples.
2. Samples are pushed into a raw display queue.
3. The queue is drained at a fixed 130 Hz display rate.
4. The visible strip holds a rolling 4-second raw sample window.
5. Display normalization happens at draw time from the visible raw window.
6. Each sample stores the morph amount it had when it entered the strip, so already-drawn beats do not resize later.

## Why the renderer works better now

Several earlier versions mixed together:

- signal shaping
- normalization
- morphing
- and stored display values

That made the morphology unstable and could distort the relative height of the R and T waves.

The current renderer avoids that by keeping the rolling strip as raw samples until draw time. The morph only affects geometry, not the underlying sample amplitude.

## Transition behavior

The transition from flatline to raw ECG is a morph, not a fade.

- `rawEcgMorph = 0` draws a flatline at the monitor baseline
- `rawEcgMorph = 1` draws the full normalized raw ECG
- values in between blend the geometry between those two states

Each sample commits its own morph amount when it enters the visible strip. That means transition beats keep their shape instead of being resized later as the morph progresses.

## Initial raw ECG buffer

The renderer uses a 5-second raw ECG warm buffer before showing the live trace.

This is not a replay buffer. Raw samples start advancing offscreen immediately, and the waveform only becomes visible once the buffer is primed. That lets the display appear already settled instead of showing the unstable first seconds of acquisition.

## Normalization

The displayed ECG is normalized from the visible raw window using percentile bounds:

- lower bound: `2%`
- upper bound: `99.5%`

This preserves the sharper R peaks better than the earlier symmetric median/deviation scaling, which made broad T waves look too similar in height.

## Polar H10 raw ECG details

Implemented in [src/lib/polar.ts](/c:/Users/1234c/deltoideus/src/lib/polar.ts:1).

- PMD Service: `fb005c80-02e7-f387-1cad-8acd2d8df0c8`
- PMD Control Characteristic: `fb005c81-02e7-f387-1cad-8acd2d8df0c8`
- PMD Data Characteristic: `fb005c82-02e7-f387-1cad-8acd2d8df0c8`
- ECG sample rate: `130 Hz`

Packet parsing:

- byte `0`: measurement type
- bytes `1-8`: timestamp (uint64 little-endian)
- byte `9`: frame type
- bytes `10+`: ECG samples in signed 24-bit little-endian format

Signed 24-bit conversion:

```ts
const unsigned = b0 | (b1 << 8) | (b2 << 16);
const microvolts = unsigned & 0x800000 ? unsigned - 0x1000000 : unsigned;
```

## Respiratory rate

The respiratory-rate estimator lives in [src/lib/respiration.ts](/c:/Users/1234c/deltoideus/src/lib/respiration.ts:1).

It consumes the same raw ECG samples used by the waveform and estimates breaths per minute from ECG-derived respiratory variation.

Current estimate sources:

- QRS amplitude variation
- baseline variation
- RR interval variation

These are fused into a single respiratory-rate estimate.

Current confidence behavior:

- an instant confidence comes from the current spectral evidence and source agreement
- segment history tracks recent respiratory estimates in 10-second windows
- evidence confidence rises when those recent segments stay stable over time
- final confidence can be promoted toward the evidence level after a sustained stable streak
- evidence itself can receive a small boost once a stronger stability threshold is met

The sensor page now shows only the respiratory-rate value, while the ECG page remains the debugging surface for confidence and estimator behavior.

## Pages using raw ECG

- [ECG page](/c:/Users/1234c/deltoideus/src/routes/app/ecg/+page.svelte:1)
- [Sensor page](/c:/Users/1234c/deltoideus/src/routes/app/sensor/+page.svelte:1)

Both pages can receive live Polar H10 raw ECG, and both can show the same monitor waveform component.

## Practical note

This is a visual monitor, not a diagnostic ECG viewer. The goal of the renderer is:

- believable real ECG morphology
- calm on-screen motion
- smooth transition from idle to live signal

without compromising the raw data path used for the underlying estimates.
