# AdKnob: Ad Intensity Control and Labeling for LLM-Native Advertising

**NeurIPS 2026**

Woo Jae Kim, Seongho Keum, Joonsung Jeon, Suhyeon Ha, Sooel Son<sup>&dagger;</sup>, Sung-eui Yoon<sup>&dagger;</sup>

School of Computing, KAIST &nbsp;&nbsp; <sup>&dagger;</sup>Co-corresponding authors

[Project Page](https://wkim97.github.io/AdKnob/) | [Interactive Demo](https://wkim97.github.io/AdKnob/demo.html) | Paper (coming soon)

![AdKnob overview](https://wkim97.github.io/AdKnob/static/images/teaser.png)

## Overview

AdKnob is a framework for LLM-native advertising that addresses two challenges together:

- **Ad intensity control**: new ad control tokens (`[AD_LV_1]` ... `[AD_LV_4]`) with no pretrained semantics, aligned via direct preference optimization (DPO), let a single model generate responses at a desired ad intensity.
- **Ad labeling**: an attention rollout-based attribution mechanism, supervised by an ad-attribution loss, identifies ad segments in the response with no additional inference cost.

We also construct **MI-KnobSet**, the first multi-level ad intensity preference dataset for LLM-native ads.

## Code

Codes will be uploaded soon.

## Citation

```bibtex
@inproceedings{kim2026adknob,
  title     = {AdKnob: Ad Intensity Control and Labeling for LLM-Native Advertising},
  author    = {Kim, Woo Jae and Keum, Seongho and Jeon, Joonsung and Ha, Suhyeon and Son, Sooel and Yoon, Sung-eui},
  booktitle = {Advances in Neural Information Processing Systems (NeurIPS)},
  year      = {2026}
}
```
