# ShopNest: Online Shopping

A colourful, responsive online store built with **HTML, CSS, JavaScript and jQuery only**.
The browser talks to **Firebase** (Firestore database + Authentication) through its REST APIs,
using **JSON over AJAX** (`$.ajax`).

> Psiog IMPACT training assignment. Status: **Phase 5 (cart, checkout, bill, orders) complete.** See [PLAN.md](PLAN.md).

## Run it locally

The pages must be served over `http://`. Opening them by double-clicking (`file://`) will not work reliably.

**Option A: VS Code Live Server**
1. Install the *Live Server* extension.
2. Right-click `index.html`, then choose **Open with Live Server**.

**Option B: Python**
```bash
cd online-shopping
python -m http.server 5500
```
Then open <http://localhost:5500>.

## Pages so far

| URL | Who can open it | What it shows |
|-----|-----------------|---------------|
| `/index.html` | everyone | Store home: hero, categories, trending, and the catalogue (category chips, live search, sort, pagination) |
| `/product.html?id=...` | everyone | Product details: photo, price, stock, quantity, related products (active products only) |
| `/login.html` | signed-out visitors | Sign in |
| `/signup.html` | signed-out visitors | Create account (+ customer profile with starter credit) |
| `/reset-password.html` | everyone | Send a password-reset e-mail |
| Cart drawer | everyone | Slide-in cart on every store page (guests can fill it; it merges when they sign in) |
| `/checkout.html` | customers | Review items, choose Cash or ShopNest credit, place the order (stock and credit checked again) |
| `/bill.html?id=ORD...` | the customer who owns the order | Printable bill |
| `/orders.html` | customers | Order history: newest first, Cash / Credit filter, 5 per page, credit summary |
| `/admin/inventory.html` | admin only | Products: add, edit, activate / deactivate, delete; filter by category; search; pagination |
| `/admin/customers.html` | admin only | Customers with credit limit / used / available; search by e-mail; edit credit limit |
| `/admin/dashboard.html`, `reports.html` | admin only | Placeholders until Phase 6 |
| `/test-api.html` | everyone | Developer test bench (removed in Phase 7) |

## Test accounts
- **Customer:** `testcustomer1@example.com` (password shared privately by the project owner, or sign up for your own account)
- **Admin:** `mahalakshmivsm7@gmail.com` (the password is not stored in this project)

## Photos
Product, category and banner photos are in `assets/images/` (from Unsplash, free licence; see
[docs/IMAGE-CREDITS.md](docs/IMAGE-CREDITS.md)). Each product's `imageUrl` field points to its photo.
`docs/add-product-images.ps1` set this field for the 60 seeded products. It is safe to run again.

## If pages load only half-way
Python's built-in server (`python -m http.server`) can refuse connections when a page asks for many files at
once. **VS Code Live Server does not have this problem**, so prefer it. If you use Python, refresh the page.

## Tech rules
- No frameworks, no CSS libraries, no Firebase SDK, no build step.
- All server calls go through `js/api.js`. Settings live in `js/config.js`.
- The design system is in `css/theme.css` (CSS variables only).
- Fonts: Fraunces (headings) and Plus Jakarta Sans (text) from Google Fonts. If they can't load, system fonts are used.

## Folder structure
See section 5 of [PLAN.md](PLAN.md). Concepts are explained in [LEARNING.md](LEARNING.md).
