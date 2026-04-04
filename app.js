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

  // Post JSON to Apps Script via hidden form + iframe (avoids 302 redirect POST→GET issue with fetch no-cors)
  function postToAppsScript(payload) {
    if (!SHEETS_URL || SHEETS_URL === 'DEPLOY_URL_PLACEHOLDER') return;
    try {
      var iframeName = '_logframe' + Date.now();
      var iframe = document.createElement('iframe');
      iframe.name = iframeName;
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
      var form = document.createElement('form');
      form.method = 'POST';
      form.action = SHEETS_URL;
      form.target = iframeName;
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'payload';
      input.value = JSON.stringify(payload);
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
      setTimeout(function () { form.remove(); iframe.remove(); }, 15000);
    } catch (_) { /* silent fail */ }
  }

  var MODULES_COUNT = 8;
  var QUESTIONS_PER_MODULE = 5;
  var ARV_PASS_THRESHOLD = 10;   // within 10%
  var RENO_PASS_THRESHOLD = 20;  // within 20%
  var PRACTICE_MODULE_COUNT = 4; // Modules 0-3 are practice, 4-7 are test-out
  var QUESTION_TIME_LIMIT = 600; // 10 minutes per question in seconds
  var SUPABASE_URL = 'https://xpvvgecwajqmveuuhnmc.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwdnZnZWN3YWpxbXZldXVobm1jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDQzODMxOSwiZXhwIjoyMDkwMDE0MzE5fQ.l-xhfzSv45BbZhnVg3VjW3XpG8kIiEm3nnW0tMQrMRw';
  var sbClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

  var STORAGE_EMAIL = 'rebuilt_arv_email';
  var STORAGE_PROGRESS = 'rebuilt_arv_progress';
  var STORAGE_PRES = 'rebuilt_arv_pres_done';
  var STORAGE_PROP_ORDER = 'rebuilt_arv_prop_order';
  var STORAGE_COMP_DONE = 'rebuilt_arv_comp_done';
  var STORAGE_GRADES = 'rebuilt_arv_grades';

  var ADMIN_EMAILS = [
    'al@rebuilt.com',
    'aj.androkites@rebuilt.com',
    'brandon@rebuilt.com',
    'scott@rebuilt.com',
    'mike.spalding@rebuilt.com',
    'james.newgent@rebuilt.com',
  ];

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

  // Practice modules (0-3): both ARV + Reno are multiple-choice grades
  // Test-out modules (4-7): only Reno is multiple-choice grades, ARV is dollar input
  var MC_ARV_CUTOFF = 4; // first 4 modules (practice) use MC for ARV

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
  // Navigation Config
  // ---------------------------------------------------------------------------

  var NAV_CONFIG = [
    { id: 'tech-training', label: 'Tech Training', icon: '\uD83D\uDCBB', disabled: true,
      items: [
        { id: 'hubspot',     label: 'Hubspot',     handler: null },
        { id: 'apv2',        label: 'APv2',         handler: null },
        { id: 'five9',       label: 'Five9',        handler: null },
        { id: 'housecanary', label: 'HouseCanary',  handler: null },
      ]
    },
    { id: 'sales-training', label: 'Sales Training', icon: '\uD83D\uDCBC', disabled: true,
      groups: [
        { label: 'Basic', items: [
          { id: 'sales-level1', label: 'The Foundation', handler: 'bootSalesLevel1' },
        ]},
        { label: 'Intermediate', items: [
          { id: 'sales-level2', label: 'Art of the Offer', handler: 'bootSalesLevel2' },
        ]},
        { label: 'Advanced', items: [
          { id: 'sales-level3', label: 'The Closer', handler: 'bootSalesLevel3' },
        ]},
      ]
    },
    { id: 'pricing', label: 'Pricing', icon: '\uD83D\uDCB0',
      items: [
        { id: 'arv-training',    label: 'ARV Training',    handler: 'bootArvTraining' },
        { id: 'reno-training',   label: 'Reno Training',   handler: null },
        { id: 'investment-math', label: 'Investment Math',  handler: null },
      ]
    },
    { id: 'tools', label: 'Tools', icon: '\uD83D\uDD0D',
      items: [
        { id: 'prospect-lookup', label: 'Prospect Lookup', handler: 'bootProspectLookup' },
      ]
    },
    { id: 'materials', label: 'Materials', icon: '\uD83D\uDCDA', disabled: true,
      items: [
        { id: 'materials-library', label: 'Video Library', handler: 'renderMaterials' },
      ]
    },
    { id: 'performance', label: 'Performance', icon: '\uD83D\uDCCA',
      items: [
        { id: 'acq-performance', label: 'Acq Team Weekly', handler: 'renderPerformance' },
      ]
    }
  ];

  var activeSection = null;

  // ---------------------------------------------------------------------------
  // Sales Course Config
  // ---------------------------------------------------------------------------

  var STORAGE_SALES = 'rebuilt_sales_progress';

  var SALES_COURSE = [
    // ---- LEVEL 1: THE FOUNDATION (Basic) ----
    {
      id: 'sales-level1',
      title: 'Level 1: The Foundation',
      subtitle: 'Master the fundamentals of property acquisition',
      icon: '\uD83C\uDFD7\uFE0F',
      modules: [
        {
          id: '4-pillars',
          title: '4 Pillars Mastery',
          desc: 'Property lookup, prospecting scripts, and the four pillars of acquisition: Condition, Location, Comps, and Motivation.',
          videos: [
            { fileId: '1i2gKYQSB32mwG3qGxTHMysyUQ0wyhoLB', title: 'Property Lookup, Process & Scripts (Part 1)',
              checks: [
                { q: 'When a new lead comes in, what is your very first step?', choices: ['Call the seller immediately', 'Look up the property in APv2 to gather basic info', 'Drive to the property', 'Send a PandaDoc agreement'], answer: 1 },
                { q: 'What tool is primarily used for property lookups in the acquisition process?', choices: ['Zillow', 'Realtor.com', 'APv2 (Property Lookup)', 'Google Maps'], answer: 2 },
                { q: '🎭 Role Play: A seller picks up and says "I\'m not interested." Your best response is:', choices: ['"OK, sorry to bother you" and hang up', '"I understand — I\'m just reaching out because we buy homes in your area. Would it be OK if I asked a couple quick questions?"', '"We\'ll pay cash above market value!"', '"Can I speak to someone else in the household?"'], answer: 1 },
              ]
            },
            { fileId: '1NENvaDHkXZwXeI8OavE7bueHeDtXSH4z', title: 'Property Lookup, Process & Scripts (Part 2)',
              checks: [
                { q: 'What are the 4 Pillars of property acquisition?', choices: ['Price, Location, Size, Age', 'Condition, Location, Comps, Motivation', 'ARV, Reno, Profit, Timeline', 'Bedrooms, Bathrooms, Sqft, Lot'], answer: 1 },
                { q: 'Which pillar helps you determine the renovation cost and ultimately your offer price?', choices: ['Location', 'Comps', 'Condition', 'Motivation'], answer: 2 },
                { q: '🎭 Role Play: You\'re assessing a lead and the seller says "The house is in great shape, just needs paint." What pillar are you gathering info on?', choices: ['Motivation — they want to sell fast', 'Location — neighborhood quality', 'Condition — current state of repairs needed', 'Comps — comparable sale prices'], answer: 2 },
              ]
            },
          ]
        },
        {
          id: 'setting-stage',
          title: 'Setting the Stage Protocol',
          desc: 'Setting up your acquisition dashboard, understanding ready-to-sell time, and protecting your leads.',
          videos: [
            { fileId: '1Eqk7RFjt4wYMtj5gGt4XRzeifon7dCyv', title: 'Acq Assoc Dash, Ready-To-Sell Time & Lead Protection',
              checks: [
                { q: 'What does "ready-to-sell time" measure?', choices: ['Days on MLS', 'Time between a lead entering the system and being seller-ready to transact', 'How fast you can close', 'Average days on market in the area'], answer: 1 },
                { q: 'Why is lead protection important in acquisition?', choices: ['It hides data from competitors', 'It ensures your leads aren\'t reassigned and your pipeline stays intact', 'It encrypts seller info', 'It blocks other agents from calling'], answer: 1 },
                { q: '🎭 Role Play: A colleague asks you to hand over one of your warm leads because they "have more experience." What do you do?', choices: ['Give them the lead — they know better', 'Politely decline and explain lead protection protocols exist for a reason', 'Ignore them', 'Escalate immediately to management'], answer: 1 },
              ]
            },
          ]
        },
        {
          id: 'condition-discovery',
          title: 'Condition Discovery',
          desc: 'HubSpot appointment scheduling, prospect calling techniques, and discovering property condition through conversation.',
          videos: [
            { fileId: '1lH3NJtw3xRA9S3ZZWEiQRptpG7qY8eLz', title: 'HS Training + Appointment Scheduled',
              checks: [
                { q: 'What does the HubSpot "Appointment Scheduled" status indicate?', choices: ['The seller accepted an offer', 'A meeting has been set to discuss the property further', 'The inspection is scheduled', 'The closing date is set'], answer: 1 },
                { q: 'What is the primary goal of the initial prospect call?', choices: ['Make an offer immediately', 'Schedule an appointment and gather basic property/motivation info', 'Negotiate the lowest price possible', 'Get the seller to sign a contract'], answer: 1 },
              ]
            },
            { fileId: '1vVqWTzxVlsDShRA92Gq1Vz82rOpRNeQe', title: 'Prospect Calling Debrief',
              checks: [
                { q: 'During condition discovery, what should you establish FIRST with a seller?', choices: ['Their asking price', 'Their timeline and motivation for selling', 'The property square footage', 'Whether they have a mortgage'], answer: 1 },
                { q: '🎭 Role Play: A seller says "I don\'t really need to sell, I\'m just curious what it\'s worth." Best response:', choices: ['"OK, let me send you a Zestimate"', '"No problem — a lot of homeowners like to know their options. What would make it worth considering an offer?"', '"We only work with serious sellers, sorry"', '"I\'ll call back when you\'re ready"'], answer: 1 },
                { q: 'Why is documenting property condition important during discovery?', choices: ['It helps determine renovation cost which affects your offer price', 'It\'s required by law', 'It replaces the need for an inspection', 'It\'s only needed for FHA loans'], answer: 0 },
              ]
            },
          ]
        }
      ],
      quiz: [
        { q: 'What are the "4 Pillars" of property acquisition?', choices: ['Price, Location, Size, Age', 'Condition, Location, Comps, Motivation', 'ARV, Reno, Profit, Timeline', 'Bedrooms, Bathrooms, Sqft, Lot Size'], answer: 1 },
        { q: 'What does "ready-to-sell time" measure?', choices: ['How long a property has been listed on MLS', 'The time between a lead entering the system and being seller-ready', 'How quickly you can close a deal', 'The average days on market in an area'], answer: 1 },
        { q: 'When looking up a property, what tool is primarily used for prospect research?', choices: ['Zillow', 'APv2 (Property Lookup)', 'Google Maps', 'Realtor.com'], answer: 1 },
        { q: 'What is the purpose of "lead protection" in the acquisition process?', choices: ['Hiding lead data from competitors', 'Ensuring your leads are not reassigned and your pipeline stays intact', 'Encrypting seller information', 'Blocking other agents from calling your leads'], answer: 1 },
        { q: 'During condition discovery, what is the FIRST thing you should establish with a seller?', choices: ['The asking price', 'Their timeline and motivation for selling', 'The property square footage', 'Whether they have a mortgage'], answer: 1 },
        { q: 'What is the primary goal of the initial prospect call?', choices: ['To make an offer immediately', 'To schedule an appointment and gather basic property/motivation info', 'To negotiate the lowest price', 'To get the seller to sign a contract'], answer: 1 },
        { q: 'Which of these is NOT one of the 4 Pillars?', choices: ['Condition', 'Location', 'Profit Margin', 'Motivation'], answer: 2 },
        { q: 'In the prospecting script, how should you introduce yourself to a seller?', choices: ['As a real estate agent', 'As a representative from the firm looking to buy properties in their area', 'As a home inspector', 'As a mortgage broker'], answer: 1 },
        { q: 'What does the HubSpot "appointment scheduled" status indicate?', choices: ['The seller has accepted an offer', 'A meeting has been set to discuss the property further', 'The property inspection is scheduled', 'The closing date is set'], answer: 1 },
        { q: 'Why is documenting property condition important during discovery?', choices: ['It helps determine renovation cost which affects your offer price', 'It is required by law', 'It replaces the need for an inspection', 'It is only needed for FHA loans'], answer: 0 },
      ]
    },
    // ---- LEVEL 2: THE ART OF THE OFFER (Intermediate) ----
    {
      id: 'sales-level2',
      title: 'Level 2: The Art of the Offer',
      subtitle: 'Master pricing psychology and negotiation tactics',
      icon: '\uD83C\uDFAF',
      modules: [
        {
          id: '60-second-silence',
          title: 'The 60-Second Silence',
          desc: 'Anchoring strategy, using 65-70% of MAO to set expectations, and the power of silence after presenting a number.',
          videos: [
            { fileId: '1swinFDQiiA6n7WTQsTdQ1daJcjRNQvAU', title: 'Deep Dive: Negotiation',
              checks: [
                { q: 'When anchoring a seller, what percentage of MAO should you use as your opening question?', choices: ['90-95%', '80-85%', '65-70%', '50-55%'], answer: 2 },
                { q: 'After presenting your number to the seller, you should:', choices: ['Immediately explain why it\'s fair', 'Stay silent and let the seller respond first', 'Offer to go higher if they seem upset', 'Change the subject to repairs'], answer: 1 },
                { q: '🎭 Role Play: You tell the seller "Based on our analysis, we\'re looking at around $147,000." They go quiet. What do you do?', choices: ['Say "Hello? Are you still there?"', 'Immediately offer more: "But we might be able to go higher"', 'Stay silent — let them process and respond first (the 60-second silence)', 'Explain all the repairs to justify the low number'], answer: 2 },
              ]
            },
          ]
        },
        {
          id: 'odd-number-pricing',
          title: 'Odd Number Pricing',
          desc: 'Understanding the comp plan, snap comp quizzes, and using precise odd numbers to convey research-backed offers.',
          videos: [
            { fileId: '1xu-o6sH1LjlB4hiqCHAXcUt_aebHFXaj', title: 'Comp Plan Overview',
              checks: [
                { q: 'Why use odd numbers (e.g., $147,300) instead of round numbers in offers?', choices: ['It\'s required by the firm', 'Odd numbers signal thorough research and analysis, making the offer feel precise', 'Round numbers are bad luck', 'It confuses the seller into accepting'], answer: 1 },
                { q: 'What does the comp plan help determine?', choices: ['The seller\'s mortgage balance', 'The property\'s fair market value based on comparable sales', 'The inspection timeline', 'The commission structure'], answer: 1 },
              ]
            },
            { fileId: '18RZ-u3iScQcdkaaKjtOoVskiNiv9aj8Y', title: 'Snap Comp Quiz',
              checks: [
                { q: 'What is the purpose of snap comp quizzes?', choices: ['To test typing speed', 'To rapidly assess comparable values and sharpen your pricing instincts', 'To memorize addresses', 'To practice using calculators'], answer: 1 },
                { q: '🎭 Role Play: You need to price a 3bed/2bath 1,400 sqft ranch. Comps show $130/sqft for similar renovated homes. Your best quick estimate is:', choices: ['$200,000 (round number sounds professional)', '$182,000 (1,400 × $130)', '$150,000 (lowball to leave room)', '$182,700 (precise odd number based on analysis)'], answer: 3 },
              ]
            },
          ]
        },
        {
          id: 'conditional-flexibility',
          title: 'Conditional Flexibility',
          desc: 'The give-to-get approach: using repair estimates, timelines, and seller concessions as negotiation levers.',
          videos: [
            { fileId: '13wls_1lu9ZgTwv7jKaMPcPzc0IZGdJH1', title: 'Comp Practice & Q&A',
              checks: [
                { q: 'What is the "give-to-get" strategy in conditional flexibility?', choices: ['Giving the seller a gift card', 'Offering concessions on timeline or terms in exchange for a lower price', 'Giving the property back for a refund', 'Lowering your commission'], answer: 1 },
                { q: '🎭 Role Play: A seller says "I need at least $180,000." Your offer is $165,000. Using conditional flexibility, your best response is:', choices: ['"Sorry, that\'s our final number"', '"OK, $180,000 it is"', '"If we could close in 10 days and cover all closing costs, would $170,000 work for you?"', '"Let me talk to my manager about that"'], answer: 2 },
                { q: 'How do repair estimates serve as negotiation levers?', choices: ['They are irrelevant to price', 'Positives support higher offers from the firm; negatives help manage seller expectations on price', 'They only matter for insurance', 'They replace the need for an appraisal'], answer: 1 },
              ]
            },
          ]
        }
      ],
      quiz: [
        { q: 'What is the "60-Second Silence" technique?', choices: ['Waiting 60 seconds before answering the phone', 'Staying silent after presenting your offer to let the seller process and respond first', 'A meditation exercise before calls', 'Pausing for 60 seconds during property inspection'], answer: 1 },
        { q: 'When anchoring a seller, what percentage of MAO should you use as your opening question?', choices: ['90-95%', '80-85%', '65-70%', '50-55%'], answer: 2 },
        { q: 'Why use odd numbers (e.g., $147,300) instead of round numbers in an offer?', choices: ['It is required by the firm', 'Odd numbers signal thorough research and analysis, making the offer feel precise', 'Round numbers are considered bad luck', 'It confuses the seller into accepting'], answer: 1 },
        { q: 'What is the "give-to-get" strategy in conditional flexibility?', choices: ['Giving the seller a gift card to get the deal', 'Offering concessions on timeline or terms in exchange for a lower price', 'Giving the property back to get a refund', 'Lowering your commission to get the listing'], answer: 1 },
        { q: 'In the anchoring strategy, who should "bad news" about property value come from?', choices: ['The sales representative directly', 'The firm / underwriting department', 'The seller\'s neighbors', 'A third-party appraiser'], answer: 1 },
        { q: 'What is the purpose of the snap comp quiz?', choices: ['To test your typing speed', 'To rapidly assess comparable property values and sharpen pricing instincts', 'To memorize property addresses', 'To practice using calculators'], answer: 1 },
        { q: 'When a seller says your offer is too low, you should:', choices: ['Immediately raise your offer', 'Express empathy, remind them you are advocating for them, and explain the firm controls the funds', 'Hang up the phone', 'Tell them to list with an agent'], answer: 1 },
        { q: 'What does MAO stand for?', choices: ['Market Average Offer', 'Maximum Allowable Offer', 'Minimum Acquisition Objective', 'Multiple Asset Optimization'], answer: 1 },
        { q: 'When should you send a PandaDoc agreement to a seller?', choices: ['Only after they verbally accept', 'Every day you interact with a seller, regardless of where you are in negotiation', 'Only on weekends', 'After the inspection is complete'], answer: 1 },
        { q: 'How do repair estimates help in negotiation?', choices: ['They are irrelevant to price', 'Positives argue for higher offers from the firm; negatives are attributed to the firm to manage seller expectations', 'They only matter for insurance purposes', 'They replace the need for an appraisal'], answer: 1 },
      ]
    },
    // ---- LEVEL 3: THE CLOSER (Advanced) ----
    {
      id: 'sales-level3',
      title: 'Level 3: The Closer',
      subtitle: 'Master objection handling, value reframing, and retrade setup',
      icon: '\uD83D\uDC51',
      modules: [
        {
          id: '7-step-objection',
          title: '7-Step Objection Sequence',
          desc: 'Role play practice for handling the most common seller objections with a structured 7-step sequence.',
          videos: [
            { fileId: '1NteJkJwLh0w5eE34JbhCyZFXzIexg5Tz', title: 'Role Plays: Sales Script (Session 1)',
              checks: [
                { q: 'What is the first step in the 7-Step Objection Sequence?', choices: ['Counter with a higher offer', 'Acknowledge the objection and empathize with the seller', 'Ask to speak with their spouse', 'Offer to pay closing costs'], answer: 1 },
                { q: '🎭 Role Play: Seller says "I need to think about it." Your best response:', choices: ['"OK, take your time" and hang up', '"I completely understand. Just so I can help — what specifically would you want to think through?"', '"The offer expires at midnight tonight"', '"Let me raise the price by $5,000"'], answer: 1 },
              ]
            },
            { fileId: '1nyx2v3R4wzkFTwWo7PqQDJ0hjGd_7z8B', title: 'Role Plays: Sales Script (Session 2)',
              checks: [
                { q: 'When a seller shows even a small amount of flexibility during negotiation, you should:', choices: ['Accept their terms immediately', 'Continue negotiating — small flexibility often leads to larger concessions', 'Walk away since they\'re difficult', 'Report them to your manager'], answer: 1 },
                { q: '🎭 Role Play: Seller says "Another buyer offered me $200,000." The best response is:', choices: ['"We\'ll match that offer"', '"That buyer is probably lying"', '"I hear you. Can I ask — did they give you a firm written offer? Because we can close in 14 days with no contingencies, which a lot of sellers find is worth more than a higher number that may fall through."', '"OK, good luck with them"'], answer: 2 },
                { q: 'In a competitive bid situation, what advantages should you emphasize beyond price?', choices: ['Your personal charm', 'Certainty of close, speed, and flexibility', 'That the other buyer is untrustworthy', 'That you\'ll waive the inspection entirely'], answer: 1 },
              ]
            },
          ]
        },
        {
          id: 'reframing-value',
          title: 'Reframing Value',
          desc: 'Guided call reviews and calling debriefs: learn to reframe your offer as the best solution for the seller\'s situation.',
          videos: [
            { fileId: '1dVhpNO-mCjt_mc3xM6fDVNElCBrXMZGV', title: 'Guided Call Review',
              checks: [
                { q: 'What is the main purpose of a guided call review?', choices: ['To criticize the caller', 'To identify specific moments where different tactics could have improved the outcome', 'To listen to recordings for fun', 'To check scripts were read word-for-word'], answer: 1 },
                { q: 'When reviewing a call, what should you focus on?', choices: ['How fast the rep talked', 'Key decision points where the seller\'s response could have been guided differently', 'Whether the rep used the exact script', 'How many times the rep said "um"'], answer: 1 },
              ]
            },
            { fileId: '1IPtzdTMu546zhoTSRcFusAiAaQy_CY0b', title: 'Calling Debrief (Session 1)',
              checks: [
                { q: '"Reframing value" in acquisition means:', choices: ['Changing the picture frames in the house', 'Repositioning your offer to highlight how it solves the seller\'s specific problem', 'Adjusting the ARV calculation', 'Refinancing the property'], answer: 1 },
                { q: '🎭 Role Play: Seller says "My neighbor sold for $50,000 more than your offer." Best reframe:', choices: ['"Your house isn\'t as nice as your neighbor\'s"', '"That\'s a great data point. Was their home fully updated? Our offer reflects the current condition and saves you the $30K+ in repairs, 6 months of holding costs, and the hassle of contractors."', '"OK, we\'ll match that price"', '"The market has dropped since then"'], answer: 1 },
              ]
            },
          ]
        },
        {
          id: 'retrade-setup',
          title: 'Retrade Setup',
          desc: 'Contract-to-close overview, handling competitive bids, and setting up retrades using underwriting as leverage.',
          videos: [
            { fileId: '1wsOpZGuwhRP6ypOD60KKYknyxyx0I3rZ', title: 'C2C (Contract-to-Close) Overview',
              checks: [
                { q: 'What does C2C stand for in the acquisition process?', choices: ['Cost to Customer', 'Contract-to-Close: the process from signed agreement to finalizing the deal', 'Cash to Cash flow', 'Comp to Comp analysis'], answer: 1 },
                { q: 'In a retrade, the price reduction should be positioned as coming from:', choices: ['Your personal decision', 'The underwriting/inspection findings from the firm', 'A competing buyer', 'The city building department'], answer: 1 },
              ]
            },
            { fileId: '1egkKivRW6dYupi0eXZSfoGpKHOUMgRE7', title: 'Calling Debrief (Session 2)',
              checks: [
                { q: 'What is the "hero" strategy in negotiation?', choices: ['Pretending to be a superhero', 'Anchoring low, then coming back as if you fought for a higher price, making the seller feel you advocated for them', 'Always offering the highest price', 'Saving the deal at the last minute'], answer: 1 },
                { q: '🎭 Role Play: Inspection reveals a cracked foundation ($25K repair). The seller\'s contract price is $175K. How do you position the retrade?', choices: ['"We\'re dropping the price to $150K, take it or leave it"', '"The inspection found a foundation issue. I went to bat for you with underwriting, and the best I could get them to approve is $158,000. I know it\'s not what we hoped, but this still gets you a clean close in two weeks."', '"We\'re canceling the deal"', '"Can you fix the foundation before we close?"'], answer: 1 },
                { q: 'When should you walk away from a negotiation?', choices: ['Never — always close the deal', 'When the seller draws a hard line and shows zero flexibility on price', 'After the first objection', 'Only if your manager tells you to'], answer: 1 },
              ]
            },
          ]
        }
      ],
      quiz: [
        { q: 'What is the first step in the 7-Step Objection Sequence?', choices: ['Counter with a higher offer', 'Acknowledge the objection and empathize with the seller', 'Ask to speak with their spouse', 'Offer to pay closing costs'], answer: 1 },
        { q: 'When a seller says "I need to think about it," you should:', choices: ['Say "OK" and call back next week', 'Agree, then ask what specifically they need to think about to uncover the real objection', 'Increase your offer by 10%', 'Tell them the offer expires today'], answer: 1 },
        { q: 'What does "reframing value" mean in acquisition?', choices: ['Changing the picture frames in the house', 'Repositioning your offer to highlight how it solves the seller\'s specific problem or need', 'Adjusting the ARV calculation', 'Refinancing the property'], answer: 1 },
        { q: 'In a retrade, the representative should position the price reduction as coming from:', choices: ['Their personal decision', 'The underwriting/inspection findings from the firm', 'A competing buyer', 'The city building department'], answer: 1 },
        { q: 'What is the "hero" strategy in negotiation?', choices: ['Pretending to be a superhero', 'Anchoring low, then coming back as if you fought for a slightly higher price, making the seller feel you advocated for them', 'Always offering the highest price', 'Saving the deal at the last minute'], answer: 1 },
        { q: 'When should you walk away from a negotiation?', choices: ['Never - always close the deal', 'When the seller draws a hard line and shows zero flexibility on price', 'After the first objection', 'Only if your manager tells you to'], answer: 1 },
        { q: 'What is C2C in the acquisition process?', choices: ['Cost to Customer', 'Contract-to-Close: the process from signed agreement to finalizing the deal', 'Cash to Cash flow', 'Comp to Comp analysis'], answer: 1 },
        { q: 'During a guided call review, the main purpose is to:', choices: ['Criticize the caller\'s performance', 'Identify specific moments where different tactics could have improved the outcome', 'Just listen to recordings for fun', 'Check that scripts were read word-for-word'], answer: 1 },
        { q: 'How do you handle a competitive bid situation?', choices: ['Always match the other offer', 'Emphasize certainty of close, speed, and flexibility as advantages over price alone', 'Tell the seller the other buyer is lying', 'Walk away immediately'], answer: 1 },
        { q: 'If a seller shows ANY flexibility during negotiation, even a small concession, you should:', choices: ['Accept their terms immediately', 'Continue negotiating - small flexibility often leads to larger concessions', 'Walk away since they are difficult', 'Report them to your manager'], answer: 1 },
      ]
    }
  ];

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
  // Comp Analysis Data
  // ---------------------------------------------------------------------------

  var COMP_ISSUES = [
    { id: 'wrong_type',      label: 'Wrong property type (e.g. ranch vs mobile home)' },
    { id: 'size_diff',       label: 'Too different in size (>20% sq ft variance)' },
    { id: 'too_far',         label: 'Too far away (>1/2 mile or different neighborhood)' },
    { id: 'sale_too_old',    label: 'Sale too old (>4 months ago)' },
    { id: 'diff_style',      label: 'Different style or construction' },
    { id: 'active_listing',  label: 'Active listing, not a sold comp' },
    { id: 'ext_obsolescence', label: 'External obsolescence (highway, commercial, etc.)' },
    { id: 'lot_size_diff',   label: 'Significantly different lot size' },
  ];

  var COMP_PASS_THRESHOLD = 80;
  var COMP_SCENARIOS_REQUIRED = 5;

  var COMP_SCENARIOS = [
    // Scenario 1: Brick Ranch — tests wrong type, old sale, active listing
    {
      subject: {
        address: '412 Oak Ridge Dr, Memphis, TN 38109',
        beds: 3, baths: 2, sqft: 1400, yearBuilt: 1985,
        houseType: 'Brick Ranch', hasGarage: true, hasBasement: false, lotSqft: 8500,
      },
      comps: [
        {
          address: '438 Oak Ridge Dr, Memphis, TN',
          beds: 3, baths: 2, sqft: 1350, yearBuilt: 1987,
          houseType: 'Brick Ranch', hasGarage: true, hasBasement: false, lotSqft: 8200,
          soldPrice: 185000, soldDate: '2025-12-15', distance: 0.2, issues: [],
        },
        {
          address: '1901 Highway 51 S, Memphis, TN',
          beds: 3, baths: 1, sqft: 1100, yearBuilt: 1972,
          houseType: 'Mobile Home', hasGarage: false, hasBasement: false, lotSqft: 43560,
          soldPrice: 68000, soldDate: '2025-11-20', distance: 0.4, issues: ['wrong_type', 'lot_size_diff'],
        },
        {
          address: '505 Oak Ridge Dr, Memphis, TN',
          beds: 3, baths: 2, sqft: 1500, yearBuilt: 1983,
          houseType: 'Brick Ranch', hasGarage: true, hasBasement: false, lotSqft: 9000,
          soldPrice: 192000, soldDate: '2025-04-10', distance: 0.3, issues: ['sale_too_old'],
        },
        {
          address: '220 Maple Ln, Memphis, TN',
          beds: 3, baths: 2, sqft: 1450, yearBuilt: 1990,
          houseType: 'Brick Ranch', hasGarage: true, hasBasement: false, lotSqft: 8800,
          soldPrice: 195000, status: 'Active', distance: 0.3, issues: ['active_listing'],
        },
        {
          address: '425 Oak Ridge Dr, Memphis, TN',
          beds: 3, baths: 2, sqft: 1380, yearBuilt: 1986,
          houseType: 'Brick Ranch', hasGarage: true, hasBasement: false, lotSqft: 8400,
          soldPrice: 182000, soldDate: '2025-10-28', distance: 0.1, issues: [],
        },
      ],
    },
    // Scenario 2: Townhouse — tests wrong type, size diff, ext obsolescence
    {
      subject: {
        address: '88 Birch Creek Way, Charlotte, NC 28205',
        beds: 2, baths: 2.5, sqft: 1200, yearBuilt: 2005,
        houseType: 'Townhouse', hasGarage: false, hasBasement: false, lotSqft: 2200,
      },
      comps: [
        {
          address: '92 Birch Creek Way, Charlotte, NC',
          beds: 2, baths: 2.5, sqft: 1200, yearBuilt: 2005,
          houseType: 'Townhouse', hasGarage: false, hasBasement: false, lotSqft: 2200,
          soldPrice: 245000, soldDate: '2025-11-05', distance: 0.05, issues: [],
        },
        {
          address: '310 Independence Blvd, Charlotte, NC',
          beds: 3, baths: 2, sqft: 1800, yearBuilt: 1998,
          houseType: 'Detached House', hasGarage: true, hasBasement: false, lotSqft: 7500,
          soldPrice: 310000, soldDate: '2025-10-22', distance: 0.4,
          issues: ['wrong_type', 'size_diff', 'lot_size_diff'],
        },
        {
          address: '15 Birch Creek Way, Charlotte, NC',
          beds: 2, baths: 2, sqft: 1150, yearBuilt: 2006,
          houseType: 'Townhouse', hasGarage: false, hasBasement: false, lotSqft: 2100,
          soldPrice: 238000, soldDate: '2025-12-01', distance: 0.1, issues: [],
        },
        {
          address: '402 Highway 74 Frontage, Charlotte, NC',
          beds: 2, baths: 2.5, sqft: 1250, yearBuilt: 2004,
          houseType: 'Townhouse', hasGarage: false, hasBasement: false, lotSqft: 2300,
          soldPrice: 210000, soldDate: '2025-09-18', distance: 0.3,
          issues: ['ext_obsolescence'],
        },
        {
          address: '750 Park Rd, Charlotte, NC',
          beds: 3, baths: 3, sqft: 2400, yearBuilt: 2010,
          houseType: 'Townhouse', hasGarage: true, hasBasement: false, lotSqft: 3000,
          soldPrice: 385000, soldDate: '2025-11-12', distance: 0.6,
          issues: ['size_diff', 'too_far'],
        },
      ],
    },
    // Scenario 3: Colonial with basement — tests distance, lot size, style
    {
      subject: {
        address: '1025 Elm St, Columbus, OH 43201',
        beds: 4, baths: 2.5, sqft: 2200, yearBuilt: 1965,
        houseType: 'Colonial', hasGarage: true, hasBasement: true, lotSqft: 10000,
      },
      comps: [
        {
          address: '1031 Elm St, Columbus, OH',
          beds: 4, baths: 2.5, sqft: 2100, yearBuilt: 1968,
          houseType: 'Colonial', hasGarage: true, hasBasement: true, lotSqft: 9800,
          soldPrice: 285000, soldDate: '2025-10-30', distance: 0.05, issues: [],
        },
        {
          address: '4500 Sawmill Rd, Columbus, OH',
          beds: 4, baths: 2.5, sqft: 2300, yearBuilt: 1970,
          houseType: 'Colonial', hasGarage: true, hasBasement: true, lotSqft: 11000,
          soldPrice: 310000, soldDate: '2025-11-15', distance: 3.2, issues: ['too_far'],
        },
        {
          address: '1050 Elm St, Columbus, OH',
          beds: 3, baths: 2, sqft: 1600, yearBuilt: 1975,
          houseType: 'Split-Level', hasGarage: true, hasBasement: true, lotSqft: 9500,
          soldPrice: 240000, soldDate: '2025-09-20', distance: 0.1,
          issues: ['diff_style', 'size_diff'],
        },
        {
          address: '980 Elm St, Columbus, OH',
          beds: 4, baths: 2, sqft: 2150, yearBuilt: 1963,
          houseType: 'Colonial', hasGarage: true, hasBasement: true, lotSqft: 10200,
          soldPrice: 278000, soldDate: '2025-12-02', distance: 0.2, issues: [],
        },
        {
          address: '1100 Oak Ave, Columbus, OH',
          beds: 4, baths: 3, sqft: 2250, yearBuilt: 1960,
          houseType: 'Colonial', hasGarage: true, hasBasement: true, lotSqft: 43560,
          soldPrice: 320000, soldDate: '2025-10-10', distance: 0.3, issues: ['lot_size_diff'],
        },
        {
          address: '1080 Elm St, Columbus, OH',
          beds: 4, baths: 2.5, sqft: 2180, yearBuilt: 1966,
          houseType: 'Colonial', hasGarage: true, hasBasement: true, lotSqft: 10500,
          soldPrice: 290000, status: 'Active', distance: 0.15, issues: ['active_listing'],
        },
      ],
    },
    // Scenario 4: Multi-family duplex — tests wrong type against single-family
    {
      subject: {
        address: '315 Vine St, Cincinnati, OH 45202',
        beds: 4, baths: 2, sqft: 2000, yearBuilt: 1920,
        houseType: 'Multi-Family Duplex', hasGarage: false, hasBasement: true, lotSqft: 4000,
      },
      comps: [
        {
          address: '321 Vine St, Cincinnati, OH',
          beds: 4, baths: 2, sqft: 1900, yearBuilt: 1925,
          houseType: 'Multi-Family Duplex', hasGarage: false, hasBasement: true, lotSqft: 3800,
          soldPrice: 195000, soldDate: '2025-11-08', distance: 0.05, issues: [],
        },
        {
          address: '400 Main St, Cincinnati, OH',
          beds: 3, baths: 2, sqft: 1500, yearBuilt: 1940,
          houseType: 'Single-Family', hasGarage: true, hasBasement: true, lotSqft: 6000,
          soldPrice: 225000, soldDate: '2025-10-20', distance: 0.3,
          issues: ['wrong_type', 'lot_size_diff'],
        },
        {
          address: '330 Vine St, Cincinnati, OH',
          beds: 6, baths: 3, sqft: 3200, yearBuilt: 1918,
          houseType: 'Multi-Family Triplex', hasGarage: false, hasBasement: true, lotSqft: 4500,
          soldPrice: 280000, soldDate: '2025-12-05', distance: 0.1,
          issues: ['wrong_type', 'size_diff'],
        },
        {
          address: '310 Vine St, Cincinnati, OH',
          beds: 4, baths: 2, sqft: 2100, yearBuilt: 1922,
          houseType: 'Multi-Family Duplex', hasGarage: false, hasBasement: true, lotSqft: 4200,
          soldPrice: 205000, soldDate: '2025-10-15', distance: 0.05, issues: [],
        },
        {
          address: '500 Race St, Cincinnati, OH',
          beds: 4, baths: 2, sqft: 2050, yearBuilt: 1930,
          houseType: 'Multi-Family Duplex', hasGarage: false, hasBasement: true, lotSqft: 3900,
          soldPrice: 185000, soldDate: '2025-03-12', distance: 0.4,
          issues: ['sale_too_old'],
        },
      ],
    },
    // Scenario 5: Mixed difficulty — multiple overlapping issues
    {
      subject: {
        address: '742 Peachtree Ln, Atlanta, GA 30308',
        beds: 3, baths: 2, sqft: 1600, yearBuilt: 1995,
        houseType: 'Vinyl Ranch', hasGarage: true, hasBasement: false, lotSqft: 7200,
      },
      comps: [
        {
          address: '2100 Industrial Pkwy, Atlanta, GA',
          beds: 3, baths: 1, sqft: 1100, yearBuilt: 1978,
          houseType: 'Mobile Home', hasGarage: false, hasBasement: false, lotSqft: 21780,
          soldPrice: 75000, soldDate: '2025-05-01', distance: 1.5,
          issues: ['wrong_type', 'size_diff', 'too_far', 'sale_too_old', 'lot_size_diff'],
        },
        {
          address: '750 Peachtree Ln, Atlanta, GA',
          beds: 3, baths: 2, sqft: 1550, yearBuilt: 1997,
          houseType: 'Vinyl Ranch', hasGarage: true, hasBasement: false, lotSqft: 7000,
          soldPrice: 265000, soldDate: '2025-11-22', distance: 0.05, issues: [],
        },
        {
          address: '800 Magnolia Dr, Atlanta, GA',
          beds: 4, baths: 3, sqft: 2800, yearBuilt: 2015,
          houseType: 'Brick Colonial', hasGarage: true, hasBasement: true, lotSqft: 12000,
          soldPrice: 450000, soldDate: '2025-12-01', distance: 0.4,
          issues: ['diff_style', 'size_diff', 'lot_size_diff'],
        },
        {
          address: '738 Peachtree Ln, Atlanta, GA',
          beds: 3, baths: 2, sqft: 1650, yearBuilt: 1993,
          houseType: 'Vinyl Ranch', hasGarage: true, hasBasement: false, lotSqft: 7400,
          soldPrice: 270000, soldDate: '2025-10-05', distance: 0.03, issues: [],
        },
        {
          address: '900 Hwy 85 Frontage Rd, Atlanta, GA',
          beds: 3, baths: 2, sqft: 1580, yearBuilt: 1992,
          houseType: 'Vinyl Ranch', hasGarage: true, hasBasement: false, lotSqft: 7100,
          soldPrice: 230000, soldDate: '2025-09-15', distance: 0.3,
          issues: ['ext_obsolescence'],
        },
        {
          address: '760 Peachtree Ln, Atlanta, GA',
          beds: 3, baths: 2, sqft: 1620, yearBuilt: 1996,
          houseType: 'Vinyl Ranch', hasGarage: true, hasBasement: false, lotSqft: 7300,
          soldPrice: 275000, status: 'Active', distance: 0.1,
          issues: ['active_listing'],
        },
      ],
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

  // Comp analysis state
  var compScenarioIndex = 0;
  var compQuestionIndex = 0;
  var compResults = [];
  var compCurrentComps = [];

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
      var rangeText = range.max === Infinity
        ? '$' + range.min.toLocaleString() + '+'
        : '$' + range.min.toLocaleString() + ' – $' + range.max.toLocaleString();
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
        el('span', { className: 'grade-option-desc' }, range.desc),
        el('span', { className: 'grade-option-range' }, rangeText)
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

  function isAdmin() {
    var email = getEmail().toLowerCase().trim();
    return ADMIN_EMAILS.indexOf(email) !== -1;
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

  function isCompAnalysisDone() {
    try { return localStorage.getItem(STORAGE_COMP_DONE) === 'true'; } catch (_) { return false; }
  }

  function setCompAnalysisDone() {
    try { localStorage.setItem(STORAGE_COMP_DONE, 'true'); } catch (_) {}
  }

  function getModuleGrades() {
    try { return JSON.parse(localStorage.getItem(STORAGE_GRADES) || '{}'); } catch (_) { return {}; }
  }

  function saveModuleGrade(moduleIdx, arvPct, renoPct) {
    var grades = getModuleGrades();
    var key = String(moduleIdx);
    var newAvg = (arvPct + renoPct) / 2;
    var existing = grades[key];
    // Save if first attempt or better than previous best
    if (!existing || newAvg < (existing.arvPct + existing.renoPct) / 2) {
      grades[key] = {
        arvPct: parseFloat(arvPct.toFixed(1)),
        renoPct: parseFloat(renoPct.toFixed(1)),
        arvGrade: letterGrade(arvPct),
        renoGrade: letterGrade(renoPct),
        overallGrade: letterGrade(newAvg),
        timestamp: new Date().toISOString()
      };
    }
    try { localStorage.setItem(STORAGE_GRADES, JSON.stringify(grades)); } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  function isSectionActive(section) {
    if (section.items) {
      for (var i = 0; i < section.items.length; i++) {
        if (section.items[i].id === activeSection) return true;
      }
    }
    if (section.groups) {
      for (var g = 0; g < section.groups.length; g++) {
        for (var i = 0; i < section.groups[g].items.length; i++) {
          if (section.groups[g].items[i].id === activeSection) return true;
        }
      }
    }
    return false;
  }

  function closeAllDropdowns() {
    var all = document.querySelectorAll('.nav-dropdown-open');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.remove('nav-dropdown-open');
      var btn = all[i].querySelector('.nav-trigger');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  }

  function closeMobileNav() {
    var panel = document.getElementById('mobile-nav-panel');
    var btn = document.getElementById('hamburger-btn');
    if (panel) panel.classList.remove('mobile-nav-open');
    if (btn) {
      btn.classList.remove('hamburger-active');
      btn.setAttribute('aria-expanded', 'false');
    }
  }

  function createNavItem(item, isMobile) {
    var isActive = activeSection === item.id;
    var classes = (isMobile ? 'mobile-nav-item' : 'nav-item') +
                  (isActive ? ' nav-item-active' : '') +
                  (!item.handler ? ' nav-item-coming-soon' : '');

    var navItem = el('button', { className: classes }, item.label);

    if (!item.handler) {
      navItem.appendChild(el('span', { className: 'coming-soon-badge' }, 'Soon'));
    }

    navItem.addEventListener('click', function (e) {
      e.stopPropagation();
      closeMobileNav();
      closeAllDropdowns();
      if (!item.handler) {
        activeSection = item.id;
        renderNav();
        renderComingSoon(item.label);
      } else {
        navigateTo(item.id, item.handler);
      }
    });

    return navItem;
  }

  function navigateTo(sectionId, handlerName) {
    activeSection = sectionId;
    renderNav();

    var handlers = {
      'bootArvTraining': bootArvTraining,
      'bootSalesLevel1': bootSalesLevel1,
      'bootSalesLevel2': bootSalesLevel2,
      'bootSalesLevel3': bootSalesLevel3,
      'renderMaterials': renderMaterials,
      'renderPerformance': renderPerformance,
      'bootProspectLookup': bootProspectLookup,
    };

    if (handlers[handlerName]) {
      handlers[handlerName]();
    }
  }

  function renderNav() {
    var nav = document.getElementById('main-nav');
    var mobilePanel = document.getElementById('mobile-nav-panel');
    if (!nav) return;
    nav.innerHTML = '';
    if (mobilePanel) mobilePanel.innerHTML = '';

    NAV_CONFIG.forEach(function (section) {
      if (section.disabled) return;
      // --- Desktop dropdown ---
      var dropdownWrapper = el('div', { className: 'nav-dropdown' });
      var triggerText = section.icon + ' ' + section.label;
      var trigger = el('button', {
        className: 'nav-trigger' + (isSectionActive(section) ? ' nav-trigger-active' : ''),
      }, triggerText, ' ', el('span', { className: 'nav-chevron' }, '\u25BE'));
      trigger.setAttribute('aria-haspopup', 'true');
      trigger.setAttribute('aria-expanded', 'false');

      var panel = el('div', { className: 'nav-panel' });

      if (section.groups) {
        section.groups.forEach(function (group) {
          panel.appendChild(el('div', { className: 'nav-group-label' }, group.label));
          group.items.forEach(function (item) {
            panel.appendChild(createNavItem(item, false));
          });
        });
      } else if (section.items) {
        section.items.forEach(function (item) {
          panel.appendChild(createNavItem(item, false));
        });
      }

      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = dropdownWrapper.classList.contains('nav-dropdown-open');
        closeAllDropdowns();
        if (!isOpen) {
          dropdownWrapper.classList.add('nav-dropdown-open');
          trigger.setAttribute('aria-expanded', 'true');
        }
      });
      // Stop clicks inside the panel from bubbling to the document close handler
      panel.addEventListener('click', function (e) { e.stopPropagation(); });

      dropdownWrapper.appendChild(trigger);
      dropdownWrapper.appendChild(panel);
      nav.appendChild(dropdownWrapper);

      // --- Mobile accordion ---
      if (mobilePanel) {
        var mobileSection = el('div', { className: 'mobile-nav-section' });
        var mobileTrigger = el('button', {
          className: 'mobile-nav-trigger' + (isSectionActive(section) ? ' mobile-nav-trigger-active' : ''),
        }, section.icon + ' ' + section.label, ' ', el('span', { className: 'nav-chevron' }, '\u25BE'));
        var mobileItems = el('div', { className: 'mobile-nav-items' });

        if (section.groups) {
          section.groups.forEach(function (group) {
            mobileItems.appendChild(el('div', { className: 'nav-group-label' }, group.label));
            group.items.forEach(function (item) {
              mobileItems.appendChild(createNavItem(item, true));
            });
          });
        } else if (section.items) {
          section.items.forEach(function (item) {
            mobileItems.appendChild(createNavItem(item, true));
          });
        }

        mobileTrigger.addEventListener('click', function () {
          var isOpen = mobileSection.classList.contains('mobile-section-open');
          var allSections = mobilePanel.querySelectorAll('.mobile-nav-section');
          for (var i = 0; i < allSections.length; i++) {
            allSections[i].classList.remove('mobile-section-open');
          }
          if (!isOpen) mobileSection.classList.add('mobile-section-open');
        });

        mobileSection.appendChild(mobileTrigger);
        mobileSection.appendChild(mobileItems);
        mobilePanel.appendChild(mobileSection);
      }
    });

    // Dashboard, History & Leaderboard direct nav buttons
    if (getEmail()) {
      if (isCompAnalysisDone()) {
        var dashBtn = el('button', {
          className: 'nav-trigger' + (activeSection === 'arv-training' ? ' nav-trigger-active' : ''),
          onClick: function () {
            closeAllDropdowns();
            closeMobileNav();
            activeSection = 'arv-training';
            renderNav();
            loadProperties().then(function () { renderDashboard(); }).catch(function () { renderDashboard(); });
          }
        }, '\uD83C\uDFE0 Dashboard');
        nav.appendChild(dashBtn);
      }

      var histBtn = el('button', {
        className: 'nav-trigger' + (activeSection === 'history' ? ' nav-trigger-active' : ''),
        onClick: function () { closeAllDropdowns(); closeMobileNav(); renderHistory(); }
      }, '\uD83D\uDCCA History');
      nav.appendChild(histBtn);

      var certBtn = el('button', {
        className: 'nav-trigger' + (activeSection === 'certification' ? ' nav-trigger-active' : ''),
        onClick: function () { closeAllDropdowns(); closeMobileNav(); renderCertificationStatus(); }
      }, '\uD83C\uDF93 Certification');
      nav.appendChild(certBtn);

      var lbBtn = el('button', {
        className: 'nav-trigger' + (activeSection === 'leaderboard' ? ' nav-trigger-active' : ''),
        onClick: function () { closeAllDropdowns(); closeMobileNav(); renderLeaderboard(); }
      }, '\uD83C\uDFC6 Leaders');
      nav.appendChild(lbBtn);

      var plBtn = el('button', {
        className: 'nav-trigger' + (activeSection === 'prospect-lookup' ? ' nav-trigger-active' : ''),
        onClick: function () { closeAllDropdowns(); closeMobileNav(); bootProspectLookup(); }
      }, '\uD83D\uDD0D Prospects');
      nav.appendChild(plBtn);

      // Mobile equivalents
      if (mobilePanel) {
        if (isCompAnalysisDone()) {
          mobilePanel.appendChild(el('button', {
            className: 'mobile-nav-direct-btn' + (activeSection === 'arv-training' ? ' mobile-nav-trigger-active' : ''),
            onClick: function () {
              closeMobileNav();
              activeSection = 'arv-training';
              renderNav();
              loadProperties().then(function () { renderDashboard(); }).catch(function () { renderDashboard(); });
            }
          }, '\uD83C\uDFE0 Dashboard'));
        }
        mobilePanel.appendChild(el('button', {
          className: 'mobile-nav-direct-btn' + (activeSection === 'history' ? ' mobile-nav-trigger-active' : ''),
          onClick: function () { closeMobileNav(); renderHistory(); }
        }, '\uD83D\uDCCA History'));
        mobilePanel.appendChild(el('button', {
          className: 'mobile-nav-direct-btn' + (activeSection === 'certification' ? ' mobile-nav-trigger-active' : ''),
          onClick: function () { closeMobileNav(); renderCertificationStatus(); }
        }, '\uD83C\uDF93 Certification'));
        mobilePanel.appendChild(el('button', {
          className: 'mobile-nav-direct-btn' + (activeSection === 'leaderboard' ? ' mobile-nav-trigger-active' : ''),
          onClick: function () { closeMobileNav(); renderLeaderboard(); }
        }, '\uD83C\uDFC6 Leaders'));
        mobilePanel.appendChild(el('button', {
          className: 'mobile-nav-direct-btn' + (activeSection === 'prospect-lookup' ? ' mobile-nav-trigger-active' : ''),
          onClick: function () { closeMobileNav(); bootProspectLookup(); }
        }, '\uD83D\uDD0D Prospects'));
      }
    }

    // Wire hamburger
    var hamburgerBtn = document.getElementById('hamburger-btn');
    if (hamburgerBtn) {
      hamburgerBtn.onclick = function () {
        var isOpen = mobilePanel && mobilePanel.classList.contains('mobile-nav-open');
        if (mobilePanel) mobilePanel.classList.toggle('mobile-nav-open');
        hamburgerBtn.classList.toggle('hamburger-active');
        hamburgerBtn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      };
    }
  }

  // Close dropdowns when clicking outside
  document.addEventListener('click', function () {
    closeAllDropdowns();
  });

  // ---------------------------------------------------------------------------
  // Coming Soon / Landing Page
  // ---------------------------------------------------------------------------

  function renderComingSoon(sectionName) {
    var app = clearApp();
    var screen = el('div', { className: 'screen coming-soon-screen' });
    screen.appendChild(el('div', { className: 'coming-soon-icon' }, '\uD83D\uDEA7'));
    screen.appendChild(el('h1', null, sectionName));
    screen.appendChild(el('p', { className: 'coming-soon-text' }, 'This training module is coming soon. Check back later!'));
    screen.appendChild(el('button', {
      className: 'btn-primary',
      onClick: function () {
        activeSection = null;
        renderNav();
        renderLandingPage();
      }
    }, '\u2190 Back to Home'));
    app.appendChild(screen);
  }

  function renderLandingPage() {
    var app = clearApp();
    var screen = el('div', { className: 'screen landing-screen' });
    screen.appendChild(el('h1', null, 'Rebuilt Training'));
    screen.appendChild(el('p', { className: 'landing-subtitle' }, 'Choose a training program to get started.'));

    var grid = el('div', { className: 'landing-grid' });
    NAV_CONFIG.forEach(function (section) {
      if (section.disabled) return;
      var allItems = [];
      if (section.items) allItems = section.items;
      if (section.groups) {
        section.groups.forEach(function (g) {
          allItems = allItems.concat(g.items);
        });
      }

      var card = el('div', { className: 'landing-card' });
      card.appendChild(el('div', { className: 'landing-card-icon' }, section.icon));
      card.appendChild(el('h2', null, section.label));

      var list = el('ul', { className: 'landing-card-list' });
      allItems.forEach(function (item) {
        var li = el('li', null);
        li.appendChild(el('span', null, item.label));
        if (!item.handler) {
          li.classList.add('landing-item-soon');
          li.appendChild(el('span', { className: 'coming-soon-badge' }, 'Soon'));
        } else {
          var goBtn = el('button', {
            className: 'landing-go-btn',
            onClick: function () { navigateTo(item.id, item.handler); }
          }, 'Start \u2192');
          li.appendChild(goBtn);
        }
        list.appendChild(li);
      });
      card.appendChild(list);
      grid.appendChild(card);
    });

    screen.appendChild(grid);
    app.appendChild(screen);
  }

  // ---------------------------------------------------------------------------
  // Sales Training
  // ---------------------------------------------------------------------------

  function getSalesProgress() {
    try {
      var p = JSON.parse(localStorage.getItem(STORAGE_SALES) || 'null');
      return p || { watchedVideos: {}, quizScores: {} };
    } catch (_) { return { watchedVideos: {}, quizScores: {} }; }
  }

  function saveSalesProgress(p) {
    try { localStorage.setItem(STORAGE_SALES, JSON.stringify(p)); } catch (_) {}
  }

  function markVideoWatched(levelId, videoFileId) {
    var p = getSalesProgress();
    if (!p.watchedVideos[levelId]) p.watchedVideos[levelId] = [];
    if (p.watchedVideos[levelId].indexOf(videoFileId) === -1) {
      p.watchedVideos[levelId].push(videoFileId);
    }
    saveSalesProgress(p);
  }

  function isLevelUnlocked(levelIndex) {
    if (levelIndex === 0) return true;
    var prevLevel = SALES_COURSE[levelIndex - 1];
    var p = getSalesProgress();
    return p.quizScores[prevLevel.id] >= 7; // need 70% to unlock next level
  }

  function bootSalesLevel1() { bootSalesLevel(0); }
  function bootSalesLevel2() { bootSalesLevel(1); }
  function bootSalesLevel3() { bootSalesLevel(2); }

  function bootSalesLevel(levelIndex) {
    var level = SALES_COURSE[levelIndex];
    activeSection = level.id;
    renderNav();
    if (!isLevelUnlocked(levelIndex)) {
      renderSalesLocked(levelIndex);
    } else {
      renderSalesLevelDash(levelIndex);
    }
  }

  function renderSalesLocked(levelIndex) {
    var level = SALES_COURSE[levelIndex];
    var prev = SALES_COURSE[levelIndex - 1];
    var app = clearApp();
    var screen = el('div', { className: 'screen coming-soon-screen' });
    screen.appendChild(el('div', { className: 'coming-soon-icon' }, '\uD83D\uDD12'));
    screen.appendChild(el('h1', null, level.title));
    screen.appendChild(el('p', { className: 'coming-soon-text' },
      'Complete "' + prev.title + '" with a score of 70% or higher to unlock this level.'));
    screen.appendChild(el('button', {
      className: 'btn-primary',
      onClick: function () { bootSalesLevel(levelIndex - 1); }
    }, '\u2190 Go to ' + prev.title));
    app.appendChild(screen);
  }

  function renderSalesLevelDash(levelIndex) {
    var level = SALES_COURSE[levelIndex];
    var p = getSalesProgress();
    var app = clearApp();
    var screen = el('div', { className: 'screen sales-dash-screen' });

    // Header
    var hdr = el('div', { className: 'sales-dash-header' });
    hdr.appendChild(el('span', { className: 'sales-dash-icon' }, level.icon));
    hdr.appendChild(el('h1', null, level.title));
    hdr.appendChild(el('p', { className: 'sales-dash-subtitle' }, level.subtitle));
    screen.appendChild(hdr);

    // Module cards
    var grid = el('div', { className: 'sales-module-grid' });
    var totalVids = 0;
    var watchedVids = 0;
    level.modules.forEach(function (mod, modIdx) {
      var card = el('div', { className: 'sales-module-card' });
      card.appendChild(el('div', { className: 'sales-module-num' }, 'Module ' + (modIdx + 1)));
      card.appendChild(el('h3', null, mod.title));
      card.appendChild(el('p', null, mod.desc));

      // Video count
      var modWatched = 0;
      mod.videos.forEach(function (v) {
        totalVids++;
        if (p.watchedVideos[level.id] && p.watchedVideos[level.id].indexOf(v.fileId) !== -1) {
          modWatched++;
          watchedVids++;
        }
      });
      var vidStatus = el('div', { className: 'sales-module-status' },
        '\uD83C\uDFAC ' + modWatched + '/' + mod.videos.length + ' videos watched');
      card.appendChild(vidStatus);

      var btn = el('button', {
        className: modWatched === mod.videos.length ? 'btn-primary sales-mod-btn completed' : 'btn-primary sales-mod-btn',
        onClick: (function (mi) {
          return function () { renderSalesModule(levelIndex, mi); };
        })(modIdx)
      }, modWatched === mod.videos.length ? '\u2705 Review Module' : '\u25B6 Start Module');
      card.appendChild(btn);
      grid.appendChild(card);
    });
    screen.appendChild(grid);

    // Quiz section
    var quizSection = el('div', { className: 'sales-quiz-section' });
    var quizScore = p.quizScores[level.id];
    var allWatched = watchedVids === totalVids;
    quizSection.appendChild(el('h2', null, '\uD83D\uDCDD Level ' + (levelIndex + 1) + ' Assessment'));

    if (quizScore !== undefined) {
      var passed = quizScore >= 7;
      quizSection.appendChild(el('p', { className: 'sales-quiz-score ' + (passed ? 'passed' : 'failed') },
        'Score: ' + quizScore + '/10 ' + (passed ? '\u2705 Passed' : '\u274C Not passed (need 7/10)')));
    }

    if (!allWatched) {
      quizSection.appendChild(el('p', { className: 'sales-quiz-locked' },
        '\uD83D\uDD12 Watch all ' + totalVids + ' videos to unlock the assessment (' + watchedVids + '/' + totalVids + ' completed)'));
    }

    var quizBtn = el('button', {
      className: 'btn-primary sales-quiz-btn' + (!allWatched ? ' btn-disabled' : ''),
      onClick: allWatched ? function () { renderSalesQuiz(levelIndex); } : null,
      disabled: !allWatched
    }, quizScore !== undefined ? 'Retake Assessment' : 'Start Assessment');
    quizSection.appendChild(quizBtn);

    // Next level teaser
    if (levelIndex < SALES_COURSE.length - 1 && quizScore >= 7) {
      var nextLevel = SALES_COURSE[levelIndex + 1];
      quizSection.appendChild(el('button', {
        className: 'btn-primary sales-next-btn',
        onClick: function () { bootSalesLevel(levelIndex + 1); }
      }, 'Next: ' + nextLevel.title + ' \u2192'));
    }

    screen.appendChild(quizSection);

    // Back button
    screen.appendChild(el('button', {
      className: 'btn-secondary sales-back-btn',
      onClick: function () {
        activeSection = null;
        renderNav();
        renderLandingPage();
      }
    }, '\u2190 Back to Home'));

    app.appendChild(screen);
  }

  var VIDEO_MIN_SECONDS = 180; // 3 minutes minimum before check questions unlock
  var _videoTimers = {};        // tracks elapsed time per video { fileId: { start, intervalId } }

  function startVideoTimer(fileId, timerEl, checkSection) {
    if (_videoTimers[fileId]) return; // already running
    var start = Date.now();
    _videoTimers[fileId] = { start: start, intervalId: null };
    var update = function () {
      var elapsed = Math.floor((Date.now() - start) / 1000);
      var remaining = VIDEO_MIN_SECONDS - elapsed;
      if (remaining <= 0) {
        clearInterval(_videoTimers[fileId].intervalId);
        timerEl.textContent = '';
        timerEl.style.display = 'none';
        checkSection.style.display = 'block';
        checkSection.classList.add('check-visible');
      } else {
        var mins = Math.floor(remaining / 60);
        var secs = remaining % 60;
        timerEl.textContent = '\u23F3 Questions unlock in ' + mins + ':' + (secs < 10 ? '0' : '') + secs;
      }
    };
    _videoTimers[fileId].intervalId = setInterval(update, 1000);
    update();
  }

  function clearVideoTimers() {
    Object.keys(_videoTimers).forEach(function (k) {
      if (_videoTimers[k].intervalId) clearInterval(_videoTimers[k].intervalId);
    });
    _videoTimers = {};
  }

  function renderSalesModule(levelIndex, moduleIndex, videoIndex) {
    clearVideoTimers();
    var level = SALES_COURSE[levelIndex];
    var mod = level.modules[moduleIndex];
    var p = getSalesProgress();
    var admin = isAdmin();
    if (videoIndex === undefined) videoIndex = 0;
    var v = mod.videos[videoIndex];
    var watched = p.watchedVideos[level.id] && p.watchedVideos[level.id].indexOf(v.fileId) !== -1;

    var app = clearApp();
    var screen = el('div', { className: 'screen sales-module-screen' });

    // Back to level
    screen.appendChild(el('button', {
      className: 'btn-secondary sales-back-btn',
      onClick: function () { clearVideoTimers(); renderSalesLevelDash(levelIndex); }
    }, '\u2190 Back to ' + level.title));

    // Header with progress
    screen.appendChild(el('div', { className: 'sales-module-num' }, 'Module ' + (moduleIndex + 1) + ' \u00B7 Video ' + (videoIndex + 1) + ' of ' + mod.videos.length));
    screen.appendChild(el('h1', null, mod.title));
    screen.appendChild(el('p', { className: 'sales-module-desc' }, mod.desc));

    // --- Single Video Card ---
    var videoCard = el('div', { className: 'sales-video-card' + (watched ? ' watched' : '') });

    var videoTitle = el('div', { className: 'sales-video-title' },
      (watched ? '\u2705 ' : '\uD83C\uDFAC ') + v.title);
    videoCard.appendChild(videoTitle);

    var iframeWrapper = el('div', { className: 'sales-video-wrapper' });
    var iframe = document.createElement('iframe');
    iframe.src = 'https://drive.google.com/file/d/' + v.fileId + '/preview';
    iframe.setAttribute('allow', 'autoplay; encrypted-media');
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.setAttribute('frameborder', '0');
    iframeWrapper.appendChild(iframe);
    videoCard.appendChild(iframeWrapper);

    if (!watched) {
      // --- Admin: quick bypass ---
      if (admin) {
        var adminRow = el('div', { className: 'video-admin-row' });
        adminRow.appendChild(el('button', {
          className: 'btn-primary sales-admin-skip-btn',
          onClick: function () {
            markVideoWatched(level.id, v.fileId);
            renderSalesModule(levelIndex, moduleIndex, videoIndex);
          }
        }, '\u26A1 Admin: Mark Watched'));
        videoCard.appendChild(adminRow);
      }

      // --- Timer countdown ---
      var timerEl = el('div', { className: 'video-timer' });
      videoCard.appendChild(timerEl);

      // --- Check questions section (hidden until timer expires or admin) ---
      var checkSection = el('div', { className: 'video-check-section' });
      if (!admin) checkSection.style.display = 'none';

      if (v.checks && v.checks.length > 0) {
        checkSection.appendChild(el('h3', { className: 'video-check-heading' }, '\uD83E\uDDE0 Comprehension Check'));
        if (admin) {
          checkSection.appendChild(el('div', { className: 'admin-answer-banner' },
            '\uD83D\uDD11 Admin: correct answers highlighted in green'));
        }
        var checkSelected = {};
        var checkForm = el('div', { className: 'video-check-form' });

        v.checks.forEach(function (ck, ckIdx) {
          var qBlock = el('div', { className: 'video-check-q' });
          qBlock.appendChild(el('p', { className: 'video-check-q-text' }, (ckIdx + 1) + '. ' + ck.q));

          var opts = el('div', { className: 'video-check-opts' });
          ck.choices.forEach(function (choice, cIdx) {
            var optLabel = el('label', { className: 'video-check-opt' + (admin && cIdx === ck.answer ? ' admin-highlight-correct' : '') });
            var radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'vc-' + ckIdx;
            radio.value = cIdx;
            radio.addEventListener('change', function () { checkSelected[ckIdx] = cIdx; });
            optLabel.appendChild(radio);
            optLabel.appendChild(document.createTextNode(' ' + choice));
            opts.appendChild(optLabel);
          });
          qBlock.appendChild(opts);
          qBlock.appendChild(el('div', { className: 'video-check-feedback', id: 'vcfb-' + ckIdx }));
          checkForm.appendChild(qBlock);
        });
        checkSection.appendChild(checkForm);

        // Submit check button
        var checkSubmit = el('button', {
          className: 'btn-primary video-check-submit',
          onClick: function () {
            var allCorrect = true;
            v.checks.forEach(function (ck, ckIdx) {
              var fb = document.getElementById('vcfb-' + ckIdx);
              var qBlock = fb.parentNode;
              if (checkSelected[ckIdx] === ck.answer) {
                fb.textContent = '\u2705 Correct!';
                fb.className = 'video-check-feedback correct';
                qBlock.classList.remove('incorrect');
                qBlock.classList.add('correct');
              } else {
                allCorrect = false;
                fb.textContent = '\u274C Try again';
                fb.className = 'video-check-feedback incorrect';
                qBlock.classList.remove('correct');
                qBlock.classList.add('incorrect');
              }
            });
            if (allCorrect) {
              markVideoWatched(level.id, v.fileId);
              var btn = this;
              btn.textContent = '\uD83C\uDF89 All correct! Video complete!';
              btn.classList.add('check-passed');
              btn.disabled = true;
              setTimeout(function () {
                renderSalesModule(levelIndex, moduleIndex, videoIndex);
              }, 1200);
            }
          }
        }, 'Submit Answers');
        checkSection.appendChild(checkSubmit);
      }

      videoCard.appendChild(checkSection);

      // Start timer for non-admin users (admin sees checks immediately)
      if (!admin) {
        startVideoTimer(v.fileId, timerEl, checkSection);
      } else {
        timerEl.style.display = 'none';
      }
    }

    screen.appendChild(videoCard);

    // --- Navigation buttons ---
    if (watched) {
      // Video is complete — show next video / next module / back to dashboard
      if (videoIndex < mod.videos.length - 1) {
        screen.appendChild(el('button', {
          className: 'btn-primary sales-next-btn',
          onClick: function () { renderSalesModule(levelIndex, moduleIndex, videoIndex + 1); }
        }, 'Next Video: ' + mod.videos[videoIndex + 1].title + ' \u2192'));
      } else if (moduleIndex < level.modules.length - 1) {
        screen.appendChild(el('button', {
          className: 'btn-primary sales-next-btn',
          onClick: function () { renderSalesModule(levelIndex, moduleIndex + 1, 0); }
        }, 'Next Module: ' + level.modules[moduleIndex + 1].title + ' \u2192'));
      } else {
        screen.appendChild(el('button', {
          className: 'btn-primary sales-next-btn',
          onClick: function () { clearVideoTimers(); renderSalesLevelDash(levelIndex); }
        }, 'Back to Level Dashboard \u2192'));
      }
    }

    app.appendChild(screen);
  }

  function renderSalesQuiz(levelIndex) {
    var level = SALES_COURSE[levelIndex];
    var questions = level.quiz;
    var app = clearApp();
    var screen = el('div', { className: 'screen sales-quiz-screen' });

    screen.appendChild(el('h1', null, level.title + ' \u2013 Assessment'));
    screen.appendChild(el('p', null, 'Answer all 10 questions. You need 7/10 (70%) to pass.'));

    var form = el('div', { className: 'sales-quiz-form' });
    var selected = {};

    questions.forEach(function (qObj, qIdx) {
      var qBlock = el('div', { className: 'sales-quiz-question' });
      qBlock.appendChild(el('p', { className: 'sales-quiz-q-text' }, (qIdx + 1) + '. ' + qObj.q));

      var opts = el('div', { className: 'sales-quiz-options' });
      qObj.choices.forEach(function (choice, cIdx) {
        var optLabel = el('label', { className: 'sales-quiz-option' });
        var radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'sq-' + qIdx;
        radio.value = cIdx;
        radio.addEventListener('change', function () { selected[qIdx] = cIdx; });
        optLabel.appendChild(radio);
        optLabel.appendChild(document.createTextNode(' ' + choice));
        opts.appendChild(optLabel);
      });
      qBlock.appendChild(opts);
      form.appendChild(qBlock);
    });
    screen.appendChild(form);

    var submitBtn = el('button', {
      className: 'btn-primary sales-quiz-submit',
      onClick: function () {
        // Count correct
        var correct = 0;
        for (var i = 0; i < questions.length; i++) {
          if (selected[i] === questions[i].answer) correct++;
        }
        // Save
        var p = getSalesProgress();
        p.quizScores[level.id] = correct;
        saveSalesProgress(p);
        renderSalesQuizResults(levelIndex, correct, selected);
      }
    }, 'Submit Assessment');
    screen.appendChild(submitBtn);

    app.appendChild(screen);
  }

  function renderSalesQuizResults(levelIndex, score, selected) {
    var level = SALES_COURSE[levelIndex];
    var questions = level.quiz;
    var passed = score >= 7;

    // Log to Google Sheets
    logSalesToSheets(level.id, level.title, passed, score);

    // Check if all levels passed → show diploma
    if (passed && allSalesLevelsPassed()) {
      renderSalesDiploma();
      return;
    }

    var app = clearApp();
    var screen = el('div', { className: 'screen sales-results-screen' });

    screen.appendChild(el('h1', null, passed ? '\uD83C\uDF89 Level Complete!' : '\uD83D\uDCDA Keep Studying'));
    screen.appendChild(el('div', { className: 'sales-results-score ' + (passed ? 'passed' : 'failed') },
      score + '/10'));
    screen.appendChild(el('p', null, passed
      ? 'Congratulations! You passed ' + level.title + '.'
      : 'You need 7/10 to pass. Review the modules and try again.'));

    // Show answers
    var review = el('div', { className: 'sales-results-review' });
    questions.forEach(function (qObj, qIdx) {
      var isCorrect = selected[qIdx] === qObj.answer;
      var item = el('div', { className: 'sales-result-item ' + (isCorrect ? 'correct' : 'incorrect') });
      item.appendChild(el('p', { className: 'sales-result-q' },
        (isCorrect ? '\u2705 ' : '\u274C ') + (qIdx + 1) + '. ' + qObj.q));
      if (!isCorrect) {
        item.appendChild(el('p', { className: 'sales-result-answer' },
          'Correct answer: ' + qObj.choices[qObj.answer]));
      }
      review.appendChild(item);
    });
    screen.appendChild(review);

    // Action buttons
    if (passed && levelIndex < SALES_COURSE.length - 1) {
      screen.appendChild(el('button', {
        className: 'btn-primary sales-next-btn',
        onClick: function () { bootSalesLevel(levelIndex + 1); }
      }, 'Next Level: ' + SALES_COURSE[levelIndex + 1].title + ' \u2192'));
    }

    screen.appendChild(el('button', {
      className: passed ? 'btn-secondary' : 'btn-primary',
      onClick: function () { renderSalesLevelDash(levelIndex); }
    }, '\u2190 Back to ' + level.title));

    if (!passed) {
      screen.appendChild(el('button', {
        className: 'btn-secondary',
        onClick: function () { renderSalesQuiz(levelIndex); }
      }, '\uD83D\uDD04 Retake Assessment'));
    }

    app.appendChild(screen);
  }

  // ---------------------------------------------------------------------------
  // Sales Diploma (shown after all 3 levels passed)
  // ---------------------------------------------------------------------------

  var STORAGE_SALES_SLACK_POSTED = 'rebuilt_sales_slack_posted';

  function allSalesLevelsPassed() {
    var p = getSalesProgress();
    for (var i = 0; i < SALES_COURSE.length; i++) {
      if (!p.quizScores[SALES_COURSE[i].id] || p.quizScores[SALES_COURSE[i].id] < 7) return false;
    }
    return true;
  }

  function postSalesDiplomaToSlack() {
    try { if (localStorage.getItem(STORAGE_SALES_SLACK_POSTED) === 'true') return; } catch (_) {}
    if (!SHEETS_URL || SHEETS_URL === 'DEPLOY_URL_PLACEHOLDER') return;
    var email = getEmail() || '';
    var name = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, function (l) { return l.toUpperCase(); });
    try {
      postToAppsScript({ action: 'slackSalesDiploma', name: name, email: email });
      localStorage.setItem(STORAGE_SALES_SLACK_POSTED, 'true');
    } catch (_) {}
  }

  function logSalesToSheets(levelId, levelTitle, passed, score) {
    if (!SHEETS_URL || SHEETS_URL === 'DEPLOY_URL_PLACEHOLDER') return;
    try {
      postToAppsScript({
        action: 'salesTraining',
        email: getEmail() || '',
        dateTime: new Date().toISOString(),
        level: levelTitle,
        result: passed ? 'Pass' : 'Fail',
        score: score + '/10',
      });
    } catch (_) {}
  }

  function renderSalesDiploma() {
    var app = clearApp();
    var screen = el('div', { className: 'screen diploma-screen' });

    postSalesDiplomaToSlack();

    var email = getEmail();
    var name = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, function (l) { return l.toUpperCase(); });

    // Gather scores
    var p = getSalesProgress();
    var scoreLines = SALES_COURSE.map(function (lvl) {
      return lvl.title + ': ' + (p.quizScores[lvl.id] || 0) + '/10';
    }).join('  |  ');

    screen.appendChild(el('div', { className: 'diploma-frame' },
      el('div', { className: 'diploma-inner' },
        el('div', { className: 'diploma-top-accent' }),
        el('p', { className: 'diploma-org' }, 'Rebuilt Realty'),
        el('h1', { className: 'diploma-title' }, 'Certificate of Completion'),
        el('div', { className: 'diploma-divider' }),
        el('p', { className: 'diploma-awarded' }, 'This certifies that'),
        el('h2', { className: 'diploma-name' }, name),
        el('p', { className: 'diploma-achievement' }, 'has successfully completed all 3 levels of the'),
        el('h3', { className: 'diploma-program' }, 'Sales Training Program'),
        el('p', { className: 'diploma-subtitle' }, 'and is hereby recognized as a'),
        el('div', { className: 'diploma-badge' }, '\uD83C\uDFC6'),
        el('h2', { className: 'diploma-level' }, 'Rebuilt Certified Sales Pro'),
        el('p', { className: 'diploma-scores' }, scoreLines),
        el('div', { className: 'diploma-divider' }),
        el('p', { className: 'diploma-date' }, new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })),
        el('p', { className: 'diploma-email' }, email)
      )
    ));

    screen.appendChild(el('div', { className: 'diploma-cta' },
      el('p', { className: 'diploma-instruction' }, '\uD83C\uDF89 Your achievement has been posted to #praisewall!'),
      el('p', { className: 'diploma-subtext' }, 'The team knows you\u2019re a certified Sales Pro.')
    ));

    var btnRow = el('div', { className: 'btn-row' });
    btnRow.appendChild(el('button', {
      className: 'btn-primary',
      onClick: function () { renderLandingPage(); }
    }, '\uD83C\uDFE0 Back to Training Home'));
    screen.appendChild(btnRow);

    app.appendChild(screen);
  }

  // ---------------------------------------------------------------------------
  // Materials Library — browse all training videos
  // ---------------------------------------------------------------------------

  function renderMaterials() {
    activeSection = 'materials-library';
    renderNav();
    var app = clearApp();
    var screen = el('div', { className: 'screen materials-screen' });

    screen.appendChild(el('h1', null, '\uD83D\uDCDA Training Materials Library'));
    screen.appendChild(el('p', { className: 'materials-subtitle' }, 'Browse all training videos across the Sales Training curriculum.'));

    SALES_COURSE.forEach(function (level, levelIdx) {
      var section = el('div', { className: 'materials-level-section' });
      section.appendChild(el('h2', { className: 'materials-level-title' }, level.icon + ' ' + level.title));
      section.appendChild(el('p', { className: 'materials-level-sub' }, level.subtitle));

      var grid = el('div', { className: 'materials-grid' });

      level.modules.forEach(function (mod) {
        mod.videos.forEach(function (v) {
          var card = el('div', { className: 'materials-card' });

          // Thumbnail from Google Drive
          var thumb = el('div', { className: 'materials-thumb' });
          var img = document.createElement('img');
          img.src = 'https://drive.google.com/thumbnail?id=' + v.fileId + '&sz=w400';
          img.alt = v.title;
          img.loading = 'lazy';
          thumb.appendChild(img);
          // Play overlay
          thumb.appendChild(el('div', { className: 'materials-play-icon' }, '\u25B6'));
          card.appendChild(thumb);

          var info = el('div', { className: 'materials-info' });
          info.appendChild(el('h3', { className: 'materials-video-title' }, v.title));
          info.appendChild(el('p', { className: 'materials-video-desc' }, mod.title + ' \u2014 ' + mod.desc));
          card.appendChild(info);

          card.addEventListener('click', function () {
            renderMaterialViewer(v, level, mod);
          });

          grid.appendChild(card);
        });
      });

      section.appendChild(grid);
      screen.appendChild(section);
    });

    app.appendChild(screen);
  }

  function renderMaterialViewer(video, level, mod) {
    var app = clearApp();
    var screen = el('div', { className: 'screen materials-viewer-screen' });

    screen.appendChild(el('button', {
      className: 'btn-secondary sales-back-btn',
      onClick: function () { renderMaterials(); }
    }, '\u2190 Back to Materials'));

    screen.appendChild(el('p', { className: 'materials-breadcrumb' }, level.icon + ' ' + level.title + ' \u203A ' + mod.title));
    screen.appendChild(el('h1', null, video.title));

    var iframeWrap = el('div', { className: 'sales-video-iframe-wrap' });
    var iframe = document.createElement('iframe');
    iframe.src = 'https://drive.google.com/file/d/' + video.fileId + '/preview';
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('allow', 'autoplay');
    iframeWrap.appendChild(iframe);
    screen.appendChild(iframeWrap);

    screen.appendChild(el('div', { className: 'materials-viewer-desc' },
      el('h3', null, mod.title),
      el('p', null, mod.desc)
    ));

    app.appendChild(screen);
  }

  // ---------------------------------------------------------------------------
  // Boot ARV Training
  // ---------------------------------------------------------------------------

  function bootArvTraining() {
    activeSection = 'arv-training';
    renderNav();

    var email = getEmail();
    if (!email) {
      renderSignIn();
    } else if (!isPresentationDone()) {
      renderPresentation();
    } else if (!isCompAnalysisDone()) {
      renderCompIntro();
    } else {
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

  function getModuleQuestionCount(moduleIdx) {
    var start = moduleIdx * QUESTIONS_PER_MODULE;
    var total = allProperties ? allProperties.length : 0;
    return Math.min(QUESTIONS_PER_MODULE, total - start);
  }

  function getModuleProperties(moduleIdx) {
    if (!allProperties) return [];
    var order = getPropertyOrder();
    if (!order || order.length !== allProperties.length) {
      order = shuffleArray(allProperties.map(function (_, i) { return i; }));
      savePropertyOrder(order);
    }
    var start = moduleIdx * QUESTIONS_PER_MODULE;
    var end = start + getModuleQuestionCount(moduleIdx);
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
    postToAppsScript(payload);
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

  function logCompToSheets(passed, avgScore) {
    if (!SHEETS_URL || SHEETS_URL === 'DEPLOY_URL_PLACEHOLDER') return;
    var payload = {
      email: getEmail() || '',
      dateTime: new Date().toISOString(),
      module: 'Intro: Comp Analysis',
      result: passed ? 'Pass' : 'Fail',
      avgArvPct: avgScore.toFixed(1),
      avgRenoPct: '0',
      grades: [],
    };
    postToAppsScript(payload);
  }

  // Post diploma completion to Slack via Apps Script
  var STORAGE_SLACK_POSTED = 'rebuilt_arv_slack_posted';

  function postDiplomaToSlack() {
    // Only post once per user
    try { if (localStorage.getItem(STORAGE_SLACK_POSTED) === 'true') return; } catch (_) {}
    if (!SHEETS_URL || SHEETS_URL === 'DEPLOY_URL_PLACEHOLDER') return;

    var email = getEmail() || '';
    var name = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, function (l) { return l.toUpperCase(); });

    try {
      postToAppsScript({ action: 'slackDiploma', name: name, email: email });
      localStorage.setItem(STORAGE_SLACK_POSTED, 'true');
    } catch (_) { /* silent fail */ }
  }

  // ---------------------------------------------------------------------------
  // Screen: Sign In
  // ---------------------------------------------------------------------------

  function renderSignIn() {
    var app = clearApp();

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
        // If this user already has local progress, go straight through
        if (isPresentationDone()) {
          if (isCompAnalysisDone()) { renderDashboard(); } else { renderCompIntro(); }
          return;
        }
        // Check Google Sheet for prior history to let returning users skip
        submitBtn.textContent = 'Checking...';
        submitBtn.disabled = true;
        fetchHistory(function (data) {
          var rows = (data && data.rows) || [];
          var userRows = rows.filter(function (r) {
            return r.Email && r.Email.toLowerCase() === email.toLowerCase();
          });
          if (userRows.length > 0) {
            // Returning user — restore progress from sheet
            setPresentationDone();
            setCompAnalysisDone();
            var attemptedModules = [];
            userRows.forEach(function (r) {
              if (r.Module && r.Module.indexOf('Module') === 0) {
                var num = parseInt(r.Module.replace('Module ', ''), 10);
                if (!isNaN(num) && attemptedModules.indexOf(num) === -1) {
                  attemptedModules.push(num);
                }
              }
            });
            if (attemptedModules.length > 0) {
              saveProgress({ completedModules: attemptedModules });
            }
            loadProperties().then(function () { renderDashboard(); }).catch(function () { renderDashboard(); });
          } else {
            // Brand-new user
            renderPresentation();
          }
        });
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
            if (isCompAnalysisDone()) { renderDashboard(); } else { renderCompIntro(); }
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
        else { setPresentationDone(); if (isCompAnalysisDone()) { renderDashboard(); } else { renderCompIntro(); } document.removeEventListener('keydown', onKey); }
      } else if (e.key === 'ArrowLeft' && slideIdx > 0) {
        slideIdx--; renderSlide();
      }
    }
    document.addEventListener('keydown', onKey);
    renderSlide();
  }

  // ---------------------------------------------------------------------------
  // Screen: Comp Analysis Intro
  // ---------------------------------------------------------------------------

  function renderCompIntro() {
    var app = clearApp();

    var screen = el('div', { className: 'screen comp-intro-screen' });

    screen.appendChild(el('div', { className: 'comp-intro-icon' }, '\uD83D\uDD0D'));
    screen.appendChild(el('h1', null, 'Comp Analysis Training'));
    screen.appendChild(el('p', { className: 'comp-intro-desc' },
      'Before you start estimating ARVs, you need to master comp selection. ' +
      'You\u2019ll review subject properties and evaluate potential comparables using the 4-3-2-1 Rule.'
    ));

    var rules = el('div', { className: 'comp-rules-recap' });
    rules.appendChild(el('h3', null, 'The 4-3-2-1 Rule'));
    var grid = el('div', { className: 'comp-rules-grid' });
    [
      { big: '4', label: 'Months', desc: 'Sales from last 4 months only' },
      { big: '3', label: 'Blocks', desc: 'Same subdivision or \u00BD-mile radius' },
      { big: '20%', label: 'Variance', desc: 'Within 20% of subject sq ft' },
      { big: '1', label: 'Style', desc: 'Match architectural style' },
    ].forEach(function (r) {
      grid.appendChild(el('div', { className: 'comp-rule-item' },
        el('span', { className: 'comp-rule-big' }, r.big),
        el('span', { className: 'comp-rule-label' }, r.label),
        el('span', { className: 'comp-rule-desc' }, r.desc)
      ));
    });
    rules.appendChild(grid);
    screen.appendChild(rules);

    screen.appendChild(el('p', { className: 'comp-intro-instruction' },
      'For each potential comp, check all reasons it is NOT a good comparable. ' +
      'If it IS a good comp, leave all boxes unchecked and click \u201CGood Comp.\u201D'
    ));

    screen.appendChild(el('button', {
      className: 'btn-primary btn-large',
      onClick: function () {
        compScenarioIndex = 0;
        compQuestionIndex = 0;
        compResults = [];
        compCurrentComps = [];
        renderCompScenario();
      }
    }, 'Start Comp Analysis \u2192'));

    if (isCompAnalysisDone()) {
      screen.appendChild(el('button', {
        className: 'btn-secondary',
        style: { marginTop: '0.5rem' },
        onClick: renderDashboard,
      }, '\u2190 Back to Dashboard'));
    }

    app.appendChild(screen);
  }

  // ---------------------------------------------------------------------------
  // Comp Analysis: Card Builders
  // ---------------------------------------------------------------------------

  function buildSubjectCard(subject) {
    var card = el('div', { className: 'comp-subject-card' });
    card.appendChild(el('div', { className: 'comp-card-badge' }, 'SUBJECT PROPERTY'));
    card.appendChild(el('h2', { className: 'comp-card-address' }, subject.address));
    var stats = el('div', { className: 'property-stats' });
    var lotDisplay = '\u2014';
    if (subject.lotSqft) {
      lotDisplay = subject.lotSqft >= 43560
        ? (subject.lotSqft / 43560).toFixed(2) + ' ac'
        : Math.round(subject.lotSqft).toLocaleString() + ' sqft';
    }
    [
      ['Beds', subject.beds], ['Baths', subject.baths],
      ['Sqft', subject.sqft ? subject.sqft.toLocaleString() : '\u2014'],
      ['Year', subject.yearBuilt || '\u2014'], ['Type', subject.houseType],
      ['Lot', lotDisplay],
      ['Garage', subject.hasGarage ? 'Yes' : 'No'],
      ['Basement', subject.hasBasement ? 'Yes' : 'No'],
    ].forEach(function (pair) {
      stats.appendChild(el('div', { className: 'stat-item' },
        el('span', { className: 'stat-label' }, pair[0]),
        el('span', { className: 'stat-value' }, String(pair[1]))
      ));
    });
    card.appendChild(stats);
    return card;
  }

  function buildCompCard(comp) {
    var card = el('div', { className: 'comp-potential-card' });
    card.appendChild(el('div', { className: 'comp-card-badge comp-badge-potential' }, 'POTENTIAL COMP'));
    card.appendChild(el('h2', { className: 'comp-card-address' }, comp.address));
    var stats = el('div', { className: 'property-stats' });
    var lotDisplay = '\u2014';
    if (comp.lotSqft) {
      lotDisplay = comp.lotSqft >= 43560
        ? (comp.lotSqft / 43560).toFixed(2) + ' ac'
        : Math.round(comp.lotSqft).toLocaleString() + ' sqft';
    }
    [
      ['Beds', comp.beds], ['Baths', comp.baths],
      ['Sqft', comp.sqft ? comp.sqft.toLocaleString() : '\u2014'],
      ['Year', comp.yearBuilt || '\u2014'], ['Type', comp.houseType],
      ['Lot', lotDisplay],
      ['Garage', comp.hasGarage ? 'Yes' : 'No'],
      ['Basement', comp.hasBasement ? 'Yes' : 'No'],
    ].forEach(function (pair) {
      stats.appendChild(el('div', { className: 'stat-item' },
        el('span', { className: 'stat-label' }, pair[0]),
        el('span', { className: 'stat-value' }, String(pair[1]))
      ));
    });
    card.appendChild(stats);

    var saleInfo = el('div', { className: 'comp-sale-info' });
    if (comp.status === 'Active') {
      saleInfo.appendChild(el('span', { className: 'comp-active-badge' }, 'ACTIVE LISTING'));
      saleInfo.appendChild(el('span', null, 'List: ' + formatDollars(comp.soldPrice)));
    } else if (comp.soldDate) {
      saleInfo.appendChild(el('span', null, 'Sold: ' + comp.soldDate + ' for ' + formatDollars(comp.soldPrice)));
    }
    saleInfo.appendChild(el('span', null, comp.distance + ' mi away'));
    card.appendChild(saleInfo);
    return card;
  }

  // ---------------------------------------------------------------------------
  // Screen: Comp Analysis Scenario (one comp at a time)
  // ---------------------------------------------------------------------------

  function renderCompScenario() {
    var app = clearApp();

    var scenario = COMP_SCENARIOS[compScenarioIndex];
    var comp = scenario.comps[compQuestionIndex];
    var screen = el('div', { className: 'screen comp-scenario-screen' });

    screen.appendChild(el('div', { className: 'score-tracker' },
      el('span', null, 'Scenario ' + (compScenarioIndex + 1) + '/' + COMP_SCENARIOS_REQUIRED),
      el('span', null, 'Comp ' + (compQuestionIndex + 1) + '/' + scenario.comps.length)
    ));

    var pct = (compQuestionIndex / scenario.comps.length) * 100;
    var bar = el('div', { className: 'progress-bar' });
    bar.appendChild(el('div', { className: 'progress-fill', style: { width: pct + '%' } }));
    screen.appendChild(bar);

    var cardsRow = el('div', { className: 'comp-cards-row' });
    cardsRow.appendChild(buildSubjectCard(scenario.subject));
    cardsRow.appendChild(el('div', { className: 'comp-vs-divider' }, el('span', null, 'vs')));
    cardsRow.appendChild(buildCompCard(comp));
    screen.appendChild(cardsRow);

    var form = el('div', { className: 'comp-issues-form' });
    form.appendChild(el('h3', null, 'What\u2019s wrong with this comp?'));
    form.appendChild(el('p', { className: 'comp-issues-hint' },
      'Check all issues that apply, or mark as Good Comp if none.'));

    var selectedIssues = {};
    var goodCompSelected = false;
    var goodCompBtn = null;
    var checkboxes = [];

    COMP_ISSUES.forEach(function (issue) {
      var checkbox = el('input', { type: 'checkbox', id: 'issue-' + issue.id });
      var lbl = el('label', { className: 'comp-checkbox-label', for: 'issue-' + issue.id },
        checkbox,
        el('span', { className: 'comp-checkbox-text' }, issue.label)
      );
      checkbox.addEventListener('change', function () {
        selectedIssues[issue.id] = checkbox.checked;
        if (checkbox.checked && goodCompSelected) {
          goodCompSelected = false;
          goodCompBtn.classList.remove('comp-good-selected');
        }
      });
      checkboxes.push(checkbox);
      form.appendChild(lbl);
    });

    goodCompBtn = el('button', {
      type: 'button',
      className: 'comp-good-btn',
      onClick: function () {
        goodCompSelected = !goodCompSelected;
        goodCompBtn.classList.toggle('comp-good-selected', goodCompSelected);
        if (goodCompSelected) {
          checkboxes.forEach(function (cb) { cb.checked = false; });
          selectedIssues = {};
        }
      },
    }, '\u2705 Good Comp \u2014 No Issues');
    form.appendChild(goodCompBtn);

    // Admin answer highlighting
    if (isAdmin()) {
      var correctIssueIds = comp.issues;
      var isGood = correctIssueIds.length === 0;
      var adminBanner = el('div', { className: 'admin-answer-banner' },
        el('span', { className: 'admin-answer-icon' }, '\uD83D\uDD11'),
        el('span', null, 'Admin View \u2014 Correct answer highlighted')
      );
      form.insertBefore(adminBanner, checkboxes[0].parentNode);
      COMP_ISSUES.forEach(function (issue, idx) {
        var label = checkboxes[idx].parentNode;
        if (correctIssueIds.indexOf(issue.id) !== -1) {
          label.classList.add('admin-highlight-correct');
        }
      });
      if (isGood) {
        goodCompBtn.classList.add('admin-highlight-good');
      }
    }

    var errorMsg = el('p', { className: 'comp-error', style: { display: 'none' } },
      'Please select at least one issue or mark as Good Comp.');
    form.appendChild(errorMsg);

    var isLast = compQuestionIndex >= scenario.comps.length - 1;
    form.appendChild(el('button', {
      className: 'btn-primary',
      onClick: handleCompSubmit,
    }, isLast ? 'See Results' : 'Next Comp \u2192'));

    screen.appendChild(form);
    app.appendChild(screen);

    var compSubmitted = false;
    function handleCompSubmit() {
      if (compSubmitted) return;
      var checkedIds = Object.keys(selectedIssues).filter(function (k) { return selectedIssues[k]; });
      if (checkedIds.length === 0 && !goodCompSelected) {
        errorMsg.style.display = 'block';
        return;
      }

      compSubmitted = true;
      var userIssues = goodCompSelected ? [] : checkedIds;
      var correctIssues = comp.issues;
      var allIssueIds = COMP_ISSUES.map(function (i) { return i.id; });
      var correct = 0;
      var total = allIssueIds.length + 1;

      var isGoodComp = correctIssues.length === 0;
      if (isGoodComp === goodCompSelected) correct++;

      allIssueIds.forEach(function (id) {
        var userChecked = userIssues.indexOf(id) !== -1;
        var shouldBeChecked = correctIssues.indexOf(id) !== -1;
        if (userChecked === shouldBeChecked) correct++;
      });

      compCurrentComps.push({
        comp: comp,
        userIssues: userIssues,
        goodCompSelected: goodCompSelected,
        correct: correct,
        total: total,
        score: (correct / total) * 100,
      });

      if (isLast) {
        renderCompScenarioResults();
      } else {
        compQuestionIndex++;
        renderCompScenario();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Screen: Comp Scenario Results
  // ---------------------------------------------------------------------------

  function renderCompScenarioResults() {
    var app = clearApp();

    var screen = el('div', { className: 'screen comp-results-screen' });

    var totalCorrect = 0;
    var totalPossible = 0;
    compCurrentComps.forEach(function (r) {
      totalCorrect += r.correct;
      totalPossible += r.total;
    });
    var scenarioScore = (totalCorrect / totalPossible) * 100;
    var passed = scenarioScore >= COMP_PASS_THRESHOLD;

    screen.appendChild(el('h1', null, 'Scenario ' + (compScenarioIndex + 1) + ' Results'));
    screen.appendChild(el('div', { className: 'module-badge ' + (passed ? 'badge-pass' : 'badge-fail') },
      passed ? '\u2705' : '\u274C'
    ));
    screen.appendChild(el('h2', { className: 'module-verdict ' + (passed ? 'text-good' : 'text-bad') },
      scenarioScore.toFixed(0) + '% Correct' + (passed ? ' \u2014 Passed!' : ' \u2014 Needs Work')
    ));

    screen.appendChild(el('h3', { style: { textAlign: 'left', margin: '1.5rem 0 .75rem' } }, 'Comp Breakdown'));
    compCurrentComps.forEach(function (r) {
      var compDiv = el('div', { className: 'comp-result-item ' + (r.score >= 80 ? 'comp-result-good' : 'comp-result-bad') });
      compDiv.appendChild(el('div', { className: 'comp-result-header' },
        el('strong', null, r.comp.address),
        el('span', { className: r.score >= 80 ? 'text-good' : 'text-bad' }, r.score.toFixed(0) + '%')
      ));

      var isGoodComp = r.comp.issues.length === 0;
      if (isGoodComp) {
        compDiv.appendChild(el('p', { className: 'comp-result-answer ' + (r.goodCompSelected ? 'text-good' : 'text-bad') },
          r.goodCompSelected ? '\u2713 Correctly identified as good comp' : '\u2717 This was actually a good comp'
        ));
      } else {
        if (r.goodCompSelected) {
          compDiv.appendChild(el('p', { className: 'comp-result-answer text-bad' },
            '\u2717 You marked this as a good comp, but it has issues:'
          ));
        }
        var issueList = el('div', { className: 'comp-result-issues' });
        COMP_ISSUES.forEach(function (issue) {
          var shouldCheck = r.comp.issues.indexOf(issue.id) !== -1;
          var didCheck = r.userIssues.indexOf(issue.id) !== -1;
          if (shouldCheck || didCheck) {
            var icon, explain;
            if (shouldCheck && didCheck) { icon = '\u2705'; explain = 'Correct'; }
            else if (!shouldCheck && didCheck) { icon = '\u274C'; explain = 'Not actually an issue'; }
            else { icon = '\u26A0\uFE0F'; explain = 'Missed this issue'; }
            issueList.appendChild(el('div', { className: 'comp-result-issue' },
              el('span', null, icon + ' ' + issue.label),
              el('span', { className: 'comp-result-explain' }, explain)
            ));
          }
        });
        compDiv.appendChild(issueList);
      }
      screen.appendChild(compDiv);
    });

    compResults.push({
      scenarioIndex: compScenarioIndex,
      score: scenarioScore,
      passed: passed,
    });

    var allDone = compScenarioIndex + 1 >= COMP_SCENARIOS_REQUIRED;
    var btnRow = el('div', { className: 'btn-row' });
    if (allDone) {
      btnRow.appendChild(el('button', {
        className: 'btn-primary',
        onClick: renderCompSummary,
      }, 'View Final Results'));
    } else {
      btnRow.appendChild(el('button', {
        className: 'btn-primary',
        onClick: function () {
          compScenarioIndex++;
          compQuestionIndex = 0;
          compCurrentComps = [];
          renderCompScenario();
        },
      }, 'Next Scenario \u2192'));
    }
    screen.appendChild(btnRow);
    app.appendChild(screen);
  }

  // ---------------------------------------------------------------------------
  // Screen: Comp Analysis Summary (pass/fail)
  // ---------------------------------------------------------------------------

  function renderCompSummary() {
    var app = clearApp();

    var screen = el('div', { className: 'screen comp-summary-screen' });

    var totalScore = 0;
    compResults.forEach(function (r) { totalScore += r.score; });
    var avgScore = totalScore / compResults.length;
    var overallPassed = avgScore >= COMP_PASS_THRESHOLD;

    screen.appendChild(el('h1', null, 'Comp Analysis Complete'));
    screen.appendChild(el('div', { className: 'module-badge ' + (overallPassed ? 'badge-pass' : 'badge-fail') },
      overallPassed ? '\uD83C\uDF93' : '\uD83D\uDCDA'
    ));
    screen.appendChild(el('h2', { className: 'module-verdict ' + (overallPassed ? 'text-good' : 'text-bad') },
      overallPassed ? 'You Passed! ARV Modules Unlocked' : 'Not Quite \u2014 Review the 4-3-2-1 Rule'
    ));
    screen.appendChild(el('p', { style: { textAlign: 'center', color: '#64748B', marginBottom: '1rem' } },
      'Average Score: ' + avgScore.toFixed(0) + '% (Need ' + COMP_PASS_THRESHOLD + '% to pass)'
    ));

    // Breakdown table using existing classes
    var table = el('div', { className: 'history-table' });
    var header = el('div', { className: 'history-row history-header', style: { gridTemplateColumns: '1fr 1fr 1fr' } });
    ['Scenario', 'Score', 'Result'].forEach(function (h) {
      header.appendChild(el('div', { className: 'history-cell' }, h));
    });
    table.appendChild(header);
    compResults.forEach(function (r, i) {
      var row = el('div', { className: 'history-row', style: { gridTemplateColumns: '1fr 1fr 1fr' } });
      row.appendChild(el('div', { className: 'history-cell' }, 'Scenario ' + (i + 1)));
      row.appendChild(el('div', { className: 'history-cell ' + (r.passed ? 'text-good' : 'text-bad') }, r.score.toFixed(0) + '%'));
      row.appendChild(el('div', { className: 'history-cell ' + (r.passed ? 'text-good' : 'text-bad') },
        (r.passed ? '\u2713 Pass' : '\u2717 Fail')));
      table.appendChild(row);
    });
    screen.appendChild(table);

    logCompToSheets(overallPassed, avgScore);

    if (overallPassed) {
      setCompAnalysisDone();
      screen.appendChild(el('button', {
        className: 'btn-primary btn-large',
        style: { marginTop: '1.5rem' },
        onClick: renderDashboard,
      }, 'Continue to ARV Modules \u2192'));
    } else {
      var btnRow = el('div', { className: 'btn-row' });
      btnRow.appendChild(el('button', {
        className: 'btn-primary',
        onClick: renderCompIntro,
      }, '\uD83D\uDD01 Try Again'));
      btnRow.appendChild(el('button', {
        className: 'btn-secondary',
        onClick: renderPresentation,
      }, '\uD83C\uDF93 Review Training Slides'));
      screen.appendChild(btnRow);
    }

    app.appendChild(screen);
  }

  // ---------------------------------------------------------------------------
  // Screen: Dashboard (Module Select + Progress)
  // ---------------------------------------------------------------------------

  function renderDashboard() {
    var app = clearApp();

    var screen = el('div', { className: 'screen dashboard-screen' });

    var progress = getProgress();
    var completed = progress.completedModules;
    var level = completed.length;
    var info = LEVELS[Math.min(level, LEVELS.length - 1)];
    var grades = getModuleGrades();

    // Check if test out modules (5-8 = indices 4-7) are all passed
    var TESTOUT_INDICES = [4, 5, 6, 7];
    var testOutPassed = TESTOUT_INDICES.every(function (idx) {
      return completed.indexOf(idx) !== -1;
    });
    if (testOutPassed) {
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

    // --- PRACTICE SECTION ---
    var practiceSection = el('div', { className: 'dash-section dash-section-practice-wrap' });
    practiceSection.appendChild(el('h2', { className: 'dash-section-title dash-section-practice' }, '\uD83D\uDCDD Practice'));
    practiceSection.appendChild(el('p', { className: 'dash-section-desc' }, 'Build your skills with guided practice modules. Grades are tracked but not required to advance.'));

    var practiceGrid = el('div', { className: 'dash-modules' });

    // Intro: Comp Analysis card (always complete at this point)
    var compCard = el('div', {
      className: 'dash-module-card mod-complete comp-intro-card',
    });
    compCard.style.cursor = 'pointer';
    compCard.addEventListener('click', function () { renderCompIntro(); });
    compCard.appendChild(el('div', { className: 'mod-icon' }, '\uD83D\uDD0D'));
    compCard.appendChild(el('div', { className: 'mod-number' }, 'Intro'));
    compCard.appendChild(el('div', { className: 'mod-questions' }, 'Comp Analysis'));
    compCard.appendChild(el('div', { className: 'mod-status mod-status-pass' }, '\u2713 Passed'));
    practiceGrid.appendChild(compCard);

    // Helper to build a module card
    function buildModuleCard(moduleIdx) {
      var isCompleted = completed.indexOf(moduleIdx) !== -1;
      var gradeData = grades[String(moduleIdx)];
      var isPractice = moduleIdx < PRACTICE_MODULE_COUNT;

      var card = el('div', {
        className: 'dash-module-card' +
          (isCompleted ? ' mod-complete' : '') +
          (isPractice ? ' mod-practice' : ' mod-testout'),
      });
      card.style.cursor = 'pointer';
      card.addEventListener('click', function () { startModule(moduleIdx); });

      var icon = isCompleted ? '\u2705' : '\uD83D\uDCCB';
      card.appendChild(el('div', { className: 'mod-icon' }, icon));
      card.appendChild(el('div', { className: 'mod-number' }, (isPractice ? 'Practice ' : 'Test ') + (isPractice ? (moduleIdx + 1) : (moduleIdx - PRACTICE_MODULE_COUNT + 1))));
      card.appendChild(el('div', { className: 'mod-questions' }, getModuleQuestionCount(moduleIdx) + ' properties'));

      if (gradeData) {
        var gradeEl = el('div', { className: 'mod-grade' },
          el('span', { className: 'grade-badge ' + gradeClass(gradeData.overallGrade) }, gradeData.overallGrade),
          el('span', { className: 'mod-grade-detail' }, 'ARV: ' + gradeData.arvPct + '% | Reno: ' + gradeData.renoPct + '%')
        );
        card.appendChild(gradeEl);
        card.appendChild(el('div', { className: 'mod-status mod-status-retake' }, '\uD83D\uDD01 Retake'));
      } else {
        card.appendChild(el('div', { className: 'mod-status mod-status-ready' }, 'Ready'));
      }

      return card;
    }

    // Practice modules (0-3)
    for (var m = 0; m < PRACTICE_MODULE_COUNT; m++) {
      practiceGrid.appendChild(buildModuleCard(m));
    }
    practiceSection.appendChild(practiceGrid);
    screen.appendChild(practiceSection);

    // --- TEST OUT SECTION ---
    var testSection = el('div', { className: 'dash-section dash-section-testout-wrap' });
    testSection.appendChild(el('h2', { className: 'dash-section-title dash-section-testout' }, '\uD83C\uDFAF Test Out'));
    testSection.appendChild(el('p', { className: 'dash-section-desc' }, 'Prove your skills. These modules count toward your final certification.'));

    var testGrid = el('div', { className: 'dash-modules' });
    for (var t = PRACTICE_MODULE_COUNT; t < MODULES_COUNT; t++) {
      testGrid.appendChild(buildModuleCard(t));
    }
    testSection.appendChild(testGrid);
    screen.appendChild(testSection);

    // Grading note
    screen.appendChild(el('div', { className: 'dash-criteria' },
      el('p', null, '\uD83C\uDFAF Grading: ARV accuracy within ' + ARV_PASS_THRESHOLD + '% and Rehab within ' + RENO_PASS_THRESHOLD + '% earns a passing grade. You can retake any module to improve your score.')
    ));

    // Context buttons (History, Leaders, View Training)
    var dashActions = el('div', { className: 'dash-actions' });
    if (getEmail()) {
      dashActions.appendChild(el('button', {
        className: 'btn-secondary btn-small',
        onClick: function () { renderHistory(); }
      }, '\uD83D\uDCCA History'));
      dashActions.appendChild(el('button', {
        className: 'btn-secondary btn-small',
        onClick: function () { renderLeaderboard(); }
      }, '\uD83C\uDFC6 Leaders'));
    }
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

      if (moduleProperties.length === 0) {
        renderError('No properties available for this module.');
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
    var isPractice = currentModuleIndex < PRACTICE_MODULE_COUNT;
    var moduleLabel = isPractice ? 'Practice ' + (currentModuleIndex + 1) : 'Test ' + (currentModuleIndex - PRACTICE_MODULE_COUNT + 1);

    return el('div', { className: 'score-tracker' },
      el('span', null, moduleLabel + ' \u2022 Question ' + (currentQuestionIndex + 1) + '/' + moduleProperties.length),
      el('span', null, 'Avg ARV: ' + avgArv + '% off'),
      el('span', null, 'Avg Reno: ' + avgReno + '% off')
    );
  }

  function buildModuleProgress() {
    var pct = (currentQuestionIndex / moduleProperties.length) * 100;
    var bar = el('div', { className: 'progress-bar' });
    bar.appendChild(el('div', { className: 'progress-fill', style: { width: pct + '%' } }));
    return bar;
  }

  // ---------------------------------------------------------------------------
  // Screen: Quiz Question (with carousel + thumbnails)
  // ---------------------------------------------------------------------------

  function renderQuizQuestion() {
    var app = clearApp();

    var prop = moduleProperties[currentQuestionIndex];
    // Snapshot property data to prevent any mutation issues
    var propSnapshot = JSON.parse(JSON.stringify(prop));
    var screen = el('div', { className: 'screen quiz-screen' });

    screen.appendChild(buildModuleTracker());
    screen.appendChild(buildModuleProgress());

    // --- 10-minute countdown timer ---
    var timeRemaining = QUESTION_TIME_LIMIT;
    var timerEl = el('div', { className: 'question-timer' },
      el('span', { className: 'timer-icon' }, '\u23F1'),
      el('span', { className: 'timer-text' }, formatTime(timeRemaining))
    );
    screen.appendChild(timerEl);

    var timerInterval = setInterval(function () {
      timeRemaining--;
      var timerText = timerEl.querySelector('.timer-text');
      if (timerText) timerText.textContent = formatTime(timeRemaining);
      if (timeRemaining <= 60) {
        timerEl.classList.add('timer-warning');
      }
      if (timeRemaining <= 0) {
        clearInterval(timerInterval);
        // Auto-submit with whatever is currently entered
        handleSubmit(true);
      }
    }, 1000);

    function formatTime(seconds) {
      var m = Math.floor(seconds / 60);
      var s = seconds % 60;
      return m + ':' + (s < 10 ? '0' : '') + s;
    }

    var card = el('div', { className: 'property-card' });

    // --- Photo carousel with thumbnails ---
    var rawImages = (propSnapshot.imageUrls && propSnapshot.imageUrls.length > 0)
      ? propSnapshot.imageUrls
      : [propSnapshot.thumbnailUrl || PLACEHOLDER_IMG];
    var images = rawImages.map(fixImageUrl);
    var carouselIdx = 0;

    var carousel = el('div', { className: 'carousel' });
    var carouselImg = el('img', {
      className: 'carousel-image',
      src: images[0] || PLACEHOLDER_IMG,
      alt: propSnapshot.displayAddress || 'Property photo',
      referrerpolicy: 'no-referrer',
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
    card.appendChild(el('h2', { className: 'property-address' }, propSnapshot.displayAddress || 'Address unavailable'));

    // Stats grid (NO list price)
    var stats = el('div', { className: 'property-stats' });
    var lotDisplay = '\u2014';
    if (propSnapshot.lotSize) {
      if (propSnapshot.lotSize >= 43560) {
        lotDisplay = (propSnapshot.lotSize / 43560).toFixed(2) + ' ac';
      } else {
        lotDisplay = Math.round(propSnapshot.lotSize).toLocaleString() + ' sqft';
      }
    }
    var statItems = [
      ['Beds', propSnapshot.beds || '\u2014'],
      ['Baths', propSnapshot.baths || '\u2014'],
      ['Sqft', propSnapshot.livingArea ? propSnapshot.livingArea.toLocaleString() : '\u2014'],
      ['Year Built', propSnapshot.yearBuilt || '\u2014'],
      ['Type', propSnapshot.houseType || '\u2014'],
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
    var addr = propSnapshot.displayAddress || '';
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
      arvChoices = generateArvChoices(propSnapshot.estimatedArv);
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

    // Admin answer hints
    if (isAdmin()) {
      var correctArvText = '$' + propSnapshot.estimatedArv.toLocaleString();
      var correctRenoText = '$' + propSnapshot.estimatedRenovation.toLocaleString();
      if (arvIsGraded) correctArvText += ' (Grade ' + arvChoices.correctGrade + ')';
      if (renoIsGraded) correctRenoText += ' (Grade ' + getCorrectGrade(propSnapshot.estimatedRenovation, RENO_GRADE_RANGES) + ')';
      var adminBanner = el('div', { className: 'admin-answer-banner' },
        el('span', { className: 'admin-answer-icon' }, '\uD83D\uDD11'),
        el('span', null, 'Admin \u2014 ARV: ' + correctArvText + '  |  Reno: ' + correctRenoText)
      );
      form.insertBefore(adminBanner, form.firstChild);

      // Highlight correct grade buttons for graded modes
      if (arvIsGraded) {
        var arvBtns = form.querySelectorAll('.grade-selector-group:first-child .grade-option');
        arvBtns.forEach(function (btn) {
          var letterEl = btn.querySelector('.grade-option-letter');
          if (letterEl && letterEl.textContent.trim() === arvChoices.correctGrade) {
            btn.classList.add('admin-highlight-correct');
          }
        });
      }
      if (renoIsGraded) {
        var correctRenoGradeVal = getCorrectGrade(propSnapshot.estimatedRenovation, RENO_GRADE_RANGES);
        var renoGroups = form.querySelectorAll('.grade-selector-group');
        var renoGroup = renoGroups[renoGroups.length - 1];
        renoGroup.querySelectorAll('.grade-option').forEach(function (btn) {
          var letterEl = btn.querySelector('.grade-option-letter');
          if (letterEl && letterEl.textContent.trim() === correctRenoGradeVal) {
            btn.classList.add('admin-highlight-correct');
          }
        });
      }
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

    function handleSubmit(autoSubmit) {
      if (submitted) return;

      var userArv = null, userReno = null;
      var userArvGrade = null, userRenoGrade = null;
      var correctArvGrade = null, correctRenoGrade = null;
      var arvPct, renoPct;

      // --- ARV ---
      if (arvIsGraded) {
        if (!selectedArvChoice) {
          if (autoSubmit) {
            // Pick worst possible answer on timeout
            userArvGrade = 'F';
            userArv = 0;
            correctArvGrade = arvChoices.correctGrade;
            arvPct = 100;
          } else {
            gradeError.style.display = 'block'; return;
          }
        } else {
          userArvGrade = selectedArvChoice.grade;
          userArv = selectedArvChoice.value;
          correctArvGrade = arvChoices.correctGrade;
          arvPct = pctDiff(userArv, propSnapshot.estimatedArv);
        }
      } else {
        userArv = parseDollarInput(arvInput.value);
        if (isNaN(userArv) || userArv <= 0) {
          if (autoSubmit) { userArv = 0; arvPct = 100; }
          else { arvInput.classList.add('input-error'); arvInput.focus(); return; }
        } else {
          arvPct = pctDiff(userArv, propSnapshot.estimatedArv);
        }
      }

      // --- Reno ---
      if (renoIsGraded) {
        if (!selectedRenoGrade) {
          if (autoSubmit) {
            userRenoGrade = 'F';
            correctRenoGrade = getCorrectGrade(propSnapshot.estimatedRenovation, RENO_GRADE_RANGES);
            renoPct = 65;
          } else {
            gradeError.style.display = 'block'; return;
          }
        } else {
          userRenoGrade = selectedRenoGrade;
          correctRenoGrade = getCorrectGrade(propSnapshot.estimatedRenovation, RENO_GRADE_RANGES);
          renoPct = gradeDiffPct(userRenoGrade, correctRenoGrade);
        }
      } else {
        userReno = parseDollarInput(renoInput.value);
        if (isNaN(userReno) || userReno <= 0) {
          if (autoSubmit) { userReno = 0; renoPct = 100; }
          else { renoInput.classList.add('input-error'); renoInput.focus(); return; }
        } else {
          renoPct = pctDiff(userReno, propSnapshot.estimatedRenovation);
        }
      }

      submitted = true;
      clearInterval(timerInterval);
      document.removeEventListener('keydown', onKeyDown);

      var arvGrade = letterGrade(arvPct);
      var renoGrade = letterGrade(renoPct);

      runningArvPctSum += arvPct;
      runningRenoPctSum += renoPct;

      var result = {
        property: propSnapshot,
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
        timedOut: !!autoSubmit,
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

    var isLast = currentQuestionIndex + 1 >= moduleProperties.length;
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

    var screen = el('div', { className: 'screen module-summary-screen' });

    var avgArvPct = runningArvPctSum / moduleResults.length;
    var avgRenoPct = runningRenoPctSum / moduleResults.length;
    var arvPassed = avgArvPct <= ARV_PASS_THRESHOLD;
    var renoPassed = avgRenoPct <= RENO_PASS_THRESHOLD;
    var modulePassed = arvPassed && renoPassed;
    var overallAvg = (avgArvPct + avgRenoPct) / 2;
    var overallGrade = letterGrade(overallAvg);
    var isPractice = currentModuleIndex < PRACTICE_MODULE_COUNT;
    var moduleLabel = isPractice ? 'Practice ' + (currentModuleIndex + 1) : 'Test ' + (currentModuleIndex - PRACTICE_MODULE_COUNT + 1);

    screen.appendChild(el('h1', null, moduleLabel + ' Results'));

    // Big grade badge
    var badge = el('div', { className: 'module-badge badge-grade ' + gradeClass(overallGrade) },
      overallGrade
    );
    screen.appendChild(badge);
    screen.appendChild(el('h2', { className: 'module-verdict' },
      'Overall Grade: ' + overallGrade + (modulePassed ? ' \u2014 Passing!' : '')
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

    // Always save grade and mark module as completed (attempted)
    saveModuleGrade(currentModuleIndex, avgArvPct, avgRenoPct);
    var progress = getProgress();
    if (progress.completedModules.indexOf(currentModuleIndex) === -1) {
      progress.completedModules.push(currentModuleIndex);
      progress.completedModules.sort(function (a, b) { return a - b; });
      saveProgress(progress);
    }

    // Buttons - always show retake and continue
    var btnRow = el('div', { className: 'btn-row' });
    btnRow.appendChild(el('button', {
      className: 'btn-secondary',
      onClick: function () { startModule(currentModuleIndex); }
    }, '\uD83D\uDD01 Retake Module'));
    btnRow.appendChild(el('button', {
      className: 'btn-primary',
      onClick: renderDashboard
    }, 'Continue \u2192'));
    screen.appendChild(btnRow);

    app.appendChild(screen);

  }

  // ---------------------------------------------------------------------------
  // Screen: Diploma (all modules complete)
  // ---------------------------------------------------------------------------

  function renderDiploma() {
    var app = clearApp();

    var screen = el('div', { className: 'screen diploma-screen' });

    // Post to Slack (once)
    postDiplomaToSlack();

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
        el('p', { className: 'diploma-achievement' }, 'has successfully passed the Test Out modules of the'),
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
      el('p', { className: 'diploma-instruction' }, '\uD83C\uDF89 Your achievement has been posted to #praisewall!'),
      el('p', { className: 'diploma-subtext' }, 'The team knows you\u2019re a certified ARV Pro.')
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
        try { localStorage.removeItem(STORAGE_COMP_DONE); } catch (_) {}
        try { localStorage.removeItem(STORAGE_SLACK_POSTED); } catch (_) {}
        try { localStorage.removeItem(STORAGE_GRADES); } catch (_) {}
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
    activeSection = 'history';
    renderNav();
    var app = clearApp();

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
  // User Variance Chart (modal)
  // ---------------------------------------------------------------------------

  function showUserVarianceChart(user, allRows) {
    // Filter rows for this user, only Module 1-8
    var email = user.email.toLowerCase().trim();
    var moduleNames = ['Module 1','Module 2','Module 3','Module 4','Module 5','Module 6','Module 7','Module 8'];
    var moduleData = {};
    moduleNames.forEach(function (m) { moduleData[m] = { arvPcts: [], renoPcts: [] }; });

    allRows.forEach(function (row) {
      var rowEmail = (row.Email || '').toLowerCase().trim();
      if (rowEmail !== email) return;
      var mod = row.Module || '';
      if (moduleNames.indexOf(mod) === -1) return;
      var arvPct = parseFloat(row['Avg ARV % Off']);
      var renoPct = parseFloat(row['Avg Reno % Off']);
      if (!isNaN(arvPct)) moduleData[mod].arvPcts.push(arvPct);
      if (!isNaN(renoPct)) moduleData[mod].renoPcts.push(renoPct);
    });

    // Build best (lowest) variance per module for trend
    var arvBest = [];
    var renoBest = [];
    var labels = [];
    moduleNames.forEach(function (m) {
      var d = moduleData[m];
      labels.push(m.replace('Module ', 'M'));
      arvBest.push(d.arvPcts.length > 0 ? Math.min.apply(null, d.arvPcts) : null);
      renoBest.push(d.renoPcts.length > 0 ? Math.min.apply(null, d.renoPcts) : null);
    });

    // Find max value for chart scaling
    var allVals = arvBest.concat(renoBest).filter(function (v) { return v !== null; });
    var maxVal = allVals.length > 0 ? Math.max.apply(null, allVals) : 50;
    maxVal = Math.max(maxVal, 10); // min scale
    maxVal = Math.ceil(maxVal / 5) * 5; // round up to nearest 5

    // Create modal overlay
    var overlay = el('div', {
      style: {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,.5)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem'
      }
    });
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

    var modal = el('div', {
      style: {
        background: '#fff', borderRadius: '12px', padding: '1.5rem',
        maxWidth: '700px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,.3)'
      }
    });

    // Header
    modal.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' } },
      el('h2', { style: { margin: 0, fontSize: '1.2rem' } }, '\uD83D\uDCC8 ' + user.displayName + ' \u2014 Variance Trend'),
      el('button', {
        style: { background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#888' },
        onClick: function () { overlay.remove(); }
      }, '\u2715')
    ));
    modal.appendChild(el('p', { style: { color: '#888', fontSize: '.85rem', marginBottom: '1rem' } },
      'Best (lowest) % off per module. Lower = better accuracy. Trend should go down as they improve.'
    ));

    // Draw chart using canvas
    var chartH = 260;
    var chartW = 620;
    var canvas = el('canvas', { width: chartW * 2, height: chartH * 2, style: { width: chartW + 'px', height: chartH + 'px', display: 'block', margin: '0 auto' } });
    modal.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    ctx.scale(2, 2); // retina
    var padL = 45, padR = 15, padT = 20, padB = 40;
    var gW = chartW - padL - padR;
    var gH = chartH - padT - padB;
    var cols = labels.length;
    var colW = gW / cols;

    // Grid lines
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;
    var gridSteps = 5;
    for (var g = 0; g <= gridSteps; g++) {
      var gy = padT + (gH / gridSteps) * g;
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + gW, gy); ctx.stroke();
      ctx.fillStyle = '#9ca3af'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText((maxVal - (maxVal / gridSteps) * g).toFixed(0) + '%', padL - 5, gy + 3);
    }

    // X labels
    ctx.fillStyle = '#6b7280'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    labels.forEach(function (l, i) {
      ctx.fillText(l, padL + colW * i + colW / 2, chartH - 8);
    });

    // Test Out background band
    ctx.fillStyle = 'rgba(251,191,36,.08)';
    ctx.fillRect(padL + colW * 4, padT, colW * 4, gH);
    ctx.fillStyle = '#b45309'; ctx.font = 'bold 9px sans-serif';
    ctx.fillText('TEST OUT', padL + colW * 6, padT + 12);

    // Helper to draw a line series
    function drawLine(values, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      var started = false;
      values.forEach(function (v, i) {
        if (v === null) { started = false; return; }
        var x = padL + colW * i + colW / 2;
        var y = padT + gH - (v / maxVal) * gH;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else { ctx.lineTo(x, y); }
      });
      ctx.stroke();

      // Dots
      values.forEach(function (v, i) {
        if (v === null) return;
        var x = padL + colW * i + colW / 2;
        var y = padT + gH - (v / maxVal) * gH;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        // Value label
        ctx.fillStyle = color; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(v.toFixed(1) + '%', x, y - 9);
      });
    }

    drawLine(arvBest, '#3b82f6');  // blue for ARV
    drawLine(renoBest, '#f97316'); // orange for Reno

    // Legend
    var legend = el('div', { style: { display: 'flex', justifyContent: 'center', gap: '1.5rem', marginTop: '.75rem', fontSize: '.85rem' } });
    legend.appendChild(el('span', null,
      el('span', { style: { display: 'inline-block', width: '14px', height: '3px', background: '#3b82f6', borderRadius: '2px', marginRight: '6px', verticalAlign: 'middle' } }),
      ' ARV % Off (best attempt)'
    ));
    legend.appendChild(el('span', null,
      el('span', { style: { display: 'inline-block', width: '14px', height: '3px', background: '#f97316', borderRadius: '2px', marginRight: '6px', verticalAlign: 'middle' } }),
      ' Reno % Off (best attempt)'
    ));
    modal.appendChild(legend);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  // ---------------------------------------------------------------------------
  // Screen: Certification Status
  // ---------------------------------------------------------------------------

  function renderCertificationStatus() {
    activeSection = 'certification';
    renderNav();
    var app = clearApp();

    var screen = el('div', { className: 'screen history-screen' });

    screen.appendChild(el('h1', null, '\uD83C\uDF93 ARV Training \u2014 Certification Status'));
    screen.appendChild(el('p', { className: 'history-subtitle' }, 'Pass all four Test Out modules (5\u20138) to earn certification. If passed at least once = Pass.'));

    var tableContainer = el('div', { className: 'history-table-container cert-table-container' });
    tableContainer.appendChild(el('div', { className: 'loading-spinner' }));
    tableContainer.appendChild(el('p', { style: { textAlign: 'center', color: '#888' } }, 'Loading certification data...'));
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

    // All tracked modules: Intro + Module 1-8
    var ALL_MODULES = [
      { key: 'Intro: Comp Analysis', label: 'Intro', testOut: false },
      { key: 'Module 1', label: 'M1', testOut: false },
      { key: 'Module 2', label: 'M2', testOut: false },
      { key: 'Module 3', label: 'M3', testOut: false },
      { key: 'Module 4', label: 'M4', testOut: false },
      { key: 'Module 5', label: 'M5', testOut: true },
      { key: 'Module 6', label: 'M6', testOut: true },
      { key: 'Module 7', label: 'M7', testOut: true },
      { key: 'Module 8', label: 'M8', testOut: true }
    ];
    var TESTOUT_KEYS = ALL_MODULES.filter(function (m) { return m.testOut; }).map(function (m) { return m.key; });
    var ALL_KEYS = ALL_MODULES.map(function (m) { return m.key; });

    // Fetch data and compute certification
    fetchHistory(function (data) {
      tableContainer.innerHTML = '';
      if (!data || !data.rows || data.rows.length === 0) {
        tableContainer.appendChild(el('div', { className: 'history-empty' },
          el('p', null, '\uD83D\uDCED No attempts logged yet.'),
          el('p', { className: 'history-empty-sub' }, 'Complete modules to see certification status.')
        ));
        return;
      }

      // Build per-user, per-module pass map
      var userMap = {};

      data.rows.forEach(function (row) {
        var email = (row.Email || '').toLowerCase().trim();
        var mod = row.Module || '';
        if (!email || ALL_KEYS.indexOf(mod) === -1) return;

        if (!userMap[email]) {
          userMap[email] = { email: row.Email, modules: {} };
          ALL_KEYS.forEach(function (k) { userMap[email].modules[k] = { attempted: false, passed: false }; });
        }
        var u = userMap[email];
        u.modules[mod].attempted = true;
        if (row.Result === 'Pass') u.modules[mod].passed = true;
      });

      // Convert to sorted array
      var users = [];
      for (var email in userMap) {
        var u = userMap[email];
        var certified = true;
        TESTOUT_KEYS.forEach(function (k) {
          if (!u.modules[k].passed) certified = false;
        });
        u.certified = certified;
        u.passedCount = ALL_KEYS.reduce(function (n, k) { return n + (u.modules[k].passed ? 1 : 0); }, 0);
        var name = u.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, function (l) { return l.toUpperCase(); });
        u.displayName = name;
        users.push(u);
      }
      // Sort: most modules completed first, then alphabetical
      users.sort(function (a, b) {
        if (a.passedCount !== b.passedCount) return b.passedCount - a.passedCount;
        return a.displayName.localeCompare(b.displayName);
      });

      if (users.length === 0) {
        tableContainer.appendChild(el('div', { className: 'history-empty' },
          el('p', null, '\uD83D\uDCED No attempts yet.')
        ));
        return;
      }

      // --- Name multi-select filter ---
      var selectedNames = {};
      users.forEach(function (u) { selectedNames[u.email] = true; });

      var filterWrap = el('div', { className: 'cert-filter-wrap' });
      var filterLabel = el('span', { className: 'cert-filter-label' }, 'Filter by name:');
      filterWrap.appendChild(filterLabel);

      var filterBox = el('div', { className: 'cert-filter-box' });
      var filterToggle = el('button', { className: 'cert-filter-toggle' });
      filterToggle.innerHTML = 'All selected <span class="cert-filter-arrow">&#9662;</span>';
      filterBox.appendChild(filterToggle);

      var filterDropdown = el('div', { className: 'cert-filter-dropdown' });

      var filterActions = el('div', { className: 'cert-filter-actions' });
      var selectAllBtn = el('button', { className: 'cert-filter-action-btn' }, 'Select All');
      var clearAllBtn = el('button', { className: 'cert-filter-action-btn' }, 'Clear All');
      filterActions.appendChild(selectAllBtn);
      filterActions.appendChild(clearAllBtn);
      filterDropdown.appendChild(filterActions);

      var filterList = el('div', { className: 'cert-filter-list' });
      users.forEach(function (u) {
        var item = el('label', { className: 'cert-filter-item' });
        var cb = el('input', { type: 'checkbox', checked: 'checked' });
        cb.checked = true;
        cb.addEventListener('change', (function (email) {
          return function () {
            selectedNames[email] = this.checked;
            rebuildCertTable();
          };
        })(u.email));
        item.appendChild(cb);
        item.appendChild(document.createTextNode(' ' + u.displayName));
        filterList.appendChild(item);
      });
      filterDropdown.appendChild(filterList);
      filterBox.appendChild(filterDropdown);
      filterWrap.appendChild(filterBox);
      tableContainer.appendChild(filterWrap);

      var dropdownOpen = false;
      filterToggle.addEventListener('click', function () {
        dropdownOpen = !dropdownOpen;
        filterDropdown.classList.toggle('cert-filter-dropdown-open', dropdownOpen);
        filterToggle.classList.toggle('cert-filter-toggle-open', dropdownOpen);
      });

      document.addEventListener('click', function closeDropdown(e) {
        if (!filterBox.contains(e.target)) {
          dropdownOpen = false;
          filterDropdown.classList.remove('cert-filter-dropdown-open');
          filterToggle.classList.remove('cert-filter-toggle-open');
        }
      });

      function updateToggleLabel() {
        var count = 0;
        for (var e in selectedNames) if (selectedNames[e]) count++;
        var txt = count === users.length ? 'All selected' : count === 0 ? 'None selected' : count + ' of ' + users.length + ' selected';
        filterToggle.innerHTML = txt + ' <span class="cert-filter-arrow">&#9662;</span>';
      }

      selectAllBtn.addEventListener('click', function () {
        users.forEach(function (u) { selectedNames[u.email] = true; });
        filterList.querySelectorAll('input').forEach(function (cb) { cb.checked = true; });
        rebuildCertTable();
      });
      clearAllBtn.addEventListener('click', function () {
        users.forEach(function (u) { selectedNames[u.email] = false; });
        filterList.querySelectorAll('input').forEach(function (cb) { cb.checked = false; });
        rebuildCertTable();
      });

      // --- Table container for rebuild ---
      var tableInner = el('div');
      tableContainer.appendChild(tableInner);

      function rebuildCertTable() {
        tableInner.innerHTML = '';
        updateToggleLabel();

        var filtered = users.filter(function (u) { return selectedNames[u.email]; });

        var table = el('div', { className: 'history-table' });

        // Header
        var header = el('div', { className: 'history-row history-header cert-row cert-header' });
        header.appendChild(el('div', { className: 'history-cell' }, 'Name'));
        ALL_MODULES.forEach(function (m) {
          var cell = el('div', { className: 'history-cell' + (m.testOut ? ' cert-testout' : '') });
          cell.appendChild(document.createTextNode(m.label));
          if (m.testOut) {
            cell.appendChild(el('span', { className: 'cert-testout-label' }, 'Test Out'));
          }
          header.appendChild(cell);
        });
        header.appendChild(el('div', { className: 'history-cell' }, 'Status'));
        table.appendChild(header);

        // Rows
        filtered.forEach(function (u) {
          var tr = el('div', { className: 'history-row cert-row' + (u.certified ? ' cert-certified' : '') });
          var nameCell = el('div', { className: 'history-cell', style: { fontWeight: '600', cursor: 'pointer', textDecoration: 'underline', color: 'var(--primary)' } }, u.displayName);
          nameCell.onclick = (function (user, rows) { return function () { showUserVarianceChart(user, rows); }; })(u, data.rows);
          tr.appendChild(nameCell);

          ALL_MODULES.forEach(function (m) {
            var mod = u.modules[m.key];
            var cellText, cellClass;
            if (mod.passed) {
              cellText = '\u2705';
              cellClass = 'history-cell text-good';
            } else if (mod.attempted) {
              cellText = '\u274C';
              cellClass = 'history-cell text-bad';
            } else {
              cellText = '\u25A1';
              cellClass = 'history-cell';
            }
            if (m.testOut) cellClass += ' cert-testout';
            tr.appendChild(el('div', { className: cellClass }, cellText));
          });

          var certCell = u.certified
            ? el('div', { className: 'history-cell text-good', style: { fontWeight: '700' } }, '\u2705 YES')
            : el('div', { className: 'history-cell text-bad', style: { fontWeight: '700' } }, '\u274C NO');
          tr.appendChild(certCell);

          table.appendChild(tr);
        });

        tableInner.appendChild(table);

        // Summary
        var certCount = filtered.filter(function (u) { return u.certified; }).length;
        var legend = el('p', { className: 'history-count', style: { marginTop: '12px' } },
          certCount + ' of ' + filtered.length + ' certified  |  \u2705 Pass  |  \u274C Fail  |  \u25A1 Not Attempted  |  Highlighted = Test Out'
        );
        tableInner.appendChild(legend);
      }

      rebuildCertTable();
    });
  }

  // ---------------------------------------------------------------------------
  // Screen: Leaderboard
  // ---------------------------------------------------------------------------

  function renderLeaderboard() {
    activeSection = 'leaderboard';
    renderNav();
    var app = clearApp();

    var screen = el('div', { className: 'screen history-screen' });

    screen.appendChild(el('h1', null, '\uD83C\uDFC6 Leaderboard'));
    screen.appendChild(el('p', { className: 'history-subtitle' }, 'Best accuracy with at least 5 properties (1 module). Sorted by average accuracy.'));

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
        if (u.properties >= 5) {
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
          el('p', { className: 'history-empty-sub' }, 'Need at least 5 properties (1 module attempt) to qualify.')
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
  // Performance Dashboard
  // ---------------------------------------------------------------------------

  function renderPerformance() {
    var app = document.getElementById('app');
    app.innerHTML = '<div class="perf-loading">Loading performance data...</div>';

    fetch('performance-data.json?v=' + Date.now())
      .then(function(r) { return r.json(); })
      .then(function(data) { renderPerformanceDashboard(data); })
      .catch(function() {
        app.innerHTML = '<div class="perf-loading">Performance data not available yet.</div>';
      });
  }

  function renderPerformanceDashboard(data) {
    var app = document.getElementById('app');
    var agents = data.agents;
    var weeks = data.weeks || [];

    // MPS level to CSS class
    function mpsClass(level) {
      return 'mps-' + level.toLowerCase().replace(/\s+/g, '-');
    }

    // Trend arrow
    function trendIcon(t) {
      if (t === 'up') return '<span class="trend-up" title="Improving">\u2191</span>';
      if (t === 'down') return '<span class="trend-down" title="Declining">\u2193</span>';
      return '<span class="trend-flat" title="Flat">\u2192</span>';
    }

    // Sort controls state
    var sortCol = 'contracts';
    var sortDir = 'desc';

    function sortAgents(col) {
      if (sortCol === col) {
        sortDir = sortDir === 'desc' ? 'asc' : 'desc';
      } else {
        sortCol = col;
        sortDir = 'desc';
      }
      renderTable();
    }

    function getSortValue(agent) {
      var map = {
        'agent': agent.agent,
        'contracts': agent.lastWeek.contracts,
        'marketed': agent.lastWeek.marketed,
        'positiveSpread': agent.lastWeek.positiveSpread,
        'assignments': agent.lastWeek.assignments,
        'avgContracts': agent.fourWeekAvg.contracts,
      };
      return map[sortCol] !== undefined ? map[sortCol] : 0;
    }

    function renderTable() {
      var sorted = agents.slice().sort(function(a, b) {
        var va = getSortValue(a);
        var vb = getSortValue(b);
        if (typeof va === 'string') {
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        return sortDir === 'asc' ? va - vb : vb - va;
      });

      var arrow = sortDir === 'desc' ? ' \u25BC' : ' \u25B2';

      var html = '';
      html += '<div class="perf-container">';
      html += '<div class="perf-header">';
      html += '<h1>Acquisition Team Performance</h1>';
      html += '<p class="perf-subtitle">Week of ' + data.weekStart + ' to ' + data.weekEnd + '</p>';
      html += '<p class="perf-generated">Updated: ' + data.generated.replace('T', ' ') + '</p>';
      html += '</div>';

      // MPS legend
      html += '<div class="perf-legend">';
      html += '<span class="mps-badge mps-expert">Expert</span>';
      html += '<span class="mps-badge mps-target">Target</span>';
      html += '<span class="mps-badge mps-minimum">Minimum</span>';
      html += '<span class="mps-badge mps-below-minimum">Below Min</span>';
      html += '<span class="perf-legend-spacer"></span>';
      html += '<span class="perf-legend-label">MPS: Contracts \u22651/wk | Marketed \u22651/wk | Pos. Spread \u22650.5/wk | Assignments \u22650.5/wk</span>';
      html += '</div>';

      // Main table
      html += '<div class="perf-table-wrap">';
      html += '<table class="perf-table">';
      html += '<thead><tr>';

      var cols = [
        { key: 'agent', label: 'Agent' },
        { key: 'contracts', label: 'Contracts' },
        { key: 'marketed', label: 'Marketed' },
        { key: 'positiveSpread', label: 'Pos. Spread' },
        { key: 'assignments', label: 'Assignments' },
        { key: 'avgContracts', label: '4-Wk Avg' },
      ];

      // Add weekly columns
      for (var w = 0; w < weeks.length; w++) {
        cols.push({ key: 'week_' + w, label: weeks[w] });
      }
      cols.push({ key: 'trend', label: 'Trend', noSort: true });

      for (var c = 0; c < cols.length; c++) {
        var col = cols[c];
        var sortable = !col.noSort;
        var cls = sortable ? 'perf-sortable' : '';
        var arrowStr = sortCol === col.key ? arrow : '';
        html += '<th class="' + cls + '" data-col="' + col.key + '">' + col.label + arrowStr + '</th>';
      }
      html += '</tr></thead><tbody>';

      for (var i = 0; i < sorted.length; i++) {
        var a = sorted[i];
        var lw = a.lastWeek;
        var mps = a.mpsLevel;
        var hasActivity = lw.contracts > 0 || lw.marketed > 0 || lw.assignments > 0;
        var rowClass = hasActivity ? '' : 'perf-inactive-row';

        html += '<tr class="' + rowClass + '">';
        html += '<td class="perf-agent-name">' + a.agent + '</td>';
        html += '<td class="' + mpsClass(mps.contracts) + '">' + lw.contracts + '</td>';
        html += '<td class="' + mpsClass(mps.marketed) + '">' + lw.marketed + '</td>';
        html += '<td class="' + mpsClass(mps.positiveSpread) + '">' + lw.positiveSpread + '</td>';
        html += '<td class="' + mpsClass(mps.assignments) + '">' + lw.assignments + '</td>';
        html += '<td>' + a.fourWeekAvg.contracts + '</td>';

        // Weekly contract history
        for (var wi = 0; wi < weeks.length; wi++) {
          var wval = (a.weeklyContracts && a.weeklyContracts[weeks[wi]]) || 0;
          html += '<td class="perf-week-cell">' + wval + '</td>';
        }

        html += '<td>' + trendIcon(a.trend) + '</td>';
        html += '</tr>';
      }

      html += '</tbody></table></div>';

      // Summary stats
      var totalContracts = 0, totalMarketed = 0, belowMin = 0, activeCount = 0;
      for (var j = 0; j < agents.length; j++) {
        totalContracts += agents[j].lastWeek.contracts;
        totalMarketed += agents[j].lastWeek.marketed;
        if (agents[j].lastWeek.contracts > 0 || agents[j].lastWeek.marketed > 0) activeCount++;
        var levels = agents[j].mpsLevel;
        if (levels.contracts === 'Below Minimum' || levels.marketed === 'Below Minimum' ||
            levels.positiveSpread === 'Below Minimum' || levels.assignments === 'Below Minimum') {
          belowMin++;
        }
      }

      html += '<div class="perf-stats">';
      html += '<div class="perf-stat"><span class="perf-stat-value">' + totalContracts + '</span><span class="perf-stat-label">Total Contracts</span></div>';
      html += '<div class="perf-stat"><span class="perf-stat-value">' + totalMarketed + '</span><span class="perf-stat-label">Total Marketed</span></div>';
      html += '<div class="perf-stat"><span class="perf-stat-value">' + activeCount + '</span><span class="perf-stat-label">Active Agents</span></div>';
      html += '<div class="perf-stat perf-stat-alert"><span class="perf-stat-value">' + belowMin + '</span><span class="perf-stat-label">Below Minimum</span></div>';
      html += '</div>';

      html += '</div>';

      app.innerHTML = html;

      // Bind sort handlers
      var ths = app.querySelectorAll('.perf-sortable');
      for (var t = 0; t < ths.length; t++) {
        (function(th) {
          th.addEventListener('click', function() {
            sortAgents(th.getAttribute('data-col'));
          });
        })(ths[t]);
      }
    }

    renderTable();
  }

  // ---------------------------------------------------------------------------
  // Prospect Lookup
  // ---------------------------------------------------------------------------

  function fmtDollars(v) {
    if (v == null || isNaN(v)) return 'N/A';
    var n = Number(v);
    return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtPsf(v, sqft) {
    if (!v || !sqft || sqft <= 0) return '';
    return '$' + (v / sqft).toFixed(2) + '/ft\u00B2';
  }

  function conditionLabel(grade) {
    var map = { A: 'Light cosmetic', B: 'Minor repairs', C: 'Moderate renovation', D: 'Heavy renovation', F: 'Gut renovation' };
    return map[grade] || '';
  }

  function conditionCost(grade) {
    var map = { A: '$9K', B: '$10K', C: '$18K', D: '$29K', F: '$37K' };
    return map[grade] || '';
  }

  function bootProspectLookup() {
    activeSection = 'prospect-lookup';
    renderNav();
    renderProspectSearch();
  }

  function renderProspectSearch() {
    var app = clearApp();
    var screen = el('div', { className: 'screen prospect-screen' });

    screen.appendChild(el('h1', null, 'Prospect Lookup'));
    screen.appendChild(el('p', { className: 'landing-subtitle' }, 'Search by address, owner name, acquisition agent, or key code'));

    var searchBox = el('div', { className: 'prospect-search-box' });
    var input = el('input', {
      type: 'text',
      className: 'prospect-search-input',
      placeholder: 'Enter address, owner, agent, or key code...',
    });
    var btn = el('button', { className: 'btn-primary prospect-search-btn' }, 'Search');
    searchBox.appendChild(input);
    searchBox.appendChild(btn);
    screen.appendChild(searchBox);

    var results = el('div', { className: 'prospect-results', id: 'prospect-results' });
    screen.appendChild(results);

    function doSearch() {
      var q = input.value.trim();
      if (q.length < 3) return;
      results.innerHTML = '<div class="prospect-loading">Searching...</div>';
      var pattern = '%' + q + '%';
      sbClient
        .from('prospects')
        .select('id, status, key_code, address, owner_1_name, owner_2_name, beds, baths, arv, offer_price, acquisition_rep, attom_id')
        .or('address.ilike.' + pattern + ',owner_1_name.ilike.' + pattern + ',key_code.ilike.' + pattern + ',acquisition_rep.ilike.' + pattern)
        .order('created_at', { ascending: false })
        .limit(20)
        .then(function (res) {
          var data = res.data;
          var error = res.error;
          results.innerHTML = '';
          if (error) {
            results.innerHTML = '<div class="prospect-empty">' + error.message + '</div>';
            return;
          }
          if (!data || data.length === 0) {
            results.innerHTML = '<div class="prospect-empty">No prospects found</div>';
            return;
          }

          // Fetch first photo for each prospect
          var ids = data.map(function (r) { return r.id; });
          sbClient.from('prospect_photos').select('prospect_id, image_url').in('prospect_id', ids).order('sort_order').then(function (photoRes) {
            var photoMap = {};
            (photoRes.data || []).forEach(function (p) {
              if (!photoMap[p.prospect_id]) photoMap[p.prospect_id] = p.image_url;
            });

            var table = el('div', { className: 'prospect-results-table' });
            var hdr = el('div', { className: 'prospect-result-row prospect-result-header' });
            hdr.appendChild(el('div', { className: 'prospect-result-cell' }, ''));
            hdr.appendChild(el('div', { className: 'prospect-result-cell' }, 'Address'));
            hdr.appendChild(el('div', { className: 'prospect-result-cell' }, 'Owner'));
            hdr.appendChild(el('div', { className: 'prospect-result-cell' }, 'Status'));
            hdr.appendChild(el('div', { className: 'prospect-result-cell' }, 'Beds/Baths'));
            hdr.appendChild(el('div', { className: 'prospect-result-cell' }, 'ARV'));
            hdr.appendChild(el('div', { className: 'prospect-result-cell' }, 'Offer'));
            hdr.appendChild(el('div', { className: 'prospect-result-cell' }, ''));
            table.appendChild(hdr);

            data.forEach(function (row) {
              var tr = el('div', { className: 'prospect-result-row' });
              var thumbCell = el('div', { className: 'prospect-result-cell prospect-result-thumb' });
              var thumbUrl = photoMap[row.id];
              if (thumbUrl) {
                var img = el('img', { src: thumbUrl, className: 'prospect-thumb-img' });
                img.onerror = function () { this.style.display = 'none'; };
                thumbCell.appendChild(img);
              }
              tr.appendChild(thumbCell);
              tr.appendChild(el('div', { className: 'prospect-result-cell prospect-result-addr' }, row.address || 'N/A'));
              tr.appendChild(el('div', { className: 'prospect-result-cell' }, row.owner_1_name || '-'));
              tr.appendChild(el('div', { className: 'prospect-result-cell' },
                el('span', { className: 'prospect-status-badge prospect-status-' + (row.status || 'unknown') }, row.status || '-')
              ));
              tr.appendChild(el('div', { className: 'prospect-result-cell' }, (row.beds || 0) + 'bd / ' + (row.baths || 0) + 'ba'));
              tr.appendChild(el('div', { className: 'prospect-result-cell' }, row.arv ? fmtDollars(row.arv) : '-'));
              tr.appendChild(el('div', { className: 'prospect-result-cell' }, row.offer_price ? fmtDollars(row.offer_price) : '-'));
              var viewBtn = el('button', {
                className: 'btn-primary prospect-view-btn',
                onClick: function () { loadProspectDetail(row.id); }
              }, 'View');
              tr.appendChild(el('div', { className: 'prospect-result-cell' }, viewBtn));
              table.appendChild(tr);
            });
            results.appendChild(table);
          });
        });
    }

    btn.addEventListener('click', doSearch);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });

    // Back button
    screen.appendChild(el('button', {
      className: 'btn-secondary sales-back-btn',
      onClick: function () { activeSection = null; renderNav(); renderLandingPage(); }
    }, '\u2190 Back to Home'));

    app.appendChild(screen);
    input.focus();
  }

  function loadProspectDetail(prospectId, returnTo) {
    var app = clearApp();
    var screen = el('div', { className: 'screen prospect-screen' });
    screen.appendChild(el('div', { className: 'prospect-loading' }, 'Loading prospect data...'));
    app.appendChild(screen);

    Promise.all([
      sbClient.from('prospects').select('*').eq('id', prospectId).single(),
      sbClient.from('prospect_photos').select('image_url, sort_order').eq('prospect_id', prospectId).order('sort_order'),
    ]).then(function (results) {
      var prospectRes = results[0];
      var photosRes = results[1];
      if (prospectRes.error) {
        screen.innerHTML = '<div class="prospect-empty">' + prospectRes.error.message + '</div>';
        return;
      }
      var r = prospectRes.data;
      var photos = (photosRes.data || []).map(function (p) { return p.image_url; });

      // Reshape flat Supabase row into the nested structure renderProspectDetail expects
      var data = {
        prospect: { id: r.id, status: r.status, key_code: r.key_code, mailer_code: r.mailer_code, deal_stage: r.deal_stage, created_at: r.created_at },
        property: { address: r.address, city: r.city, state: r.state, zip: r.zip, beds: r.beds, baths: r.baths, sqft: r.sqft, year_built: r.year_built, lot_area: r.lot_area, house_type: r.house_type, attom_id: r.attom_id },
        contact: { owner_1: r.owner_1_name, owner_2: r.owner_2_name, phone: r.phone, email: r.email, acquisition_rep: r.acquisition_rep },
        tax_ownership: { assessed_value: r.assessed_value, annual_tax: r.annual_tax, last_sale_date: r.last_sale_date, last_sale_price: r.last_sale_price, ownership_years: r.ownership_years, assessment_year: r.assessment_year },
        financials: { mortgage_outstanding: r.mortgage_outstanding, mortgage_total: r.mortgage_total, mortgage_in_default: r.mortgage_in_default, hoa_monthly: r.hoa_monthly_dues },
        valuation: r.arv ? { arv: r.arv, rent_estimate: r.rent_estimate, renovation_estimate: r.renovation_estimate, renovation_grade: r.renovation_grade, condition_notes: r.condition_notes, offer_price: r.offer_price, mao: r.mao, disposition_price: r.disposition_price, seller_asking_price: r.seller_asking_price, underwriting_arv: r.underwriting_arv, underwriting_rent_estimate: r.underwriting_rent_estimate, underwriting_renovation_estimate: r.underwriting_renovation_est } : null,
        underwriter: r.pf_arv ? { arv: r.pf_arv, repair_estimate: r.pf_repair_estimate, notes: r.pf_notes, purchase_price: r.pf_purchase_price, market_rent: r.pf_market_rent, cap_rate: r.pf_cap_rate, gross_yield: r.pf_gross_yield, noi: r.pf_noi, mao: r.pf_mao } : null,
        pricing: { suggested_offer: r.offer_price, estimated_disposition: r.estimated_disposition, county_tier: r.county_tier, mailer_amount: r.mailer_amount },
        photos: photos,
      };

      renderProspectDetail(data, returnTo);
    });
  }

  function renderProspectDetail(data, returnTo) {
    var app = clearApp();
    var screen = el('div', { className: 'screen prospect-screen' });

    var p = data.prospect;
    var prop = data.property;
    var contact = data.contact;
    var tax = data.tax_ownership;
    var fin = data.financials;
    var val = data.valuation;
    var uw = data.underwriter;
    var pricing = data.pricing;
    var photos = data.photos || [];

    var goBack = returnTo === 'dashboard' ? function () { renderDashboard(); } : function () { renderProspectSearch(); };
    var backLabel = returnTo === 'dashboard' ? '\u2190 Back To Dashboard' : '\u2190 Back To Lookup';

    // === HEADER BAR ===
    var header = el('div', { className: 'prospect-header-bar' });
    var backLink = el('button', {
      className: 'prospect-back-link',
      onClick: goBack
    }, backLabel);
    header.appendChild(backLink);

    var contactInfo = el('div', { className: 'prospect-contact-info' });
    if (contact.owner_1) {
      contactInfo.appendChild(el('a', { className: 'prospect-contact-name', href: '#' }, contact.owner_1));
    }
    if (contact.phone) contactInfo.appendChild(el('span', null, contact.phone));
    if (contact.email) contactInfo.appendChild(el('span', null, contact.email));
    contactInfo.appendChild(el('span', null, 'Owner'));
    if (contact.acquisition_rep) {
      contactInfo.appendChild(el('span', { className: 'prospect-acq-rep' }, 'Acq: ' + contact.acquisition_rep));
    }
    header.appendChild(contactInfo);

    if (pricing.mailer_amount) {
      header.appendChild(el('span', { className: 'prospect-mailer-badge' }, 'Mailer Amount: ' + fmtDollars(pricing.mailer_amount)));
    }
    screen.appendChild(header);

    // === PROPERTY INFO BAR ===
    var propBar = el('div', { className: 'prospect-prop-bar' });
    var addrLine = el('div', { className: 'prospect-address' });
    addrLine.appendChild(el('h2', null, (prop.address || '').toUpperCase()));
    var details = [];
    if (prop.beds) details.push(prop.beds + ' bd');
    if (prop.baths) details.push(prop.baths + ' ba');
    if (prop.sqft) details.push(Number(prop.sqft).toLocaleString() + ' ft\u00B2');
    if (prop.year_built) details.push('Built ' + prop.year_built);
    if (prop.lot_area) details.push(Number(prop.lot_area).toLocaleString() + ' ft\u00B2 lot');
    if (prop.house_type) details.push(prop.house_type.replace(/_/g, ' ').replace(/\b\w/g, function(l){return l.toUpperCase();}));
    addrLine.appendChild(el('p', null, details.join(' | ')));
    if (tax.last_sale_date) {
      var saleDate = new Date(tax.last_sale_date);
      var saleStr = saleDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      addrLine.appendChild(el('p', { className: 'prospect-last-sale-line' }, 'Last Sale: ' + saleStr + ' \u2022 ' + fmtDollars(tax.last_sale_price)));
    }
    propBar.appendChild(addrLine);

    var statusTag = el('span', { className: 'prospect-deal-status' }, p.status ? p.status.toUpperCase() : '');
    propBar.appendChild(statusTag);
    screen.appendChild(propBar);

    // === MAIN LAYOUT: 3-column grid ===
    var mainGrid = el('div', { className: 'prospect-main-grid' });

    // --- LEFT COLUMN ---
    var leftCol = el('div', { className: 'prospect-col prospect-col-left' });

    // Tax & Ownership card
    var taxCard = el('div', { className: 'prospect-card' });
    taxCard.appendChild(el('h3', { className: 'prospect-card-title' }, 'Tax & Ownership'));
    var taxTable = el('div', { className: 'prospect-kv-table' });
    taxTable.appendChild(kvRow('Tax Assessed (ATTOM):', tax.assessed_value ? fmtDollars(tax.assessed_value) : 'N/A'));
    taxTable.appendChild(kvRow('Annual Tax:', tax.annual_tax ? fmtDollars(tax.annual_tax) : 'N/A'));
    if (tax.last_sale_date) {
      var sd = new Date(tax.last_sale_date);
      taxTable.appendChild(kvRow('Last Sale:', sd.toLocaleDateString('en-US', {month:'short', year:'numeric'}) + ' \u2022 ' + fmtDollars(tax.last_sale_price)));
    }
    taxTable.appendChild(kvRow('Ownership:', tax.ownership_years != null ? tax.ownership_years + ' years' : 'N/A'));
    taxCard.appendChild(taxTable);

    // Contacts
    var contactSection = el('div', { className: 'prospect-contact-section' });
    contactSection.appendChild(el('div', { className: 'prospect-contact-label' }, 'Contacts:'));
    if (contact.owner_1) {
      var c1 = el('div', { className: 'prospect-contact-entry' });
      c1.appendChild(el('strong', null, contact.owner_1));
      c1.appendChild(el('span', { className: 'prospect-contact-type' }, '(Primary)'));
      c1.appendChild(el('div', null, 'Owner'));
      contactSection.appendChild(c1);
    }
    if (contact.owner_2) {
      var c2 = el('div', { className: 'prospect-contact-entry' });
      c2.appendChild(el('strong', null, contact.owner_2));
      c2.appendChild(el('div', null, 'Owner'));
      contactSection.appendChild(c2);
    }
    taxCard.appendChild(contactSection);
    leftCol.appendChild(taxCard);

    // Financials card
    var finCard = el('div', { className: 'prospect-card' });
    finCard.appendChild(el('h3', { className: 'prospect-card-title' }, 'Financials'));

    var mortAmt = fin.mortgage_outstanding || 0;
    var mortTotal = fin.mortgage_total || 0;
    var inDefault = fin.mortgage_in_default;
    var defaultBadge = el('span', {
      className: 'prospect-badge ' + (inDefault ? 'prospect-badge-red' : 'prospect-badge-green')
    }, inDefault ? 'IN DEFAULT' : 'NOT IN DEFAULT');
    finCard.appendChild(el('div', { className: 'prospect-fin-header' },
      el('div', null,
        el('div', { className: 'prospect-fin-label' }, 'OUTSTANDING MORTGAGE'),
        el('div', { className: 'prospect-fin-amount' }, fmtDollars(mortAmt))
      ),
      defaultBadge
    ));

    // Mortgage bar
    if (mortTotal > 0) {
      var pctPaid = Math.min(100, Math.round(((mortTotal - mortAmt) / mortTotal) * 100));
      var mortBar = el('div', { className: 'prospect-mort-bar' });
      mortBar.appendChild(el('div', { className: 'prospect-mort-fill', style: { width: pctPaid + '%' } }));
      finCard.appendChild(mortBar);
      var mortLabels = el('div', { className: 'prospect-mort-labels' });
      mortLabels.appendChild(el('span', null, 'Paid: ' + fmtDollars(mortTotal - mortAmt)));
      mortLabels.appendChild(el('span', null, 'Total: ' + fmtDollars(mortTotal)));
      finCard.appendChild(mortLabels);
    }

    finCard.appendChild(kvRow('HOA/mo:', fin.hoa_monthly ? fmtDollars(fin.hoa_monthly) : 'N/A'));
    leftCol.appendChild(finCard);

    // Rent Estimates card
    var rentCard = el('div', { className: 'prospect-card' });
    rentCard.appendChild(el('h3', { className: 'prospect-card-title' }, 'Rent Estimates'));
    var rentTable = el('div', { className: 'prospect-kv-table' });
    var rentSources = [
      { source: 'Prospect Valuation', rent: val ? val.rent_estimate : null },
      { source: 'Underwriter', rent: uw ? uw.market_rent : null },
    ];
    var rentTbl = el('div', { className: 'prospect-rent-table' });
    var rentHdr = el('div', { className: 'prospect-rent-row prospect-rent-header' });
    rentHdr.appendChild(el('div', null, 'Source'));
    rentHdr.appendChild(el('div', null, 'Rent'));
    rentTbl.appendChild(rentHdr);
    rentSources.forEach(function (rs) {
      var row = el('div', { className: 'prospect-rent-row' });
      row.appendChild(el('div', null, rs.source));
      row.appendChild(el('div', null, rs.rent ? fmtDollars(rs.rent) : 'N/A'));
      rentTbl.appendChild(row);
    });
    rentCard.appendChild(rentTbl);
    leftCol.appendChild(rentCard);

    mainGrid.appendChild(leftCol);

    // --- CENTER COLUMN ---
    var centerCol = el('div', { className: 'prospect-col prospect-col-center' });

    // Pricing Signals card
    var pricingCard = el('div', { className: 'prospect-card' });
    pricingCard.appendChild(el('h3', { className: 'prospect-card-title' }, 'Pricing Signals'));
    pricingCard.appendChild(el('p', { className: 'prospect-card-subtitle' }, 'As-is price signals, fixed-up estimate'));

    // As-Is table
    pricingCard.appendChild(el('div', { className: 'prospect-section-label' }, 'AS-IS PRICE SIGNALS'));
    var asisTbl = el('div', { className: 'prospect-pricing-table' });
    var asisHdr = el('div', { className: 'prospect-pricing-row prospect-pricing-header' });
    asisHdr.appendChild(el('div', null, 'Source'));
    asisHdr.appendChild(el('div', null, 'Value'));
    asisHdr.appendChild(el('div', null, 'Condition'));
    asisTbl.appendChild(asisHdr);

    // Valuation as-is
    if (val && val.arv) {
      var asRow = el('div', { className: 'prospect-pricing-row' });
      asRow.appendChild(el('div', null, 'Prospect Valuation'));
      asRow.appendChild(el('div', null, fmtDollars(val.arv) + (prop.sqft ? ' (' + fmtPsf(val.arv, prop.sqft) + ')' : '')));
      asRow.appendChild(el('div', null, val.renovation_grade || 'N/A'));
      asisTbl.appendChild(asRow);
    }
    pricingCard.appendChild(asisTbl);

    // Fixed-Up table
    pricingCard.appendChild(el('div', { className: 'prospect-section-label' }, 'FIXED-UP ESTIMATE'));
    var fixTbl = el('div', { className: 'prospect-pricing-table' });
    var fixHdr = el('div', { className: 'prospect-pricing-row prospect-pricing-header' });
    fixHdr.appendChild(el('div', null, 'Source'));
    fixHdr.appendChild(el('div', null, 'Value'));
    fixHdr.appendChild(el('div', null, 'Cond.'));
    fixTbl.appendChild(fixHdr);

    if (uw && uw.arv) {
      var uwRow = el('div', { className: 'prospect-pricing-row' });
      uwRow.appendChild(el('div', null, 'Underwriter (Pro Forma)'));
      uwRow.appendChild(el('div', null, fmtDollars(uw.arv)));
      uwRow.appendChild(el('div', null, uw.notes ? uw.notes.substring(0, 50) : 'N/A'));
      fixTbl.appendChild(uwRow);
    }
    if (val && val.underwriting_arv) {
      var uwvRow = el('div', { className: 'prospect-pricing-row' });
      uwvRow.appendChild(el('div', null, 'Underwriting Override'));
      uwvRow.appendChild(el('div', null, fmtDollars(val.underwriting_arv)));
      uwvRow.appendChild(el('div', null, '-'));
      fixTbl.appendChild(uwvRow);
    }
    pricingCard.appendChild(fixTbl);
    centerCol.appendChild(pricingCard);

    // Marketing Photos
    if (photos.length > 0) {
      var photoCard = el('div', { className: 'prospect-card prospect-photo-card' });
      photoCard.appendChild(el('h3', { className: 'prospect-card-title' }, 'Marketing Photos'));
      var photoGrid = el('div', { className: 'prospect-photo-grid' });
      photos.forEach(function (url, idx) {
        var imgWrap = el('div', { className: 'prospect-photo-wrap' });
        var img = el('img', {
          src: url,
          className: 'prospect-photo',
          loading: idx > 5 ? 'lazy' : 'eager',
          onClick: function () { openProspectLightbox(photos, idx); }
        });
        img.onerror = function () { this.style.display = 'none'; };
        imgWrap.appendChild(img);
        photoGrid.appendChild(imgWrap);
      });
      photoCard.appendChild(photoGrid);
    }

    mainGrid.appendChild(centerCol);

    // --- RIGHT COLUMN: Offer Calculation ---
    var rightCol = el('div', { className: 'prospect-col prospect-col-right' });

    var offerCard = el('div', { className: 'prospect-card prospect-offer-card' });
    offerCard.appendChild(el('h3', { className: 'prospect-card-title' }, 'OFFER CALCULATION'));

    // Suggested Offer & Est. Disposition header
    var offerHeader = el('div', { className: 'prospect-offer-header' });
    var sugBox = el('div', { className: 'prospect-offer-box prospect-offer-suggested' });
    sugBox.appendChild(el('div', { className: 'prospect-offer-label' }, 'SUGGESTED OFFER'));
    sugBox.appendChild(el('div', { className: 'prospect-offer-amount' }, pricing.suggested_offer ? fmtDollars(pricing.suggested_offer) : 'N/A'));
    if (pricing.suggested_offer && prop.sqft) {
      sugBox.appendChild(el('div', { className: 'prospect-offer-psf' }, fmtPsf(pricing.suggested_offer, prop.sqft)));
    }
    offerHeader.appendChild(sugBox);

    var dispoBox = el('div', { className: 'prospect-offer-box prospect-offer-dispo' });
    dispoBox.appendChild(el('div', { className: 'prospect-offer-label' }, 'EST. DISPOSITION'));
    dispoBox.appendChild(el('div', { className: 'prospect-offer-amount' }, pricing.estimated_disposition ? fmtDollars(pricing.estimated_disposition) : 'N/A'));
    if (pricing.estimated_disposition && prop.sqft) {
      dispoBox.appendChild(el('div', { className: 'prospect-offer-psf' }, fmtPsf(pricing.estimated_disposition, prop.sqft)));
    }
    offerHeader.appendChild(dispoBox);
    offerCard.appendChild(offerHeader);

    // ARV display
    var arvDisplay = val ? (val.underwriting_arv || val.arv) : (uw ? uw.arv : null);
    offerCard.appendChild(offerField('ARV', arvDisplay, prop.sqft));

    // Rent Estimate
    var rentDisplay = val ? (val.underwriting_rent_estimate || val.rent_estimate) : (uw ? uw.market_rent : null);
    offerCard.appendChild(offerField('Rent Estimate', rentDisplay, null));

    // Condition selector display
    var renoGrade = val ? val.renovation_grade : null;
    if (renoGrade) {
      var condRow = el('div', { className: 'prospect-offer-row' });
      condRow.appendChild(el('div', { className: 'prospect-offer-field-label' }, 'Condition'));
      var grades = ['A', 'B', 'C', 'D', 'F'];
      var gradeBar = el('div', { className: 'prospect-grade-bar' });
      grades.forEach(function (g) {
        var gBtn = el('div', {
          className: 'prospect-grade-btn' + (g === renoGrade ? ' prospect-grade-active' : '')
        });
        gBtn.appendChild(el('div', { className: 'prospect-grade-letter' }, g));
        gBtn.appendChild(el('div', { className: 'prospect-grade-cost' }, conditionCost(g)));
        gradeBar.appendChild(gBtn);
      });
      condRow.appendChild(gradeBar);
      if (renoGrade) {
        condRow.appendChild(el('div', { className: 'prospect-condition-desc' }, conditionLabel(renoGrade) + ' (' + renoGrade + ') selected'));
      }
      offerCard.appendChild(condRow);
    }

    // Renovation Estimate
    var renoEst = val ? (val.underwriting_renovation_estimate || val.renovation_estimate) : (uw ? uw.repair_estimate : null);
    offerCard.appendChild(offerField('Renovation Estimate', renoEst, prop.sqft));

    // Offer Price
    offerCard.appendChild(offerField('Offer Price', pricing.suggested_offer, prop.sqft));

    // MAO
    var maoVal = val ? val.mao : null;
    if (maoVal) offerCard.appendChild(offerField('MAO', maoVal, null));

    // County Tier
    if (pricing.county_tier) {
      var tierRow = el('div', { className: 'prospect-offer-row' });
      tierRow.appendChild(el('div', { className: 'prospect-offer-field-label' }, 'County Tier'));
      tierRow.appendChild(el('div', { className: 'prospect-offer-field-value' }, String(pricing.county_tier)));
      offerCard.appendChild(tierRow);
    }

    // Underwriter Notes
    if (uw && uw.notes) {
      var notesSection = el('div', { className: 'prospect-uw-notes' });
      notesSection.appendChild(el('h4', null, 'Underwriter Notes'));
      notesSection.appendChild(el('p', null, uw.notes));
      offerCard.appendChild(notesSection);
    }

    // === PRICE REDUCTION GENERATOR BUTTON ===
    var prBtn = el('button', {
      className: 'btn-primary prospect-price-reduction-btn',
      onClick: function () { openPriceReductionModal(data); }
    }, 'Generate Price Reduction PDF');
    offerCard.appendChild(prBtn);

    rightCol.appendChild(offerCard);
    mainGrid.appendChild(rightCol);

    screen.appendChild(mainGrid);

    // Marketing Photos — full width below 3-column grid
    if (photos.length > 0) {
      screen.appendChild(photoCard);
    }

    // Back button
    screen.appendChild(el('button', {
      className: 'btn-secondary sales-back-btn',
      onClick: goBack
    }, backLabel));

    app.appendChild(screen);
  }

  function kvRow(label, value) {
    var row = el('div', { className: 'prospect-kv-row' });
    row.appendChild(el('span', { className: 'prospect-kv-label' }, label));
    row.appendChild(el('span', { className: 'prospect-kv-value' }, value || 'N/A'));
    return row;
  }

  function offerField(label, value, sqft) {
    var row = el('div', { className: 'prospect-offer-row' });
    row.appendChild(el('div', { className: 'prospect-offer-field-label' }, label));
    var valEl = el('div', { className: 'prospect-offer-field-value' }, value ? fmtDollars(value) : '-');
    row.appendChild(valEl);
    if (value && sqft && sqft > 0) {
      row.appendChild(el('div', { className: 'prospect-offer-field-psf' }, fmtPsf(value, sqft)));
    }
    return row;
  }

  function openProspectLightbox(photos, startIdx) {
    var overlay = el('div', { className: 'prospect-lightbox' });
    var idx = startIdx;

    function render() {
      overlay.innerHTML = '';
      var close = el('button', { className: 'prospect-lb-close', onClick: function () { overlay.remove(); } }, '\u2715');
      overlay.appendChild(close);
      var img = el('img', { src: photos[idx], className: 'prospect-lb-img' });
      overlay.appendChild(img);
      var counter = el('div', { className: 'prospect-lb-counter' }, (idx + 1) + ' / ' + photos.length);
      overlay.appendChild(counter);
      if (photos.length > 1) {
        overlay.appendChild(el('button', {
          className: 'prospect-lb-prev',
          onClick: function () { idx = (idx - 1 + photos.length) % photos.length; render(); }
        }, '\u2190'));
        overlay.appendChild(el('button', {
          className: 'prospect-lb-next',
          onClick: function () { idx = (idx + 1) % photos.length; render(); }
        }, '\u2192'));
      }
    }

    render();
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  // ---------------------------------------------------------------------------
  // Price Reduction Generator
  // ---------------------------------------------------------------------------

  function openPriceReductionModal(data) {
    var overlay = el('div', { className: 'prospect-modal-overlay' });
    var modal = el('div', { className: 'prospect-modal' });

    var val = data.valuation;
    var uw = data.underwriter;
    var prop = data.property;
    var pricing = data.pricing;

    var currentARV = uw ? Number(uw.arv) : (val ? Number(val.arv) : 0);
    var currentRehab = uw ? Number(uw.repair_estimate) : (val ? Number(val.renovation_estimate) : 0);
    var currentOffer = pricing.suggested_offer ? Number(pricing.suggested_offer) : 0;

    modal.appendChild(el('h2', null, 'Price Reduction Generator'));
    modal.appendChild(el('p', { className: 'prospect-modal-subtitle' },
      (prop.address || '').toUpperCase()));

    // Current values display
    var currentSection = el('div', { className: 'pr-current-section' });
    currentSection.appendChild(el('h4', null, 'Current Values'));
    currentSection.appendChild(kvRow('Current ARV:', fmtDollars(currentARV)));
    currentSection.appendChild(kvRow('Current Repair Estimate:', fmtDollars(currentRehab)));
    currentSection.appendChild(kvRow('Current Offer:', fmtDollars(currentOffer)));
    if (pricing.estimated_disposition) {
      currentSection.appendChild(kvRow('Est. Disposition:', fmtDollars(pricing.estimated_disposition)));
    }
    if (pricing.county_tier) {
      currentSection.appendChild(kvRow('County Tier:', String(pricing.county_tier)));
    }
    modal.appendChild(currentSection);

    // New values inputs
    var inputSection = el('div', { className: 'pr-input-section' });
    inputSection.appendChild(el('h4', null, 'New Values'));

    var newAcqInput = createPrInput('New Acquisition Price *', currentOffer);
    var newArvInput = createPrInput('New ARV (leave blank to keep current)', '');
    var newRehabInput = createPrInput('New Repair Estimate (leave blank to auto-calculate)', '');
    inputSection.appendChild(newAcqInput.wrapper);
    inputSection.appendChild(newArvInput.wrapper);
    inputSection.appendChild(newRehabInput.wrapper);

    // Preview section
    var previewSection = el('div', { className: 'pr-preview', id: 'pr-preview' });

    function updatePreview() {
      previewSection.innerHTML = '';
      var newAcq = Number(newAcqInput.input.value) || 0;
      if (newAcq <= 0) return;
      var newArv = Number(newArvInput.input.value) || currentARV;
      var priceDiff = currentOffer - newAcq;
      var newRehab = Number(newRehabInput.input.value) || Math.round(currentRehab + (priceDiff * 1.1222));
      var pctChange = currentOffer > 0 ? ((newAcq - currentOffer) / currentOffer * 100).toFixed(1) : 0;

      // Compute new estimated dispo
      var newDispo = null;
      if (newArv > 0) {
        var basePct = 0.70;
        var cpm = {1:-0.15,2:-0.13,3:-0.13,4:-0.11,5:-0.06,6:-0.03,7:-0.03,8:-0.02,9:0.00,10:0.00,11:0.04,12:0.05,13:0.08,14:0.12};
        var ctPts = pricing.county_tier != null ? (cpm[pricing.county_tier] || 0) : 0;
        var renoR = newRehab ? newRehab / newArv : 0;
        var renoPts = (renoR >= 0 && renoR < 0.20) ? 0.02 : 0.00;
        newDispo = Math.round((basePct + ctPts + renoPts) * newArv - newRehab);
      }

      previewSection.appendChild(el('h4', null, 'Preview'));
      previewSection.appendChild(kvRow('Price Change:', pctChange + '%'));
      previewSection.appendChild(kvRow('New Offer:', fmtDollars(newAcq)));
      previewSection.appendChild(kvRow('Adjusted Rehab:', fmtDollars(newRehab)));
      if (newDispo) previewSection.appendChild(kvRow('New Est. Disposition:', fmtDollars(newDispo)));
      var spread = newDispo ? newDispo - newAcq : null;
      if (spread != null) {
        previewSection.appendChild(kvRow('Spread:', fmtDollars(spread)));
      }
    }

    newAcqInput.input.addEventListener('input', updatePreview);
    newArvInput.input.addEventListener('input', updatePreview);
    newRehabInput.input.addEventListener('input', updatePreview);

    inputSection.appendChild(previewSection);
    modal.appendChild(inputSection);

    // Buttons
    var btnRow = el('div', { className: 'pr-btn-row' });
    var generateBtn = el('button', { className: 'btn-primary', onClick: function () {
      var newAcq = Number(newAcqInput.input.value);
      if (!newAcq || newAcq <= 0) {
        alert('Please enter a new acquisition price');
        return;
      }
      var attomId = prop.attom_id;
      if (!attomId) {
        alert('No ATTOM ID found for this property — cannot generate PDF');
        return;
      }

      generateBtn.textContent = 'Generating...';
      generateBtn.disabled = true;

      var newArv = Number(newArvInput.input.value) || currentARV;
      var priceDiff = currentOffer - newAcq;
      var newRehab = Number(newRehabInput.input.value) || Math.round(currentRehab + (priceDiff * 1.1222));
      var pctChange = currentOffer > 0 ? ((newAcq - currentOffer) / currentOffer * 100).toFixed(1) : '0.0';

      // Compute new estimated dispo
      var newDispo = null;
      if (newArv > 0) {
        var bPct = 0.70;
        var cpmD = {1:-0.15,2:-0.13,3:-0.13,4:-0.11,5:-0.06,6:-0.03,7:-0.03,8:-0.02,9:0.00,10:0.00,11:0.04,12:0.05,13:0.08,14:0.12};
        var ctPtsD = pricing.county_tier != null ? (cpmD[pricing.county_tier] || 0) : 0;
        var renoRD = newRehab ? newRehab / newArv : 0;
        var renoPtsD = (renoRD >= 0 && renoRD < 0.20) ? 0.02 : 0.00;
        newDispo = Math.round((bPct + ctPtsD + renoPtsD) * newArv - newRehab);
      }

      // Fetch photos from Supabase for PDF
      var photoPromise = sbClient
        ? sbClient.from('prospect_photos').select('image_url').eq('prospect_id', data.prospect.id).order('sort_order').limit(21)
        : Promise.resolve({ data: [] });

      photoPromise.then(function (photoRes) {
        var photoUrls = (photoRes.data || []).map(function (p) { return p.image_url; });
        generateRetradePDF({
          address: (prop.address || '').toUpperCase(),
          beds: prop.beds, baths: prop.baths, sqft: prop.sqft, yearBuilt: prop.year_built,
          houseType: prop.house_type,
          acqRep: data.contact.acquisition_rep || 'Rebuilt Acquisitions',
          originalAcq: currentOffer, newAcq: newAcq,
          originalARV: currentARV, newARV: newArv,
          originalRehab: currentRehab, newRehab: newRehab,
          pctChange: pctChange,
          countyTier: pricing.county_tier,
          estimatedDispo: newDispo,
          uwNotes: uw ? uw.notes : null,
          photoUrls: photoUrls,
        });
        generateBtn.textContent = 'Generate Price Reduction PDF';
        generateBtn.disabled = false;
      }).catch(function (err) {
        alert('Failed to generate PDF: ' + err.message);
        generateBtn.textContent = 'Generate Price Reduction PDF';
        generateBtn.disabled = false;
      });
    }}, 'Generate Price Reduction PDF');

    var cancelBtn = el('button', { className: 'btn-secondary', onClick: function () { overlay.remove(); } }, 'Cancel');
    btnRow.appendChild(generateBtn);
    btnRow.appendChild(cancelBtn);
    modal.appendChild(btnRow);

    overlay.appendChild(modal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    updatePreview();
  }

  function generateRetradePDF(d) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'pt', format: 'letter' });
    var PW = 512, LM = 50, DARK = '#1a202c', GRAY = '#718096', BLUE = '#1a365d', ACCENT = '#2b6cb0', GREEN = '#276749', RED = '#c53030';
    var dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    function fmtM(v) { if (v == null || isNaN(v)) return '$0'; var n = Number(v); return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US'); }
    function fmtMSign(v) { var n = Number(v); return (n > 0 ? '+' : n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US'); }

    // === PAGE 1: COVER ===
    doc.setFillColor(BLUE); doc.rect(0, 0, 612, 792, 'F');
    doc.setFontSize(36); doc.setFont('helvetica', 'bold'); doc.setTextColor('#ffffff');
    doc.text('Inspection Report', 306, 300, { align: 'center' });
    doc.setDrawColor('#bee3f8'); doc.setLineWidth(2); doc.line(206, 320, 406, 320);
    doc.setFontSize(16); doc.setFont('helvetica', 'normal'); doc.setTextColor('#bee3f8');
    doc.text(d.address, 306, 350, { align: 'center', maxWidth: 500 });
    doc.setFontSize(12); doc.setTextColor('#a0c4e8'); doc.text(dateStr, 306, 380, { align: 'center' });
    doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor('#ffffff');
    doc.text(d.acqRep, 306, 420, { align: 'center' });
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor('#a0c4e8');
    doc.text('Acquisition Representative', 306, 438, { align: 'center' });
    doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor('#ffffff');
    doc.text('REBUILT', 306, 700, { align: 'center' });
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor('#a0c4e8');
    doc.text('rebuiltllc.com', 306, 716, { align: 'center' });

    // === PAGE 2: SUMMARY ===
    doc.addPage();
    doc.setFillColor(BLUE); doc.rect(0, 0, 612, 50, 'F');
    doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor('#ffffff');
    doc.text('REBUILT', LM, 32);
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor('#bee3f8');
    doc.text('UNDERWRITING SUMMARY  |  PRICE ADJUSTMENT REPORT', 140, 32);

    var y = 70;
    doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(DARK);
    doc.text(d.address, LM, y); y += 20;
    var parts = [];
    if (d.beds) parts.push(d.beds + ' Beds');
    if (d.baths) parts.push(d.baths + ' Baths');
    if (d.sqft) parts.push(Number(d.sqft).toLocaleString() + ' sqft');
    if (d.yearBuilt) parts.push('Built ' + d.yearBuilt);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(GRAY);
    doc.text(parts.join('   |   '), LM, y); y += 30;

    // Price adjustment box
    doc.setFillColor('#f0fff4'); doc.rect(LM, y, PW, 70, 'F');
    doc.setFillColor(GREEN); doc.rect(LM, y, 4, 70, 'F');
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(GREEN);
    doc.text('PRICE ADJUSTMENT', LM + 16, y + 16);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(DARK);
    doc.text('Original Offer: ' + fmtM(d.originalAcq), LM + 16, y + 32);
    doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(GREEN);
    doc.text('New Adjusted Offer: ' + fmtM(d.newAcq), LM + 16, y + 52);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(GRAY);
    doc.text(d.pctChange + '% adjustment', LM + 380, y + 52);
    y += 90;

    // Summary table
    doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(DARK);
    doc.text('Underwriting Summary', LM, y); y += 20;
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor('#a0aec0');
    doc.text('ITEM', LM, y); doc.text('ORIGINAL', 290, y, { align: 'right' }); doc.text('REVISED', 400, y, { align: 'right' }); doc.text('DIFFERENCE', 520, y, { align: 'right' });
    y += 6; doc.setDrawColor('#e2e8f0'); doc.setLineWidth(1); doc.line(LM, y, 562, y); y += 14;

    function tblRow(label, orig, revised, bold) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(10); doc.setTextColor(DARK);
      doc.text(label, LM, y); doc.text(fmtM(orig), 290, y, { align: 'right' }); doc.text(fmtM(revised), 400, y, { align: 'right' });
      var diff = revised - orig;
      doc.setTextColor(diff < 0 ? RED : diff > 0 ? GREEN : GRAY);
      doc.text(fmtMSign(diff), 520, y, { align: 'right' });
      y += 18; doc.setDrawColor('#f7fafc'); doc.line(LM, y - 4, 562, y - 4);
    }
    tblRow('After Repair Value (ARV)', d.originalARV, d.newARV, false);
    tblRow('Repair Estimate', d.originalRehab, d.newRehab, false);
    tblRow('Acquisition Price', d.originalAcq, d.newAcq, true);

    if (d.estimatedDispo) {
      y += 4;
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(GRAY);
      doc.text('Estimated Investor Purchase Price: ' + fmtM(d.estimatedDispo) + '   |   County Tier: ' + (d.countyTier != null ? d.countyTier : 'N/A'), LM, y);
      y += 20;
    }

    // Narrative
    y += 10;
    doc.setDrawColor(ACCENT); doc.setLineWidth(2); doc.line(LM, y, 562, y); y += 16;
    doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(DARK);
    doc.text('Underwriter Assessment', LM, y); y += 16;

    var narrative = 'After a thorough review of the marketplace activity and investor feedback for the property at ' + d.address + ', Rebuilt\'s underwriting team has determined that a price adjustment is necessary to align the acquisition cost with current market conditions and investor expectations.\n\n';

    if (d.countyTier != null) {
      if (d.countyTier <= 4) {
        narrative += 'This property is located in a County Tier ' + d.countyTier + ' market, which indicates lower investor demand and tighter margins. Investors in this tier typically require steeper discounts to offset higher risk and longer hold times.\n\n';
      } else if (d.countyTier <= 8) {
        narrative += 'This property is located in a County Tier ' + d.countyTier + ' market with moderate investor demand. Buyers in this range are price-sensitive and require competitive acquisition costs to achieve acceptable returns.\n\n';
      } else {
        narrative += 'This property is located in a County Tier ' + d.countyTier + ' market with healthy investor demand.\n\n';
      }
    }

    if (d.newRehab > d.originalRehab) {
      narrative += 'Additionally, estimated repair costs have been revised upward from ' + fmtM(d.originalRehab) + ' to ' + fmtM(d.newRehab) + ', reflecting updated scope and current material/labor pricing. This increase further compresses investor margins and supports the need for a lower acquisition price.\n\n';
    }

    narrative += 'Rebuilt remains committed to closing this transaction and believes the adjusted offer of ' + fmtM(d.newAcq) + ' (a ' + Math.abs(d.pctChange) + '% adjustment) accurately reflects the property\'s current market value and allows both parties to move forward to a successful closing.';

    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(DARK);
    var lines = doc.splitTextToSize(narrative, PW);
    doc.text(lines, LM, y); y += lines.length * 14;

    // Pro forma notes page
    if (d.uwNotes) {
      if (y > 600) { doc.addPage(); y = 60; }
      y += 20;
      doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(DARK);
      doc.text('Pro Forma Notes', LM, y); y += 6;
      doc.setDrawColor('#e2e8f0'); doc.setLineWidth(1); doc.line(LM, y, 562, y); y += 14;
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(GRAY);
      var noteLines = doc.splitTextToSize(d.uwNotes, PW);
      doc.text(noteLines, LM, y);
    }

    // Photo pages — load images and add them
    if (d.photoUrls && d.photoUrls.length > 0) {
      var loaded = 0;
      var imgDataArr = [];
      var total = Math.min(d.photoUrls.length, 21);

      function addPhotoPagesToDoc() {
        var perPage = 9, imgW = 160, imgH = 120, gapX = 16, gapY = 16, startX = LM, startY = 70;
        var validImgs = imgDataArr.filter(function (x) { return x !== null; });
        for (var p = 0; p < validImgs.length; p += perPage) {
          doc.addPage();
          doc.setFillColor(BLUE); doc.rect(0, 0, 612, 50, 'F');
          doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor('#ffffff');
          doc.text('REBUILT', LM, 32);
          doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor('#bee3f8');
          doc.text('UNDERWRITING SUMMARY', 130, 32);

          var pageNum = Math.floor(p / perPage) + 1;
          var totalPages = Math.ceil(validImgs.length / perPage);
          doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(DARK);
          doc.text('Property Photos (' + pageNum + '/' + totalPages + ')', LM, 62);

          var batch = validImgs.slice(p, p + perPage);
          batch.forEach(function (imgData, i) {
            var row = Math.floor(i / 3);
            var col = i % 3;
            var x = startX + col * (imgW + gapX);
            var iy = startY + row * (imgH + gapY);
            try { doc.addImage(imgData, 'JPEG', x, iy, imgW, imgH); } catch (e) { /* skip */ }
          });
        }
        // Footer
        doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor('#a0aec0');
        doc.text('Generated on ' + dateStr, 306, 760, { align: 'center' });
        doc.save('Retrade_' + d.address.replace(/[^a-zA-Z0-9]/g, '_') + '.pdf');
      }

      for (var pi = 0; pi < total; pi++) {
        (function (idx) {
          var img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = function () {
            var canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
            canvas.getContext('2d').drawImage(img, 0, 0);
            try { imgDataArr[idx] = canvas.toDataURL('image/jpeg', 0.7); } catch (e) { imgDataArr[idx] = null; }
            loaded++;
            if (loaded === total) addPhotoPagesToDoc();
          };
          img.onerror = function () { imgDataArr[idx] = null; loaded++; if (loaded === total) addPhotoPagesToDoc(); };
          img.src = d.photoUrls[idx];
        })(pi);
      }
    } else {
      // No photos — just save
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor('#a0aec0');
      doc.text('Generated on ' + dateStr, 306, 760, { align: 'center' });
      doc.save('Retrade_' + d.address.replace(/[^a-zA-Z0-9]/g, '_') + '.pdf');
    }
  }

  function createPrInput(label, defaultVal) {
    var wrapper = el('div', { className: 'pr-input-group' });
    wrapper.appendChild(el('label', null, label));
    var input = el('input', {
      type: 'number',
      className: 'pr-input',
      value: defaultVal != null ? String(defaultVal) : '',
      placeholder: '0',
    });
    wrapper.appendChild(input);
    return { wrapper: wrapper, input: input };
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    renderNav();
    // If user has ARV Training progress, boot into ARV Training directly
    var email = getEmail();
    if (email && (isPresentationDone() || isCompAnalysisDone())) {
      bootArvTraining();
    } else if (email) {
      // Signed in but no progress - still go to ARV Training (sign-in flow)
      bootArvTraining();
    } else {
      renderLandingPage();
    }
  });

})();
