import React from 'react';
import { Modal, SafeAreaView, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { STYLE_LABELS, STYLE_QUESTIONS, profileDetails } from './styleProfile';

export default function StyleQuiz({ visible, lang, step, answers, result, onAnswer, onStep, onClose, onSave }) {
  const question = STYLE_QUESTIONS[step];
  const ready = !!question && !!answers[question.id];
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#FAF8F5' }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <Text style={{ color: '#7A6856', fontWeight: '700' }}>{lang === 'tr' ? 'STİLİNİ BUL' : 'FIND YOUR STYLE'}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={onClose} style={{ padding: 10 }}>
              <Text>{lang === 'tr' ? 'Kapat' : 'Close'} ✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ color: '#7A6856', marginBottom: 8 }}>{result ? (lang === 'tr' ? 'Profilin hazır' : 'Your profile is ready') : `${step + 1} / ${STYLE_QUESTIONS.length}`}</Text>
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 5, now: result ? 5 : step }} style={{ height: 5, backgroundColor: '#EDE8E1', borderRadius: 4, marginBottom: 28 }}>
            <View style={{ width: `${result ? 100 : step / 5 * 100}%`, height: 5, backgroundColor: '#2A5C6A', borderRadius: 4 }} />
          </View>
          {question ? (
            <View>
              <Text style={{ fontSize: 28, fontWeight: '800', color: '#1C1B1A', marginBottom: 10 }}>{question.title[lang]}</Text>
              <Text style={{ color: '#7A6856', lineHeight: 21, marginBottom: 22 }}>{lang === 'tr' ? 'Sana en yakın tek cevabı seç. Sonradan değiştirebilirsin.' : 'Choose the one answer closest to you. You can change it later.'}</Text>
              {question.options.map(option => {
                const selected = answers[question.id] === option.id;
                return (
                  <TouchableOpacity key={option.id} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => onAnswer(question.id, option.id)} style={{ padding: 18, borderRadius: 16, borderWidth: 1, borderColor: selected ? '#2A5C6A' : '#EDE8E1', backgroundColor: selected ? '#E7F0F0' : '#FFF', marginBottom: 10 }}>
                    <Text style={{ color: '#1C1B1A', fontWeight: selected ? '700' : '500', fontSize: 15 }}>{option.label[lang]} {selected ? '✓' : ''}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : result && (
            <View>
              <Text style={{ fontSize: 30, fontWeight: '800', color: '#1C1B1A' }}>{STYLE_LABELS[result.primary][lang]}</Text>
              <Text style={{ fontSize: 16, color: '#2A5C6A', marginTop: 10 }}>{lang === 'tr' ? 'İkincil yönün' : 'Your secondary style'}: {STYLE_LABELS[result.secondary][lang]}</Text>
              <Text style={{ color: '#7A6856', marginTop: 14, lineHeight: 22 }}>{lang === 'tr' ? 'Bu sonuç verdiğin cevaplardan hesaplandı. Kombinlerinde aşağıdaki tercihleri birlikte kullanacağız.' : 'This result is scored from your answers. We will use these preferences together in your outfit suggestions.'}</Text>
              {profileDetails(result, lang).map((detail, index) => (
                <View key={index} style={{ paddingVertical: 15, borderBottomWidth: 1, borderColor: '#EDE8E1' }}>
                  <Text style={{ fontSize: 12, color: '#7A6856' }}>{detail.question}</Text>
                  <Text style={{ fontSize: 15, fontWeight: '600', marginTop: 5 }}>{detail.answer}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 26, marginBottom: 20 }}>
            {step > 0 && <TouchableOpacity accessibilityRole="button" onPress={() => onStep(step - 1)} style={{ padding: 18, borderRadius: 14, backgroundColor: '#EDE8E1' }}><Text>{lang === 'tr' ? 'Geri' : 'Back'}</Text></TouchableOpacity>}
            <TouchableOpacity accessibilityRole="button" disabled={!result && !ready} onPress={result ? onSave : () => onStep(step + 1)} style={{ flex: 1, padding: 18, borderRadius: 14, alignItems: 'center', backgroundColor: result || ready ? '#1C1B1A' : '#B8B3AE' }}>
              <Text style={{ color: '#FFF', fontWeight: '700' }}>{result ? (lang === 'tr' ? 'Profilimi kaydet' : 'Save my profile') : step === 4 ? (lang === 'tr' ? 'Sonucumu gör' : 'See my result') : (lang === 'tr' ? 'Devam' : 'Continue')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
