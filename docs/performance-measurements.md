# CAV performance measurements

## Method

- Built the frontend in production mode before and after the performance changes.
- Measured `/customer`, `/staff` (POS), and `/admin` using Lighthouse 13.6.0 and Chrome.
- Ran each route three times with a cold browser cache. Lighthouse was configured for a 390 × 844 mobile viewport, 150 ms network RTT, 1.6 Mbps download, and 4× CPU slowdown. Each row below reports the median.
- Used the same seeded Customer, Staff, and Admin accounts and the same isolated SQLite data for both builds. The frontend was served with gzip and the same cache-header rules configured for Render: hashed assets immutable, HTML revalidated, and private API responses excluded from shared caches.
- JavaScript size is the sum of transferred script bytes. Total bytes are Lighthouse’s `total-byte-weight` measurement.

These are local production-build measurements against an isolated local Django backend. Measurements on the deployed production host are unverified.

## Customer booking page — `/customer`

| Metric | Before median | After median | Change |
|---|---:|---:|---:|
| Lighthouse performance | 53/100 | 66/100 | +13 |
| LCP | 7.55 s | 5.65 s | −1.91 s |
| CLS | 0 | 0 | no change |
| Total Blocking Time | 466 ms | 171 ms | −295 ms |
| JavaScript transferred | 150.8 KiB | 150.9 KiB | +0.2 KiB |
| Total bytes transferred | 733.2 KiB | 299.2 KiB | −434.0 KiB (−59.2%) |

Run scores were 56, 53, 52 before and 62, 66, 67 after. The waterfall showed the event and birthday booking images taking 3.81 s / 309.8 KiB and 2.88 s / 168.1 KiB before. The final build requests 480w WebP variants at 25.7 KiB and 18.3 KiB. The 4:3 booking-card containers reserve their image space; the first service image is eager/high-priority and remaining service images are lazy-loaded. Google Fonts is discovered from the document head and both font hosts are preconnected.

## Staff POS — `/staff`

| Metric | Before median | After median | Change |
|---|---:|---:|---:|
| Lighthouse performance | 67/100 | 67/100 | no change |
| LCP | 6.33 s | 6.14 s | −0.20 s |
| CLS | 0 | 0 | no change |
| Total Blocking Time | 142 ms | 203 ms | +61 ms |
| JavaScript transferred | 162.5 KiB | 162.8 KiB | +0.3 KiB |
| Total bytes transferred | 341.2 KiB | 296.3 KiB | −44.9 KiB (−13.2%) |

Run scores were 64, 68, 67 before and 58, 68, 67 after. The first after run was slower than the other two; the median score stayed level. The waterfall showed two Unsplash product images at about 38 KiB and 33.5 KiB before. The POS now requests responsive 240/400/640 px candidates with negotiated modern image formats; the representative 240w responses were about 13.5 KiB and 12.7 KiB. Product cards reserve a fixed image height, and cards beyond the first row lazy-load.

The measured TBT increased by 61 ms while LCP improved by 195 ms and total transfer fell by 13.2%; that small TBT regression is retained in the comparison.

## Admin dashboard — `/admin`

| Metric | Before median | After median | Change |
|---|---:|---:|---:|
| Lighthouse performance | 35/100 | 64/100 | +29 |
| LCP | 6.30 s | 5.49 s | −0.81 s |
| CLS | 0 | 0 | no change |
| Total Blocking Time | 6,298 ms | 282 ms | −6,016 ms |
| JavaScript transferred | 294.8 KiB | 177.4 KiB | −117.4 KiB (−39.8%) |
| Total bytes transferred | 683.1 KiB | 255.8 KiB | −427.3 KiB (−62.5%) |

Run scores were 35, 34, 35 before and 61, 64, 64 after. Before, the initial waterfall included `/api/forecasting/predictions/` (292.1 KiB, about 2.45 s) and a 106.5 KiB chart chunk. Lighthouse’s trace attributed a 4.80 s long task to the chart chunk and about 5.66 s of script evaluation to the main bundle. Forecast data now loads when its section approaches the viewport, and Recharts loads when a chart is visible. The chart containers keep their height while the optional module loads.

On a separate scroll check, no forecast request occurred before scrolling; after the forecast section came into view, its API returned 200 and a Recharts SVG rendered. No browser page errors were recorded.

## Booking interaction

Measured the interval from selecting the same available date to the available-slot list becoming ready, with the same mobile viewport, network, CPU, and isolated data:

| Before | Final after | Result |
|---:|---:|---|
| 363 ms | 332 ms | 31 ms faster |

The date availability request returned 200 and the time selector rendered nine options on both checks. The date was November 3, 2026. Its calendar count changed from five to four available starts as the local time advanced; no booking record was created during this interaction measurement.

## Workflow checks and limitations

- Production build completed. It retains a non-blocking ESLint warning in `BookingReceipt.jsx` about the existing `printingEnabled` hook dependency.
- Frontend AuthContext, LoginPage, CustomerDashboard, and AdminDashboard suites passed. Focused Staff POS checkout/refund and payment-proof approval/rejection tests passed on the final source.
- Backend user, booking, booking-workflow, POS, and payment suites passed: 124 tests, 1 skipped; Django system checks were clean.
- One Staff layout test fails when run alone: `Bookings keeps its viewport-sized table region and page controls in place while loading` expects a `Loading bookings` heading after booking data has already rendered. It failed in the full run and when rerun alone. The performance changes did not modify the booking panel; this test discrepancy remains unresolved.
- The browser checks used isolated local test accounts and data. Login, booking, payment, and POS behavior on the deployed production service is unverified; no production account or production data was used.
