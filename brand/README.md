# Aarka — brand

## The mark

Two shapes. One solid, one open.

The **floor** is the solid disc. Whatever happens, it is worth something — it tracks the share all
the way down. The **upside** is the open ring. Below the strike it is worth exactly nothing, and the
hole in the middle is that. They sit on a rising diagonal.

The first version of this mark was a circle cut evenly in half. It was wrong, and the reason is
worth writing down: **the two tokens are not symmetric.** One is capped, the other is unbounded; one
always has value, the other frequently has none. A shape that divides something evenly says
"divided" and stops there. Two unequal shapes, one filled and one hollow, say which is which.

It is also not a coin, which most of the timeline is.

The two forms **overlap rather than float apart**, and that is a legibility decision rather than an
aesthetic one. An earlier version had them separated on a diagonal. Under the circular crop that
X, LinkedIn, Discord and GitHub all apply, a diagonal composition wastes the frame, and at 32px
three fine details — two shapes, a gap, and a hole — collapse at the same moment. Joined, it is one
object with one internal detail, and it survives down to 28px.

## Files

| File | Use |
| --- | --- |
| `aarka-avatar-400.png` · `aarka-avatar-1000.png` | profile picture, ink background |
| `aarka-banner-1500x500.png` | X / Twitter header |
| `aarka-mark-512.png` | mark on transparent, amber |
| `aarka-favicon-64.png` | favicon |
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
- The mark stays legible down to 28px; below that, use the solid disc alone.
- Never separate the two forms. They overlap so the mark stays one object when it is small.

## Regenerating

```sh
python3 render.py
```

No dependencies. Pure-stdlib PNG encoding with 4×4 supersampling, so the output is deterministic
and does not depend on a rasteriser being installed.
