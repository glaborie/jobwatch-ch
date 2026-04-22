import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, updateDoc, doc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID);

async function migrate() {
  console.log("Starting migration...");
  const querySnapshot = await getDocs(collection(db, "jobs"));
  let count = 0;
  for (const document of querySnapshot.docs) {
    const data = document.data();
    if (!data.status) {
      await updateDoc(doc(db, "jobs", document.id), {
        status: 'new'
      });
      count++;
    }
  }
  console.log(`Migration complete. Updated ${count} jobs.`);
  process.exit(0);
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
