# SaveQuest — From Unzip to Live in 30 Minutes

This guide takes you from a freshly unzipped folder to a fully running SaveQuest app.

---

## What you'll need

- **Node.js 18+** — https://nodejs.org (download LTS)
- **A Supabase account** — https://supabase.com (free tier is enough)
- **A terminal** (Terminal on Mac/Linux, Command Prompt or PowerShell on Windows)

---

## Step 1 — Install Node.js (if you don't have it)

Go to https://nodejs.org and download the **LTS** version. Run the installer. When it's done, open a terminal and check:

```
node --version
```

You should see something like `v20.11.0`. If you do, you're good.

---

## Step 2 — Set up Supabase

Supabase is the backend (database + auth). It's free for small apps.

1. Go to https://supabase.com and click **Start your project**
2. Sign up or sign in
3. Click **New project**
4. Give it a name (e.g. `savequest`) and a strong database password — **save this password somewhere**
5. Choose a region close to you
6. Wait ~2 minutes for the project to spin up

### Get your API keys

Once your project is ready:

1. In the left sidebar, click **Project Settings** (the gear icon at the bottom)
2. Click **API**
3. Copy these two values — you'll need them shortly:
   - **Project URL** — looks like `https://abcdefghijk.supabase.co`
   - **anon public** key — a long string starting with `eyJ...`

---

## Step 3 — Run the database schema

This creates all the tables SaveQuest needs.

1. In your Supabase project, click **SQL Editor** in the left sidebar
2. Click **New query**
3. Open the file `supabase/migrations/001_initial_schema.sql` from the SaveQuest folder
4. Copy its entire contents and paste into the SQL editor
5. Click **Run** (or press Cmd+Enter / Ctrl+Enter)
6. You should see "Success. No rows returned" — that's correct

Your database is now set up with all tables, security policies, and seed data (the default challenges).

---

## Step 4 — Configure the app

1. In the SaveQuest folder, find the file called `.env.local.example`
2. Make a copy of it and rename the copy to `.env.local` (remove the `.example` part)
3. Open `.env.local` in any text editor (Notepad, TextEdit, VS Code, etc.)
4. Replace the placeholder values with your real Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-actual-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-actual-anon-key-here
```

Save the file.

---

## Step 5 — Install dependencies

Open a terminal, navigate to the SaveQuest folder, and run:

```
npm install
```

This downloads all the libraries the app needs. It takes 1–3 minutes the first time.

**How to navigate to the folder in terminal:**
- Mac/Linux: `cd ~/Downloads/savequest` (or wherever you unzipped it)
- Windows: `cd C:\Users\YourName\Downloads\savequest`

---

## Step 6 — Run the app

```
npm run dev
```

Open your browser and go to: **http://localhost:3000**

You should see the SaveQuest login screen. 

**To stop the app:** press `Ctrl+C` in the terminal.

---

## Step 7 — Create your first account

1. Click **Create an account**
2. Follow the 3-step onboarding
3. You'll land on the dashboard

The app is fully functional locally. Create goals, log savings, accept quests, and watch your XP grow.

---

## Deploying online (so others can use it)

### Option A — Vercel (easiest, free)

Vercel is made by the same team as Next.js. Deploying is a one-click process.

1. Install Git if you don't have it: https://git-scm.com
2. Create a GitHub account if you don't have one: https://github.com
3. Create a new repository on GitHub and push the SaveQuest code to it:
   ```
   git init
   git add .
   git commit -m "Initial SaveQuest"
   git remote add origin https://github.com/YOUR_USERNAME/savequest.git
   git push -u origin main
   ```
4. Go to https://vercel.com and sign in with GitHub
5. Click **Add New Project**
6. Import your `savequest` repository
7. In the **Environment Variables** section, add:
   - `NEXT_PUBLIC_SUPABASE_URL` = your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your Supabase anon key
8. Click **Deploy**

After 1-2 minutes you'll have a live URL like `savequest.vercel.app` that anyone can use.

### Option B — Netlify

Similar process to Vercel. Go to https://netlify.com, import from GitHub, add the same two environment variables.

---

## Enable email confirmations (optional but recommended for production)

By default, Supabase may require email confirmation on signup. To disable this during development:

1. In Supabase, go to **Authentication** → **Providers** → **Email**
2. Toggle off **Confirm email**
3. Save

For production, leave it enabled so users verify their email addresses.

---

## Customising the app

### Change the currency symbol
Open `lib/utils.ts` and find the `formatCurrency` function. Change `"R"` to your currency symbol (`"$"`, `"€"`, etc.)

### Add more challenges
In Supabase, go to **Table Editor** → `challenges` → **Insert row**. Fill in the title, description, `xp_reward`, `duration_days`, and set `is_active` to true.

### Change the app name and branding
- App name: `app/layout.tsx` → update the `metadata` object
- Colors: `tailwind.config.ts` → update the `brand` color values
- Logo emoji: search for `⚡` in the login/signup pages and replace it

### Add your own achievement badges
Open `lib/achievements.ts` and add entries to the `ACHIEVEMENTS` array following the existing format. Then add the corresponding check logic in `checkAchievements`.

---

## File structure overview

```
savequest/
├── app/                    Next.js pages (routes)
│   ├── auth/               Login + signup pages
│   ├── (app)/              Protected app pages
│   │   ├── dashboard/      Home screen
│   │   ├── goals/          Goals list + detail + new goal
│   │   ├── quests/         Challenges
│   │   └── profile/        User profile + badges
│   └── api/                API routes (server logic)
├── components/             Reusable UI components
│   ├── gamification/       XP bar, streak badge, celebration overlay
│   ├── goals/              Goal card component
│   ├── layout/             Bottom navigation
│   └── quests/             Quest components
├── lib/                    Core logic
│   ├── achievements.ts     All achievement definitions + check logic
│   ├── xp.ts               XP values, level thresholds, multipliers
│   ├── streaks.ts          Streak calculation helpers
│   ├── types.ts            TypeScript types matching the database
│   └── utils.ts            Currency formatting, goal categories, helpers
├── supabase/
│   └── migrations/         SQL schema (run this in Supabase SQL editor)
├── .env.local.example      Template for your environment variables
└── SETUP_GUIDE.md          This file
```

---

## Common issues

**"Cannot find module" errors on npm install**
Make sure you're in the right folder (`cd savequest` before running `npm install`).

**Blank white screen or 500 error**
Your `.env.local` file is probably missing or has wrong values. Double-check the Supabase URL and anon key.

**"Invalid API key" from Supabase**
You may have accidentally used the `service_role` key instead of the `anon` key. The anon key is safe to use in the browser. The service role key should never go in frontend code.

**Login works but dashboard is empty**
The SQL migration may not have run. Go back to Step 3 and run the SQL again. It's safe to run twice — it uses `IF NOT EXISTS`.

**Can't receive emails for password reset**
During development, Supabase's email sending is rate-limited. Use the Supabase dashboard to view auth events: **Authentication** → **Users**.

---

## What's next (after MVP)

Once you have users and the core loop is working:

1. **Push notifications** — Use Supabase Edge Functions with a cron job to send streak warnings at 6pm daily
2. **AI savings coach** — Add an API call to Claude to generate personalised weekly savings advice
3. **Social features** — Add a `friends` table and a leaderboard query
4. **Analytics** — Add Posthog (free tier) to track which features users engage with most
5. **Mobile app** — The codebase can be wrapped in Capacitor or converted to React Native

Good luck! 🚀
