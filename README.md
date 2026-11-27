Odds Matrix Predictor v2.0
A static, mobile-first web app that gives a handicap pick — Home (2:0) or Away (0:2) — per fixture from a 14-input PCR (principal component regression) model trained on 26 Instant Football matches.
New in v2.0
Model changed from Ridge to PCR / SVD with 1 component. The 14 odds are standardised and compressed to their first principal component; goals are regressed on it and folded back into one equation on the raw odds (`goals = b + A·odds`, stored in `model.json`).
Headline output is now the handicap pick: Home (2:0) if predicted home goals ≥ away, otherwise Away (0:2).
Win chance: Poisson probability that the picked side does not lose by 2+.
History tracks handicap WON / LOST and the CSV export has the new columns. Old v1 records still show.
Back-test: 25/26 training, 18/18 new matches (43/44). Always-Home (2:0) won 41/44.
App icon fixed (icon.svg was empty).
New in v1.2
Team names are read by a dedicated reader: the "HOME vs AWAY" bar is cut out, enlarged and
cleaned (only the white letters are kept, crests removed). Tested on 15 screenshots from
3 matches, including low-res WhatsApp copies: 15 of 15 correct. One screenshot is enough.
New in v1.1
Read odds from a screenshot (OCR). Take one screenshot of the Instant Football page that shows
Home Team O/U and Away Team O/U, tap Read screenshot, and all 14 inputs and the team
names are filled in. Tested on three real matches: 14 of 14 correct on original screenshots,
0 wrong values. Locked cells are handled; damaged text is repaired and listed under
"CHECK THESE"; anything that cannot be read safely is left blank and listed under "NOT FOUND".
Offline mode fixed: the service worker was never registered (it waited for a page event that had
already happened).
Updates now reach the phone: app files are fetched fresh when online (network first).
History CSV download works on more phones; actual scores accept "2-1", "2:1" or "2 - 1".
Features
14 decimal-odds inputs grouped into Home Team O/U and Away Team O/U.
PCR (1 component) calculates predicted home and away goals.
Handicap pick and win chance (cautious; use for ranking).
Save predictions in browser-local history and enter actual scores for simple tracking.
Export saved history to CSV.
Progressive Web App (PWA) support and service-worker caching for offline use after first load.
No server, API key, database, or build step required.
Important model notes
The model has 14 features and two goal outputs.
Method: PCR via SVD, 1 component (57% of odds variation).
Training sample: 26 matches.
Model coefficients are stored in `model.json`; the browser computes the regression locally.
The Poisson layer assumes independent home and away goal counts.
Negative raw goal estimates are clipped to zero before calculating score probabilities.
This is an experimental model, not a calibrated or validated betting product. Its small training sample is a major limitation. Do not interpret the top score probability as a reliable real-world chance.
Run locally
Because the app loads `model.json`, use a local web server rather than opening `index.html` directly.
Python
```bash
python -m http.server 8000
```
Then open `http://localhost:8000`.
VS Code
Install/use the Live Server extension and open `index.html` with Live Server.
Publish with GitHub Pages
Create a new GitHub repository, for example `odds-matrix-predictor`.
Upload all files in this folder to the repository root:
`index.html`
`styles.css`
`app.js`
`ocr.js`
`model.json`
`manifest.webmanifest`
`sw.js`
`icon.svg`
`README.md`
In GitHub, open Settings → Pages.
Under Build and deployment, choose Deploy from a branch.
Select branch `main` and folder `/ (root)`, then save.
Wait for the Pages URL to appear. Open it in Chrome on Android.
Use Chrome's menu → Install app or Add to Home screen.
Updating the model later
Replace `model.json` with the newly fitted intercepts and coefficients. Keep the feature keys and their order consistent with the 14 input fields in `app.js` and the model schema. If the feature set changes, update the UI and app logic together.
Data and privacy
Predictions are stored in the browser's local storage on the device. Clearing browser site data removes that local history. No data is sent to a server.
Updating later
Upload changed files with Add file → Upload files on GitHub (do not paste long files on a
phone; the paste can be cut off). When you release a new version, change `CACHE` in `sw.js`
(currently `odds-matrix-v2.0`) so phones drop the old offline copy.
OCR tips
Use the original screenshot, not a WhatsApp copy (compressed copies lose digits).
Make sure the Away Team O/U 3.5 row is fully above the Next Round / Betslip bar.
The OCR engine (Tesseract.js) downloads from a CDN the first time, so it needs internet once.
