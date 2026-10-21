export const STYLE_NAMES = ['Minimalist', 'Streetwear', 'Casual Chic', 'Classic', 'Bohemian', 'Vintage'];
export const STYLE_LABELS = {
  Minimalist: { tr: 'Minimal', en: 'Minimal' }, Streetwear: { tr: 'Sokak stili', en: 'Streetwear' },
  'Casual Chic': { tr: 'Günlük şık', en: 'Casual chic' }, Classic: { tr: 'Klasik', en: 'Classic' },
  Bohemian: { tr: 'Bohem', en: 'Bohemian' }, Vintage: { tr: 'Vintage', en: 'Vintage' },
};
const option = (id, tr, en, scores) => ({ id, label: { tr, en }, scores });
export const STYLE_QUESTIONS = [
  { id: 'aesthetic', title: { tr: 'Hangi görünüm sana daha yakın?', en: 'Which look feels most like you?' }, options: [
    option('minimal', 'Sade çizgiler, az ve öz detay', 'Clean lines, simple details', { Minimalist: 4, Classic: 1 }),
    option('street', 'Oversize, sneaker ve güçlü detaylar', 'Oversized fits, sneakers, bold details', { Streetwear: 4, Vintage: 1 }),
    option('classic', 'Zamansız, özenli ve şık parçalar', 'Timeless, polished pieces', { Classic: 4, 'Casual Chic': 1 }),
    option('casual', 'Rahat ama özenli günlük kombinler', 'Relaxed but put-together everyday outfits', { 'Casual Chic': 4, Minimalist: 1 }),
    option('boho', 'Doğal dokular ve akışkan katmanlar', 'Natural textures and flowing layers', { Bohemian: 4, Vintage: 1 }),
    option('vintage', 'Retro parçalar ve karakterli detaylar', 'Retro pieces and distinctive details', { Vintage: 4, Streetwear: 1 }),
  ] },
  { id: 'fit', title: { tr: 'Hangi kesimde daha iyi hissedersin?', en: 'Which fit feels best?' }, options: [
    option('relaxed', 'Bol ve hareket özgürlüğü veren', 'Loose and easy to move in', { Streetwear: 2, Bohemian: 1 }),
    option('regular', 'Ne dar ne bol, dengeli', 'Balanced, neither tight nor loose', { Minimalist: 2, 'Casual Chic': 1 }),
    option('tailored', 'Yapılı, vücuda oturan kesimler', 'Structured and tailored', { Classic: 2, 'Casual Chic': 1 }),
    option('flowing', 'Akışkan, katmanlı ve yumuşak', 'Flowing, layered and soft', { Bohemian: 2, Vintage: 1 }),
  ] },
  { id: 'palette', title: { tr: 'En çok hangi renklere uzanırsın?', en: 'Which colors do you reach for?' }, options: [
    option('neutral', 'Siyah, beyaz, gri ve bej', 'Black, white, gray and beige', { Minimalist: 2, Classic: 1 }),
    option('earth', 'Toprak, zeytin ve sıcak kahveler', 'Earth, olive and warm brown', { Bohemian: 2, Vintage: 1 }),
    option('soft', 'Pastel ve yumuşak tonlar', 'Pastels and soft tones', { 'Casual Chic': 2, Classic: 1 }),
    option('bold', 'Canlı renkler ve kontrast', 'Bright colors and contrast', { Streetwear: 2, Vintage: 1 }),
  ] },
  { id: 'occasion', title: { tr: 'Kombinlerini en çok nerede giyeceksin?', en: 'Where will you wear most outfits?' }, options: [
    option('everyday', 'Okul ve günlük şehir hayatı', 'School and everyday city life', { 'Casual Chic': 2, Streetwear: 1 }),
    option('work', 'Ofis ve profesyonel ortamlar', 'Office and professional settings', { Classic: 2, Minimalist: 1 }),
    option('social', 'Buluşmalar, kafeler ve etkinlikler', 'Meetups, cafés and events', { 'Casual Chic': 2, Vintage: 1 }),
    option('outdoors', 'Açık hava, geziler ve rahat günler', 'Outdoors, trips and relaxed days', { Bohemian: 2, Streetwear: 1 }),
  ] },
  { id: 'priority', title: { tr: 'Bir kombinde önceliğin ne?', en: 'What matters most in an outfit?' }, options: [
    option('comfort', 'Gün boyu rahat hissetmek', 'Feeling comfortable all day', { Streetwear: 1, 'Casual Chic': 1, Bohemian: 1 }),
    option('versatile', 'Az parçayla çok kombin yapmak', 'Making many outfits with a few pieces', { Minimalist: 2, 'Casual Chic': 1 }),
    option('polished', 'Derli toplu ve şık görünmek', 'Looking polished and elegant', { Classic: 2, 'Casual Chic': 1 }),
    option('expression', 'Kendimi farklı ve yaratıcı ifade etmek', 'Expressing myself creatively', { Vintage: 2, Bohemian: 1, Streetwear: 1 }),
  ] },
];

export function scoreStyleProfile(answers) {
  const scores = Object.fromEntries(STYLE_NAMES.map(name => [name, 0]));
  const clean = {};
  for (const question of STYLE_QUESTIONS) {
    const selected = question.options.find(choice => choice.id === answers?.[question.id]);
    if (!selected) throw new Error('Complete every style question.');
    clean[question.id] = selected.id;
    for (const [style, score] of Object.entries(selected.scores)) scores[style] += score;
  }
  // In a tie, the explicitly chosen aesthetic has priority.
  const aesthetic = STYLE_QUESTIONS[0].options.find(choice => choice.id === clean.aesthetic);
  const ranked = [...STYLE_NAMES].sort((a, b) => scores[b] - scores[a] || (aesthetic.scores[b] || 0) - (aesthetic.scores[a] || 0) || STYLE_NAMES.indexOf(a) - STYLE_NAMES.indexOf(b));
  return { version: 1, answers: clean, primary: ranked[0], secondary: ranked[1], scores };
}

export function profileDetails(profile, lang = 'tr') {
  if (!profile) return [];
  return STYLE_QUESTIONS.map(question => ({
    question: question.title[lang],
    answer: question.options.find(choice => choice.id === profile.answers[question.id])?.label[lang] || '',
  }));
}

export function styleContext(profile, legacyStyle, lang) {
  if (!profile) return lang === 'tr' ? `Seçilen tarz: ${legacyStyle}. Ayrıntılı stil testi henüz tamamlanmadı.` : `Selected style: ${legacyStyle}. Detailed style test not completed.`;
  return JSON.stringify({ primary: profile.primary, secondary: profile.secondary, preferences: profileDetails(profile, lang) });
}

export function parseAIJson(text) {
  const json = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  return JSON.parse(json);
}

export function selectOutfitItems(ids, wardrobe) {
  if (!Array.isArray(ids) || !ids.length) throw new Error('AI did not select any items.');
  const available = new Map(wardrobe.filter(item => !item.isDirty).map(item => [String(item.id), item]));
  const unique = [...new Set(ids.map(String))];
  if (unique.some(id => !available.has(id))) throw new Error('AI selected unavailable items.');
  return unique.map(id => available.get(id));
}
