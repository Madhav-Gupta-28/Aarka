# Aarka — brand

## The mark

A circle is one share. The gap through it is the strike.

Below the gap is solid: the **floor**, everything up to the strike. Above it, separated, is the
**upside**. Two pieces that were one piece — which is the entire protocol in one shape.

The split sits above centre on purpose. The floor holds most of the value in any series struck near
spot, so it should look like it does.

The name is Sanskrit — **आर्क (ārka)**, sun, ray — and the mark reads as a sun on a horizon if you
want it to. That is a bonus, not the brief.

## Files

| File | Use |
| --- | --- |
| `aarka-avatar-400.png` · `aarka-avatar-1000.png` | profile picture, ink background |
| `aarka-banner-1500x500.png` | X / Twitter header |
| `aarka-mark-512.png` | mark on transparent, amber |
| `aarka-mark-ink-512.png` | mark on transparent, ink |
| `aarka-mark.svg` · `-ink` · `-paper` | vector mark, three colourways |
| `aarka-wordmark.svg` · `-light` | mark plus wordmark |
| `aarka-avatar.svg` | vector source for the avatar |
| `render.py` | the rasteriser; regenerates every PNG from scratch |

## Colour

```
ink     #0E1116    backgrounds, the wordmark on light
amber   #F2A33C    the mark
paper   #F7F4ED    the wordmark on dark
```

Amber rather than the usual crypto blue or purple: warm, legible against a dark UI, and distinct on
a timeline where everything else is cold.

## Rules

- Keep clear space of at least half the mark's diameter on every side.
- Never re-colour the two halves differently. They are the same asset, divided.
- Never close the gap. The gap is the product.
- The mark stays legible down to 32px; below that, use the solid disc alone.

## Regenerating

```sh
python3 render.py
```

No dependencies. Pure-stdlib PNG encoding with 4×4 supersampling, so the output is deterministic
and does not depend on a rasteriser being installed.
