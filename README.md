# ADMIT-Lipa

Web-based admissions CRM for the Admissions Office of STI College Lipa. It turns Messenger-style admissions conversations into numbered tickets on a service clock, tracks requirement compliance per applicant, screens for government subsidies, and logs every access to personal data.

## Status

- All 14 use cases (UC1 to UC14) from the System Concept Proposal work end to end in the development build.
- `npm test` runs 52 acceptance checks against the running server, covering FR-01 to FR-14, NFR-02, NFR-03 and basic security. Last run: 52/52 passed on 2026-10-28.
- It has not been deployed to a public URL yet.

## Roles and entry points

| Path | Who | Use case |
| --- | --- | --- |
| `/` | Everyone | Landing page with the background video |
| `/ask` | Everyone | UC1 Submit Online Inquiry, UC8 consent |
| `/track` | Everyone | Ticket status by ticket number and email |
| `/apply` | New applicant | UC2 Register Applicant Profile, UC4 screening, UC8 consent |
| `/me` | Applicant | UC3, UC5 View Application Status, own data export |
| `/staff/tickets` | Officer, Admin | UC6 service clock, UC13 Assign and Resolve |
| `/staff/applicants` | Officer, Registrar, Cashier, Fin. Aid, Admin | UC3, UC9, UC10, UC11, UC12 (asks for a purpose of access) |
| `/staff/aid` | Fin. Aid, Admin | UC11 coordinator queue |
| `/staff/escalations` | Admin | UC14 Escalate Overdue Ticket |
| `/staff/analytics` | Admin | UC7 analytics, CSV export, print |
| `/staff/audit` | DPO, Admin | UC12 Audit Personal Data Access, CSV export |
| `/staff/users` | Admin | Staff accounts, holiday calendar for the working-day clock |
| `/setup` | First visit only | Creates the first School Administrator |

The JSON API lives under `/api/*`. Every write needs the `x-admit: 1` header, which blocks cross-site form posts.

## Data

Cloudflare D1, schema in `migrations/0001_init.sql`.

- `users`, `sessions`, `login_attempts`: PBKDF2-SHA-256 password hashes. Session tokens are stored only as SHA-256 hashes. Login locks for 15 minutes after 5 failed attempts.
- `applicants`: date of birth, mobile, address and aid answers are stored AES-256-GCM encrypted in `enc`. Duplicate detection uses an HMAC blind index (`dedup_key`).
- `tickets`, `requirements`, `requirement_types`, `payments`, `notices`, `aid_cases`, `consents`, `audit_log`, `holidays`, `meta`.
- Overdue escalation and deficiency notices run lazily on staff requests, at most once every 5 minutes. No cron triggers are used, so hosted deploy works.

Subsidy rules are in `src/lib/eligibility.ts`, and every result carries its source link. The rules were checked on 2026-10-28 against unifast.gov.ph/tes.html and depedroxi.ph/voucher-program/. The SHS Voucher amounts come from guidelines first published for SY 2016-2017, so confirm them on OVAP before each admission cycle.

## Background video

- File: `public/static/station-fall.mp4`. Source render: `media/station_fall_720p30.mp4`.
- Rebuild it with `npm run video` (Python, NumPy, ffmpeg). Rendering is deterministic and seeded.
- Measured specs: 1280x720, 30 fps, 12.0 s seamless loop (28 beats at 140 BPM), H.264, 6.3 MB.
- The dominant brightness rhythm measures 140.0 BPM. The largest frame-to-frame luma change is 1.56 of 255, so the video stays far below the WCAG 2.3.1 flash threshold. The loop seam differs by 0.16 luma.
- It does not autoplay under `prefers-reduced-motion`, and there is a Pause / Play button.

## Figma

The team file has one 1921x1080 "Landing Page" frame with fill `#FFF5C3`. The landing page uses that fill as its light-mode canvas.

`design/figma/` holds 34 screenshots captured from the running build: 13 screens, desktop at 1920x1080 and mobile at 390x844, with light and dark versions of the public pages. You can bring them into Figma two ways:

- Drag the PNGs onto the canvas.
- Run the html.to.design plugin on the deployed URL to get editable layers.

## Progress report

- `report/ADMIT-Lipa_Progress_Report.docx` and `.pdf`: 9 pages, Times New Roman 12, APA references.
- Rebuild with `python3 report/build_report.py`.
- The groupmates' contribution rows are left blank on purpose. Each member fills in and confirms his own row.

## Development

```bash
npm ci
echo "ENC_KEY=$(head -c 32 /dev/urandom | base64)" > .dev.vars
npm run build
npm run db:migrate:local
pm2 start ecosystem.config.cjs
npm test                      # needs a fresh DB: npm run db:reset, then restart
node tests/seed-demo.mjs      # demo data; password demo-password-2026
```

Production needs a real D1 `database_id` in `wrangler.jsonc` and the secret `ENC_KEY`. The key must be 32 random bytes, base64. If it is lost, encrypted profiles cannot be read.

## Not yet done

- NFR-01 load test (50 sessions)
- NFR-04 retention period (waits on the campus privacy notice)
- NFR-06 restore drill
- Email delivery of notices
- Public deployment

Stack: Hono 4, Cloudflare Pages + D1, Vite, plain JavaScript front end, IBM Plex.
