import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { GoogleGenAI } from "@google/genai";
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const legacyDb = getFirestore(app, "(default)");
export const auth = getAuth(app);

// Initialize Gemini AI Client
export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
