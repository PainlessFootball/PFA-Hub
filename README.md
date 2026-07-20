# Painless Football Alliance — Fan Hub

The PFA website. Live standings from Sleeper, alliance news and cross-league
chat via Firebase, coaching points from the Alliance sheet.

## Setup
Follow the step-by-step walkthrough (PFA-Deployment-Walkthrough) that came
with this project. Short version:

1. Upload this folder to a GitHub repository
2. Import the repository into Vercel — it deploys automatically
3. Create a Firebase project and paste its config into `src/firebase-config.js`
4. Drop your logo into `public/pfa-logo.png`

## Where things live
- `src/App.jsx` — the whole site (pages, tier list, league ID)
- `src/storage.js` — chat + news storage (Firebase or local fallback)
- `src/firebase-config.js` — your Firebase keys go here
- `public/` — logo and any other images
