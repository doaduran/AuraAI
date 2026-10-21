# AuraAI güncellemesi

## Cloudflare'a elle yükleme

Hazır web sürümü `mobile/dist` klasöründedir. `shrill-dawn-2c7b` projesinin yeni yayın ekranında klasörün **içindeki tüm öğeleri** birlikte yükle: `_expo`, `assets`, `index.html` ve `metadata.json`. Yeni başlangıç görseli için `assets` klasörü gereklidir. Klasör zaten derlenmiştir; tekrar derlemek gerekmez.

Yayından sonra sayfayı tamamen yenile. Ana sayfadan beş soruluk testi bitirip kaydet; sayfayı yenileyince sonuç korunmalı. Selfie ile Analiz'de kamera/galeri menüsünü, İlham'da fotoğrafları ve filtreleri dene. Gerçek fotoğraf seçme ve kamera açılışı kullanılan cihazda ayrıca denenmelidir; masaüstü tarayıcı kamera yerine dosya seçiciyi açabilir.

## GitHub ve bilgisayardaki kaynaklar

Bu güncelleme artık sadece App.js'den oluşmuyor. `AuraAI-kaynak-guncellemesi.zip` içindeki `mobile` dosyalarını GitHub'daki aynı konumlara ekle/güncelle:

- App.js
- AppDialog.js
- StyleQuiz.js
- styleProfile.js
- inspirations.js
- Onboarding.js
- shoppingAssistant.js
- assets klasörü
- package.json
- tests klasörü

Bilgisayardaki `C:\Users\dogaa\Desktop\mobile` projesini kullanmaya devam edeceksen aynı kaynak dosyalarını o klasöre de kopyala. Bu çalışma eski klasörünü değiştirmedi. Gelecekteki derlemelerde tek kaynak sürümünü esas al.

## Neler değişti?

- İlk açılışta dört sayfalık kaydırmalı başlangıç turu eklenir; örnek gardrop gösterilir, gerçek dolaba örnek parça eklenmez. Tur atlanabilir, tamamlandıktan sonra otomatik açılmaz ve profilden yeniden izlenebilir.
- Asistan sohbetine kamera/galeriden alışveriş adayı eklenebilir. Fotoğraf önizlenir, kaldırılabilir ve gönderildiğinde tarz/dolap bağlamıyla değerlendirilir. Aday gardroba otomatik eklenmez. Devam soruları son gönderilen fotoğrafı korur; başarısız istek tekrar denenebilir.
- Web'de desteklenmeyen uyarı ve seçim menüleri uygulama içi pencereyle açılır. Selfie seçicisi doğrudan tıklamada başlar; PNG/JPEG türü korunur, mobil izinler kontrol edilir.
- Beş soruluk stil testi altı stil arasında puanlama yapar; ana ve ikincil stil ile kesim, renk, ortam ve öncelik cevaplarını saklar. Bu bir tercih testidir, psikometrik ölçüm veya eğitilmiş kişisel model değildir.
- Günlük kombin ve stilist sohbeti test cevaplarını kullanır. Kişisel palet yalnızca yeni bir selfie analizinden sonra AI bağlamına eklenir. Varsayılan palet kişisel analiz gibi sunulmaz.
- İlham'daki eski metin düğmeleri kaynaklı Unsplash fotoğrafları ve stil filtreleriyle değiştirildi. Bu seçki canlı Pinterest akışı değildir. Pinterest düğmesi dışarıda arama açar; resmi Pinterest API bağlantısı için geliştirici erişimi gerekir.
- Bir ilham fotoğrafı seçilince gerçek görsel AI'a gönderilir ve yalnızca temiz dolap parçalarıyla eşleştirilir. Kendi kombin fotoğrafını da seçebilirsin.
- Günlük kombinde istenen ve okunan JSON alanları eşitlendi (`title`, `note`, `itemIds`). Hayali/kirli ID'ler reddedilir; hata durumunda ilk parçayla sahte başarı gösterilmez.
- Kaydedilmiş verilerin açılışta boş değerlerle ezilmesi önlendi. Stil testinin sayfa yenilenince korunması tarayıcıda doğrulandı.

## Kontroller ve sınırlar

`mobile` içinde `npm test` ve `npm run build:web` çalıştırılabilir. Otomatik kontroller 1536 test cevabı kombinasyonunu, seçim menülerini, AI yanıt alanlarını, kirli/uydurma ID'lerin reddini ve ilham görselinin AI isteğine eklenmesini kapsar.

21 Ekim 2026'da canlı `/gemini` adresine kişisel veri içermeyen üç örnek kıyafetle gönderilen tek istekte HTTP 502 / model yoğunluğu yanıtı alındı. Dolayısıyla canlı öneri kalitesi ve gerçek selfie analizi başarıyla doğrulanmış değildir. Modelin görsel anlama yeteneği olması, stil önerilerinin kalitesini garanti etmez. Gerçek örneklerle ayrıca değerlendirilmelidir. Mevcut Worker kodu/Cloudflare ayarları bu güncellemede değiştirilmedi.

Fotoğraf kaynakları ve kullanım koşulları her karttaki Unsplash bağlantılarında bulunur. Bu sürüm fotoğraf lisanslarını Unsplash+ ile karıştırmadan, ücretsiz Unsplash lisanslı bir seçki kullanır.

22 Ekim 2026 kontrolü: üretilmiş örnek kıyafet fotoğrafı ve test profiliyle alışveriş sohbetinden gerçek bir AI yanıtı alındı. Yanıt, profil tercihlerini kullandı ve boş dolap için sahip olunmayan parçaları uydurmadı. Başlangıç turunun kaydırılması, bitirilmesi, yenilemede tekrar açılmaması ve profilden yeniden izlenmesi de tarayıcıda doğrulandı.
