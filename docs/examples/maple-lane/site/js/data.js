// Maple Lane Bakery — data source
// Loaded BEFORE js/app.js (plain <script>, no modules).
// app.js references these globals; do not redeclare them elsewhere.

const MENU = [
  // Pastries
  { id: 'p-croissant', name: 'Butter Croissant', price: 4.5, category: 'Pastries', tags: ['v'], emoji: '🥐' },
  { id: 'p-almond', name: 'Almond Croissant', price: 5.0, category: 'Pastries', tags: ['v'], emoji: '🥮' },
  { id: 'p-pain', name: 'Pain au Chocolat', price: 4.75, category: 'Pastries', tags: ['v'], emoji: '🍫' },
  { id: 'p-kiwi', name: 'Honey-Glazed Kiwi Danish', price: 5.25, category: 'Pastries', tags: ['v'], emoji: '🥝' },
  { id: 'p-bun', name: 'Cinnamon Morning Bun', price: 4.25, category: 'Pastries', tags: ['v'], emoji: '🌀' },

  // Cakes
  { id: 'c-carrot', name: 'Carrot Cake Slice', price: 6.0, category: 'Cakes', tags: ['v'], emoji: '🥕' },
  { id: 'c-vegan', name: 'Vegan Chocolate Fudge Slice', price: 6.5, category: 'Cakes', tags: ['vg', 'gf'], emoji: '🍫' },
  { id: 'c-lemon', name: 'Lemon Drizzle Slice', price: 5.5, category: 'Cakes', tags: ['v'], emoji: '🍋' },
  { id: 'c-redvelvet', name: 'Red Velvet Slice', price: 6.0, category: 'Cakes', tags: [], emoji: '❤️' },

  // Coffee
  { id: 'c-cappuccino', name: 'Cappuccino', price: 4.25, category: 'Coffee', tags: ['v'], emoji: '☕' },
  { id: 'c-latte', name: 'Oat-Milk Latte', price: 5.0, category: 'Coffee', tags: ['vg'], emoji: '🥛' },
  { id: 'c-mocha', name: 'Hazelnut Mocha', price: 5.25, category: 'Coffee', tags: ['v'], emoji: '🌰' },
  { id: 'c-tea', name: 'Chamomile Honey Tea', price: 3.75, category: 'Coffee', tags: ['vg', 'gf'], emoji: '🍵' },

  // Breads
  { id: 'b-sourdough', name: 'Country Sourdough Loaf', price: 8.0, category: 'Breads', tags: ['v'], emoji: '🍞' },
  { id: 'b-baguette', name: 'Baguette', price: 4.0, category: 'Breads', tags: ['v'], emoji: '🥖' },
  { id: 'b-gf-rye', name: 'Gluten-Free Seeded Rye', price: 6.5, category: 'Breads', tags: ['v', 'gf'], emoji: '🌾' },
  { id: 'b-brioche', name: 'Vanilla Brioche Roll', price: 3.5, category: 'Breads', tags: ['v'], emoji: '🥯' }
];

const REVIEWS = [
  { name: 'Priya N.', rating: 5, date: '2024-09-14', text: 'The butter croissants are genuinely the best in town — flaky, golden, and gone before I even get home. The morning bun is my weakness.' },
  { name: 'Marcus T.', rating: 5, date: '2024-08-30', text: 'Ordered a pickup for a birthday and it was ready exactly on time, beautifully boxed. The vegan fudge slice even impressed my non-vegan friends.' },
  { name: 'Elena R.', rating: 4, date: '2024-08-11', text: 'Lovely little corner spot. The oat-milk latte is silky and the sourdough has a perfect crust. Only wish they opened on Sundays!' },
  { name: 'Devon K.', rating: 5, date: '2024-07-22', text: 'Warm, friendly, and the lemon drizzle slice is a small masterpiece. You can tell everything is made by hand here.' },
  { name: 'Sofia M.', rating: 5, date: '2024-06-05', text: 'The gluten-free rye actually tastes like real bread — I was skeptical and I am converted. Staff were so kind about my allergy.' },
  { name: 'James O.', rating: 4, date: '2024-05-18', text: 'Great cappuccino and the cinnamon bun is dangerously good. Gets busy around 9am, so come early or grab a pickup slot.' }
];

const GALLERY = [
  { emoji: '🥐', alt: 'Butter croissant with flaky golden layers' },
  { emoji: '🍫', alt: 'Choc-chip chocolate fudge slice' },
  { emoji: '☕', alt: 'Steaming cappuccino in a ceramic cup' },
  { emoji: '🥖', alt: 'Crusty country baguette' },
  { emoji: '🍋', alt: 'Lemon drizzle cake slice' },
  { emoji: '🌀', alt: 'Swirled cinnamon morning bun' },
  { emoji: '🌾', alt: 'Seeded gluten-free rye loaf' },
  { emoji: '🥕', alt: 'Carrot cake with cream cheese frosting' },
  { emoji: '🍵', alt: 'Chamomile honey tea in a glass pot' },
  { emoji: '🌰', alt: 'Hazelnut mocha topped with dusted cocoa' },
  { emoji: '🥯', alt: 'Soft vanilla brioche roll' },
  { emoji: '❤️', alt: 'Red velvet slice with white frosting' }
];

// day indices 0–6 map to new Date().getDay() (0 = Sunday).
const HOURS = [
  { day: 'Sunday', open: '8:00 AM', close: '2:00 PM' },
  { day: 'Monday', open: '7:30 AM', close: '4:00 PM' },
  { day: 'Tuesday', open: '7:30 AM', close: '4:00 PM' },
  { day: 'Wednesday', open: '7:30 AM', close: '4:00 PM' },
  { day: 'Thursday', open: '7:30 AM', close: '4:00 PM' },
  { day: 'Friday', open: '7:30 AM', close: '5:00 PM' },
  { day: 'Saturday', open: '8:00 AM', close: '5:00 PM' }
];

const BAKERY_INFO = {
  name: 'Maple Lane Bakery',
  addressLines: ['12 Maple Lane', 'Riverside, OR 97201'],
  phone: '(503) 555-0142',
  email: 'hello@maplelanebakery.example',
  // pickup window (used to bound the date/time pickers)
  earliestPickup: '9:00 AM',
  latestPickup: '3:30 PM'
};