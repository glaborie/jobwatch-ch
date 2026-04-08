import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";

// Note: Scraping major sites like LinkedIn/Indeed usually requires headers to avoid being blocked.
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.post("/api/scrape", async (req, res) => {
    const { queries } = req.body;
    if (!queries || !Array.isArray(queries)) {
      return res.status(400).json({ error: "Queries array is required" });
    }

    const allJobs: any[] = [];

    try {
      for (const query of queries) {
        // We'll implement a few scrapers. 
        // Note: Real scraping is complex. These are simplified versions for Swiss job boards.
        
        // 1. jobs.ch (Swiss job board)
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
          console.error("Error scraping jobs.ch:", e);
        }

        // 2. ictjobs.ch
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
          console.error("Error scraping ictjobs.ch:", e);
        }

        // 3. LinkedIn (Guest API)
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
          console.error("Error scraping LinkedIn:", e);
        }

        // LinkedIn/Indeed/Glassdoor often have heavy bot protection.
        // For this demo, we'll focus on the more accessible Swiss ones or provide placeholders/simulated results
        // if they block us.
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
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
