/**
 * List paintings for sale on X with Cash App QR (bottom-right).
 * On sale: download clean image (no QR) and remove from for-sale list.
 */
(function () {
  "use strict";

  var QR_ASSET = "assets/cashapp-logan7in-qr.png";
  var catalog = { for_sale: [], sold_count: 0 };
  var queue = [];
  var queueIndex = 0;
  var posting = false;

  function $(id) {
    return document.getElementById(id);
  }

  function siteUrl() {
    if (window.MonetizeX && MonetizeX.siteUrl) return MonetizeX.siteUrl();
    try {
      var h = (location.hostname || "").toLowerCase();
      if (/netlify\.app$/i.test(h) || /github\.io$/i.test(h) || /pages\.dev$/i.test(h)) {
        return location.protocol + "//" + location.host + "/";
      }
    } catch (e) {}
    return "https://1000-l7in.netlify.app/";
  }

  function cashTag() {
    return "Logan7in";
  }

  function priceFor() {
    if (window.GalleryShop && GalleryShop.getCollectionPrice) {
      return GalleryShop.getCollectionPrice("paintings");
    }
    return 89;
  }

  function setStatus(msg, isErr) {
    ["sax-status", "mx-sale-status"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.hidden = !msg;
      el.textContent = msg || "";
      el.classList.toggle("sax-err", !!isErr);
    });
  }

  function watermarkUrl(n) {
    return "/api/sale-art/watermarked?n=" + encodeURIComponent(n) + "&t=" + Date.now();
  }

  function cleanUrl(n, download) {
    return (
      "/api/sale-art/clean?n=" +
      encodeURIComponent(n) +
      (download ? "&download=1" : "") +
      "&t=" +
      Date.now()
    );
  }

  function xCaption(item) {
    var n = item.number;
    var price = item.price_usd != null ? item.price_usd : priceFor();
    var site = siteUrl();
    return (
      "FOR SALE — Painting #" +
      n +
      " · $" +
      Math.round(price) +
      " · Tip/buy Cash App $" +
      cashTag() +
      " (QR on image) · gallery " +
      site +
      " · Art by Logan Sevin · © Logan Sevin · #artforsale #painting #originalart"
    );
  }

  function openXWithCaption(text) {
    var url = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function triggerDownload(url, filename) {
    var a = document.createElement("a");
    a.href = url;
    a.download = filename || "download.jpg";
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      a.remove();
    }, 500);
  }

  function downloadWatermarked(n) {
    triggerDownload(watermarkUrl(n), "sale-qr-" + n + ".jpg");
  }

  function downloadClean(n) {
    triggerDownload(cleanUrl(n, true), "sold-clean-" + n + ".jpg");
  }

  /** Client-side QR composite fallback if API watermark fails */
  function composeClientWatermark(imgUrl, n) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var qr = new Image();
      img.crossOrigin = "anonymous";
      qr.crossOrigin = "anonymous";
      var done = 0;
      function tryDraw() {
        done++;
        if (done < 2) return;
        try {
          var c = document.createElement("canvas");
          c.width = img.naturalWidth || img.width;
          c.height = img.naturalHeight || img.height;
          var ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0);
          var side = Math.max(72, Math.floor(Math.min(c.width, c.height) * 0.16));
          var m = Math.max(8, Math.floor(side * 0.1));
          var px = c.width - side - m;
          var py = c.height - side - m;
          ctx.fillStyle = "rgba(255,255,255,0.82)";
          ctx.fillRect(px - 4, py - 4, side + 8, side + 22);
          ctx.drawImage(qr, px, py, side, side);
          ctx.fillStyle = "rgba(0,0,0,0.75)";
          ctx.fillRect(px - 4, py + side + 2, side + 8, 16);
          ctx.fillStyle = "#fff";
          ctx.font = "12px sans-serif";
          ctx.fillText("$" + cashTag(), px, py + side + 14);
          c.toBlob(
            function (blob) {
              if (!blob) return reject(new Error("blob"));
              resolve(blob);
            },
            "image/jpeg",
            0.9
          );
        } catch (e) {
          reject(e);
        }
      }
      img.onload = tryDraw;
      qr.onload = tryDraw;
      img.onerror = function () {
        reject(new Error("img"));
      };
      qr.onerror = function () {
        reject(new Error("qr"));
      };
      img.src = imgUrl;
      qr.src = QR_ASSET;
    });
  }

  function loadCatalog(limit) {
    var q = limit ? "?limit=" + limit : "";
    return fetch("/api/sale-art/catalog" + q + (q ? "&" : "?") + "t=" + Date.now(), {
      cache: "no-store",
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (data && data.ok) {
          catalog = data;
          renderUi();
        }
        return data;
      })
      .catch(function () {
        return null;
      });
  }

  function renderUi() {
    var countEl = $("sax-for-sale-count");
    if (countEl) {
      countEl.textContent = String(
        catalog.for_sale_count != null ? catalog.for_sale_count : (catalog.for_sale || []).length
      );
    }
    var soldEl = $("sax-sold-count");
    if (soldEl) soldEl.textContent = String(catalog.sold_count || 0);
    var totalEl = $("sax-total");
    if (totalEl) totalEl.textContent = String(catalog.total_paintings || 0);
    var prog = $("sax-progress");
    if (prog && posting) {
      prog.textContent = "Posting " + (queueIndex + 1) + " / " + queue.length;
    } else if (prog) {
      prog.textContent = "";
    }
  }

  function markSoldOnServer(numbers, orderId, items) {
    return fetch("/api/sale-art/sold", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numbers: numbers,
        order_id: orderId || null,
        items: items || [],
      }),
    }).then(function (r) {
      return r.json();
    });
  }

  /**
   * After real sale confirmed: download CLEAN images (no QR) + delist watermarked.
   */
  function onSaleComplete(items, orderId) {
    items = items || [];
    var nums = [];
    items.forEach(function (it) {
      if (!it) return;
      if (it.collection === "paintings" && it.number != null) {
        nums.push(parseInt(it.number, 10));
      } else if (String(it.id || "").indexOf("painting:") === 0) {
        var n = parseInt(String(it.id).split(":")[1], 10);
        if (n) nums.push(n);
      }
    });
    nums = nums.filter(function (n) {
      return n >= 1;
    });
    if (!nums.length) {
      // Still try to download non-painting assets clean
      items.forEach(function (it, i) {
        if (it && it.imageUrl) {
          setTimeout(function () {
            triggerDownload(it.imageUrl, "sold-" + (it.number || i) + ".jpg");
          }, i * 400);
        }
      });
      return Promise.resolve(null);
    }
    return markSoldOnServer(nums, orderId, items)
      .then(function (data) {
        if (data && data.ok && data.downloads) {
          data.downloads.forEach(function (d, i) {
            setTimeout(function () {
              downloadClean(d.number);
            }, i * 500);
          });
          setStatus(
            "Sale complete: downloaded clean art (no Cash App QR). Watermarked listings removed for #" +
              nums.join(", ")
          );
        } else {
          nums.forEach(function (n, i) {
            setTimeout(function () {
              downloadClean(n);
            }, i * 500);
          });
          setStatus("Clean downloads started (no QR watermark).", !data || !data.ok);
        }
        loadCatalog();
        return data;
      })
      .catch(function () {
        nums.forEach(function (n, i) {
          setTimeout(function () {
            downloadClean(n);
          }, i * 500);
        });
        setStatus("Downloaded clean files locally.", true);
      });
  }

  function postOne(item) {
    // Download watermarked (QR bottom-right) for user to attach on X
    downloadWatermarked(item.number);
    openXWithCaption(xCaption(item));
    setStatus(
      "Downloaded sale image with Cash App QR (bottom-right) for #" +
        item.number +
        ". Attach that file to the X post that just opened."
    );
  }

  function startPostAll(limit) {
    if (posting) {
      setStatus("Already posting — use Next or Stop.");
      return;
    }
    setStatus("Loading for-sale catalog…");
    // Load full or capped list (default 100 at a time for UX)
    var cap = limit != null ? limit : 50;
    fetch("/api/sale-art/catalog?limit=" + cap + "&t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.ok || !(data.for_sale || []).length) {
          setStatus("No unsold paintings to list (or server offline).", true);
          return;
        }
        catalog = data;
        queue = data.for_sale.slice();
        queueIndex = 0;
        posting = true;
        renderUi();
        setStatus(
          "Ready: " +
            queue.length +
            " pieces. Each step downloads QR-watermarked image + opens X. Attach the download to the post."
        );
        postNext();
      })
      .catch(function () {
        setStatus("Could not load catalog — is start_server.bat running?", true);
      });
  }

  function postNext() {
    if (!posting || queueIndex >= queue.length) {
      posting = false;
      setStatus("Done posting queue (" + queue.length + " pieces). Attach each downloaded QR image on X.");
      renderUi();
      return;
    }
    var item = queue[queueIndex];
    postOne(item);
    renderUi();
    var auto = $("sax-auto-next");
    if (auto && auto.checked) {
      setTimeout(function () {
        queueIndex++;
        postNext();
      }, 3500);
    }
  }

  function bind() {
    function wirePostAll(id, limit) {
      var el = $(id);
      if (!el) return;
      el.addEventListener("click", function () {
        startPostAll(limit);
      });
    }
    wirePostAll("sax-post-all", 50);
    wirePostAll("sax-post-all-100", 100);
    wirePostAll("sax-post-all-toolbar", 50);
    $("sax-next") &&
      $("sax-next").addEventListener("click", function () {
        if (!posting) {
          startPostAll(50);
          return;
        }
        queueIndex++;
        postNext();
      });
    $("sax-stop") &&
      $("sax-stop").addEventListener("click", function () {
        posting = false;
        setStatus("Stopped at " + queueIndex + " / " + queue.length);
        renderUi();
      });
    $("sax-refresh") &&
      $("sax-refresh").addEventListener("click", function () {
        loadCatalog();
      });
    $("sax-post-one") &&
      $("sax-post-one").addEventListener("click", function () {
        var n = parseInt(($("sax-one-num") && $("sax-one-num").value) || "0", 10);
        if (!(n >= 1)) {
          setStatus("Enter a painting number.", true);
          return;
        }
        postOne({ number: n, price_usd: priceFor() });
      });

    window.addEventListener("tab-changed", function (e) {
      if (e.detail && (e.detail.tab === "income" || e.detail.tab === "gallery")) {
        loadCatalog();
      }
    });
  }

  function init() {
    bind();
    loadCatalog();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.SaleArtX = {
    onSaleComplete: onSaleComplete,
    postOne: postOne,
    startPostAll: startPostAll,
    downloadClean: downloadClean,
    downloadWatermarked: downloadWatermarked,
    loadCatalog: loadCatalog,
    watermarkUrl: watermarkUrl,
    cleanUrl: cleanUrl,
  };
})();
