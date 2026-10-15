// Interactive demo, shared by index.html and demo.html. Expects window.ADKNOB_DEMO
// (static/data/demo_data.js) and the #demo-* elements.
(function () {
  const data = window.ADKNOB_DEMO;
  const card = document.getElementById('demo-card');
  if (!data) {
    card.innerHTML = '<p style="text-align:center; color:#6b7280; margin:0;">The demo could not be loaded.</p>';
    return;
  }

  const TOPIC = {
    banking: 'Banking', car: 'Cars', gaming: 'Gaming', healthcare: 'Healthcare', shopping: 'Shopping',
    workout: 'Fitness', real_estate: 'Real estate', restaurant: 'Restaurants', streaming: 'Streaming',
    vacation: 'Travel'
  };
  const LEVEL_COLOR = { 1: '#7aa7d9', 2: '#4f86c6', 3: '#2f6db5', 4: '#1d4a8f' };
  const TAU_DEFAULT = data.tau_default || 0.005;
  const TAU_MIN = data.tau_range ? data.tau_range[0] : 0.0005;
  const TAU_MAX = data.tau_range ? data.tau_range[1] : 0.05;

  const promptSel = document.getElementById('demo-prompt');
  const adSel = document.getElementById('demo-ad');
  const levelInput = document.getElementById('demo-level');
  const levelTicks = document.querySelectorAll('#demo-level-ticks button');
  function showLevel(level) {
    levelInput.value = level;
    levelInput.setAttribute('aria-valuetext', `Level ${level}`);
    levelTicks.forEach(t => t.classList.toggle('active', Number(t.dataset.level) === level));
  }
  const tauInput = document.getElementById('demo-threshold');
  const tauValue = document.getElementById('demo-threshold-value');
  const showLabels = document.getElementById('demo-show-labels');

  const state = { prompt: data.prompts[0].id, ad: data.ads[0].id, level: 2, tau: TAU_DEFAULT };

  const toSlider = tau => Math.round(1000 * (Math.log10(tau) - Math.log10(TAU_MIN)) /
                                     (Math.log10(TAU_MAX) - Math.log10(TAU_MIN)));
  const fromSlider = v => Math.pow(10, Math.log10(TAU_MIN) + (v / 1000) * (Math.log10(TAU_MAX) - Math.log10(TAU_MIN)));

  data.prompts.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = `[${TOPIC[p.meta_topic] || p.meta_topic}] ${p.text}`;
    promptSel.appendChild(o);
  });
  const adById = {};
  data.ads.forEach(a => { adById[a.id] = a; });
  const adsFor = p => (data.ads_by_prompt
    ? (data.ads_by_prompt[String(p)] || []).map(id => adById[id]).filter(Boolean)
    : data.ads);

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Light markdown for model output: strip heading marks, render **bold**.
  function renderText(s) {
    return escapeHtml(s)
      .replace(/(^|\n)#{1,6}\s*/g, '$1')
      .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  }

  const responseEl = document.getElementById('demo-response');
  const countEl = document.getElementById('demo-count');
  const skipBtn = document.getElementById('demo-skip');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CHARS_PER_SEC = 220;
  let anim = null;

  const currentRes = () => {
    const combo = data.results[`${state.prompt}_${state.ad}`];
    return combo && combo[String(state.level)];
  };

  // Present mode (demo.html): inputs are typed out and the provider token pops in on level changes.
  const presentMode = card.dataset.mode === 'present';
  const advertiserEl = document.getElementById('demo-advertiser');
  const userEl = document.getElementById('demo-user');
  const providerEl = document.getElementById('demo-provider');
  let shownLevel = null;

  // Advertiser and user inputs as [text, tag] segments, so they can also be typed out.
  function inputSegments() {
    const prompt = data.prompts.find(p => p.id === state.prompt);
    const ad = adById[state.ad];
    return {
      advertiser: [['Advertise ', null], [ad.brand, 'strong'], [', highlighting: ', null], [ad.ad_copy, 'em']],
      user: [[prompt.text, null]],
    };
  }

  // HTML for the first n characters of the segments.
  function segmentsHtml(segs, n = Infinity) {
    let html = '';
    let left = n;
    for (const [text, tag] of segs) {
      if (left <= 0) break;
      const part = escapeHtml(text.slice(0, left));
      left -= text.length;
      html += tag ? `<${tag}>${part}</${tag}>` : part;
    }
    return html;
  }

  function renderProvider() {
    if (presentMode && shownLevel === state.level) return;
    providerEl.innerHTML = `<span class="control-token${presentMode ? ' pop' : ''}" ` +
      `style="background:${LEVEL_COLOR[state.level]}">[AD_LV_${state.level}]</span>`;
    shownLevel = state.level;
  }

  function typeInto(el, segs, cps) {
    const total = segs.reduce((n, [text]) => n + text.length, 0);
    // Reserve the final height up front so the layout below does not move while typing.
    el.innerHTML = segmentsHtml(segs);
    el.style.minHeight = getComputedStyle(el).height;
    return new Promise(resolve => {
      let n = 0;
      (function step() {
        n += 1;
        if (n >= total) {
          el.innerHTML = segmentsHtml(segs);
          resolve();
          return;
        }
        el.innerHTML = segmentsHtml(segs, n) + '<span class="caret"></span>';
        setTimeout(step, (1000 / cps) * (0.6 + Math.random() * 0.8));
      })();
    });
  }

  // Type the advertiser's input, then the user's request, character by character.
  // Give the (empty) input boxes their final heights, so nothing below them moves while typing.
  function reserveInputHeights() {
    const segs = inputSegments();
    [[advertiserEl, segs.advertiser], [userEl, segs.user]].forEach(([el, seg]) => {
      const shown = el.innerHTML;
      el.style.minHeight = '';
      el.innerHTML = segmentsHtml(seg);
      el.style.minHeight = getComputedStyle(el).height;
      el.innerHTML = shown;
    });
  }

  async function typeInputs(cps = 40) {
    const segs = inputSegments();
    reserveInputHeights();
    advertiserEl.innerHTML = '';
    userEl.innerHTML = '';
    await typeInto(advertiserEl, segs.advertiser, cps);
    await new Promise(r => setTimeout(r, 450));
    await typeInto(userEl, segs.user, cps);
  }

  function renderHeader() {
    const segs = inputSegments();
    advertiserEl.innerHTML = segmentsHtml(segs.advertiser);
    userEl.innerHTML = segmentsHtml(segs.user);
    renderProvider();
    showLevel(state.level);
    tauValue.textContent = state.tau.toPrecision(2);
  }

  // Split a response into plain gaps and scored sentences that together cover the text.
  function segmentsOf(res) {
    const spans = res.spans.slice().sort((x, y) => x.start - y.start);
    const segs = [];
    let c = 0;
    spans.forEach(sp => {
      if (sp.start < c) return;
      if (sp.start > c) segs.push({ start: c, end: sp.start });
      segs.push({ start: sp.start, end: sp.end, score: sp.score });
      c = sp.end;
    });
    if (c < res.response.length) segs.push({ start: c, end: res.response.length });
    return segs;
  }

  function segmentHtml(text, seg, fresh) {
    const body = renderText(text.slice(seg.start, seg.end));
    if (seg.score === undefined) return body;
    const title = `attribution score ${seg.score.toFixed(4)}`;
    if (seg.score > state.tau && showLabels.checked) {
      return `<span class="ad-sent${fresh ? ' fresh' : ''}" title="${title}"><span class="ad-tag">AD</span>${body}</span>`;
    }
    return `<span title="${title}">${body}</span>`;
  }

  function showCount(res) {
    const n = res.spans.filter(sp => sp.score > state.tau).length;
    countEl.textContent = `${n} of ${res.spans.length} sentences labeled as ad at τ = ${state.tau.toPrecision(2)}`;
  }

  function stopAnim() {
    if (anim) {
      clearTimeout(anim.timer);
      anim = null;
    }
    skipBtn.hidden = true;
  }

  // Full response at once (threshold / label changes, skip, reduced motion).
  function renderStatic() {
    stopAnim();
    renderHeader();
    const res = currentRes();
    if (!res) {
      responseEl.textContent = 'This combination is not available.';
      countEl.textContent = '';
      return;
    }
    responseEl.innerHTML = segmentsOf(res).map(seg => segmentHtml(res.response, seg, false)).join('');
    showCount(res);
  }

  function followStream() {
    if (responseEl.scrollHeight > responseEl.clientHeight + 1) responseEl.scrollTop = responseEl.scrollHeight;
  }

  // Stream the response like a chat model, labeling each sentence as it completes.
  function generate() {
    stopAnim();
    renderHeader();
    const res = currentRes();
    if (!res || reduceMotion || document.hidden) {
      renderStatic();
      return;
    }
    const text = res.response;
    const segs = segmentsOf(res);
    const a = anim = { timer: null };
    responseEl.innerHTML =
      '<span class="generating">Generating<span class="dots"><span>.</span><span>.</span><span>.</span></span></span>';
    countEl.textContent = '';
    skipBtn.hidden = false;

    a.timer = setTimeout(() => {
      responseEl.innerHTML = '';
      const caret = document.createElement('span');
      caret.className = 'caret';
      responseEl.appendChild(caret);
      let segIdx = 0;
      let node = null;
      let t0 = null;

      function frame() {
        if (anim !== a) return;
        const ts = performance.now();
        if (t0 === null) t0 = ts;
        const target = Math.min(text.length, Math.floor(((ts - t0) / 1000) * CHARS_PER_SEC));
        while (segIdx < segs.length) {
          const seg = segs[segIdx];
          if (!node) {
            node = document.createElement('span');
            responseEl.insertBefore(node, caret);
          }
          if (target >= seg.end) {
            const tmp = document.createElement('template');
            tmp.innerHTML = segmentHtml(text, seg, true);
            node.replaceWith(tmp.content);
            followStream();
            node = null;
            segIdx += 1;
          } else {
            // Partial sentence: plain text, markdown marks hidden until the sentence completes.
            node.textContent = text.slice(seg.start, Math.max(seg.start, target))
              .replace(/\*\*/g, '').replace(/(^|\n)#{1,6}\s*/g, '$1');
            followStream();
            break;
          }
        }
        if (segIdx >= segs.length) {
          caret.remove();
          skipBtn.hidden = true;
          anim = null;
          showCount(res);
          return;
        }
        a.timer = setTimeout(frame, 30);
      }
      frame();
    }, 900 + Math.random() * 600);
  }

  const hasCombo = (p, a) => Boolean(data.results[`${p}_${a}`]);

  // Offer the brands from the selected request's topic that have outputs.
  function syncAdOptions() {
    adSel.innerHTML = '';
    adsFor(state.prompt).filter(a => hasCombo(state.prompt, a.id)).forEach(a => {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = `${a.brand} · ${a.ad_copy}`;
      adSel.appendChild(o);
    });
    if (!hasCombo(state.prompt, state.ad) && adSel.options.length) {
      state.ad = Number(adSel.options[0].value);
    }
    adSel.value = state.ad;
  }

  promptSel.addEventListener('change', () => { state.prompt = Number(promptSel.value); syncAdOptions(); generate(); });
  adSel.addEventListener('change', () => { state.ad = Number(adSel.value); generate(); });
  // Dragging only moves the knob; releasing it (or a keyboard step) generates.
  levelInput.addEventListener('input', () => showLevel(Number(levelInput.value)));
  levelInput.addEventListener('change', () => {
    const level = Number(levelInput.value);
    if (level !== state.level) { state.level = level; generate(); }
  });
  levelTicks.forEach(t => t.addEventListener('click', () => {
    const level = Number(t.dataset.level);
    if (level !== state.level) { state.level = level; generate(); }
  }));
  tauInput.addEventListener('input', () => { state.tau = fromSlider(Number(tauInput.value)); renderStatic(); });
  document.getElementById('demo-threshold-reset').addEventListener('click', () => {
    state.tau = TAU_DEFAULT;
    tauInput.value = toSlider(TAU_DEFAULT);
    renderStatic();
  });
  showLabels.addEventListener('change', renderStatic);
  skipBtn.addEventListener('click', renderStatic);
  // Background tabs throttle timers and pause animations; finish at once instead.
  document.addEventListener('visibilitychange', () => { if (document.hidden && anim) renderStatic(); });

  const tauDefaultEl = document.getElementById('demo-tau-default');
  if (tauDefaultEl) tauDefaultEl.textContent = TAU_DEFAULT.toPrecision(2);

  // Only list requests that have outputs, and start on the first of them.
  Array.from(promptSel.options).forEach(o => {
    if (!adsFor(Number(o.value)).some(a => hasCombo(Number(o.value), a.id))) o.remove();
  });
  const firstPrompt = data.prompts.find(p => adsFor(p.id).some(a => hasCombo(p.id, a.id)));
  if (firstPrompt) state.prompt = firstPrompt.id;
  const firstAd = adsFor(state.prompt).find(a => hasCombo(state.prompt, a.id));
  if (firstAd) state.ad = firstAd.id;

  // Optional initial state from the URL, e.g. ?prompt=120&ad=172&level=1&tau=0.01&autoplay=0
  const query = new URLSearchParams(window.location.search);
  const qPrompt = Number(query.get('prompt'));
  if (query.has('prompt') && adsFor(qPrompt).some(a => hasCombo(qPrompt, a.id))) {
    state.prompt = qPrompt;
    state.ad = adsFor(qPrompt).find(a => hasCombo(qPrompt, a.id)).id;
  }
  const qAd = Number(query.get('ad'));
  if (query.has('ad') && hasCombo(state.prompt, qAd)) state.ad = qAd;
  const qLevel = Number(query.get('level'));
  if ([1, 2, 3, 4].includes(qLevel)) state.level = qLevel;
  const qTau = Number(query.get('tau'));
  if (query.has('tau') && qTau >= TAU_MIN && qTau <= TAU_MAX) state.tau = qTau;

  promptSel.value = state.prompt;
  syncAdOptions();
  tauInput.value = toSlider(state.tau);
  renderHeader();

  // Hooks for scripted recordings (demo.html).
  window.adknobDemo = { state, generate, renderStatic, typeInputs, isStreaming: () => anim !== null };

  // Generate the first response once the demo scrolls into view (unless ?autoplay=0).
  if (query.get('autoplay') === '0') {
    responseEl.innerHTML = '';
    if (presentMode) {
      advertiserEl.innerHTML = '';
      userEl.innerHTML = '';
      providerEl.innerHTML = '';
      shownLevel = null;
      reserveInputHeights();
      if (document.fonts) document.fonts.ready.then(reserveInputHeights);
    }
  } else if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        io.disconnect();
        generate();
      }
    }, { threshold: 0.25 });
    io.observe(card);
  } else {
    generate();
  }
})();
