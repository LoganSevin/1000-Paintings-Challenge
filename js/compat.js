/* Microsoft Edge / legacy browser helpers */
(function () {
  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
      dialog.style.display = "flex";
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
      dialog.style.display = "none";
    }
  }

  function bindStasisVisionDialog() {
    var dlg = document.getElementById("spell-stasis-vision-dialog");
    var closeBtn = document.getElementById("spell-stasis-vision-dialog-close");
    if (!dlg) return;

    if (closeBtn && !closeBtn.dataset.galleryDialogBound) {
      closeBtn.dataset.galleryDialogBound = "1";
      closeBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeDialog(dlg);
      });
    }

    if (!dlg.dataset.galleryDialogBound) {
      dlg.dataset.galleryDialogBound = "1";
      dlg.addEventListener("click", function (e) {
        if (e.target === dlg) closeDialog(dlg);
      });
      dlg.addEventListener("cancel", function (e) {
        e.preventDefault();
        closeDialog(dlg);
      });
    }
  }

  window.galleryDialog = { open: openDialog, close: closeDialog, bindStasisVisionDialog: bindStasisVisionDialog };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindStasisVisionDialog);
  } else {
    bindStasisVisionDialog();
  }

  if (!window.fetch) {
    window.fetch = function (url, opts) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open(opts && opts.method ? opts.method : "GET", url, true);
        if (opts && opts.headers) {
          Object.keys(opts.headers).forEach(function (k) {
            xhr.setRequestHeader(k, opts.headers[k]);
          });
        }
        xhr.onload = function () {
          resolve({
            ok: xhr.status >= 200 && xhr.status < 300,
            status: xhr.status,
            json: function () {
              return Promise.resolve(JSON.parse(xhr.responseText));
            },
            text: function () {
              return Promise.resolve(xhr.responseText);
            },
          });
        };
        xhr.onerror = reject;
        xhr.send(opts && opts.body ? opts.body : null);
      });
    };
  }
})();