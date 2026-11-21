# LEARNING.md: concepts used in ShopNest, explained simply

Each section answers three questions: **What is it? Why do we use it? Where is it in the code?**
New sections are added at the end of every phase.

---

## Phase 0: Foundation

### 1. Client and server
- **Client** = the browser running our HTML, CSS and JavaScript.
- **Server** = Firebase (Google's computers). It stores the data and checks passwords.
- The client never touches the database directly. It sends a **request** over the internet and
  gets a **response** back.

### 2. JSON (JavaScript Object Notation)
- A text format for data. It looks like a JavaScript object, but the keys are always in double quotes:
  ```json
  { "name": "Subhash", "qty": 5, "isActive": true }
  ```
- Both sides understand it, so it is the "common language" between the browser and Firebase.
- `JSON.stringify(obj)` turns an object into JSON text. `JSON.parse(text)` turns the text back into an object.
- **Where:** every request body in `js/api.js`.

### 3. AJAX (Asynchronous JavaScript And XML)
- A way to talk to the server **without reloading the page**.
- *Asynchronous* means the browser does not freeze while waiting. The rest of the page keeps working.
- Despite the name, we send JSON, not XML.
- jQuery gives us `$.ajax({ url, method, data, ... })`.
- **Where:** `send()` in `js/api.js` is the only place `$.ajax` is called.

### 4. Promises and async / await
- A request takes time. A **Promise** is an "IOU" for a value that arrives later.
- `await` pauses *this function only* until the Promise is ready. The page does not freeze.
  ```js
  const categories = await Api.getCategories(); // waits for the server
  ```
- Errors are caught with `try { ... } catch (error) { ... }`.
- jQuery's `$.ajax()` returns a "thenable" object, so we can use `await` on it directly.

### 5. REST API and HTTP methods
- **REST** = each piece of data has its own URL, and the HTTP method says what to do with it.

| Method | Meaning | Example in our app |
|--------|---------|--------------------|
| GET    | read    | `GET /inventory/AbC123` |
| POST   | create (or run a query) | `POST /inventory` |
| PATCH  | change some fields | `PATCH /inventory/AbC123?updateMask...` |
| DELETE | remove  | `DELETE /inventory/AbC123` |

- Every URL ends with `?key=API_KEY` so Firebase knows which project we mean.

### 6. Firestore: a NoSQL document database
- Data lives in **collections** (like tables), which contain **documents** (like rows).
- Each document has an **ID** and **fields**. Different documents may have different fields
  (no fixed schema, which is why it is called "NoSQL").
- Our collections are `categories`, `inventory`, `customers` and `orders`.

### 7. Firestore typed values and the converters
- Firestore's REST API wraps every value with its **type**:
  ```json
  { "fields": { "title": { "stringValue": "Pen" }, "qty": { "integerValue": "5" } } }
  ```
- Integers are sent as **strings** (`"5"`), because JSON numbers cannot safely hold very large
  64-bit numbers.
- Pages should not deal with that, so `api.js` converts in both directions:
  - `toFirestore({ title: 'Pen', qty: 5 })` gives the typed JSON above.
  - `fromFirestore(doc)` gives `{ id: 'AbC123', title: 'Pen', qty: 5 }`.
- The **document ID** is the last part of `doc.name`:
  `"projects/.../documents/inventory/AbC123"` gives `"AbC123"`.
- **See it live:** test-api.html, section 3.

### 8. Pagination with pageToken
- We don't download all products at once. We ask for one **page** (for example 5 items).
- Firestore's answer includes a `nextPageToken`, a bookmark that means "continue from here".
- Sending `pageToken=<bookmark>` gets the next page. When there is no `nextPageToken`, we are on the last page.
- Firestore only gives the *next* bookmark, so to go **back** we remember every token we used
  (`Ui.createTokenPager()` in `js/ui.js`).
- **See it live:** test-api.html, section 2. The token is shown under the table.

### 9. Counting with runAggregationQuery
- `POST :runAggregationQuery` with `count: {}` returns **how many** documents match,
  without downloading them. Cheap and fast.
- **Where:** `Api.count()`. It's used for the "products in stock" number on the home page.

### 10. Module pattern (IIFE)
- Each JS file looks like `const Api = (function () { ...; return { ... }; })();`
- The function runs immediately. Everything inside is **private**, and only the returned
  object is **public**. This avoids name clashes between files without needing a build tool.

### 11. CSS variables and design tokens
- `--color-primary: #6d28d9;` defines a variable, and `color: var(--color-primary);` uses it.
- **All** colours, fonts, spacing, radii, shadows and animation timings live in `css/theme.css`.
  Change them there and the whole site re-themes itself.

### 12. jQuery from a CDN, with a local fallback
- A **CDN** is a fast, shared server for popular files. Visitors may already have jQuery cached.
- `integrity="sha256-..."` is a fingerprint of the file. If the CDN sends anything different,
  the browser refuses to run it.
- If the CDN fails, `js/jquery-fallback.js` loads `vendor/jquery-3.7.1.min.js` instead.

### 13. Accessibility basics we follow
- **Labels** on every input, and `aria-label` on icon-only buttons (screen readers read them).
- **Visible focus ring** (`:focus-visible`) for keyboard users.
- **aria-live** regions so screen readers announce toasts and loading changes.
- **Focus trap** in dialogs: Tab stays inside the modal, and Esc closes it.
- **prefers-reduced-motion**: animations switch off for people who ask their OS for less motion.
- Generated product images use `role="img"` and `aria-label`, which is the "alt text" of a non-`<img>` image.

### 14. Escaping HTML (security)
- When we put data into HTML, a product title like `<script>...</script>` could run as code.
- `Ui.escapeHtml()` turns `<` into `&lt;` (and so on), so data is always shown as text.

### 15. Product photos and the imageUrl field
- Each product document has an `imageUrl` string. It is a path inside the project
  (`assets/images/products/yoga-mat-6mm.jpg`) or a full web address.
- `Placeholder.image(product)` builds the `<img>`. Admin pages live in `/admin`, so local paths get
  the `data-root` prefix (`../`) added. That's why paths are stored *relative* to the site root.
- `loading="lazy"` makes the browser download a photo only when it scrolls into view.
- `width` and `height` on `<img>` let the browser reserve space early, so the page doesn't "jump" while photos load.

### 16. Graceful fallback when a photo fails (event capturing)
- If a photo can't load (wrong path, deleted file, offline), the browser fires an `error` event on the `<img>`.
- `error` events do **not bubble** up to `document`, so a normal listener on `document` never hears them.
  `addEventListener('error', handler, true)` listens in the **capture** phase (on the way *down*),
  which does catch them. The handler swaps the broken photo for the generated category picture.

### 17. Caching a request with a Promise
- The header's category bar and the page's category circles both need the categories.
- `Api.getCategories()` keeps the **Promise** of the first request. Later callers get the same Promise,
  so the server is asked only once per page.

---

## Phase 1: Authentication

### 18. Firebase Auth over REST
- **Sign up** `accounts:signUp` and **sign in** `accounts:signInWithPassword` both return:
  `idToken`, `refreshToken`, `localId` (the user's **uid**), `email`, `expiresIn` (3600 seconds).
- **Reset password** `accounts:sendOobCode` with `requestType: "PASSWORD_RESET"`. Firebase sends the e-mail itself.
- **Lookup** `accounts:lookup` with an idToken: the *server* says who owns the token.
- **Where:** the "Firebase Auth" section of `js/api.js`.

### 19. idToken and refreshToken
- **idToken** = a short-lived (1 hour) "visitor pass" that proves who you are. It's a **JWT** (JSON Web Token):
  three Base64 parts separated by dots, signed by Google so it can't be faked.
- **refreshToken** = a long-lived key used *only* to get a new idToken
  (`securetoken.googleapis.com/v1/token`, form-urlencoded, `grant_type=refresh_token`).
- `Api.getIdToken()` refreshes automatically 5 minutes before expiry. If Firebase rejects the refreshToken
  (for example after a password reset), the session is cleared and the user signs in again.

### 20. The session in localStorage
- `localStorage` keeps data in the browser even after it's closed. We store
  `{ idToken, refreshToken, uid, email, name, expiresAt }` under the key `shopnest.session`.
- `sessionStorage` is like localStorage but is cleared when the tab closes. We use it for **flash messages**
  (a toast saved before a redirect and shown once on the next page).

### 21. Route guards
- Every page declares a rule: `<body data-guard="guest | customer | admin">`.
- `js/auth.js` checks the rule **before** the page is shown. `base.css` keeps guarded pages invisible
  until the guard adds the `auth-ok` class, so there is no "flash" of a forbidden page.
- `location.replace()` is used for redirects, so the forbidden page isn't left in the Back history.
- **Important:** guards protect *screens*. Anyone can edit localStorage, so admin pages also ask the
  server (`accounts:lookup`). The *data* is protected by Firestore security rules in Phase 7.

### 22. The customer profile document (customers/{uid})
- Firebase Auth stores only e-mail and password. Name, mobile and credit live in Firestore.
- The document ID **is** the Auth uid (`POST /customers?documentId={uid}`), so we can always find a
  user's profile from their session.
- **Self-healing:** if sign-up created the Auth user but the profile failed to save, the next sign-in creates it.

### 23. Client-side validation
- `<form novalidate>` turns off the browser's own pop-ups so all messages look the same.
- A **rule** is a function that returns an error message or `''`. A **schema** maps input ids to rules.
- `aria-invalid="true"` and `aria-describedby` let screen readers announce the error with the field.
- Regular expressions used: e-mail `^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`, Indian mobile `^[6-9]\d{9}$`.
- Client checks are for **convenience**. The server (Firebase) still checks e-mails and passwords.

### 24. Two small security habits
- **No account enumeration:** the reset page always says "if an account exists...", so strangers
  can't find out which e-mails are registered.
- **No open redirect:** `?redirect=` only accepts our own `.html` pages (`Auth.safeRedirect`), so a
  link can't bounce users from our login page to a fake site.

---

## Phase 2: Admin inventory

### 25. CRUD on one collection
| Action | Request | In `js/api.js` |
|--------|---------|----------------|
| **C**reate | `POST /inventory` (Firestore makes the ID) | `createProduct()` |
| **R**ead | `GET /inventory?pageSize=&orderBy=&pageToken=` or `POST :runQuery` | `listProducts()`, `productsByCategory()`, `searchProducts()` |
| **U**pdate | `PATCH /inventory/{id}?updateMask.fieldPaths=...` | `updateProduct()` |
| **D**elete | `DELETE /inventory/{id}` | `deleteProduct()` |

### 26. updateMask: change only what changed
- The edit form compares the new values with the saved product (`changedFields()`), and **only the
  changed fields** go into the PATCH and its `updateMask`. The success toast lists them, e.g. "(price, qty)".
- Without an updateMask, PATCH **replaces the whole document**, and every field not sent is lost.
- `currentDocument.exists=true` makes the PATCH fail (instead of creating a new document) if the ID is wrong.

### 27. Soft delete vs hard delete
- **Soft delete** = `isActive: false`. The product stays in the database but the store hides it
  (the store asks for `isActive == true`). It can be switched back on at any time.
- **Hard delete** = `DELETE`, gone forever. That's why it needs a "Confirm? Yes / No" dialog, with
  **No** focused first so pressing Enter by accident is safe.
- Past orders keep their own copy of the title and price, so deleting a product never breaks an old bill.

### 28. Two kinds of pagination
- **pageToken** ("All products"): Firestore gives a bookmark for the next page. Fast and exact, but only
  forwards, so we keep a list of earlier tokens to go back.
- **limit + offset** (category and search pages, which use `runQuery`): "skip 10, give me the next 10".
  Easy to explain, and page numbers are simple. Firestore still reads the skipped documents, so it's fine
  for small collections like ours but slower for huge ones.
- The total page count comes from `runAggregationQuery` (count), so "Page 2 of 6" is accurate.

### 29. Prefix search and why there is no "contains"
- Firestore can only compare whole values, so "title **starts with** Wire" is written as
  `title >= "Wire"` AND `title <= "Wire"`. `` is a very high Unicode character.
- It's case-sensitive, so the page capitalises the first letter you type ("wire" becomes "Wire").
- Searching across the middle of words needs a search service (e.g. Algolia), which is beyond this assignment.

### 30. Firestore number types
- `price` is sent as `doubleValue` (it can have decimals, e.g. 499.5).
- `qty` is sent as `integerValue` **as a string** ("7"). The `INTEGER_FIELDS` list in `api.js` decides this.
- The Phase 2 test reads the raw document back to confirm the types are exactly right.

### 31. Event delegation
- The table rows are rebuilt on every page change. Instead of attaching a click handler to every button,
  **one** handler sits on `<tbody>` and checks `data-action` on whatever was clicked:
  `$('#inventory-rows').on('click', '[data-action]', ...)`. It keeps working for rows added later.

### 32. Ignoring out-of-date answers
- If the admin types "w", "wi", "wir" quickly, three requests can come back in any order.
  Each request gets a number (`requestCounter`), and an answer is ignored if a newer request has started.
  Together with **debounce** (wait 400 ms after the last key press), the list always matches the search box.

---

## Phase 3: Admin customers and credit limits

### 33. How credit works in ShopNest
- Each `customers/{uid}` document has `creditLimit` (the maximum) and `creditUsed` (spent on credit so far).
- **Available credit = creditLimit - creditUsed.** A credit purchase is allowed only if
  `creditUsed + order total <= creditLimit` (checked at checkout in Phase 5).
- "CRUD on the credit limit": **Create** = the default ₹1,000 given at sign-up, **Read** = the table,
  **Update** = "Edit credit", **Delete** = "Block new credit", which sets the limit equal to what's already
  used, so ₹0 is available. A limit can never go below the amount already used.

### 34. Re-read before you write
- The admin may keep the edit form open while the customer buys something on credit.
- So just before saving, the page reads the customer **again** (`Api.getCustomer`) and refuses a limit
  below the *latest* `creditUsed`. This avoids acting on stale (out-of-date) data.
- The PATCH changes **only** `creditLimit` (`updateMask.fieldPaths=creditLimit`), so it can't overwrite
  `creditUsed` even if it changed in the meantime.

### 35. Totals computed in JavaScript
- The summary cards (total credit given, total used, customers at 80% or more) come from reading all customers
  and adding up with `Array.reduce()`:
  `all.reduce((sum, c) => sum + c.creditLimit, 0)`.
- Fine for a small shop. A big shop would keep running totals in a separate document instead.

### 36. The `<progress>` element
- `<progress max="1500" value="999">` draws a bar "999 out of 1500". It's built into HTML, screen readers
  understand it, and it needs no inline `style="width: ..."`. CSS colours it green / amber / red.

### 37. Rounding money
- Computers store decimals in binary, so `0.1 + 0.2` gives `0.30000000000000004`.
- Before saving an amount, the page rounds to 2 decimals: `Math.round(value * 100) / 100`.

---

## Phase 4: The store catalogue

### 38. Why the store loads all active products once
- `Api.getActiveProducts()` sends **one** `runQuery` with `isActive == true` and keeps the result
  (the Promise is cached, like the categories). The trending row, hero numbers, chips, catalogue and
  "more in this category" all use that one answer. The test checks that exactly 1 request is made.
- Filtering, searching, sorting and paging then happen in **JavaScript** (`Array.filter`, `sort`, `slice`).
- **Trade-off:** perfect for a catalogue of a few hundred products, and it needs no extra Firestore index
  (an equality filter alone is fine). A shop with 100,000 products would page on the server instead,
  which is exactly what the admin Inventory page does (concept 28).

### 39. "Contains" search in the browser
- Firestore can only do "starts with" (concept 29), but once the products are in JavaScript we can do better:
  `haystack.includes(word)` for **every word** typed, over the title, category and description, ignoring case.
  `"wireless pro"` finds *Wireless Earbuds Pro*, and `"bluetooth"` also finds the speaker through its description.
- **Debounce** (concept from Phase 2): results update 350 ms after the last key press, not on every letter.

### 40. State in the address bar
- The catalogue's choices live in the URL: `index.html?cat=<id>&q=wire&sort=price-asc&page=2`.
- `URLSearchParams` reads and builds the query string, and `history.replaceState()` updates the address
  **without reloading** the page. So a filtered view can be bookmarked or shared, and category links
  from the home page open the right view.
- `readUrl()` also repairs bad values: an unknown `cat` is ignored, and `?page=99` becomes the last page.

### 41. Pagination in memory
- `list.slice(from, from + PAGE_SIZE)` gives one page; `Math.ceil(list.length / PAGE_SIZE)` gives the page count.
- Sold-out products are moved to the end with a second `sort`. `Array.sort` is **stable** (equal items keep
  their order), so the chosen sort (e.g. cheapest first) is kept inside each group.

### 42. The "stretched link" card
- Each product card has ONE link (the title). Its `::after` pseudo-element is `position: absolute; inset: 0`,
  so it covers the whole card and the whole card is clickable.
- A keyboard or screen-reader user meets one clear link instead of three (photo, title, price). The "Add"
  button has `z-index: 2`, so it stays above the link and works on its own.
- `:has(.product-card__link:focus-visible)` draws the focus ring around the whole card.

### 43. Customers only see active products, and fresh data on the details page
- The catalogue asks Firestore only for `isActive == true`, so a deactivated product vanishes from the store
  after a reload (tested: 59 products while one is hidden).
- The product page reads the single product **fresh** (`GET /inventory/{id}`), so stock is up to date, and then
  checks `isActive` itself: a hidden product shows "This product is not available", a deleted or unknown id
  shows "Product not found". Showing a friendly message for every bad case is part of good error handling.

### 44. Small UI details
- **Clamping** the quantity: `Math.min(Math.max(value, 1), stock)` keeps it a whole number from 1 to the stock;
  letters are removed with `value.replace(/\D/g, '')`.
- `scroll-margin-top` stops a link like `#products` from hiding its heading behind the sticky header.
- `loading="lazy"` for photos far down the page, `loading="eager"` for the main photo at the top.

---

## Coming in later phases
- Atomic commit, field transforms (increment) and server timestamps (Phase 5)
- Preconditions (updateTime) to prevent overselling (Phase 5)
- Composite indexes (Phase 4 / 6)
- Grouping and totals for reports in JavaScript (Phase 6)
- Firestore security rules (Phase 7)
