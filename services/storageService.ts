import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import { ItineraryResult } from "../types";

// Helper to safely get env vars using ONLY standard Vite import.meta.env
// This prevents "ReferenceError: process is not defined" in browsers
const getEnv = (viteKey: string) => {
  if (import.meta.env && import.meta.env[viteKey]) {
    return import.meta.env[viteKey];
  }
  return "";
};

// ==========================================
// CONFIGURATION STEP:
// Netlify 部署時，請在 Netlify 後台 Environment Variables 設定這些變數
// 變數名稱必須以 VITE_ 開頭
// ==========================================
const firebaseConfig = {
  apiKey: getEnv("VITE_FIREBASE_API_KEY"),
  authDomain: getEnv("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: getEnv("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: getEnv("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: getEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: getEnv("VITE_FIREBASE_APP_ID"),
  measurementId: getEnv("VITE_FIREBASE_MEASUREMENT_ID"),
  databaseURL: getEnv("VITE_FIREBASE_DATABASE_URL")
};

let db: any = null;

// Initialize Firebase
try {
  // Check if config has values
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
      alert("儲存至雲端失敗，可能是 Firebase 設定錯誤或權限問題。將使用本地儲存代替。");
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