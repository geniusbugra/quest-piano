# Quest Piyano

Meta Quest 3 için mixed reality piyano. Gerçek boyutta tam 88 tuş (A0–C8) odanda havada durur, parmak uçlarınla çalarsın.

## Quest'te çalıştırma

1. Bilgisayarda bu klasörde: `python serve.py`
   - Windows güvenlik duvarı sorarsa **Özel ağlar** için izin ver.
2. Quest ve bilgisayar **aynı Wi-Fi**'da olsun. Quest'te tarayıcıyı aç, ekrana yazan adresi gir (`https://192.168.x.x:8443`).
3. "Bağlantı gizli değil" uyarısı çıkar (sertifika kendi yaptığımız için): **Gelişmiş → Devam et**.
4. **START AR**'a bas. Piyano önünde belirir.

## Nasıl çalınır

- Parmak uçlarınla tuşlara bas: hızlı vurursan daha yüksek ses çıkar.
- Kumandayla da olur: kumandanın ucundaki mavi top tuşlara basar.
- **Piyanoyu taşımak:** tuşların arkasındaki siyah paneli (ya da soldaki mavi topu) başparmak + işaret parmağınla sıkıştır (pinch) ve sürükle. Tuttuğun nokta elinde kalır: ortasından tutarsan piyano tam önüne gelir. Gerçek bir masanın üstüne koyabilirsin.
- Bilgisayarda açarsan fareyle tıklayarak da deneyebilirsin.

## FL Studio'da MIDI klavye olarak kullanmak

1. loopMIDI kurulu olsun (sürücüsü lazım; programı açmana gerek yok).
2. Bilgisayarda: `python midi_bridge.py` — sayfayı da sunar ve "Quest Piyano" adlı bir MIDI girişi açar.
3. Quest'e ulaştırmak için tünel: `cloudflared tunnel --url http://localhost:8000` (ekrana yazan `https://...trycloudflare.com` adresi).
4. Quest'te adresin sonuna `?midi` ekle: `https://...trycloudflare.com/?midi`. Bu modda piyanonun kendi sesi kapanır, sesi FL çıkarır.
5. FL Studio: **Options → MIDI settings** → Input listesinde **Quest Piyano**'yu seç ve **Enable** yap. Bir enstrüman seçip çal.

Not: notalar internet tünelinden geçtiği için az bir gecikme olabilir.

## Test

`python midi_bridge_test.py` (köprü çalışırken) — MIDI portunu dinler, notaların geldiğini ve bozuk mesajların atıldığını doğrular.

`npm test` — tuş düzeni ve dokunma mantığı.

## Krediler

Piyano sesi: Salamander Grand Piano V3, Alexander Holm, CC-BY 3.0 (tonejs.github.io üzerinden).
