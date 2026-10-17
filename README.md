# LIMITS — an interactive exhibit for Calculus I

**Student Academic Project — Not an official EUI webpage.**

Allam Ashraf Mohamed · 23-101021
Calculus I · Faculty of Computing and Information Sciences, Egypt University of Informatics
Instructor: Dr. Mahmoud Mokhtar · Teaching Assistant: Youssef Hamed

---

## Run it

You need [Node.js](https://nodejs.org) (any recent version). Nothing to install.

```bash
npm start
```

Then open **http://localhost:4173** in Chrome or Edge.

You can also double-click `index.html` — everything is local (fonts, KaTeX, logo), so it works offline.

## Presentation mode

| Key | Action |
| --- | --- |
| `P` (or the **Present** button) | Enter / leave presentation mode (fullscreen, no page chrome) |
| `↓` `PageDown` `Space` | Next screen |
| `↑` `PageUp` | Previous screen |
| `Home` / `End` | First / last screen |
| `Esc` | Leave fullscreen |

Sliders, buttons and the step-by-step panels keep working while presenting. On a focused slider the arrow keys move the slider; `←` `→` move through the worked example and the proof.

### Hand-gesture remote (`G`)

Needs `npm start` and Chrome/Edge on `http://localhost:4173` (the camera and the tracking engine do not run from a double-clicked file). Press `G` to turn the laptop camera on; a small panel bottom-left shows what it sees. Gestures act only in presentation mode, and the keyboard keeps working.

| Gesture | Action |
| --- | --- |
| ☝ index finger up (hold ~1 s) | Next screen |
| ✋ open hand (hold ~1 s) | Previous screen |
| ✊ fist (hold ~1.5 s) | Pause the remote (grey dot) — fist again to resume |

☝ works like a clicker with build steps: on a screen with its own action it first runs that action (Halve ×4, Approach, Δt → 0, n = 8 … 100, every step of the worked example and the proof), then moves on. ✋ always goes back one screen. A bar at the top shows what is about to happen; lower the hand before it fills to cancel.

One command per gesture: lower the hand (or change shape) before the next one. When your shoulders are in view, a hand below waist height is ignored. `G` again turns the camera off. Logic: `js/gesture/remote.mjs`, tested on the real recordings by `npm test`.

## The idea: *approaching*

A limit is about approaching a value, so every part of the page is built around that one idea:

- **One rule for all motion.** Every animation is an exponential approach, `x(t) = L + (x₀ − L)·e^(−t/τ)`. The remaining distance shrinks by the same fraction every moment, so it tends to 0 — the motion *is* a limit. (In code: `EX.approach` in `js/core.js`.)
- **One rule for colour.** Blue is the function. **Teal** is the approximation — the thing that moves. **Gold** is the limit — the value being approached. The colours come from the EUI logo.
- **Recurring motif.** Two points travelling toward an open circle (the "hole") open and close the exhibit, and appear on every action button.

## What each chapter shows

| # | Chapter | Interaction | Mathematics |
| --- | --- | --- | --- |
| 01 | What is a limit? | Drag x, use the slider, or halve the distance to 2 | f(x) = x + 3; \|x − 2\| and \|f(x) − 5\| shrink together |
| 02 | The hole | *Approach the limit*: two points close in from both sides; a loupe zooms ×10 each time they seem to touch | (x² − 1)/(x − 1) = x + 1 for x ≠ 1; both one-sided limits are 2, so the limit is 2 |
| 03 | Why limits matter | Shrink Δt; choose 4…100 rectangles; four small curves | Secant slope 2 + Δt → 2; Rₙ = 4(n+1)(2n+1)/(3n²) → 8/3 |
| 04 | Computer science | Slide n from 2 to 2²⁰; watch an iteration and gradient descent converge; a mesh refines | (n log₂ n)/n² = (log₂ n)/n → 0, so n log n = o(n²); xₖ₊₁ = (xₖ + 2)/2 → 2 |
| 05 | Limit laws | Reveal the worked example step by step; each step highlights the law it uses | lim (3x² + 2x − 1) as x → 2 = 15 |
| 06 | Advanced / optional | Choose ε; take δ = ε/2 or choose δ yourself and see the counterexample | ε–δ definition; proof of the Sum Law with the triangle inequality |

A note on accuracy (Chapter 04): Big-O is defined by an inequality, not a limit. The page only claims that a limit of 0 shows n log n grows strictly slower than n² (little-o), which implies Big-O.

## How it is built

Plain HTML, CSS, SVG and JavaScript — no framework and no build step, so every line can be explained.

```text
index.html               all content, in reading order
css/exhibit.css          design tokens (EUI colours), layout, components, responsive, reduced motion
js/core.js               shared toolkit: animation loop, EX.approach, Plot (scales + axes), stepper, motif
js/opening.js            title sequence (letters converge) and closing motif
js/ch1-limit.js          Chapter 01
js/ch2-hole.js           Chapter 02 (two-sided approach, loupe, resolution)
js/ch3-applications.js   Chapter 03 (velocity, Riemann sums, small multiples)
js/ch4-computing.js      Chapter 04 (n log n vs n², sequence, gradient descent, mesh)
js/ch5-laws.js           Chapter 05 (linked worked example)
js/ch6-advanced.js       Chapter 06 (ε–δ, proof)
js/presentation.js       top bar, chapter rail, presentation mode, references
assets/                  EUI logo (downloaded from eui.edu.eg), fonts, favicon
vendor/katex/            KaTeX 0.16.11 for mathematical typesetting
server.mjs               tiny local web server (no dependencies)
```

**Accessibility.** Semantic headings and landmarks, keyboard-operable controls, visible focus, text descriptions for every graph, screen-reader announcements for results, and full support for *reduced motion* (every animation jumps straight to its end state).

**Typography.** Newsreader (display and text), Libre Franklin (the typeface of the EUI website) for labels, IBM Plex Mono for numbers in the computing chapter, KaTeX (Computer Modern) for mathematics.

## References

1. Strang, G., & Herman, E. (2016). *Calculus Volume 1*. OpenStax, Rice University. Chapter 2: Limits.
2. Stewart, J. (2015). *Calculus: Early Transcendentals* (8th ed.). Cengage Learning. Chapter 2: Limits and Derivatives.
3. Cormen, T. H., Leiserson, C. E., Rivest, R. L., & Stein, C. (2009). *Introduction to Algorithms* (3rd ed.). MIT Press. Chapter 3: Growth of Functions.
4. Goodfellow, I., Bengio, Y., & Courville, A. (2016). *Deep Learning*. MIT Press. Chapter 4: Numerical Computation.

## Credits and licences

- Fonts: Newsreader, Libre Franklin, IBM Plex Mono — SIL Open Font License (via Google Fonts).
- KaTeX — MIT License (`vendor/katex/LICENSE`).
- The EUI name and logo belong to Egypt University of Informatics. They are used only to identify the course. This is not an official EUI publication.
