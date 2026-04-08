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
  ChevronUp
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
  limit
} from 'firebase/firestore';
import { auth, db } from './firebase';

type JobStatus = 'new' | 'discarded' | 'applied';

interface Job {
  id?: string;
  title: string;
  company: string;
  location: string;
  url: string;
  source: string;
  description?: string;
  scrapedAt: Timestamp | string;
  query: string;
  status: JobStatus;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isScraping, setIsScraping] = useState(false);
  const [searchQueries, setSearchQueries] = useState<string[]>(["AI Engineer", "AI Architect"]);
  const [newQuery, setNewQuery] = useState("");
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info', message: string } | null>(null);
  const [activeFilter, setActiveFilter] = useState<JobStatus | 'all'>('new');
  const [pageSize, setPageSize] = useState(10);
  const [hasMore, setHasMore] = useState(true);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

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
        body: JSON.stringify({ queries: searchQueries })
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
            <h1 className="text-xl font-bold tracking-tight">Swiss AI Job Scraper</h1>
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
                <h3 className="text-lg font-bold">
                  {activeFilter === 'all' ? 'All Jobs' : `${activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1)} Jobs`} ({jobs.length})
                </h3>
                <div className="text-xs text-slate-500 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Last updated: {jobs.length > 0 ? new Date((jobs[0].scrapedAt as any)?.seconds * 1000).toLocaleString() : 'Never'}
                </div>
              </div>

              <div className="space-y-4">
                {jobs.length === 0 ? (
                  <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300">
                    <p className="text-slate-500">No jobs found in this category.</p>
                  </div>
                ) : (
                  jobs.map((job, idx) => (
                    <motion.div 
                      key={job.id || idx}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className={`bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all group overflow-hidden ${
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
                              <div className="flex items-center gap-1.5">
                                <MapPin className="w-4 h-4 text-slate-400" />
                                {job.location || "Switzerland"}
                              </div>
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
                      
                      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
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
