// =============================================================================
// Rebuilt ARV Training Platform - v3
// Module-based training with sign-in, presentation, progress tracking
// =============================================================================

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  var DATA_URL = 'properties.json';
  var SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxaB0AOvzkIHhqvJK226aFoZsgdCbF4UWDRmBTw2jdtvBoaNi8pewsSCo_xiBfkuzHQ/exec';
  var MODULES_COUNT = 10;
  var QUESTIONS_PER_MODULE = 5;
  var ARV_PASS_THRESHOLD = 10;   // within 10%
  var RENO_PASS_THRESHOLD = 20;  // within 20%

  var STORAGE_EMAIL = 'rebuilt_arv_email';
  var STORAGE_PROGRESS = 'rebuilt_arv_progress';
  var STORAGE_PRES = 'rebuilt_arv_pres_done';
  var STORAGE_PROP_ORDER = 'rebuilt_arv_prop_order';

  var PLACEHOLDER_IMG =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" fill="%23ddd">' +
      '<rect width="400" height="300"/>' +
      '<text x="200" y="155" text-anchor="middle" fill="%23999" font-size="18" ' +
      'font-family="sans-serif">No Photo Available</text></svg>'
    );

  var LEVELS = [
    { name: 'Newbie Investor', emoji: '\uD83D\uDC23' },
    { name: 'Property Peeker', emoji: '\uD83D\uDC40' },
    { name: 'Deal Spotter', emoji: '\uD83D\uDD0D' },
    { name: 'Comp Cruncher', emoji: '\uD83D\uDCCA' },
    { name: 'Flip Apprentice', emoji: '\uD83D\uDD28' },
    { name: 'Reno Rookie', emoji: '\uD83C\uDFD7\uFE0F' },
    { name: 'ARV Analyst', emoji: '\uD83D\uDCC8' },
    { name: 'Deal Maker', emoji: '\uD83E\uDD1D' },
    { name: 'Market Master', emoji: '\uD83C\uDFC6' },
    { name: 'Flip Expert', emoji: '\uD83D\uDC8E' },
    { name: 'ARV Pro', emoji: '\uD83C\uDF93' },
  ];

  var GRADE_THRESHOLDS = [
    { grade: 'A', max: 5 },
    { grade: 'B', max: 10 },
    { grade: 'C', max: 20 },
    { grade: 'D', max: 35 },
    { grade: 'F', max: Infinity },
  ];

  // Modules 0-4: both ARV + Reno are multiple-choice grades
  // Modules 5-9: only Reno is multiple-choice grades, ARV is dollar input
  var MC_ARV_CUTOFF = 5; // first 5 modules use MC for ARV

  // Reno grade ranges (A = Great condition / low cost, F = Worst / high cost)
  var RENO_GRADE_RANGES = [
    { grade: 'A', label: 'Great',     desc: 'Minimal work needed',  min: 0,      max: 25000 },
    { grade: 'B', label: 'Good',      desc: 'Light renovation',     min: 25001,  max: 50000 },
    { grade: 'C', label: 'Average',   desc: 'Moderate renovation',  min: 50001,  max: 75000 },
    { grade: 'D', label: 'Below Avg', desc: 'Heavy renovation',     min: 75001,  max: 100000 },
    { grade: 'F', label: 'Worst',     desc: 'Major gut rehab',      min: 100001, max: Infinity },
  ];

  // ARV choices are generated per-property (not fixed ranges).
  // 5 options spaced ~10% apart; correct answer randomly placed among A–F.
  var ARV_OPTION_MULTIPLIERS = [0.80, 0.90, 1.00, 1.10, 1.20];

  // Map grade-distance (0-4 steps off) to an equivalent "% off" for scoring
  var GRADE_DIFF_TO_PCT = [0, 12, 28, 45, 65];

  // ---------------------------------------------------------------------------
  // Presentation Slides (from ARV Mastery PDF)
  // ---------------------------------------------------------------------------

  var SLIDES = [
    {
      title: 'ARV Mastery',
      subtitle: 'How to Price Like a Pro',
      body: 'Turning valuation guesswork into a defensible science.',
      footer: 'Welcome to the squad \u2014 this training will transform how you think about property value.',
      style: 'title',
    },
    {
      title: 'Get This Number Wrong and You Lose Everything',
      bullets: [
        'The After Repair Value (ARV) is the single most critical number you will calculate.',
        'A wrong ARV means your client overpays, the deal falls apart at appraisal, or the investor loses their margin.',
        'Today\u2019s goal: strip away the guesswork and build a repeatable, defensible valuation process.',
      ],
      quote: 'One wrong number costs your client money and your credibility.',
    },
    {
      title: 'ARV Defined: A Future Number, Not Today\u2019s Price',
      body: 'The ARV is an estimate of a property\u2019s value after it has been fully renovated to meet the highest and best use for the neighborhood.',
      columns: [
        { heading: '\u201CAs-Is\u201D Value', items: ['Current condition', 'Old carpets & dated kitchen', 'Deferred maintenance', 'NOT the ARV'] },
        { heading: 'ARV (Future)', items: ['Post-renovation price tag', 'New flooring & granite', 'Fresh finishes', 'Highest & Best Use'] },
      ],
      footer: 'Insight: What will a fully updated buyer pay?',
    },
    {
      title: 'The Golden Formula',
      body: 'ARV = Avg Price/Sq.Ft. of Comps \u00D7 Subject Property Sq.Ft.',
      subtitle: 'Or more accurately: the median sale price of the most similar, recently renovated homes.',
      columns: [
        { heading: 'The Effort Ratio', items: ['The math takes 30 seconds.', 'The research takes 30 minutes.', 'That\u2019s where you earn your value.'] },
        { heading: 'Garbage In, Garbage Out', items: ['\u201CComps\u201D are the foundation.', 'Weak comps produce an indefensible number.'] },
      ],
    },
    {
      title: 'The 4-3-2-1 Rule',
      subtitle: 'Your Comp Selection Framework',
      grid: [
        { big: '4', label: 'Months', desc: 'Only sales from the last 4 months. Markets shift fast; older data is stale.' },
        { big: '3', label: 'Blocks', desc: 'Same subdivision or \u00BD-mile radius. Do NOT cross major highways.' },
        { big: '20%', label: 'Variance', desc: 'Comps within 20% of subject\u2019s sq. footage. Size drives value.' },
        { big: '1', label: 'Style', desc: 'Match architectural style. Ranch to Ranch, Colonial to Colonial.' },
      ],
      footer: 'Don\u2019t look for the highest sale in the zip code. Conservative comps protect your client\u2019s margins.',
    },
    {
      title: 'Adjustments: No Two Houses Are Identical',
      body: 'When a comp differs from the subject, adjust the comp\u2019s sale price up or down.',
      table: {
        headers: ['Feature', 'Estimated Adjustment'],
        rows: [
          ['Full Bathroom', '$5,000 \u2013 $10,000'],
          ['2-Car Garage', '$10,000 \u2013 $20,000'],
          ['Finished Basement', '$15,000 \u2013 $30,000'],
          ['Lot Size (per 0.25 acre)', '$10,000+'],
        ],
      },
    },
    {
      title: 'Real Example: 123 Maple St.',
      subtitle: '3 Bed / 2 Bath | 1,500 Sq. Ft. | No Garage',
      table: {
        headers: ['Comp', 'Details', 'Sale Price', 'Adj.', 'Adjusted'],
        rows: [
          ['456 Oak St', '3/2 \u00B7 1,550 sqft \u00B7 No Garage', '$300,000', 'None', '$300,000'],
          ['789 Pine Ct', '3/2 \u00B7 1,450 sqft \u00B7 No Garage', '$295,000', 'None', '$295,000'],
          ['101 Elm Ave', '3/2 \u00B7 1,600 sqft \u00B7 Has Garage', '$315,000', '-$15,000', '$300,000'],
        ],
      },
      footer: 'Conservative ARV Range: $298,000 \u2013 $300,000',
    },
    {
      title: 'Three Pitfalls That Will Destroy Your Credibility',
      grid: [
        { big: '01', label: 'The Neighborhood Ceiling', desc: 'Every neighborhood has a price cap. Don\u2019t project $400k if the highest sale ever was $350k.' },
        { big: '02', label: 'External Obsolescence', desc: 'Backing up to a highway or loading dock kills value. It will never match the quiet cul-de-sac comp.' },
        { big: '03', label: 'Active vs. Sold', desc: 'Never base ARV on \u201CActive\u201D listings. They represent what sellers WANT, not what buyers PAID.' },
      ],
    },
    {
      title: 'The Defensible Number',
      subtitle: 'Your Professional Standard',
      quote: 'If an appraiser won\u2019t agree with you in three months, your ARV is wrong.',
      bullets: [
        'Use the Golden Formula',
        'Apply the 4-3-2-1 Rule',
        'Adjust for Differences',
        'Avoid Major Pitfalls',
        'Be Conservative',
      ],
    },
    {
      title: 'You\u2019re Ready \u2014 Now Let\u2019s Practice',
      style: 'title',
      bullets: [
        'Pull comps on your next listing using the 4-3-2-1 Rule.',
        'Use the adjustment table as a field reference.',
        'Request the Property Inspection Checklist for your walkthroughs.',
      ],
      footer: 'Welcome to the squad. Now go find some defensible numbers.',
    },
  ];

  // ---------------------------------------------------------------------------
  // Quiz state
  // ---------------------------------------------------------------------------

  var allProperties = null;
  var moduleProperties = [];
  var currentModuleIndex = 0;
  var currentQuestionIndex = 0;
  var moduleResults = [];
  var runningArvPctSum = 0;
  var runningRenoPctSum = 0;

  // ---------------------------------------------------------------------------
  // Utility helpers
  // ---------------------------------------------------------------------------

  function formatDollars(num) {
    if (num == null || isNaN(num)) return '$0';
    return '$' + Math.round(num).toLocaleString('en-US');
  }

  function parseDollarInput(value) {
    var cleaned = String(value).replace(/[^0-9.]/g, '');
    var num = parseFloat(cleaned);
    return isNaN(num) ? NaN : num;
  }

  function pctDiff(estimate, actual) {
    if (!actual || actual === 0) return 100;
    return (Math.abs(estimate - actual) / actual) * 100;
  }

  function letterGrade(pctOff) {
    for (var i = 0; i < GRADE_THRESHOLDS.length; i++) {
      if (pctOff <= GRADE_THRESHOLDS[i].max) return GRADE_THRESHOLDS[i].grade;
    }
    return 'F';
  }

  function gradeClass(grade) {
    return 'grade-' + grade.toLowerCase();
  }

  // --- Multiple-choice grade helpers ---

  function getCorrectGrade(value, ranges) {
    for (var i = 0; i < ranges.length; i++) {
      if (value >= ranges[i].min && value <= ranges[i].max) return ranges[i].grade;
    }
    return 'F';
  }

  var GRADE_ORDER = ['A', 'B', 'C', 'D', 'F'];

  function gradeIdx(grade) {
    var idx = GRADE_ORDER.indexOf(grade);
    return idx === -1 ? 4 : idx;
  }

  function gradeDiffPct(userGrade, correctGrade) {
    var diff = Math.abs(gradeIdx(userGrade) - gradeIdx(correctGrade));
    return GRADE_DIFF_TO_PCT[Math.min(diff, GRADE_DIFF_TO_PCT.length - 1)];
  }

  function useArvGrades(moduleIdx) { return moduleIdx < MC_ARV_CUTOFF; }
  function useRenoGrades() { return true; }

  // Generate 5 ARV dollar-amount choices for a property.
  // Returns { options: [{grade,value},...], correctGrade: 'B' }
  function generateArvChoices(actualArv) {
    // Build 5 values at ±10% intervals, round to nearest $5k
    var values = ARV_OPTION_MULTIPLIERS.map(function (m) {
      return Math.round((actualArv * m) / 5000) * 5000;
    });
    // De-dup: nudge any collisions by $5k
    for (var i = 1; i < values.length; i++) {
      while (values.slice(0, i).indexOf(values[i]) !== -1) {
        values[i] += 5000;
      }
    }
    // Shuffle so the correct answer (index 2, multiplier 1.00) lands randomly
    var pairs = values.map(function (v, i) { return { value: v, isCorrect: i === 2 }; });
    pairs = shuffleArray(pairs);
    var correctGrade = null;
    var options = pairs.map(function (p, i) {
      var grade = GRADE_ORDER[i];
      if (p.isCorrect) correctGrade = grade;
      return { grade: grade, value: p.value };
    });
    return { options: options, correctGrade: correctGrade };
  }

  // Build a grade selector whose labels are dollar amounts (for ARV choices)
  function buildArvChoiceSelector(choices, onSelect) {
    var group = el('div', { className: 'grade-selector-group' });
    group.appendChild(el('label', null, 'ARV Estimate'));
    var options = el('div', { className: 'grade-options' });
    var selectedBtn = null;

    choices.options.forEach(function (opt) {
      var btn = el('button', {
        type: 'button',
        className: 'grade-option',
        onClick: function () {
          if (selectedBtn) selectedBtn.classList.remove('grade-option-selected');
          btn.classList.add('grade-option-selected');
          selectedBtn = btn;
          onSelect(opt);
        },
      },
        el('span', { className: 'grade-option-letter ' + gradeClass(opt.grade) }, opt.grade),
        el('span', { className: 'grade-option-label' }, formatDollars(opt.value))
      );
      options.appendChild(btn);
    });

    group.appendChild(options);
    return group;
  }

  // Build a row of grade-selection buttons
  function buildGradeSelector(label, ranges, onSelect) {
    var group = el('div', { className: 'grade-selector-group' });
    group.appendChild(el('label', null, label));
    var options = el('div', { className: 'grade-options' });
    var selectedBtn = null;

    ranges.forEach(function (range) {
      var btn = el('button', {
        type: 'button',
        className: 'grade-option',
        onClick: function () {
          if (selectedBtn) selectedBtn.classList.remove('grade-option-selected');
          btn.classList.add('grade-option-selected');
          selectedBtn = btn;
          onSelect(range.grade);
        },
      },
        el('span', { className: 'grade-option-letter ' + gradeClass(range.grade) }, range.grade),
        el('span', { className: 'grade-option-label' }, range.label),
        el('span', { className: 'grade-option-desc' }, range.desc)
      );
      options.appendChild(btn);
    });

    group.appendChild(options);
    return group;
  }

  function shuffleArray(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var val = attrs[key];
        if (key === 'className') node.className = val;
        else if (key === 'style' && typeof val === 'object') Object.assign(node.style, val);
        else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2).toLowerCase(), val);
        else node.setAttribute(key, val);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child == null) continue;
      if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function clearApp() {
    var app = document.getElementById('app');
    app.innerHTML = '';
    return app;
  }

  // Fix S3 URLs with %2F encoded slashes (Firefox compatibility)
  function fixImageUrl(url) {
    if (!url) return url;
    try { return decodeURI(url); } catch (_) { return url; }
  }

  // ---------------------------------------------------------------------------
  // LocalStorage helpers
  // ---------------------------------------------------------------------------

  function getEmail() {
    try { return localStorage.getItem(STORAGE_EMAIL) || ''; } catch (_) { return ''; }
  }

  function setEmail(email) {
    try { localStorage.setItem(STORAGE_EMAIL, email); } catch (_) {}
  }

  function getProgress() {
    try {
      var p = JSON.parse(localStorage.getItem(STORAGE_PROGRESS) || '{}');
      return {
        completedModules: p.completedModules || [],
      };
    } catch (_) {
      return { completedModules: [] };
    }
  }

  function saveProgress(progress) {
    try { localStorage.setItem(STORAGE_PROGRESS, JSON.stringify(progress)); } catch (_) {}
  }

  function isPresentationDone() {
    try { return localStorage.getItem(STORAGE_PRES) === 'true'; } catch (_) { return false; }
  }

  function setPresentationDone() {
    try { localStorage.setItem(STORAGE_PRES, 'true'); } catch (_) {}
  }

  function getPropertyOrder() {
    try {
      var order = JSON.parse(localStorage.getItem(STORAGE_PROP_ORDER) || 'null');
      return order;
    } catch (_) { return null; }
  }

  function savePropertyOrder(order) {
    try { localStorage.setItem(STORAGE_PROP_ORDER, JSON.stringify(order)); } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Header level badge
  // ---------------------------------------------------------------------------

  function updateHeaderLevel() {
    var headerEl = document.getElementById('header-level');
    if (!headerEl) return;
    var progress = getProgress();
    var level = progress.completedModules.length;
    var info = LEVELS[Math.min(level, LEVELS.length - 1)];
    headerEl.innerHTML = '';
    headerEl.className = 'header-level' + (level >= MODULES_COUNT ? ' header-level-complete' : '');

    var levelText = document.createElement('span');
    levelText.textContent = info.emoji + ' ' + info.name;
    headerEl.appendChild(levelText);

    // Only show History/Leaderboard buttons if user is signed in
    if (getEmail()) {
      var histBtn = document.createElement('button');
      histBtn.className = 'header-history-btn';
      histBtn.textContent = '\uD83D\uDCCA History';
      histBtn.addEventListener('click', function () { renderHistory(); });
      headerEl.appendChild(histBtn);

      var lbBtn = document.createElement('button');
      lbBtn.className = 'header-history-btn';
      lbBtn.textContent = '\uD83C\uDFC6 Leaders';
      lbBtn.addEventListener('click', function () { renderLeaderboard(); });
      headerEl.appendChild(lbBtn);
    }
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  async function loadProperties() {
    if (allProperties) return allProperties;
    var resp = await fetch(DATA_URL);
    if (!resp.ok) throw new Error('Failed to load property data (' + resp.status + ')');
    allProperties = await resp.json();
    return allProperties;
  }

  function getModuleProperties(moduleIdx) {
    if (!allProperties) return [];
    var order = getPropertyOrder();
    if (!order || order.length !== allProperties.length) {
      order = shuffleArray(allProperties.map(function (_, i) { return i; }));
      savePropertyOrder(order);
    }
    var start = moduleIdx * QUESTIONS_PER_MODULE;
    var end = start + QUESTIONS_PER_MODULE;
    var indices = order.slice(start, end);
    return indices.map(function (i) { return allProperties[i]; });
  }

  // ---------------------------------------------------------------------------
  // Dollar input: restrict keystrokes, format on blur
  // ---------------------------------------------------------------------------

  function setupDollarInput(input) {
    input.addEventListener('keydown', function (e) {
      var allowed = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', '.'];
      if (allowed.indexOf(e.key) !== -1 || (e.key >= '0' && e.key <= '9') || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
    });
    input.addEventListener('blur', function () {
      var val = parseDollarInput(input.value);
      if (!isNaN(val) && val > 0) input.value = Math.round(val).toLocaleString('en-US');
    });
    input.addEventListener('focus', function () {
      var val = parseDollarInput(input.value);
      input.value = !isNaN(val) && val > 0 ? String(Math.round(val)) : '';
    });
  }

  // ---------------------------------------------------------------------------
  // Google Sheets logging
  // ---------------------------------------------------------------------------

  function logToSheets(moduleIdx, passed, avgArvPct, avgRenoPct, results) {
    if (!SHEETS_URL || SHEETS_URL === 'DEPLOY_URL_PLACEHOLDER') return;
    var grades = results.map(function (r) {
      return {
        arvGrade: r.arvGrade || '',
        renoGrade: r.renoGrade || '',
      };
    });
    var payload = {
      email: getEmail() || '',
      dateTime: new Date().toISOString(),
      module: 'Module ' + (moduleIdx + 1),
      result: passed ? 'Pass' : 'Fail',
      avgArvPct: avgArvPct.toFixed(1),
      avgRenoPct: avgRenoPct.toFixed(1),
      grades: grades,
    };
    try {
      fetch(SHEETS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload),
      });
    } catch (_) { /* silent fail */ }
  }

  function fetchHistory(callback) {
    if (!SHEETS_URL || SHEETS_URL === 'DEPLOY_URL_PLACEHOLDER') {
      callback({ status: 'ok', rows: [] });
      return;
    }
    var cbName = '_sheetsCb' + Date.now();
    var url = SHEETS_URL + '?callback=' + cbName;
    window[cbName] = function (data) {
      delete window[cbName];
      var script = document.getElementById(cbName);
      if (script) script.remove();
      callback(data);
    };
    var script = document.createElement('script');
    script.id = cbName;
    script.src = url;
    script.onerror = function () {
      delete window[cbName];
      script.remove();
      callback({ status: 'error', rows: [] });
    };
    document.head.appendChild(script);
  }

  // ---------------------------------------------------------------------------
  // Screen: Sign In
  // ---------------------------------------------------------------------------

  function renderSignIn() {
    var app = clearApp();
    updateHeaderLevel();
    var screen = el('div', { className: 'screen signin-screen' });

    screen.appendChild(el('div', { className: 'signin-icon' }, '\uD83C\uDFE0'));
    screen.appendChild(el('h1', null, 'ARV Mastery Training'));
    screen.appendChild(el('p', { className: 'signin-subtitle' }, 'Master the art of pricing properties like a pro. Enter your email to get started.'));

    var form = el('div', { className: 'signin-form' });
    var emailInput = el('input', {
      type: 'email',
      id: 'email-input',
      placeholder: 'your.name@rebuilt.com',
      autocomplete: 'email',
      className: 'signin-input',
    });

    var savedEmail = getEmail();
    if (savedEmail) emailInput.value = savedEmail;

    var errorMsg = el('p', { className: 'signin-error', style: { display: 'none' } }, 'Please enter a valid email address.');

    var submitBtn = el('button', {
      className: 'btn-primary btn-large',
      onClick: function () {
        var email = emailInput.value.trim();
        if (!email || email.indexOf('@') === -1 || email.indexOf('.') === -1) {
          errorMsg.style.display = 'block';
          emailInput.classList.add('input-error');
          emailInput.focus();
          return;
        }
        setEmail(email);
        if (isPresentationDone()) {
          renderDashboard();
        } else {
          renderPresentation();
        }
      }
    }, 'Start Training');

    form.appendChild(el('label', { for: 'email-input', className: 'signin-label' }, 'Email Address'));
    form.appendChild(emailInput);
    form.appendChild(errorMsg);
    form.appendChild(submitBtn);
    screen.appendChild(form);

    app.appendChild(screen);
    if (!savedEmail) emailInput.focus();

    function onKey(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitBtn.click();
      }
    }
    emailInput.addEventListener('keydown', onKey);
  }

  // ---------------------------------------------------------------------------
  // Screen: Presentation (10 slides from PDF)
  // ---------------------------------------------------------------------------

  function renderPresentation() {
    var app = clearApp();
    updateHeaderLevel();
    var slideIdx = 0;

    function renderSlide() {
      app.innerHTML = '';
      var slide = SLIDES[slideIdx];
      var screen = el('div', { className: 'screen pres-screen' + (slide.style === 'title' ? ' pres-title-slide' : '') });

      // Progress
      var progress = el('div', { className: 'pres-progress' });
      progress.appendChild(el('span', { className: 'pres-counter' }, 'Slide ' + (slideIdx + 1) + ' of ' + SLIDES.length));
      var bar = el('div', { className: 'pres-bar' });
      bar.appendChild(el('div', { className: 'pres-bar-fill', style: { width: ((slideIdx + 1) / SLIDES.length * 100) + '%' } }));
      progress.appendChild(bar);
      screen.appendChild(progress);

      // Content card
      var card = el('div', { className: 'pres-card' });

      if (slide.title) card.appendChild(el('h1', { className: 'pres-title' }, slide.title));
      if (slide.subtitle) card.appendChild(el('p', { className: 'pres-subtitle' }, slide.subtitle));
      if (slide.body) card.appendChild(el('p', { className: 'pres-body' }, slide.body));
      if (slide.quote) {
        card.appendChild(el('blockquote', { className: 'pres-quote' }, '\u201C' + slide.quote + '\u201D'));
      }

      if (slide.bullets) {
        var ul = el('ul', { className: 'pres-bullets' });
        slide.bullets.forEach(function (b) { ul.appendChild(el('li', null, b)); });
        card.appendChild(ul);
      }

      if (slide.columns) {
        var cols = el('div', { className: 'pres-columns' });
        slide.columns.forEach(function (col) {
          var c = el('div', { className: 'pres-col' });
          c.appendChild(el('h3', null, col.heading));
          var ul = el('ul', null);
          col.items.forEach(function (item) { ul.appendChild(el('li', null, item)); });
          c.appendChild(ul);
          cols.appendChild(c);
        });
        card.appendChild(cols);
      }

      if (slide.grid) {
        var grid = el('div', { className: 'pres-grid' });
        slide.grid.forEach(function (item) {
          var cell = el('div', { className: 'pres-grid-cell' });
          cell.appendChild(el('div', { className: 'pres-grid-big' }, item.big));
          cell.appendChild(el('div', { className: 'pres-grid-label' }, item.label));
          cell.appendChild(el('p', { className: 'pres-grid-desc' }, item.desc));
          grid.appendChild(cell);
        });
        card.appendChild(grid);
      }

      if (slide.table) {
        var tbl = el('div', { className: 'pres-table' });
        var thead = el('div', { className: 'pres-table-row pres-table-header' });
        slide.table.headers.forEach(function (h) {
          thead.appendChild(el('div', { className: 'pres-table-cell' }, h));
        });
        tbl.appendChild(thead);
        slide.table.rows.forEach(function (row) {
          var tr = el('div', { className: 'pres-table-row' });
          row.forEach(function (cell) {
            tr.appendChild(el('div', { className: 'pres-table-cell' }, cell));
          });
          tbl.appendChild(tr);
        });
        card.appendChild(tbl);
      }

      if (slide.footer) {
        card.appendChild(el('p', { className: 'pres-footer' }, slide.footer));
      }

      screen.appendChild(card);

      // Navigation
      var nav = el('div', { className: 'pres-nav' });
      if (slideIdx > 0) {
        nav.appendChild(el('button', {
          className: 'btn-secondary',
          onClick: function () { slideIdx--; renderSlide(); }
        }, '\u2190 Back'));
      } else {
        nav.appendChild(el('span', null));
      }

      var isLast = slideIdx >= SLIDES.length - 1;
      nav.appendChild(el('button', {
        className: 'btn-primary',
        onClick: function () {
          if (isLast) {
            setPresentationDone();
            renderDashboard();
          } else {
            slideIdx++;
            renderSlide();
          }
        }
      }, isLast ? 'Start the Quiz \u2192' : 'Next \u2192'));

      screen.appendChild(nav);
      app.appendChild(screen);
    }

    // Keyboard navigation
    function onKey(e) {
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (slideIdx < SLIDES.length - 1) { slideIdx++; renderSlide(); }
        else { setPresentationDone(); renderDashboard(); document.removeEventListener('keydown', onKey); }
      } else if (e.key === 'ArrowLeft' && slideIdx > 0) {
        slideIdx--; renderSlide();
      }
    }
    document.addEventListener('keydown', onKey);
    renderSlide();
  }

  // ---------------------------------------------------------------------------
  // Screen: Dashboard (Module Select + Progress)
  // ---------------------------------------------------------------------------

  function renderDashboard() {
    var app = clearApp();
    updateHeaderLevel();
    var screen = el('div', { className: 'screen dashboard-screen' });

    var progress = getProgress();
    var completed = progress.completedModules;
    var level = completed.length;
    var info = LEVELS[Math.min(level, LEVELS.length - 1)];

    // Check if all complete
    if (level >= MODULES_COUNT) {
      renderDiploma();
      return;
    }

    // Level banner
    var banner = el('div', { className: 'dash-banner' });
    banner.appendChild(el('div', { className: 'dash-level-emoji' }, info.emoji));
    banner.appendChild(el('h1', { className: 'dash-level-name' }, info.name));
    banner.appendChild(el('p', { className: 'dash-level-sub' }, level + ' of ' + MODULES_COUNT + ' modules completed'));
    screen.appendChild(banner);

    // Global progress bar
    var pbar = el('div', { className: 'dash-progress' });
    for (var p = 0; p < MODULES_COUNT; p++) {
      var seg = el('div', {
        className: 'dash-progress-seg' +
          (completed.indexOf(p) !== -1 ? ' seg-complete' : '') +
          (p === level ? ' seg-current' : ''),
      });
      seg.appendChild(el('span', null, String(p + 1)));
      pbar.appendChild(seg);
    }
    screen.appendChild(pbar);

    // Module grid
    var grid = el('div', { className: 'dash-modules' });
    for (var m = 0; m < MODULES_COUNT; m++) {
      (function (moduleIdx) {
        var isCompleted = completed.indexOf(moduleIdx) !== -1;
        var isUnlocked = moduleIdx === 0 || completed.indexOf(moduleIdx - 1) !== -1;
        var isCurrent = moduleIdx === level;

        var card = el('div', {
          className: 'dash-module-card' +
            (isCompleted ? ' mod-complete' : '') +
            (isCurrent ? ' mod-current' : '') +
            (!isUnlocked && !isCompleted ? ' mod-locked' : ''),
        });

        var icon = isCompleted ? '\u2705' : (isUnlocked ? '\uD83D\uDCCB' : '\uD83D\uDD12');
        card.appendChild(el('div', { className: 'mod-icon' }, icon));
        card.appendChild(el('div', { className: 'mod-number' }, 'Module ' + (moduleIdx + 1)));
        card.appendChild(el('div', { className: 'mod-questions' }, QUESTIONS_PER_MODULE + ' properties'));

        if (isCompleted) {
          card.appendChild(el('div', { className: 'mod-status mod-status-pass' }, '\u2713 Passed'));
        } else if (isCurrent) {
          card.appendChild(el('div', { className: 'mod-status mod-status-ready' }, 'Ready'));
        } else if (!isUnlocked) {
          card.appendChild(el('div', { className: 'mod-status mod-status-locked' }, 'Locked'));
        } else {
          card.appendChild(el('div', { className: 'mod-status mod-status-ready' }, 'Available'));
        }

        if (isUnlocked || isCompleted) {
          card.style.cursor = 'pointer';
          card.addEventListener('click', function () {
            startModule(moduleIdx);
          });
        }

        grid.appendChild(card);
      })(m);
    }
    screen.appendChild(grid);

    // Pass criteria note
    screen.appendChild(el('div', { className: 'dash-criteria' },
      el('p', null, '\uD83C\uDFAF Pass criteria: Average ARV within ' + ARV_PASS_THRESHOLD + '% and Rehab within ' + RENO_PASS_THRESHOLD + '% across all 5 properties in the module.')
    ));

    // View Training button
    var dashActions = el('div', { className: 'dash-actions' });
    dashActions.appendChild(el('button', {
      className: 'btn-secondary btn-small',
      onClick: function () { renderPresentation(); }
    }, '\uD83C\uDF93 View Training Slides'));
    screen.appendChild(dashActions);

    app.appendChild(screen);
  }

  // ---------------------------------------------------------------------------
  // Start a module
  // ---------------------------------------------------------------------------

  async function startModule(moduleIdx) {
    currentModuleIndex = moduleIdx;
    currentQuestionIndex = 0;
    moduleResults = [];
    runningArvPctSum = 0;
    runningRenoPctSum = 0;

    var app = clearApp();
    var loadScreen = el('div', { className: 'screen loading-screen' });
    loadScreen.appendChild(el('div', { className: 'loading-spinner' }));
    loadScreen.appendChild(el('p', null, 'Loading Module ' + (moduleIdx + 1) + '...'));
    app.appendChild(loadScreen);

    try {
      await loadProperties();
      moduleProperties = getModuleProperties(moduleIdx);

      if (moduleProperties.length < QUESTIONS_PER_MODULE) {
        renderError('Not enough properties for this module. Need ' + QUESTIONS_PER_MODULE + ' but only found ' + moduleProperties.length + '.');
        return;
      }

      renderQuizQuestion();
    } catch (err) {
      renderError('Failed to load properties: ' + err.message);
    }
  }

  function renderError(message) {
    var app = clearApp();
    var screen = el('div', { className: 'screen error-screen' });
    screen.appendChild(el('h2', null, 'Something went wrong'));
    screen.appendChild(el('p', { className: 'error-message' }, message));
    screen.appendChild(el('button', { className: 'btn-primary', onClick: renderDashboard }, 'Back to Dashboard'));
    app.appendChild(screen);
  }

  // ---------------------------------------------------------------------------
  // Shared UI: Module score tracker
  // ---------------------------------------------------------------------------

  function buildModuleTracker() {
    var answered = moduleResults.length;
    var avgArv = answered > 0 ? (runningArvPctSum / answered).toFixed(1) : '\u2014';
    var avgReno = answered > 0 ? (runningRenoPctSum / answered).toFixed(1) : '\u2014';

    return el('div', { className: 'score-tracker' },
      el('span', null, 'Module ' + (currentModuleIndex + 1) + ' \u2022 Question ' + (currentQuestionIndex + 1) + '/' + QUESTIONS_PER_MODULE),
      el('span', null, 'Avg ARV: ' + avgArv + '% off'),
      el('span', null, 'Avg Reno: ' + avgReno + '% off')
    );
  }

  function buildModuleProgress() {
    var pct = (currentQuestionIndex / QUESTIONS_PER_MODULE) * 100;
    var bar = el('div', { className: 'progress-bar' });
    bar.appendChild(el('div', { className: 'progress-fill', style: { width: pct + '%' } }));
    return bar;
  }

  // ---------------------------------------------------------------------------
  // Screen: Quiz Question (with carousel + thumbnails)
  // ---------------------------------------------------------------------------

  function renderQuizQuestion() {
    var app = clearApp();
    updateHeaderLevel();
    var prop = moduleProperties[currentQuestionIndex];
    var screen = el('div', { className: 'screen quiz-screen' });

    screen.appendChild(buildModuleTracker());
    screen.appendChild(buildModuleProgress());

    var card = el('div', { className: 'property-card' });

    // --- Photo carousel with thumbnails ---
    var rawImages = (prop.imageUrls && prop.imageUrls.length > 0)
      ? prop.imageUrls
      : [prop.thumbnailUrl || PLACEHOLDER_IMG];
    var images = rawImages.map(fixImageUrl);
    var carouselIdx = 0;

    var carousel = el('div', { className: 'carousel' });
    var carouselImg = el('img', {
      className: 'carousel-image',
      src: images[0] || PLACEHOLDER_IMG,
      alt: prop.displayAddress || 'Property photo',
      referrerpolicy: 'no-referrer',
      crossorigin: 'anonymous',
    });
    carouselImg.addEventListener('error', function () { carouselImg.src = PLACEHOLDER_IMG; });

    var counter = el('span', { className: 'carousel-counter' }, '1 / ' + images.length);
    var thumbsContainer = null;

    function updateCarousel() {
      carouselImg.src = images[carouselIdx] || PLACEHOLDER_IMG;
      counter.textContent = (carouselIdx + 1) + ' / ' + images.length;
      // Update thumbnails
      if (thumbsContainer) {
        var thumbs = thumbsContainer.querySelectorAll('.thumb-img');
        for (var t = 0; t < thumbs.length; t++) {
          thumbs[t].className = 'thumb-img' + (t === carouselIdx ? ' thumb-active' : '');
        }
        // Scroll active thumb into view
        if (thumbs[carouselIdx]) {
          thumbs[carouselIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
      }
    }

    var prevBtn = el('button', {
      type: 'button',
      className: 'carousel-btn carousel-prev',
      onClick: function (e) { e.preventDefault(); e.stopPropagation(); carouselIdx = (carouselIdx - 1 + images.length) % images.length; updateCarousel(); }
    }, '\u2039');

    var nextBtn = el('button', {
      type: 'button',
      className: 'carousel-btn carousel-next',
      onClick: function (e) { e.preventDefault(); e.stopPropagation(); carouselIdx = (carouselIdx + 1) % images.length; updateCarousel(); }
    }, '\u203A');

    var viewport = el('div', { className: 'carousel-viewport' });
    viewport.appendChild(carouselImg);
    if (images.length > 1) {
      viewport.appendChild(prevBtn);
      viewport.appendChild(nextBtn);
      viewport.appendChild(counter);
    }
    carousel.appendChild(viewport);

    // Thumbnail strip
    if (images.length > 1) {
      thumbsContainer = el('div', { className: 'carousel-thumbs' });
      for (var ti = 0; ti < images.length; ti++) {
        (function (idx) {
          var thumb = el('img', {
            className: 'thumb-img' + (idx === 0 ? ' thumb-active' : ''),
            src: images[idx] || PLACEHOLDER_IMG,
            alt: 'Photo ' + (idx + 1),
            referrerpolicy: 'no-referrer',
            crossorigin: 'anonymous',
          });
          thumb.addEventListener('error', function () { thumb.src = PLACEHOLDER_IMG; });
          thumb.addEventListener('click', function () {
            carouselIdx = idx;
            updateCarousel();
          });
          thumbsContainer.appendChild(thumb);
        })(ti);
      }
      carousel.appendChild(thumbsContainer);
    }

    // Touch/swipe
    var touchStartX = 0;
    viewport.addEventListener('touchstart', function (e) { touchStartX = e.touches[0].clientX; }, { passive: true });
    viewport.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 40) {
        carouselIdx = dx < 0 ? (carouselIdx + 1) % images.length : (carouselIdx - 1 + images.length) % images.length;
        updateCarousel();
      }
    }, { passive: true });

    card.appendChild(carousel);

    // Address
    card.appendChild(el('h2', { className: 'property-address' }, prop.displayAddress || 'Address unavailable'));

    // Stats grid (NO list price)
    var stats = el('div', { className: 'property-stats' });
    var lotDisplay = '\u2014';
    if (prop.lotSize) {
      if (prop.lotSize >= 43560) {
        lotDisplay = (prop.lotSize / 43560).toFixed(2) + ' ac';
      } else {
        lotDisplay = Math.round(prop.lotSize).toLocaleString() + ' sqft';
      }
    }
    var statItems = [
      ['Beds', prop.beds || '\u2014'],
      ['Baths', prop.baths || '\u2014'],
      ['Sqft', prop.livingArea ? prop.livingArea.toLocaleString() : '\u2014'],
      ['Year Built', prop.yearBuilt || '\u2014'],
      ['Type', prop.houseType || '\u2014'],
      ['Lot', lotDisplay],
    ];
    statItems.forEach(function (pair) {
      stats.appendChild(el('div', { className: 'stat-item' },
        el('span', { className: 'stat-label' }, pair[0]),
        el('span', { className: 'stat-value' }, String(pair[1]))
      ));
    });
    card.appendChild(stats);

    // Google Maps embed (satellite view)
    var addr = prop.displayAddress || '';
    var mapQuery = encodeURIComponent(addr);
    var mapIframe = el('iframe', {
      className: 'property-map',
      src: 'https://maps.google.com/maps?q=' + mapQuery + '&t=k&z=17&ie=UTF8&output=embed',
      width: '100%',
      height: '200',
      style: { border: 'none', display: 'block' },
      loading: 'lazy',
      referrerpolicy: 'no-referrer-when-downgrade',
      allowfullscreen: '',
    });
    card.appendChild(mapIframe);

    // Research links (Zillow + House Canary + Street View)
    var researchLinks = el('div', { className: 'research-links' });
    researchLinks.appendChild(el('span', { className: 'research-label' }, '\uD83D\uDD0D Research:'));

    // Zillow link — build from address
    var zillowSlug = addr.replace(/[,#]/g, '').replace(/\s+/g, '-');
    var zillowUrl = 'https://www.zillow.com/homes/' + encodeURIComponent(zillowSlug) + '_rb/';
    researchLinks.appendChild(el('a', {
      href: zillowUrl,
      target: '_blank',
      rel: 'noopener noreferrer',
      className: 'research-btn research-zillow',
    }, '\uD83C\uDFE0 Zillow'));

    // House Canary link
    researchLinks.appendChild(el('a', {
      href: 'https://solutions.housecanary.com/pexp/search?',
      target: '_blank',
      rel: 'noopener noreferrer',
      className: 'research-btn research-hc',
    }, '\uD83D\uDCC8 House Canary'));

    // Google Street View link
    var streetViewUrl = 'https://www.google.com/maps/search/' + mapQuery + '/@?layer=c';
    researchLinks.appendChild(el('a', {
      href: streetViewUrl,
      target: '_blank',
      rel: 'noopener noreferrer',
      className: 'research-btn research-sv',
    }, '\uD83D\uDDFA\uFE0F Street View'));

    card.appendChild(researchLinks);
    screen.appendChild(card);

    // --- Estimate inputs (grade selectors and/or dollar inputs) ---
    var form = el('div', { className: 'estimate-form' });
    var arvIsGraded = useArvGrades(currentModuleIndex);
    var renoIsGraded = useRenoGrades(currentModuleIndex);
    var selectedArvChoice = null;   // { grade, value } for MC ARV
    var selectedRenoGrade = null;
    var arvInput = null;
    var renoInput = null;
    var arvChoices = null;

    if (arvIsGraded) {
      arvChoices = generateArvChoices(prop.estimatedArv);
      form.appendChild(buildArvChoiceSelector(arvChoices, function (opt) { selectedArvChoice = opt; }));
    } else {
      var arvGroup = el('div', { className: 'input-group' });
      arvGroup.appendChild(el('label', { for: 'arv-input' }, 'Your ARV Estimate ($)'));
      arvInput = el('input', { type: 'text', id: 'arv-input', placeholder: 'e.g. 350000', inputmode: 'numeric', autocomplete: 'off' });
      setupDollarInput(arvInput);
      arvGroup.appendChild(arvInput);
      form.appendChild(arvGroup);
    }

    if (renoIsGraded) {
      form.appendChild(buildGradeSelector('Renovation Estimate', RENO_GRADE_RANGES, function (g) { selectedRenoGrade = g; }));
    } else {
      var renoGroup = el('div', { className: 'input-group' });
      renoGroup.appendChild(el('label', { for: 'reno-input' }, 'Your Reno Estimate ($)'));
      renoInput = el('input', { type: 'text', id: 'reno-input', placeholder: 'e.g. 45000', inputmode: 'numeric', autocomplete: 'off' });
      setupDollarInput(renoInput);
      renoGroup.appendChild(renoInput);
      form.appendChild(renoGroup);
    }

    var gradeError = el('p', { className: 'grade-select-error', style: { display: 'none' } }, 'Please select a grade for each category.');
    form.appendChild(gradeError);

    var submitBtn = el('button', { className: 'btn-primary', onClick: handleSubmit }, 'Submit Estimate');
    form.appendChild(submitBtn);
    screen.appendChild(form);

    app.appendChild(screen);
    if (arvInput) arvInput.focus();

    function onKeyDown(e) { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }
    document.addEventListener('keydown', onKeyDown);
    var submitted = false;

    function handleSubmit() {
      if (submitted) return;

      var userArv = null, userReno = null;
      var userArvGrade = null, userRenoGrade = null;
      var correctArvGrade = null, correctRenoGrade = null;
      var arvPct, renoPct;

      // --- ARV ---
      if (arvIsGraded) {
        if (!selectedArvChoice) { gradeError.style.display = 'block'; return; }
        userArvGrade = selectedArvChoice.grade;
        userArv = selectedArvChoice.value;
        correctArvGrade = arvChoices.correctGrade;
        arvPct = pctDiff(userArv, prop.estimatedArv);
      } else {
        userArv = parseDollarInput(arvInput.value);
        if (isNaN(userArv) || userArv <= 0) { arvInput.classList.add('input-error'); arvInput.focus(); return; }
        arvPct = pctDiff(userArv, prop.estimatedArv);
      }

      // --- Reno ---
      if (renoIsGraded) {
        if (!selectedRenoGrade) { gradeError.style.display = 'block'; return; }
        userRenoGrade = selectedRenoGrade;
        correctRenoGrade = getCorrectGrade(prop.estimatedRenovation, RENO_GRADE_RANGES);
        renoPct = gradeDiffPct(userRenoGrade, correctRenoGrade);
      } else {
        userReno = parseDollarInput(renoInput.value);
        if (isNaN(userReno) || userReno <= 0) { renoInput.classList.add('input-error'); renoInput.focus(); return; }
        renoPct = pctDiff(userReno, prop.estimatedRenovation);
      }

      submitted = true;
      document.removeEventListener('keydown', onKeyDown);

      var arvGrade = letterGrade(arvPct);
      var renoGrade = letterGrade(renoPct);

      runningArvPctSum += arvPct;
      runningRenoPctSum += renoPct;

      var result = {
        property: prop,
        userArv: userArv,
        userReno: userReno,
        userArvGrade: userArvGrade,
        userRenoGrade: userRenoGrade,
        correctArvGrade: correctArvGrade,
        correctRenoGrade: correctRenoGrade,
        arvPct: arvPct,
        renoPct: renoPct,
        arvGrade: arvGrade,
        renoGrade: renoGrade,
        arvIsGraded: arvIsGraded,
        renoIsGraded: renoIsGraded,
      };
      moduleResults.push(result);
      renderResultScreen(result);
    }
  }

  // ---------------------------------------------------------------------------
  // Screen: Result (per question)
  // ---------------------------------------------------------------------------

  function renderResultScreen(result) {
    var app = clearApp();
    updateHeaderLevel();
    var screen = el('div', { className: 'screen results-screen' });
    var prop = result.property;

    screen.appendChild(buildModuleTracker());
    screen.appendChild(buildModuleProgress());

    screen.appendChild(el('h2', null, prop.displayAddress));

    // ARV comparison — graded ARV uses dollar-value comparison (user picked a dollar amount)
    if (result.arvIsGraded) {
      screen.appendChild(buildComparison('ARV Estimate', result.userArv, prop.estimatedArv, result.arvPct, result.arvGrade));
    } else {
      screen.appendChild(buildComparison('ARV Estimate', result.userArv, prop.estimatedArv, result.arvPct, result.arvGrade));
    }
    // Reno comparison
    if (result.renoIsGraded) {
      screen.appendChild(buildGradeCompResult('Renovation Estimate', result.userRenoGrade, result.correctRenoGrade, prop.estimatedRenovation, result.renoPct, result.renoGrade));
    } else {
      screen.appendChild(buildComparison('Renovation Estimate', result.userReno, prop.estimatedRenovation, result.renoPct, result.renoGrade));
    }

    // Reveal info (no list price on quiz screen, but show it in results)
    var reveal = el('div', { className: 'answer-reveal' });
    reveal.appendChild(el('p', null, 'List Price: ' + formatDollars(prop.salePrice)));
    if (prop.estimatedMonthlyRent) {
      var monthlyRent = prop.estimatedMonthlyRent > 5000 ? Math.round(prop.estimatedMonthlyRent / 12) : prop.estimatedMonthlyRent;
      reveal.appendChild(el('p', null, 'Est. Monthly Rent: ' + formatDollars(monthlyRent)));
    }

    // Pass/fail indicators for this question
    var arvPass = result.arvPct <= ARV_PASS_THRESHOLD;
    var renoPass = result.renoPct <= RENO_PASS_THRESHOLD;
    reveal.appendChild(el('p', { className: arvPass ? 'text-good' : 'text-bad' },
      'ARV: ' + result.arvPct.toFixed(1) + '% off ' + (arvPass ? '\u2713 Within ' + ARV_PASS_THRESHOLD + '%' : '\u2717 Over ' + ARV_PASS_THRESHOLD + '% threshold')));
    reveal.appendChild(el('p', { className: renoPass ? 'text-good' : 'text-bad' },
      'Reno: ' + result.renoPct.toFixed(1) + '% off ' + (renoPass ? '\u2713 Within ' + RENO_PASS_THRESHOLD + '%' : '\u2717 Over ' + RENO_PASS_THRESHOLD + '% threshold')));
    screen.appendChild(reveal);

    var isLast = currentQuestionIndex + 1 >= QUESTIONS_PER_MODULE;
    screen.appendChild(el('button', {
      className: 'btn-primary',
      onClick: function () {
        if (isLast) {
          renderModuleSummary();
        } else {
          currentQuestionIndex++;
          renderQuizQuestion();
        }
      }
    }, isLast ? 'View Module Results' : 'Next Property \u2192'));

    app.appendChild(screen);

    function onKey(e) {
      if (e.key === 'Enter') {
        document.removeEventListener('keydown', onKey);
        if (isLast) renderModuleSummary();
        else { currentQuestionIndex++; renderQuizQuestion(); }
      }
    }
    document.addEventListener('keydown', onKey);
  }

  function buildComparison(label, userVal, actualVal, pctOff, grade) {
    var diff = userVal - actualVal;
    var sign = diff >= 0 ? '+' : '';
    var isGood = pctOff <= 10;

    var comp = el('div', { className: 'result-comparison' });
    comp.appendChild(el('h3', null, label));
    var row = el('div', { className: 'comparison-row' });
    row.appendChild(el('div', { className: 'comparison-cell' },
      el('span', { className: 'comp-label' }, 'Your Estimate'),
      el('span', { className: 'comp-value' }, formatDollars(userVal))
    ));
    row.appendChild(el('div', { className: 'comparison-cell' },
      el('span', { className: 'comp-label' }, 'Actual'),
      el('span', { className: 'comp-value' }, formatDollars(actualVal))
    ));
    row.appendChild(el('div', { className: 'comparison-cell' },
      el('span', { className: 'comp-label' }, 'Difference'),
      el('span', { className: 'comp-value ' + (isGood ? 'text-good' : 'text-bad') },
        sign + formatDollars(Math.abs(diff)) + ' (' + pctOff.toFixed(1) + '%)')
    ));
    row.appendChild(el('div', { className: 'comparison-cell' },
      el('span', { className: 'grade-badge ' + gradeClass(grade) }, grade)
    ));
    comp.appendChild(row);
    return comp;
  }

  function buildGradeCompResult(label, userGrade, correctGrade, actualValue, pctOff, accuracyGrade) {
    var isMatch = userGrade === correctGrade;
    var stepsOff = Math.abs(gradeIdx(userGrade) - gradeIdx(correctGrade));

    var comp = el('div', { className: 'result-comparison' });
    comp.appendChild(el('h3', null, label));
    var row = el('div', { className: 'comparison-row grade-comparison-row' });

    row.appendChild(el('div', { className: 'comparison-cell' },
      el('span', { className: 'comp-label' }, 'Your Grade'),
      el('span', { className: 'grade-badge ' + gradeClass(userGrade) }, userGrade)
    ));
    row.appendChild(el('div', { className: 'comparison-cell' },
      el('span', { className: 'comp-label' }, 'Correct Grade'),
      el('span', { className: 'grade-badge ' + gradeClass(correctGrade) }, correctGrade)
    ));
    row.appendChild(el('div', { className: 'comparison-cell' },
      el('span', { className: 'comp-label' }, 'Actual Value'),
      el('span', { className: 'comp-value' }, formatDollars(actualValue))
    ));
    row.appendChild(el('div', { className: 'comparison-cell' },
      el('span', { className: 'comp-label' }, isMatch ? 'Exact Match!' : stepsOff + ' grade' + (stepsOff > 1 ? 's' : '') + ' off'),
      el('span', { className: 'grade-badge ' + gradeClass(accuracyGrade) }, accuracyGrade)
    ));

    comp.appendChild(row);
    return comp;
  }

  // ---------------------------------------------------------------------------
  // Screen: Module Summary (pass/fail)
  // ---------------------------------------------------------------------------

  function renderModuleSummary() {
    var app = clearApp();
    updateHeaderLevel();
    var screen = el('div', { className: 'screen module-summary-screen' });

    var avgArvPct = runningArvPctSum / moduleResults.length;
    var avgRenoPct = runningRenoPctSum / moduleResults.length;
    var arvPassed = avgArvPct <= ARV_PASS_THRESHOLD;
    var renoPassed = avgRenoPct <= RENO_PASS_THRESHOLD;
    var modulePassed = arvPassed && renoPassed;

    screen.appendChild(el('h1', null, 'Module ' + (currentModuleIndex + 1) + ' Results'));

    // Big pass/fail badge
    var badge = el('div', { className: 'module-badge ' + (modulePassed ? 'badge-pass' : 'badge-fail') },
      modulePassed ? '\u2705' : '\u274C'
    );
    screen.appendChild(badge);
    screen.appendChild(el('h2', { className: 'module-verdict ' + (modulePassed ? 'text-good' : 'text-bad') },
      modulePassed ? 'Module Passed!' : 'Module Failed'
    ));

    // Stats
    var statsDiv = el('div', { className: 'module-stats' });
    statsDiv.appendChild(el('div', { className: 'stat-item' + (arvPassed ? ' stat-pass' : ' stat-fail') },
      el('span', { className: 'stat-label' }, 'Avg ARV Accuracy'),
      el('span', { className: 'stat-value' }, avgArvPct.toFixed(1) + '% off'),
      el('span', { className: 'stat-threshold' }, (arvPassed ? '\u2713' : '\u2717') + ' Need \u2264' + ARV_PASS_THRESHOLD + '%')
    ));
    statsDiv.appendChild(el('div', { className: 'stat-item' + (renoPassed ? ' stat-pass' : ' stat-fail') },
      el('span', { className: 'stat-label' }, 'Avg Reno Accuracy'),
      el('span', { className: 'stat-value' }, avgRenoPct.toFixed(1) + '% off'),
      el('span', { className: 'stat-threshold' }, (renoPassed ? '\u2713' : '\u2717') + ' Need \u2264' + RENO_PASS_THRESHOLD + '%')
    ));
    screen.appendChild(statsDiv);

    // Breakdown table
    screen.appendChild(el('h3', null, 'Property Breakdown'));
    var firstR = moduleResults[0] || {};
    var arvGraded = firstR.arvIsGraded;
    var renoGraded = firstR.renoIsGraded;

    var table = el('div', { className: 'breakdown-table' });
    var header = el('div', { className: 'breakdown-row breakdown-header' });
    var cols = ['Property', 'Your ARV', 'Actual ARV', 'ARV %'];
    cols.push(renoGraded ? 'Your Reno' : 'Your Reno');
    cols.push(renoGraded ? 'Correct' : 'Actual Reno');
    cols.push('Reno %');
    cols.forEach(function (h) {
      header.appendChild(el('div', { className: 'breakdown-cell' }, h));
    });
    table.appendChild(header);

    moduleResults.forEach(function (r) {
      var row = el('div', { className: 'breakdown-row' });
      var addr = r.property.displayAddress || '\u2014';
      var shortAddr = addr.length > 25 ? addr.slice(0, 23) + '...' : addr;
      row.appendChild(el('div', { className: 'breakdown-cell breakdown-address' }, shortAddr));

      // ARV columns — always show dollar values (MC picks a dollar amount too)
      row.appendChild(el('div', { className: 'breakdown-cell' }, formatDollars(r.userArv)));
      row.appendChild(el('div', { className: 'breakdown-cell' }, formatDollars(r.property.estimatedArv)));
      row.appendChild(el('div', { className: 'breakdown-cell ' + (r.arvPct <= ARV_PASS_THRESHOLD ? 'text-good' : 'text-bad') }, r.arvPct.toFixed(1) + '%'));

      // Reno columns
      if (r.renoIsGraded) {
        row.appendChild(el('div', { className: 'breakdown-cell' },
          el('span', { className: 'mini-grade ' + gradeClass(r.userRenoGrade) }, r.userRenoGrade)));
        row.appendChild(el('div', { className: 'breakdown-cell' },
          el('span', { className: 'mini-grade ' + gradeClass(r.correctRenoGrade) }, r.correctRenoGrade)));
      } else {
        row.appendChild(el('div', { className: 'breakdown-cell' }, formatDollars(r.userReno)));
        row.appendChild(el('div', { className: 'breakdown-cell' }, formatDollars(r.property.estimatedRenovation)));
      }
      row.appendChild(el('div', { className: 'breakdown-cell ' + (r.renoPct <= RENO_PASS_THRESHOLD ? 'text-good' : 'text-bad') }, r.renoPct.toFixed(1) + '%'));

      table.appendChild(row);
    });
    screen.appendChild(table);

    // Log to Google Sheets (always, pass or fail)
    logToSheets(currentModuleIndex, modulePassed, avgArvPct, avgRenoPct, moduleResults);

    // Save progress if passed
    if (modulePassed) {
      var progress = getProgress();
      if (progress.completedModules.indexOf(currentModuleIndex) === -1) {
        progress.completedModules.push(currentModuleIndex);
        progress.completedModules.sort(function (a, b) { return a - b; });
        saveProgress(progress);
      }
    }

    // Buttons
    var btnRow = el('div', { className: 'btn-row' });
    if (!modulePassed) {
      btnRow.appendChild(el('button', {
        className: 'btn-primary',
        onClick: function () { startModule(currentModuleIndex); }
      }, '\uD83D\uDD01 Retry Module'));
    }
    btnRow.appendChild(el('button', {
      className: modulePassed ? 'btn-primary' : 'btn-secondary',
      onClick: renderDashboard
    }, modulePassed ? 'Continue \u2192' : 'Back to Dashboard'));
    screen.appendChild(btnRow);

    app.appendChild(screen);
    updateHeaderLevel();
  }

  // ---------------------------------------------------------------------------
  // Screen: Diploma (all modules complete)
  // ---------------------------------------------------------------------------

  function renderDiploma() {
    var app = clearApp();
    updateHeaderLevel();
    var screen = el('div', { className: 'screen diploma-screen' });

    var email = getEmail();
    var name = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, function (l) { return l.toUpperCase(); });

    screen.appendChild(el('div', { className: 'diploma-frame' },
      el('div', { className: 'diploma-inner' },
        el('div', { className: 'diploma-top-accent' }),
        el('p', { className: 'diploma-org' }, 'Rebuilt Realty'),
        el('h1', { className: 'diploma-title' }, 'Certificate of Completion'),
        el('div', { className: 'diploma-divider' }),
        el('p', { className: 'diploma-awarded' }, 'This certifies that'),
        el('h2', { className: 'diploma-name' }, name),
        el('p', { className: 'diploma-achievement' }, 'has successfully completed all ' + MODULES_COUNT + ' modules of the'),
        el('h3', { className: 'diploma-program' }, 'ARV Mastery Training Program'),
        el('p', { className: 'diploma-subtitle' }, 'and is hereby recognized as a'),
        el('div', { className: 'diploma-badge' }, '\uD83C\uDF93'),
        el('h2', { className: 'diploma-level' }, 'Rebuilt Certified ARV Pro'),
        el('div', { className: 'diploma-divider' }),
        el('p', { className: 'diploma-date' }, new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })),
        el('p', { className: 'diploma-email' }, email)
      )
    ));

    screen.appendChild(el('div', { className: 'diploma-cta' },
      el('p', { className: 'diploma-instruction' }, '\uD83D\uDCF8 Screenshot this certificate and post it to the #team-wins Slack channel!'),
      el('p', { className: 'diploma-subtext' }, 'Show the team you\u2019re a certified ARV Pro.')
    ));

    var btnRow = el('div', { className: 'btn-row' });
    btnRow.appendChild(el('button', {
      className: 'btn-secondary',
      onClick: function () {
        // Reset and go back to dashboard
        var progress = getProgress();
        progress.completedModules = [];
        saveProgress(progress);
        try { localStorage.removeItem(STORAGE_PROP_ORDER); } catch (_) {}
        renderDashboard();
      }
    }, '\uD83D\uDD04 Reset & Start Over'));
    screen.appendChild(btnRow);

    app.appendChild(screen);
  }

  // ---------------------------------------------------------------------------
  // Screen: History (Google Sheets logs)
  // ---------------------------------------------------------------------------

  function renderHistory() {
    var app = clearApp();
    updateHeaderLevel();
    var screen = el('div', { className: 'screen history-screen' });

    screen.appendChild(el('h1', null, '\uD83D\uDCCA Attempt History'));
    screen.appendChild(el('p', { className: 'history-subtitle' }, 'All training attempts logged to Google Sheets.'));

    var tableContainer = el('div', { className: 'history-table-container' });
    tableContainer.appendChild(el('div', { className: 'loading-spinner' }));
    tableContainer.appendChild(el('p', { style: { textAlign: 'center', color: '#888' } }, 'Loading history...'));
    screen.appendChild(tableContainer);

    var btnRow = el('div', { className: 'btn-row' });
    btnRow.appendChild(el('button', {
      className: 'btn-secondary',
      onClick: renderDashboard
    }, '\u2190 Back to Dashboard'));
    btnRow.appendChild(el('button', {
      className: 'btn-secondary',
      onClick: renderLeaderboard
    }, '\uD83C\uDFC6 View Leaderboard'));
    screen.appendChild(btnRow);

    app.appendChild(screen);

    // Fetch data
    fetchHistory(function (data) {
      tableContainer.innerHTML = '';
      if (!data || !data.rows || data.rows.length === 0) {
        tableContainer.appendChild(el('div', { className: 'history-empty' },
          el('p', null, '\uD83D\uDCED No attempts logged yet.'),
          el('p', { className: 'history-empty-sub' }, 'Complete a module to see your results here.')
        ));
        return;
      }

      var rows = data.rows;
      // Show most recent first
      rows.reverse();

      var table = el('div', { className: 'history-table' });

      // Header
      var header = el('div', { className: 'history-row history-header' });
      ['Email', 'Date', 'Module', 'Result', 'ARV % Off', 'Reno % Off'].forEach(function (h) {
        header.appendChild(el('div', { className: 'history-cell' }, h));
      });
      table.appendChild(header);

      // Rows
      rows.forEach(function (row) {
        var tr = el('div', { className: 'history-row' + (row.Result === 'Pass' ? ' history-pass' : ' history-fail') });
        var email = row.Email || '';
        var shortEmail = email.length > 20 ? email.slice(0, 18) + '...' : email;
        tr.appendChild(el('div', { className: 'history-cell' }, shortEmail));

        var dt = row.DateTime || '';
        if (dt) {
          try {
            var d = new Date(dt);
            dt = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          } catch (_) {}
        }
        tr.appendChild(el('div', { className: 'history-cell' }, dt));
        tr.appendChild(el('div', { className: 'history-cell' }, row.Module || ''));
        tr.appendChild(el('div', { className: 'history-cell ' + (row.Result === 'Pass' ? 'text-good' : 'text-bad') },
          (row.Result === 'Pass' ? '\u2705 ' : '\u274C ') + (row.Result || '')
        ));
        tr.appendChild(el('div', { className: 'history-cell' }, (row['Avg ARV % Off'] || '') + '%'));
        tr.appendChild(el('div', { className: 'history-cell' }, (row['Avg Reno % Off'] || '') + '%'));
        table.appendChild(tr);
      });

      tableContainer.appendChild(table);
      tableContainer.appendChild(el('p', { className: 'history-count' }, rows.length + ' attempt' + (rows.length !== 1 ? 's' : '') + ' total'));
    });
  }

  // ---------------------------------------------------------------------------
  // Screen: Leaderboard
  // ---------------------------------------------------------------------------

  function renderLeaderboard() {
    var app = clearApp();
    updateHeaderLevel();
    var screen = el('div', { className: 'screen history-screen' });

    screen.appendChild(el('h1', null, '\uD83C\uDFC6 Leaderboard'));
    screen.appendChild(el('p', { className: 'history-subtitle' }, 'Best accuracy with at least 25 properties (5 modules). Sorted by average accuracy.'));

    var tableContainer = el('div', { className: 'history-table-container' });
    tableContainer.appendChild(el('div', { className: 'loading-spinner' }));
    tableContainer.appendChild(el('p', { style: { textAlign: 'center', color: '#888' } }, 'Loading leaderboard...'));
    screen.appendChild(tableContainer);

    var btnRow = el('div', { className: 'btn-row' });
    btnRow.appendChild(el('button', {
      className: 'btn-secondary',
      onClick: renderDashboard
    }, '\u2190 Back to Dashboard'));
    btnRow.appendChild(el('button', {
      className: 'btn-secondary',
      onClick: renderHistory
    }, '\uD83D\uDCCA View History'));
    screen.appendChild(btnRow);

    app.appendChild(screen);

    // Fetch and compute leaderboard
    fetchHistory(function (data) {
      tableContainer.innerHTML = '';
      if (!data || !data.rows || data.rows.length === 0) {
        tableContainer.appendChild(el('div', { className: 'history-empty' },
          el('p', null, '\uD83C\uDFC6 No data yet.'),
          el('p', { className: 'history-empty-sub' }, 'Complete modules to appear on the leaderboard.')
        ));
        return;
      }

      // Aggregate by email
      var userMap = {};
      data.rows.forEach(function (row) {
        var email = (row.Email || '').toLowerCase().trim();
        if (!email) return;
        if (!userMap[email]) {
          userMap[email] = { email: row.Email, attempts: 0, passes: 0, totalArvPct: 0, totalRenoPct: 0, properties: 0 };
        }
        var u = userMap[email];
        u.attempts++;
        u.properties += 5; // 5 properties per module attempt
        if (row.Result === 'Pass') u.passes++;
        var arvPct = parseFloat(row['Avg ARV % Off']);
        var renoPct = parseFloat(row['Avg Reno % Off']);
        if (!isNaN(arvPct)) u.totalArvPct += arvPct;
        if (!isNaN(renoPct)) u.totalRenoPct += renoPct;
      });

      // Convert to array, filter for min 25 properties (5 modules)
      var leaders = [];
      for (var email in userMap) {
        var u = userMap[email];
        if (u.properties >= 25) {
          u.avgArvPct = u.totalArvPct / u.attempts;
          u.avgRenoPct = u.totalRenoPct / u.attempts;
          u.overallPct = (u.avgArvPct + u.avgRenoPct) / 2;
          u.passRate = Math.round((u.passes / u.attempts) * 100);
          leaders.push(u);
        }
      }

      // Sort by overall accuracy ascending (lower % off = better)
      leaders.sort(function (a, b) { return a.overallPct - b.overallPct; });

      if (leaders.length === 0) {
        tableContainer.appendChild(el('div', { className: 'history-empty' },
          el('p', null, '\uD83C\uDFC6 No qualifying entries yet.'),
          el('p', { className: 'history-empty-sub' }, 'Need at least 25 properties (5 module attempts) to qualify.')
        ));
        return;
      }

      var table = el('div', { className: 'history-table' });

      // Header
      var header = el('div', { className: 'history-row history-header leaderboard-header' });
      ['Rank', 'Name', 'Modules', 'Pass Rate', 'Avg ARV %', 'Avg Reno %', 'Overall'].forEach(function (h) {
        header.appendChild(el('div', { className: 'history-cell' }, h));
      });
      table.appendChild(header);

      // Rows
      leaders.forEach(function (u, i) {
        var rank = i + 1;
        var medal = rank === 1 ? '\uD83E\uDD47' : rank === 2 ? '\uD83E\uDD48' : rank === 3 ? '\uD83E\uDD49' : '';
        var tr = el('div', { className: 'history-row leaderboard-row' + (rank <= 3 ? ' leaderboard-top' : '') });
        tr.appendChild(el('div', { className: 'history-cell leaderboard-rank' }, medal + ' ' + rank));
        var name = u.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, function (l) { return l.toUpperCase(); });
        tr.appendChild(el('div', { className: 'history-cell leaderboard-name' }, name));
        tr.appendChild(el('div', { className: 'history-cell' }, u.attempts + ''));
        tr.appendChild(el('div', { className: 'history-cell ' + (u.passRate >= 80 ? 'text-good' : u.passRate >= 50 ? '' : 'text-bad') }, u.passRate + '%'));
        tr.appendChild(el('div', { className: 'history-cell' }, u.avgArvPct.toFixed(1) + '%'));
        tr.appendChild(el('div', { className: 'history-cell' }, u.avgRenoPct.toFixed(1) + '%'));
        tr.appendChild(el('div', { className: 'history-cell leaderboard-overall' }, u.overallPct.toFixed(1) + '%'));
        table.appendChild(tr);
      });

      tableContainer.appendChild(table);
    });
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    var email = getEmail();
    if (!email) {
      renderSignIn();
    } else if (!isPresentationDone()) {
      renderPresentation();
    } else {
      // Pre-load properties
      loadProperties().then(function () {
        var progress = getProgress();
        if (progress.completedModules.length >= MODULES_COUNT) {
          renderDiploma();
        } else {
          renderDashboard();
        }
      }).catch(function () {
        renderDashboard();
      });
    }
  });

})();
