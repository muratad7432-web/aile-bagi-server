const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(
  fs.readFileSync('/etc/secrets/serviceAccount.json', 'utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();
console.log('Aile Bağı bildirim sunucusu başladı...');

// ─────────────────────────────────────────────
// YARDIMCI: FCM token ile bildirim gönder
// ─────────────────────────────────────────────
async function bildirimGonder(token, baslik, icerik) {
  try {
    await admin.messaging().send({
      token: token,
      notification: {
        title: baslik,
        body: icerik
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'ailebagi_channel'
        }
      }
    });
  } catch (e) {
    console.log('Bildirim gönderilemedi: ' + e.message);
  }
}

// ─────────────────────────────────────────────
// GRUP MESAJLARI: grupMesajlari/{aileKodu}/{mesajId}
// ─────────────────────────────────────────────
db.ref('grupMesajlari').on('child_added', (aileSnap) => {
  const aileKodu = aileSnap.key;

  // Her aile kodu için mesajları dinle
  db.ref('grupMesajlari/' + aileKodu).on('child_added', async (mesajSnap) => {
    const msg = mesajSnap.val();
    if (!msg || !msg.gonderenId || !msg.zaman) return;

    // Sadece son 10 saniye içindeki mesajlar için bildirim gönder
    if (Date.now() - msg.zaman > 10000) return;

    const gonderenId = msg.gonderenId;
    const gonderenAd = msg.gonderenAd || 'Biri';
    const tip = msg.tip || 'metin';

    let icerik = '';
    if (tip === 'metin') icerik = msg.mesaj || '';
    else if (tip === 'resim') icerik = '📷 Fotoğraf gönderdi';
    else if (tip === 'ses') icerik = '🎤 Sesli mesaj gönderdi';

    try {
      // Aynı aile koduna sahip tüm kullanıcıları bul
      const usersSnap = await db.ref('kullanicilar')
        .orderByChild('aileKodu')
        .equalTo(aileKodu)
        .get();

      if (!usersSnap.exists()) return;

      const promises = [];
      usersSnap.forEach((userSnap) => {
        const user = userSnap.val();
        const uid = userSnap.key;

        // Gönderen kişiye bildirim gönderme
        if (uid === gonderenId) return;
        if (!user || !user.fcmToken) return;

        promises.push(
          bildirimGonder(
            user.fcmToken,
            '👨‍👩‍👧 ' + gonderenAd,
            icerik
          )
        );
        console.log('Grup bildirimi → ' + (user.ad || uid));
      });

      await Promise.all(promises);
    } catch (e) {
      console.log('Grup mesaj hatası: ' + e.message);
    }
  });
});

// ─────────────────────────────────────────────
// ÖZEL MESAJLAR: ozelMesajlar/{sohbetId}/{mesajId}
// ─────────────────────────────────────────────
db.ref('ozelMesajlar').on('child_added', (sohbetSnap) => {
  const sohbetId = sohbetSnap.key;

  db.ref('ozelMesajlar/' + sohbetId).on('child_added', async (mesajSnap) => {
    const msg = mesajSnap.val();
    if (!msg || !msg.gonderenId || !msg.zaman) return;

    // Sadece son 10 saniye içindeki mesajlar
    if (Date.now() - msg.zaman > 10000) return;

    const gonderenId = msg.gonderenId;

    // sohbetId = "uid1_uid2" formatında, alıcıyı bul
    const uidler = sohbetId.split('_');
    if (uidler.length !== 2) return;
    const aliciId = uidler[0] === gonderenId ? uidler[1] : uidler[0];

    const tip = msg.tip || 'metin';
    let icerik = '';
    if (tip === 'metin') icerik = msg.mesaj || '';
    else if (tip === 'resim') icerik = '📷 Fotoğraf gönderdi';
    else if (tip === 'ses') icerik = '🎤 Sesli mesaj gönderdi';

    try {
      const gonderenSnap = await db.ref('kullanicilar/' + gonderenId).get();
      const gonderen = gonderenSnap.val();
      const gonderenAd = gonderen ? (gonderen.ad || 'Biri') : 'Biri';

      const aliciSnap = await db.ref('kullanicilar/' + aliciId).get();
      const alici = aliciSnap.val();
      if (!alici || !alici.fcmToken) return;

      await bildirimGonder(alici.fcmToken, gonderenAd, icerik);
      console.log('Özel bildirim → ' + (alici.ad || aliciId));
    } catch (e) {
      console.log('Özel mesaj hatası: ' + e.message);
    }
  });
});

// ─────────────────────────────────────────────
// HTTP — Render.com sunucuyu ayakta tutar
// ─────────────────────────────────────────────
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Aile Bağı Sunucusu Çalışıyor ✅');
}).listen(process.env.PORT || 3000, () => {
  console.log('HTTP sunucu port ' + (process.env.PORT || 3000) + " üzerinde çalışıyor");
});
