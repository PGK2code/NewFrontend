# ครัวเก้าแว่น Frontend

Angular frontend for the Lunch Delivery API. The source is grouped by page (`src/app/pages`), shared API calls (`src/app/services`), shared response types (`src/app/models`), and API configuration (`src/environments`).

## Start locally

1. Start the API from the repository root with `npm run dev` (default: `http://localhost:3000`).
2. In this folder, run `npm install` once, then `npm start`.
3. Open the Angular URL printed by the CLI (usually `http://localhost:4200`).

Change `src/environments/environment.ts` if the API runs at another URL. The API already enables CORS. The map uses Leaflet and OpenStreetMap tiles loaded from their public CDN, so map tiles require an internet connection. Customer coordinates can also be entered directly, or filled from the browser location prompt.

Order creation uses `POST /orders`; quantity controls use `PUT /orders/:id/quantity` and honor the API's one-to-three box limit. The simulation actions use `POST /orders/simulate` and `DELETE /orders/simulated`.
