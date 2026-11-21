/* =====================================================================
   validation.js - reusable form validation.

   A RULE is a small function: it receives the field's value and returns
   an error message, or '' (empty string) when the value is fine.

   A SCHEMA says which rules apply to which input (by id):
     const schema = {
       'signup-email':  [Validate.rules.required('Please enter your e-mail.'), Validate.rules.email()],
       'signup-mobile': [Validate.rules.mobile()]
     };

   Validate.form($form, schema) checks every field, shows the messages
   under the inputs, focuses the first wrong field and returns true/false.
   Validate.live($form, schema) re-checks a field when the user leaves it,
   and while they type once it has shown an error.

   The browser's own validation is switched off with <form novalidate>,
   so every message looks the same and is written in friendly words.
   ===================================================================== */

const Validate = (function () {
  const PATTERNS = {
    // Something@something.something, with no spaces.
    email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
    // Indian mobile: 10 digits, starting with 6, 7, 8 or 9.
    mobile: /^[6-9]\d{9}$/,
    // Letters first, then letters, spaces, dots or apostrophes (2 to 50 characters).
    name: /^[A-Za-z][A-Za-z .']{1,49}$/
  };

  // The four password checks, also used for the live checklist on the sign-up page.
  const PASSWORD_CHECKS = {
    length:  { test: (v) => v.length >= 8,          text: 'At least 8 characters' },
    upper:   { test: (v) => /[A-Z]/.test(v),        text: 'One capital letter (A-Z)' },
    lower:   { test: (v) => /[a-z]/.test(v),        text: 'One small letter (a-z)' },
    digit:   { test: (v) => /\d/.test(v),           text: 'One number (0-9)' },
    special: { test: (v) => /[^A-Za-z0-9]/.test(v), text: 'One symbol, e.g. @ # $ !' }
  };

  /* ------------------------------------------------------------------
     Rules (each returns a function(value) -> message or '')
     ------------------------------------------------------------------ */
  const rules = {
    required(message = 'This field is required.') {
      return (value) => (value.trim() === '' ? message : '');
    },

    email(message = 'Enter a valid e-mail, like name@example.com.') {
      return (value) => (value && !PATTERNS.email.test(value.trim()) ? message : '');
    },

    mobile(message = 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9.') {
      // Spaces and dashes are allowed while typing ("98765 43210"), so remove them first.
      return (value) => (value && !PATTERNS.mobile.test(value.replace(/[\s-]/g, '')) ? message : '');
    },

    name(message = 'Use 2 to 50 letters. Spaces, dots and apostrophes are fine.') {
      return (value) => (value && !PATTERNS.name.test(value.trim()) ? message : '');
    },

    strongPassword(message = 'Your password does not meet all the rules below.') {
      return (value) => {
        if (!value) return '';
        const allPass = Object.values(PASSWORD_CHECKS).every((check) => check.test(value));
        return allPass ? '' : message;
      };
    },

    /** Value must equal another input's value (e.g. "confirm password"). */
    matches(otherInputId, message = 'The two passwords do not match.') {
      return (value) => (value && value !== $('#' + otherInputId).val() ? message : '');
    },

    /** Text length between min and max characters (after trimming spaces). */
    length(min, max, message) {
      return (value) => {
        const len = value.trim().length;
        if (!len) return '';
        return len < min || len > max ? message || `Use ${min} to ${max} characters.` : '';
      };
    },

    /**
     * A number within limits.
     *   integer: true  -> whole numbers only (e.g. quantity)
     *   decimals: 2    -> at most 2 digits after the point (e.g. price in rupees)
     */
    number({ min = -Infinity, max = Infinity, integer = false, decimals = null, message } = {}) {
      return (value) => {
        const text = value.trim();
        if (text === '') return '';
        const n = Number(text);
        const notANumber = !/^-?\d+(\.\d+)?$/.test(text) || Number.isNaN(n);
        const wrongType = integer && !Number.isInteger(n);
        const tooManyDecimals = decimals !== null && (text.split('.')[1] || '').length > decimals;
        if (notANumber || wrongType || tooManyDecimals || n < min || n > max) {
          return message || `Enter a number from ${min} to ${max}.`;
        }
        return '';
      };
    },

    /** Value must match a regular expression (empty values are allowed). */
    pattern(regex, message) {
      return (value) => (value.trim() && !regex.test(value.trim()) ? message : '');
    },

    /** Value must NOT be one of the listed values (compared in lower case). */
    notOneOf(list, message) {
      return (value) => (list.map((item) => item.toLowerCase()).includes(value.trim().toLowerCase()) ? message : '');
    }
  };

  /* ------------------------------------------------------------------
     Showing / clearing messages
     Each input has a <p class="field-error" id="<inputId>-error">
     and aria-describedby pointing at it, so screen readers read the
     message together with the field.
     ------------------------------------------------------------------ */
  function showError($input, message) {
    const id = $input.attr('id');
    $input.addClass('is-invalid').attr('aria-invalid', 'true');
    $('#' + id + '-error').text(message);
  }

  function clearError($input) {
    const id = $input.attr('id');
    $input.removeClass('is-invalid').removeAttr('aria-invalid');
    $('#' + id + '-error').text('');
  }

  /** Runs all rules for one input. The first failing rule wins. Returns true if OK. */
  function checkField(inputId, fieldRules) {
    const $input = $('#' + inputId);
    const value = String($input.val() || '');
    for (const rule of fieldRules) {
      const message = rule(value);
      if (message) {
        showError($input, message);
        return false;
      }
    }
    clearError($input);
    return true;
  }

  /** Checks every field in the schema. Focuses the first wrong one. */
  function form($form, schema) {
    let firstInvalid = null;
    Object.keys(schema).forEach((inputId) => {
      const ok = checkField(inputId, schema[inputId]);
      if (!ok && !firstInvalid) firstInvalid = inputId;
    });
    if (firstInvalid) {
      $('#' + firstInvalid).trigger('focus');
      return false;
    }
    return true;
  }

  /** Validates while the user works: on leaving a field, and on typing after an error. */
  function live($form, schema) {
    Object.keys(schema).forEach((inputId) => {
      const $input = $('#' + inputId);
      $input.on('blur', () => {
        if ($input.val() !== '') checkField(inputId, schema[inputId]);
      });
      $input.on('input', () => {
        if ($input.hasClass('is-invalid')) checkField(inputId, schema[inputId]);
      });
    });
  }

  /** Which password checks pass, e.g. { length: true, upper: false, ... }. */
  function passwordReport(value) {
    const report = {};
    Object.keys(PASSWORD_CHECKS).forEach((key) => {
      report[key] = PASSWORD_CHECKS[key].test(value);
    });
    return report;
  }

  return {
    rules,
    form,
    live,
    checkField,
    showError,
    clearError,
    passwordReport,
    PASSWORD_CHECKS
  };
})();
