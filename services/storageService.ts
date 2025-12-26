import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import { ItineraryResult } from "../types";

// ==========================================
// CONFIGURATION STEP:
// Netlify 部署時，請在 Netlify 後台 Environment Variables 設定這些變數
// 變數名稱必須以 VITE_ 開頭
// ==========================================
const firebaseConfig = {
  // 優先使用環境變數 (Deployment Mode)
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID
  
  // 如果您在本地開發且沒有設定 .env，可以將字串直接寫死在下方 (但不建議上傳到 GitHub)
  // apiKey: "Your-String-Here", ...
};

let db: any = null;

// Initialize Firebase
try {
  // Check if config has values (either from env or hardcoded)
  // We use projectId as a sanity check
  if (firebaseConfig.projectId) {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    console.log("Firebase initialized successfully");
  } else {
    console.warn("Firebase config is missing or empty. Falling back to LocalStorage.");
  }
} catch (e) {
  console.error("Firebase initialization failed:", e);
  console.warn("Falling back to LocalStorage.");
}

export const saveItineraryToCloud = async (itinerary: ItineraryResult): Promise<string> => {
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
  
  if (db) {
    try {
      // Create a reference to the document
      const docRef = doc(db, "itineraries", id);
      // Write the data
      await setDoc(docRef, {
        ...itinerary,
        createdAt: new Date().toISOString()
      });
      console.log("Document written with ID: ", id);
      return id;
    } catch (e) {
      console.error("Error adding document to Firebase: ", e);
      alert("儲存至雲端失敗，可能是 Firebase 設定錯誤或權限問題 (請檢查 Firestore 是否開啟 Test Mode)。將使用本地儲存代替。");
      // Fallback to local storage
      localStorage.setItem(`itinerary_${id}`, JSON.stringify(itinerary));
      return id;
    }
  } else {
    // LocalStorage Fallback
    console.log("Using LocalStorage fallback");
    localStorage.setItem(`itinerary_${id}`, JSON.stringify(itinerary));
    return id; 
  }
};

export const getItineraryFromCloud = async (id: string): Promise<ItineraryResult | null> => {
  if (db) {
    try {
      const docRef = doc(db, "itineraries", id);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        console.log("Document data:", docSnap.data());
        return docSnap.data() as ItineraryResult;
      } else {
        console.log("No such document!");
      }
    } catch (e) {
      console.error("Error getting document:", e);
    }
  }
  
  // Try local storage if Firebase fails, is not configured, or doc not found in cloud
  const localData = localStorage.getItem(`itinerary_${id}`);
  if (localData) {
    return JSON.parse(localData) as ItineraryResult;
  }
  
  return null;
};