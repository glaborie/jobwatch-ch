import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";

// Note: Scraping major sites like LinkedIn/Indeed usually requires headers to avoid being blocked.
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "DNT": "1",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
};

/**
 * Utility to log axios errors effectively without dumping massive objects
 */
function logAxiosError(source: string, error: any) {
  if (axios.isAxiosError(error)) {
    console.error(`Status [${source}]:`, error.response?.status || 'No Status');
    console.error(`Error [${source}]:`, error.message);
  } else {
    console.error(`Error [${source}]:`, error);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.get("/api/version", (req, res) => {
    res.json({ version: "1.0.1", buildTime: new Date().toISOString() });
  });

  app.post("/api/scrape", async (req, res) => {
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
          try {
            const jobsChUrl = `https://www.jobs.ch/en/vacancies/?term=${encodeURIComponent(query)}`;
            const response = await axios.get(jobsChUrl, { headers: HEADERS });
            const $ = cheerio.load(response.data);
            
            $('[data-cy="serp-item"]').each((_, el) => {
              const linkEl = $(el).find('[data-cy="job-link"]');
              const title = linkEl.attr('title') || linkEl.text().trim();
              const link = linkEl.attr('href');
              const url = link ? (link.startsWith('http') ? link : `https://www.jobs.ch${link}`) : '';
              
              // Extracting company and location from the p tags
              const pTags = $(el).find('p.textStyle_caption1');
              const location = pTags.eq(1).text().trim(); // Usually the 2nd p tag
              const company = pTags.last().text().trim(); // Usually the last p tag
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
                  status: "new"
                });
              }
            });
          } catch (e) {
            logAxiosError("jobs.ch", e);
          }
        }

        // 2. ictjobs.ch
        if (selectedSources.includes("ictjobs.ch")) {
          try {
            const ictJobsUrl = `https://ictjobs.ch/?fs=${encodeURIComponent(query)}`;
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
                  status: "new"
                });
              }
            });
          } catch (e) {
            logAxiosError("ictjobs.ch", e);
          }
        }

        // 3. LinkedIn (Guest API)
        if (selectedSources.includes("LinkedIn")) {
          try {
            const linkedInUrl = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(query)}&location=Switzerland&start=0`;
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
                  status: "new"
                });
              }
            });
          } catch (e) {
            logAxiosError("LinkedIn", e);
          }
        }

        // 4. jobup.ch (French-speaking Switzerland focus)
        if (selectedSources.includes("jobup.ch")) {
          try {
            const jobupUrl = `https://www.jobup.ch/en/vacancies/?term=${encodeURIComponent(query)}`;
            const response = await axios.get(jobupUrl, { headers: HEADERS });
            const $ = cheerio.load(response.data);
            
            $('[data-cy="job-item"]').each((_, el) => {
              const title = $(el).find('h2').text().trim();
              const link = $(el).find('a').attr('href');
              const url = link ? (link.startsWith('http') ? link : `https://www.jobup.ch${link}`) : '';
              const pTags = $(el).find('p.textStyle_caption1');
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
                  status: "new"
                });
              }
            });
          } catch (e) {
            logAxiosError("jobup.ch", e);
          }
        }

        // 5. Indeed (Switzerland) - Note: Indeed has high bot protection
        if (selectedSources.includes("Indeed")) {
          try {
            // Trying a more specific Indeed URL or fallback search
            const indeedUrl = `https://ch.indeed.com/jobs?q=${encodeURIComponent(query)}&l=Schweiz&from=search-js`;
            const response = await axios.get(indeedUrl, { 
              headers: {
                ...HEADERS,
                "Referer": "https://ch.indeed.com/"
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
                  status: "new"
                });
              }
            });
          } catch (e) {
            logAxiosError("Indeed", e);
          }
        }
        // 6. SwissDevJobs (Alternative for Tech/AI jobs)
        if (selectedSources.includes("SwissDevJobs")) {
          try {
            const url = `https://swissdevjobs.ch/jobs/${encodeURIComponent(query)}/All/All`;
            const response = await axios.get(url, { headers: HEADERS });
            const $ = cheerio.load(response.data);
            
            $('.job-list-item').each((_, el) => {
              const title = $(el).find('h2').text().trim();
              const company = $(el).find('.company-name').text().trim();
              const location = $(el).find('.location').text().trim();
              const link = $(el).find('a.job-title').attr('href');
              const url = link ? (link.startsWith('http') ? link : `https://swissdevjobs.ch${link}`) : '';
              const description = $(el).find('.job-description').text().trim();

              if (title && url) {
                allJobs.push({
                  title,
                  company: company || "Unknown Company",
                  location: location || "Switzerland",
                  url,
                  description: description || undefined,
                  source: "SwissDevJobs",
                  query,
                  scrapedAt: new Date().toISOString(),
                  status: "new"
                });
              }
            });
          } catch (e) {
            logAxiosError("SwissDevJobs", e);
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
