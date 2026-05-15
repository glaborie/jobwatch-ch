import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { GoogleGenAI } from "@google/genai";
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const legacyDb = getFirestore(app); 
export const namedDb = db;
export const auth = getAuth(app);

// Initialize Gemini AI Client
const geminiKey = (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || (import.meta as any).env?.VITE_GEMINI_API_KEY || "";
export const ai = new GoogleGenAI({ apiKey: geminiKey });
