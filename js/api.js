/* =====================================================================
   api.js - the ONLY file that talks to the server.
   Every request is a $.ajax call that sends/receives JSON.

   Pages never see Firestore's "typed" JSON. They work with plain
   objects, and this file converts in both directions:

     plain JS object                       Firestore REST JSON
     { title: "Pen", qty: 5 }   <------>   { fields: { title: { stringValue: "Pen" },
                                                       qty:   { integerValue: "5" } } }

   Sections:
     1. URLs and constants
     2. Converters      toFirestore / fromFirestore
     3. Errors          turns server errors into friendly messages
     4. Session         idToken storage + automatic refresh
     5. Core request    one function every call goes through
     6. Firestore CRUD  getDoc, listDocs, createDoc, updateDoc, deleteDoc,
                        runQuery, count, commit
     7. Query builder   small helpers to write structuredQuery JSON
     8. App calls       getCategories, ... (grows phase by phase)
   ===================================================================== */

const Api = (function () {
  /* ------------------------------------------------------------------
     1. URLs and constants
     ------------------------------------------------------------------ */
  const DOCUMENT_ROOT = `projects/${CONFIG.PROJECT_ID}/databases/(default)/documents`;
  const FIRESTORE_URL = `https://firestore.googleapis.com/v1/${DOCUMENT_ROOT}`;
  const AUTH_URL = 'https://identitytoolkit.googleapis.com/v1';
  const TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';

  const REQUEST_TIMEOUT_MS = 20000;
  const SESSION_KEY = 'shopnest.session';
  // Refresh the idToken 5 minutes BEFORE it expires, to be safe.
  const REFRESH_MARGIN_MS = 5 * 60 * 1000;

  // JavaScript has one number type, but Firestore has two (integer and double).
  // Fields listed here are sent as integerValue; all other numbers as doubleValue.
  const INTEGER_FIELDS = ['qty'];

  /* ------------------------------------------------------------------
     2. Converters
     ------------------------------------------------------------------ */

  /** One JS value -> one Firestore typed value. */
  function toValue(value, fieldName) {
    if (value === null || value === undefined) {
      return { nullValue: null };
    }
    if (typeof value === 'boolean') {
      return { booleanValue: value };
    }
    if (typeof value === 'number') {
      // Firestore sends and expects integers as STRINGS ("50"), because
      // JSON numbers cannot safely hold very large 64-bit integers.
      return INTEGER_FIELDS.includes(fieldName)
        ? { integerValue: String(Math.trunc(value)) }
        : { doubleValue: value };
    }
    if (typeof value === 'string') {
      return { stringValue: value };
    }
    if (value instanceof Date) {
      return { timestampValue: value.toISOString() };
    }
    if (Array.isArray(value)) {
      return { arrayValue: { values: value.map((item) => toValue(item, fieldName)) } };
    }
    if (typeof value === 'object') {
      return { mapValue: { fields: toFields(value) } };
    }
    throw new Error(`Cannot convert field "${fieldName}" to Firestore`);
  }

  /** Plain object -> Firestore "fields" object. */
  function toFields(obj) {
    const fields = {};
    Object.keys(obj).forEach((key) => {
      if (obj[key] !== undefined) {
        fields[key] = toValue(obj[key], key);
      }
    });
    return fields;
  }

  /** Plain object -> request body for create / update. */
  function toFirestore(obj) {
    return { fields: toFields(obj) };
  }

  /** One Firestore typed value -> one JS value. */
  function fromValue(typed) {
    if ('stringValue' in typed) return typed.stringValue;
    if ('integerValue' in typed) return Number(typed.integerValue);
    if ('doubleValue' in typed) return Number(typed.doubleValue);
    if ('booleanValue' in typed) return typed.booleanValue;
    if ('timestampValue' in typed) return new Date(typed.timestampValue);
    if ('nullValue' in typed) return null;
    if ('arrayValue' in typed) return (typed.arrayValue.values || []).map(fromValue);
    if ('mapValue' in typed) return fromFields(typed.mapValue.fields || {});
    if ('referenceValue' in typed) return typed.referenceValue;
    if ('geoPointValue' in typed) return typed.geoPointValue;
    return undefined;
  }

  function fromFields(fields) {
    const obj = {};
    Object.keys(fields).forEach((key) => {
      obj[key] = fromValue(fields[key]);
    });
    return obj;
  }

  /**
   * Firestore document -> plain object.
   * The document ID is the last part of "name":
   *   "projects/.../documents/inventory/AbC123"  ->  id = "AbC123"
   * _updateTime is kept so checkout can say "only save if nobody changed this since I read it".
   */
  function fromFirestore(doc) {
    return {
      id: doc.name.split('/').pop(),
      ...fromFields(doc.fields || {}),
      _updateTime: doc.updateTime
    };
  }

  /* ------------------------------------------------------------------
     3. Errors
     ------------------------------------------------------------------ */

  // Server error codes -> messages a shopper understands.
  const FRIENDLY_MESSAGES = {
    // Firebase Auth codes
    EMAIL_EXISTS: 'An account with this email already exists. Try signing in instead.',
    EMAIL_NOT_FOUND: 'No account found with this email.',
    INVALID_PASSWORD: 'Incorrect password. Please try again.',
    INVALID_LOGIN_CREDENTIALS: 'Email or password is incorrect.',
    INVALID_EMAIL: 'Please enter a valid email address.',
    MISSING_PASSWORD: 'Please enter your password.',
    WEAK_PASSWORD: 'That password is too weak. Please choose a stronger one.',
    USER_DISABLED: 'This account has been disabled. Please contact support.',
    USER_NOT_FOUND: 'This account no longer exists. Please sign up again.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Please wait a few minutes and try again.',
    TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
    INVALID_ID_TOKEN: 'Your session has expired. Please sign in again.',
    INVALID_REFRESH_TOKEN: 'Your session has expired. Please sign in again.',
    // Firestore status codes
    NOT_FOUND: 'We could not find that record. It may have been deleted.',
    ALREADY_EXISTS: 'This record already exists.',
    PERMISSION_DENIED: 'You do not have permission to do that.',
    UNAUTHENTICATED: 'Please sign in to continue.',
    FAILED_PRECONDITION: 'The data changed while you were working. Please refresh and try again.',
    ABORTED: 'Someone else changed this data at the same moment. Please try again.',
    RESOURCE_EXHAUSTED: 'The free daily limit has been reached. Please try again later.',
    UNAVAILABLE: 'The server is busy right now. Please try again in a moment.',
    INVALID_ARGUMENT: 'Some of the data was not valid. Please check and try again.'
  };

  /** Our own error type: always has a friendly .message, plus details for the code. */
  class ApiError extends Error {
    constructor(message, { code = 'UNKNOWN', httpStatus = 0, indexUrl = null, serverMessage = '' } = {}) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.httpStatus = httpStatus;
      this.indexUrl = indexUrl;
      this.serverMessage = serverMessage;
    }
  }

  /** Converts a failed jQuery request (jqXHR) into an ApiError. */
  function toApiError(xhr) {
    if (xhr instanceof ApiError) return xhr;

    // No response at all: offline, DNS problem, or timeout.
    if (!xhr || xhr.status === 0) {
      const timedOut = xhr && xhr.statusText === 'timeout';
      return new ApiError(
        timedOut
          ? 'The server took too long to respond. Please try again.'
          : 'Cannot reach the server. Please check your internet connection.',
        { code: timedOut ? 'TIMEOUT' : 'NETWORK' }
      );
    }

    // runQuery returns errors inside an array: [{ error: {...} }]
    let body = xhr.responseJSON;
    if (Array.isArray(body)) body = body[0];
    const serverError = (body && body.error) || {};
    const serverMessage = serverError.message || '';

    // Auth messages look like "WEAK_PASSWORD : Password should be ...": take the first word.
    const authCode = serverMessage.split(/[\s:]/)[0];
    const code = FRIENDLY_MESSAGES[authCode] ? authCode : serverError.status || 'HTTP_' + xhr.status;

    // Firestore asks for a composite index with a console link in the message.
    const indexMatch = serverMessage.match(/https:\/\/console\.firebase\.google\.com\S+/);
    if (indexMatch) {
      return new ApiError('This view needs a new database index before it can load.', {
        code: 'INDEX_REQUIRED',
        httpStatus: xhr.status,
        indexUrl: indexMatch[0],
        serverMessage
      });
    }

    const message = FRIENDLY_MESSAGES[code] || `Something went wrong (error ${xhr.status}). Please try again.`;
    return new ApiError(message, { code, httpStatus: xhr.status, serverMessage });
  }

  /* ------------------------------------------------------------------
     4. Session (who is signed in)
     Stored in localStorage so it survives page reloads:
       { idToken, refreshToken, uid, email, expiresAt, ... }
     ------------------------------------------------------------------ */
  const session = {
    get() {
      try {
        return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
      } catch (error) {
        return null; // corrupted value: treat as signed out
      }
    },

    /** Merges new values into the stored session. expiresIn is in seconds. */
    save(values) {
      const next = { ...(session.get() || {}), ...values };
      if (values.expiresIn) {
        next.expiresAt = Date.now() + Number(values.expiresIn) * 1000;
        delete next.expiresIn;
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      return next;
    },

    clear() {
      localStorage.removeItem(SESSION_KEY);
    }
  };

  let refreshInProgress = null; // shared promise so 5 parallel calls cause only 1 refresh

  /** Swaps the long-lived refreshToken for a fresh idToken (valid 1 hour). */
  function refreshSession() {
    if (!refreshInProgress) {
      refreshInProgress = (async () => {
        const current = session.get();
        if (!current || !current.refreshToken) {
          throw new ApiError(FRIENDLY_MESSAGES.UNAUTHENTICATED, { code: 'UNAUTHENTICATED' });
        }
        try {
          // This endpoint wants form-urlencoded data and uses snake_case names.
          const res = await send({
            method: 'POST',
            url: TOKEN_URL,
            form: { grant_type: 'refresh_token', refresh_token: current.refreshToken }
          });
          return session.save({
            idToken: res.id_token,
            refreshToken: res.refresh_token,
            uid: res.user_id,
            expiresIn: res.expires_in
          });
        } catch (error) {
          // A rejected refresh token means the user must sign in again.
          if (error.httpStatus === 400) session.clear();
          throw error;
        }
      })().finally(() => {
        refreshInProgress = null;
      });
    }
    return refreshInProgress;
  }

  /** Returns a valid idToken (refreshing it first if needed), or null if signed out. */
  async function getIdToken() {
    const current = session.get();
    if (!current) return null;
    if (current.expiresAt && Date.now() < current.expiresAt - REFRESH_MARGIN_MS) {
      return current.idToken;
    }
    const fresh = await refreshSession();
    return fresh.idToken;
  }

  /* ------------------------------------------------------------------
     5. Core request
     ------------------------------------------------------------------ */

  /** Adds ?key=API_KEY (or &key=...) to a URL. */
  function withKey(url) {
    return url + (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(CONFIG.API_KEY);
  }

  /**
   * Sends ONE request with $.ajax and returns the parsed JSON.
   *   body : object sent as JSON
   *   form : object sent as form-urlencoded (token refresh only)
   * `await` works with $.ajax because jQuery's jqXHR is "thenable" (it has .then()).
   */
  async function send({ method = 'GET', url, body, form, headers = {} }) {
    const settings = {
      url: withKey(url),
      method,
      headers,
      dataType: 'json',
      timeout: REQUEST_TIMEOUT_MS
    };
    if (form) {
      settings.data = form; // jQuery encodes it as a=1&b=2
    } else if (body !== undefined) {
      settings.contentType = 'application/json';
      settings.data = JSON.stringify(body);
    }
    try {
      return await $.ajax(settings);
    } catch (xhr) {
      throw toApiError(xhr);
    }
  }

  /** Firestore request: same as send(), plus the optional Bearer token. */
  async function firestore(method, path, body) {
    const headers = {};
    if (CONFIG.USE_AUTH_HEADER) {
      const idToken = await getIdToken();
      if (idToken) headers.Authorization = 'Bearer ' + idToken;
    }
    return send({ method, url: FIRESTORE_URL + path, body, headers });
  }

  /* ------------------------------------------------------------------
     6. Firestore CRUD
     ------------------------------------------------------------------ */

  /** GET one document. */
  async function getDoc(collection, id) {
    const doc = await firestore('GET', `/${collection}/${encodeURIComponent(id)}`);
    return fromFirestore(doc);
  }

  /**
   * GET a page of documents.
   * Returns { items, nextPageToken }. nextPageToken is null on the last page.
   */
  async function listDocs(collection, { pageSize = CONFIG.ADMIN_PAGE_SIZE, orderBy, pageToken } = {}) {
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (orderBy) params.set('orderBy', orderBy);
    if (pageToken) params.set('pageToken', pageToken);
    const res = await firestore('GET', `/${collection}?${params.toString()}`);
    return {
      items: (res.documents || []).map(fromFirestore),
      nextPageToken: res.nextPageToken || null
    };
  }

  /** Reads EVERY document of a collection (page by page). Use for small collections only. */
  async function listAll(collection, orderBy) {
    let all = [];
    let pageToken = null;
    do {
      const page = await listDocs(collection, { pageSize: 300, orderBy, pageToken });
      all = all.concat(page.items);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return all;
  }

  /**
   * POST a new document. Firestore creates the ID, unless docId is given
   * (customers use the Auth uid as their document ID).
   */
  async function createDoc(collection, data, docId) {
    const query = docId ? `?documentId=${encodeURIComponent(docId)}` : '';
    const doc = await firestore('POST', `/${collection}${query}`, toFirestore(data));
    return fromFirestore(doc);
  }

  /**
   * PATCH only the fields in `data`.
   * updateMask is IMPORTANT: without it, PATCH replaces the whole document
   * and every field we did not send is deleted.
   * currentDocument.exists=true: fail (instead of creating) if the ID is wrong.
   */
  async function updateDoc(collection, id, data) {
    const params = new URLSearchParams();
    Object.keys(data).forEach((field) => params.append('updateMask.fieldPaths', field));
    params.set('currentDocument.exists', 'true');
    const doc = await firestore('PATCH', `/${collection}/${encodeURIComponent(id)}?${params.toString()}`, toFirestore(data));
    return fromFirestore(doc);
  }

  /** DELETE a document permanently. */
  async function deleteDoc(collection, id) {
    await firestore('DELETE', `/${collection}/${encodeURIComponent(id)}`);
  }

  /**
   * POST :runQuery with a structuredQuery (filters, order, limit, offset).
   * The response is an array; rows without "document" are just metadata
   * (an empty result still returns one row with only "readTime").
   */
  async function runQuery(structuredQuery) {
    const rows = await firestore('POST', ':runQuery', { structuredQuery });
    return rows.filter((row) => row.document).map((row) => fromFirestore(row.document));
  }

  /** POST :runAggregationQuery -> how many documents match (without downloading them). */
  async function count(collectionId, where) {
    const structuredQuery = { from: [{ collectionId }] };
    if (where) structuredQuery.where = where;
    const rows = await firestore('POST', ':runAggregationQuery', {
      structuredAggregationQuery: {
        structuredQuery,
        aggregations: [{ alias: 'total', count: {} }]
      }
    });
    const total = rows[0] && rows[0].result && rows[0].result.aggregateFields.total;
    return total ? Number(total.integerValue) : 0;
  }

  /**
   * POST :commit -> several writes that succeed or fail TOGETHER (atomic).
   * Used for checkout in Phase 5.
   */
  async function commit(writes) {
    return firestore('POST', ':commit', { writes });
  }

  /** Full resource name used inside commit writes. */
  function docName(collection, id) {
    return `${DOCUMENT_ROOT}/${collection}/${id}`;
  }

  /* ------------------------------------------------------------------
     7. Query builder: readable helpers for structuredQuery JSON
        Query.where('qty', '<', 15)
          -> { fieldFilter: { field: { fieldPath: 'qty' }, op: 'LESS_THAN', value: { integerValue: '15' } } }
     ------------------------------------------------------------------ */
  const OPERATORS = {
    '==': 'EQUAL',
    '!=': 'NOT_EQUAL',
    '<': 'LESS_THAN',
    '<=': 'LESS_THAN_OR_EQUAL',
    '>': 'GREATER_THAN',
    '>=': 'GREATER_THAN_OR_EQUAL',
    in: 'IN'
  };

  const Query = {
    where(field, operator, value) {
      return {
        fieldFilter: {
          field: { fieldPath: field },
          op: OPERATORS[operator] || operator,
          value: toValue(value, field)
        }
      };
    },

    /** Combines filters with AND. Ignores empty ones, so optional filters are easy. */
    and(...filters) {
      const list = filters.filter(Boolean);
      if (list.length === 0) return undefined;
      if (list.length === 1) return list[0];
      return { compositeFilter: { op: 'AND', filters: list } };
    },

    orderBy(field, direction = 'asc') {
      return { field: { fieldPath: field }, direction: direction === 'desc' ? 'DESCENDING' : 'ASCENDING' };
    },

    /** Builds a whole structuredQuery from simple options. */
    build({ from, where, orderBy, limit, offset }) {
      const query = { from: [{ collectionId: from }] };
      if (where) query.where = where;
      if (orderBy) query.orderBy = [].concat(orderBy);
      if (limit) query.limit = limit;
      if (offset) query.offset = offset;
      return query;
    }
  };

  /* ------------------------------------------------------------------
     8. App calls (more are added in each phase)
     ------------------------------------------------------------------ */

  // Several parts of a page need the categories (header bar, tiles, filters).
  // We keep the Promise of the first request, so the server is asked only ONCE per page.
  let categoriesPromise = null;

  /** All categories, sorted A to Z. Pass true to force a fresh read. */
  function getCategories(forceReload = false) {
    if (!categoriesPromise || forceReload) {
      categoriesPromise = listDocs('categories', { pageSize: 100, orderBy: 'name' })
        .then((page) => page.items)
        .catch((error) => {
          categoriesPromise = null; // allow a retry after a failure
          throw error;
        });
    }
    return categoriesPromise;
  }

  /* ---------- Firebase Auth (identitytoolkit REST) ---------- */

  /** Saves the tokens from a signUp / signInWithPassword response. */
  function saveAuthResponse(res) {
    return session.save({
      idToken: res.idToken,
      refreshToken: res.refreshToken,
      uid: res.localId,
      email: res.email,
      expiresIn: res.expiresIn
    });
  }

  /** Postman 1.1: creates a new Auth user and signs them in. */
  async function signUp(email, password) {
    const res = await send({
      method: 'POST',
      url: `${AUTH_URL}/accounts:signUp`,
      body: { email, password, returnSecureToken: true }
    });
    return saveAuthResponse(res);
  }

  /** Postman 1.2 / 1.3: checks the e-mail + password and returns tokens. */
  async function signIn(email, password) {
    const res = await send({
      method: 'POST',
      url: `${AUTH_URL}/accounts:signInWithPassword`,
      body: { email, password, returnSecureToken: true }
    });
    return saveAuthResponse(res);
  }

  /** Postman 1.6: Firebase e-mails a password-reset link. */
  async function sendPasswordReset(email) {
    await send({
      method: 'POST',
      url: `${AUTH_URL}/accounts:sendOobCode`,
      body: { requestType: 'PASSWORD_RESET', email }
    });
  }

  /**
   * Postman 1.4: asks the SERVER who owns the current idToken.
   * localStorage can be edited by anyone, so admin pages use this to
   * double-check the e-mail with Firebase itself.
   */
  async function lookupAccount() {
    const idToken = await getIdToken();
    if (!idToken) {
      throw new ApiError(FRIENDLY_MESSAGES.UNAUTHENTICATED, { code: 'UNAUTHENTICATED' });
    }
    const res = await send({ method: 'POST', url: `${AUTH_URL}/accounts:lookup`, body: { idToken } });
    return res.users && res.users[0];
  }

  /* ---------- Customer profiles (customers/{uid}) ---------- */

  /** Postman 4.2: one customer profile. */
  function getCustomer(uid) {
    return getDoc('customers', uid);
  }

  /**
   * Postman 4.1: creates customers/{uid}. The document ID is the Auth uid,
   * so a customer's profile is always easy to find.
   * New customers start with the default credit limit and nothing used.
   */
  function createCustomerProfile({ uid, name, email, mobile }) {
    return createDoc('customers', {
      name,
      email,
      mobile,
      creditLimit: CONFIG.DEFAULT_CREDIT_LIMIT,
      creditUsed: 0,
      createdAt: new Date()
    }, uid);
  }

  /* ---------- Orders ---------- */

  /** Postman 5.3: one order (used by the bill page). */
  function getOrder(id) {
    return getDoc('orders', id);
  }

  /**
   * Postman 5.4: every order of one customer, newest first.
   * "customerId ==" alone needs no composite index. We sort by date in
   * JavaScript instead of asking Firestore to (that would need an index).
   */
  async function getCustomerOrders(customerId) {
    const orders = await runQuery(Query.build({
      from: 'orders',
      where: Query.where('customerId', '==', customerId)
    }));
    return orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /**
   * Postman 5.1 / 5.2: place an order. ONE :commit request, so the writes
   * succeed or fail TOGETHER (atomic): either the order exists AND the stock
   * is reduced (AND credit used is increased), or nothing changes at all.
   *
   *   order            { customerId, customerName, customerEmail, items[], totalAmount, paymentType }
   *   productVersions  { productId: updateTime }  the version of each product we checked
   *   customerVersion  updateTime of the customer document we checked (credit only)
   *
   * currentDocument.updateTime is a PRECONDITION: "only do this write if the
   * document has not changed since I read it". If someone else bought the same
   * product in the meantime, Firestore rejects the WHOLE commit, so stock can
   * never go below zero and credit can never be overspent.
   */
  async function placeOrder({ order, productVersions, customerVersion }) {
    const orderId = 'ORD' + Date.now();
    const writes = [{
      update: {
        name: docName('orders', orderId),
        fields: toFirestore({ ...order, status: 'PLACED' }).fields
      },
      // createdAt is stamped by the SERVER, so a wrong clock on the shopper's computer cannot fake it.
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { exists: false } // never overwrite an existing order
    }];

    order.items.forEach((item) => {
      writes.push({
        transform: {
          document: docName('inventory', item.productId),
          // increment by a NEGATIVE number = subtract. Done by the server, so it is race-safe.
          fieldTransforms: [{ fieldPath: 'qty', increment: { integerValue: String(-item.qty) } }]
        },
        currentDocument: { updateTime: productVersions[item.productId] }
      });
    });

    if (order.paymentType === 'credit') {
      writes.push({
        transform: {
          document: docName('customers', order.customerId),
          fieldTransforms: [{ fieldPath: 'creditUsed', increment: { doubleValue: order.totalAmount } }]
        },
        currentDocument: { updateTime: customerVersion }
      });
    }

    await commit(writes);
    return orderId;
  }

  /**
   * Sends the bill by e-mail through EmailJS (a different server from Firebase).
   * OFF by default (CONFIG.EMAIL.ENABLED). It NEVER throws: if the e-mail fails the
   * order is still placed, so the shopper just does not get the copy.
   * Returns true when EmailJS accepted the message.
   */
  async function sendOrderEmail(order, orderId) {
    const settings = CONFIG.EMAIL;
    if (!settings.ENABLED || !settings.SERVICE_ID || !settings.TEMPLATE_ID || !settings.PUBLIC_KEY) return false;

    const items = order.items
      .map((item) => `${item.title} x ${item.qty} = ${Ui.formatMoney(item.lineTotal)}`)
      .join('\n');
    try {
      await $.ajax({
        url: 'https://api.emailjs.com/api/v1.0/email/send',
        method: 'POST',
        contentType: 'application/json',
        timeout: 8000,
        data: JSON.stringify({
          service_id: settings.SERVICE_ID,
          template_id: settings.TEMPLATE_ID,
          user_id: settings.PUBLIC_KEY,
          template_params: {
            to_email: order.customerEmail,
            to_name: order.customerName,
            order_id: orderId,
            order_total: Ui.formatMoney(order.totalAmount),
            payment: order.paymentType === 'credit' ? 'ShopNest credit' : 'Cash',
            order_date: Ui.formatDate(new Date()),
            items
          }
        })
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  /* ---------- Reports (admin) ---------- */

  /**
   * Postman 5.5: every order created between two moments (inclusive).
   * A range on ONE field (createdAt) needs no composite index. Cash / credit
   * and customers are separated afterwards in JavaScript (see reports-calc.js).
   */
  function getOrdersBetween(from, to) {
    return runQuery(Query.build({
      from: 'orders',
      where: Query.and(Query.where('createdAt', '>=', from), Query.where('createdAt', '<=', to)),
      orderBy: Query.orderBy('createdAt', 'desc')
    }));
  }

  /** Every order ever placed, newest first (dashboard totals). */
  async function getAllOrders() {
    const orders = await listAll('orders', 'createdAt');
    return orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /** Every product, active or hidden, A to Z (inventory reports). */
  function listAllProducts() {
    return listAll('inventory', 'title');
  }

  /** The products with the least stock first (qty < LOW_STOCK). One range + the same field in orderBy = no index needed. */
  function lowStockProducts(limit = 5) {
    return runQuery(Query.build({
      from: 'inventory',
      where: Query.where('qty', '<', CONFIG.LOW_STOCK),
      orderBy: Query.orderBy('qty'),
      limit
    }));
  }

  /* ---------- Customers (admin) ---------- */

  /** Postman 4.3: one page of customers, A to Z by name, using pageToken. */
  function listCustomers({ pageSize = CONFIG.ADMIN_PAGE_SIZE, pageToken } = {}) {
    return listDocs('customers', { pageSize, orderBy: 'name', pageToken });
  }

  /** Every customer (for the summary totals). Fine for a small shop. */
  function listAllCustomers() {
    return listAll('customers', 'name');
  }

  /** "email starts with ..." (e-mails are stored in lower case, so this search is easy). */
  function emailPrefixFilter(term) {
    return Query.and(
      Query.where('email', '>=', term),
      Query.where('email', '<=', term + '')
    );
  }

  /** One page of customers whose e-mail starts with `term`. */
  function searchCustomersByEmail(term, { limit = CONFIG.ADMIN_PAGE_SIZE, offset = 0 } = {}) {
    return runQuery(Query.build({
      from: 'customers',
      where: emailPrefixFilter(term),
      orderBy: Query.orderBy('email'),
      limit,
      offset
    }));
  }

  function countCustomers(where) {
    return count('customers', where);
  }

  /** Postman 4.4: change ONLY the credit limit (updateMask = creditLimit). */
  function updateCreditLimit(uid, creditLimit) {
    return updateDoc('customers', uid, { creditLimit });
  }

  /* ---------- Inventory (admin) ---------- */

  /** Postman 3.2: one product. */
  function getProduct(id) {
    return getDoc('inventory', id);
  }

  /** Postman 3.3 / 3.4: one page of ALL products, A to Z, using pageToken. */
  function listProducts({ pageSize = CONFIG.ADMIN_PAGE_SIZE, pageToken } = {}) {
    return listDocs('inventory', { pageSize, orderBy: 'title', pageToken });
  }

  /**
   * Postman 3.5: one page of products in a category (limit + offset).
   * There is no orderBy here: "catId ==" plus "orderBy title" would need a
   * composite index. Firestore then returns documents in ID order, which is
   * stable, so pages never overlap. The page itself is sorted A to Z in JS.
   */
  async function productsByCategory(catId, { limit = CONFIG.ADMIN_PAGE_SIZE, offset = 0 } = {}) {
    const items = await runQuery(Query.build({
      from: 'inventory',
      where: Query.where('catId', '==', catId),
      limit,
      offset
    }));
    return items.sort((a, b) => a.title.localeCompare(b.title));
  }

  /**
   * Filter for "title starts with <term>" (Postman 3.6).
   * Firestore has no "contains" search. Instead we ask for titles between
   * "Wire" and "Wire".  is a very high Unicode character, so
   * every title that STARTS with "Wire" falls inside that range.
   */
  function titlePrefixFilter(term) {
    return Query.and(
      Query.where('title', '>=', term),
      Query.where('title', '<=', term + '')
    );
  }

  /** One page of products whose title starts with `term` (case-sensitive). */
  function searchProducts(term, { limit = CONFIG.ADMIN_PAGE_SIZE, offset = 0 } = {}) {
    return runQuery(Query.build({
      from: 'inventory',
      where: titlePrefixFilter(term),
      orderBy: Query.orderBy('title'),
      limit,
      offset
    }));
  }

  /** Postman 3.12: how many products match (all, by category, by search, ...). */
  function countProducts(where) {
    return count('inventory', where);
  }

  /** Postman 3.1: new product. Firestore creates the ID. */
  function createProduct(product) {
    const now = new Date();
    return createDoc('inventory', { ...product, createdAt: now, updatedAt: now });
  }

  /** Postman 3.7: change any fields except the ID (only the fields passed are updated). */
  function updateProduct(id, changes) {
    return updateDoc('inventory', id, { ...changes, updatedAt: new Date() });
  }

  /** Postman 3.8 / 3.9: deactivate (hide from the store) or activate again. */
  function setProductActive(id, isActive) {
    return updateDoc('inventory', id, { isActive, updatedAt: new Date() });
  }

  /** Postman 3.13: remove permanently. */
  function deleteProduct(id) {
    return deleteDoc('inventory', id);
  }

  /* ---------- Store catalogue (customers) ---------- */

  // The store needs the active products in several places (trending row,
  // catalogue, related items). We keep the Promise of the first request, so
  // the server is asked only ONCE per page load.
  let activeProductsPromise = null;

  /**
   * EVERY active product, in one request (runQuery isActive == true).
   * An equality filter alone needs no composite index. The store then filters,
   * searches, sorts and paginates these in JavaScript, which is fast for a
   * catalogue of a few hundred items and allows "contains" search.
   */
  function getActiveProducts(forceReload = false) {
    if (!activeProductsPromise || forceReload) {
      activeProductsPromise = runQuery(Query.build({
        from: 'inventory',
        where: Query.where('isActive', '==', true)
      })).catch((error) => {
        activeProductsPromise = null; // allow a retry after a failure
        throw error;
      });
    }
    return activeProductsPromise;
  }

  /** A few active products for the home page "Trending now" row. */
  async function getFeaturedProducts(limit = 8) {
    const all = await getActiveProducts();
    return all.slice(0, limit);
  }

  // Public API of this module
  return {
    // converters
    toFirestore,
    fromFirestore,
    toValue,
    // errors + session
    ApiError,
    session,
    getIdToken,
    refreshSession,
    // generic Firestore
    getDoc,
    listDocs,
    listAll,
    createDoc,
    updateDoc,
    deleteDoc,
    runQuery,
    count,
    commit,
    docName,
    Query,
    // auth
    signUp,
    signIn,
    sendPasswordReset,
    lookupAccount,
    // customers
    getCustomer,
    createCustomerProfile,
    listCustomers,
    listAllCustomers,
    emailPrefixFilter,
    searchCustomersByEmail,
    countCustomers,
    updateCreditLimit,
    // catalogue
    getCategories,
    getActiveProducts,
    getFeaturedProducts,
    // orders
    sendOrderEmail,
    getOrder,
    getCustomerOrders,
    placeOrder,
    // reports (admin)
    getOrdersBetween,
    getAllOrders,
    listAllProducts,
    lowStockProducts,
    // inventory (admin)
    getProduct,
    listProducts,
    productsByCategory,
    searchProducts,
    titlePrefixFilter,
    countProducts,
    createProduct,
    updateProduct,
    setProductActive,
    deleteProduct
  };
})();
