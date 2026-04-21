# JobWatch-CH

A full-stack web application designed to scrape, track, and manage AI-related job opportunities from Swiss job boards (`jobs.ch` and `ictjobs.ch`).

## Features

- **Automated Scraping**: Fetches the latest job postings based on customizable search queries.
- **Real-time Tracking**: Uses Firebase Firestore to store and sync job data instantly.
- **Status Management**: Track your progress by marking jobs as "New", "Applied", or "Discarded".
- **Pagination**: Efficiently browse through large numbers of job listings.
- **Google Authentication**: Secure access using Firebase Auth.

## Setup Instructions

### 1. Clone the Repository
```bash
git clone https://github.com/glaborie/jobwatch-ch
cd jobwatch-ch
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Firebase
This project requires a Firebase project with **Authentication** (Google Provider) and **Cloud Firestore** enabled.

1. Create a new Firebase project at [Firebase Console](https://console.firebase.google.com/).
2. Enable **Google Sign-In** in the Authentication section.
3. Create a **Cloud Firestore** database.
4. Copy the `firebase-applet-config.json.example` to a new file named `firebase-applet-config.json`.
5. Fill in your Firebase project credentials in `firebase-applet-config.json`.
6. Deploy the security rules found in `firestore.rules` to your Firebase project.

### 4. Environment Variables
Create a `.env` file in the root directory if you need to specify custom environment variables (see `.env.example`).

### 5. Run the Application

**Development Mode:**
```bash
npm run dev
```

**Production Build:**
```bash
npm run build
npm start
```

## Docker Instructions

You can also run the application as a containerized service.

### 1. Build the Image
```bash
docker build -t swiss-job-scraper .
```

### 2. Run the Container
```bash
docker run -p 3000:3000 --env-file .env swiss-job-scraper
```
The app will be accessible at `http://localhost:3000`.

## Project Structure

- `server.ts`: Express backend handling the scraping logic.
- `src/App.tsx`: Main React frontend with job management UI.
- `src/firebase.ts`: Firebase SDK initialization.
- `firestore.rules`: Security rules for Firestore.
- `firebase-blueprint.json`: Data model definition.

## Security Note
The `firebase-applet-config.json` file is excluded from git via `.gitignore` to protect your API keys. Always use the provided example file as a template for new environments.
