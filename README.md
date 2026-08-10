# Material World Room Visualiser (Lead tool)

A marketing lead tool. Flow:
1. Reads the customer's room photo (window, colours, light, style).
2. Recommends and renders 4 Material World fabrics onto their actual window.
3. Customer selects the fabrics they like and orders free swatches (the lead).

Standalone front-end + a small backend. No key in the browser. Does not touch the live site.

## Run locally
    npm install
    npm run dev                 # UI only (analyse/render need the server + key)
    # full flow:
    npm run build
    GEMINI_API_KEY=your_key npm start      # http://localhost:4173

## Deploy to Railway
1. Push this folder to a GitHub repo.
2. Railway: New Project > Deploy from GitHub repo.
   Build: npm run build   Start: npm start
3. Variables: add GEMINI_API_KEY (Google AI Studio).
4. Networking > Generate Domain for a shareable URL.

## What the backend does
- POST /api/analyse : sends the room photo to Gemini, returns room style, palette,
  and 4 fabric picks chosen from the catalogue.
- POST /api/render  : renders one fabric onto the window with Nano Banana Pro,
  keeping foreground objects (plants, sill) in front. Called 4x, results stream in.
- Models are set at the top of server.js (TEXT_MODEL, IMAGE_MODEL) and overridable
  via Railway variables if Google renames them.

## Using the live product feed (fabric images)
- Replace the FABRICS array in src/App.jsx with fabrics parsed from the feed.
- Pass each fabric's real image URL to /api/render as `fabricUrl` instead of the
  client swatch. The server caches every fabric image after the FIRST fetch
  (getFabricImage in server.js), so the live site is read once per fabric, ever.
  After that, all renders use the cached copy. Near-zero load on their store.
- Send me the feed URL and this gets wired in.

## Cost / latency
- 4 renders per run, a few cents each on Gemini. Add output caching (same room +
  fabric = reuse) before public traffic. Renders take a few seconds each and
  appear as they finish.

## Embedding in Magento (later)
An iframe (or script) pointing at this deployed URL, inside a Magento CMS block.
