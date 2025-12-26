import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import { ItineraryResult } from "../types";

// Helper to safely get env vars using ONLY standard Vite import.meta.env
const getEnv = (viteKey: string) => {
  if (import.meta.env && import.meta.env[viteKey]) {
    return import.meta.env[viteKey];
  }
  return "";
};

// ==========================================
// CONFIGURATION
// 優先讀取環境變數，若無則使用您提供的預設 Key
// ==========================================
const firebaseConfig = {
  apiKey: getEnv("VITE_FIREBASE_API_KEY") || "AIzaSyApTRuB4BtacYk8D3iAGzU_nsgbu66YpLc",
  authDomain: getEnv("VITE_FIREBASE_AUTH_DOMAIN") || "formyapp-43033.firebaseapp.com",
  projectId: getEnv("VITE_FIREBASE_PROJECT_ID") || "formyapp-43033",
  storageBucket: getEnv("VITE_FIREBASE_STORAGE_BUCKET") || "formyapp-43033.firebasestorage.app",
  messagingSenderId: getEnv("VITE_FIREBASE_MESSAGING_SENDER_ID") || "889309076845",
  appId: getEnv("VITE_FIREBASE_APP_ID") || "1:889309076845:web:f67056139ddbb9cdb30e64",
  measurementId: getEnv("VITE_FIREBASE_MEASUREMENT_ID") || "G-NL99S0SH6W",
  databaseURL: getEnv("VITE_FIREBASE_DATABASE_URL") || "https://formyapp-43033-default-rtdb.firebaseio.com"
};

let db: any = null;

// Initialize Firebase
try {
  if (firebaseConfig.projectId) {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    console.log("Firebase initialized successfully with Project ID:", firebaseConfig.projectId);
  } else {
    console.warn("Firebase config is missing. Falling back to LocalStorage.");
  }
} catch (e) {
  console.error("Firebase initialization failed:", e);
  console.warn("Falling back to LocalStorage.");
}

export const saveItineraryToCloud = async (itinerary: ItineraryResult): Promise<string> => {
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2);
  
  if (db) {
    try {
      console.log("Attempting to save to Firestore...");
      const docRef = doc(db, "itineraries", id);
      await setDoc(docRef, {
        ...itinerary,
        createdAt: new Date().toISOString()
      });
      console.log("Document successfully written with ID: ", id);
      return id;
    } catch (e: any) {
      console.error("Error adding document to Firebase: ", e);
      // 詳細錯誤提示
      if (e.code === 'permission-denied') {
        alert("儲存失敗：權限不足。請檢查 Firebase Firestore Rules 是否設定為 true。");
      } else {
        alert(`儲存至雲端失敗 (${e.message})。將使用本地儲存代替。`);
      }
      
      // Fallback
      localStorage.setItem(`itinerary_${id}`, JSON.stringify(itinerary));
      return id;
    }
  } else {
    console.log("Using LocalStorage fallback (No DB connection)");
    localStorage.setItem(`itinerary_${id}`, JSON.stringify(itinerary));
    return id; 
  }
};

export const getItineraryFromCloud = async (id: string): Promise<ItineraryResult | null> => {
  console.log("Fetching itinerary for ID:", id);
  
  if (db) {
    try {
      const docRef = doc(db, "itineraries", id);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        console.log("Document found in Firebase");
        return docSnap.data() as ItineraryResult;
      } else {
        console.log("No such document in Firebase!");
      }
    } catch (e) {
      console.error("Error getting document from Firebase:", e);
    }
  } else {
    console.warn("Database not initialized, skipping Firebase check.");
  }
  
  // Try local storage fallback
  console.log("Checking LocalStorage fallback...");
  const localData = localStorage.getItem(`itinerary_${id}`);
  if (localData) {
    console.log("Found in LocalStorage");
    return JSON.parse(localData) as ItineraryResult;
  }
  
  return null;
};