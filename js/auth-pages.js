/* =====================================================================
   auth-pages.js - the Sign in, Sign up and Reset password forms.
   Each init function checks whether its form is on the page, so one
   file serves all three pages.

   Flow of every form:
     1. validate in the browser (js/validation.js)      -> stop if wrong
     2. disable the button + spinner (no double submit)
     3. call the server through js/api.js
     4. success: save a flash message and redirect
        failure: friendly toast, button enabled again
   ===================================================================== */

(function () {
  const R = Validate.rules;
  const RESEND_COOLDOWN_SECONDS = 30;

  /* ------------------------------------------------------------------
     Shared helpers
     ------------------------------------------------------------------ */

  /** E-mails are stored trimmed and in lower case, so "A@B.com" and "a@b.com" are one account. */
  function cleanEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  /** "  priya   sharma " -> "priya sharma" */
  function cleanName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  /** "98765 43210" -> "9876543210" */
  function cleanMobile(value) {
    return String(value || '').replace(/[\s-]/g, '');
  }

  /** After signing in: go back to the page that sent us here, or to the user's home. */
  function redirectAfterSignIn(user) {
    const target = Auth.safeRedirect(Ui.getQueryParam('redirect')) || Auth.homeFor(user);
    Auth.go(target);
  }

  /** Keeps ?redirect=... when moving between the sign-in and sign-up pages. */
  function keepRedirectOn($link) {
    const redirect = Auth.safeRedirect(Ui.getQueryParam('redirect'));
    if (redirect && $link.length) {
      $link.attr('href', $link.attr('href') + '?redirect=' + encodeURIComponent(redirect));
    }
  }

  // Show / hide password (eye button inside the password box).
  $(document).on('click', '[data-toggle-password]', function () {
    const $button = $(this);
    const $input = $('#' + $button.attr('aria-controls'));
    const show = $input.attr('type') === 'password';
    $input.attr('type', show ? 'text' : 'password');
    $button
      .attr('aria-pressed', String(show))
      .attr('aria-label', show ? 'Hide password' : 'Show password')
      .html(Icons.svg(show ? 'eyeOff' : 'eye', 20));
  });

  /* ------------------------------------------------------------------
     Sign in
     ------------------------------------------------------------------ */
  function initLogin() {
    const $form = $('#login-form');
    if (!$form.length) return;

    const schema = {
      'login-email': [R.required('Please enter your e-mail address.'), R.email()],
      'login-password': [R.required('Please enter your password.')]
    };
    Validate.live($form, schema);
    keepRedirectOn($('#signup-link'));

    // Pre-fill the e-mail if we came from sign-up or reset (?email=...).
    const presetEmail = Ui.getQueryParam('email');
    if (presetEmail) {
      $('#login-email').val(presetEmail);
      $('#login-password').trigger('focus');
    }

    // "Forgot password?" carries the typed e-mail to the reset page.
    $('#forgot-link').on('click', function () {
      const email = cleanEmail($('#login-email').val());
      $(this).attr('href', 'reset-password.html' + (email ? '?email=' + encodeURIComponent(email) : ''));
    });

    $form.on('submit', async (event) => {
      event.preventDefault();
      if (!Validate.form($form, schema)) return;

      const $button = $('#login-submit');
      Ui.setBusy($button, true, 'Signing in...');
      try {
        const user = await Api.signIn(cleanEmail($('#login-email').val()), $('#login-password').val());
        const fullUser = await Auth.finishSignIn(user);
        Auth.setFlash(`Welcome back, ${fullUser.name}!`, 'success', 'Signed in');
        redirectAfterSignIn(fullUser);
      } catch (error) {
        Api.session.clear(); // never stay "half signed in"
        Ui.setBusy($button, false);
        Ui.showError(error, 'Could not sign in');
        $('#login-password').val('').trigger('focus');
      }
    });
  }

  /* ------------------------------------------------------------------
     Sign up
     ------------------------------------------------------------------ */

  /** Draws the password checklist once; updatePasswordChecklist() ticks the items. */
  function renderPasswordChecklist() {
    const items = Object.keys(Validate.PASSWORD_CHECKS).map((key) => `
      <li data-check="${key}">
        ${Icons.svg('checkCircle', 16)}
        <span>${Validate.PASSWORD_CHECKS[key].text}</span>
        <span class="visually-hidden" data-status>(not yet)</span>
      </li>`).join('');
    $('#password-rules').html(items);
  }

  function updatePasswordChecklist(value) {
    const report = Validate.passwordReport(value);
    let score = 0;
    Object.keys(report).forEach((key) => {
      const met = report[key];
      if (met) score++;
      const $item = $(`#password-rules [data-check="${key}"]`);
      $item.toggleClass('is-met', met);
      $item.find('[data-status]').text(met ? '(done)' : '(not yet)');
    });
    $('#password-strength').attr('data-score', value ? score : 0);
  }

  function initSignup() {
    const $form = $('#signup-form');
    if (!$form.length) return;

    const schema = {
      'signup-name': [R.required('Please enter your name.'), R.name()],
      'signup-email': [
        R.required('Please enter your e-mail address.'),
        R.email(),
        R.notOneOf([CONFIG.ADMIN_EMAIL], 'This e-mail is reserved for the store admin. Please use another one.')
      ],
      'signup-mobile': [R.required('Please enter your mobile number.'), R.mobile()],
      'signup-password': [R.required('Please choose a password.'), R.strongPassword()],
      'signup-confirm': [R.required('Please type your password again.'), R.matches('signup-password')]
    };
    Validate.live($form, schema);
    keepRedirectOn($('#login-link'));

    renderPasswordChecklist();
    $('#signup-password').on('input', function () {
      updatePasswordChecklist($(this).val());
      // If "confirm" was already filled, re-check that it still matches.
      if ($('#signup-confirm').val()) Validate.checkField('signup-confirm', schema['signup-confirm']);
    });

    $form.on('submit', async (event) => {
      event.preventDefault();
      if (!Validate.form($form, schema)) return;

      const name = cleanName($('#signup-name').val());
      const email = cleanEmail($('#signup-email').val());
      const mobile = cleanMobile($('#signup-mobile').val());
      const $button = $('#signup-submit');
      Ui.setBusy($button, true, 'Creating your account...');

      // Step 1: create the Firebase Auth user (this also signs them in).
      let user;
      try {
        user = await Api.signUp(email, $('#signup-password').val());
      } catch (error) {
        Ui.setBusy($button, false);
        if (error.code === 'EMAIL_EXISTS') {
          Validate.showError($('#signup-email'), error.message);
          $('#signup-email').trigger('focus');
        }
        Ui.showError(error, 'Could not create your account');
        return;
      }

      // Step 2: create the customers/{uid} profile with the starter credit.
      try {
        await Api.createCustomerProfile({ uid: user.uid, name, email, mobile });
        Api.session.save({ name });
        Auth.setFlash(
          `Welcome to ShopNest, ${name}! ${Ui.formatMoney(CONFIG.DEFAULT_CREDIT_LIMIT)} of credit is ready for you.`,
          'success',
          'Account created'
        );
        redirectAfterSignIn(user);
      } catch (error) {
        // The Auth account exists, but the profile could not be saved.
        // Signing in again repairs it (see Auth.finishSignIn).
        Api.session.clear();
        Auth.setFlash('Your account was created. Please sign in once to finish setting up your profile.', 'warning', 'Almost there');
        Auth.go('login.html?email=' + encodeURIComponent(email));
      }
    });
  }

  /* ------------------------------------------------------------------
     Reset password
     ------------------------------------------------------------------ */
  function initReset() {
    const $form = $('#reset-form');
    if (!$form.length) return;

    const schema = {
      'reset-email': [R.required('Please enter your e-mail address.'), R.email()]
    };
    Validate.live($form, schema);

    const presetEmail = Ui.getQueryParam('email');
    if (presetEmail) $('#reset-email').val(presetEmail);

    let sentTo = '';

    /** Disables "Resend" for a while so people don't flood their inbox. */
    function startCooldown() {
      const $resend = $('#reset-resend');
      let secondsLeft = RESEND_COOLDOWN_SECONDS;
      $resend.prop('disabled', true).text(`Resend link in ${secondsLeft}s`);
      const timer = setInterval(() => {
        secondsLeft--;
        if (secondsLeft <= 0) {
          clearInterval(timer);
          $resend.prop('disabled', false).text('Resend link');
        } else {
          $resend.text(`Resend link in ${secondsLeft}s`);
        }
      }, 1000);
    }

    /**
     * For privacy we always show the same "check your inbox" message,
     * even if no account uses that e-mail. Otherwise this page would let
     * strangers find out who has an account.
     */
    async function sendLink(email, $button, busyText) {
      Ui.setBusy($button, true, busyText);
      try {
        await Api.sendPasswordReset(email);
      } catch (error) {
        if (error.code !== 'EMAIL_NOT_FOUND') {
          Ui.setBusy($button, false);
          Ui.showError(error, 'Could not send the e-mail');
          return false;
        }
      }
      Ui.setBusy($button, false);
      return true;
    }

    $form.on('submit', async (event) => {
      event.preventDefault();
      if (!Validate.form($form, schema)) return;

      sentTo = cleanEmail($('#reset-email').val());
      const ok = await sendLink(sentTo, $('#reset-submit'), 'Sending...');
      if (!ok) return;

      $('#reset-sent-to').text(sentTo);
      $('#reset-back-login').attr('href', 'login.html?email=' + encodeURIComponent(sentTo));
      $('#reset-request').prop('hidden', true);
      $('#reset-done').prop('hidden', false);
      $('#reset-done-title').trigger('focus'); // move screen-reader focus to the new message
      startCooldown();
    });

    $('#reset-resend').on('click', async function () {
      const ok = await sendLink(sentTo, $(this), 'Sending...');
      if (ok) {
        Ui.toast(`We sent another link to ${sentTo}.`, 'success', { title: 'Link sent' });
        startCooldown();
      }
    });
  }

  $(function () {
    $('[data-credit-amount]').text(Ui.formatMoney(CONFIG.DEFAULT_CREDIT_LIMIT));
    initLogin();
    initSignup();
    initReset();
  });
})();
