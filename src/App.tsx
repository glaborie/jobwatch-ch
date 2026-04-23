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
  Sparkles
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
  setDoc
} from 'firebase/firestore';
import { auth, db, ai } from './firebase';

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
  query: string;
  status: JobStatus;
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
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Load settings from Firestore
  useEffect(() => {
    if (!user) {
      setSettingsLoaded(false);
      return;
    }

    const loadSettings = async () => {
      try {
        const settingsRef = doc(db, 'users', user.uid, 'settings', 'preferences');
        const settingsSnap = await getDoc(settingsRef);
        
        if (settingsSnap.exists()) {
          const data = settingsSnap.data();
          if (data.ignoredLocations) setIgnoredLocations(data.ignoredLocations);
          if (data.searchQueries) setSearchQueries(data.searchQueries);
          if (data.selectedSources) setSelectedSources(data.selectedSources);
          if (data.excludedKeywords) setExcludedKeywords(data.excludedKeywords);
        }
        setSettingsLoaded(true);
      } catch (err) {
        console.error("Error loading settings:", err);
      }
    };

    loadSettings();
  }, [user]);

  // Sync settings to Firestore
  useEffect(() => {
    if (!user || !settingsLoaded) return;

    const syncSettings = async () => {
      try {
        const settingsRef = doc(db, 'users', user.uid, 'settings', 'preferences');
        await setDoc(settingsRef, {
          ignoredLocations,
          searchQueries,
          selectedSources,
          excludedKeywords
        }, { merge: true });
      } catch (err) {
        console.error("Error syncing settings:", err);
      }
    };

    const timeoutId = setTimeout(syncSettings, 1000);
    return () => clearTimeout(timeoutId);
  }, [user, settingsLoaded, ignoredLocations, searchQueries, selectedSources, excludedKeywords]);

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

    let q = query(
      collection(db, "jobs"), 
      orderBy("scrapedAt", "desc"),
      limit(pageSize)
    );
    
    if (activeFilter !== 'all') {
      q = query(
        collection(db, "jobs"), 
        where("status", "==", activeFilter), 
        orderBy("scrapedAt", "desc"),
        limit(pageSize)
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const jobsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Job[];
      setJobs(jobsData);
      setHasMore(snapshot.docs.length === pageSize);
    }, (error) => {
      console.error("Firestore error:", error);
      setStatus({ type: 'error', message: "Failed to load jobs. Check security rules." });
    });

    return () => unsubscribe();
  }, [user, activeFilter, pageSize]);

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

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      const scrapedJobs = data.jobs;
      let addedCount = 0;

      // Add to Firestore
      for (const job of scrapedJobs) {
        // Check if job already exists (simple check by URL)
        const q = query(collection(db, "jobs"), where("url", "==", job.url));
        const existing = await getDocs(q);
        
        if (existing.empty) {
          await addDoc(collection(db, "jobs"), {
            ...job,
            scrapedAt: serverTimestamp()
          });
          addedCount++;
        }
      }

      setStatus({ 
        type: 'success', 
        message: `Scraping complete! Found ${scrapedJobs.length} jobs, added ${addedCount} new ones.` 
      });
    } catch (error) {
      console.error("Scrape error:", error);
      setStatus({ type: 'error', message: "Scraping failed. Check server logs." });
    } finally {
      setIsScraping(false);
    }
  };

  const updateJobStatus = async (jobId: string, newStatus: JobStatus) => {
    try {
      const jobRef = doc(db, "jobs", jobId);
      await updateDoc(jobRef, { status: newStatus });
    } catch (error) {
      console.error("Update status error:", error);
      setStatus({ type: 'error', message: "Failed to update job status." });
    }
  };

  const generateSummary = async (job: Job) => {
    if (!job.id || job.summary || summarizingIds.has(job.id)) return;
    
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
      
      const jobRef = doc(db, "jobs", job.id);
      await updateDoc(jobRef, { summary });
    } catch (error) {
      console.error("Gemini summary error:", error);
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
    // Keyword filter
    const searchStr = `${job.title} ${job.company} ${job.description || ''}`.toLowerCase();
    const hasExcludedKeyword = excludedKeywords.some(kw => searchStr.includes(kw.toLowerCase()));
    
    // Location filter
    const jobLocation = job.location || "Switzerland";
    const isIgnoredLocation = ignoredLocations.includes(jobLocation);

    return !hasExcludedKeyword && !isIgnoredLocation;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
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
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Database className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">JobWatch-CH</h1>
          </div>
          
          {user ? (
            <div className="flex items-center gap-4">
              <div className="hidden sm:block text-right">
                <p className="text-sm font-medium">{user.displayName}</p>
                <p className="text-xs text-slate-500">{user.email}</p>
              </div>
              <button 
                onClick={handleLogout}
                className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-600"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-all shadow-sm"
            >
              <LogIn className="w-4 h-4" />
              Sign In with Google
            </button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!user ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="max-w-md mx-auto">
              <div className="bg-blue-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                <Search className="w-8 h-8 text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Welcome to Swiss AI Jobs</h2>
              <p className="text-slate-600 mb-8">
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
              <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Search className="w-5 h-5 text-blue-600" />
                  Search Queries
                </h3>
                
                <form onSubmit={addQuery} className="flex gap-2 mb-4">
                  <input 
                    type="text" 
                    value={newQuery}
                    onChange={(e) => setNewQuery(e.target.value)}
                    placeholder="e.g. Data Scientist"
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                  <button 
                    type="submit"
                    className="bg-slate-900 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
                  >
                    Add
                  </button>
                </form>

                <div className="flex flex-wrap gap-2 mb-6">
                  {searchQueries.map(q => (
                    <span 
                      key={q} 
                      className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-xs font-medium border border-blue-100"
                    >
                      {q}
                      <button onClick={() => removeQuery(q)} className="hover:text-blue-900">
                        &times;
                      </button>
                    </span>
                  ))}
                </div>

                <button 
                  onClick={handleScrape}
                  disabled={isScraping || searchQueries.length === 0}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-6 py-3 rounded-xl font-semibold transition-all shadow-md"
                >
                  {isScraping ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-5 h-5" />
                  )}
                  {isScraping ? "Scraping..." : "Start Scraper"}
                </button>
              </section>

              {/* Job Sources Toggles */}
              <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Database className="w-5 h-5 text-blue-600" />
                  Job Sources
                </h3>
                <div className="space-y-2">
                  {allAvailableSources.map((source) => (
                    <label 
                      key={source.id}
                      className="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors"
                    >
                      <span className="text-sm font-medium text-slate-700">{source.label}</span>
                      <div className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          className="sr-only peer"
                          checked={selectedSources.includes(source.id)}
                          onChange={() => toggleSource(source.id)}
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </div>
                    </label>
                  ))}
                </div>
              </section>

              {/* Excluded Keywords */}
              <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-rose-600">
                  <AlertCircle className="w-5 h-5" />
                  Exclude Keywords
                </h3>
                
                <form onSubmit={addExcludedKeyword} className="flex gap-2 mb-4">
                  <input 
                    type="text" 
                    value={newExcludedKeyword}
                    onChange={(e) => setNewExcludedKeyword(e.target.value)}
                    placeholder="e.g. SAP, Junior"
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 transition-all"
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
                      className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 px-3 py-1 rounded-full text-xs font-medium border border-rose-100"
                    >
                      {kw}
                      <button onClick={() => removeExcludedKeyword(kw)} className="hover:text-rose-900">
                        &times;
                      </button>
                    </span>
                  ))}
                  {excludedKeywords.length === 0 && (
                    <p className="text-xs text-slate-400 italic">No keywords excluded.</p>
                  )}
                </div>
              </section>

              {/* Ignored Locations */}
              <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-600">
                  <MapPin className="w-5 h-5 text-blue-600" />
                  Ignored Locations
                </h3>
                <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                  {ignoredLocations.map(loc => (
                    <span 
                      key={loc} 
                      className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-xs font-medium border border-slate-200"
                    >
                      {loc}
                      <button onClick={() => toggleLocationIgnore(loc)} className="hover:text-slate-900">
                        &times;
                      </button>
                    </span>
                  ))}
                  {ignoredLocations.length === 0 && (
                    <p className="text-xs text-slate-400 italic">No locations ignored. Click a location on a job card to ignore it.</p>
                  )}
                </div>
              </section>

              {/* Status Filter */}
              <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Filter className="w-5 h-5 text-blue-600" />
                  Filter by Status
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {filterOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setActiveFilter(opt.value)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        activeFilter === opt.value 
                          ? 'bg-blue-600 text-white shadow-sm' 
                          : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <opt.icon className="w-4 h-4" />
                      {opt.label}
                    </button>
                  ))}
                </div>
              </section>

              {/* Status Messages */}
              <AnimatePresence>
                {status && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className={`p-4 rounded-xl border flex gap-3 ${
                      status.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-800' :
                      status.type === 'error' ? 'bg-rose-50 border-rose-100 text-rose-800' :
                      'bg-blue-50 border-blue-100 text-blue-800'
                    }`}
                  >
                    {status.type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> :
                     status.type === 'error' ? <AlertCircle className="w-5 h-5 shrink-0" /> :
                     <Loader2 className="w-5 h-5 shrink-0 animate-spin" />}
                    <p className="text-sm font-medium">{status.message}</p>
                    <button 
                      onClick={() => setStatus(null)}
                      className="ml-auto text-slate-400 hover:text-slate-600"
                    >
                      &times;
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Main Content: Job List */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-4">
                  <h3 className="text-lg font-bold">
                    {activeFilter === 'all' ? 'All Jobs' : `${activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1)} Jobs`} ({filteredJobs.length})
                  </h3>
                  {filteredJobs.length > 0 && (
                    <button
                      onClick={handleExport}
                      className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-all border border-blue-100"
                      title="Export displayed jobs to JSON"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export JSON
                    </button>
                  )}
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Last updated: {jobs.length > 0 ? new Date((jobs[0].scrapedAt as any)?.seconds * 1000).toLocaleString() : 'Never'}
                </div>
              </div>

              <div className="space-y-4">
                {filteredJobs.length === 0 ? (
                  <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300">
                    <p className="text-slate-500">No jobs found matching your criteria.</p>
                  </div>
                ) : (
                  filteredJobs.map((job, idx) => (
                      <motion.div 
                        key={job.id || idx}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className={`bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all group ${
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
                              <h4 className="font-bold text-lg group-hover:text-blue-600 transition-colors leading-tight">
                                {job.title}
                              </h4>
                              {job.summary && (
                                <div className="group/summary relative">
                                  <Sparkles className="w-4 h-4 text-amber-500 fill-amber-50 cursor-help" />
                                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-72 p-3.5 bg-slate-900 text-white text-xs rounded-xl shadow-2xl opacity-0 invisible group-hover/summary:opacity-100 group-hover/summary:visible transition-all z-[100] pointer-events-none border border-white/10">
                                    <div className="font-bold flex items-center gap-1.5 mb-1.5 text-amber-400 border-b border-white/10 pb-1">
                                      <Sparkles className="w-3 h-3" />
                                      AI Insights
                                    </div>
                                    <div className="leading-relaxed whitespace-pre-wrap italic opacity-90">
                                      {job.summary}
                                    </div>
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900"></div>
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
                                  className={`p-1 rounded hover:bg-amber-50 transition-colors ${summarizingIds.has(job.id!) ? 'animate-pulse' : ''}`}
                                  title="Generate AI Summary"
                                >
                                  <Sparkles className={`w-4 h-4 ${summarizingIds.has(job.id!) ? 'text-amber-400' : 'text-slate-300 hover:text-amber-500'}`} />
                                </button>
                              )}
                              {job.status === 'applied' && (
                                <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                  Applied
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-y-2 gap-x-4 mt-2 text-sm text-slate-600">
                              <div className="flex items-center gap-1.5">
                                <Building2 className="w-4 h-4 text-slate-400" />
                                {job.company}
                              </div>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleLocationIgnore(job.location);
                                }}
                                className="flex items-center gap-1.5 hover:text-rose-600 transition-colors group/loc"
                                title="Click to ignore this location"
                              >
                                <MapPin className="w-4 h-4 text-slate-400 group-hover/loc:text-rose-400" />
                                <span className="underline decoration-dotted decoration-slate-300 group-hover/loc:decoration-rose-300">
                                  {job.location || "Switzerland"}
                                </span>
                              </button>
                              <div className="flex items-center gap-1.5">
                                <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                                  {job.source}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-slate-400 group-hover:text-blue-600 transition-colors">
                              {expandedJobId === job.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                            </div>
                            <a 
                              href={job.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="p-2 bg-slate-50 hover:bg-blue-50 text-slate-400 hover:text-blue-600 rounded-lg transition-all"
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
                              <div className="mt-4 pt-4 border-t border-slate-100">
                                <h5 className="text-sm font-bold text-slate-900 mb-2">Job Description</h5>
                                <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                                  {job.description || "No detailed description available for this snippet. Click the external link to view full details."}
                                </p>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      
                      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between rounded-b-2xl">
                        <div className="flex gap-2">
                          {job.status !== 'applied' && (
                            <button
                              onClick={() => job.id && updateJobStatus(job.id, 'applied')}
                              className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 hover:bg-emerald-50 px-3 py-1.5 rounded-lg transition-all"
                            >
                              <Send className="w-3.5 h-3.5" />
                              Mark Applied
                            </button>
                          )}
                          {job.status !== 'discarded' && (
                            <button
                              onClick={() => job.id && updateJobStatus(job.id, 'discarded')}
                              className="flex items-center gap-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Discard
                            </button>
                          )}
                          {job.status !== 'new' && (
                            <button
                              onClick={() => job.id && updateJobStatus(job.id, 'new')}
                              className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-all"
                            >
                              <Inbox className="w-3.5 h-3.5" />
                              Move to New
                            </button>
                          )}
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] text-slate-400 uppercase font-medium">
                            Query: {job.query}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            Scraped {new Date((job.scrapedAt as any)?.seconds * 1000).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}

                {jobs.length > 0 && hasMore && (
                  <div className="pt-4 flex justify-center">
                    <button
                      onClick={() => setPageSize(prev => prev + 10)}
                      className="flex items-center gap-2 bg-white border border-slate-200 px-6 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Load More Jobs
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
