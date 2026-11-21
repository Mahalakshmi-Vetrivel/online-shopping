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
  ADMIN_EMAIL: 'admin@email.com',

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
  // With Firestore security rules (docs/firestore.rules) every write must prove who
  // is calling. true = api.js sends "Authorization: Bearer <idToken>" with each
  // Firestore request of a signed-in user. Guests (no token) can still read the
  // catalogue. Keep this true.
  USE_AUTH_HEADER: true,

  // ---------- Order e-mail: OFF until the trainer approves ----------
  // Firebase only sends sign-in e-mails (like "reset password"), so a bill by
  // e-mail needs a small third-party service. We use EmailJS (emailjs.com), called
  // through $.ajax in Api.sendOrderEmail(). To switch it on:
  //   1. create a free EmailJS account, an e-mail service and a template
  //   2. the template may use these variables:
  //      {{to_email}} {{to_name}} {{order_id}} {{order_total}} {{payment}} {{items}} {{order_date}}
  //   3. paste the three ids below and set ENABLED to true
  EMAIL: Object.freeze({
    ENABLED: false,
    SERVICE_ID: '',
    TEMPLATE_ID: '',
    PUBLIC_KEY: ''
  })
});
