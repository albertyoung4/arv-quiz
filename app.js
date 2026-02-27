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
  var STORAGE_COMP_DONE = 'rebuilt_arv_comp_done';

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
  // Navigation Config
  // ---------------------------------------------------------------------------

  var NAV_CONFIG = [
    { id: 'tech-training', label: 'Tech Training', icon: '\uD83D\uDCBB',
      items: [
        { id: 'hubspot',     label: 'Hubspot',     handler: null },
        { id: 'apv2',        label: 'APv2',         handler: null },
        { id: 'five9',       label: 'Five9',        handler: null },
        { id: 'housecanary', label: 'HouseCanary',  handler: null },
      ]
    },
    { id: 'sales-training', label: 'Sales Training', icon: '\uD83D\uDCBC',
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
    { id: 'materials', label: 'Materials', icon: '\uD83D\uDCDA',
      items: [
        { id: 'materials-library', label: 'Video Library', handler: 'renderMaterials' },
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
      fetch(SHEETS_URL, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'slackSalesDiploma', name: name, email: email }),
      });
      localStorage.setItem(STORAGE_SALES_SLACK_POSTED, 'true');
    } catch (_) {}
  }

  function logSalesToSheets(levelId, levelTitle, passed, score) {
    if (!SHEETS_URL || SHEETS_URL === 'DEPLOY_URL_PLACEHOLDER') return;
    try {
      fetch(SHEETS_URL, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'salesTraining',
          email: getEmail() || '',
          dateTime: new Date().toISOString(),
          level: levelTitle,
          result: passed ? 'Pass' : 'Fail',
          score: score + '/10',
        }),
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
    try {
      fetch(SHEETS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload),
      });
    } catch (_) {}
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
      fetch(SHEETS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'slackDiploma',
          name: name,
          email: email,
        }),
      });
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

    function handleCompSubmit() {
      var checkedIds = Object.keys(selectedIssues).filter(function (k) { return selectedIssues[k]; });
      if (checkedIds.length === 0 && !goodCompSelected) {
        errorMsg.style.display = 'block';
        return;
      }

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
    grid.appendChild(compCard);

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
