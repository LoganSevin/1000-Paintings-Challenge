/**
 * Space out /api/jobs/<id> status polls (Netlify credits).
 *
 * Generation tabs poll job status every 0.6–1.5s. Rather than touch every
 * loop, this wraps fetch once: the first GET for a job goes out immediately,
 * later GETs for the same job wait until at least 2s after the previous one,
 * growing by 250ms per poll up to 3s. Loops, timeouts and results are
 * unchanged; the loops just see slightly slower responses. Aborts are honored
 * while a poll is waiting.
 */
(function () {
  "use strict";
  if (typeof window.fetch !== "function" || window.__jobPollThrottle) return;
  window.__jobPollThrottle = true;

  var MIN_GAP_MS = 2000;
  var MAX_GAP_MS = 3000;
  var STEP_MS = 250;
  var FORGET_MS = 10 * 60 * 1000;
  var JOB_RE = /\/api\/jobs\/([^/?#]+)/;
  var jobs = {};
  var jobCount = 0;
  var origFetch = window.fetch;

  function jobKey(input, init) {
    var url = "";
    var method = "GET";
    if (typeof input === "string") url = input;
    else if (input && typeof input.url === "string") {
      url = input.url;
      method = input.method || method;
    } else if (input) url = String(input);
    if (init && init.method) method = init.method;
    if (String(method).toUpperCase() !== "GET") return null;
    var m = JOB_RE.exec(url);
    return m ? m[1] : null;
  }

  function abortError(signal) {
    if (signal && signal.reason) return signal.reason;
    try {
      return new DOMException("The operation was aborted.", "AbortError");
    } catch (e) {
      var err = new Error("The operation was aborted.");
      err.name = "AbortError";
      return err;
    }
  }

  function wait(ms, signal) {
    return new Promise(function (resolve, reject) {
      if (signal && signal.aborted) return reject(abortError(signal));
      var t = setTimeout(resolve, ms);
      if (signal && signal.addEventListener) {
        signal.addEventListener(
          "abort",
          function () {
            clearTimeout(t);
            reject(abortError(signal));
          },
          { once: true }
        );
      }
    });
  }

  function prune(now) {
    if (jobCount < 200) return;
    Object.keys(jobs).forEach(function (k) {
      if (now - jobs[k].last > FORGET_MS) {
        delete jobs[k];
        jobCount -= 1;
      }
    });
  }

  window.fetch = function (input, init) {
    var key = jobKey(input, init);
    if (!key) return origFetch.apply(this, arguments);
    var now = Date.now();
    prune(now);
    var st = jobs[key];
    if (!st || now - st.last > FORGET_MS) {
      if (!st) jobCount += 1;
      st = jobs[key] = { next: 0, polls: 0, last: 0 };
    }
    var at = Math.max(now, st.next);
    st.next = at + Math.min(MAX_GAP_MS, MIN_GAP_MS + STEP_MS * st.polls);
    st.polls += 1;
    st.last = at;
    var self = this;
    var args = arguments;
    if (at <= now) return origFetch.apply(self, args);
    var signal = (init && init.signal) || (input && input.signal) || null;
    return wait(at - now, signal).then(function () {
      return origFetch.apply(self, args);
    });
  };
})();
