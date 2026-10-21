import React, { useEffect, useRef, useState } from 'react';
import { Image, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ArrowRight, Camera, Check, Sparkles } from 'lucide-react-native';
import { INSPIRATIONS } from './inspirations';

const SAMPLE_WARDROBE = require('./assets/onboarding/sample-wardrobe.png');
export const ONBOARDING_KEY = 'aura_onboarding_v1';
export const ONBOARDING_SLIDES = [
  { title: { tr: 'Dolabını cebine taşı', en: 'Your closet, in your pocket' }, description: { tr: 'Kıyafetlerini fotoğrafla. Renkleri ve türleriyle düzenli bir gardrop oluştur.', en: 'Photograph your clothes and organize your wardrobe by color and category.' } },
  { title: { tr: 'Tarzını keşfet', en: 'Find what feels like you' }, description: { tr: 'Beş kısa soruyu yanıtla. Sevdiğin kesimler ve renkler kombinlerine yön versin.', en: 'Answer five quick questions. Let your favorite fits and colors guide your outfits.' } },
  { title: { tr: 'Bugün ne giyeceğini birlikte seçelim', en: 'Make more of what you own' }, description: { tr: 'Dolabındaki temiz parçalar, tarzın ve hava durumuyla yeni kombin fikirleri al.', en: 'Get outfit ideas using your clean clothes, style preferences and the weather.' } },
  { title: { tr: 'Beğendiğin görünümü kendine uyarla', en: 'See a look. Make it yours.' }, description: { tr: 'İlham fotoğrafını dolabınla eşleştir. Mağazada beğendiğin kıyafeti de asistana sor.', en: 'Match inspiration with your closet, or ask your stylist about a piece you find in a store.' } },
];

export default function Onboarding({ visible, lang, onComplete }) {
  const [step, setStep] = useState(0);
  const [width, setWidth] = useState(320);
  const pager = useRef(null);
  useEffect(() => { if (visible) { setStep(0); pager.current?.scrollTo({ x: 0, animated: false }); } }, [visible]);
  useEffect(() => { pager.current?.scrollTo({ x: step * width, animated: false }); }, [width]);
  const go = index => { setStep(index); pager.current?.scrollTo({ x: index * width, animated: true }); };
  const last = step === ONBOARDING_SLIDES.length - 1;
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={() => onComplete('dismiss')}>
      <SafeAreaView style={s.screen}>
        <View style={s.shell}>
          <View style={s.header}>
            <Text style={s.brand}>Aura</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => onComplete('dismiss')} style={s.skip}><Text style={s.muted}>{lang === 'tr' ? 'Atla' : 'Skip'}</Text></TouchableOpacity>
          </View>
          <View style={{ flex: 1 }} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
            <ScrollView ref={pager} horizontal pagingEnabled showsHorizontalScrollIndicator={false} scrollEventThrottle={16} onScroll={event => {
              const next = Math.max(0, Math.min(ONBOARDING_SLIDES.length - 1, Math.round(event.nativeEvent.contentOffset.x / width)));
              setStep(next);
            }}>
              {ONBOARDING_SLIDES.map((slide, index) => (
                <ScrollView key={index} style={{ width }} contentContainerStyle={{ paddingHorizontal: 4, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
                  <View style={[s.visual, { height: Math.min(width * 0.84, 300) }]}>
                    {index === 1 ? <View style={s.testIllustration}>
                      <Sparkles size={30} color="#2A5C6A" />
                      <Text style={s.sampleTitle}>{lang === 'tr' ? 'Nasıl hissetmek istersin?' : 'How do you want to feel?'}</Text>
                      {['Rahat · Comfortable', 'Özenli · Put together', 'Yaratıcı · Creative'].map((answer, i) => <View key={answer} style={[s.answer, i === 0 && { backgroundColor: '#E7F0F0', borderColor: '#2A5C6A' }]}>
                        <Text style={{ color: '#1C1B1A' }}>{lang === 'tr' ? answer.split(' · ')[0] : answer.split(' · ')[1]}</Text>
                        {i === 0 && <Check size={16} color="#2A5C6A" />}
                      </View>)}
                    </View> : index === 3 ? <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 }}>
                      <Image source={{ uri: INSPIRATIONS[0].image }} style={{ flex: 1, height: '100%', borderRadius: 16 }} resizeMode="cover" accessibilityLabel={lang === 'tr' ? 'Örnek ilham fotoğrafı' : 'Example inspiration photo'} />
                      <ArrowRight size={22} color="#2A5C6A" />
                      <Image source={SAMPLE_WARDROBE} style={{ flex: 1, height: '100%', borderRadius: 16 }} resizeMode="contain" accessibilityLabel={lang === 'tr' ? 'Örnek gardrop parçaları' : 'Sample wardrobe pieces'} />
                    </View> : <Image source={SAMPLE_WARDROBE} style={{ width: '100%', height: '100%' }} resizeMode="contain" accessibilityLabel={lang === 'tr' ? 'Beyaz gömlek, bej pantolon, beyaz ayakkabı ve kemerden oluşan örnek gardrop' : 'Sample wardrobe: white shirt, beige trousers, white sneakers and a belt'} />}
                  </View>
                  <Text style={s.example}>{lang === 'tr' ? (index === 1 ? 'ÖRNEK TERCİH' : index === 2 ? 'ÖRNEK KOMBİN' : 'ÖRNEK GARDROP') : (index === 1 ? 'EXAMPLE PREFERENCE' : index === 2 ? 'EXAMPLE OUTFIT' : 'SAMPLE WARDROBE')}</Text>
                  <Text style={s.title}>{slide.title[lang]}</Text>
                  <Text style={s.description}>{slide.description[lang]}</Text>
                  {index === 0 && <View style={s.caption}><Camera size={16} color="#7A6856" /><Text style={s.muted}>{lang === 'tr' ? 'Kamera veya galerinden ekle' : 'Add from your camera or gallery'}</Text></View>}
                  {index === 2 && <Text style={s.muted}>{lang === 'tr' ? 'Beyaz gömlek + bej pantolon + beyaz sneaker' : 'White shirt + beige trousers + white sneakers'}</Text>}
                  {index === 3 && <Text style={s.credit}>{INSPIRATIONS[0].photographer} / Unsplash · {lang === 'tr' ? 'Örnek görseller' : 'Example imagery'}</Text>}
                </ScrollView>
              ))}
            </ScrollView>
          </View>
          <View style={s.footer}>
            <View style={s.dots}>
              {ONBOARDING_SLIDES.map((_, index) => <TouchableOpacity key={index} accessibilityRole="button" accessibilityLabel={`${lang === 'tr' ? 'Sayfa' : 'Page'} ${index + 1}`} accessibilityState={{ selected: step === index }} onPress={() => go(index)} style={{ padding: 8 }}><View style={[s.dot, step === index && s.activeDot]} /></TouchableOpacity>)}
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {step > 0 && <TouchableOpacity accessibilityRole="button" onPress={() => go(step - 1)} style={s.back}><Text>{lang === 'tr' ? 'Geri' : 'Back'}</Text></TouchableOpacity>}
              <TouchableOpacity accessibilityRole="button" style={s.next} onPress={() => last ? onComplete('wardrobe') : go(step + 1)}>
                <Text style={s.nextText}>{last ? (lang === 'tr' ? 'Gardrobumu oluşturmaya başla' : 'Start my wardrobe') : (lang === 'tr' ? 'İleri' : 'Next')}</Text>
                <ArrowRight size={18} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAF8F5' }, shell: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 }, brand: { fontSize: 26, fontWeight: '800', color: '#1C1B1A' }, skip: { padding: 12 },
  visual: { backgroundColor: '#F1EDE7', borderRadius: 24, overflow: 'hidden', marginBottom: 20 }, example: { fontSize: 10, fontWeight: '700', color: '#7A6856', letterSpacing: 1.2, marginBottom: 10 },
  title: { fontSize: 27, lineHeight: 33, fontWeight: '800', color: '#1C1B1A', marginBottom: 12 }, description: { fontSize: 15, lineHeight: 23, color: '#7A6856', marginBottom: 16 }, muted: { fontSize: 13, color: '#7A6856' },
  caption: { flexDirection: 'row', gap: 8, alignItems: 'center' }, credit: { fontSize: 10, color: '#7A6856' }, footer: { paddingBottom: 20, paddingTop: 8 }, dots: { flexDirection: 'row', justifyContent: 'center', marginBottom: 12 }, dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#D9D2C8' }, activeDot: { width: 22, backgroundColor: '#2A5C6A' },
  next: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, backgroundColor: '#1C1B1A', borderRadius: 16, padding: 17 }, nextText: { flexShrink: 1, fontSize: 13, fontWeight: '700', color: '#FFF', textAlign: 'center' }, back: { padding: 17, borderRadius: 16, backgroundColor: '#EDE8E1', justifyContent: 'center' },
  testIllustration: { flex: 1, padding: 20, justifyContent: 'center', gap: 10 }, sampleTitle: { fontSize: 17, fontWeight: '700', marginBottom: 3 }, answer: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#FFF', borderWidth: 1, borderColor: '#EDE8E1', borderRadius: 12, padding: 13 },
});
