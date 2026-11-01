# CAV React Native Mobile App Plan

## Goal and scope

Build a native Android and iOS application for the existing CAV Photo Studio & Cafe website. This plan describes a separate React Native app; it does not implement it. The current frontend is React for the web with a Capacitor Android wrapper. React web components cannot be reused as native screens as-is, and the existing Capacitor `android/` directory must not be repurposed as a React Native project.

Use the Django REST API as the authoritative business and permission layer. Do not connect the app directly to the database or duplicate business rules in client code. Implement the app later in a new, isolated directory such as `mobile/` using TypeScript and Expo with development builds (or React Native Community CLI if native project customization requires it). Keep all current web, Capacitor, backend, dependency and database files unchanged unless a future implementation scope explicitly includes them.

## What exists in this repository

- **Web client:** React 19, React Router 7, Tailwind CSS 3, Axios, Recharts and Lucide React under `frontend/`. Main experiences include public landing/studio/cafe/gallery/story pages, booking guide, login, customer dashboard, staff dashboard, admin dashboard, machine-learning/forecasting page, privacy policy and booking feedback.
- **Native-related project today:** root npm scripts and an `android/` folder are for Capacitor 8, which packages the web build. They do not provide React Native screens or a React Native dependency setup.
- **Backend:** Django 5.2, Django REST Framework, Simple JWT and Django ORM. API routes are in `backend/config/urls.py`; view behavior and role checks live under `backend/apps/`.
- **Database:** configured by Django through `DATABASE_URL` (local and hosted PostgreSQL configurations are supported). Django models, migrations, serializers and view querysets are authoritative. `backend/docs/database_erd.md` is an overview, not a complete description of current fields and response shapes; some current inventory data is represented through `Product` and `InventoryEvent`. Build client types from current serializer/API behavior, not solely from the ERD.
- **Auth:** the browser API client uses HttpOnly JWT cookies and CSRF. `CookieJWTAuthentication` also accepts a Bearer access token. The login response removes access/refresh JWTs from JSON and sets cookies; refresh reads a cookie. This is not yet a complete native-app credential contract.
- **External services:** Google authentication, reCAPTCHA, admin SMS MFA, OTP flows, payment method/QR configuration, gallery/photo object storage (can use Supabase), and web push configuration are present. Do not embed service secrets or access the database/storage directly from the mobile app.

## Existing features and authorization

Application roles on `users.CustomUser` are `CUSTOMER`, `STAFF`, and `ADMIN`. The API must enforce every permission. Hiding a screen or button is only a user-experience measure. `IsStaffOrAdmin` requires staff to have `StaffAccessProfile.on_duty = true`; admins bypass the duty check. Handle `401`, `403` (including off-duty), `404`, validation errors, `429` throttling and server/network failures throughout the client.

| Audience | Existing website capabilities for the mobile client |
|---|---|
| Guest | Landing, studio, cafe, gallery and story content; booking guide; services/packages; public product catalog reads; public FAQ/chatbot; public reviews/feedback survey; privacy policy; sign in and registration. |
| Customer | Registration/OTP, sign in/Google sign in, profile/password/photo, privacy consent and rights requests/export; service/package browsing; availability and own booking creation/history/update/cancellation; payment instructions, reference and receipt submission; notifications; delivered customer photo list/download; review/feedback; chatbot. |
| Staff | Booking queue/status and walk-in bookings; booking payment verification; POS orders/payments/returns/stock actions; inventory and stock movements; ingredients/recipes/catalog/categories/suppliers/purchase orders; product-sales views; dashboard analytics and forecasting. Protected staff actions require on-duty status. The web receipt flow uses browser/local printing behavior; native receipt printing/sharing needs a separately designed mobile path. |
| Admin | Staff/user administration and duty toggles; all staff functions; studio unavailable dates; dashboard analytics; end-of-day report summary/create/list/detail/reprint/printed status; gallery and customer-photo management; FAQ management; privacy request administration; notification delivery inspection; audit/runtime logs; forecasting and history import; system data reset. Admin login can require SMS MFA. Keep sensitive actions (especially system reset, data export and user/staff management) behind clear detail and confirmation flows. |

## API and data domains

Base all requests on the selected environment's API URL. Keep the trailing slashes, existing request methods, multipart behavior, query parameters, pagination and serializer response shapes. Do not assume every list response is a bare array.

| Domain | Current endpoints and main records | Client responsibilities |
|---|---|---|
| Health/auth/profile | `GET /health/`; `/api/auth/login/`, `/login/mfa/resend/`, `/csrf/`, `/token/refresh/`, `/logout/`, `/register/`, `/register/verify/`, `/register/resend/`, `/google/`, `/profile/`, `/forgot-password/`, `/forgot-password/verify/`, `/forgot-password/confirm/`; `CustomUser`, `Customer`, `StaffAccessProfile`, `PasswordResetOTP` | Login and MFA/OTP/recovery, profile restoration, password/photo update, secure session handling. Admin user endpoints `/api/auth/users/` and `/api/auth/users/<id>/`. Staff duty self-check `/api/auth/staff-access/me/`; admin duty list/update `/api/auth/staff-access/` and `/<id>/`. |
| Services and bookings | `/api/bookings/services/`, `/packages/`, `/availability/`, `/studio-unavailable-dates/`, `/studio-unavailable-dates/<id>/`, `/`, `/walk-in/`, `/<id>/`, `/reviews/`, `/reviews/all/`, `/reviews/survey/`; models `Service`, `Package`, `Booking`, `BookingReview`, `StudioUnavailableDate` | Browse service/package data, check availability, create and manage customer bookings, staff queue/walk-in actions, admin unavailable dates, feedback/reviews. Honor ownership, permitted status changes and server availability rules. |
| Booking payment | `/api/bookings/payment-methods/`, `/payments/`, `/payments/<id>/receipt/`, `/payments/reference-check/`, `/payments/<id>/verify/`; `Payment` | Show configured methods/QR details, submit references and receipt (multipart), check reference duplication, and provide staff verification queue. Current method choices include Cash, GCash, Maya and MariBank; states include Pending, Pending Verification, Approved, Rejected and Paid. |
| Cafe inventory | `/api/inventory/products/`, `/products/<id>/`, `/ingredients/`, `/ingredients/<id>/`, `/movements/`, `/ingredient-movements/`, `/product-sales/`, `/product-sales/transactions/`, `/recipes/`, `/recipes/generate/`, `/categories/`, `/categories/<id>/`, `/suppliers/`, `/suppliers/<id>/`, `/purchase-orders/`, `/purchase-orders/<id>/`; models include `Product` and `InventoryEvent` | Public product read behavior is available through product list; inventory detail and mutations are staff/admin. Respect active state, product-vs-ingredient type, stock/threshold, base units, expiry/status, purchase-order and movement semantics. Use serializer values for status rather than deriving authoritative inventory state on-device. |
| POS and end of day | `/api/pos/orders/`, `/orders/<id>/`, `/orders/<id>/returns/`, `/stock-actions/`, `/payments/`, `/end-of-day-summary/`, `/end-of-day-reports/`, `/end-of-day-reports/<id>/`, `/reprint/`, `/mark-printed/`; models `Order`, `POSStockAction`, `Payment` | Staff checkout/order detail, order return, refund/wastage stock actions, and admin EOD workflows. Honor `Idempotency-Key`/`X-Idempotency-Key` where existing flows use them. Display PHP (`₱`) and use backend-computed totals. |
| Analytics/forecasting | `/api/dashboard/analytics/`, `/api/forecasting/predictions/`, `/api/forecasting/history/import/`, `/api/forecasting/ml/`; models `SalesHistoryImport`, `SalesHistoryRecord`, `ForecastRun`, and prediction records | Staff/admin analytics and forecasts. Preserve warnings about synthetic training data and model limitations. Avoid squeezing desktop tables onto phones; use cards and drill-downs. |
| Gallery/chatbot | `/api/gallery/images/`, `/api/gallery/images/<id>/`, `/api/gallery/customer-photos/`, `/api/gallery/customer-photos/<id>/download/`; `/api/chatbot/query/`, `/api/chatbot/faqs/`, `/api/chatbot/faqs/<id>/` | Public gallery/chat and FAQ reads, customer photo retrieval, admin gallery/FAQ management. Respect photo ownership and any server-generated download URL/authorization behavior. |
| Notifications/privacy/audit | `/api/notifications/`, `/read-all/`, `/<id>/read/`, `/push/config/`, `/push/subscription/`, `/deliveries/`; `/api/privacy/consents/`, `/requests/`, `/requests/admin/`, `/requests/admin/<id>/`, `/export/`; `/api/audit/logs/`, `/client-runtime-errors/` | Customer inbox and privacy workflows; admin delivery/privacy/audit workflows. Treat the current push subscription as browser web-push until a native device token API is agreed. Redact credentials and personal content from diagnostics. |

Important current model concepts include users and customer profiles; services/packages/bookings/reviews/unavailable dates; payments; products/categories/suppliers/inventory events/purchase orders; orders and POS stock actions; sales/forecast imports and runs; chatbot FAQ/logs; gallery/customer photos; notifications/delivery records; privacy consent/requests; and audit logs. The mobile client must not become an alternate system of record.

## Backend gaps and future changes to scope (not implement now)

1. **Native authentication contract.** The backend's current browser login returns no JWT in JSON, while `Authorization: Bearer` works for authentication. Establish a native login/session contract before protecting screens are built. Prefer short-lived access credentials plus a rotating, revocable refresh credential, delivered only to the native app and stored using iOS Keychain/Android Keystore through a maintained secure-storage module. Define refresh, logout/revocation, concurrent requests, session restore, token theft response and account password-change behavior. Do not store long-lived credentials in AsyncStorage or logs. Alternatively, explicitly validate a secure native cookie-jar strategy; the browser CSRF/cookie assumptions do not automatically work in React Native.
2. **Admin MFA and CAPTCHA.** Admin login can produce `mfa_required`; resend and code verification use the existing login endpoints. Registration and password recovery also use OTP. Define app-compatible reCAPTCHA/risk verification, Google credential audiences for iOS and Android, resend throttles, expiry and error contracts without bypassing current security checks.
3. **Native push API.** `/api/notifications/push/config/` and `/push/subscription/` are web-push oriented. Add a reviewed APNs/FCM device registration contract with platform/environment, per-device revocation and deep-link payloads before advertising native push. Specify token rotation and logout cleanup.
4. **Customer cafe checkout.** The existing public product listing does not represent a customer cart/order checkout; POS endpoints are staff-only. Confirm if customer-facing cafe ordering is a product requirement. If yes, design customer order/cart/payment APIs and permission rules before adding checkout UI.
5. **Mobile operational gaps.** Confirm requirements and API support for native receipts/printing, deep links, upload constraints, device/session management, app-wide configuration, offline availability and booking reminders. Do not claim offline writes without a server reconciliation/idempotency design.
6. **Contract documentation.** Publish stable API examples/schema, pagination, enum and error shapes, timezone rules, upload constraints, idempotency semantics, production/staging origins and expected media URL behavior. Validate each against current serializers and view querysets before generating TypeScript types.

All changes above are proposals for later backend design and implementation. No API, database, auth or service changes are part of this plan file.

## Recommended React Native architecture

### Project layout

Create the app in a new independent `mobile/` directory, with its own `package.json`, lockfile, TypeScript configuration, Expo config and app source. Prefer Expo with a development build rather than Expo Go if native push, secure storage, social login or other native modules are needed. Choose React Native Community CLI instead only if required native customizations cannot be supported appropriately through Expo. Do not place it under `frontend/` or modify the existing Capacitor project.

```text
mobile/
  app/                         # Expo Router routes/layouts and deep links
    (public)/                  # landing, studio, cafe, gallery, guide, login
    (customer)/                # book, bookings, photos, inbox, profile
    (staff)/                   # POS, bookings, payments, inventory, sales
    (admin)/                   # analytics, staff, EOD, audit, privacy, settings
  src/
    api/                       # typed client, auth transport, errors, interceptors
    features/                  # feature modules: auth, booking, POS, inventory, ...
    components/                # shared native UI components
    hooks/                     # reusable hooks
    navigation/                # shared route guards/deep-link configuration if needed
    state/                     # session and app-level state only
    theme/                     # palette, typography, spacing, components
    types/                     # shared API/domain types
    utils/                     # formatters, validation, redaction
  assets/                      # approved logo, fonts, selected image assets
  __tests__/                   # unit/component tests
  e2e/                         # optional device-level critical journeys
  app.json                     # native metadata/config for Expo
```

Use feature boundaries: screens render native UI; hooks/controllers orchestrate interactions; repositories map API payloads; the shared API client owns environment URL, credentials, timeout, retry rules and safe logging. Keep API DTOs distinct from view models where server fields are irregular. Centralize role-aware navigation, PHP/date formatting, enum/status labels, field validation, idempotency and permission/error handling. Use server responses as final truth.

### Dependencies to evaluate when implementation starts

Choose versions that are mutually compatible with the selected React Native/Expo SDK, then install and lock them in the new app only. Do not install anything for this planning task.

- TypeScript and Expo SDK / React Native; `expo-router` for file-based navigation and deep links.
- `@tanstack/react-query` for server-state loading, cache invalidation and mutations; keep session/ephemeral UI state separate, using React Context or a small state library only if needed.
- `@tanstack/query` plus `fetch` or `axios` for REST requests (choose one HTTP stack); add a typed runtime schema validator such as Zod for untrusted API boundaries if the response complexity warrants it.
- `expo-secure-store` for mobile credentials once the native auth contract is approved; never use plain AsyncStorage for refresh secrets.
- `expo-image` or `expo-image-picker` for remote imagery and native receipt/profile selection; verify upload format, file size and platform permissions against backend behavior.
- `expo-notifications` and/or a compatible FCM/APNs package only after the backend native push contract exists.
- `react-native-svg` and a maintained chart library only if native chart requirements justify them; charts are secondary to readable analytics cards.
- `jest-expo`, React Native Testing Library and `msw` (or an equivalent API mock) for unit/component/network contract testing. Add Maestro or another device E2E tool only if release risk/CI justifies it.

Avoid adding a UI kit before the CAV design tokens/components are defined. Avoid reusing `lucide-react` (web SVG/DOM library); select a native-compatible icon source if needed. Do not add web-only Tailwind or Recharts directly to React Native; NativeWind or another styling layer is optional and should be selected deliberately.

## Mobile UI requirements

- Match the existing CAV identity: espresso `#2E1A11` (light `#5D4037`, dark `#1C0F0A`), gold `#D4AF37` (light `#F3E5AB`, dark `#AA7C11`), cream `#FDFBF7` / `#F5ECE1`, charcoal `#2A2A2A`, DM Sans, CAV logo and warm studio/cafe/package photography from `frontend/public/assets/` where approved. Preserve descriptive alt/accessible labels and appropriate crop positions. Bundle only a selected lightweight subset of brand imagery; fetch mutable gallery images from API URLs.
- Use safe areas, platform-consistent back navigation, keyboard-aware forms, accessible touch targets, dynamic font scaling, screen reader labels, high contrast, clear focus/state indication and small-phone/tablet layouts.
- Public navigation should surface studio, cafe, gallery, story/booking guide, services/packages, booking and sign-in. Use image-led, vertically scrolling layouts and a clear primary action in place of desktop nav bars.
- Customer bottom navigation should prioritize Book, Bookings, Photos, Inbox and Profile; keep chatbot readily available. Booking should be a guided flow: service/package → available date/time → details → review/consent → payment instructions/reference/receipt → confirmation and status. Confirm before cancellation; prevent duplicate posts.
- Staff home should prioritize fast operational work: POS, bookings, payment review, inventory and catalog/sales. Use large controls, scan-friendly queue/status cards, search/filter, itemized checkout and server-returned totals. Clearly communicate the off-duty denial and how to resolve it.
- Admin sections should expose analytics, bookings, staff access, EOD, inventory/POS oversight, gallery/FAQ, privacy/audit and forecasts according to role. Convert wide data tables into filterable summaries and drill-down cards. Put destructive/high-impact actions behind an explicit review/confirmation.
- Every API screen needs useful loading, empty, stale-data, retry, success and error states. Support pull-to-refresh where appropriate; clearly indicate when data is stale. Do not treat a cached user role as proof of current authorization.
- Use currency and date/time formatting consistent with backend values and business timezone; do not silently reinterpret UTC timestamps. Optimize image sizes and avoid eager loading large gallery collections.
- Do not introduce offline POS/booking submissions until idempotency and conflict/reconciliation behavior are defined. Native push or receipt printing must not be implied until the backend/platform implementation is agreed.

## Phased implementation

### Phase 0 — API and platform decisions

- Agree on native auth, admin MFA/CAPTCHA, Google sign-in, push, cafe checkout scope, API host environments and supported OS versions.
- Verify representative payloads/permissions for public/customer/staff/admin calls; inspect serializers, filters/pagination, upload, timezone and idempotency behavior against a staging API.
- Decide Expo development build vs Community CLI, app IDs, signing ownership, distribution and privacy disclosure requirements.
- Exit criteria: an approved API/auth contract, role matrix, screen scope and release target.

### Phase 1 — app foundation and public experience

- Scaffold an isolated TypeScript app, define theme/assets/components, routing, API environment configuration, safe diagnostics and error boundaries. Add mocked API fixtures and test harness.
- Build public landing/studio/cafe/gallery/guide/package browsing and login/registration UI. Keep mutable content API-backed and stable imagery curated.
- Exit criteria: public pages work on Android and iOS devices with accessibility and responsive layout.

### Phase 2 — secure auth and customer journey

- Implement native session lifecycle after backend contract agreement: login, refresh, expiry, logout, MFA/OTP, password recovery, Google sign-in and profile. Then booking, availability, payment instructions/receipt upload, booking history/update/cancellation, notification inbox, photo delivery, reviews, chatbot and privacy.
- Exit criteria: customer can complete a booking and handle denied access, validation, network failures, duplicate submission, expired credentials and payment verification outcomes.

### Phase 3 — staff workflows

- Implement on-duty status, booking queue and walk-in creation, payment review, POS checkout, order details, inventory movements, stock/product/ingredient views, suppliers and purchase orders. Add returns/wastage and native receipt handling only with tested server/platform semantics.
- Exit criteria: off-duty users are rejected by backend and shown clear UX; POS mutations use server totals and existing idempotency behavior.

### Phase 4 — admin and insight features

- Add staff/user and duty management, admin analytics, EOD, privacy/audit queues, gallery/FAQ management and forecasting/import. Preserve prediction limitations and permission boundaries.
- Exit criteria: staff cannot access admin APIs, destructive actions require review, and role errors are handled without exposing protected data.

### Phase 5 — hardening and release

- Complete device/accessibility/performance/security testing, app-store metadata and privacy disclosures, signed builds, staged rollout and support/diagnostics workflow.
- Exit criteria: signed Android/iOS releases use production configuration and complete approved critical journeys with no test credentials or secrets in the bundle.

## Testing strategy for future implementation

These tests belong to future React Native implementation; this plan-only task does not add or run them.

- **Unit:** API type/transform validation, role routing, status labels, date/time and PHP currency formatting, form validators, idempotency creation and auth refresh concurrency/expiry behavior.
- **API/repository contract:** mock public/customer/staff/admin payloads; list pagination/filtering; multipart uploads; empty and malformed payloads; timeouts; `401` refresh/revoke; `403` off-duty/role; `404`; validation `400`; throttling `429`; server failures and safe error redaction.
- **Component/screen:** login, OTP/MFA, booking steps, receipt picker/upload, status cards, POS totals, confirmation dialogs, large text, screen-reader semantics, loading/empty/error/retry states and role-specific navigation.
- **Integration:** guest browse; customer register/login, create booking, submit receipt and see history/photos; staff verify payment and perform an idempotent POS transaction; admin toggle staff duty and view EOD/analytics. Test a forbidden request for each protected role boundary.
- **Device/release:** multiple Android/iOS screen sizes and OS versions; background/resume; slow/no network; safe-area and keyboard; camera/photo permission denied; upload limits; deep links; push once available; app upgrade; signed build installation; API TLS and production config.
- Use synthetic/staging data and dedicated non-production identities. Do not use production data or destructive reset flows in integration tests.

## Android and iOS build instructions (future app)

These are future commands after implementation creates `mobile/`. They are not run as part of creating this plan. Install a compatible Node LTS, package manager, Expo tooling, Android Studio/SDK, and Xcode (macOS required for iOS local builds); verify the environment using the selected Expo/React Native workflow. From the new app:

```sh
cd mobile
npm install
npx expo-doctor
npx expo start
```

Use an Expo development build for native modules that Expo Go does not include. Configure the staging or production API URL as a public environment value/build setting; an API base URL is not a secret, while signing credentials, service keys and private tokens are. Use HTTPS in release and account for device/emulator networking differences from host `localhost`.

**Android:** configure the final Android application ID, app name/icon, supported SDK levels, permissions and release signing in the new app's Expo/native config. Test on an emulator and physical device. With EAS Build, configure the Android profile and signing credentials, then create a release bundle using the project's chosen EAS CLI workflow (typically `eas build --platform android --profile production`). For a local prebuilt native project, use Gradle release bundle task generated by Expo prebuild/React Native. Keep keystores/passwords out of version control; distribute the `.aab` through the selected Play Console workflow.

**iOS:** configure the bundle identifier, app icons, signing team/provisioning, permission usage descriptions and APNs capability only when push is implemented. Test in simulator and on a physical iPhone. Local iOS compilation/archive requires macOS/Xcode; on Windows use an approved macOS EAS build runner. Build the release through the chosen EAS profile (typically `eas build --platform ios --profile production`) and distribute with TestFlight/App Store after privacy and permission review.

Because Expo/EAS and React Native tooling evolve, choose compatible commands and profiles at implementation time. Commit only app-owned configuration in the new mobile project and do not alter root workspace scripts or existing package manifests unless a later, separately authorized integration requires it.

## Change boundary

This request creates only `REACT_NATIVE_APP_PLAN.md`. No React Native source, dependencies, lockfiles, environment configuration, backend/API/auth changes, database changes, Capacitor changes or existing website behavior are part of this work.
