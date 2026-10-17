/* Niche content: daily prompts, weak hooks to rewrite, strong example hooks and lessons. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LIContent = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NICHES = {
    food: {
      label: 'Food', emoji: '🍛',
      keywords: ['food', 'recipe', 'chai', 'dosa', 'biryani', 'cafe', 'street', 'restaurant', 'thali', 'cook', 'kitchen', 'taste', 'menu', 'snack', 'momos', 'paneer', 'masala', 'coffee', 'brunch', 'khana'],
      prompts: [
        'The best thing you ate this week under ₹150',
        'A dish everyone in your city orders wrong',
        'One kitchen shortcut your mom taught you',
        'A cafe you would take a first date to, and why',
        'The most overrated food spot near you'
      ],
      weak: ['Today I went to a cafe', 'Here is a recipe for pasta', 'This food was very nice'],
      strong: [
        'This ₹80 dosa in Koramangala beats every ₹400 brunch I have had',
        'I ruined 40 rotis before my nani told me this one trick',
        'Stop ordering the butter chicken here. Get this instead.'
      ]
    },
    fitness: {
      label: 'Fitness', emoji: '🏋️',
      keywords: ['gym', 'workout', 'protein', 'fat', 'muscle', 'run', 'yoga', 'diet', 'reps', 'squat', 'cardio', 'kg', 'weight', 'abs', 'steps', 'fitness'],
      prompts: [
        'One gym mistake you made for a whole year',
        'A ₹0 workout someone can do in a hostel room',
        'What you eat in a day on a student budget',
        'The exercise everyone skips that they should not',
        'Your honest 30-day progress, no filters'
      ],
      weak: ['Here is my workout', 'Do this exercise for abs', 'Fitness is important guys'],
      strong: [
        'I lost 8 kg without giving up rice. Here is the only rule I followed.',
        'You are doing push-ups wrong, and your shoulders know it',
        'This 12-minute hostel-room workout replaced my gym membership'
      ]
    },
    tech: {
      label: 'Tech', emoji: '📱',
      keywords: ['phone', 'app', 'ai', 'laptop', 'android', 'iphone', 'code', 'gadget', 'setup', 'feature', 'battery', 'camera', 'upi', 'tool', 'chatgpt', 'claude', 'settings'],
      prompts: [
        'A hidden setting on Android that saves battery',
        'The ₹2,000 gadget that changed your desk setup',
        'An AI tool that saved you an hour this week',
        'Phone A vs phone B, the one thing reviews miss',
        'A UPI or banking app feature most people ignore'
      ],
      weak: ['Today I will review this phone', 'Some tech tips for you', 'This is a nice app'],
      strong: [
        'Your Android has a battery setting turned off by default. Turn it on.',
        'I replaced 4 apps with this one free tool',
        'Every ₹15,000 phone review skips this one test'
      ]
    },
    fashion: {
      label: 'Fashion', emoji: '👗',
      keywords: ['outfit', 'style', 'kurta', 'saree', 'thrift', 'shoes', 'look', 'wear', 'brand', 'sneakers', 'fit', 'colour', 'color', 'wardrobe', 'ethnic', 'jeans'],
      prompts: [
        'Three outfits from one kurta',
        'A thrift find under ₹500 that looks expensive',
        'The colour rule that fixed your wardrobe',
        'What to wear to an office party in Bangalore weather',
        'A trend you tried and regret'
      ],
      weak: ['My outfit of the day', 'Some fashion tips', 'Look at this dress'],
      strong: [
        'One ₹600 kurta, five completely different looks',
        'Stop pairing black with brown until you see this',
        'This Sarojini find gets more compliments than my designer bag'
      ]
    },
    comedy: {
      label: 'Comedy', emoji: '😂',
      keywords: ['when', 'mom', 'dad', 'friend', 'office', 'boss', 'college', 'relatable', 'pov', 'auto', 'traffic', 'exam', 'roommate', 'wedding', 'relatives', 'aunty'],
      prompts: [
        'POV: your relatives at a wedding asking about your salary',
        'Every Bangalore auto driver ever',
        'The group chat after someone says "plan cancel"',
        'Your mom finding your Swiggy history',
        'Office meeting that should have been an email'
      ],
      weak: ['Funny video', 'This is so relatable', 'Watch till end'],
      strong: [
        'POV: you said "just 5 minutes away" and you have not left home yet',
        'My mom found my Swiggy bill. This is my last video.',
        'Every relative at a shaadi has exactly one question for you'
      ]
    },
    education: {
      label: 'Education', emoji: '📚',
      keywords: ['learn', 'exam', 'study', 'tips', 'notes', 'english', 'jee', 'neet', 'upsc', 'college', 'skill', 'course', 'explain', 'concept', 'interview', 'resume'],
      prompts: [
        'One study method that doubled your focus',
        'Explain a hard concept in 30 seconds',
        'The resume mistake that gets freshers rejected',
        'An English word Indians use differently',
        'How you would prepare for an exam with 7 days left'
      ],
      weak: ['Study tips for students', 'Today we will learn about', 'Important for exams'],
      strong: [
        'I cleared my exam studying 3 hours a day. The trick was when, not how long.',
        'Recruiters reject 70% of fresher resumes for this one line',
        'You have been saying "revert back" wrong this whole time'
      ]
    },
    finance: {
      label: 'Finance', emoji: '💰',
      keywords: ['money', 'save', 'salary', 'invest', 'sip', 'tax', 'budget', 'credit', 'card', 'loan', 'upi', '₹', 'rupees', 'lakh', 'paisa', 'spend'],
      prompts: [
        'How you split your first salary',
        'A money habit you learned too late',
        'The hidden cost of "no-cost EMI"',
        'Budgeting a month in a new city',
        'One credit card mistake to avoid'
      ],
      weak: ['Money tips', 'How to save money', 'Finance is important'],
      strong: [
        'My first ₹30,000 salary disappeared in 9 days. Here is where it went.',
        '"No-cost EMI" cost me ₹2,400. Read the fine print with me.',
        'Stop saving what is left after spending. Do this instead.'
      ]
    },
    travel: {
      label: 'Travel', emoji: '🧳',
      keywords: ['trip', 'travel', 'goa', 'manali', 'budget', 'hostel', 'train', 'flight', 'beach', 'mountain', 'itinerary', 'visa', 'stay', 'road', 'weekend', 'kerala', 'ladakh'],
      prompts: [
        'A weekend trip from your city under ₹5,000',
        'One thing you would never pack again',
        'The tourist trap and the local alternative',
        'Your cheapest-ever train journey',
        'A hidden spot most itineraries miss'
      ],
      weak: ['My Goa trip vlog', 'Travel with me', 'Beautiful place'],
      strong: [
        '3 days in Gokarna for ₹4,200, including the bus',
        'Skip Baga beach. Locals go 20 minutes south.',
        'I packed for Manali wrong so you do not have to'
      ]
    },
    other: {
      label: 'Other', emoji: '✨',
      keywords: ['how', 'why', 'tip', 'story', 'first', 'day', 'life', 'learned', 'mistake', 'secret', 'truth'],
      prompts: [
        'Something you learned the hard way this year',
        'A small habit that changed your week',
        'The question people always ask you',
        'A before-and-after from your own life',
        'One opinion people around you disagree with'
      ],
      weak: ['New video', 'Watch this', 'Something interesting'],
      strong: [
        'I did this one thing every morning for 30 days. Day 12 surprised me.',
        'Nobody told me this before my first job',
        'The most useful thing I own cost ₹99'
      ]
    }
  };

  const GOALS = [
    { id: 'start', label: 'Start posting', sub: 'I have not posted much yet' },
    { id: 'grow', label: 'Grow my page', sub: 'I post, but growth is slow' },
    { id: 'earn', label: 'Earn from content', sub: 'I want brand deals' }
  ];

  const LESSONS = [
    { id: 'l1', title: 'The 3-second rule', body: 'Most viewers decide to scroll in the first 3 seconds. Say the most surprising thing first, then explain. Never open with a greeting.', q: 'Which opening keeps more viewers?', options: ['Hi guys, welcome back to my channel', 'I wasted ₹20,000 before learning this'], answer: 1 },
    { id: 'l2', title: 'Open a loop', body: 'A loop is a question the viewer needs answered. "I ruined 40 rotis before I found this" makes people stay to learn what "this" is.', q: 'Which line opens a loop?', options: ['Here is my roti recipe', 'My nani fixed my rotis with one change'], answer: 1 },
    { id: 'l3', title: 'Specific beats general', body: 'Numbers, places and prices make a hook feel real. "Cheap food in Bangalore" is forgettable. "₹80 dosa in Koramangala" is not.', q: 'Which is more specific?', options: ['Good cafes near me', '3 cafes in Indiranagar with ₹150 coffee'], answer: 1 },
    { id: 'l4', title: 'One video, one idea', body: 'Short videos work best when they deliver exactly one payoff. If you have three tips, that is three videos.', q: 'You have 3 travel hacks. What do you post?', options: ['One 60-second video with all three', 'Three short videos, one hack each'], answer: 1 },
    { id: 'l5', title: 'Ask for a specific action', body: '"Like and subscribe" is wallpaper. "Save this for your next Goa trip" gives the viewer a reason, and saves tell the algorithm your post is useful.', q: 'Which call to action is stronger?', options: ['Save this for your next Goa trip', 'Like, share and subscribe'], answer: 0 },
    { id: 'l6', title: 'Consistency is a schedule', body: 'Pick days you can actually keep, like Tuesday and Saturday. A small schedule you keep beats a big one you abandon in week two.', q: 'Which plan is more likely to work?', options: ['Post every day starting tomorrow', 'Post twice a week on fixed days'], answer: 1 },
    { id: 'l7', title: 'Read your own numbers', body: 'Compare each post to your own average, not to famous creators. A post that does 2x your usual views is a win at any size.', q: 'Your posts usually get 300 views. This one got 700. That is…', options: ['A flop, big creators get millions', 'Your best result yet, study what worked'], answer: 1 },
    { id: 'l8', title: 'Why buying views backfires', body: 'Bought views and followers do not watch or engage, so your engagement rate drops and the algorithm shows you to fewer real people. Brands also check for it.', q: 'What happens after buying 5,000 followers?', options: ['Real reach usually drops', 'The algorithm rewards you'], answer: 0 }
  ];

  return { NICHES, GOALS, LESSONS };
});
