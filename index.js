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

// Özel mesaj bildirimleri
db.ref('chats').on('child_added', (chatSnap) => {
  let initialized = false;
  db.ref('chats/' + chatSnap.key).on('child_added', async (msgSnap) => {
    if (!initialized) {
      initialized = true;
      return;
    }
    const msg = msgSnap.val();
    if (!msg || !msg.senderId || !msg.text) return;

    const chatId = chatSnap.key;
    const uids = chatId.split('_');
    const receiverId = uids[0] === msg.senderId ? uids[1] : uids[0];

    try {
      const userSnap = await db.ref('users/' + receiverId).get();
      const receiver = userSnap.val();
      if (!receiver || !receiver.fcmToken) return;

      const senderSnap = await db.ref('users/' + msg.senderId).get();
      const sender = senderSnap.val();
      const senderName = sender ? sender.name : 'Biri';

      await admin.messaging().send({
        token: receiver.fcmToken,
        notification: {
          title: senderName,
          body: msg.text
        },
        android: { priority: 'high' }
      });
      console.log('Özel bildirim gönderildi: ' + receiverId);
    } catch (e) {
      console.log('Özel bildirim hatası: ' + e.message);
    }
  });
});

// Grup mesaj bildirimleri
let groupInitialized = false;
db.ref('groupChat').on('child_added', async (msgSnap) => {
  if (!groupInitialized) {
    groupInitialized = true;
    return;
  }
  
  const msg = msgSnap.val();
  if (!msg || !msg.senderId || !msg.text) return;

  try {
    const usersSnap = await db.ref('users').get();
    const promises = [];
    
    usersSnap.forEach((userSnap) => {
      const user = userSnap.val();
      if (!user || !user.fcmToken || user.uid === msg.senderId) return;

      promises.push(
        admin.messaging().send({
          token: user.fcmToken,
          notification: {
            title: '👨‍👩‍👧 ' + (msg.senderName || 'Biri'),
            body: msg.text
          },
          android: { priority: 'high' }
        }).then(() => {
          console.log('Grup bildirimi gönderildi: ' + user.name);
        }).catch(e => {
          console.log('Grup bildirim hatası: ' + e.message);
        })
      );
    });
    
    await Promise.all(promises);
  } catch (e) {
    console.log('Grup genel hatası: ' + e.message);
  }
});

// Sunucuyu ayakta tut
const http = require('http');
http.createServer((req, res) => {
  res.end('Aile Bağı Server Çalışıyor');
}).listen(process.env.PORT || 3000);
