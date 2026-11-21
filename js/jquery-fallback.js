/* =====================================================================
   jquery-fallback.js - loads our local copy of jQuery if the CDN failed.
   Every page first tries the official jQuery CDN (fast, often cached).
   If that fails (no internet, CDN blocked), window.jQuery is undefined,
   so we write a <script> tag for /vendor/jquery-3.7.1.min.js instead.
   document.currentScript.src is this file's own URL, so the path works
   from root pages and from /admin pages alike.
   ===================================================================== */
if (!window.jQuery) {
  const localJquery = new URL('../vendor/jquery-3.7.1.min.js', document.currentScript.src).href;
  document.write('<script src="' + localJquery + '"><\/script>');
}
