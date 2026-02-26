// =============================================================================
// Rebuilt ARV Training - app.js
// Real estate acquisitions training: ARV & renovation cost estimation
// Uses pre-loaded off-market property data from the Rebuilt marketplace
// =============================================================================

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const DATA_URL = 'properties.json';
  const STATES = ['All States', 'TN', 'GA', 'AL', 'OH'];
  const QUESTION_COUNTS = [5, 10, 15, 20];
  const GRADE_THRESHOLDS = [
    { grade: 'A', max: 5 },
    { grade: 'B', max: 10 },
    { grade: 'C', max: 20 },
    { grade: 'D', max: 35 },
    { grade: 'F', max: Infinity },
  ];
  const HISTORY_KEY = 'rebuilt_arv_training_history';
  const PLACEHOLDER_IMG =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" fill="%23ddd">' +
      '<rect width="400" height="300"/>' +
      '<text x="200" y="155" text-anchor="middle" fill="%23999" font-size="18" ' +
      'font-family="sans-serif">No Photo Available</text></svg>'
    );

  // ---------------------------------------------------------------------------
  // Quiz state
  // ---------------------------------------------------------------------------

  let properties = [];
  let currentIndex = 0;
  let totalQuestions = 10;
  let results = [];
  let runningArvPctSum = 0;
  let runningRenoPctSum = 0;

  // ---------------------------------------------------------------------------
  // Utility helpers
  // ---------------------------------------------------------------------------

  function formatDollars(num) {
    if (num == null || isNaN(num)) return '$0';
    return '$' + Math.round(num).toLocaleString('en-US');
  }

  function parseDollarInput(value) {
    const cleaned = String(value).replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? NaN : num;
  }

  function pctDiff(estimate, actual) {
    if (!actual || actual === 0) return 100;
    return (Math.abs(estimate - actual) / actual) * 100;
  }

  function letterGrade(pctOff) {
    for (const t of GRADE_THRESHOLDS) {
      if (pctOff <= t.max) return t.grade;
    }
    return 'F';
  }

  function gradeToNumber(grade) {
    return { A: 4, B: 3, C: 2, D: 1, F: 0 }[grade] || 0;
  }

  function numberToGrade(num) {
    if (num >= 3.5) return 'A';
    if (num >= 2.5) return 'B';
    if (num >= 1.5) return 'C';
    if (num >= 0.5) return 'D';
    return 'F';
  }

  function weightedGrade(arvGrade, renoGrade) {
    var score = gradeToNumber(arvGrade) * 0.6 + gradeToNumber(renoGrade) * 0.4;
    return numberToGrade(score);
  }

  function shuffleArray(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  function gradeClass(grade) {
    return 'grade-' + grade.toLowerCase();
  }

  /** Tiny DOM helper: el('div', { className: 'foo' }, child1, 'text', child2) */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var val = attrs[key];
        if (key === 'className') {
          node.className = val;
        } else if (key === 'style' && typeof val === 'object') {
          Object.assign(node.style, val);
        } else if (key.indexOf('on') === 0) {
          node.addEventListener(key.slice(2).toLowerCase(), val);
        } else {
          node.setAttribute(key, val);
        }
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child == null) continue;
      if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  function clearApp() {
    var app = document.getElementById('app');
    app.innerHTML = '';
    return app;
  }

  // ---------------------------------------------------------------------------
  // Data loading (static JSON file with pre-fetched off-market inventory)
  // ---------------------------------------------------------------------------

  let _allProperties = null; // cache so we only fetch once

  async function fetchListings(state) {
    if (!_allProperties) {
      var resp = await fetch(DATA_URL);
      if (!resp.ok) {
        throw new Error('Failed to load property data (' + resp.status + ')');
      }
      _allProperties = await resp.json();
    }

    // Filter by state if specified
    if (state && state !== 'All States') {
      return _allProperties.filter(function (p) {
        return p.usState === state;
      });
    }
    return _allProperties.slice();
  }

  // ---------------------------------------------------------------------------
  // localStorage history helpers
  // ---------------------------------------------------------------------------

  function saveSession(session) {
    try {
      var history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      history.unshift(session);
      if (history.length > 50) history.length = 50;
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (_) {
      /* storage full or unavailable */
    }
  }

  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch (_) {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Dollar input: restrict keystrokes, format on blur
  // ---------------------------------------------------------------------------

  function setupDollarInput(input) {
    input.addEventListener('keydown', function (e) {
      var allowed = [
        'Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight',
        'Home', 'End', 'Enter', '.',
      ];
      if (
        allowed.indexOf(e.key) !== -1 ||
        (e.key >= '0' && e.key <= '9') ||
        e.ctrlKey ||
        e.metaKey
      ) {
        return;
      }
      e.preventDefault();
    });

    input.addEventListener('blur', function () {
      var val = parseDollarInput(input.value);
      if (!isNaN(val) && val > 0) {
        input.value = Math.round(val).toLocaleString('en-US');
      }
    });

    input.addEventListener('focus', function () {
      var val = parseDollarInput(input.value);
      input.value = !isNaN(val) && val > 0 ? String(Math.round(val)) : '';
    });
  }

  // ---------------------------------------------------------------------------
  // Screen: Start
  // ---------------------------------------------------------------------------

  function renderStartScreen() {
    var app = clearApp();
    var screen = el('div', { className: 'screen start-screen' });

    screen.appendChild(el('h1', null, 'Rebuilt ARV Training'));
    screen.appendChild(
      el(
        'p',
        { className: 'instructions' },
        'Test your ability to estimate ARV and renovation costs for off-market ' +
          'properties. You will see real listings from the Rebuilt marketplace ' +
          'and be graded on your accuracy.'
      )
    );

    // Question count selector
    var qGroup = el('div', { className: 'input-group' });
    qGroup.appendChild(el('label', { for: 'q-count' }, 'Number of Questions'));
    var qSelect = el('select', { id: 'q-count' });
    QUESTION_COUNTS.forEach(function (n) {
      var opt = el('option', { value: String(n) }, String(n));
      if (n === 10) opt.selected = true;
      qSelect.appendChild(opt);
    });
    qGroup.appendChild(qSelect);
    screen.appendChild(qGroup);

    // State filter selector
    var sGroup = el('div', { className: 'input-group' });
    sGroup.appendChild(el('label', { for: 's-filter' }, 'State Filter'));
    var sSelect = el('select', { id: 's-filter' });
    STATES.forEach(function (s) {
      sSelect.appendChild(el('option', { value: s }, s));
    });
    sGroup.appendChild(sSelect);
    screen.appendChild(sGroup);

    // History link (if sessions exist)
    var history = getHistory();
    if (history.length > 0) {
      screen.appendChild(
        el(
          'button',
          { className: 'btn-secondary', onClick: renderHistoryScreen },
          'View History (' + history.length + ' sessions)'
        )
      );
    }

    // Start button
    screen.appendChild(
      el(
        'button',
        {
          className: 'btn-primary',
          onClick: function () {
            startQuiz(qSelect.value, sSelect.value);
          },
        },
        'Start Quiz'
      )
    );

    app.appendChild(screen);
  }

  // ---------------------------------------------------------------------------
  // Screen: Loading
  // ---------------------------------------------------------------------------

  function renderLoadingScreen() {
    var app = clearApp();
    var screen = el('div', { className: 'screen loading-screen' });
    screen.appendChild(el('div', { className: 'loading-spinner' }));
    screen.appendChild(
      el('p', null, 'Loading property data...')
    );
    app.appendChild(screen);
  }

  // ---------------------------------------------------------------------------
  // Screen: Error
  // ---------------------------------------------------------------------------

  function renderErrorScreen(message) {
    var app = clearApp();
    var screen = el('div', { className: 'screen error-screen' });
    screen.appendChild(el('h2', null, 'Something went wrong'));
    screen.appendChild(el('p', { className: 'error-message' }, message));
    screen.appendChild(
      el(
        'button',
        { className: 'btn-primary', onClick: renderStartScreen },
        'Back to Start'
      )
    );
    app.appendChild(screen);
  }

  // ---------------------------------------------------------------------------
  // Quiz initialisation
  // ---------------------------------------------------------------------------

  async function startQuiz(count, state) {
    totalQuestions = parseInt(count, 10);
    currentIndex = 0;
    results = [];
    runningArvPctSum = 0;
    runningRenoPctSum = 0;

    renderLoadingScreen();

    try {
      var listings = await fetchListings(state);

      if (listings.length < totalQuestions) {
        renderErrorScreen(
          'Only ' +
            listings.length +
            ' properties with valid ARV and renovation data found' +
            (state !== 'All States' ? ' in ' + state : '') +
            '. Try fewer questions or a different state.'
        );
        return;
      }

      properties = shuffleArray(listings).slice(0, totalQuestions);
      renderQuizQuestion();
    } catch (err) {
      renderErrorScreen('Failed to load properties: ' + err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Shared UI fragments
  // ---------------------------------------------------------------------------

  function buildScoreTracker() {
    var answered = results.length;
    var avgArv = answered > 0 ? (runningArvPctSum / answered).toFixed(1) : '\u2014';
    var avgReno =
      answered > 0 ? (runningRenoPctSum / answered).toFixed(1) : '\u2014';

    return el(
      'div',
      { className: 'score-tracker' },
      el('span', null, 'Question ' + (currentIndex + 1) + '/' + totalQuestions),
      el('span', null, 'Avg ARV: ' + avgArv + '% off'),
      el('span', null, 'Avg Reno: ' + avgReno + '% off')
    );
  }

  function buildProgressBar() {
    var pct = (currentIndex / totalQuestions) * 100;
    var bar = el('div', { className: 'progress-bar' });
    bar.appendChild(
      el('div', { className: 'progress-fill', style: { width: pct + '%' } })
    );
    return bar;
  }

  // ---------------------------------------------------------------------------
  // Screen: Quiz Question
  // ---------------------------------------------------------------------------

  function renderQuizQuestion() {
    var app = clearApp();
    var prop = properties[currentIndex];
    var screen = el('div', { className: 'screen quiz-screen' });

    screen.appendChild(buildScoreTracker());
    screen.appendChild(buildProgressBar());

    // Property card
    var card = el('div', { className: 'property-card' });

    var img = el('img', {
      className: 'property-image',
      src: prop.thumbnailUrl || PLACEHOLDER_IMG,
      alt: prop.displayAddress || 'Property photo',
    });
    img.addEventListener('error', function () {
      img.src = PLACEHOLDER_IMG;
    });
    card.appendChild(img);

    card.appendChild(
      el(
        'h2',
        { className: 'property-address' },
        prop.displayAddress || 'Address unavailable'
      )
    );

    // Stats grid
    var stats = el('div', { className: 'property-stats' });
    var statItems = [
      ['Beds', prop.beds],
      ['Baths', prop.baths],
      ['Sqft', prop.livingArea ? prop.livingArea.toLocaleString() : '\u2014'],
      ['Year Built', prop.yearBuilt || '\u2014'],
      ['Type', prop.houseType || '\u2014'],
      ['Lot', prop.lotSize || '\u2014'],
      ['List Price', formatDollars(prop.salePrice)],
    ];
    statItems.forEach(function (pair) {
      stats.appendChild(
        el(
          'div',
          { className: 'stat-item' },
          el('span', { className: 'stat-label' }, pair[0]),
          el('span', { className: 'stat-value' }, String(pair[1]))
        )
      );
    });
    card.appendChild(stats);
    screen.appendChild(card);

    // Estimate inputs
    var form = el('div', { className: 'estimate-form' });

    var arvGroup = el('div', { className: 'input-group' });
    arvGroup.appendChild(
      el('label', { for: 'arv-input' }, 'Your ARV Estimate ($)')
    );
    var arvInput = el('input', {
      type: 'text',
      id: 'arv-input',
      placeholder: 'e.g. 350000',
      inputmode: 'numeric',
      autocomplete: 'off',
    });
    setupDollarInput(arvInput);
    arvGroup.appendChild(arvInput);
    form.appendChild(arvGroup);

    var renoGroup = el('div', { className: 'input-group' });
    renoGroup.appendChild(
      el('label', { for: 'reno-input' }, 'Your Reno Estimate ($)')
    );
    var renoInput = el('input', {
      type: 'text',
      id: 'reno-input',
      placeholder: 'e.g. 45000',
      inputmode: 'numeric',
      autocomplete: 'off',
    });
    setupDollarInput(renoInput);
    renoGroup.appendChild(renoInput);
    form.appendChild(renoGroup);

    var submitBtn = el(
      'button',
      { className: 'btn-primary', onClick: handleSubmit },
      'Submit Estimate'
    );
    form.appendChild(submitBtn);
    screen.appendChild(form);

    app.appendChild(screen);
    arvInput.focus();

    // Enter shortcut
    function onKeyDown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    }
    document.addEventListener('keydown', onKeyDown);

    var submitted = false;

    function handleSubmit() {
      if (submitted) return;

      var userArv = parseDollarInput(arvInput.value);
      var userReno = parseDollarInput(renoInput.value);

      // Validation
      if (isNaN(userArv) || userArv <= 0) {
        arvInput.classList.add('input-error');
        arvInput.focus();
        return;
      }
      if (isNaN(userReno) || userReno <= 0) {
        renoInput.classList.add('input-error');
        renoInput.focus();
        return;
      }

      submitted = true;
      document.removeEventListener('keydown', onKeyDown);

      var arvPct = pctDiff(userArv, prop.estimatedArv);
      var renoPct = pctDiff(userReno, prop.estimatedRenovation);
      var arvGrade = letterGrade(arvPct);
      var renoGrade = letterGrade(renoPct);
      var overall = weightedGrade(arvGrade, renoGrade);

      runningArvPctSum += arvPct;
      runningRenoPctSum += renoPct;

      var result = {
        property: prop,
        userArv: userArv,
        userReno: userReno,
        arvPct: arvPct,
        renoPct: renoPct,
        arvGrade: arvGrade,
        renoGrade: renoGrade,
        overallGrade: overall,
      };
      results.push(result);
      renderResultScreen(result);
    }
  }

  // ---------------------------------------------------------------------------
  // Screen: Result (after each question)
  // ---------------------------------------------------------------------------

  function renderResultScreen(result) {
    var app = clearApp();
    var screen = el('div', { className: 'screen results-screen' });
    var prop = result.property;

    screen.appendChild(buildScoreTracker());
    screen.appendChild(buildProgressBar());

    screen.appendChild(el('h2', null, prop.displayAddress));

    // Overall grade badge
    screen.appendChild(
      el(
        'div',
        { className: 'grade-badge ' + gradeClass(result.overallGrade) + ' overall-grade' },
        result.overallGrade
      )
    );

    // ARV comparison
    screen.appendChild(
      buildComparison(
        'ARV Estimate',
        result.userArv,
        prop.estimatedArv,
        result.arvPct,
        result.arvGrade
      )
    );

    // Reno comparison
    screen.appendChild(
      buildComparison(
        'Renovation Estimate',
        result.userReno,
        prop.estimatedRenovation,
        result.renoPct,
        result.renoGrade
      )
    );

    // Reveal additional info
    var reveal = el('div', { className: 'answer-reveal' });
    reveal.appendChild(
      el('p', null, 'List Price: ' + formatDollars(prop.salePrice))
    );
    if (prop.estimatedMonthlyRent) {
      reveal.appendChild(
        el(
          'p',
          null,
          'Est. Monthly Rent: ' + formatDollars(prop.estimatedMonthlyRent)
        )
      );
    }
    screen.appendChild(reveal);

    // Next / Summary button
    var isLast = currentIndex + 1 >= totalQuestions;
    screen.appendChild(
      el(
        'button',
        {
          className: 'btn-primary',
          onClick: function () {
            if (isLast) {
              renderSummaryScreen();
            } else {
              currentIndex++;
              renderQuizQuestion();
            }
          },
        },
        isLast ? 'View Summary' : 'Next Property'
      )
    );

    app.appendChild(screen);

    // Enter shortcut to advance
    function onKey(e) {
      if (e.key === 'Enter') {
        document.removeEventListener('keydown', onKey);
        if (isLast) {
          renderSummaryScreen();
        } else {
          currentIndex++;
          renderQuizQuestion();
        }
      }
    }
    document.addEventListener('keydown', onKey);
  }

  /** Build a side-by-side comparison block for one metric (ARV or Reno). */
  function buildComparison(label, userVal, actualVal, pctOff, grade) {
    var diff = userVal - actualVal;
    var sign = diff >= 0 ? '+' : '';
    var isGood = pctOff <= 10;

    var comp = el('div', { className: 'result-comparison' });
    comp.appendChild(el('h3', null, label));

    var row = el('div', { className: 'comparison-row' });

    row.appendChild(
      el(
        'div',
        { className: 'comparison-cell' },
        el('span', { className: 'comp-label' }, 'Your Estimate'),
        el('span', { className: 'comp-value' }, formatDollars(userVal))
      )
    );
    row.appendChild(
      el(
        'div',
        { className: 'comparison-cell' },
        el('span', { className: 'comp-label' }, 'Actual'),
        el('span', { className: 'comp-value' }, formatDollars(actualVal))
      )
    );
    row.appendChild(
      el(
        'div',
        { className: 'comparison-cell' },
        el('span', { className: 'comp-label' }, 'Difference'),
        el(
          'span',
          { className: 'comp-value ' + (isGood ? 'text-good' : 'text-bad') },
          sign + formatDollars(Math.abs(diff)) + ' (' + pctOff.toFixed(1) + '%)'
        )
      )
    );
    row.appendChild(
      el(
        'div',
        { className: 'comparison-cell' },
        el('span', { className: 'grade-badge ' + gradeClass(grade) }, grade)
      )
    );

    comp.appendChild(row);
    return comp;
  }

  // ---------------------------------------------------------------------------
  // Screen: Summary (end of quiz)
  // ---------------------------------------------------------------------------

  function renderSummaryScreen() {
    var app = clearApp();
    var screen = el('div', { className: 'screen summary-screen' });

    screen.appendChild(el('h1', null, 'Quiz Complete'));

    var avgArvPct = runningArvPctSum / results.length;
    var avgRenoPct = runningRenoPctSum / results.length;
    var avgArvGrade = letterGrade(avgArvPct);
    var avgRenoGrade = letterGrade(avgRenoPct);
    var overallGrade = weightedGrade(avgArvGrade, avgRenoGrade);

    // Persist session to localStorage
    var dist = gradeDistribution();
    saveSession({
      date: new Date().toISOString(),
      totalQuestions: totalQuestions,
      overallGrade: overallGrade,
      avgArvPct: avgArvPct.toFixed(1),
      avgRenoPct: avgRenoPct.toFixed(1),
      gradeDist: dist,
    });

    // Big overall grade badge
    screen.appendChild(
      el(
        'div',
        { className: 'grade-badge ' + gradeClass(overallGrade) + ' summary-overall' },
        overallGrade
      )
    );
    screen.appendChild(el('p', { className: 'summary-label' }, 'Overall Performance'));

    // Avg accuracy stats
    var statsDiv = el('div', { className: 'summary-stats' });
    statsDiv.appendChild(
      el(
        'div',
        { className: 'stat-item' },
        el('span', { className: 'stat-label' }, 'Avg ARV Accuracy'),
        el(
          'span',
          { className: 'stat-value' },
          avgArvPct.toFixed(1) + '% off (' + avgArvGrade + ')'
        )
      )
    );
    statsDiv.appendChild(
      el(
        'div',
        { className: 'stat-item' },
        el('span', { className: 'stat-label' }, 'Avg Reno Accuracy'),
        el(
          'span',
          { className: 'stat-value' },
          avgRenoPct.toFixed(1) + '% off (' + avgRenoGrade + ')'
        )
      )
    );
    screen.appendChild(statsDiv);

    // Grade distribution chart
    screen.appendChild(el('h3', null, 'Grade Distribution'));
    screen.appendChild(buildGradeDistribution(dist));

    // Property-by-property breakdown table
    screen.appendChild(el('h3', null, 'Property Breakdown'));
    screen.appendChild(buildBreakdownTable());

    // Restart
    screen.appendChild(
      el(
        'button',
        { className: 'btn-primary', onClick: renderStartScreen },
        'Restart Quiz'
      )
    );

    app.appendChild(screen);
  }

  function gradeDistribution() {
    var dist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    results.forEach(function (r) {
      dist[r.overallGrade]++;
    });
    return dist;
  }

  function buildGradeDistribution(dist) {
    var maxCount = Math.max(
      1,
      dist.A,
      dist.B,
      dist.C,
      dist.D,
      dist.F
    );
    var chart = el('div', { className: 'grade-chart' });

    ['A', 'B', 'C', 'D', 'F'].forEach(function (g) {
      var count = dist[g];
      var pct = (count / maxCount) * 100;
      var row = el('div', { className: 'grade-chart-row' });
      row.appendChild(
        el('span', { className: 'grade-badge ' + gradeClass(g) }, g)
      );
      var barOuter = el('div', { className: 'grade-bar-outer' });
      barOuter.appendChild(
        el('div', {
          className: 'grade-bar-fill ' + gradeClass(g) + '-bg',
          style: { width: pct + '%' },
        })
      );
      row.appendChild(barOuter);
      row.appendChild(el('span', { className: 'grade-bar-count' }, String(count)));
      chart.appendChild(row);
    });

    return chart;
  }

  function buildBreakdownTable() {
    var table = el('div', { className: 'breakdown-table' });

    // Header
    var header = el('div', { className: 'breakdown-row breakdown-header' });
    [
      'Property',
      'Your ARV',
      'Actual ARV',
      'ARV',
      'Your Reno',
      'Actual Reno',
      'Reno',
      'Overall',
    ].forEach(function (h) {
      header.appendChild(el('div', { className: 'breakdown-cell' }, h));
    });
    table.appendChild(header);

    // Rows
    results.forEach(function (r) {
      var row = el('div', { className: 'breakdown-row' });
      var addr = r.property.displayAddress || '\u2014';
      var shortAddr = addr.length > 30 ? addr.slice(0, 28) + '...' : addr;

      row.appendChild(
        el('div', { className: 'breakdown-cell breakdown-address' }, shortAddr)
      );
      row.appendChild(
        el('div', { className: 'breakdown-cell' }, formatDollars(r.userArv))
      );
      row.appendChild(
        el(
          'div',
          { className: 'breakdown-cell' },
          formatDollars(r.property.estimatedArv)
        )
      );
      row.appendChild(
        el(
          'div',
          { className: 'breakdown-cell' },
          el(
            'span',
            { className: 'grade-badge ' + gradeClass(r.arvGrade) },
            r.arvGrade
          )
        )
      );
      row.appendChild(
        el('div', { className: 'breakdown-cell' }, formatDollars(r.userReno))
      );
      row.appendChild(
        el(
          'div',
          { className: 'breakdown-cell' },
          formatDollars(r.property.estimatedRenovation)
        )
      );
      row.appendChild(
        el(
          'div',
          { className: 'breakdown-cell' },
          el(
            'span',
            { className: 'grade-badge ' + gradeClass(r.renoGrade) },
            r.renoGrade
          )
        )
      );
      row.appendChild(
        el(
          'div',
          { className: 'breakdown-cell' },
          el(
            'span',
            { className: 'grade-badge ' + gradeClass(r.overallGrade) },
            r.overallGrade
          )
        )
      );
      table.appendChild(row);
    });

    return table;
  }

  // ---------------------------------------------------------------------------
  // Screen: History
  // ---------------------------------------------------------------------------

  function renderHistoryScreen() {
    var app = clearApp();
    var screen = el('div', { className: 'screen history-screen' });
    screen.appendChild(el('h1', null, 'Training History'));

    var history = getHistory();
    if (history.length === 0) {
      screen.appendChild(el('p', null, 'No sessions recorded yet.'));
    } else {
      var table = el('div', { className: 'breakdown-table' });

      var header = el('div', { className: 'breakdown-row breakdown-header' });
      ['Date', 'Questions', 'Overall', 'Avg ARV % Off', 'Avg Reno % Off'].forEach(
        function (h) {
          header.appendChild(el('div', { className: 'breakdown-cell' }, h));
        }
      );
      table.appendChild(header);

      history.forEach(function (s) {
        var row = el('div', { className: 'breakdown-row' });
        var d = new Date(s.date);
        var dateStr =
          d.toLocaleDateString() +
          ' ' +
          d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        row.appendChild(el('div', { className: 'breakdown-cell' }, dateStr));
        row.appendChild(
          el('div', { className: 'breakdown-cell' }, String(s.totalQuestions))
        );
        row.appendChild(
          el(
            'div',
            { className: 'breakdown-cell' },
            el(
              'span',
              { className: 'grade-badge ' + gradeClass(s.overallGrade) },
              s.overallGrade
            )
          )
        );
        row.appendChild(
          el('div', { className: 'breakdown-cell' }, s.avgArvPct + '%')
        );
        row.appendChild(
          el('div', { className: 'breakdown-cell' }, s.avgRenoPct + '%')
        );
        table.appendChild(row);
      });

      screen.appendChild(table);
    }

    screen.appendChild(
      el(
        'button',
        { className: 'btn-secondary', onClick: renderStartScreen },
        'Back to Start'
      )
    );
    app.appendChild(screen);
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', renderStartScreen);
})();
