/* =====================================================================
   config.js - ONE place for every setting the app needs.
   Change a value here and every page picks it up.
   Object.freeze() makes the object read-only, so no other file can
   change a setting by accident.
   ===================================================================== */

const CONFIG = Object.freeze({
  // ---------- Firebase project ----------
  PROJECT_ID: 'online-shopping-b3e8d',
  // The Web API key only identifies the project. It is NOT a secret:
  // every Firebase web app ships it to the browser. Data is protected by
  // Firestore security rules (Phase 7), not by hiding this key.
  API_KEY: 'AIzaSyCu498WCp0_BU35xVTX1MauBcZkSR-ENhw',

  // ---------- Roles ----------
  // The one and only admin. Every other signed-in user is a customer.
  ADMIN_EMAIL: 'mahalakshmivsm7@gmail.com',

  // ---------- Business rules ----------
  DEFAULT_CREDIT_LIMIT: 1000, // credit limit given to every new customer (INR)
  HIGH_STOCK: 100,            // qty above this = "High stock"
  LOW_STOCK: 15,              // qty below this = "Low stock"

  // ---------- Pagination ----------
  PAGE_SIZE: 8,               // product cards per page in the store
  ADMIN_PAGE_SIZE: 10,        // rows per page in admin tables

  // ---------- Display ----------
  SHOP_NAME: 'ShopNest',
  LOCALE: 'en-IN',
  CURRENCY: 'INR',

  // ---------- Security ----------
  // When Firestore security rules are switched on (Phase 7) every request
  // must prove who is calling. Setting this to true makes api.js send
  // "Authorization: Bearer <idToken>" with every Firestore request.
  USE_AUTH_HEADER: false,

  // ---------- Order e-mail (Phase 7, OFF until the trainer approves) ----------
  EMAIL: Object.freeze({
    ENABLED: false,
    SERVICE_ID: '',
    TEMPLATE_ID: '',
    PUBLIC_KEY: ''
  })
});
