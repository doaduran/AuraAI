import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  ScrollView, 
  SafeAreaView, 
  StatusBar, 
  Image, 
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Linking,
  Platform
} from 'react-native';
import { 
  Sparkles, 
  Shirt, 
  Compass, 
  Bookmark, 
  User, 
  Plus, 
  Camera, 
  Image as GalleryIcon,
  Trash2, 
  Globe, 
  MessageCircle, 
  Send, 
  X, 
  Bot,
  Heart,
  Shuffle,
  Crown,
  RotateCcw,
  ShieldCheck,
  Calendar
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { CloudSun, MapPin } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppDialog } from './AppDialog';
import { STYLE_NAMES, STYLE_LABELS, STYLE_QUESTIONS, scoreStyleProfile, styleContext, parseAIJson, selectOutfitItems } from './styleProfile';
import { inspirationFeed, loadInspirationImage } from './inspirations';
import StyleQuiz from './StyleQuiz';
import Onboarding, { ONBOARDING_KEY } from './Onboarding';
import { buildStylistParts, pickShoppingPhoto } from './shoppingAssistant';
import wardrobeStorage from './wardrobeStorage';
import { prepareWardrobePhoto, createPhotoQueue } from './prepareWardrobePhoto';

// === GÜVENLİK NOTU ===
// API anahtarları artık uygulamanın içinde DEĞİL. Anahtarlar (Gemini, Remove.bg)
// sadece kendi sunucun/proxy'nde (bkz. worker/src/index.js) saklanır.
// PROXY_BASE_URL gizli değil (sadece bir adres), o yüzden burada sabit kalması
// sorun değil - .env ile de override edilebilir. APP_SHARED_SECRET ise GERÇEK
// bir sırdır ve asla buraya hardcode edilmez: .env dosyasından (gitignore'da,
// repo'ya asla commit edilmez) EXPO_PUBLIC_APP_SECRET olarak okunur. .env yoksa
// header boş gider, worker da APP_SHARED_SECRET set edilmemişse zaten kontrolü
// atlar (yerel geliştirme kolaylığı için) - bkz. worker/README.md.
const PROXY_BASE_URL = process.env.EXPO_PUBLIC_PROXY_URL || 'https://aura-worker.aura-closet.workers.dev';
const APP_SHARED_SECRET = process.env.EXPO_PUBLIC_APP_SECRET || '';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// === MERKEZİ GEMINI ÇAĞRI FONKSİYONU (Proxy üzerinden) ===
// Model yoğunluğu (503) ve kota (429) hatalarında proxy zaten kendi içinde
// birden fazla modeli ve üstel bekleme (exponential backoff) ile dener.
// Burada ayrıca ağ hatalarına karşı 1 ek deneme daha yapılır.
async function callGeminiAPI(parts, generationConfig = {}, requestOptions = {}) {
  const maxRetries = requestOptions.retryNetwork === false ? 1 : 2;
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestOptions.timeoutMs || 60000);
    try {
      const response = await fetch(`${PROXY_BASE_URL}/gemini`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(APP_SHARED_SECRET ? { 'X-App-Secret': APP_SHARED_SECRET } : {}),
        },
        body: JSON.stringify({
          parts,
          ...(requestOptions.task ? { task: requestOptions.task } : {}),
          ...(Object.keys(generationConfig).length ? { generationConfig } : {})
        })
      });

      const data = await response.json();

      if (response.ok) {
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Yapay zekadan boş yanıt geldi.');
        return text;
      }

      lastError = new Error(data?.error || `HTTP ${response.status}`);
      lastError.httpStatus = response.status;
      lastError.retryable = [429, 502, 503, 504].includes(response.status);
      // The proxy already retries models; do not repeat a complete busy-model cycle.
      break;
    } catch (err) {
      lastError = err;
      if (attempt + 1 < maxRetries) await sleep(1000 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error('Yapay zeka servisine ulaşılamadı.');
}

// === MERKEZİ ARKA PLAN SİLME FONKSİYONU (Proxy üzerinden) ===
// Başarısız olursa null döner; çağıran taraf orijinal fotoğrafla devam eder (fallback).
async function removeBackgroundSafe(base64) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${PROXY_BASE_URL}/removebg`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(APP_SHARED_SECRET ? { 'X-App-Secret': APP_SHARED_SECRET } : {}),
      },
      body: JSON.stringify({ image_file_b64: base64 }),
    });
    const data = await res.json();

    // ÖNEMLİ: Eskiden res.ok kontrol edilmiyordu, bu yüzden proxy bir hata
    // döndürdüğünde (örn. yanlış/eksik Remove.bg API anahtarı, kota bitmesi)
    // bu fonksiyon sessizce null dönüp orijinal fotoğrafla devam ediyordu ve
    // hiçbir yerde bu görünmüyordu. Artık hata konsola basılıyor.
    if (!res.ok) {
      console.log('Remove.bg proxy hatası:', res.status, data?.error || data);
      return null;
    }

    const resultB64 = data?.data?.result_b64;
    if (!resultB64) {
      console.log('Remove.bg beklenmeyen yanıt formatı:', data);
      return null;
    }

    return resultB64;
  } catch (err) {
    console.log('Remove.bg ağ hatası, orijinal resimle devam ediliyor:', err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}


// Trendyol / Zara Filtre Renk Paleti
const FASHION_COLORS = {
  "Siyah": "#1C1B1A",
  "Beyaz": "#FDFDFD",
  "Ekru": "#F4EFE6",
  "Bej": "#D4C5B9",
  "Kahverengi": "#5D4037",
  "Bordo": "#6A1A24",
  "Lacivert": "#1A2E40",
  "Gri": "#9E9E9E",
  "Haki": "#4E5844",
  "Mavi": "#64B5F6",
  "Pembe": "#F48FB1",
  "Kırmızı": "#D32F2F",
  "Yeşil": "#2E7D32",
  "Sarı": "#FBC02D",
  "Turuncu": "#FB8C00",
  "Çok Renkli": "multi"
};

// === KIYAFET AÇIKLAMA ALANLARINI AKTİF DİLE GÖRE OKUMA ===
// Yeni eklenen kıyafetler subCategory_tr/subCategory_en gibi iki dilde de kaydediliyor.
// Eski (tek dilde) kaydedilmiş kıyafetler için orijinal alana (örn. item.subCategory) geri döner.
const getItemField = (item, field, lang) => {
  return item?.[`${field}_${lang}`] || item?.[field] || '';
};

function InspirationPhoto({ uri, label, lang }) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  return (
    <View style={{ aspectRatio: 0.8, backgroundColor: '#EDE8E1', width: '100%' }}>
      {!failed ? <Image key={retry} source={{ uri }} accessibilityLabel={label} resizeMode="cover" style={{ width: '100%', height: '100%' }} onError={() => setFailed(true)} /> : (
        <TouchableOpacity accessibilityRole="button" onPress={() => { setRetry(retry + 1); setFailed(false); }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <GalleryIcon size={28} color="#7A6856" />
          <Text style={{ textAlign: 'center', marginTop: 12, color: '#7A6856' }}>{lang === 'tr' ? 'Fotoğraf yüklenemedi. Yeniden dene.' : 'Could not load photo. Try again.'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [lang, setLang] = useState('tr');
  const { showAlert, dialogView } = useAppDialog(lang);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [wardrobe, setWardrobe] = useState([]);
  const wardrobeReady = useRef(false);
  const [storageError, setStorageError] = useState('');
  const [saveRevision, setSaveRevision] = useState(0);
  const [photoCount, setPhotoCount] = useState(0);
  const [failedPhotos, setFailedPhotos] = useState([]);
  const photoProcessor = useRef(null);
  const photoQueue = useRef(null);
  if (!photoQueue.current) photoQueue.current = createPhotoQueue(photo => photoProcessor.current(...photo), setPhotoCount);
  const [hasCompletedQuiz, setHasCompletedQuiz] = useState(false);
  const [userStylePreference, setUserStylePreference] = useState('Minimalist');
  const [quizModalVisible, setQuizModalVisible] = useState(false); // Artık zorunlu değil, ana ekrandaki "Stilini Bul" kartından açılıyor
  const [styleProfile, setStyleProfile] = useState(null);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizStep, setQuizStep] = useState(0);
  const [inspirationFilter, setInspirationFilter] = useState('all');
  const [outfitError, setOutfitError] = useState('');
  const outfitRequest = useRef(0);

  const [plannerModalVisible, setPlannerModalVisible] = useState(false);
  const [dayToPlan, setDayToPlan] = useState(null);
  const [clothOptionsModalVisible, setClothOptionsModalVisible] = useState(false);
  const [selectedCloth, setSelectedCloth] = useState(null);
  const [photoPickerVisible, setPhotoPickerVisible] = useState(false);
  const [photoPickerError, setPhotoPickerError] = useState('');

  const [isProUser, setIsProUser] = useState(false); // Kullanıcı Premium mu?
  const [proModalVisible, setProModalVisible] = useState(false); // Ödeme ekranı görünürlüğü
  const FREE_ITEM_LIMIT = 15; // Ücretsiz dolap limiti

  // Manuel Kombin Oluşturucu State'leri
  const [manualModalVisible, setManualModalVisible] = useState(false);
  const [manualSelectedItems, setManualSelectedItems] = useState([]);
  // 1. UYGULAMA AÇILDIĞINDA VERİLERİ HAFIZADAN YÜKLE
  useEffect(() => {
    const loadData = async () => {
      let onboardingSeen = false;
      try {
        onboardingSeen = await AsyncStorage.getItem(ONBOARDING_KEY) === 'done';
        const storedWardrobe = await wardrobeStorage.getItem();
        if (storedWardrobe) setWardrobe(JSON.parse(storedWardrobe));
        wardrobeReady.current = true;

        const storedCollections = await AsyncStorage.getItem('aura_collections');
        if (storedCollections) setCollections(JSON.parse(storedCollections));

        const storedColorAnalysis = await AsyncStorage.getItem('aura_colorAnalysis');
        if (storedColorAnalysis) setColorAnalysis(JSON.parse(storedColorAnalysis));

        const storedIsPro = await AsyncStorage.getItem('aura_isPro');
        if (storedIsPro) setIsPro(JSON.parse(storedIsPro));

        const storedQuiz = await AsyncStorage.getItem('aura_hasCompletedQuiz');
        if (storedQuiz) {
          setHasCompletedQuiz(JSON.parse(storedQuiz));
        }

        const storedStyle = await AsyncStorage.getItem('aura_userStylePreference');
        if (storedStyle) setUserStylePreference(storedStyle);
        const storedProfile = await AsyncStorage.getItem('aura_styleProfile');
        if (storedProfile) {
          try {
            const saved = JSON.parse(storedProfile);
            if (saved) {
              const profile = scoreStyleProfile(saved.answers);
              setStyleProfile(profile);
              setUserStylePreference(profile.primary);
              setHasCompletedQuiz(true);
            }
          } catch (error) {
            console.log('Stil profili yeniden tamamlanmalı:', error);
          }
        }

        const storedLang = await AsyncStorage.getItem('aura_lang');
        if (storedLang) setLang(storedLang);

      } catch (e) {
        console.log('Veri yükleme hatası:', e);
        if (!wardrobeReady.current) setStorageError('load');
      } finally {
        setOnboardingVisible(!onboardingSeen);
        setDataLoaded(true);
      }
    };
    loadData();
  }, []);

  // Kullanıcı Abonelik Planı (false = Free, true = Pro VIP)
  const [isPro, setIsPro] = useState(false);
  const [dailyOutfitCount, setDailyOutfitCount] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  
  // Günün AI Kombini State'i
  const [currentOutfit, setCurrentOutfit] = useState(null);
  const [outfitLoading, setOutfitLoading] = useState(false);
// Hava Durumu State'i
  const [weather, setWeather] = useState({ temp: 24, desc: 'Güneşli', city: 'İstanbul' });

  // Uygulama açılınca konumu ve hava durumunu çek
  useEffect(() => {
    if (dataLoaded && !onboardingVisible) fetchLiveWeather();
  }, [dataLoaded, onboardingVisible]);

  const fetchLiveWeather = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      let lat = 41.0082; // Varsayılan İstanbul
      let lon = 28.9784;
      let cityName = 'İstanbul';

      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = loc.coords.latitude;
        lon = loc.coords.longitude;
        
        const reverse = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
        if (reverse && reverse[0]) {
          cityName = reverse[0].city || reverse[0].region || 'Konumunuz';
        }
      }

      // Open-Meteo Ücretsiz Weather API
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`);
      const data = await res.json();
      
      const temp = Math.round(data.current?.temperature_2m || 22);
      const code = data.current?.weather_code || 0;
      
      let desc = 'Güneşli';
      if (code > 0 && code <= 3) desc = 'Parçalı Bulutlu';
      else if (code >= 45 && code <= 48) desc = 'Sisli';
      else if (code >= 51 && code <= 67) desc = 'Yağmurlu';
      else if (code >= 71) desc = 'Karlı';

      setWeather({ temp, desc, city: cityName });
    } catch (e) {
      console.log('Hava Durumu Hatası:', e);
    }
  };

   const [collections, setCollections] = useState([
    { id: '1', title: 'Minimal Ofis', outfits: [] },
    { id: '2', title: 'Hafta Sonu & Kahve', outfits: [] },
    { id: '3', title: 'Spor & Casual', outfits: [] }
  ]);
  const daysOfWeek = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
  const [selectedPlannerDay, setSelectedPlannerDay] = useState('Pazartesi');
  const [weeklyPlanner, setWeeklyPlanner] = useState({
    'Pazartesi': null,
    'Salı': null,
    'Çarşamba': null,
    'Perşembe': null,
    'Cuma': null,
    'Cumartesi': null,
    'Pazar': null
  });
  const [selectedBoard, setSelectedBoard] = useState(null);
  // İlham Eşleme State'leri
  const [matchingLoading, setMatchingLoading] = useState(false);
  const [matchedOutfitResult, setMatchedOutfitResult] = useState(null);
  const [matchModalVisible, setMatchModalVisible] = useState(false);
  // Chatbot State'leri
  const [chatVisible, setChatVisible] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    {
      id: '1',
      sender: 'ai',
      text: 'Merhaba! Ben senin kişisel stil danışmanınım. Dolabındaki parçalarla ne kombinlemek istersin veya bugün nereye gidiyorsun?'
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatAttachment, setChatAttachment] = useState(null);
  const [chatPickingPhoto, setChatPickingPhoto] = useState(false);
  const chatSendLock = useRef(false);
  const chatScroll = useRef(null);

  // Kişisel Renk Analizi State'i
  const [colorAnalysis, setColorAnalysis] = useState({
    season: '',
    undertone: '',
    note: '',
    palette: [
      { name: "Sage", hex: "#A8BBA2" },
      { name: "Mauve", hex: "#C5A3AB" },
      { name: "Sky", hex: "#B8C9D9" },
      { name: "Plum", hex: "#957DAD" },
      { name: "Sand", hex: "#D6C7B2" }
    ]
  });
  const [colorLoading, setColorLoading] = useState(false);

  // VERİLER DEĞİŞTİKÇE OTOMATİK OLARAK HAFIZAYA KAYDET
  // (collections/colorAnalysis/isPro burada henüz tanımlanmadığı için bu effect
  // eskiden daha yukarıdaydı ve "before initialization" hatası veriyordu - buraya,
  // kullandığı tüm state'lerin tanımından SONRAYA taşındı.)
  useEffect(() => {
    if (!dataLoaded || !wardrobeReady.current) return;
    const saveData = async () => {
      try {
        await AsyncStorage.setItem('aura_collections', JSON.stringify(collections));
        await AsyncStorage.setItem('aura_colorAnalysis', JSON.stringify(colorAnalysis));
        await AsyncStorage.setItem('aura_isPro', JSON.stringify(isPro));
        await AsyncStorage.setItem('aura_hasCompletedQuiz', JSON.stringify(hasCompletedQuiz));
        await AsyncStorage.setItem('aura_userStylePreference', userStylePreference);
        await AsyncStorage.setItem('aura_styleProfile', JSON.stringify(styleProfile));
        await AsyncStorage.setItem('aura_lang', lang);
      } catch (e) {
        console.log('Veri kaydetme hatası:', e);
      }
    };
    saveData();
  }, [dataLoaded, collections, colorAnalysis, isPro, hasCompletedQuiz, userStylePreference, styleProfile, lang]);

  useEffect(() => {
    if (!dataLoaded || !wardrobeReady.current) return;
    let current = true;
    wardrobeStorage.setItem(JSON.stringify(wardrobe)).then(() => {
      if (current) setStorageError('');
    }).catch(error => {
      console.log('Gardrop kaydedilemedi:', error);
      if (current) setStorageError('save');
    });
    return () => { current = false; };
  }, [dataLoaded, wardrobe, saveRevision]);

  const personalStyleContext = styleContext(styleProfile, userStylePreference, lang);
  const personalColorContext = colorAnalysis.analyzedAt
    ? `${colorAnalysis.season}, ${colorAnalysis.undertone}; ${colorAnalysis.palette.map(color => `${color.name}: ${color.hex}`).join(', ')}`
    : (lang === 'tr' ? 'Kişisel renk analizi henüz yapılmadı; bir renk tipi varsayma.' : 'Personal colors have not been analyzed; do not assume a color season.');

  const finishOnboarding = async (action) => {
    setOnboardingVisible(false);
    if (action === 'wardrobe') setActiveTab('wardrobe');
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'done');
    } catch (error) {
      console.log('Başlangıç tercihi kaydedilemedi:', error);
    }
  };

  const startStyleQuiz = () => {
    setQuizAnswers(styleProfile?.answers || {});
    setQuizStep(0);
    setQuizModalVisible(true);
  };
  const saveStyleQuiz = () => {
    const profile = scoreStyleProfile(quizAnswers);
    setStyleProfile(profile);
    setUserStylePreference(profile.primary);
    setHasCompletedQuiz(true);
    setCurrentOutfit(null);
    setOutfitError('');
    setQuizModalVisible(false);
  };
  const quizResult = quizStep === STYLE_QUESTIONS.length ? scoreStyleProfile(quizAnswers) : null;
  const displayedInspirations = inspirationFeed(inspirationFilter, userStylePreference);

  // Dolap güncellendiğinde veya Home sekmesine geçildiğinde kombin üret
  useEffect(() => {
    if (dataLoaded && !onboardingVisible && activeTab === 'home' && wardrobe.length > 0 && !currentOutfit) {
      generateSmartOutfit();
    }
  }, [dataLoaded, onboardingVisible, activeTab, wardrobe, styleProfile, colorAnalysis.analyzedAt]);

  // AI Zeki Kombin Motoru
  const generateSmartOutfit = async () => {
    const requestId = ++outfitRequest.current;
    setOutfitError('');
    try {
      // 1. Kirlileri filtrele ve Favori etiketini ekle
      const availableWardrobe = wardrobe.filter(w => !w.isDirty);
      if (availableWardrobe.length === 0) {
        showAlert(
          lang === 'tr' ? 'Uyarı' : 'Warning',
          lang === 'tr' ? 'Dolabında hiç temiz kıyafet kalmamış! Kirli sepetini kontrol et.' : 'No clean items left in your closet! Check your laundry basket.'
        );
        return;
      }
      setOutfitLoading(true);

      const wardrobeSummary = availableWardrobe.map(w => 
        lang === 'tr'
          ? `ID:${w.id} - ${getItemField(w, 'subCategory', lang)} (${w.mainCategory}, Renk: ${getItemField(w, 'color', lang)}, Tarz: ${getItemField(w, 'style', lang)}, Desen: ${getItemField(w, 'pattern', lang) || 'Düz'}) ${w.isFavorite ? '[FAVORİ PARÇA]' : ''}`
          : `ID:${w.id} - ${getItemField(w, 'subCategory', lang)} (${w.mainCategory}, Color: ${getItemField(w, 'color', lang)}, Style: ${getItemField(w, 'style', lang)}, Pattern: ${getItemField(w, 'pattern', lang) || 'Plain'}) ${w.isFavorite ? '[FAVORITE ITEM]' : ''}`
      ).join('\n');

      const prompt = lang === 'tr' ? `Sen profesyonel bir yapay zeka stilistisin. Kullanıcının şu an giyilebilir ve TEMİZ olan dolap içeriği aşağıdadır:
${wardrobeSummary}

Güncel Hava Durumu: ${weather.temp}°C, ${weather.desc}
Kullanıcının stil testi ve tercihleri: ${personalStyleContext}
Kişisel renk önerileri: ${personalColorContext}

GÖREVLER:
- Bu temiz dolaptan hava durumuna uygun harika bir günlük kombin oluştur.
- Stil testindeki kesim, renk, kullanım ortamı ve önceliklere uy. Yalnızca verilen ID'leri kullan; eksik parçaları uydurma. Mümkünse üst + alt veya tek parça seç; aksesuarı ana kıyafet sayma.
- Kullanıcının [FAVORİ PARÇA] olarak işaretlediği kıyafetlere öncelik ver ve kombin merkezine onları koymaya çalış.
- Katmanlama kurallarına dikkat et (örn. atlet üzerine gömlek/ceket gibi).
- Desen çakışmalarından kaçın (örn. çizgili ve kareliyi üst üste giydirme).
- SADECE aşağıdaki JSON formatında, Türkçe olarak yanıt ver, başka hiçbir açıklama yazma:
{
  "title": "Kombin Adı (Örn: Şık Günlük Stili)",
  "note": "Neden bu kombin seçildiğine dair 1 cümlelik moda tavsiyesi",
  "itemIds": ["kıyafetin_id_si_1", "kıyafetin_id_si_2"]
}
` : `You are a professional AI stylist. Here is the user's currently wearable and CLEAN closet content:
${wardrobeSummary}

Current Weather: ${weather.temp}°C, ${weather.desc}
User's style test and preferences: ${personalStyleContext}
Personal color suggestions: ${personalColorContext}

TASKS:
- Create a great everyday outfit from this clean closet that fits the weather.
- Respect the user's fit, palette, occasion and priority answers. Use only provided IDs; never invent missing pieces. Prefer a top + bottom or one-piece outfit; accessories cannot replace clothing.
- Prioritize items marked [FAVORITE ITEM] and try to build the outfit around them.
- Respect layering rules (e.g. shirt/jacket over a tank top).
- Avoid pattern clashes (e.g. don't layer stripes with plaid).
- Respond ONLY in the following JSON format, in English, with no other explanation:
{
  "title": "Outfit Name (e.g. Chic Everyday Style)",
  "note": "1-sentence fashion tip on why this outfit was chosen",
  "itemIds": ["item_id_1", "item_id_2"]
}
`;

      const rawOutput = await callGeminiAPI([{ text: prompt }], { responseMimeType: 'application/json', temperature: 0.5 });
      const parsed = parseAIJson(rawOutput);
      const matchedItems = selectOutfitItems(parsed.itemIds, availableWardrobe);
      if (typeof parsed.title !== 'string' || typeof parsed.note !== 'string') throw new Error('Invalid outfit response');
      if (requestId === outfitRequest.current) setCurrentOutfit({ title: parsed.title, note: parsed.note, items: matchedItems });
    } catch (e) {
      console.log('Kombin Hatası:', e);
      if (requestId === outfitRequest.current) {
        setCurrentOutfit(null);
        setOutfitError(e.retryable
          ? (lang === 'tr' ? 'AI servisi şu an yoğun veya kullanım sınırına ulaştı. Biraz sonra tekrar dene.' : 'The AI service is busy or rate limited. Please try again shortly.')
          : (lang === 'tr' ? 'Kombin şu an hazırlanamadı. Bağlantıyı ve dolabındaki temiz parçaları kontrol edip tekrar dene.' : 'Could not prepare an outfit. Check your connection and clean items, then try again.'));
      }
    } finally {
      if (requestId === outfitRequest.current) setOutfitLoading(false);
    }
  };

  const removeCloth = (id) => {
    setWardrobe(wardrobe.filter(item => item.id !== id));
    if (currentOutfit && currentOutfit.items.some(i => i.id === id)) {
      setCurrentOutfit(null);
    }
  };

  // Kıyafeti kirliye at veya temizlendi olarak işaretle
  const toggleLaundry = (id) => {
    setWardrobe(wardrobe.map(item => 
      item.id === id ? { ...item, isDirty: !item.isDirty } : item
    ));
    // Eğer kıyafet kirliye atıldıysa, o anki aktif AI kombinin içindeyse kombini sıfırla
    if (currentOutfit && currentOutfit.items.some(i => i.id === id)) {
      setCurrentOutfit(null);
    }
  };

  // Giyim İstatistikleri: Kombin onaylandığında veya giyildiğinde parçaların sayısını artır
  const markOutfitAsWorn = (outfitToWear) => {
    if (!outfitToWear || !outfitToWear.items) return;
    
    const updatedWardrobe = wardrobe.map(wardrobeItem => {
      const isWorn = outfitToWear.items.some(wornItem => wornItem.id === wardrobeItem.id);
      return isWorn 
        ? { ...wardrobeItem, wearCount: (wardrobeItem.wearCount || 0) + 1 }
        : wardrobeItem;
    });
    
    setWardrobe(updatedWardrobe);
    showAlert(
      lang === 'tr' ? '🔥 Harika!' : '🔥 Nice!',
      lang === 'tr' ? 'Bu kombin bugün giyildi olarak kaydedildi. Dolap istatistiklerin güncellendi.' : 'This outfit was marked as worn today. Your closet stats have been updated.'
    );
  };
  
  // İlham Kartına Tıklandığında Dolaptan Eşleştirme Yap
  
  const handleSaveOutfitToBoard = (boardId) => {
    if (!currentOutfit) return;
    setCollections(prev => prev.map(board => {
      if (board.id === boardId) {
        return {
          ...board,
          outfits: [currentOutfit, ...board.outfits]
        };
      }
      return board;
    }));
    showAlert('✨', lang === 'tr' ? 'Kombin panoya başarıyla kaydedildi!' : 'Outfit saved to board successfully!');
  };

  const openSaveDialog = () => {
    if (!currentOutfit) {
      showAlert(lang === 'tr' ? 'Bilgi' : 'Info', lang === 'tr' ? 'Önce bir kombin oluşturulmalı.' : 'You need to create an outfit first.');
      return;
    }
    showAlert(
      lang === 'tr' ? 'Panoya Kaydet' : 'Save to Board',
      lang === 'tr' ? 'Bu kombini hangi panoya eklemek istersin?' : 'Choose a board:',
      [
        ...collections.map(c => ({
          text: c.title,
          onPress: () => handleSaveOutfitToBoard(c.id)
        })),
        { text: lang === 'tr' ? 'İptal' : 'Cancel', style: 'cancel' }
      ]
    );
  };

  // Kombini Takvime Planlama Dialogu
  const openScheduleDialog = () => {
    if (!currentOutfit) {
      showAlert(lang === 'tr' ? 'Bilgi' : 'Info', lang === 'tr' ? 'Önce bir kombin oluşturulmalı.' : 'You need to create an outfit first.');
      return;
    }
    showAlert(
      lang === 'tr' ? 'Haftalık Takvime Planla' : 'Schedule to Planner',
      lang === 'tr' ? 'Bu kombini hangi gün için planlamak istersin?' : 'Choose a day:',
      [
        ...daysOfWeek.map(day => ({
          text: `${day} ${weeklyPlanner[day] ? '✓' : ''}`,
          onPress: () => {
            setWeeklyPlanner(prev => ({
              ...prev,
              [day]: currentOutfit
            }));
            showAlert('📅', lang === 'tr' ? `${day} günü için kombin planlandı!` : `Outfit scheduled for ${day}!`);
          }
        })),
        { text: lang === 'tr' ? 'İptal' : 'Cancel', style: 'cancel' }
      ]
    );
  };
  
  // İlham Kartına Tıklandığında Dolaptan Eşleştirme Yap
  
  // Manuel Parça Seçip Çıkarma
  const toggleManualItem = (item) => {
    if (manualSelectedItems.some(i => i.id === item.id)) {
      setManualSelectedItems(manualSelectedItems.filter(i => i.id !== item.id));
    } else {
      setManualSelectedItems([...manualSelectedItems, item]);
    }
  };

  // Manuel Kombini Kaydetme
  const saveManualOutfit = () => {
    if (manualSelectedItems.length === 0) {
      showAlert(lang === 'tr' ? 'Uyarı' : 'Warning', lang === 'tr' ? 'Lütfen en az bir parça seçin.' : 'Please select at least one item.');
      return;
    }
    const customOutfit = {
      title: 'Özel Tasarım Kombin',
      note: 'Dolabınızdan kendi seçtiğiniz parçalarla oluşturuldu.',
      items: manualSelectedItems
    };
    setCurrentOutfit(customOutfit);
    setManualModalVisible(false);
    setManualSelectedItems([]);
    setActiveTab('home');
    showAlert('✨', lang === 'tr' ? 'Özel kombin başarıyla hazırlandı ve ana sayfaya aktarıldı!' : 'Custom outfit created and sent to home screen!');
  };
  
  const openInspirationSource = (url) => Linking.openURL(url).catch(() => showAlert(
    lang === 'tr' ? 'Bağlantı açılamadı' : 'Could not open link',
    lang === 'tr' ? 'Tarayıcı ayarlarını kontrol edip tekrar dene.' : 'Check browser settings and try again.'
  ));

  const pickInspirationPhoto = async () => {
    if (matchingLoading) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.8 });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.base64) throw new Error('Missing image data');
      await handleMatchInspiration({ title: lang === 'tr' ? 'Seçtiğin ilham fotoğrafı' : 'Your inspiration photo', image: asset.uri, base64: asset.base64, mimeType: asset.mimeType });
    } catch (error) {
      showAlert(lang === 'tr' ? 'Fotoğraf açılamadı' : 'Could not open photo', lang === 'tr' ? 'Başka bir kombin fotoğrafıyla tekrar dene.' : 'Try another outfit photo.');
    }
  };

  const handleMatchInspiration = async (inspireItem) => {
    if (matchingLoading) return;
    const availableWardrobe = wardrobe.filter(item => !item.isDirty);
    if (availableWardrobe.length === 0) {
      showAlert(
        lang === 'tr' ? 'Dolap Boş' : 'Closet Empty',
        lang === 'tr' ? 'Bu görünümü eşleştirmek için dolabına birkaç temiz kıyafet ekle.' : 'Add a few clean items to match this look.'
      );
      return;
    }

    setMatchingLoading(true);
    setMatchModalVisible(true);
    setMatchedOutfitResult(null);

    try {
      const reference = await loadInspirationImage(inspireItem);
      const title = typeof inspireItem.title === 'string' ? inspireItem.title : inspireItem.title[lang];
      const wardrobeSummary = availableWardrobe.map(w => ({
        id: w.id,
        subCategory: getItemField(w, 'subCategory', lang),
        color: getItemField(w, 'color', lang),
        style: getItemField(w, 'style', lang),
        category: w.mainCategory
      }));

      const prompt = lang === 'tr' ? `Kullanıcı şu ilham fotoğrafını beğendi: "${title}". Ekteki FOTOĞRAFI incele; yalnızca başlığından çıkarım yapma.
Stil profili: ${personalStyleContext}
Renk önerileri: ${personalColorContext}
Hava: ${weather.temp}°C, ${weather.desc}
Kullanıcının gardırobundaki parçalar:
${JSON.stringify(wardrobeSummary)}

GÖREV:
1. Kullanıcının gardırobundan bu ilham stiline EN YAKIN veya bu havayı yakalayacak parçaları seç ("matchedItemIds").
2. Bu tarzı tamamlamak için dolabında eksik olan tek bir kilit parçayı öner ("missingItemAdvice").
3. Kısa bir stilist notu yaz ("matchNote").
4. Yalnızca verilen temiz parça ID'lerini kullan. Kişinin yüzünü veya bedenini değerlendirme; kıyafet kesimi, katmanlar, desen ve renklerle ilgilen. Tam kopya mümkün değilse bunu açıkça söyle.

SADECE geçerli bir JSON döndür, alan değerleri Türkçe olsun:
{
  "matchedItemIds": ["item_id_1", "item_id_2"],
  "matchNote": "Bu ilham stilindeki havayı dolabındaki parçalarla yakaladık.",
  "missingItemAdvice": "Görünümü tam Pinterest havasına sokmak için bej trençkot veya deri kemer ekleyebilirsin."
}` : `The user liked this inspiration photo: "${title}". Examine the attached PHOTO, not just the title.
Style profile: ${personalStyleContext}
Color suggestions: ${personalColorContext}
Weather: ${weather.temp}°C, ${weather.desc}
Items in the user's wardrobe:
${JSON.stringify(wardrobeSummary)}

TASK:
1. Pick the items from the user's wardrobe that are CLOSEST to this inspiration style or capture its vibe ("matchedItemIds").
2. Suggest a single key item missing from their closet that would complete this look ("missingItemAdvice").
3. Write a short stylist note ("matchNote").
4. Use only the supplied clean item IDs. Discuss clothing cuts, layers, patterns and colors, not the person's face or body. State when the closet cannot reproduce the look.

Return ONLY valid JSON, with field values in English:
{
  "matchedItemIds": ["item_id_1", "item_id_2"],
  "matchNote": "We captured the vibe of this inspiration look using pieces from your closet.",
  "missingItemAdvice": "Add a beige trench coat or a leather belt to nail the Pinterest-perfect look."
}`;

      const rawText = await callGeminiAPI([
        { text: prompt },
        { inline_data: { mime_type: reference.mimeType, data: reference.data } },
      ], { responseMimeType: 'application/json', temperature: 0.3 });
      const parsed = parseAIJson(rawText);
      const items = selectOutfitItems(parsed.matchedItemIds, availableWardrobe);
      if (typeof parsed.matchNote !== 'string' || typeof parsed.missingItemAdvice !== 'string') throw new Error('Invalid match result');

        setMatchedOutfitResult({
          inspireTitle: title,
          image: inspireItem.image,
          note: parsed.matchNote,
          missingPiece: parsed.missingItemAdvice,
          items
        });
    } catch (error) {
      console.log('Eşleştirme Hatası:', error);
      showAlert(lang === 'tr' ? 'Hata' : 'Error', lang === 'tr' ? 'Kombin eşleştirilirken bir sorun oluştu.' : 'Something went wrong while matching the outfit.');
      setMatchModalVisible(false);
    } finally {
      setMatchingLoading(false);
    }
  };

  const selectChatPhoto = async (source) => {
    if (chatLoading || chatPickingPhoto) return;
    setChatPickingPhoto(true);
    try {
      const photo = await pickShoppingPhoto(source, { imagePicker: ImagePicker, platform: Platform.OS });
      if (photo) setChatAttachment(photo);
    } catch (error) {
      showAlert(lang === 'tr' ? 'Fotoğraf eklenemedi' : 'Could not add photo', lang === 'tr'
        ? 'Kamera veya fotoğraf iznini kontrol et. Daha küçük bir JPEG, PNG veya WebP fotoğrafıyla tekrar dene.'
        : 'Check camera or photo access. Try a smaller JPEG, PNG or WebP photo.');
    } finally {
      setChatPickingPhoto(false);
    }
  };

  const openChatPhotoMenu = () => {
    if (chatLoading || chatPickingPhoto) return;
    showAlert(lang === 'tr' ? 'Kıyafeti asistana göster' : 'Show your stylist a piece',
      lang === 'tr' ? 'Mağazada gördüğün veya almayı düşündüğün kıyafetin fotoğrafını seç.' : 'Choose a photo of a piece you found or are considering buying.', [
        { text: lang === 'tr' ? 'Kamera' : 'Camera', onPress: () => selectChatPhoto('camera') },
        { text: lang === 'tr' ? 'Galeri' : 'Gallery', onPress: () => selectChatPhoto('gallery') },
        { text: lang === 'tr' ? 'İptal' : 'Cancel', style: 'cancel' },
      ]);
  };

  const handleSendMessage = async (retryMessage) => {
    const retry = retryMessage?.sender === 'user' ? retryMessage : null;
    const draftText = retry ? retry.text : inputText;
    const draftPhoto = retry ? retry.attachment : chatAttachment;
    if ((!draftText.trim() && !draftPhoto) || chatSendLock.current || chatLoading || chatPickingPhoto) return;
    chatSendLock.current = true;
    const text = draftText.trim() || (lang === 'tr' ? 'Bu kıyafeti almalı mıyım? Dolabımla ve tarzımla uyumunu değerlendir.' : 'Should I buy this piece? Consider my wardrobe and style.');
    const userMsg = { id: Date.now().toString(), sender: 'user', text, attachment: draftPhoto };
    setChatMessages(prev => [...prev, userMsg]);
    if (!retry) {
      setInputText('');
      setChatAttachment(null);
    }
    setChatLoading(true);

    try {
      const parts = buildStylistParts({
        message: userMsg.text, attachment: userMsg.attachment, history: chatMessages,
        wardrobe, style: personalStyleContext, colors: personalColorContext, weather, lang,
      });
      const reply = await callGeminiAPI(parts);
      setChatMessages(prev => [...prev, { id: (Date.now() + 1).toString(), sender: 'ai', text: reply }]);
    } catch (e) {
      console.log('Chat Hatası:', e);
      setChatMessages(prev => [...prev, { id: (Date.now() + 1).toString(), sender: 'ai', error: true, text: e.retryable
        ? (lang === 'tr' ? 'AI servisi şu an yoğun. Fotoğrafını veya sorunu tekrar göndermek için “Tekrar dene”ye dokun.' : 'The AI service is busy. Tap “Try again” to resend your photo or question.')
        : (lang === 'tr' ? 'Yanıt alınamadı. Fotoğrafını veya sorunu tekrar göndermek için “Tekrar dene”ye dokun.' : 'Could not get a reply. Tap “Try again” to resend your photo or question.') }]);
    } finally {
      chatSendLock.current = false;
      setChatLoading(false);
    }
  };

// Yüz / Selfie Seçimi
  const handleStartColorAnalysis = () => {
    if (colorLoading) return;
    showAlert(
      lang === 'tr' ? "Renk Analizi İçin Selfie Seç" : "Select Selfie for Color Analysis",
      lang === 'tr' ? "Doğal ışıkta çekilmiş net bir yüz fotoğrafı seçin." : "Choose a clear face photo in natural light.",
      [
        { 
          text: lang === 'tr' ? "📸 Kamera ile Çek" : "📸 Camera", 
          onPress: () => pickSelfiePhoto('camera')
        },
        { 
          text: lang === 'tr' ? "🖼️ Galeriden Seç" : "🖼️ Gallery", 
          onPress: () => pickSelfiePhoto('gallery')
        },
        { text: lang === 'tr' ? "İptal" : "Cancel", style: "cancel" }
      ]
    );
  };

  const pickSelfiePhoto = async (source) => {
    try {
      if (Platform.OS !== 'web') {
        const permission = source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) throw new Error('Photo permission denied');
      }
      const options = { mediaTypes: ['images'], base64: true, quality: 0.8, cameraType: 'front' };
      // No await before launching on web: the browser requires a direct user gesture.
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.base64) throw new Error('Photo data missing');
      await analyzeFaceWithAI(asset.base64, asset.mimeType || 'image/jpeg');
    } catch (error) {
      showAlert(lang === 'tr' ? 'Fotoğraf açılamadı' : 'Could not open photo', lang === 'tr' ? 'Kamera veya fotoğraf izinlerini kontrol et. Galeriden de bir selfie seçebilirsin.' : 'Check camera or photo permissions. You can also choose a selfie from the gallery.');
    }
  };

  // Gemini AI Yüz Analiz Motoru
  const analyzeFaceWithAI = async (base64Img, mimeType = 'image/jpeg') => {
    setColorLoading(true);
    try {
      const prompt = lang === 'tr' ? `Sen dünyanın en iyi profesyonel kişisel renk analistisin (Seasonal Color Analysis Expert).
Fotoğraftaki kişinin yüzünü, ten rengini, göz ve saç kontrastını analiz et.
Kişinin hangi 12 mevsimsel renk tipine ait olduğunu (örn: Deep Winter, Soft Summer, Warm Autumn, Light Spring, True Winter, Dark Autumn vb.) ve cilt alt tonunu (Warm/Cool/Neutral) tespit et.
Bu fotoğraftaki ışığa göre yaklaşık bir stil önerisi yap; kesin analiz iddiasında bulunma. Yüz görünmüyorsa faceDetected false olsun; mevsim veya palet uydurma.
Ona yakışabilecek 5 ana rengi (İsim ve HEX koduyla) ve 1 cümlelik stilist notunu ver.

SADECE geçerli bir JSON formatında, "note" ve renk isimleri Türkçe olacak şekilde yanıt ver:
{
  "faceDetected": true,
  "season": "Mevsim Tipi (örn: Deep Winter)",
  "undertone": "Alt Ton (örn: Cool / Soğuk)",
  "note": "Kısa ve net renk tavsiye notu.",
  "palette": [
    {"name": "Zümrüt", "hex": "#004D40"},
    {"name": "Safir", "hex": "#0D47A1"},
    {"name": "Gümüş Gri", "hex": "#B0BEC5"},
    {"name": "Bordo", "hex": "#4A148C"},
    {"name": "Buz Mavisi", "hex": "#E1F5FE"}
  ]
}` : `You are the world's best professional Seasonal Color Analysis Expert.
Analyze the person's face in the photo: skin tone, and eye/hair contrast.
Determine which of the 12 seasonal color types they belong to (e.g. Deep Winter, Soft Summer, Warm Autumn, Light Spring, True Winter, Dark Autumn, etc.) and their skin undertone (Warm/Cool/Neutral).
Make an approximate styling suggestion based on the lighting in this photo, without claiming certainty. If no face is visible, set faceDetected to false and do not invent a season or palette.
Give 5 suggested colors (name and HEX code) and a 1-sentence stylist note.

Respond ONLY in valid JSON, with "note" and color names in English:
{
  "faceDetected": true,
  "season": "Season Type (e.g. Deep Winter)",
  "undertone": "Undertone (e.g. Cool)",
  "note": "Short, clear color advice note.",
  "palette": [
    {"name": "Emerald", "hex": "#004D40"},
    {"name": "Sapphire", "hex": "#0D47A1"},
    {"name": "Silver Gray", "hex": "#B0BEC5"},
    {"name": "Burgundy", "hex": "#4A148C"},
    {"name": "Ice Blue", "hex": "#E1F5FE"}
  ]
}`;

      const rawText = await callGeminiAPI(
        [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: base64Img } }
        ],
        { temperature: 0.1, responseMimeType: "application/json" }
      );
      const parsed = parseAIJson(rawText);
      if (parsed.faceDetected !== true || typeof parsed.season !== 'string' || typeof parsed.undertone !== 'string' ||
        !Array.isArray(parsed.palette) || parsed.palette.length !== 5 ||
        parsed.palette.some(color => typeof color.name !== 'string' || !/^#[0-9a-f]{6}$/i.test(color.hex))) {
        throw new Error('Invalid face or palette result');
      }
        setColorAnalysis({
          season: parsed.season,
          undertone: parsed.undertone,
          note: parsed.note || (lang === 'tr' ? 'Cildinize en uygun renk paleti çıkarıldı.' : 'The color palette that best suits your skin has been generated.'),
          palette: parsed.palette,
          analyzedAt: new Date().toISOString(),
        });
        setCurrentOutfit(null);
        showAlert(
          lang === 'tr' ? '✨ Analiz Tamamlandı' : '✨ Analysis Complete',
          lang === 'tr' ? `${parsed.season} paletiniz hazır!` : `Your ${parsed.season} palette is ready!`
        );
    } catch (e) {
      console.log('Renk Analizi Hatası:', e);
      showAlert(
        lang === 'tr' ? 'Uyarı' : 'Warning',
        lang === 'tr' ? 'Renk analizi yapılırken bir sorun oluştu. Lütfen yüzünüzün net göründüğü bir fotoğraf ile tekrar deneyin.' : 'Something went wrong during color analysis. Please try again with a clear photo of your face.'
      );
    } finally {
      setColorLoading(false);
    }
  };

  // 1. KAMERA VE GALERİ SEÇİM MENÜSÜ
  const handleAddPhoto = () => {
    if (!wardrobeReady.current) {
      showAlert(lang === 'tr' ? 'Dolap açılamadı' : 'Storage unavailable', lang === 'tr' ? 'Kayıtlı dolabını korumak için ekleme durduruldu. Diğer Aura sekmelerini kapatıp uygulamayı tekrar aç.' : 'Close other Aura tabs and reopen the app to access your saved wardrobe.');
      return;
    }
    if (Platform.OS === 'web') {
      setPhotoPickerError('');
      setPhotoPickerVisible(true);
      return;
    }
    showAlert(
      lang === 'tr' ? "Kıyafet Ekle" : "Add Item",
      lang === 'tr' ? "Fotoğrafı nereden eklemek istersin?" : "Where would you like to add the photo from?",
      [
        { text: lang === 'tr' ? "Kamera" : "Camera", onPress: openCamera },
        { text: lang === 'tr' ? "Galeri" : "Gallery", onPress: openGallery },
        { text: lang === 'tr' ? "İptal" : "Cancel", style: "cancel" }
      ]
    );
  };

  // Web'de seçici, kullanıcı tıklamasından hemen başlatılmalı.
  const pickWardrobePhoto = async (source) => {
    if (!isProUser && wardrobe.length + photoQueue.current.count >= FREE_ITEM_LIMIT) {
      setPhotoPickerVisible(false);
      setProModalVisible(true);
      return;
    }
    setPhotoPickerError('');
    try {
      // Tarayıcıda izin beklemek tıklama bağlantısını koparabilir.
      if (Platform.OS !== 'web') {
        const permission = source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          showAlert(
            lang === 'tr' ? 'İzin gerekli' : 'Permission required',
            lang === 'tr'
              ? 'Fotoğraf eklemek için cihaz ayarlarından kamera veya fotoğraf erişimine izin ver.'
              : 'Allow camera or photo access in your device settings to add a photo.'
          );
          return;
        }
      }
      const options = {
        mediaTypes: ['images'],
        allowsEditing: false,
        allowsMultipleSelection: source === 'gallery',
        selectionLimit: isProUser ? 10 : Math.max(1, FREE_ITEM_LIMIT - wardrobe.length - photoQueue.current.count),
        base64: true,
        quality: 0.8,
      };
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const assets = result.assets;
      if (!assets?.length || assets.some(asset => !asset.uri || !asset.base64)) throw new Error('Missing photo data');
      const available = isProUser ? 10 : Math.max(0, FREE_ITEM_LIMIT - wardrobe.length - photoQueue.current.count);
      if (assets.length > available) throw new Error(lang === 'tr' ? `En fazla ${available} fotoğraf daha ekleyebilirsin.` : `You can add ${available} more photos.`);
      setPhotoPickerVisible(false);
      photoQueue.current.add(assets.map(asset => [asset.uri, asset.base64, asset.mimeType || 'image/jpeg']));
    } catch (error) {
      console.log('Fotoğraf seçme hatası:', error);
      const message = lang === 'tr'
        ? 'Fotoğraf açılamadı. Kamera veya fotoğraf erişimini kontrol et ya da galeriden tekrar dene.'
        : 'Could not open the photo. Check camera or photo access, or try the gallery again.';
      if (Platform.OS === 'web') {
        setPhotoPickerError(message);
      } else {
        showAlert(lang === 'tr' ? 'Fotoğraf eklenemedi' : 'Could not add photo', message);
      }
    }
  };
  const openCamera = () => pickWardrobePhoto('camera');
  const openGallery = () => pickWardrobePhoto('gallery');

// ANA İŞLEME VE GEMINI ANALİZİ
// removeBackgroundSafe ve callGeminiAPI dosyanın en üstünde, proxy üzerinden
// çalışan TEK merkezi fonksiyonlar olarak tanımlı (bkz. dosya başı).
const processAndAnalyzeImage = async (imageUri, originalBase64, mimeType = 'image/jpeg') => {
  setLoading(true);
  let retryPhoto = [imageUri, originalBase64, mimeType];
  try {
    if (!originalBase64) {
      throw new Error("Fotoğraf alınamadı. Lütfen tekrar çek.");
    }

    setStatusMessage(lang === 'tr' ? 'Fotoğraf küçültülüyor...' : 'Resizing photo...');
    const photo = await prepareWardrobePhoto(imageUri, originalBase64, mimeType, Platform.OS);
    retryPhoto = [photo.uri, photo.base64, photo.mimeType];
    setStatusMessage(lang === 'tr' ? 'Kıyafet analiz ediliyor; başka fotoğraf da ekleyebilirsin.' : 'Analyzing item; you can add more photos.');

    // NOT: "mainCategory" değeri uygulama içinde sabit bir filtre anahtarı olarak kullanıldığı için
    // (bkz. UstGiyim/AltGiyim/TekParca/DisGiyim/AyakkabiAksesuar sekmeleri) dil ne olursa olsun
    // AI'dan HER ZAMAN bu 5 sabit değerden biri isteniyor. Sadece subCategory/color/style/pattern
    // gösterim amaçlı olduğu için dile göre değişebiliyor.
    const prompt = lang === 'tr' ? `Sen Zara katalog standartlarında çalışan kıdemli bir moda uzmanısın.
Bu fotoğraftaki tek bir kıyafeti analiz et ve SADECE aşağıdaki formatta TEK bir JSON nesnesi döndür. Birden fazla kıyafet varsa en belirgin tek parçayı seç; nesne listesi veya art arda nesneler döndürme. Açıklama alanlarını HEM Türkçe HEM İngilizce doldur:
{
  "mainCategory": "UstGiyim / AltGiyim / TekParca / DisGiyim / AyakkabiAksesuar değerlerinden biri (bu alan HER ZAMAN bu İngilizce anahtar kelimelerden biri olmalı, çevirme)",
  "subCategory_tr": "Tişört/Pantolon vs. (Türkçe)",
  "subCategory_en": "T-shirt/Pants etc. (İngilizce karşılığı)",
  "color_tr": "Kıyafetin Ana Rengi (Türkçe)",
  "color_en": "Item's Main Color (İngilizce karşılığı)",
  "style_tr": "Günlük/Şık/Spor (Türkçe)",
  "style_en": "Casual/Chic/Sporty (İngilizce karşılığı)",
  "pattern_tr": "Düz/Çizgili/Baskılı (Türkçe)",
  "pattern_en": "Plain/Striped/Printed (İngilizce karşılığı)"
}` : `You are a senior fashion expert working to Zara catalog standards.
Analyze ONE prominent clothing item in this photo and return exactly ONE JSON object in the following format. If several garments are visible, choose one; never return a list or successive objects. Fill every description field in BOTH Turkish AND English:
{
  "mainCategory": "One of: UstGiyim / AltGiyim / TekParca / DisGiyim / AyakkabiAksesuar (this field must ALWAYS be one of these exact keywords, do not translate it)",
  "subCategory_tr": "Tişört/Pantolon etc. (Turkish version)",
  "subCategory_en": "T-shirt/Pants etc. (in English)",
  "color_tr": "Item's Main Color (Turkish version)",
  "color_en": "Item's Main Color (in English)",
  "style_tr": "Günlük/Şık/Spor (Turkish version)",
  "style_en": "Casual/Chic/Sporty (in English)",
  "pattern_tr": "Düz/Çizgili/Baskılı (Turkish version)",
  "pattern_en": "Plain/Striped/Printed (in English)"
}`;

    // Remove.bg ve Gemini istekleri AYNI ANDA çalışır, biri diğerini beklemez.
    // callGeminiAPI kendi içinde birden fazla modeli ve 429/503 hatalarında
    // üstel bekleme (exponential backoff) ile otomatik tekrar denemeyi yönetir.
    const [backgroundResult, analysisResult] = await Promise.allSettled([
      removeBackgroundSafe(photo.base64),
      callGeminiAPI(
        [
          { text: prompt },
          { inline_data: { mime_type: photo.mimeType, data: photo.base64 } }
        ],
        { temperature: 0.1, responseMimeType: "application/json" },
        { timeoutMs: 35000, retryNetwork: false, task: 'wardrobe' }
      )
    ]);
    if (analysisResult.status === 'rejected') throw analysisResult.reason;
    const aiResponseText = analysisResult.value;
    const cleanBase64 = backgroundResult.status === 'fulfilled' ? backgroundResult.value : null;

    const finalDisplayUri = cleanBase64 ? `data:image/png;base64,${cleanBase64}` : photo.uri;

    const clothData = parseAIJson(aiResponseText);
    if (!clothData || Array.isArray(clothData) || !['UstGiyim', 'AltGiyim', 'TekParca', 'DisGiyim', 'AyakkabiAksesuar'].includes(clothData.mainCategory)) {
      throw new SyntaxError('Invalid clothing classification');
    }

    const newItem = {
      id: Date.now().toString(),
      uri: finalDisplayUri,
      mainCategory: clothData.mainCategory || 'UstGiyim',
      subCategory_tr: clothData.subCategory_tr || clothData.subCategory || 'Kıyafet',
      subCategory_en: clothData.subCategory_en || clothData.subCategory || 'Item',
      color_tr: clothData.color_tr || clothData.color || 'Belirsiz',
      color_en: clothData.color_en || clothData.color || 'Unspecified',
      style_tr: clothData.style_tr || clothData.style || 'Minimal',
      style_en: clothData.style_en || clothData.style || 'Minimal',
      pattern_tr: clothData.pattern_tr || clothData.pattern || 'Düz',
      pattern_en: clothData.pattern_en || clothData.pattern || 'Plain',
      isDirty: false,
      isFavorite: false,
    };

    setWardrobe(prev => [newItem, ...prev]);

  } catch (error) {
    console.log("İşlem hatası:", error);
    setFailedPhotos(prev => [...prev, { photo: retryPhoto, message: error.name === 'AbortError'
      ? (lang === 'tr' ? 'Analiz servisi zamanında yanıt vermedi.' : 'Analysis timed out.')
      : error.name === 'SyntaxError' ? (lang === 'tr' ? 'Fotoğraf tek bir kıyafet olarak okunamadı. Tek parça içeren bir fotoğrafla tekrar dene.' : 'Could not identify one garment. Try a photo showing a single item.') : error.message }]);
  } finally {
    setLoading(false);
    setStatusMessage('');
  }
};
  photoProcessor.current = processAndAnalyzeImage;
  
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.topHeader}>
        <Text style={styles.headerLogo}>Aura</Text>
      </View>

      {/* Yükleniyor Bildirimi */}
      {loading && (
        <View style={styles.loadingBanner}>
          <ActivityIndicator size="small" color="#1C1B1A" />
          <Text style={styles.loadingText}>{statusMessage} {photoCount > 1 ? `(${photoCount} ${lang === 'tr' ? 'fotoğraf sırada' : 'photos remaining'})` : ''}</Text>
        </View>
      )}
      {!!storageError && (
        <View style={{ padding: 12, backgroundColor: '#FFF0E8', gap: 8 }}>
          <Text>{lang === 'tr'
            ? (storageError === 'load' ? 'Kayıtlı dolabın açılamadı. Diğer Aura sekmelerini kapatıp tekrar aç; mevcut kayıtların değiştirilmedi.' : 'Son değişiklikler cihazına kaydedilemedi. Uygulamayı kapatmadan yeniden dene.')
            : (storageError === 'load' ? 'Your wardrobe could not be opened. Close other Aura tabs and reopen. Existing records were not changed.' : 'Recent changes could not be saved. Retry before closing the app.')}</Text>
          {storageError === 'save' && <TouchableOpacity onPress={() => setSaveRevision(value => value + 1)}><Text style={{ fontWeight: '700' }}>{lang === 'tr' ? 'Kaydetmeyi tekrar dene' : 'Retry saving'}</Text></TouchableOpacity>}
        </View>
      )}
      {failedPhotos.length > 0 && (
        <View style={{ padding: 12, backgroundColor: '#FFF0E8', gap: 8 }}>
          <Text>{lang === 'tr' ? `${failedPhotos.length} fotoğraf eklenemedi. Seçtiklerin bu oturumda yeniden denemek için tutuluyor.` : `${failedPhotos.length} photos could not be added. They are kept for retry in this session.`}</Text>
          <Text>{failedPhotos[0].message}</Text>
          <TouchableOpacity onPress={() => {
            const available = isProUser ? failedPhotos.length : Math.max(0, FREE_ITEM_LIMIT - wardrobe.length - photoQueue.current.count);
            const retry = failedPhotos.slice(0, available);
            setFailedPhotos(prev => prev.slice(retry.length));
            photoQueue.current.add(retry.map(item => item.photo));
          }}><Text style={{ fontWeight: '700' }}>{lang === 'tr' ? 'Fotoğrafları yeniden dene' : 'Retry photos'}</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setFailedPhotos([])}><Text>{lang === 'tr' ? 'Vazgeç' : 'Dismiss'}</Text></TouchableOpacity>
        </View>
      )}

      <ScrollView contentContainerStyle={[styles.mainContainer, { paddingBottom: 120 }]} showsVerticalScrollIndicator={false}>
        
        {/* TAB 1: GARDIROP */}
        {activeTab === 'wardrobe' && (
          <View style={styles.tabSection}>
            <View style={styles.rowBetween}>
              <View>
                <Text style={styles.sectionHeading}>{lang === 'tr' ? 'Dolabım' : 'My Closet'}</Text>
                <Text style={styles.subText}>{wardrobe.length} {lang === 'tr' ? 'Parça Kayıtlı' : 'Items'}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  onPress={handleAddPhoto}
                  style={{
                    backgroundColor: '#EDE8E1',
                    paddingVertical: 7,
                    paddingHorizontal: 10,
                    borderRadius: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <Plus size={13} color="#1C1B1A" />
                  <Text style={{ fontSize: 11, color: '#1C1B1A', fontWeight: '700' }}>
                    {lang === 'tr' ? 'Ekle' : 'Add'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setManualModalVisible(true)}
                  style={{
                    backgroundColor: '#1C1B1A',
                    paddingVertical: 7,
                    paddingHorizontal: 12,
                    borderRadius: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  <Sparkles size={13} color="#FFF" />
                  <Text style={{ fontSize: 11, color: '#FFF', fontWeight: '700' }}>
                    {lang === 'tr' ? 'Kombin Yap' : 'Create'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            {/* Kategori Filtre Butonları (Hap Menü) */}
            {wardrobe.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                {[
                  { key: 'ALL', labelTr: 'Tümü', labelEn: 'All' },
                  { key: 'UstGiyim', labelTr: 'Üst', labelEn: 'Tops' },
                  { key: 'AltGiyim', labelTr: 'Alt', labelEn: 'Bottoms' },
                  { key: 'TekParca', labelTr: 'Elbise/Tulum', labelEn: 'Dresses' }, // YENİ EKLENEN KATEGORİ
                  { key: 'DisGiyim', labelTr: 'Dış Giyim', labelEn: 'Outerwear' },
                  { key: 'AyakkabiAksesuar', labelTr: 'Ayakkabı / Aks.', labelEn: 'Shoes & Acc.' },
                  { key: 'KirliSepeti', labelTr: '🧺 Kirli Sepeti', labelEn: '🧺 Laundry' }
                ].map((tab) => {
                  let count = 0;
                  if (tab.key === 'KirliSepeti') {
                    count = wardrobe.filter(item => item.isDirty).length;
                  } else if (tab.key === 'ALL') {
                    count = wardrobe.filter(item => !item.isDirty).length;
                  } else {
                    count = wardrobe.filter(item => item.mainCategory === tab.key && !item.isDirty).length;
                  }
                  const isActive = selectedCategory === tab.key;

                  return (
                    <TouchableOpacity
                      key={tab.key}
                      onPress={() => setSelectedCategory(tab.key)}
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 12,
                        borderRadius: 20,
                        backgroundColor: isActive ? '#1C1B1A' : '#FFFFFF',
                        borderWidth: 1,
                        borderColor: isActive ? '#1C1B1A' : '#EDE8E1',
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 5
                      }}
                    >
                      <Text style={{
                        fontSize: 12,
                        fontWeight: '600',
                        color: isActive ? '#FFFFFF' : '#7A7571'
                      }}>
                        {lang === 'tr' ? tab.labelTr : tab.labelEn}
                      </Text>
                      <Text style={{
                        fontSize: 10,
                        fontWeight: '700',
                        color: isActive ? '#D4C5B9' : '#A8A29D'
                      }}>
                        {count}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {wardrobe.length === 0 ? (
              <TouchableOpacity style={styles.emptyCard} onPress={handleAddPhoto}>
                <Camera size={32} color="#A8A29D" />
                <Text style={styles.emptyCardText}>
                  {lang === 'tr' ? 'Dolabın henüz boş. Fotoğraf yükle, AI stüdyo moduna alıp analiz etsin.' : 'Closet is empty. Upload your first piece!'}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.gridContainer}>
                {wardrobe
                  .filter(item => {
                    if (selectedCategory === 'KirliSepeti') return item.isDirty;
                    if (item.isDirty) return false; // Kirliler normal dolap sekmelerinde görünmez
                    return selectedCategory === 'ALL' || item.mainCategory === selectedCategory;
                  })
                  .sort((a, b) => (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0))
                  .map((item) => (
                    <TouchableOpacity 
                      key={item.id} 
                      activeOpacity={0.7}
                      delayLongPress={300} // 300ms basılı tutunca menü açılır
                      onLongPress={() => {
                        setSelectedCloth(item);
                        setClothOptionsModalVisible(true);
                      }}
                      style={[styles.gridClothCard, item.isDirty && { opacity: 0.8 }]}
                    >
                      <View style={styles.studioBackdrop}>
                        <Image source={{ uri: item.uri }} style={styles.gridClothImg} />
                        {/* Favori ise sağ üstte minik kalp çıkar */}
                        {item.isFavorite && (
                          <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(255,255,255,0.8)', padding: 5, borderRadius: 12 }}>
                            <Heart size={14} color="#D9534F" fill="#D9534F" />
                          </View>
                        )}
                      </View>
                      
                      <View style={styles.clothInfoBadge}>
                        <Text style={styles.clothTitle} numberOfLines={1}>{getItemField(item, 'subCategory', lang)}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 4 }}>
                          <Text style={styles.clothDetail} numberOfLines={1}>{getItemField(item, 'color', lang)} • {getItemField(item, 'pattern', lang)}</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                ))}
              </View>
              
            )}
          </View>
        )}

        {/* TAB 2: İLHAM */}
        {/* TAB 2: İLHAM */}
        {activeTab === 'explore' && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.tabSection}>
            <View style={{ marginBottom: 20 }}>
              <Text style={styles.sectionHeading}>{lang === 'tr' ? 'Stil İlhamı' : 'Style Inspiration'}</Text>
              <Text style={styles.subText}>{lang === 'tr' ? 'Fotoğrafları keşfet, beğendiğin görünümü kendi dolabınla yorumla.' : 'Explore photos and recreate a look with your own wardrobe.'}</Text>
            </View>
            <View style={{ gap: 10, marginBottom: 18 }}>
              <TouchableOpacity accessibilityRole="button" style={styles.primaryButton} onPress={() => openInspirationSource(`https://www.pinterest.com/search/pins/?q=${encodeURIComponent(`${userStylePreference} outfit ideas`)}`)}>
                <Text style={styles.primaryButtonText}>{lang === 'tr' ? 'Pinterest’te keşfet ↗' : 'Explore on Pinterest ↗'}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={styles.photoPickerButton} onPress={pickInspirationPhoto}>
                <GalleryIcon size={20} color="#1C1B1A" />
                <Text>{lang === 'tr' ? 'Kendi ilham fotoğrafını seç' : 'Choose your own inspiration photo'}</Text>
              </TouchableOpacity>
              <Text style={styles.subText}>{lang === 'tr' ? 'Kaynaklı fotoğraf seçkisi · Pinterest düğmesi ayrı sayfada açılır.' : 'Curated photos with sources · Pinterest opens on a separate page.'}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 18 }}>
              {['all', ...STYLE_NAMES].map(style => (
                <TouchableOpacity key={style} accessibilityRole="button" accessibilityState={{ selected: inspirationFilter === style }} onPress={() => setInspirationFilter(style)} style={[styles.filterChip, inspirationFilter === style && { backgroundColor: '#1C1B1A' }]}>
                  <Text style={{ color: inspirationFilter === style ? '#FFF' : '#1C1B1A' }}>{style === 'all' ? (lang === 'tr' ? 'Tümü' : 'All') : STYLE_LABELS[style][lang]}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
              {displayedInspirations.map(item => (
                <View key={item.id} style={styles.inspirationCard}>
                  <InspirationPhoto uri={item.image} label={item.title[lang]} lang={lang} />
                  <View style={{ padding: 14, gap: 8 }}>
                    <Text style={{ color: '#7A6856', fontSize: 11 }}>{item.styles.map(style => STYLE_LABELS[style][lang]).join(' · ')}</Text>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: '#1C1B1A' }}>{item.title[lang]}</Text>
                    <TouchableOpacity accessibilityRole="link" onPress={() => openInspirationSource(`${item.source}?utm_source=aura&utm_medium=referral`)}>
                      <Text style={{ fontSize: 11, color: '#7A6856', textDecorationLine: 'underline' }}>{item.photographer} / Unsplash ↗</Text>
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" disabled={matchingLoading} onPress={() => handleMatchInspiration(item)} style={styles.primaryButton}>
                      <Text style={styles.primaryButtonText}>{lang === 'tr' ? 'Dolabımla eşleştir' : 'Match my wardrobe'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
            <View style={{ height: 100 }} />
          </ScrollView>
        )}

        {/* TAB 3: ANA SAYFA & AI STILIST */}
        {activeTab === 'home' && (
          <View style={styles.tabSection}>
            {/* Canlı Hava Durumu Rozeti */}
            <View style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: '#FFFFFF',
              borderRadius: 16,
              paddingVertical: 12,
              paddingHorizontal: 16,
              borderWidth: 1,
              borderColor: '#EDE8E1',
              marginBottom: 4
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MapPin size={16} color="#7A6856" />
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#1C1B1A' }}>{weather.city}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <CloudSun size={18} color="#7A6856" />
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#1C1B1A' }}>{weather.temp}°C</Text>
                <Text style={{ fontSize: 12, color: '#8C857E' }}>• {weather.desc}</Text>
              </View>
            </View>

            {/* Stilini Bul Kartı - test artık zorunlu değil, isteyen buradan açar */}
            <TouchableOpacity
              onPress={startStyleQuiz}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: '#1C1B1A',
                borderRadius: 16,
                paddingVertical: 14,
                paddingHorizontal: 16,
                marginBottom: 4
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Sparkles size={18} color="#FFF" />
                <View>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFF' }}>
                    {styleProfile ? `${lang === 'tr' ? 'Tarzın' : 'Your style'}: ${STYLE_LABELS[styleProfile.primary][lang]}` : (lang === 'tr' ? 'Stilini Bul' : 'Find Your Style')}
                  </Text>
                  <Text style={{ fontSize: 11, color: '#C9C2B8' }}>
                    {styleProfile ? (lang === 'tr' ? '5 cevapla kişiselleştirildi · Yeniden düzenle' : 'Personalized with 5 answers · Edit') : (lang === 'tr' ? '5 kısa soruyla sana özel kombin önerileri' : '5 quick questions for personal outfit ideas')}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            {/* Günün AI Kombini Kartı */}
            <View style={styles.sectionCard}>
              <View style={styles.cardHeader}>
                <Sparkles size={18} color="#7A6856" />
                <Text style={styles.cardTitle}>
                  {currentOutfit ? currentOutfit.title : (lang === 'tr' ? 'Günün AI Kombini' : 'Daily AI Outfit')}
                </Text>
              </View>

              {outfitLoading ? (
                <View style={{ padding: 30, alignItems: 'center', gap: 10 }}>
                  <ActivityIndicator size="small" color="#1C1B1A" />
                  <Text style={{ fontSize: 13, color: '#8C857E' }}>AI dolabındaki parçaları eşleştiriyor...</Text>
                </View>
              ) : wardrobe.length === 0 ? (
                <TouchableOpacity style={styles.emptyHomeBox} onPress={() => setActiveTab('wardrobe')}>
                  <Shirt size={28} color="#A8A29D" />
                  <Text style={styles.emptyHomeText}>
                    {lang === 'tr' ? 'Dolabına birkaç kıyafet ekle, AI gerçek parçalarınla kombin hazırlasın.' : 'Add items to closet for AI outfits.'}
                  </Text>
                </TouchableOpacity>
              ) : currentOutfit && currentOutfit.items ? (
                <View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.outfitItemsRow}>
                    {currentOutfit.items.map((item) => (
                      <View key={item.id} style={styles.outfitItemCard}>
                        <Image source={{ uri: item.uri }} style={styles.outfitItemImg} />
                        <Text style={styles.outfitItemName} numberOfLines={1}>{getItemField(item, 'subCategory', lang)}</Text>
                        <Text style={styles.outfitItemColor}>{getItemField(item, 'color', lang)}</Text>
                      </View>
                    ))}
                  </ScrollView>

                  <View style={styles.stylistNoteBox}>
                    <Text style={styles.stylistNoteText}>💡 {currentOutfit.note}</Text>
                  </View>

                  <View style={styles.actionButtons}>
                    <TouchableOpacity 
                      style={styles.swapButton} 
                      onPress={() => {
                        if (!isPro && dailyOutfitCount >= 3) {
                          showAlert(
                            lang === 'tr' ? '✨ Limit Aşıldı' : '✨ Limit Reached',
                            lang === 'tr' ? 'Ücretsiz planda günde 3 kombin üretebilirsiniz. Pro plana geçin.' : 'You can generate 3 outfits per day on the free plan. Upgrade to Pro.'
                          );
                          return;
                        }
                        setDailyOutfitCount(prev => prev + 1);
                        generateSmartOutfit();
                      }}
                    >
                      <Shuffle size={16} color="#FFF" style={{ marginRight: 6 }} />
                      <Text style={styles.swapButtonText}>{lang === 'tr' ? 'Yeniden' : 'Swap'}</Text>
                    </TouchableOpacity>

                    {/* YENİ: Bugün Giydim Butonu */}
                    <TouchableOpacity 
                      style={[styles.swapButton, { backgroundColor: '#2A5C6A', paddingHorizontal: 10, flex: 0.8 }]} 
                      onPress={() => markOutfitAsWorn(currentOutfit)}
                    >
                      <Text style={{color: '#FFF', fontWeight: '700', fontSize: 11}}>Giydim ✓</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.heartButton} onPress={openScheduleDialog}>
                      <Calendar size={19} color="#1C1B1A" />
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.heartButton} onPress={openSaveDialog}>
                      <Heart size={19} color="#1C1B1A" />
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={{ paddingVertical: 20, gap: 14 }}>
                  <Text style={{ color: '#7A6856', lineHeight: 22 }}>{outfitError || (lang === 'tr' ? 'Temiz parçalarınla yeni bir kombin hazırlayabilirsin.' : 'Create an outfit with your clean items.')}</Text>
                  <TouchableOpacity accessibilityRole="button" onPress={generateSmartOutfit} style={styles.primaryButton}>
                    <Text style={styles.primaryButtonText}>{lang === 'tr' ? 'Tekrar dene' : 'Try again'}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Kişisel Renk Paleti Kartı (Tek ve Dinamik) */}
            <View style={styles.sectionCard}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.cardTitle}>{lang === 'tr' ? 'Kişisel Renk Paletin' : 'Your Color Palette'}</Text>
                  <Text style={styles.subText}>{colorAnalysis.analyzedAt ? `${colorAnalysis.season} • ${colorAnalysis.undertone}` : (lang === 'tr' ? 'Örnek palet · Kişisel analiz için selfie seç' : 'Sample palette · Choose a selfie to personalize')}</Text>
                </View>
                <TouchableOpacity 
                  onPress={handleStartColorAnalysis}
                  style={{
                    backgroundColor: '#1C1B1A',
                    paddingVertical: 7,
                    paddingHorizontal: 12,
                    borderRadius: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5
                  }}
                >
                  <Camera size={13} color="#FFF" />
                  <Text style={{ fontSize: 11, color: '#FFF', fontWeight: '600' }}>
                    {colorLoading ? 'Analiz...' : (lang === 'tr' ? 'Selfie ile Analiz' : 'Analyze')}
                  </Text>
                </TouchableOpacity>
              </View>

              {colorLoading ? (
                <View style={{ padding: 25, alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator size="small" color="#1C1B1A" />
                  <Text style={{ fontSize: 12, color: '#8C857E' }}>AI cilt alt tonunuzu ve mevsiminizi analiz ediyor...</Text>
                </View>
              ) : (
                <View style={{ marginTop: 12 }}>
                  <View style={styles.paletteRow}>
                    {colorAnalysis.palette.map((c, i) => (
                      <View key={i} style={styles.paletteItem}>
                        <View style={[styles.colorCircle, { backgroundColor: c.hex }]} />
                        <Text style={styles.colorLabel} numberOfLines={1}>{c.name}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={{ backgroundColor: '#FAF8F5', padding: 12, borderRadius: 12, marginTop: 14, borderWidth: 1, borderColor: '#EDE8E1' }}>
                    <Text style={{ fontSize: 11, color: '#5C554E', lineHeight: 16 }}>💡 {colorAnalysis.analyzedAt ? `${colorAnalysis.note} ` : ''}{lang === 'tr' ? 'Doğal ışıkta, filtresiz bir selfie seç. Fotoğraftan renk önerisi yaklaşık bir yorumdur; ışık ve kamera sonucu etkiler.' : 'Choose an unfiltered selfie in natural light. Photo-based color suggestions are approximate; lighting and camera affect the result.'}</Text>
                  </View>
                </View>
              )}
            </View>
          </View>
        )}

        {/* TAB 4: PANOLAR */}
        {activeTab === 'collections' && (
          <View style={styles.tabSection}>
            {/* Haftalık Kombin Takvimi Kartı */}
            {/* Haftalık Kombin Takvimi Kartı - YAN YANA YATAY KARTLAR */}
            <View style={styles.sectionCard}>
              <View style={[styles.rowBetween, { marginBottom: 14 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Calendar size={18} color="#7A6856" />
                  <Text style={styles.cardTitle}>{lang === 'tr' ? 'Haftalık Planlayıcı' : 'Weekly Planner'}</Text>
                </View>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
                {daysOfWeek.map(day => {
                  const hasOutfit = !!weeklyPlanner[day];
                  
                  return (
                    <View key={day} style={{ 
                      width: 125, 
                      backgroundColor: hasOutfit ? '#FFF' : '#FAF8F5', 
                      borderRadius: 16, 
                      padding: 12, 
                      borderWidth: 1, 
                      borderColor: hasOutfit ? '#1C1B1A' : '#EDE8E1',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      minHeight: 155
                    }}>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: hasOutfit ? '#1C1B1A' : '#8C857E', marginBottom: 10 }}>{day}</Text>
                      
                      {hasOutfit ? (
                        <View style={{ flex: 1, width: '100%', alignItems: 'center' }}>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4 }}>
                            {weeklyPlanner[day].items.slice(0, 4).map(item => (
                              <Image 
                                key={item.id} 
                                source={{ uri: item.uri }} 
                                style={{ width: 42, height: 42, borderRadius: 8, backgroundColor: '#FAF8F5', borderWidth: 1, borderColor: '#EDE8E1' }} 
                              />
                            ))}
                          </View>
                          <TouchableOpacity 
                            onPress={() => setWeeklyPlanner(prev => ({ ...prev, [day]: null }))}
                            style={{ marginTop: 'auto', paddingTop: 10 }}
                          >
                            <Text style={{ fontSize: 10, color: '#D9534F', fontWeight: '700' }}>Temizle</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                          <TouchableOpacity 
                            onPress={() => {
                              setDayToPlan(day);
                              setPlannerModalVisible(true);
                            }}
                            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#E8F0F2', justifyContent: 'center', alignItems: 'center', marginBottom: 8 }}
                          >
                            <Plus size={20} color="#2A5C6A" />
                          </TouchableOpacity>
                          <Text style={{ fontSize: 10, color: '#A8A29D', textAlign: 'center' }}>Planla</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
              

            {/* Panolar Bölümü */}
            {selectedBoard ? (
              <View style={{ gap: 14, marginTop: 10 }}>
                <TouchableOpacity 
                  nPress={() => {
                    // 1. Çakışma Kontrolü: Bu kombindeki herhangi bir parça başka bir günde var mı?
                    let conflictDay = null;
                    let conflictItemName = null;

                    for (const [existingDay, existingOutfit] of Object.entries(weeklyPlanner)) {
                      if (existingOutfit && existingDay !== dayToPlan) {
                        const overlappingItem = outfit.items.find(newItem => 
                          existingOutfit.items.some(eItem => eItem.id === newItem.id)
                        );
                        if (overlappingItem) {
                          conflictDay = existingDay;
                          conflictItemName = getItemField(overlappingItem, 'subCategory', lang);
                          break;
                        }
                      }
                    }

                    // 2. Uyarı veya Doğrudan Kayıt İşlemi
                    if (conflictDay) {
                      showAlert(
                        lang === 'tr' ? '👗 Aynı Parça Uyarısı' : '👗 Duplicate Item Warning',
                        lang === 'tr'
                          ? `Bu kombindeki "${conflictItemName}" parçasını zaten ${conflictDay} günü için planlamışsın. Yine de eklemek ister misin?`
                          : `You've already planned "${conflictItemName}" from this outfit for ${conflictDay}. Add it anyway?`,
                        [
                          { text: lang === 'tr' ? 'Vazgeç' : 'Cancel', style: 'cancel' },
                          { 
                            text: lang === 'tr' ? 'Yine de Ekle' : 'Add Anyway', 
                            onPress: () => {
                              setWeeklyPlanner(prev => ({ ...prev, [dayToPlan]: outfit }));
                              setPlannerModalVisible(false);
                            }
                          }
                        ]
                      );
                    } else {
                      setWeeklyPlanner(prev => ({ ...prev, [dayToPlan]: outfit }));
                      setPlannerModalVisible(false);
                      showAlert(lang === 'tr' ? '✅ Planlandı' : '✅ Scheduled', lang === 'tr' ? `${dayToPlan} günü için harika bir seçim!` : `Great choice for ${dayToPlan}!`);
                    }
                  }}
                  style={{ backgroundColor: '#FFF', padding: 14, borderRadius: 16, borderWidth: 1, borderColor: '#EDE8E1', marginBottom: 12 }}
                >
                  <Text style={{ fontSize: 13, color: '#7A6856', fontWeight: '600' }}>← {lang === 'tr' ? 'Tüm Panolar' : 'All Boards'}</Text>
                </TouchableOpacity>

                <Text style={styles.sectionHeading}>{selectedBoard.title}</Text>
                <Text style={styles.subText}>{selectedBoard.outfits.length} {lang === 'tr' ? 'Kayıtlı Kombin' : 'Saved Outfits'}</Text>

                {selectedBoard.outfits.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Bookmark size={28} color="#A8A29D" />
                    <Text style={styles.emptyCardText}>
                      {lang === 'tr' ? 'Bu panoda henüz kayıtlı kombin yok.' : 'No outfits saved yet.'}
                    </Text>
                  </View>
                ) : (
                  selectedBoard.outfits.map((outfit, idx) => (
                    <View key={idx} style={styles.sectionCard}>
                      <Text style={styles.cardTitle}>{outfit.title}</Text>
                      <Text style={[styles.stylistNoteText, { marginVertical: 8 }]}>💡 {outfit.note}</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingTop: 4 }}>
                        {outfit.items.map(item => (
                          <View key={item.id} style={styles.outfitItemCard}>
                            <Image source={{ uri: item.uri }} style={styles.outfitItemImg} />
                            <Text style={styles.outfitItemName} numberOfLines={1}>{getItemField(item, 'subCategory', lang)}</Text>
                            <Text style={styles.outfitItemColor}>{getItemField(item, 'color', lang)}</Text>
                          </View>
                        ))}
                      </ScrollView>
                    </View>
                  ))
                )}
              </View>
            ) : (
              <View style={{ gap: 14, marginTop: 10 }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.sectionHeading}>{lang === 'tr' ? 'Panolarım' : 'Saved Boards'}</Text>
                  <TouchableOpacity 
                    style={styles.addSmallBtn} 
                    onPress={() => {
                      const newBoardName = `Pano ${collections.length + 1}`;
                      setCollections(prev => [...prev, { id: Date.now().toString(), title: newBoardName, outfits: [] }]);
                    }}
                  >
                    <Plus size={16} color="#FFF" />
                    <Text style={styles.addSmallBtnText}>{lang === 'tr' ? 'Yeni Pano' : 'New Board'}</Text>
                  </TouchableOpacity>
                </View>

                {collections.map(col => (
                  <TouchableOpacity 
                    key={col.id} 
                    style={styles.collectionItemCard}
                    onPress={() => setSelectedBoard(col)}
                  >
                    <View>
                      <Text style={styles.collectionTitle}>{col.title}</Text>
                      <Text style={styles.subText}>{col.outfits.length} {lang === 'tr' ? 'Kombin' : 'Outfits'}</Text>
                    </View>
                    <Heart size={20} color="#C5A3AB" fill={col.outfits.length > 0 ? "#C5A3AB" : "transparent"} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}
        {/* TAB 5: PROFİL & AYARLAR */}
        {activeTab === 'profile' && (
          <View style={styles.tabSection}>
            {/* Kullanıcı Başlık Kartı */}
            <View style={{ alignItems: 'center', marginVertical: 10 }}>
              <View style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: '#1C1B1A',
                justifyContent: 'center',
                alignItems: 'center',
                marginBottom: 10
              }}>
                <User size={36} color="#FFF" />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#1C1B1A' }}>Aura Kullanıcısı</Text>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                backgroundColor: isPro ? '#F3EDE2' : '#EDE8E1',
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 12,
                marginTop: 6
              }}>
                {isPro && <Crown size={12} color="#7A6856" />}
                <Text style={{ fontSize: 11, fontWeight: '700', color: isPro ? '#7A6856' : '#8C857E' }}>
                  {isPro ? 'AURA VIP ÜYE' : 'ÜCRETSİZ PLAN'}
                </Text>
              </View>
            </View>

            <TouchableOpacity accessibilityRole="button" onPress={() => setOnboardingVisible(true)} style={[styles.sectionCard, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
              <Sparkles size={22} color="#2A5C6A" />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{lang === 'tr' ? 'Aura nasıl kullanılır?' : 'How to use Aura'}</Text>
                <Text style={styles.subText}>{lang === 'tr' ? 'Örnek gardropla kısa başlangıç turu' : 'A quick tour with a sample wardrobe'}</Text>
              </View>
              <Text style={{ color: '#7A6856', fontSize: 20 }}>→</Text>
            </TouchableOpacity>

            {/* Pro Yükseltme Banner'ı */}
            <View style={[styles.sectionCard, { backgroundColor: '#1C1B1A', borderColor: '#1C1B1A' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Crown size={20} color="#D4C5B9" />
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
                  {isPro ? 'Aura Pro Aktif' : 'Aura Pro’ya Geçin'}
                </Text>
              </View>
              <Text style={{ fontSize: 12, color: '#D4C5B9', lineHeight: 17, marginBottom: 6 }}>
                {isPro 
                  ? 'Sınırsız gardırop yükleme, sınırsız günlük swap ve gelişmiş yapay zeka analizine sahipsiniz.' 
                  : 'Sınırsız gardırop, sınırsız kombin üretimi ve derinlemesine renk analizi kilidini açın.'}
              </Text>
              <Text style={{ fontSize: 10, color: '#9A8F80', marginBottom: 12 }}>
                (Demo — gerçek ödeme alınmaz, tek dokunuşla açılır/kapanır)
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setIsPro(!isPro);
                  showAlert('✨', !isPro
                    ? (lang === 'tr' ? 'Aura Pro aktifleştirildi! (Demo — gerçek ödeme alınmadı)' : 'Aura Pro activated! (Demo — no real payment taken)')
                    : (lang === 'tr' ? 'Ücretsiz plana dönüldü.' : 'Switched back to the free plan.'));
                }}
                style={{
                  backgroundColor: '#FFFFFF',
                  paddingVertical: 10,
                  borderRadius: 12,
                  alignItems: 'center'
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#1C1B1A' }}>
                  {isPro ? 'Aboneliği Yönet / İptal Et' : 'Pro’ya Yükselt (VIP)'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Gardırop İstatistikleri */}
            <View style={styles.sectionCard}>
              <Text style={styles.cardTitle}>{lang === 'tr' ? 'Hesap İstatistikleri' : 'Account Stats'}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 14 }}>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#1C1B1A' }}>{wardrobe.length}{!isPro ? '/15' : ''}</Text>
                  <Text style={{ fontSize: 11, color: '#8C857E', marginTop: 2 }}>{lang === 'tr' ? 'Kıyafet' : 'Items'}</Text>
                </View>
                <View style={{ width: 1, backgroundColor: '#EDE8E1' }} />
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#1C1B1A' }}>{collections.reduce((acc, c) => acc + c.outfits.length, 0)}</Text>
                  <Text style={{ fontSize: 11, color: '#8C857E', marginTop: 2 }}>{lang === 'tr' ? 'Kayıtlı Kombin' : 'Saved Outfits'}</Text>
                </View>
                <View style={{ width: 1, backgroundColor: '#EDE8E1' }} />
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#1C1B1A' }}>{colorAnalysis.analyzedAt ? colorAnalysis.season.split(' ')[0] : '—'}</Text>
                  <Text style={{ fontSize: 11, color: '#8C857E', marginTop: 2 }}>{lang === 'tr' ? 'Renk Tipi' : 'Season'}</Text>
                </View>
              </View>
            </View>

            {/* DOLABIN KAHRAMANLARI (En Çok Giyilenler) */}
            <View style={[styles.sectionCard, { marginTop: 14 }]}>
              <Text style={styles.cardTitle}>🔥 Dolabın Kahramanları</Text>
              <Text style={styles.subText}>En çok giydiğin favori parçaların</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, marginTop: 12 }}>
                {wardrobe.filter(i => (i.wearCount || 0) > 0).sort((a, b) => (b.wearCount || 0) - (a.wearCount || 0)).slice(0, 5).map((item, idx) => (
                  <View key={idx} style={{ width: 80, alignItems: 'center' }}>
                    <Image source={{ uri: item.uri }} style={{ width: 80, height: 80, borderRadius: 10, backgroundColor: '#FAF8F5', borderWidth: 1, borderColor: '#EDE8E1' }} />
                    <Text style={{ fontSize: 10, fontWeight: '700', color: '#1C1B1A', marginTop: 4 }} numberOfLines={1}>{getItemField(item, 'subCategory', lang)}</Text>
                    <Text style={{ fontSize: 9, color: '#2A5C6A', fontWeight: '700' }}>{item.wearCount} kez giyildi</Text>
                  </View>
                ))}
                {wardrobe.filter(i => (i.wearCount || 0) > 0).length === 0 && (
                  <Text style={{ fontSize: 12, color: '#8C857E', paddingVertical: 10 }}>Henüz giyilen bir parça yok. Ana sayfada kombinlerini onayla!</Text>
                )}
              </ScrollView>
            </View>

            {/* TOZLANANLAR (Hiç Giyilmeyenler) */}
            <View style={[styles.sectionCard, { marginTop: 14 }]}>
              <Text style={styles.cardTitle}>🕸️ Tozlananlar</Text>
              <Text style={styles.subText}>Hiç giymediklerin (Belki bağışlamalısın?)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, marginTop: 12 }}>
                {wardrobe.filter(i => (i.wearCount || 0) === 0).slice(0, 5).map((item, idx) => (
                  <View key={idx} style={{ width: 80, alignItems: 'center', opacity: 0.6 }}>
                    <Image source={{ uri: item.uri }} style={{ width: 80, height: 80, borderRadius: 10, backgroundColor: '#FAF8F5' }} />
                    <Text style={{ fontSize: 10, fontWeight: '600', color: '#7A6856', marginTop: 4 }} numberOfLines={1}>{getItemField(item, 'subCategory', lang)}</Text>
                  </View>
                ))}
                {wardrobe.length > 0 && wardrobe.filter(i => (i.wearCount || 0) === 0).length === 0 && (
                  <Text style={{ fontSize: 12, color: '#2E7D32', paddingVertical: 10, fontWeight: '600' }}>Harika! Dolabındaki her şeyi aktif kullanıyorsun.</Text>
                )}
              </ScrollView>
            </View>

            {/* Tercihler ve Ayarlar */}
            <View style={styles.sectionCard}>
              <Text style={styles.cardTitle}>{lang === 'tr' ? 'Ayarlar' : 'Settings'}</Text>
              
              {/* Dil Değiştirme */}
              <TouchableOpacity
                onPress={() => setLang(lang === 'tr' ? 'en' : 'tr')}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderColor: '#EDE8E1' }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Globe size={18} color="#7A6856" />
                  <Text style={{ fontSize: 13, color: '#1C1B1A', fontWeight: '500' }}>{lang === 'tr' ? 'Uygulama Dili' : 'Language'}</Text>
                </View>
                <Text style={{ fontSize: 13, color: '#7A6856', fontWeight: '700' }}>{lang.toUpperCase()}</Text>
              </TouchableOpacity>

              {/* Dolabı Sıfırlama */}
              <TouchableOpacity
                disabled={photoCount > 0}
                onPress={() => {
                  showAlert(
                    lang === 'tr' ? 'Dolabı Sıfırla' : 'Reset Wardrobe',
                    lang === 'tr' ? 'Tüm yüklediğiniz kıyafetler ve kayıtlı kombinler silinsin mi?' : 'Clear all wardrobe items and saved looks?',
                    [
                      { text: lang === 'tr' ? 'Vazgeç' : 'Cancel', style: 'cancel' },
                      { 
                        text: lang === 'tr' ? 'Sıfırla' : 'Reset', 
                        style: 'destructive',
                        onPress: () => {
                          setWardrobe([]);
                          setFailedPhotos([]);
                          setCurrentOutfit(null);
                          setCollections([
                            { id: '1', title: 'Minimal Ofis', outfits: [] },
                            { id: '2', title: 'Hafta Sonu & Kahve', outfits: [] },
                            { id: '3', title: 'Spor & Casual', outfits: [] }
                          ]);
                          showAlert('✅', lang === 'tr' ? 'Dolap sıfırlandı.' : 'Closet has been reset.');
                        }
                      }
                    ]
                  );
                }}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <RotateCcw size={18} color="#C5A3AB" />
                  <Text style={{ fontSize: 13, color: '#B91C1C', fontWeight: '500' }}>{lang === 'tr' ? 'Tüm Verileri Temizle' : 'Clear All Data'}</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}

      </ScrollView>

      {/* Tarayıcıda Alert.alert yerine kamera / galeri seçimi. */}
      <Modal
        visible={photoPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoPickerVisible(false)}
      >
        <View style={styles.photoPickerOverlay}>
          <View style={styles.photoPickerCard}>
            <Text style={styles.photoPickerTitle}>{lang === 'tr' ? 'Kıyafet Ekle' : 'Add Item'}</Text>
            <Text style={styles.photoPickerDescription}>
              {lang === 'tr' ? 'Fotoğrafı nereden eklemek istersin?' : 'Where would you like to add the photo from?'}
            </Text>
            <TouchableOpacity accessibilityRole="button" onPress={openCamera} style={styles.photoPickerButton}>
              <Camera size={20} color="#1C1B1A" />
              <Text>{lang === 'tr' ? 'Kamera' : 'Camera'}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" onPress={openGallery} style={styles.photoPickerButton}>
              <GalleryIcon size={20} color="#1C1B1A" />
              <Text>{lang === 'tr' ? 'Galeri' : 'Gallery'}</Text>
            </TouchableOpacity>
            {!!photoPickerError && <Text accessibilityRole="alert" style={{ color: '#B42318', marginTop: 12 }}>{photoPickerError}</Text>}
            <TouchableOpacity accessibilityRole="button" onPress={() => setPhotoPickerVisible(false)} style={styles.photoPickerButton}>
              <Text>{lang === 'tr' ? 'İptal' : 'Cancel'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Alt Menü */}
      <View style={styles.bottomTabBar}>
        <TouchableOpacity style={styles.tabButton} onPress={() => setActiveTab('wardrobe')}>
          <Shirt size={20} color={activeTab === 'wardrobe' ? '#1C1B1A' : '#A8A29D'} />
          <Text style={[styles.tabLabel, activeTab === 'wardrobe' && styles.tabLabelActive]}>
            {lang === 'tr' ? 'Dolap' : 'Closet'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.tabButton} onPress={() => setActiveTab('explore')}>
          <Compass size={20} color={activeTab === 'explore' ? '#1C1B1A' : '#A8A29D'} />
          <Text style={[styles.tabLabel, activeTab === 'explore' && styles.tabLabelActive]}>
            {lang === 'tr' ? 'İlham' : 'Explore'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.centerTabButton} onPress={() => setActiveTab('home')}>
          <View style={[styles.centerCircle, activeTab === 'home' && styles.centerCircleActive]}>
            <Sparkles size={22} color="#FFFFFF" />
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.tabButton} onPress={() => setActiveTab('collections')}>
          <Bookmark size={20} color={activeTab === 'collections' ? '#1C1B1A' : '#A8A29D'} />
          <Text style={[styles.tabLabel, activeTab === 'collections' && styles.tabLabelActive]}>
            {lang === 'tr' ? 'Panolar' : 'Boards'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.tabButton} onPress={() => setActiveTab('profile')}>
          <User size={20} color={activeTab === 'profile' ? '#1C1B1A' : '#A8A29D'} />
          <Text style={[styles.tabLabel, activeTab === 'profile' && styles.tabLabelActive]}>
            {lang === 'tr' ? 'Profil' : 'Profile'}
          </Text>
        </TouchableOpacity>
      </View>
{/* ... Sekmeler ve alt menü butonları yukarıda bitiyor ... */}

      {/* AI Stilist Yüzen Sohbet Butonu */}
      <TouchableOpacity 
        style={{
          position: 'absolute',
          bottom: 84,
          right: 18,
          backgroundColor: '#1C1B1A',
          width: 50,
          height: 50,
          borderRadius: 25,
          justifyContent: 'center',
          alignItems: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.25,
          shadowRadius: 5,
          elevation: 6
        }}
        onPress={() => setChatVisible(true)}
      >
        <MessageCircle size={24} color="#FFF" />
      </TouchableOpacity>

      {/* AI Stilist Sohbet Modalı */}
      <Modal visible={chatVisible} animationType="slide" onRequestClose={() => setChatVisible(false)}>
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
          style={{ flex: 1, backgroundColor: '#FAF8F5' }}
        >
          {/* Header */}
          <View style={{
            paddingTop: Platform.OS === 'ios' ? 54 : 20,
            paddingHorizontal: 20,
            paddingBottom: 16,
            backgroundColor: '#FFFFFF',
            borderBottomWidth: 1,
            borderColor: '#EDE8E1',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#1C1B1A', justifyContent: 'center', alignItems: 'center' }}>
                <Bot size={20} color="#FFF" />
              </View>
              <View>
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#1C1B1A' }}>Aura AI Stilist</Text>
                <Text style={{ fontSize: 11, color: '#7A6856' }}>{lang === 'tr' ? 'Kombin sor veya alışveriş fotoğrafını göster' : 'Ask about outfits or show a shopping photo'}</Text>
              </View>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={lang === 'tr' ? 'Sohbeti kapat' : 'Close chat'} onPress={() => setChatVisible(false)} style={{ padding: 4 }}>
              <X size={22} color="#1C1B1A" />
            </TouchableOpacity>
          </View>

          {/* Mesaj Listesi */}
          <ScrollView 
            style={{ flex: 1, padding: 16 }} 
            contentContainerStyle={{ gap: 12, paddingBottom: 20 }}
            ref={chatScroll}
            onContentSizeChange={() => chatScroll.current?.scrollToEnd({ animated: true })}
          >
            {chatMessages.map((msg, messageIndex) => (
              <View 
                key={msg.id} 
                style={{
                  alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                  backgroundColor: msg.sender === 'user' ? '#1C1B1A' : '#FFFFFF',
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 16,
                  maxWidth: '82%',
                  borderWidth: msg.sender === 'user' ? 0 : 1,
                  borderColor: '#EDE8E1'
                }}
              >
                {!!msg.attachment && <Image source={{ uri: msg.attachment.uri }} accessibilityLabel={lang === 'tr' ? 'Asistana gönderilen alışveriş adayı' : 'Shopping candidate sent to your stylist'} resizeMode="contain" style={{ width: 210, maxWidth: '100%', height: 190, borderRadius: 12, backgroundColor: '#F3EDE2', marginBottom: 10 }} />}
                <Text style={{
                  fontSize: 13,
                  color: msg.sender === 'user' ? '#FFFFFF' : '#1C1B1A',
                  lineHeight: 19
                }}>
                  {msg.text}
                </Text>
                {!!msg.error && <TouchableOpacity accessibilityRole="button" disabled={chatLoading} onPress={() => handleSendMessage(chatMessages.slice(0, messageIndex).reverse().find(item => item.sender === 'user'))} style={{ paddingVertical: 10 }}>
                  <Text style={{ color: '#2A5C6A', fontWeight: '700' }}>{lang === 'tr' ? 'Tekrar dene' : 'Try again'}</Text>
                </TouchableOpacity>}
              </View>
            ))}
            {chatLoading && (
              <View style={{ alignSelf: 'flex-start', backgroundColor: '#FFFFFF', padding: 12, borderRadius: 16, borderWidth: 1, borderColor: '#EDE8E1', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color="#1C1B1A" />
                <Text style={{ fontSize: 12, color: '#8C857E' }}>Stilist yanıt hazırlıyor...</Text>
              </View>
            )}
          </ScrollView>

          {!!chatAttachment && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: '#FFF', borderTopWidth: 1, borderColor: '#EDE8E1' }}>
            <Image source={{ uri: chatAttachment.uri }} resizeMode="cover" style={{ width: 64, height: 70, borderRadius: 10 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: '#1C1B1A' }}>{lang === 'tr' ? 'Alışveriş adayı' : 'Shopping candidate'}</Text>
              <Text style={{ fontSize: 12, lineHeight: 18, color: '#7A6856', marginTop: 4 }}>{lang === 'tr' ? 'Gönderince asistan değerlendirir. Gardrobuna eklenmez.' : 'Your stylist reviews it when you send. It is not added to your wardrobe.'}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={lang === 'tr' ? 'Fotoğrafı kaldır' : 'Remove photo'} onPress={() => setChatAttachment(null)} style={{ padding: 10 }}><X size={20} color="#1C1B1A" /></TouchableOpacity>
          </View>}
          {/* Input Alanı */}
          <View style={{
            padding: 12,
            backgroundColor: '#FFFFFF',
            borderTopWidth: 1,
            borderColor: '#EDE8E1',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingBottom: Platform.OS === 'ios' ? 28 : 12
          }}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={lang === 'tr' ? 'Asistana fotoğraf ekle' : 'Attach a photo for your stylist'} onPress={openChatPhotoMenu} disabled={chatLoading || chatPickingPhoto} style={{ padding: 10, opacity: chatLoading || chatPickingPhoto ? 0.4 : 1 }}>
              {chatPickingPhoto ? <ActivityIndicator size="small" color="#2A5C6A" /> : <Camera size={23} color="#1C1B1A" />}
            </TouchableOpacity>
            <TextInput
              style={{
                flex: 1,
                backgroundColor: '#FAF8F5',
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 20,
                fontSize: 13,
                color: '#1C1B1A',
                borderWidth: 1,
                borderColor: '#EDE8E1'
              }}
              placeholder={chatAttachment ? (lang === 'tr' ? 'Almalı mıyım? Fiyatı, bütçen...' : 'Should I buy it? Price, budget...') : (lang === 'tr' ? 'Stiliste sor veya fotoğraf ekle...' : 'Ask your stylist or attach a photo...')}
              placeholderTextColor="#A8A29D"
              value={inputText}
              onChangeText={setInputText}
              onSubmitEditing={handleSendMessage}
            />
            <TouchableOpacity 
              onPress={handleSendMessage}
              accessibilityRole="button"
              accessibilityLabel={lang === 'tr' ? 'Mesajı gönder' : 'Send message'}
              disabled={chatLoading || chatPickingPhoto || (!inputText.trim() && !chatAttachment)}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: '#1C1B1A',
                justifyContent: 'center',
                alignItems: 'center'
              }}
            >
              <Send size={16} color="#FFF" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <StyleQuiz
        visible={quizModalVisible} lang={lang} step={quizStep} answers={quizAnswers} result={quizResult}
        onAnswer={(question, answer) => setQuizAnswers(previous => ({ ...previous, [question]: answer }))}
        onStep={setQuizStep} onClose={() => setQuizModalVisible(false)} onSave={saveStyleQuiz}
      />

      <Modal visible={matchModalVisible} animationType="slide" onRequestClose={() => setMatchModalVisible(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FAF8F5' }}>
          <ScrollView contentContainerStyle={{ padding: 24, width: '100%', maxWidth: 680, alignSelf: 'center', gap: 18 }}>
            <View style={styles.rowBetween}>
              <Text style={{ fontSize: 22, fontWeight: '800' }}>{lang === 'tr' ? 'İlhamdan dolabına' : 'From inspiration to your closet'}</Text>
              <TouchableOpacity accessibilityRole="button" onPress={() => setMatchModalVisible(false)} style={{ padding: 12 }}><X size={24} color="#1C1B1A" /></TouchableOpacity>
            </View>
            {matchingLoading ? <View style={{ padding: 30, alignItems: 'center', gap: 16 }}>
              <ActivityIndicator size="large" color="#2A5C6A" />
              <Text>{lang === 'tr' ? 'Fotoğraf ve dolabındaki parçalar inceleniyor...' : 'Examining the photo and your wardrobe...'}</Text>
            </View> : matchedOutfitResult && <View style={{ gap: 16 }}>
              <Text style={styles.cardTitle}>{matchedOutfitResult.inspireTitle}</Text>
              <Image source={{ uri: matchedOutfitResult.image }} style={{ width: '100%', height: 280, borderRadius: 16 }} resizeMode="contain" />
              <Text style={{ lineHeight: 23 }}>{matchedOutfitResult.note}</Text>
              <ScrollView horizontal contentContainerStyle={{ gap: 12 }}>
                {matchedOutfitResult.items.map(item => <View key={item.id} style={{ width: 110 }}>
                  <Image source={{ uri: item.uri }} style={{ width: 110, height: 130, borderRadius: 14 }} />
                  <Text style={{ marginTop: 8 }}>{getItemField(item, 'subCategory', lang)}</Text>
                </View>)}
              </ScrollView>
              <Text style={{ color: '#7A6856', lineHeight: 22 }}>{matchedOutfitResult.missingPiece}</Text>
              <TouchableOpacity accessibilityRole="button" style={styles.primaryButton} onPress={() => {
                setCurrentOutfit({ title: matchedOutfitResult.inspireTitle, note: matchedOutfitResult.note, items: matchedOutfitResult.items });
                setActiveTab('home');
                setMatchModalVisible(false);
              }}><Text style={styles.primaryButtonText}>{lang === 'tr' ? 'Bu kombini kullan' : 'Use this outfit'}</Text></TouchableOpacity>
            </View>}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* 2. MANUEL KOMBİN OLUŞTURUCU (STUDIO) MODALI */}
      <Modal visible={manualModalVisible} animationType="slide" onRequestClose={() => setManualModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#FAF8F5', paddingTop: Platform.OS === 'ios' ? 50 : 20 }}>
          <View style={{ paddingHorizontal: 20, paddingBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderColor: '#EDE8E1' }}>
            <View>
              <Text style={{ fontSize: 18, fontWeight: '800', color: '#1C1B1A' }}>Kendi Kombinini Yap</Text>
              <Text style={{ fontSize: 12, color: '#8C857E' }}>Seçilen Parçalar: {manualSelectedItems.length}</Text>
            </View>
            <TouchableOpacity onPress={() => setManualModalVisible(false)}>
              <X size={24} color="#1C1B1A" />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1, padding: 16 }}>
            {wardrobe.length === 0 ? (
              <Text style={{ textAlign: 'center', color: '#8C857E', marginTop: 40 }}>Dolabınızda henüz kıyafet bulunmuyor.</Text>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {wardrobe.map((item) => {
                  const isSelected = manualSelectedItems.some(i => i.id === item.id);
                  return (
                    <TouchableOpacity
                      key={item.id}
                      onPress={() => toggleManualItem(item)}
                      style={{
                        width: '47%',
                        backgroundColor: '#FFFFFF',
                        borderRadius: 16,
                        padding: 8,
                        borderWidth: 2,
                        borderColor: isSelected ? '#1C1B1A' : '#EDE8E1'
                      }}
                    >
                      <Image source={{ uri: item.uri }} style={{ width: '100%', height: 130, borderRadius: 10 }} />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#1C1B1A', marginTop: 6 }} numberOfLines={1}>{getItemField(item, 'subCategory', lang)}</Text>
                      <Text style={{ fontSize: 10, color: '#7A6856' }}>{getItemField(item, 'color', lang)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>

          <View style={{ padding: 16, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderColor: '#EDE8E1' }}>
            <TouchableOpacity
              onPress={saveManualOutfit}
              style={{
                backgroundColor: '#1C1B1A',
                paddingVertical: 14,
                borderRadius: 16,
                alignItems: 'center'
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>Kombini Tamamla & Giydir</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {/* YENİ: Ajanda Hızlı Planlama Modalı */}
      <Modal visible={plannerModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPlannerModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#FAF8F5', padding: 20, paddingTop: Platform.OS === 'ios' ? 40 : 20 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <View>
              <Text style={{ fontSize: 18, fontWeight: '800', color: '#1C1B1A' }}>{dayToPlan} İçin Seç</Text>
              <Text style={{ fontSize: 12, color: '#7A6856' }}>Panolarındaki kayıtlı kombinlerden birini ata</Text>
            </View>
            <TouchableOpacity onPress={() => setPlannerModalVisible(false)}>
              <X size={24} color="#1C1B1A" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {collections.reduce((acc, board) => [...acc, ...board.outfits], []).length === 0 ? (
              <Text style={{ textAlign: 'center', color: '#8C857E', marginTop: 40 }}>Henüz hiçbir panoya kombin kaydetmemişsin. Ana sayfadaki kalp butonunu kullan!</Text>
            ) : (
              collections.reduce((acc, board) => [...acc, ...board.outfits], []).map((outfit, idx) => (
                <TouchableOpacity 
                  key={idx} 
                  onPress={() => {
                    setWeeklyPlanner(prev => ({ ...prev, [dayToPlan]: outfit }));
                    setPlannerModalVisible(false);
                    showAlert(lang === 'tr' ? '✅ Planlandı' : '✅ Scheduled', lang === 'tr' ? `${dayToPlan} günü için harika bir seçim!` : `Great choice for ${dayToPlan}!`);
                  }}
                  style={{ backgroundColor: '#FFF', padding: 14, borderRadius: 16, borderWidth: 1, borderColor: '#EDE8E1', marginBottom: 12 }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#1C1B1A', marginBottom: 8 }}>{outfit.title}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {outfit.items.map(item => (
                      <Image key={item.id} source={{ uri: item.uri }} style={{ width: 50, height: 50, borderRadius: 8, backgroundColor: '#FAF8F5', borderWidth: 1, borderColor: '#EDE8E1' }} />
                    ))}
                  </ScrollView>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
      {/* KIYAFET SEÇENEKLERİ MENÜSÜ (Uzun Basınca Açılır) */}
      <Modal visible={clothOptionsModalVisible} transparent animationType="fade" onRequestClose={() => setClothOptionsModalVisible(false)}>
        <TouchableOpacity 
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }} 
          activeOpacity={1} 
          onPress={() => setClothOptionsModalVisible(false)}
        >
          <View style={{ backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24 }}>
            {selectedCloth && (
              <View>
                <Text style={{ fontSize: 18, fontWeight: '800', color: '#1C1B1A', marginBottom: 20 }}>
                  {getItemField(selectedCloth, 'subCategory', lang)}
                </Text>
                
                {/* 1. Favorile Butonu */}
                <TouchableOpacity onPress={() => {
                  setWardrobe(wardrobe.map(item => item.id === selectedCloth.id ? { ...item, isFavorite: !item.isFavorite } : item));
                  setClothOptionsModalVisible(false);
                }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderColor: '#EDE8E1', gap: 12 }}>
                  <Heart size={20} color={selectedCloth.isFavorite ? '#D9534F' : '#1C1B1A'} fill={selectedCloth.isFavorite ? '#D9534F' : 'transparent'} />
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#1C1B1A' }}>
                    {selectedCloth.isFavorite ? 'Favorilerden Çıkar' : 'Favorilere Ekle'}
                  </Text>
                </TouchableOpacity>

                {/* 2. Kirli Sepeti Butonu */}
                <TouchableOpacity onPress={() => {
                  toggleLaundry(selectedCloth.id);
                  setClothOptionsModalVisible(false);
                }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderColor: '#EDE8E1', gap: 12 }}>
                  <Text style={{ fontSize: 20 }}>{selectedCloth.isDirty ? '✨' : '🧺'}</Text>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#1C1B1A' }}>
                    {selectedCloth.isDirty ? 'Temizlendi Olarak İşaretle' : 'Kirli Sepetine At'}
                  </Text>
                </TouchableOpacity>

                {/* 3. Sil Butonu */}
                <TouchableOpacity onPress={() => {
                  removeCloth(selectedCloth.id);
                  setClothOptionsModalVisible(false);
                }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 }}>
                  <Trash2 size={20} color="#D9534F" />
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#D9534F' }}>Dolaptan Sil</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
      {/* AURA PREMIUM (PAYWALL) EKRANI */}
      <Modal visible={proModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setProModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#1C1B1A', padding: 24, justifyContent: 'center' }}>
          <View style={{ alignItems: 'center', marginBottom: 40 }}>
            <Sparkles size={50} color="#F3EDE2" style={{ marginBottom: 20 }} />
            <Text style={{ fontSize: 28, fontWeight: '800', color: '#FFF', textAlign: 'center' }}>Aura Premium</Text>
            <Text style={{ fontSize: 15, color: '#A8A29D', textAlign: 'center', marginTop: 10, lineHeight: 22 }}>
              Ücretsiz dolap limitine (15 parça) ulaştın. Sınırsız bir gardırop ve sınırsız yapay zeka tavsiyesi için Premium'a geç.
            </Text>
          </View>

          <View style={{ backgroundColor: '#2C2A29', borderRadius: 20, padding: 24, gap: 16, marginBottom: 40 }}>
            {['Sınırsız kıyafet ekleme', 'Gelişmiş desen ve renk analizi', 'Haftalık sınırsız kombin planlama', 'Kirlileri akıllıca yönetme'].map((feature, idx) => (
              <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#F3EDE2', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#1C1B1A' }}>✓</Text>
                </View>
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#FFF' }}>{feature}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity 
            style={{ backgroundColor: '#F3EDE2', paddingVertical: 18, borderRadius: 100, alignItems: 'center', marginBottom: 16 }}
            onPress={() => {
              // Şimdilik test için basınca Pro yapıyor
              setIsProUser(true);
              setProModalVisible(false);
              showAlert(
                lang === 'tr' ? 'Hoş Geldin VIP' : 'Welcome VIP',
                lang === 'tr' ? 'Aura Premium özellikleri aktif edildi!' : 'Aura Premium features have been activated!'
              );
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '800', color: '#1C1B1A' }}>Aylık 99.90 TL - Şimdi Başla</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setProModalVisible(false)} style={{ alignItems: 'center', padding: 10 }}>
            <Text style={{ fontSize: 14, color: '#A8A29D', fontWeight: '600' }}>Belki Daha Sonra</Text>
          </TouchableOpacity>
        </View>
      </Modal> 
      <Onboarding visible={onboardingVisible} lang={lang} onComplete={finishOnboarding} />
      {dialogView}
    </SafeAreaView>
  );
}
  
const styles = StyleSheet.create({
  primaryButton: { backgroundColor: '#1C1B1A', borderRadius: 14, padding: 15, alignItems: 'center' },
  primaryButtonText: { color: '#FFF', fontWeight: '700', textAlign: 'center' },
  filterChip: { paddingHorizontal: 15, paddingVertical: 10, borderRadius: 20, backgroundColor: '#EDE8E1' },
  inspirationCard: { flexGrow: 1, flexBasis: '30%', minWidth: 240, maxWidth: 420, backgroundColor: '#FFF', borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: '#EDE8E1' },
  photoPickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  photoPickerCard: { backgroundColor: '#FFF', borderRadius: 24, padding: 24, width: '100%', maxWidth: 400 },
  photoPickerTitle: { fontSize: 20, fontWeight: '800', color: '#1C1B1A', marginBottom: 8 },
  photoPickerDescription: { color: '#7A6856', marginBottom: 16 },
  photoPickerButton: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: '#FAF8F5', borderRadius: 12, marginTop: 8 },
  safeArea: { flex: 1, backgroundColor: '#FAF8F5' },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE8E1',
  },
  headerLogo: { fontSize: 22, fontWeight: '700', color: '#1C1B1A', letterSpacing: 0.5 },
  langBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFEAE4',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 16,
  },
  langText: { fontSize: 12, fontWeight: '600', color: '#1C1B1A' },
  loadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAE4DC',
    paddingVertical: 10,
    gap: 8,
  },
  loadingText: { fontSize: 12, color: '#1C1B1A', fontWeight: '600' },
  mainContainer: { padding: 18, paddingBottom: 110 },
  tabSection: { gap: 16 },
  sectionHeading: { fontSize: 18, fontWeight: '700', color: '#1C1B1A' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  
  // Gardırop Kartları
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  
  studioBackdrop: {
      width: '100%',
      height: 140, // Resim alanının yüksekliğini zorlar, resimler geri gelir
      backgroundColor: '#FAF8F5',
      borderRadius: 12,
      marginBottom: 8,
      overflow: 'hidden',
    },
  gridClothImg: {
      width: '100%',
      height: '100%',
      resizeMode: 'contain', // 'cover' yerine 'contain' yapıyoruz
    },
  clothInfoBadge: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderTopColor: '#F0EBE3',
  },
  clothTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1C1B1A',
  },
  clothDetail: {
    fontSize: 9,
    color: '#8C857E',
  },
  deleteClothBtn: {
    position: 'absolute',
    top: 5,
    right: 5,
    backgroundColor: 'rgba(28, 27, 26, 0.7)',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // 2. KART VE GÖLGE PÜRÜZSÜZLEŞTİRME
    sectionCard: {
      backgroundColor: '#FFFFFF',
      borderRadius: 24,
      padding: 20,
      borderWidth: 1,
      borderColor: 'rgba(237, 232, 225, 0.6)', // Çok hafif şeffaf krem çerçeve
      shadowColor: '#1C1B1A',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.03, // Ekstra yumuşak gölge
      shadowRadius: 16,
      elevation: 2,
      marginBottom: 16,
    },
    gridClothCard: {
      width: '48%',
      backgroundColor: '#FFFFFF',
      borderRadius: 20,
      padding: 8,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: 'rgba(237, 232, 225, 0.6)',
      shadowColor: '#1C1B1A',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.04,
      shadowRadius: 12,
      elevation: 2,
      minHeight: 210, // Kartın içine çökmesini engeller
    },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#1C1B1A' },
  subText: { fontSize: 13, color: '#8C857E', marginTop: 2 },
  emptyHomeBox: {
    padding: 30,
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FAF8F5',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE8E1',
    borderStyle: 'dashed'
  },
  emptyHomeText: { fontSize: 13, color: '#8C857E', textAlign: 'center' },
  outfitItemsRow: { flexDirection: 'row', gap: 12, paddingBottom: 10 },
  outfitItemCard: {
    width: 115,
    backgroundColor: '#FAF8F5',
    borderRadius: 14,
    padding: 8,
    borderWidth: 1,
    borderColor: '#EAE4DC',
    alignItems: 'center'
  },
  outfitItemImg: { width: 95, height: 95, resizeMode: 'contain' },
  outfitItemName: { fontSize: 11, fontWeight: '700', color: '#1C1B1A', marginTop: 4 },
  outfitItemColor: { fontSize: 10, color: '#8C857E' },
  stylistNoteBox: {
    backgroundColor: '#FAF8F5',
    padding: 12,
    borderRadius: 12,
    marginVertical: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#1C1B1A'
  },
  stylistNoteText: { fontSize: 12, color: '#4A4643', lineHeight: 17 },
  actionButtons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  swapButton: {
    flex: 1,
    backgroundColor: '#1C1B1A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
  },
  swapButtonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  heartButton: {
    width: 48,
    backgroundColor: '#F3EDE2',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  paletteRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  paletteItem: { alignItems: 'center' },
  colorCircle: { width: 44, height: 44, borderRadius: 22, marginBottom: 6, borderWidth: 1, borderColor: '#E8E2D9' },
  colorLabel: { fontSize: 11, color: '#7A7571' },
  addSmallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1B1A',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    gap: 4,
  },
  addSmallBtnText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  emptyCard: {
    backgroundColor: '#FFF',
    borderWidth: 1.5,
    borderColor: '#E8E2D9',
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 30,
    alignItems: 'center',
    gap: 10,
  },
  emptyCardText: { fontSize: 13, color: '#8C857E', textAlign: 'center' },
  exploreCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EDE8E1',
    overflow: 'hidden',
    marginBottom: 10,
  },
  explorePlaceholder: {
    height: 140,
    backgroundColor: '#F3EFEA',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  exploreTags: { fontSize: 12, color: '#9C958E' },
  exploreInfoRow: {
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  exploreTitle: { fontSize: 14, fontWeight: '600', color: '#1C1B1A' },
  matchButton: {
    backgroundColor: '#EFEAE4',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  matchButtonText: { fontSize: 12, fontWeight: '600', color: '#1C1B1A' },
  collectionItemCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EDE8E1',
  },
  collectionTitle: { fontSize: 15, fontWeight: '600', color: '#1C1B1A' },
  planCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EDE8E1',
    gap: 6,
  },
  proPlanCard: { borderColor: '#E4DDD3', backgroundColor: '#FAF7F2', borderWidth: 1.5 },
  planName: { fontSize: 16, fontWeight: '700', color: '#7A7571' },
  proTitle: { fontSize: 16, fontWeight: '700', color: '#1C1B1A' },
  planPrice: { fontSize: 18, fontWeight: '700', color: '#1C1B1A', marginVertical: 4 },
  proPrice: { fontSize: 20, fontWeight: '700', color: '#7A6856', marginVertical: 4 },
  planFeature: { fontSize: 13, color: '#5C554E' },
  upgradeMainBtn: {
    backgroundColor: '#1C1B1A',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  upgradeMainBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },
  /* LÜKS ALT MENÜ (TAB BAR) STİLLERİ */
    bottomTabBar: {
      flexDirection: 'row',
      backgroundColor: '#FFFFFF',
      height: Platform.OS === 'ios' ? 90 : 70, // iOS için alt çizgiyi kurtaracak yükseklik
      paddingBottom: Platform.OS === 'ios' ? 25 : 10,
      paddingHorizontal: 10,
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: 'rgba(237, 232, 225, 0.8)',
      position: 'absolute',
      bottom: 0,
      width: '100%',
      // Pürüzsüz üst gölge
      shadowColor: '#1C1B1A',
      shadowOffset: { width: 0, height: -6 },
      shadowOpacity: 0.04,
      shadowRadius: 16,
      elevation: 15,
    },
    tabButton: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      height: 50,
    },
    tabLabel: {
      fontSize: 10,
      marginTop: 4,
      color: '#A8A29D',
      fontWeight: '600',
    },
    tabLabelActive: {
      color: '#1C1B1A',
      fontWeight: '800',
    },
    
    /* ORTADAKİ YÜZEN (FLOATING) BUTON STİLİ */
    centerTabButton: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: -30, // Butonu hafifçe yukarı taşırır (Lüks görünüm)
    },
    centerCircle: {
      width: 58,
      height: 58,
      borderRadius: 29,
      backgroundColor: '#1C1B1A', // Aura'nın ana siyahı
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 4,
      borderColor: '#FAF8F5', // Butonun etrafına arka plan renginde bir çerçeve verip kesik efekti yaratır
      // Buton gölgesi
      shadowColor: '#1C1B1A',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
      elevation: 8,
    },
    centerCircleActive: {
      backgroundColor: '#2A5C6A', // Aktifken şık bir koyu yeşil/mavi tona döner
    },
  });
