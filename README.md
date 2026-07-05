# Auvia Collect — Frontend

React + Vite + Tailwind implementation of the Auvia Collect screens, converted from the Stitch HTML exports into a proper component structure.

## Setup

```bash
npm install
npm run dev
```

Visit `http://localhost:5173`. `/login` is standalone; everything else lives behind the shared dashboard shell at `/campaigns`.

## Folder structure

```
src/
├── components/
│   ├── layout/
│   │   ├── Sidebar.jsx        # single canonical sidebar (the HTML had 4 slightly different copies — deduped into one)
│   │   ├── MobileHeader.jsx   # mobile-only top bar
│   │   ├── DashboardLayout.jsx# wraps Sidebar + MobileHeader + Footer around every routed page via <Outlet/>
│   │   └── Footer.jsx
│   └── ui/
│       ├── Badge.jsx          # status/outcome pill (Paid, Failed, Completed, etc.)
│       ├── StatCard.jsx       # KPI card used on Summary / Live / Report pages
│       ├── Button.jsx         # primary / secondary / disabled / ghost variants
│       └── ProgressBar.jsx
├── data/
│   └── mockData.js            # stand-in for API calls — swap for real fetches later
├── pages/
│   ├── Login.jsx
│   ├── Campaigns.jsx          # landing page after login
│   ├── NewCampaign.jsx        # CSV upload + naming
│   ├── ReviewContacts.jsx     # select/deselect contacts
│   ├── CampaignSummary.jsx    # pre-call estimate screen
│   ├── LiveCampaign.jsx       # live monitoring dashboard
│   ├── CallLog.jsx            # core call log table (recording, status, feedback)
│   ├── CustomerDetail.jsx     # drill-down: recording player + transcript + notes
│   ├── CampaignReport.jsx     # final report + exports
│   ├── CallbackQueue.jsx      # "Call Later" worklist
│   ├── Settings.jsx           # Razorpay / messaging / calling rules
│   └── UserManagement.jsx     # admin-only team management
└── App.jsx                    # React Router routes
```

## What was cleaned up from the raw HTML

- The Stitch export included **four near-duplicate sidebars** (different icon sets, different active states, some referencing "MediCall SaaS" instead of "Auvia Collect"). These are now one `Sidebar.jsx`, driven by a single `NAV_ITEMS` array, with active state handled by React Router's `NavLink`.
- Repeated inline badge/table/stat-card markup was extracted into `Badge`, `StatCard`, and `Button` components.
- All pages now share one Tailwind config (`tailwind.config.js`) instead of each HTML file redeclaring its own (identical) color tokens.
- Added the three pages discussed earlier that weren't in the original Stitch batch: Callback Queue, Settings, User Management.

## Next steps to make it real

- Replace `src/data/mockData.js` with real API calls (React Query or plain fetch) once the backend endpoints exist.
- Wire up actual CSV parsing in `NewCampaign.jsx` and Razorpay link generation in `CustomerDetail.jsx`.
- Add auth guard around `DashboardLayout` once real login is in place.
