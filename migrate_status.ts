import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

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
