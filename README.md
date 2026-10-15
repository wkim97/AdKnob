# AdKnob project page

Source for the project website of
**AdKnob: Ad Intensity Control and Labeling for LLM-Native Advertising** (NeurIPS 2026).

Live at <https://wkim97.github.io/AdKnob/>.

The site is a static page served by GitHub Pages from this `gh-pages` branch.

The interactive demo reads `static/data/demo_data.js`, built from precomputed model outputs
(10 user requests x 10 ads x 4 ad levels) with:

```
python scripts/build_demo_data.py path/to/demo_outputs.json
```
