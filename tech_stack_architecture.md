# Proposed Tech Stack & System Architecture

Recommendation for capstone project: React + Tailwind CSS + Django + Django REST Framework

> **Recommendation:** React + Tailwind CSS + Django + Django REST Framework + SQLite (development) + Supabase PostgreSQL (production) is an excellent choice for this capstone. Node.js and Express are removed from the stack since they add complexity without meaningful benefit here. Vite is also excluded from the frontend build setup. The website must be well-designed and follow standard UI/UX practices (consistent spacing, typography, color hierarchy, accessibility, and responsiveness) since visual quality directly affects usability and the overall impression during the capstone defense.

## Recommended Stack

### Frontend
- React
- Tailwind CSS
- React Router
- Axios

### Backend
- Django
- Django REST Framework
- JWT Authentication
- Django ORM

### Database
- SQLite (Development)
- Supabase PostgreSQL (Production)

### AI
- OpenRouter / OpenAI API
- RAG (optional, for better chatbot responses)

### Machine Learning
- Pandas
- NumPy
- scikit-learn
- Prophet (or XGBoost)

### Deployment
- Frontend → Vercel
- Backend → Railway
- Database → Supabase PostgreSQL

## High-Level System Architecture

```
Customers
   │
   ▼
React + Tailwind CSS UI
Landing | Login | Dashboard
   │  REST API (HTTPS)
   ▼
Django REST API
├── Authentication      ├── Sales
├── Booking             ├── Forecasting
├── POS                 ├── AI Chatbot
└── Inventory           └── Reports
   │            │              │
   ▼            ▼              ▼
SQLite/      ML Prediction   LLM API
Supabase     Engine          (OpenRouter)
(Database)   (scikit-learn/
             Prophet)
```

## User Flow

```
Landing Page
     │
     ▼
   Login
     │
  ┌──┴──┐
  ▼     ▼
Customer  Staff / Admin
```

**Impact of the Landing Page:** The landing page is the first thing users see, so it carries a high impact on first impressions, perceived professionalism, and trust in the system. It should clearly communicate what CAV Photo Studio and Café offers (studio sessions, packages, café products), be visually polished and on-brand, load quickly, and guide users intuitively toward booking or logging in. A weak or cluttered landing page can discourage engagement even if the rest of the system works well, so it deserves the same design attention as the core booking and dashboard modules.

## Module Breakdown

### Customer Module
- Profile
- Book a Session
- Booking History
- AI Chatbot
- Packages
- Notifications

### Staff Module
- Point of Sale
- Inventory
- Orders
- Booking Validation
- Daily Sales
- Receipt Printing

### Admin Module
- Analytics
- Sales Reports
- Inventory
- Booking Management
- Staff Management
- Machine Learning
  - Sales Forecast
  - Demand Forecast
  - Trending Products
  - Reorder Suggestions
  - Prediction Graphs
- AI Chatbot Management
- System Settings

## Machine Learning Workflow

```
Sales Data → Data Cleaning → Feature Engineering → Train Model → Predict → Dashboard
```

Predictions include: tomorrow's sales, weekly sales, monthly sales, product demand, estimated stock depletion, and reorder recommendations.

## AI Chatbot Workflow

```
Customer Question → React Chat UI → Django Chat API → Knowledge Base → OpenRouter → Response
```

The chatbot can answer questions about: operating hours, available packages, booking process, pricing, promotions, and frequently asked questions.

## Recommended Directory Structure

### Frontend (React)

| Path | Purpose |
|------|---------|
| `src/api/` | auth.js, booking.js, chatbot.js, inventory.js, pos.js, sales.js, forecast.js |
| `src/assets/` | Static assets |
| `src/components/` | common, booking, chatbot, inventory, pos, dashboard |
| `src/layouts/` | Shared page layouts |
| `src/pages/` | Landing, Login, Customer, Staff, Admin |
| `src/routes/` | Routing configuration |
| `src/context/` | React context providers |
| `src/hooks/` | Custom hooks |
| `src/utils/` | Utility functions |
| `src/services/` | Service layer |
| `src/App.jsx` | Root component |

### Backend (Django)

| Path | Purpose |
|------|---------|
| `config/` | Project configuration |
| `apps/` | authentication, users, booking, inventory, pos, sales, forecasting, chatbot, reports, dashboard |
| `ml/` | datasets, preprocessing, models, training, prediction, utils |
| `media/` | Uploaded media files |
| `static/` | Static files |
| `manage.py` | Django management entry point |

## Suggested Initial Database Tables (SQLite)

| Domain | Tables |
|--------|--------|
| Authentication | users, roles |
| Customer | customers |
| Booking | services, packages, bookings, booking_items |
| POS | orders, order_items, payments |
| Inventory | suppliers, categories, products, inventory, stock_movements, purchase_orders |
| Sales | sales, sales_items |
| Machine Learning | sales_predictions, demand_predictions |
| Chatbot | chatbot_logs, chatbot_faq |
| Notifications | notifications |
| Audit | audit_logs |

## Capstone-Friendly Features

### Customer
- Online booking
- View available packages
- AI chatbot
- Booking status
- Booking history

### Staff
- POS
- Walk-in bookings
- Inventory updates
- Sales transactions

### Admin
- Dashboard
- Sales analytics
- Inventory management
- User management
- AI chatbot analytics
- Machine learning forecasts
- Reports

## Test Accounts (Draft)

To make testing and the capstone defense demo easier, seed the database with a draft account for each role:

| Role | Email | Password | Purpose |
|------|-------|----------|---------|
| Customer | `customer@test.com` | `Customer123!` | Test booking, packages, chatbot, and booking history flows |
| Staff | `staff@test.com` | `Staff123!` | Test POS, inventory, orders, and booking validation flows |
| Admin | `admin@test.com` | `Admin123!` | Test dashboard, analytics, reports, and ML forecasting flows |

**Notes:**
- These are placeholder credentials for development/testing only — never use them in a production deployment.
- Seed them via a Django management command or fixture (e.g. `python manage.py seed_test_accounts`) so they can be recreated easily after a database reset.
- Consider adding a small note in the README so panel members or evaluators know how to log in during the defense.

## Final Verdict

This stack is highly applicable for the project:

- React + Tailwind CSS provides a professional and responsive frontend.
- Django + Django REST Framework is ideal since the AI chatbot and forecasting components are Python-based.
- SQLite works well during development and can later switch to Supabase PostgreSQL with minimal code changes via Django's ORM.
- Supabase provides a managed PostgreSQL database for deployment.
- Keeping all AI-related work in Python simplifies development and allows use of mature forecasting libraries.
- The website must be well-designed and within standard UI/UX practices, with the landing page given particular attention since it creates the first impression for every user.

**Rating: 10 / 10** for this proposed integrated management system. It is modular, scalable, aligns well with the functional requirements (booking, POS, inventory, chatbot, and forecasting), and follows a clean separation of concerns that will make the project easier to maintain and present during the capstone defense.
