# ShopNest: Online Shopping

A colourful, responsive online store built with **HTML5, CSS3, JavaScript (ES6+) and jQuery only**.
The browser talks to **Firebase** (Firestore database + Authentication) through its REST APIs, using
**JSON over AJAX** (`$.ajax`). There is no Firebase SDK, no framework and no build step.

> Psiog IMPACT training assignment. Status: **all phases complete.**

```
Browser (HTML / CSS / JS / jQuery) --- JSON over AJAX ---> Firebase
                                                            ├─ Authentication  (sign up, sign in, reset password)
                                                            └─ Firestore       (categories, inventory, customers, orders)
```

## What it does

**Customer**
- Sign up, sign in, sign out, reset password, with validation
- Browse the catalogue: category chips, live search, sort, pagination; product details page (active products only)
- Cart drawer with quantities and stock limits (guests can fill it; it merges when they sign in)
- Checkout: pay by **Cash** or **ShopNest credit** (allowed only if `creditUsed + total <= creditLimit`)
- One atomic purchase: the order is saved, stock goes down and credit goes up together, or nothing changes
- Printable bill and order history

**Admin** (one account, identified by its e-mail)
- Inventory: add, edit, activate / deactivate, delete (with a Yes / No check), filter, search, pagination
- Customers: credit limit, used and available; edit the limit
- Dashboard: key numbers and charts
- Reports with From / To dates and CSV download: **Customer** (all, top 10, cash, credit), **Inventory** (stock, category-wise,
  high > 100, low < 15), **Sales** (all, category-wise, cash, credit, top 10 and bottom 10 items)

## Run it locally

The pages must be served over `http://` (double-clicking the file, `file://`, does not work reliably).

**Option A: VS Code Live Server (recommended)**
1. Install the *Live Server* extension.
2. Right-click `index.html` and choose **Open with Live Server**.

**Option B: Python**
```bash
cd online-shopping
python -m http.server 5500
```
Then open <http://localhost:5500>. Python's built-in server can refuse connections when a page asks for many files at
once; if a page loads only half-way, refresh it (Live Server does not have this problem).

## Pages

| URL | Who can open it | What it shows |
|-----|-----------------|---------------|
| `index.html` | everyone | Store home: hero, categories, trending, catalogue |
| `product.html?id=...` | everyone | Product details, quantity, related products |
| `login.html`, `signup.html` | signed-out visitors | Sign in, create account |
| `reset-password.html` | everyone | Password-reset e-mail |
| `checkout.html` | customers | Review, choose Cash or Credit, place the order |
| `bill.html?id=ORD...` | the order's owner | Printable bill |
| `orders.html` | customers | Order history |
| `admin/dashboard.html` | admin | Key numbers, charts, recent orders, restock list |
| `admin/inventory.html` | admin | Product management |
| `admin/customers.html` | admin | Credit limits |
| `admin/reports.html` | admin | Customer, inventory and sales reports |

Pages declare who may open them with `<body data-guard="guest | customer | admin">` (see `js/auth.js`).

## Demo accounts
| Role | E-mail | Password |
|------|--------|----------|
| Admin | `admin@email.com` | `admin@123` |
| Customer | `customer@email.com` | `customer@123` |

You can also create your own customer on the sign-up page. The admin is the one account whose e-mail equals `ADMIN_EMAIL` in `js/config.js`.

## Firebase setup

The backend already exists (project `online-shopping-4134f`). Settings are in `js/config.js`.

**1. Security rules (do this before 20 Dec 2026).** Firestore "test mode" (open to everyone) expires about 20 Dec 2026,
after which every request would be refused. Replace it with the rules in [docs/firestore.rules](docs/firestore.rules):
1. Firebase console → **Build → Firestore Database → Rules**
2. Delete the existing text, paste the whole file, click **Publish**.

In short: anyone can **read** the catalogue; changing anything needs a signed-in user; only the admin e-mail can add or
delete products. The app sends the sign-in token with every request (`USE_AUTH_HEADER: true` in `js/config.js`).
The rules are deliberately simple, because this is an assignment.

*Note:* once the rules are published, the PowerShell seed scripts in `docs/` (and any Postman call without a token) will be
refused. Run them before publishing, or add an `Authorization: Bearer <idToken>` header.

**2. Order e-mail (optional, off).** Firebase sends only sign-in e-mails, so a bill by e-mail needs a small extra service.
The code is ready behind a switch (`CONFIG.EMAIL.ENABLED`, `Api.sendOrderEmail()` using [EmailJS](https://www.emailjs.com)).
To turn it on: create an EmailJS service and template, paste the three ids into `js/config.js`, set `ENABLED: true`.
Template variables: `{{to_email}} {{to_name}} {{order_id}} {{order_total}} {{payment}} {{items}} {{order_date}}`.
If an e-mail fails, the order is still placed.

**3. Index requirement.** Every query in the app works with Firestore's automatic single-field indexes. If a future change
needs a composite index, Firestore's error message contains a link that creates it with one click.

**Free-plan limit.** The free Spark plan allows about 50,000 document reads per day. If the app shows "The free daily
limit has been reached", wait a little and try again (the daily quota resets at midnight Pacific time).

## Folder structure

```
index.html  product.html  login.html  signup.html  reset-password.html  checkout.html  bill.html  orders.html
admin/      dashboard.html  inventory.html  customers.html  reports.html
css/        theme.css (design tokens: variables only)  base.css  components.css  store.css  product.css
            cart.css  orders.css  auth.css  admin.css
js/         config.js  api.js (ALL server calls)  auth.js  ui.js  icons.js  layout.js  validation.js  placeholder.js
            store.js  product-card.js  product.js  cart.js  checkout.js  bill.js  orders.js  auth-pages.js
            admin-inventory.js  admin-customers.js  admin-dashboard.js  admin-reports.js  reports-calc.js
            jquery-fallback.js
assets/     favicon.svg  images/ (products, categories, hero)
vendor/     jquery-3.7.1.min.js  (used if the CDN is unreachable)
docs/       Postman collection, seed script, firestore.rules, IMAGE-CREDITS.md
```

## Technical rules followed
- Only HTML5, CSS3, vanilla JS (ES6+) and jQuery 3 (official CDN with a local fallback).
- All server calls go through **one** module, `js/api.js`, with `toFirestore()` / `fromFirestore()` converters.
- Every colour, size and animation timing lives in `css/theme.css`; other CSS files only use `var(--...)`.
- No inline CSS or JavaScript, no `console.log`, labels on every input, alt text on every image.
- Responsive from 320px to 1440px, AA colour contrast, visible keyboard focus, `aria-live` toasts,
  `prefers-reduced-motion` respected.
- Friendly error messages for every failed request, and every create / pay button is disabled while its request runs.

## Credits
Product and banner photos are from [Unsplash](https://unsplash.com) (free licence), see
[docs/IMAGE-CREDITS.md](docs/IMAGE-CREDITS.md). Fonts: Fraunces and Plus Jakarta Sans (Google Fonts).
