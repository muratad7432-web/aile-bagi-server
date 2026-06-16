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

db.ref('chats').on('child_added', (chatSnap) => {
  db.ref('chats/' + chatSnap.key).on('child_added', async (msgSnap) => {
    const msg = msgSnap.val();
    if (!msg || !msg.senderId || !msg.text) return;

    const chatId = chatSnap.key;
    const uids = chatId.split('_');
    const receiverId = uids[0] === msg.senderId ? uids[1] : uids[0];

    const userSnap = await db.ref('users/' + receiverId).get();
    const receiver = userSnap.val();
    if (!receiver || !receiver.fcmToken) return;

    const senderSnap = await db.ref('users/' + msg.senderId).get();
    const sender = senderSnap.val();
    const senderName = sender ? sender.name : 'Biri';

    try {
      await admin.messaging().send({
        token: receiver.fcmToken,
        notification: {
          title: senderName,
          body: msg.text
        },
        android: { priority: 'high' }
      });
      console.log('Bildirim gönderildi: ' + receiverId);
    } catch (e) {
      console.log('Bildirim hatası: ' + e.message);
    }
  });
});

db.ref('groupChat').on('child_added', async (msgSnap) => {
  const msg = msgSnap.val();
  if (!msg || !msg.senderId || !msg.text) return;

  const usersSnap = await db.ref('users').get();
  usersSnap.forEach(async (userSnap) => {
    const user = userSnap.val();
    if (!user || !user.fcmToken || user.uid === msg.senderId) return;

    try {
      await admin.messaging().send({
        token: user.fcmToken,
        notification: {
          title: '👨‍👩‍👧‍👦 ' + msg.senderName,
          body: msg.text
        },
        android: { priority: 'high' }
      });
    } catch (e) {
      console.log('Grup bildirim hatası: ' + e.message);
    }
  });
});

const http = require('http');
http.createServer((req, res) => {
  res.end('Aile Bağı Server Çalışıyor');
}).listen(process.env.PORT || 3000);
