// Curated Unsplash License photos; these are not a live Pinterest feed.
// Each photo retains its source and photographer attribution in the interface.
export const INSPIRATIONS = [
  { id: 'black-city', styles: ['Minimalist', 'Casual Chic'], title: { tr: 'Şehirde siyah tonlar', en: 'Black tones in the city' },
    tag: 'Black jeans, black top, ankle boots; urban neutral layers', photographer: 'Masoud Razeghi',
    image: 'https://images.unsplash.com/photo-1780757786444-fb8955c18230?auto=format&fit=crop&w=720&q=80',
    source: 'https://unsplash.com/photos/A0YlCg2iu2k' },
  { id: 'street-duo', styles: ['Streetwear', 'Vintage'], title: { tr: 'Sokaktan iki görünüm', en: 'Two street looks' },
    tag: 'Street fashion with individual styling; relaxed city outfits', photographer: 'Karla Martinez',
    image: 'https://images.unsplash.com/photo-1526692202263-843e30c353e8?auto=format&fit=crop&w=720&q=80',
    source: 'https://unsplash.com/photos/CCRw_jYeUoY' },
  { id: 'tailored', styles: ['Classic', 'Minimalist'], title: { tr: 'Klasik terzilik', en: 'Classic tailoring' },
    tag: 'Tailored dark suit jacket, polished formal menswear', photographer: 'Gian Paolo Aliatis',
    image: 'https://images.unsplash.com/photo-1595845824331-dce53124717d?auto=format&fit=crop&w=720&q=80',
    source: 'https://unsplash.com/photos/ASF3OD0FoyU' },
  { id: 'warm-coat', styles: ['Casual Chic', 'Vintage', 'Classic'], title: { tr: 'Sıcak tonlu şehir katmanları', en: 'Warm city layers' },
    tag: 'Brown coat with boots, warm neutral street layers', photographer: 'weston m',
    image: 'https://images.unsplash.com/photo-1591025810333-6225ab01d8f8?auto=format&fit=crop&w=720&q=80',
    source: 'https://unsplash.com/photos/w-83h_clkvI' },
  { id: 'floral-linen', styles: ['Bohemian', 'Casual Chic'], title: { tr: 'Desen ve doğal dokular', en: 'Patterns and natural textures' },
    tag: 'Red floral linen outfit with wide-leg trousers and flowing fabric', photographer: 'IMANA',
    image: 'https://images.unsplash.com/photo-1768289222413-2ed4528bee86?auto=format&fit=crop&w=720&q=80',
    source: 'https://unsplash.com/photos/hkbmWMx_PHs' },
];

export function inspirationFeed(filter, preferredStyle) {
  const filtered = filter === 'all' ? [...INSPIRATIONS] : INSPIRATIONS.filter(item => item.styles.includes(filter));
  return filtered.sort((a, b) => Number(b.styles.includes(preferredStyle)) - Number(a.styles.includes(preferredStyle)));
}

export async function loadInspirationImage(item) {
  if (item.base64) return { data: item.base64, mimeType: item.mimeType || 'image/jpeg' };
  const response = await fetch(item.image);
  if (!response.ok) throw new Error('Could not load inspiration photo.');
  const blob = await response.blob();
  if (!blob.type.startsWith('image/') || blob.size > 6 * 1024 * 1024) throw new Error('Invalid inspiration photo.');
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(blob);
  });
  return { data, mimeType: blob.type };
}
