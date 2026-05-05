import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";
import { rateLimit } from 'express-rate-limit';

// Note: Scraping major sites like LinkedIn/Indeed usually requires headers to avoid being blocked.
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());
  app.set('trust proxy', 1);

  // Rate Limiting
  const scrapeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per windowMs
    message: { error: "Too many scraping requests. Please try again in 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // API Routes
  app.get("/api/version", (req, res) => {
    res.json({ version: "1.0.1", buildTime: new Date().toISOString() });
  });

  app.post("/api/scrape", scrapeLimiter, async (req, res) => {
    const { queries, sources } = req.body;
    if (!queries || !Array.isArray(queries)) {
      return res.status(400).json({ error: "Queries array is required" });
    }

    const selectedSources = Array.isArray(sources) ? sources : ["jobs.ch", "ictjobs.ch", "LinkedIn", "jobup.ch", "Indeed", "SwissDevJobs"];
    const allJobs: any[] = [];

    try {
      for (const query of queries) {
        // 1. jobs.ch (Swiss job board)
        if (selectedSources.includes("jobs.ch")) {
          const jobsChUrl = `https://www.jobs.ch/en/vacancies/?term=${encodeURIComponent(query)}`;
          try {
            const response = await axios.get(jobsChUrl, { 
              headers: { ...HEADERS, "Referer": "https://www.jobs.ch/" } 
            });
            const $ = cheerio.load(response.data);
            
            let foundInJson = false;
            const nextData = $('#__NEXT_DATA__').html();
            if (nextData) {
              try {
                const parsed = JSON.parse(nextData);
                const results = parsed.props?.pageProps?.initialState?.search?.results;
                if (Array.isArray(results)) {
                  results.forEach((job: any) => {
                    allJobs.push({
                      title: job.title,
                      company: job.company_name || job.company?.name || "Unknown Company",
                      location: job.location || job.place || "Switzerland",
                      url: job.url.startsWith('http') ? job.url : `https://www.jobs.ch${job.url}`,
                      description: job.snippet || undefined,
                      source: "jobs.ch",
                      query,
                      scrapedAt: new Date().toISOString(),
                      publishedAt: job.publication_date || new Date().toISOString(),
                      status: "new"
                    });
                  });
                  foundInJson = true;
                }
              } catch (e) {
                console.warn("[jobs.ch] JSON parsing failed, falling back to selectors");
              }
            }

            if (!foundInJson) {
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
                }
              });
            }
          } catch (e) {
            logAxiosError("jobs.ch", e, jobsChUrl);
          }
        }

        // 2. ictjobs.ch
        if (selectedSources.includes("ictjobs.ch")) {
          const ictJobsUrl = `https://ictjobs.ch/?fs=${encodeURIComponent(query)}`;
          try {
            const response = await axios.get(ictJobsUrl, { headers: HEADERS });
            const $ = cheerio.load(response.data);
            
            $('h2[itemprop="title"]').each((_, el) => {
              const title = $(el).text().trim();
              const parent = $(el).parent();
              const company = parent.find('.author-text').text().trim();
              // Location is usually the last span in company-location
              const location = parent.find('.company-location span').last().text().trim();
              const description = parent.find('.description').text().trim();
              const link = $(el).find('a').attr('href');
              const url = link ? (link.startsWith('http') ? link : `https://ictjobs.ch${link}`) : '';

              if (title && url) {
                allJobs.push({
                  title,
                  company: company || "Unknown Company",
                  location: location || "Switzerland",
                  url,
                  description: description || undefined,
                  source: "ictjobs.ch",
                  query,
                  scrapedAt: new Date().toISOString(),
                  publishedAt: new Date().toISOString(),
                  status: "new"
                });
              }
            });
          } catch (e) {
            logAxiosError("ictjobs.ch", e, ictJobsUrl);
          }
        }

        // 3. LinkedIn (Guest API)
        if (selectedSources.includes("LinkedIn")) {
          const linkedInUrl = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(query)}&location=Switzerland&start=0`;
          try {
            const response = await axios.get(linkedInUrl, { headers: HEADERS });
            const $ = cheerio.load(response.data);
            
            $('li').each((_, el) => {
              const title = $(el).find('.base-search-card__title').text().trim();
              const company = $(el).find('.base-search-card__subtitle').text().trim();
              const location = $(el).find('.job-search-card__location').text().trim();
              const link = $(el).find('a.base-card__full-link').attr('href');
              
              if (title && link) {
                allJobs.push({
                  title,
                  company: company || "Unknown Company",
                  location: location || "Switzerland",
                  url: link,
                  description: "View full description on LinkedIn.",
                  source: "LinkedIn",
                  query,
                  scrapedAt: new Date().toISOString(),
                  publishedAt: new Date().toISOString(),
                  status: "new"
                });
              }
            });
          } catch (e) {
            logAxiosError("LinkedIn", e, linkedInUrl);
          }
        }

        // 4. jobup.ch (French-speaking Switzerland focus)
        if (selectedSources.includes("jobup.ch")) {
          const jobupUrl = `https://www.jobup.ch/en/vacancies/?term=${encodeURIComponent(query)}`;
          try {
            const response = await axios.get(jobupUrl, { 
              headers: { ...HEADERS, "Referer": "https://www.jobup.ch/" } 
            });
            const $ = cheerio.load(response.data);
            
            let foundInJson = false;
            const nextData = $('#__NEXT_DATA__').html();
            if (nextData) {
              try {
                const parsed = JSON.parse(nextData);
                const results = parsed.props?.pageProps?.initialState?.search?.results;
                if (Array.isArray(results)) {
                  results.forEach((job: any) => {
                    allJobs.push({
                      title: job.title,
                      company: job.company_name || job.company?.name || "Unknown Company",
                      location: job.location || job.place || "Switzerland",
                      url: job.url.startsWith('http') ? job.url : `https://www.jobup.ch${job.url}`,
                      description: job.snippet || undefined,
                      source: "jobup.ch",
                      query,
                      scrapedAt: new Date().toISOString(),
                      publishedAt: job.publication_date || new Date().toISOString(),
                      status: "new"
                    });
                  });
                  foundInJson = true;
                }
              } catch (e) {
                console.warn("[jobup.ch] JSON parsing failed, falling back to selectors");
              }
            }

            if (!foundInJson) {
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
                }
              });
            }
          } catch (e) {
            logAxiosError("jobup.ch", e, jobupUrl);
          }
        }

        // 5. Indeed (Switzerland) - Note: Indeed has high bot protection
        if (selectedSources.includes("Indeed")) {
          const indeedUrl = `https://ch.indeed.com/jobs?q=${encodeURIComponent(query)}&l=Switzerland&from=search-js&vjk=`;
          try {
            const response = await axios.get(indeedUrl, { 
              headers: {
                ...HEADERS,
                "Referer": "https://ch.indeed.com/",
                "Sec-Fetch-Site": "same-origin"
              } 
            });
            const $ = cheerio.load(response.data);
            
            $('.job_seen_beacon').each((_, el) => {
              const title = $(el).find('h2.jobTitle').text().trim();
              const company = $(el).find('[data-testid="company-name"]').text().trim();
              const location = $(el).find('[data-testid="text-location"]').text().trim();
              const link = $(el).find('a.jcs-JobTitle').attr('href');
              const url = link ? `https://ch.indeed.com${link}` : '';

              if (title && url) {
                allJobs.push({
                  title,
                  company: company || "Unknown Company",
                  location: location || "Switzerland",
                  url,
                  description: "View full description on Indeed.",
                  source: "Indeed",
                  query,
                  scrapedAt: new Date().toISOString(),
                  publishedAt: new Date().toISOString(),
                  status: "new"
                });
              }
            });
          } catch (e) {
            logAxiosError("Indeed", e, indeedUrl);
          }
        }
        // 6. SwissDevJobs (Alternative for Tech/AI jobs)
        if (selectedSources.includes("SwissDevJobs")) {
          let sdvUrl = `https://swissdevjobs.ch/jobs/${encodeURIComponent(query)}/All/All`;
          try {
            const response = await axios.get(sdvUrl, { headers: HEADERS });
            const $ = cheerio.load(response.data);
            
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
                  url: urlValue,
                  description: description || undefined,
                  source: "SwissDevJobs",
                  query,
                  scrapedAt: new Date().toISOString(),
                  publishedAt: new Date().toISOString(),
                  status: "new"
                });
              }
            });
          } catch (e) {
            logAxiosError("SwissDevJobs", e, sdvUrl);
          }
        }
      }

      res.json({ jobs: allJobs });
    } catch (error) {
      console.error("Scraping error:", error);
      res.status(500).json({ error: "Failed to scrape jobs" });
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
