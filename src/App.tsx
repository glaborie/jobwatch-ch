import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Database, 
  RefreshCw, 
  ExternalLink, 
  MapPin, 
  Building2, 
  Calendar,
  LogOut,
  LogIn,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Trash2,
  Send,
  Inbox,
  Filter,
  ChevronDown,
  ChevronUp,
  Download,
  Sparkles,
  Sun,
  Moon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User
} from 'firebase/auth';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp,
  Timestamp,
  where,
  getDocs,
  updateDoc,
  doc,
  limit,
  getDoc,
  setDoc,
  deleteDoc
} from 'firebase/firestore';
import { auth, db, ai, legacyDb } from './firebase';

type JobStatus = 'new' | 'discarded' | 'applied';

interface Job {
  id?: string;
  title: string;
  company: string;
  location: string;
  url: string;
  source: string;
  description?: string;
  summary?: string;
  scrapedAt: Timestamp | string;
  publishedAt?: Timestamp | string;
  query: string;
  status: JobStatus;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Quota exceeded") || message.includes("quota metric");
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const message = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: message,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  
  const jsonError = JSON.stringify(errInfo);
  console.error('Firestore Error: ', jsonError);
  
  // Create a proper error object with the JSON message as required
  const newError = new Error(jsonError);
  throw newError;
}

function normalizeUrl(url: string): string {
  if (!url) return "";
  try {
    if (!url.startsWith('http')) return url;
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    let hostname = u.hostname.toLowerCase();
    if (hostname.includes('linkedin.com')) {
      hostname = 'www.linkedin.com';
    }
    u.hostname = hostname;
    let pathname = u.pathname;
    if (pathname.endsWith('/') && pathname.length > 1) {
      pathname = pathname.slice(0, -1);
    }
    u.pathname = pathname;
    return u.toString();
  } catch (e) {
    return url.split('?')[0].split('#')[0].replace(/\/$/, "");
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isScraping, setIsScraping] = useState(false);
  
  // Persistence logic
  const [searchQueries, setSearchQueries] = useState<string[]>(() => {
    const saved = localStorage.getItem('searchQueries');
    return saved ? JSON.parse(saved) : ["AI Engineer", "AI Architect"];
  });
  const [newQuery, setNewQuery] = useState("");
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info', message: string } | null>(null);
  const [activeFilter, setActiveFilter] = useState<JobStatus | 'all'>('new');
  const [pageSize, setPageSize] = useState(10);
  const [hasMore, setHasMore] = useState(true);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<string[]>(() => {
    const saved = localStorage.getItem('selectedSources');
    return saved ? JSON.parse(saved) : ["jobs.ch", "ictjobs.ch", "LinkedIn", "jobup.ch", "Indeed", "SwissDevJobs"];
  });
  const [excludedKeywords, setExcludedKeywords] = useState<string[]>(() => {
    const saved = localStorage.getItem('excludedKeywords');
    return saved ? JSON.parse(saved) : ["SAP", "Junior"];
  });
  const [newExcludedKeyword, setNewExcludedKeyword] = useState("");
  const [ignoredLocations, setIgnoredLocations] = useState<string[]>(() => {
    const saved = localStorage.getItem('ignoredLocations');
    return saved ? JSON.parse(saved) : [];
  });
  const [summarizingIds, setSummarizingIds] = useState<Set<string>>(new Set());
  const [isDeduping, setIsDeduping] = useState(false);
  const [pendingDuplicates, setPendingDuplicates] = useState<{ids: string[], groupCount: number} | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [legacyJobsCount, setLegacyJobsCount] = useState(0);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState<'pending' | 'checking' | 'done'>(() => {
    try {
      const saved = localStorage.getItem(`migration_status_${auth.currentUser?.uid || 'anon'}`);
      return (saved as any) || 'pending';
    } catch (e) {
      return 'pending';
    }
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('theme');
      return (saved as 'light' | 'dark') || 'light';
    } catch (e) {
      return 'light';
    }
  });

  // Apply theme to document
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('theme', theme);
    } catch (e) {}
  }, [theme]);

  // Load settings from Firestore
  useEffect(() => {
    if (!user) {
      setSettingsLoaded(false);
      return;
    }

    const loadSettings = async () => {
      const settingsPath = `users/${user.uid}/settings/preferences`;
      try {
        const settingsRef = doc(db, 'users', user.uid, 'settings', 'preferences');
        const settingsSnap = await getDoc(settingsRef);
        
        if (settingsSnap.exists()) {
          const data = settingsSnap.data();
          if (data.ignoredLocations) setIgnoredLocations(data.ignoredLocations);
          if (data.searchQueries) setSearchQueries(data.searchQueries);
          if (data.selectedSources) setSelectedSources(data.selectedSources);
          if (data.excludedKeywords) setExcludedKeywords(data.excludedKeywords);
          if (data.theme) setTheme(data.theme);
        }
        setSettingsLoaded(true);
      } catch (err) {
        if (isQuotaError(err)) {
          setIsQuotaExceeded(true);
          setStatus({ 
            type: 'error', 
            message: "Daily Firestore quota exceeded. Limit will reset tomorrow (Pacific Time). Some settings may not load." 
          });
        } else {
          try {
            handleFirestoreError(err, OperationType.GET, settingsPath);
          } catch (e) {
            console.error("Settings load failed", e);
          }
        }
      }
    };

    loadSettings();
  }, [user]);

  const migrateLegacyJobs = async () => {
    if (!user || isMigrating) return;
    setIsMigrating(true);
    setStatus({ type: 'info', message: "Migrating legacy jobs..." });

    try {
      const userJobsRef = collection(db, "users", user.uid, "jobs");
      let migratedCount = 0;

      // Optimization: Fetch all existing job URLs for this user in one go to avoid sub-queries
      const existingJobsSnap = await getDocs(query(userJobsRef, limit(1000)));
      const existingUrls = new Set(existingJobsSnap.docs.map(d => d.data().url));

      // Helper to process a snapshot
      const processSnap = async (snap: any, sourceDb: any, label: string) => {
        console.log(`[Migration] Processing ${snap.size} docs from ${label}...`);
        for (const legacyDoc of snap.docs) {
          const data = legacyDoc.data();
          
          if (!existingUrls.has(data.url)) {
            const normalizedData = { 
              title: data.title || "Untitled Job",
              company: data.company || "Unknown Company",
              url: data.url || "",
              source: data.source || "Legacy",
              status: data.status || "new",
              ...data 
            };
            
            // Normalize scrapedAt
            if (typeof data.scrapedAt === 'string') {
              normalizedData.scrapedAt = new Date(data.scrapedAt);
            } else if (!data.scrapedAt) {
              normalizedData.scrapedAt = serverTimestamp();
            }

            // Normalize publishedAt
            if (typeof data.publishedAt === 'string') {
              normalizedData.publishedAt = new Date(data.publishedAt);
            }
            
            await addDoc(userJobsRef, normalizedData);
            migratedCount++;
            existingUrls.add(data.url); // Add to local set to prevent dupes within the same run
          }
          
          // Cleanup
          try {
            await deleteDoc(doc(sourceDb, "jobs", legacyDoc.id));
          } catch (e) {
            console.warn(`[Migration] Could not delete legacy doc ${legacyDoc.id} from ${label}:`, e);
          }
        }
      };

      // Migrate from default db
      let snapLegacy;
      try {
        console.log("[Migration] Attempting to fetch from legacyDb (default)...");
        snapLegacy = await getDocs(query(collection(legacyDb, "jobs")));
        await processSnap(snapLegacy, legacyDb, "legacy (default)");
      } catch (err: any) {
        console.error("[Migration] Error reading legacyDb:", err);
        // If it's a permission error on legacyDb, we might still want to try the current DB top-level
        if (!err.message?.includes("permission")) {
          throw err;
        }
      }

      // Migrate from current db top-level
      let snapCurrent;
      try {
        console.log("[Migration] Attempting to fetch from current db top-level...");
        snapCurrent = await getDocs(query(collection(db, "jobs")));
        await processSnap(snapCurrent, db, "current (top-level)");
      } catch (err: any) {
        console.error("[Migration] Error reading current db top-level:", err);
        throw err;
      }

      setLegacyJobsCount(0);
      setMigrationStatus('done');
      localStorage.setItem(`migration_status_${user.uid}`, 'done');
      setStatus({ type: 'success', message: `Successfully migrated ${migratedCount} legacy jobs.` });
    } catch (err: any) {
      if (isQuotaError(err)) {
        setIsQuotaExceeded(true);
        setStatus({ type: 'error', message: "Migration failed due to Firestore quota. Limit resets tomorrow." });
      } else {
        console.error("Migration error:", err);
        setStatus({ 
          type: 'error', 
          message: `Migration failed: ${err.message || "Unknown error"}. Check console for details.` 
        });
      }
    } finally {
      setIsMigrating(false);
    }
  };

  // Check for legacy jobs
  useEffect(() => {
    if (!user || migrationStatus === 'done') return;

    const checkLegacy = async () => {
      if (!user) return;
      if (migrationStatus === 'checking') return;
      
      setMigrationStatus('checking');
      console.log(`[Migration] Checking for legacy jobs for ${user.email}...`);
      try {
        // Check legacyDb (default)
        const qLegacy = query(collection(legacyDb, "jobs"), limit(50));
        const snapLegacy = await getDocs(qLegacy);
        console.log(`[Migration] Found ${snapLegacy.size} jobs in legacyDb (default)`);
        
        // Check current db top-level
        const qCurrent = query(collection(db, "jobs"), limit(50));
        const snapCurrent = await getDocs(qCurrent);
        console.log(`[Migration] Found ${snapCurrent.size} jobs in current db (top-level)`);

        const total = snapLegacy.size + snapCurrent.size;
        setLegacyJobsCount(total);
        
        if (total === 0) {
          setMigrationStatus('done');
          localStorage.setItem(`migration_status_${user.uid}`, 'done');
        } else {
          setMigrationStatus('pending'); // Still something to migrate
        }

        // Auto-trigger for specific user if needed or requested
        if (total > 0 && user.email === 'glaborie@gmail.com') {
          console.log("[Migration] Auto-triggering migration for glaborie@gmail.com...");
          migrateLegacyJobs();
        }
      } catch (err) {
        if (isQuotaError(err)) {
          setIsQuotaExceeded(true);
        }
        setMigrationStatus('pending'); // Retry later
        console.warn("[Migration] Error checking legacy jobs:", err);
      }
    };

    checkLegacy();
  }, [user, migrationStatus]);

  // Sync settings to Firestore
  useEffect(() => {
    if (!user || !settingsLoaded) return;

    const syncSettings = async () => {
      const settingsPath = `users/${user.uid}/settings/preferences`;
      try {
        const settingsRef = doc(db, 'users', user.uid, 'settings', 'preferences');
        await setDoc(settingsRef, {
          ignoredLocations,
          searchQueries,
          selectedSources,
          excludedKeywords,
          theme
        }, { merge: true });
      } catch (err) {
        if (isQuotaError(err)) {
          setIsQuotaExceeded(true);
        } else {
          try {
            handleFirestoreError(err, OperationType.WRITE, settingsPath);
          } catch (e) {
            console.error("Settings sync failed", e);
          }
        }
      }
    };

    const timeoutId = setTimeout(syncSettings, 1000);
    return () => clearTimeout(timeoutId);
  }, [user, settingsLoaded, ignoredLocations, searchQueries, selectedSources, excludedKeywords, theme]);

  // Save to localStorage whenever state changes
  useEffect(() => {
    localStorage.setItem('searchQueries', JSON.stringify(searchQueries));
  }, [searchQueries]);

  useEffect(() => {
    localStorage.setItem('selectedSources', JSON.stringify(selectedSources));
  }, [selectedSources]);

  useEffect(() => {
    localStorage.setItem('excludedKeywords', JSON.stringify(excludedKeywords));
  }, [excludedKeywords]);

  useEffect(() => {
    localStorage.setItem('ignoredLocations', JSON.stringify(ignoredLocations));
  }, [ignoredLocations]);

  const allAvailableSources = [
    { id: "jobs.ch", label: "Jobs.ch" },
    { id: "ictjobs.ch", label: "ICTJobs.ch" },
    { id: "LinkedIn", label: "LinkedIn" },
    { id: "jobup.ch", label: "Jobup.ch" },
    { id: "Indeed", label: "Indeed" },
    { id: "SwissDevJobs", label: "SwissDevJobs" },
  ];

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setJobs([]);
      return;
    }

    const jobsPath = `users/${user.uid}/jobs`;
    
    // Fetch all jobs for this user (up to 2000 to keep it manageable but comprehensive)
    // Client-side filtering will handle status to save reads when switching filters
    const q = query(
      collection(db, "users", user.uid, "jobs"), 
      orderBy("scrapedAt", "desc"),
      limit(2000)
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const jobsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Job[];
      setJobs(jobsData);
      setHasMore(false); // We fetch everything up to 2000 now
    }, (error) => {
      if (isQuotaError(error)) {
        setIsQuotaExceeded(true);
        setStatus({ 
          type: 'error', 
          message: "Daily Firestore quota exceeded. View sync paused. Limit resets tomorrow." 
        });
      } else {
        try {
          handleFirestoreError(error, OperationType.LIST, jobsPath);
        } catch (e) {
          console.error("Job list sync failed", e);
        }
      }
    });

    return () => unsubscribe();
  }, [user]);

  // Reset pagination when filter changes
  useEffect(() => {
    setPageSize(10);
  }, [activeFilter]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login error:", error);
      setStatus({ type: 'error', message: "Login failed." });
    }
  };

  const handleLogout = () => signOut(auth);

  const handleScrape = async () => {
    if (!user) return;
    setIsScraping(true);
    setStatus({ type: 'info', message: "Scraping in progress..." });

    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          queries: searchQueries,
          sources: selectedSources
        })
      });

      const contentType = response.headers.get('content-type');
      let data: any;

      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        console.error("Non-JSON response from server:", text.substring(0, 500));
        throw new Error(`Server returned non-JSON response (${response.status}). The server might be restarting or experiencing an error.`);
      }

      if (!response.ok) {
        const errorMsg = data.details || data.error || `Server returned ${response.status}`;
        throw new Error(errorMsg);
      }

      if (data.error) throw new Error(data.error);

      const scrapedJobs = data.jobs;
      let addedCount = 0;
      let errorCount = 0;

      // Add to Firestore
      const jobsColRef = collection(db, "users", user.uid, "jobs");
      
      // Optimization: Reuse the existing jobs list to avoid unnecessary reads
      const existingUrls = new Set(jobs.map(j => normalizeUrl(j.url)));
      
      // If our memory list is small, fetch a bit more just in case
      if (jobs.length < 500) {
        const extraSnap = await getDocs(query(jobsColRef, limit(1000)));
        extraSnap.docs.forEach(d => existingUrls.add(normalizeUrl(d.data().url)));
      }

      for (const job of scrapedJobs) {
        const normalizedUrl = normalizeUrl(job.url);
        if (!existingUrls.has(normalizedUrl)) {
            try {
              const jobData = {
                ...job,
                url: normalizedUrl,
                publishedAt: (job.publishedAt && !isNaN(new Date(job.publishedAt).getTime())) ? new Date(job.publishedAt) : null,
                scrapedAt: serverTimestamp()
              };
              await addDoc(jobsColRef, jobData);
              addedCount++;
              existingUrls.add(normalizedUrl);
            } catch (err: any) {
              errorCount++;
              if (isQuotaError(err)) {
                setIsQuotaExceeded(true);
                setStatus({ type: 'error', message: "Firestore quota exceeded. Some scraped jobs were not saved." });
                break;
              }
              // Log more details for debugging
              console.error(`[Firestore Create Error] ${err.code || 'unknown'}: ${err.message}`, {
                jobUrl: job.url,
                jobSource: job.source
              });
            }
        }
      }

      if (errorCount > 0) {
        setStatus({ 
          type: 'info', 
          message: `Scraping complete! Found ${scrapedJobs.length} jobs, added ${addedCount} new ones. (${errorCount} errors saving to DB)` 
        });
      } else {
        setStatus({ 
          type: 'success', 
          message: `Scraping complete! Found ${scrapedJobs.length} jobs, added ${addedCount} new ones.` 
        });
      }
    } catch (error: any) {
      console.error("Scrape error:", error);
      const msg = error instanceof Error ? error.message : "Scraping failed.";
      setStatus({ type: 'error', message: `Scraping failed: ${msg}` });
    } finally {
      setIsScraping(false);
    }
  };

  const updateJobStatus = async (jobId: string, newStatus: JobStatus) => {
    if (!user) return;
    const jobPath = `users/${user.uid}/jobs/${jobId}`;
    try {
      const jobRef = doc(db, "users", user.uid, "jobs", jobId);
      await updateDoc(jobRef, { status: newStatus });
    } catch (error) {
      if (isQuotaError(error)) {
        setIsQuotaExceeded(true);
        setStatus({ type: 'error', message: "Firestore quota exceeded. Status update failed." });
      } else {
        try {
          handleFirestoreError(error, OperationType.UPDATE, jobPath);
        } catch (e) {
          console.error("Job status update failed", e);
        }
      }
    }
  };

  const generateSummary = async (job: Job) => {
    if (!user || !job.id || job.summary || summarizingIds.has(job.id)) return;
    const jobPath = `users/${user.uid}/jobs/${job.id}`;
    
    setSummarizingIds(prev => new Set(prev).add(job.id!));
    
    try {
      const prompt = `Summarize this job description in 2-3 short bullet points highlighting key requirements and benefits:
      
      Job Title: ${job.title}
      Company: ${job.company}
      Description: ${job.description || "No description provided."}`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      const summary = response.text || "Summary generation failed.";
      
      const jobRef = doc(db, "users", user.uid, "jobs", job.id);
      await updateDoc(jobRef, { summary });
    } catch (error) {
      if (isQuotaError(error)) {
        setIsQuotaExceeded(true);
        setStatus({ type: 'error', message: "Firestore quota exceeded. Could not save summary." });
      } else {
        console.error("Gemini summary error:", error);
        setStatus({ type: 'error', message: "Failed to generate job summary." });
      }
    } finally {
      setSummarizingIds(prev => {
        const next = new Set(prev);
        next.delete(job.id!);
        return next;
      });
    }
  };

  const addQuery = (e: React.FormEvent) => {
    e.preventDefault();
    if (newQuery && !searchQueries.includes(newQuery)) {
      setSearchQueries([...searchQueries, newQuery]);
      setNewQuery("");
    }
  };

  const removeQuery = (q: string) => {
    setSearchQueries(searchQueries.filter(item => item !== q));
  };

  const toggleSource = (sourceId: string) => {
    setSelectedSources(prev => 
      prev.includes(sourceId) 
        ? prev.filter(s => s !== sourceId)
        : [...prev, sourceId]
    );
  };

  const addExcludedKeyword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newExcludedKeyword && !excludedKeywords.includes(newExcludedKeyword)) {
      setExcludedKeywords([...excludedKeywords, newExcludedKeyword]);
      setNewExcludedKeyword("");
    }
  };

  const removeExcludedKeyword = (kw: string) => {
    setExcludedKeywords(excludedKeywords.filter(item => item !== kw));
  };

  const toggleLocationIgnore = (location: string) => {
    const loc = location || "Switzerland";
    setIgnoredLocations(prev => 
      prev.includes(loc) 
        ? prev.filter(l => l !== loc)
        : [...prev, loc]
    );
  };

  const handleDedup = async () => {
    if (!user || jobs.length === 0 || isDeduping) return;
    setIsDeduping(true);
    setStatus({ type: 'info', message: "Scanning for duplicates..." });
    
    try {
      const urlGroups: Record<string, Job[]> = {};
      
      jobs.forEach(job => {
        const normalized = normalizeUrl(job.url);
        if (!urlGroups[normalized]) urlGroups[normalized] = [];
        urlGroups[normalized].push(job);
      });
      
      const duplicatesToDelete: string[] = [];
      let groupCount = 0;
      
      Object.entries(urlGroups).forEach(([, group]) => {
        if (group.length > 1) {
          groupCount++;
          // Sort by scrapedAt ascending (oldest first)
          group.sort((a, b) => {
            const timeA = (a.scrapedAt as any)?.seconds ?? new Date(a.scrapedAt as any).getTime();
            const timeB = (b.scrapedAt as any)?.seconds ?? new Date(b.scrapedAt as any).getTime();
            return timeA - timeB;
          });
          
          // Keep the oldest, delete the newer ones (as requested: "delete most recent entries")
          const toDelete = group.slice(1).map(j => j.id).filter((id): id is string => !!id);
          duplicatesToDelete.push(...toDelete);
        }
      });
      
      if (duplicatesToDelete.length === 0) {
        setStatus({ type: 'success', message: "No duplicates found! Your database is clean." });
        setIsDeduping(false);
        return;
      }
      
      setPendingDuplicates({ ids: duplicatesToDelete, groupCount });
      setStatus(null);
      setIsDeduping(false);
    } catch (err: any) {
      console.error("Dedup scan error:", err);
      setStatus({ type: 'error', message: `Scan failed: ${err.message}` });
      setIsDeduping(false);
    }
  };

  const executeDedup = async () => {
    if (!user || !pendingDuplicates || isDeduping) return;
    
    setIsDeduping(true);
    const { ids } = pendingDuplicates;
    setStatus({ type: 'info', message: `Archiving ${ids.length} duplicates...` });
    
    try {
      let deletedCount = 0;
      for (const id of ids) {
        try {
          await deleteDoc(doc(db, "users", user.uid, "jobs", id));
          deletedCount++;
          if (deletedCount % 10 === 0) {
             setStatus({ type: 'info', message: `Cleaned ${deletedCount}/${ids.length} duplicates...` });
          }
        } catch (err) {
          console.error(`Failed to delete duplicate ${id}:`, err);
        }
      }
      
      setStatus({ type: 'success', message: `Successfully removed ${deletedCount} duplicate entries.` });
    } catch (err: any) {
      console.error("Dedup execution error:", err);
      setStatus({ type: 'error', message: `Dedup failed: ${err.message}` });
    } finally {
      setIsDeduping(false);
      setPendingDuplicates(null);
    }
  };

  const handleExport = () => {
    const exportData = filteredJobs.map(job => ({
      title: job.title,
      url: job.url,
      location: job.location || "Switzerland"
    }));
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `swiss-ai-jobs-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    setStatus({ type: 'success', message: `Exported ${exportData.length} jobs to JSON.` });
  };

  const filteredJobs = jobs.filter(job => {
    // Status filter (now handled client-side to save reads)
    if (activeFilter !== 'all' && job.status !== activeFilter) return false;

    // Keyword filter
    const searchStr = `${job.title} ${job.company} ${job.description || ''}`.toLowerCase();
    const hasExcludedKeyword = excludedKeywords.some(kw => searchStr.includes(kw.toLowerCase()));
    
    // Location filter
    const jobLocation = job.location || "Switzerland";
    const isIgnoredLocation = ignoredLocations.includes(jobLocation);

    return !hasExcludedKeyword && !isIgnoredLocation;
  });

  const displayJobs = filteredJobs.slice(0, pageSize);
  const canLoadMore = filteredJobs.length > pageSize;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center transition-colors">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 dark:text-blue-400" />
      </div>
    );
  }

  const filterOptions: { label: string, value: JobStatus | 'all', icon: any }[] = [
    { label: 'New', value: 'new', icon: Inbox },
    { label: 'Applied', value: 'applied', icon: Send },
    { label: 'Discarded', value: 'discarded', icon: Trash2 },
    { label: 'All', value: 'all', icon: Filter },
  ];

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'dark' : ''} bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-300`}>
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-40 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 dark:bg-blue-500 p-2 rounded-lg">
              <Database className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight dark:text-white">JobWatch-CH</h1>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all"
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>

            {user ? (
              <div className="flex items-center gap-4">
                <div className="hidden sm:block text-right">
                  <p className="text-sm font-medium dark:text-slate-200">{user.displayName}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
                </div>
                <button 
                  onClick={handleLogout}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-600 dark:text-slate-400"
                  title="Logout"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-medium transition-all shadow-sm"
              >
                <LogIn className="w-4 h-4" />
                Sign In with Google
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!user ? (
          <div className="text-center py-20 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
            <div className="max-w-md mx-auto">
              <div className="bg-blue-50 dark:bg-blue-900/30 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                <Search className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              </div>
              <h2 className="text-2xl font-bold mb-2 dark:text-white">Welcome to Swiss AI Jobs</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-8">
                Sign in to start scraping and tracking AI job opportunities across Switzerland.
              </p>
              <button 
                onClick={handleLogin}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-semibold transition-all shadow-md"
              >
                <LogIn className="w-5 h-5" />
                Get Started
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Sidebar: Controls */}
            <div className="lg:col-span-1 space-y-6">
              <section className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 dark:text-white">
                  <Search className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  Search Queries
                </h3>
                
                <form onSubmit={addQuery} className="flex gap-2 mb-4">
                  <input 
                    type="text" 
                    value={newQuery}
                    onChange={(e) => setNewQuery(e.target.value)}
                    placeholder="e.g. Data Scientist"
                    className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all dark:text-slate-100"
                  />
                  <button 
                    type="submit"
                    className="bg-slate-900 dark:bg-slate-700 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-600 transition-colors"
                  >
                    Add
                  </button>
                </form>

                <div className="flex flex-wrap gap-2 mb-6">
                  {searchQueries.map(q => (
                    <span 
                      key={q} 
                      className="inline-flex items-center gap-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-3 py-1 rounded-full text-xs font-medium border border-blue-100 dark:border-blue-800"
                    >
                      {q}
                      <button onClick={() => removeQuery(q)} className="hover:text-blue-900 dark:hover:text-blue-100">
                        &times;
                      </button>
                    </span>
                  ))}
                </div>

                <button 
                  onClick={handleScrape}
                  disabled={isScraping || searchQueries.length === 0}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white px-6 py-3 rounded-xl font-semibold transition-all shadow-md"
                >
                  {isScraping ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-5 h-5" />
                  )}
                  {isScraping ? "Searching..." : "Start Search"}
                </button>
              </section>

              {/* Status Messages */}
              <AnimatePresence>
                {status && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={`p-4 rounded-xl border flex gap-3 transition-colors ${
                      status.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800 text-emerald-800 dark:text-emerald-400' :
                      status.type === 'error' ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-100 dark:border-rose-800 text-rose-800 dark:text-rose-400' :
                      'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800 text-blue-800 dark:text-blue-400'
                    }`}
                  >
                    {status.type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> :
                     status.type === 'error' ? <AlertCircle className="w-5 h-5 shrink-0" /> :
                     <Loader2 className="w-5 h-5 shrink-0 animate-spin" />}
                    <p className="text-sm font-medium">{status.message}</p>
                    <button 
                      onClick={() => setStatus(null)}
                      className="ml-auto text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      &times;
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Job Sources Toggles */}
              <section className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 dark:text-white">
                  <Database className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  Job Sources
                </h3>
                <div className="space-y-2">
                  {allAvailableSources.map((source) => (
                    <label 
                      key={source.id}
                      className="flex items-center justify-between p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
                    >
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{source.label}</span>
                      <div className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          className="sr-only peer"
                          checked={selectedSources.includes(source.id)}
                          onChange={() => toggleSource(source.id)}
                        />
                        <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </div>
                    </label>
                  ))}
                  
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 mt-2">
                    {pendingDuplicates ? (
                      <div className="bg-blue-50 dark:bg-blue-900/10 p-3 rounded-lg border border-blue-100 dark:border-blue-900/30">
                        <p className="text-[10px] text-blue-700 dark:text-blue-300 font-medium mb-2 leading-relaxed">
                          Found {pendingDuplicates.ids.length} duplicates in {pendingDuplicates.groupCount} job groups. 
                          Delete most recent entries and keep the oldest?
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={executeDedup}
                            disabled={isDeduping}
                            className="flex-1 text-[10px] font-bold bg-blue-600 text-white py-1.5 rounded-md hover:bg-blue-700 transition-colors"
                          >
                            {isDeduping ? "Processing..." : "Confirm & Delete"}
                          </button>
                          <button
                            onClick={() => setPendingDuplicates(null)}
                            disabled={isDeduping}
                            className="flex-1 text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 py-1.5 rounded-md hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={handleDedup}
                        disabled={isDeduping || jobs.length === 0}
                        className="w-full flex items-center justify-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 p-2 rounded-lg transition-all border border-transparent hover:border-blue-100 dark:hover:border-blue-900"
                      >
                        {isDeduping ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        Cleanup Duplicates
                      </button>
                    )}
                  </div>
                </div>
              </section>

              {/* Excluded Keywords */}
              <section className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-rose-600 dark:text-rose-400">
                  <AlertCircle className="w-5 h-5" />
                  Exclude Keywords
                </h3>
                
                <form onSubmit={addExcludedKeyword} className="flex gap-2 mb-4">
                  <input 
                    type="text" 
                    value={newExcludedKeyword}
                    onChange={(e) => setNewExcludedKeyword(e.target.value)}
                    placeholder="e.g. SAP, Junior"
                    className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 transition-all dark:text-slate-100"
                  />
                  <button 
                    type="submit"
                    className="bg-rose-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-rose-700 transition-colors"
                  >
                    Add
                  </button>
                </form>

                <div className="flex flex-wrap gap-2">
                  {excludedKeywords.map(kw => (
                    <span 
                      key={kw} 
                      className="inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 px-3 py-1 rounded-full text-xs font-medium border border-rose-100 dark:border-rose-800"
                    >
                      {kw}
                      <button onClick={() => removeExcludedKeyword(kw)} className="hover:text-rose-900 dark:hover:text-rose-100">
                        &times;
                      </button>
                    </span>
                  ))}
                  {excludedKeywords.length === 0 && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 italic">No keywords excluded.</p>
                  )}
                </div>
              </section>

              {/* Ignored Locations */}
              <section className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-600 dark:text-slate-400">
                  <MapPin className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  Ignored Locations
                </h3>
                <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                  {ignoredLocations.map(loc => (
                    <span 
                      key={loc} 
                      className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-3 py-1 rounded-full text-xs font-medium border border-slate-200 dark:border-slate-700"
                    >
                      {loc}
                      <button onClick={() => toggleLocationIgnore(loc)} className="hover:text-slate-900 dark:hover:text-white">
                        &times;
                      </button>
                    </span>
                  ))}
                  {ignoredLocations.length === 0 && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 italic">No locations ignored.</p>
                  )}
                </div>
              </section>

              {/* Status Filter */}
              <section className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 dark:text-white">
                  <Filter className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  Filter by Status
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {filterOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setActiveFilter(opt.value)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        activeFilter === opt.value 
                          ? 'bg-blue-600 text-white shadow-md shadow-blue-200 dark:shadow-none' 
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      <opt.icon className="w-4 h-4" />
                      {opt.label}
                    </button>
                  ))}
                </div>
              </section>
            </div>

            {/* Main Content: Job List */}
            <div className="lg:col-span-2 space-y-4">
              <AnimatePresence>
                {isQuotaExceeded && (
                  <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6 mb-6"
                  >
                    <div className="flex items-start gap-4">
                      <div className="bg-red-100 dark:bg-red-800 p-2 rounded-full">
                        <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-lg font-bold text-red-900 dark:text-red-300 mb-1">
                          Firestore Quota Exceeded
                        </h4>
                        <p className="text-red-700 dark:text-red-400 text-sm mb-4">
                          You've reached the daily free tier limit for database operations. Your data is safe, but you won't be able to save changes or load new jobs until the limit resets.
                        </p>
                        <div className="flex items-center gap-4">
                          <a 
                            href="https://firebase.google.com/pricing#cloud-firestore" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-red-600 dark:text-red-400 text-sm font-bold flex items-center gap-1 hover:underline"
                          >
                            View Quota Details <ExternalLink className="w-3 h-3" />
                          </a>
                          <span className="text-red-400 dark:text-red-600 px-2 py-1 bg-red-100 dark:bg-red-950 rounded text-xs font-mono">
                            Resets Daily ~00:00 Pacific Time
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {legacyJobsCount > 0 && user && !isQuotaExceeded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 mb-6"
                  >
                    <div className="flex items-start gap-4">
                      <div className="bg-amber-100 dark:bg-amber-800 p-2 rounded-full">
                        <Database className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-lg font-bold text-amber-900 dark:text-amber-300 mb-1">
                          Legacy Data Detected
                        </h4>
                        <p className="text-amber-700 dark:text-amber-400 text-sm mb-4">
                          We found {legacyJobsCount}+ jobs in the old database structure. Migrating them will move them to your private space so you don't lose your tracking history.
                        </p>
                        <button
                          onClick={migrateLegacyJobs}
                          disabled={isMigrating}
                          className="bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white px-6 py-2 rounded-xl font-bold transition-all shadow-sm flex items-center gap-2"
                        >
                          {isMigrating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                          Migrate Data Now
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

                <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-4">
                  <h3 className="text-lg font-bold dark:text-white">
                    {activeFilter === 'all' ? 'All Jobs' : `${activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1)} Jobs`} ({filteredJobs.length})
                  </h3>
                  {filteredJobs.length > 0 && (
                    <button
                      onClick={handleExport}
                      className="flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 px-3 py-1.5 rounded-lg transition-all border border-blue-100 dark:border-blue-900/50"
                      title="Export displayed jobs to JSON"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export JSON
                    </button>
                  )}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Last updated: {jobs.length > 0 ? new Date((jobs[0].scrapedAt as any)?.seconds * 1000).toLocaleString() : 'Never'}
                </div>
              </div>

              <div className="space-y-4">
                {displayJobs.length === 0 ? (
                  <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 transition-colors">
                    <p className="text-slate-500 dark:text-slate-400">No jobs found matching your criteria.</p>
                  </div>
                ) : (
                  displayJobs.map((job, idx) => (
                      <motion.div 
                        key={job.id || idx}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className={`bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md dark:shadow-slate-950/50 transition-all group ${
                          expandedJobId === job.id ? 'ring-2 ring-blue-500 ring-opacity-50' : ''
                        }`}
                      >
                      <div 
                        className="p-5 cursor-pointer"
                        onClick={() => setExpandedJobId(expandedJobId === job.id ? null : (job.id || null))}
                      >
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-bold text-lg group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors leading-tight dark:text-slate-100">
                                {job.title}
                              </h4>
                              {job.summary && (
                                <div className="group/summary relative">
                                  <Sparkles className="w-4 h-4 text-amber-500 fill-amber-50 dark:fill-amber-900/30 cursor-help" />
                                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-72 p-3.5 bg-slate-900 dark:bg-slate-800 text-white text-xs rounded-xl shadow-2xl opacity-0 invisible group-hover/summary:opacity-100 group-hover/summary:visible transition-all z-[100] pointer-events-none border border-white/10 dark:border-slate-700">
                                    <div className="font-bold flex items-center gap-1.5 mb-1.5 text-amber-400 border-b border-white/10 dark:border-slate-700 pb-1">
                                      <Sparkles className="w-3 h-3" />
                                      AI Insights
                                    </div>
                                    <div className="leading-relaxed whitespace-pre-wrap italic opacity-90">
                                      {job.summary}
                                    </div>
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900 dark:border-t-slate-800"></div>
                                  </div>
                                </div>
                              )}
                              {!job.summary && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    generateSummary(job);
                                  }}
                                  disabled={summarizingIds.has(job.id!)}
                                  className={`p-1 rounded hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors ${summarizingIds.has(job.id!) ? 'animate-pulse' : ''}`}
                                  title="Generate AI Summary"
                                >
                                  <Sparkles className={`w-4 h-4 ${summarizingIds.has(job.id!) ? 'text-amber-400' : 'text-slate-300 dark:text-slate-600 hover:text-amber-500 dark:hover:text-amber-400'}`} />
                                </button>
                              )}
                              {job.status === 'applied' && (
                                <span className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                  Applied
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-y-2 gap-x-4 mt-2 text-sm text-slate-600 dark:text-slate-400">
                              <div className="flex items-center gap-1.5">
                                <Building2 className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                                {job.company}
                              </div>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleLocationIgnore(job.location);
                                }}
                                className="flex items-center gap-1.5 hover:text-rose-600 dark:hover:text-rose-400 transition-colors group/loc"
                                title="Click to ignore this location"
                              >
                                <MapPin className="w-4 h-4 text-slate-400 dark:text-slate-500 group-hover/loc:text-rose-400" />
                                <span className="underline decoration-dotted decoration-slate-300 dark:decoration-slate-700 group-hover/loc:decoration-rose-300 dark:group-hover/loc:decoration-rose-500">
                                  {job.location || "Switzerland"}
                                </span>
                              </button>
                              <div className="flex items-center gap-1.5">
                                <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                                  {job.source}
                                </span>
                              </div>
                              {job.publishedAt && (
                                <div className="flex items-center gap-1.5" title="Published date">
                                  <Calendar className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                                  <span className="text-[10px] font-medium uppercase tracking-tight">
                                    {(() => {
                                      const d = (job.publishedAt as any)?.seconds ? new Date((job.publishedAt as any).seconds * 1000) : new Date(job.publishedAt as any);
                                      return isNaN(d.getTime()) ? 'Recently' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                                    })()}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-slate-400 dark:text-slate-600 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                              {expandedJobId === job.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                            </div>
                            <a 
                              href={job.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="p-2 bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg transition-all"
                              title="View Job"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="w-5 h-5" />
                            </a>
                          </div>
                        </div>

                        <AnimatePresence>
                          {expandedJobId === job.id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.3, ease: 'easeInOut' }}
                              className="overflow-hidden"
                            >
                              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                                <h5 className="text-sm font-bold text-slate-900 dark:text-slate-200 mb-2">Job Description</h5>
                                <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed">
                                  {job.description || "No detailed description available for this snippet. Click the external link to view full details."}
                                </p>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      
                      <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between rounded-b-2xl transition-colors">
                        <div className="flex gap-2">
                          {job.status !== 'applied' && (
                            <button
                              onClick={() => job.id && updateJobStatus(job.id, 'applied')}
                              className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 px-3 py-1.5 rounded-lg transition-all"
                            >
                              <Send className="w-3.5 h-3.5" />
                              Mark Applied
                            </button>
                          )}
                          {job.status !== 'discarded' && (
                            <button
                              onClick={() => job.id && updateJobStatus(job.id, 'discarded')}
                              className="flex items-center gap-1.5 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 px-3 py-1.5 rounded-lg transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Discard
                            </button>
                          )}
                          {job.status !== 'new' && (
                            <button
                              onClick={() => job.id && updateJobStatus(job.id, 'new')}
                              className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 px-3 py-1.5 rounded-lg transition-all"
                            >
                              <Inbox className="w-3.5 h-3.5" />
                              Move to New
                            </button>
                          )}
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-medium">
                            Query: {job.query}
                          </span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500">
                            Scraped {new Date((job.scrapedAt as any)?.seconds * 1000).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}

                {canLoadMore && (
                  <div className="pt-4 flex justify-center">
                    <button
                      onClick={() => setPageSize(prev => prev + 20)}
                      className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-6 py-2 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-all shadow-sm"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Show More Jobs ({filteredJobs.length - displayJobs.length} remaining)
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
