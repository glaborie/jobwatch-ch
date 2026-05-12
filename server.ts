import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";
import { rateLimit } from 'express-rate-limit';

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0"
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Note: Scraping major sites like LinkedIn/Indeed usually requires headers to avoid being blocked.
const HEADERS = {
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9,de-CH;q=0.8,de;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "DNT": "1",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
};

/**
 * Utility to log axios errors effectively without dumping massive objects
 */
function logAxiosError(source: string, error: any, url?: string) {
  if (axios.isAxiosError(error)) {
    console.error(`Status [${source}]:`, error.response?.status || 'No Status');
    console.error(`Error [${source}]:`, error.message);
    if (url) console.error(`URL [${source}]:`, url);
  } else {
    console.error(`Error [${source}]:`, error);
  }
}

/**
 * Global URL Normalization to prevent duplicates
 */
function normalizeJobUrl(url: string): string {
  if (!url) return "";
  try {
    // Handle cases where URL might be relative (though scrapers should handle it)
    if (!url.startsWith('http')) return url;
    
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    
    // Normalize hostname
    let hostname = u.hostname.toLowerCase();
    if (hostname.includes('linkedin.com')) {
      hostname = 'www.linkedin.com';
    }
    u.hostname = hostname;

    // Normalize path
    let pathname = u.pathname;
    if (pathname.endsWith('/') && pathname.length > 1) {
      pathname = pathname.slice(0, -1);
    }
    u.pathname = pathname;

    return u.toString();
  } catch (e) {
    // Fallback for malformed URLs
    return url.split('?')[0].split('#')[0].replace(/\/$/, "");
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());
  app.set('trust proxy', 1);

  // Rate Limiting
  const scrapeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 15, // Increased slightly
    message: { error: "Too many scraping requests. Please try again in 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // API Routes
  app.get("/api/version", (req, res) => {
    res.json({ version: "1.0.2", buildTime: new Date().toISOString() });
  });

  const SCRAPE_TIMEOUT = 15000; // 15 seconds per request

  app.post("/api/scrape", scrapeLimiter, async (req, res) => {
    const { queries, sources } = req.body;
    if (!queries || !Array.isArray(queries)) {
      return res.status(400).json({ error: "Queries array is required" });
    }

    const selectedSources = Array.isArray(sources) ? sources : ["jobs.ch", "ictjobs.ch", "LinkedIn", "jobup.ch", "Indeed", "SwissDevJobs"];
    console.log(`[Scraping] Incoming request: queries=${JSON.stringify(queries)}, sources=${JSON.stringify(selectedSources)}`);
    
    const allJobs: any[] = [];

    try {
      for (const query of queries) {
        console.log(`[Scraping] Processing query: ${query}`);
        
        // 1. jobs.ch
        if (selectedSources.includes("jobs.ch")) {
          const jobsChUrl = `https://www.jobs.ch/en/vacancies/?term=${encodeURIComponent(query)}`;
          try {
            const response = await axios.get(jobsChUrl, { 
              headers: { ...HEADERS, "Referer": "https://www.jobs.ch/" },
              timeout: SCRAPE_TIMEOUT
            });
            const $ = cheerio.load(response.data);
            let jobsFound = 0;
            
            const nextData = $('#__NEXT_DATA__').html();
            if (nextData) {
              try {
                const parsed = JSON.parse(nextData);
                const results = parsed.props?.pageProps?.initialState?.search?.results;
                if (Array.isArray(results)) {
                  results.forEach((job: any) => {
                    const url = job.url.startsWith('http') ? job.url : `https://www.jobs.ch${job.url}`;
                    allJobs.push({
                      title: job.title || "Untitled Job",
                      company: job.company_name || job.company?.name || "Unknown Company",
                      location: job.location || job.place || "Switzerland",
                      url: normalizeJobUrl(url),
                      description: job.snippet || "",
                      source: "jobs.ch",
                      query,
                      scrapedAt: new Date().toISOString(),
                      publishedAt: job.publication_date || new Date().toISOString(),
                      status: "new"
                    });
                    jobsFound++;
                  });
                }
              } catch (e) {
                console.warn("[jobs.ch] JSON parse failed");
              }
            }

            if (jobsFound === 0) {
              $('[data-cy="serp-item"], [data-cy="job-item"]').each((_, el) => {
                const linkEl = $(el).find('[data-cy="job-link"], a').first();
                const title = linkEl.attr('title') || linkEl.text().trim();
                const link = linkEl.attr('href');
                const url = link ? (link.startsWith('http') ? link : `https://www.jobs.ch${link}`) : '';
                
                const pTags = $(el).find('p.textStyle_caption1, span.textStyle_caption1');
                const location = pTags.eq(1).text().trim();
                const company = pTags.last().text().trim();
                const description = $(el).find('[data-cy="job-snippet"]').text().trim();

                if (title && url) {
                  allJobs.push({
                    title,
                    company: company || "Unknown Company",
                    location: location || "Switzerland",
                    url,
                    description: description || undefined,
                    source: "jobs.ch",
                    query,
                    scrapedAt: new Date().toISOString(),
                    publishedAt: new Date().toISOString(),
                    status: "new"
                  });
                  jobsFound++;
                }
              });
            }
            console.log(`[jobs.ch] Found ${jobsFound} jobs`);
          } catch (e) {
            logAxiosError("jobs.ch", e, jobsChUrl);
          }
        }

        // 2. ictjobs.ch
        if (selectedSources.includes("ictjobs.ch")) {
          const ictJobsUrl = `https://ictjobs.ch/?fs=${encodeURIComponent(query)}`;
          try {
            const response = await axios.get(ictJobsUrl, { 
              headers: { ...HEADERS, "User-Agent": getRandomUserAgent() }, 
              timeout: SCRAPE_TIMEOUT 
            });
            const $ = cheerio.load(response.data);
            let jobsFound = 0;
            
            $('h2[itemprop="title"], .job-item h2, .vacancy-title').each((_, el) => {
              const title = $(el).text().trim();
              const parent = $(el).closest('.job-item, .vacancy, li, div');
              const company = parent.find('.author-text, .company, .employer').first().text().trim();
              const location = parent.find('.company-location span, .location').last().text().trim();
              const description = parent.find('.description, .snippet').text().trim();
              const link = $(el).find('a').attr('href') || parent.find('a').attr('href');
              const url = link ? (link.startsWith('http') ? link : `https://ictjobs.ch${link}`) : '';

              if (title && url) {
                allJobs.push({
                  title,
                  company: company || "Unknown Company",
                  location: location || "Switzerland",
                  url: normalizeJobUrl(url),
                  description: description || "",
                  source: "ictjobs.ch",
                  query,
                  scrapedAt: new Date().toISOString(),
                  publishedAt: new Date().toISOString(),
                  status: "new"
                });
                jobsFound++;
              }
            });
            console.log(`[ictjobs.ch] Found ${jobsFound} jobs`);
          } catch (e) {
            logAxiosError("ictjobs.ch", e, ictJobsUrl);
          }
        }

        // 3. LinkedIn
        if (selectedSources.includes("LinkedIn")) {
          const linkedInUrl = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(query)}&location=Switzerland&start=0`;
          try {
            const response = await axios.get(linkedInUrl, { 
              headers: { ...HEADERS, "User-Agent": getRandomUserAgent() }, 
              timeout: SCRAPE_TIMEOUT 
            });
            const $ = cheerio.load(response.data);
            let jobsFound = 0;
            
            $('li, .base-search-card, .job-search-card').each((_, el) => {
              const title = $(el).find('.base-search-card__title, .job-search-card__title, h3').text().trim();
              const company = $(el).find('.base-search-card__subtitle, .job-search-card__subtitle, h4').text().trim();
              const locationEl = $(el).find('.job-search-card__location');
              const location = locationEl.length > 0 
                ? locationEl.text().trim() 
                : $(el).find('.base-search-card__metadata').contents().first().text().trim();
              const link = $(el).find('a.base-card__full-link, a.base-search-card__full-link').attr('href');
              
              if (title && link) {
                allJobs.push({
                  title,
                  company: company || "Unknown Company",
                  location: location || "Switzerland",
                  url: normalizeJobUrl(link),
                  description: "View full description on LinkedIn.",
                  source: "LinkedIn",
                  query,
                  scrapedAt: new Date().toISOString(),
                  publishedAt: new Date().toISOString(),
                  status: "new"
                });
                jobsFound++;
              }
            });
            console.log(`[LinkedIn] Found ${jobsFound} jobs`);
          } catch (e) {
            logAxiosError("LinkedIn", e, linkedInUrl);
          }
        }

        // 4. jobup.ch
        if (selectedSources.includes("jobup.ch")) {
          const jobupUrl = `https://www.jobup.ch/en/vacancies/?term=${encodeURIComponent(query)}`;
          try {
            const response = await axios.get(jobupUrl, { 
              headers: { ...HEADERS, "Referer": "https://www.jobup.ch/" },
              timeout: SCRAPE_TIMEOUT
            });
            const $ = cheerio.load(response.data);
            let jobsFound = 0;
            
            const nextData = $('#__NEXT_DATA__').html();
            if (nextData) {
              try {
                const parsed = JSON.parse(nextData);
                const results = parsed.props?.pageProps?.initialState?.search?.results;
                if (Array.isArray(results)) {
                  results.forEach((job: any) => {
                    const url = job.url.startsWith('http') ? job.url : `https://www.jobup.ch${job.url}`;
                    allJobs.push({
                      title: job.title || "Untitled Job",
                      company: job.company_name || job.company?.name || "Unknown Company",
                      location: job.location || job.place || "Switzerland",
                      url: normalizeJobUrl(url),
                      description: job.snippet || "",
                      source: "jobup.ch",
                      query,
                      scrapedAt: new Date().toISOString(),
                      publishedAt: job.publication_date || new Date().toISOString(),
                      status: "new"
                    });
                    jobsFound++;
                  });
                }
              } catch (e) {
                console.warn("[jobup.ch] JSON parse failed");
              }
            }

            if (jobsFound === 0) {
              $('[data-cy="job-item"], [data-cy="serp-item"]').each((_, el) => {
                const linkEl = $(el).find('a').first();
                const title = linkEl.attr('title') || linkEl.text().trim() || $(el).find('h2').text().trim();
                const link = linkEl.attr('href');
                const url = link ? (link.startsWith('http') ? link : `https://www.jobup.ch${link}`) : '';
                const pTags = $(el).find('p.textStyle_caption1, span.textStyle_caption1');
                const location = pTags.eq(1).text().trim();
                const company = pTags.last().text().trim();
                const description = $(el).find('[data-cy="job-snippet"]').text().trim();

                if (title && url) {
                  allJobs.push({
                    title,
                    company: company || "Unknown Company",
                    location: location || "Switzerland",
                    url,
                    description: description || undefined,
                    source: "jobup.ch",
                    query,
                    scrapedAt: new Date().toISOString(),
                    publishedAt: new Date().toISOString(),
                    status: "new"
                  });
                  jobsFound++;
                }
              });
            }
            console.log(`[jobup.ch] Found ${jobsFound} jobs`);
          } catch (e) {
            logAxiosError("jobup.ch", e, jobupUrl);
          }
        }

        // 5. Indeed
        if (selectedSources.includes("Indeed")) {
          const indeedUrl = `https://ch.indeed.com/jobs?q=${encodeURIComponent(query)}&l=Switzerland&from=search-js&vjk=`;
          try {
            const currentUA = getRandomUserAgent();
            const response = await axios.get(indeedUrl, { 
              headers: {
                ...HEADERS,
                "User-Agent": currentUA,
                "Referer": "https://ch.indeed.com/",
                "Sec-Fetch-Site": "same-origin",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Dest": "document",
                "sec-ch-ua-platform": '"Windows"',
                "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
                "sec-ch-ua-mobile": "?0",
              },
              timeout: SCRAPE_TIMEOUT
            });
            const $ = cheerio.load(response.data);
            let jobsFound = 0;
            
            const jobCards = $('.job_seen_beacon, .result, .tapItem, [id^="job_"], .slider_container');
            jobCards.each((_, el) => {
              const title = $(el).find('h2.jobTitle, .jobTitle, [id^="jobTitle"]').text().trim();
              const company = $(el).find('[data-testid="company-name"], .companyName, .company_location .companyName').text().trim();
              const location = $(el).find('[data-testid="text-location"], .companyLocation, .location').text().trim();
              const link = $(el).find('a.jcs-JobTitle, a.result-node-job-title, a[id^="job_"]').attr('href');
              const url = link ? (link.startsWith('http') ? link : `https://ch.indeed.com${link}`) : '';

              if (title && url) {
                allJobs.push({
                  title,
                  company: company || "Unknown Company",
                  location: location || "Switzerland",
                  url: normalizeJobUrl(url),
                  description: "View full description on Indeed.",
                  source: "Indeed",
                  query,
                  scrapedAt: new Date().toISOString(),
                  publishedAt: new Date().toISOString(),
                  status: "new"
                });
                jobsFound++;
              }
            });
            console.log(`[Indeed] Found ${jobsFound} jobs`);
          } catch (e) {
            logAxiosError("Indeed", e, indeedUrl);
          }
        }

        // 6. SwissDevJobs
        if (selectedSources.includes("SwissDevJobs")) {
          const sdvUrl = `https://swissdevjobs.ch/jobs/${encodeURIComponent(query)}/All/All`;
          try {
            const response = await axios.get(sdvUrl, { 
              headers: { ...HEADERS, "User-Agent": getRandomUserAgent() }, 
              timeout: SCRAPE_TIMEOUT 
            });
            const $ = cheerio.load(response.data);
            let jobsFound = 0;
            
            $('.job-list-item').each((_, el) => {
              const title = $(el).find('h2').text().trim();
              const company = $(el).find('.company-name').text().trim();
              const location = $(el).find('.location').text().trim();
              const link = $(el).find('a.job-title').attr('href');
              const urlValue = link ? (link.startsWith('http') ? link : `https://swissdevjobs.ch${link}`) : '';
              const description = $(el).find('.job-description').text().trim();

              if (title && urlValue) {
                allJobs.push({
                  title,
                  company: company || "Unknown Company",
                  location: location || "Switzerland",
                  url: normalizeJobUrl(urlValue),
                  description: description || "",
                  source: "SwissDevJobs",
                  query,
                  scrapedAt: new Date().toISOString(),
                  publishedAt: new Date().toISOString(),
                  status: "new"
                });
                jobsFound++;
              }
            });
            console.log(`[SwissDevJobs] Found ${jobsFound} jobs`);
          } catch (e) {
            logAxiosError("SwissDevJobs", e, sdvUrl);
          }
        }

        // Delay between queries to be gentler
        if (queries.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log(`[Scraping] Completed. Total jobs found: ${allJobs.length}`);
      res.json({ jobs: allJobs });
    } catch (error: any) {
      console.error("Critical Scraping Error:", error);
      res.status(500).json({ 
        error: "Failed to scrape jobs", 
        details: error.message || "Unknown error",
        stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    // Serve static assets with long cache for hashed files
    app.use(express.static(distPath, {
      maxAge: '1y',
      index: false
    }));
    
    // Always serve index.html for SPA routes, but prevent caching of index.html itself
    app.get("*", (req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Initialized dev server info
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Global Error Handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled Server Error:", err);
    res.status(500).json({
      error: "Internal Server Error",
      details: err.message || "Unknown error",
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
    });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
