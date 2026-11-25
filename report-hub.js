/**
 * 玲玲學習樂園 — 全站雲端戰報箱與儀表板數據橋接腳本 (report-hub.js v3.0)
 * 100% 向下相容舊版 3 參數呼叫：LinglingReport.save(subject, lesson, feedback)
 * 升級支援第 4 參數 meta：{ term, skill_stats, circled_chars, error_words, total_score, avg_sec }
 */
(function () {
  var CLOUD_API_URL = "https://script.google.com/macros/s/AKfycbwQ2ddWL9Fgq_cwA5F_WFp5dPQ-lr0mjQAga8rlSxX2jiVBBVn82xo9oR0TRkCQTchafA/exec";
  var LOCAL_KEY = "lingling_pending_reports_v1";
  var DEFAULT_TERM = "K2-T1";

  function formatNow() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
           p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function getLocalPending() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); }
    catch (e) { return []; }
  }

  function saveLocalPending(list) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch (e) {}
  }

  function cleanStringArray(arr) {
    if (!Array.isArray(arr)) return [];
    var seen = {};
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var s = String(arr[i] || "").trim();
      if (s && !seen[s]) {
        seen[s] = true;
        out.push(s);
      }
    }
    return out;
  }

  function normalizeSkillStats(arr) {
    if (!Array.isArray(arr)) return [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      if (!item || typeof item !== "object") continue;
      var total = Number(item.total);
      var correct = Number(item.correct);
      if (isNaN(total) || total <= 0) continue;
      out.push({
        dim: String(item.dim || "").trim(),
        skill_id: String(item.skill_id || "").trim(),
        level: String(item.level || "L1").trim(),
        total: total,
        correct: isNaN(correct) ? 0 : Math.max(0, Math.min(total, correct)),
        avg_sec: (item.avg_sec !== undefined && item.avg_sec !== null && !isNaN(Number(item.avg_sec)))
          ? Math.round(Number(item.avg_sec) * 10) / 10
          : 0
      });
    }
    return out;
  }

  // 全站課堂／測驗結算時呼叫：
  // LinglingReport.save('科目', '關卡名', '完整戰報文字', { term, skill_stats, circled_chars, error_words })
  function saveReport(subject, lesson, feedback, meta) {
    var opts = (meta && typeof meta === "object") ? meta : {};
    var term = String(opts.term || DEFAULT_TERM).trim() || DEFAULT_TERM;
    var skillStats = normalizeSkillStats(opts.skill_stats || opts.skillStats);
    var circledChars = cleanStringArray(opts.circled_chars || opts.circledChars);
    var errorWords = cleanStringArray(opts.error_words || opts.errorWords);

    var finalFeedback = String(feedback || "");

    // 雙保險：若呼叫端把圈出字或錯題放在 meta 但文字未帶入，自動補上確保儀表板完整讀取
    if (circledChars.length > 0 && finalFeedback.indexOf("圈出識字清單") === -1) {
      finalFeedback += (finalFeedback ? " | " : "") + "圈出識字清單: " + circledChars.join("、");
    }
    if (errorWords.length > 0 && finalFeedback.indexOf("錯誤字詞") === -1) {
      finalFeedback += (finalFeedback ? " | " : "") + "錯誤字詞: " + errorWords.join(", ");
    }

    var record = {
      time: formatNow(),
      subject: subject || "其他",
      lesson: lesson || document.title || "",
      feedback: finalFeedback,
      term: term
    };
    if (skillStats.length > 0) record.skill_stats = skillStats;
    if (circledChars.length > 0) record.circled_chars = circledChars;
    if (errorWords.length > 0) record.error_words = errorWords;

    // 1. 立即存入本機緩存（防斷網遺失，同日同關卡覆蓋防重複）
    var list = getLocalPending();
    var today = record.time.slice(0, 10);
    var idx = list.findIndex(function (r) {
      return (r.time || "").slice(0, 10) === today && r.subject === record.subject && r.lesson === record.lesson;
    });
    if (idx >= 0) list[idx] = record;
    else list.unshift(record);
    saveLocalPending(list);

    // 2. 背景自動同步到 Google Sheet（使用 text/plain 避開 CORS 預檢）
    if (CLOUD_API_URL && CLOUD_API_URL.indexOf("https://script.google.com/") === 0) {
      var payload = {
        action: "save",
        subject: record.subject,
        lesson: record.lesson,
        feedback: record.feedback,
        term: term
      };
      if (skillStats.length > 0) payload.skill_stats = skillStats;
      if (typeof opts.total_score === "number" && !isNaN(opts.total_score)) payload.total_score = opts.total_score;
      if (typeof opts.avg_sec === "number" && !isNaN(opts.avg_sec)) payload.avg_sec = opts.avg_sec;
      if (circledChars.length > 0) payload.circled_chars = circledChars;
      if (errorWords.length > 0) payload.error_words = errorWords;

      fetch(CLOUD_API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      }).catch(function () {});
    }
    return true;
  }

  function fetchCloudPendingJsonp() {
    return new Promise(function (resolve) {
      var cbName = "llHubCb_" + Math.floor(Math.random() * 100000);
      var script = document.createElement("script");
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        cleanup();
        resolve({ source: "local", pending: getLocalPending() });
      }, 6000);

      function cleanup() {
        clearTimeout(timer);
        try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[cbName] = function (data) {
        if (done) return;
        done = true;
        cleanup();
        if (data && data.ok && Array.isArray(data.pending)) {
          resolve({ source: "cloud", pending: data.pending });
        } else {
          resolve({ source: "local", pending: getLocalPending() });
        }
      };

      script.onerror = function () {
        if (done) return;
        done = true;
        cleanup();
        resolve({ source: "local", pending: getLocalPending() });
      };

      script.src = CLOUD_API_URL + "?t=" + Date.now() + "&callback=" + cbName;
      document.body.appendChild(script);
    });
  }

  function fetchCloudPending() {
    if (!CLOUD_API_URL || CLOUD_API_URL.indexOf("https://script.google.com/") !== 0) {
      return Promise.resolve({ source: "local", pending: getLocalPending() });
    }
    return fetch(CLOUD_API_URL + "?t=" + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok && Array.isArray(data.pending)) {
          return { source: "cloud", pending: data.pending };
        }
        return fetchCloudPendingJsonp();
      })
      .catch(function () {
        return fetchCloudPendingJsonp();
      });
  }

  function markAllDone() {
    saveLocalPending([]);
    if (!CLOUD_API_URL || CLOUD_API_URL.indexOf("https://script.google.com/") !== 0) {
      return Promise.resolve();
    }
    return fetch(CLOUD_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "markDone" })
    }).catch(function () {});
  }

  function copyTextSafe(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
    }
    fallbackCopy(text);
    return Promise.resolve();
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }

  function buildCombinedText(list) {
    if (!list.length) return "";
    var lines = [
      "📋 【玲玲學習樂園・總管專用戰報打包】",
      "匯出時間：" + formatNow() + "（共 " + list.length + " 份待規劃紀錄）",
      "=============================="
    ];
    list.forEach(function (r, i) {
      lines.push((i + 1) + ". [" + r.subject + "] " + r.lesson + "（" + r.time + "）");
      lines.push(r.feedback);
      lines.push("------------------------------");
    });
    return lines.join("\n");
  }

  // 在大門主頁自動掛載「📋 家長戰報箱」按鈕與 3D 彈窗
  function mountHomepageHub() {
    var header = document.querySelector("header");
    if (!header || document.getElementById("ll-report-bar")) return;

    var style = document.createElement("style");
    style.textContent = [
      "#ll-report-bar { margin-top: 12px; display: flex; justify-content: center; }",
      "#ll-report-btn { background: linear-gradient(135deg, #FEF3C7, #FDE68A); color: #92400E; border: 3px solid #F59E0B; border-bottom-width: 6px; border-radius: 999px; padding: 8px 18px; font-weight: 900; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; font-family: inherit; box-shadow: 0 4px 10px rgba(245,158,11,0.18); touch-action: manipulation; }",
      "#ll-report-btn:active { transform: translateY(3px); border-bottom-width: 3px; }",
      "#ll-report-badge { background: #EF4444; color: #fff; font-size: 12px; padding: 2px 8px; border-radius: 999px; min-width: 22px; text-align: center; }",
      "#ll-report-badge.zero { background: #10B981; }",
      "#ll-report-modal { position: fixed; inset: 0; background: rgba(15,23,42,0.65); backdrop-filter: blur(4px); display: none; align-items: center; justify-content: center; z-index: 2000; padding: 16px; }",
      "#ll-report-modal.show { display: flex; }",
      ".ll-rm-card { background: #fff; width: 100%; max-width: 560px; max-height: 85vh; display: flex; flex-direction: column; border-radius: 28px; padding: 22px; border: 5px solid #FCD34D; border-bottom-width: 10px; border-bottom-color: #F59E0B; position: relative; }",
      ".ll-rm-close { position: absolute; top: -14px; right: -14px; width: 40px; height: 40px; border-radius: 50%; background: #EF4444; color: #fff; border: 3px solid #fff; font-size: 18px; font-weight: 900; cursor: pointer; }",
      ".ll-rm-title { margin: 0 0 6px 0; font-size: 20px; font-weight: 900; color: #92400E; text-align: center; }",
      ".ll-rm-status { font-size: 12px; color: #64748B; text-align: center; margin-bottom: 12px; font-weight: 700; }",
      ".ll-rm-list { flex: 1; overflow-y: auto; background: #FFFBEB; border: 2px dashed #FCD34D; border-radius: 18px; padding: 12px; display: flex; flex-direction: column; gap: 10px; min-height: 120px; }",
      ".ll-rm-item { background: #fff; border: 2px solid #FDE68A; border-radius: 14px; padding: 10px 12px; font-size: 13px; color: #334155; }",
      ".ll-rm-item-head { display: flex; justify-content: space-between; font-weight: 900; color: #B45309; margin-bottom: 4px; gap: 8px; flex-wrap: wrap; }",
      ".ll-rm-item-body { white-space: pre-wrap; word-break: break-word; line-height: 1.45; }",
      ".ll-rm-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }",
      ".ll-rm-act { border: none; border-radius: 16px; padding: 12px 10px; font-weight: 900; font-size: 14px; cursor: pointer; font-family: inherit; border-bottom: 5px solid rgba(0,0,0,0.18); touch-action: manipulation; }",
      ".ll-rm-act:active { transform: translateY(3px); border-bottom-width: 2px; }",
      ".ll-btn-copy { background: #10B981; color: #fff; grid-column: 1 / -1; font-size: 15px; }",
      ".ll-btn-done { background: #3B82F6; color: #fff; }",
      ".ll-btn-refresh { background: #F1F5F9; color: #475569; }",
      ".ll-btn-test { background: transparent; border: none; color: #94A3B8; font-size: 12px; margin-top: 8px; cursor: pointer; text-decoration: underline; }"
    ].join("\n");
    document.head.appendChild(style);

    var bar = document.createElement("div");
    bar.id = "ll-report-bar";
    bar.innerHTML = '<button id="ll-report-btn" type="button">📋 家長戰報箱（給總管） <span id="ll-report-badge" class="zero">0</span></button>';
    header.appendChild(bar);

    var modal = document.createElement("div");
    modal.id = "ll-report-modal";
    modal.innerHTML = [
      '<div class="ll-rm-card" onclick="event.stopPropagation()">',
      '  <button class="ll-rm-close" type="button" id="ll-rm-close">✖</button>',
      '  <h2 class="ll-rm-title">📋 玲玲學習戰報箱</h2>',
      '  <div class="ll-rm-status" id="ll-rm-status">☁️ 正在讀取雲端戰報...</div>',
      '  <div class="ll-rm-list" id="ll-rm-list"></div>',
      '  <div class="ll-rm-actions">',
      '    <button class="ll-rm-act ll-btn-copy" type="button" id="ll-rm-copy">📋 一鍵複製全部未處理戰報</button>',
      '    <button class="ll-rm-act ll-btn-done" type="button" id="ll-rm-done">✅ 標記已交給總管</button>',
      '    <button class="ll-rm-act ll-btn-refresh" type="button" id="ll-rm-refresh">🔄 重新整理</button>',
      '  </div>',
      '  <button class="ll-btn-test" type="button" id="ll-rm-test">🧪 發送一筆測試戰報（驗證雲端連線）</button>',
      '</div>'
    ].join("");
    modal.addEventListener("click", function () { modal.classList.remove("show"); });
    document.body.appendChild(modal);

    var currentPending = [];

    function escapeHtml(s) {
      return String(s || "").replace(/[&<>"']/g, function (c) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
      });
    }

    function render(result) {
      currentPending = result.pending || [];
      var badge = document.getElementById("ll-report-badge");
      badge.textContent = String(currentPending.length);
      badge.className = currentPending.length > 0 ? "" : "zero";

      var statusEl = document.getElementById("ll-rm-status");
      statusEl.textContent = result.source === "cloud"
        ? "☁️ 已連線 Google Sheet 雲端（共 " + currentPending.length + " 份待彙報）"
        : "📱 目前顯示本機緩存（請確認已填入 Apps Script 網址）";

      var listEl = document.getElementById("ll-rm-list");
      if (!currentPending.length) {
        listEl.innerHTML = '<div style="text-align:center;color:#94A3B8;padding:30px 10px;font-weight:800;">✨ 目前所有戰報都已經處理完畢！</div>';
        return;
      }
      listEl.innerHTML = currentPending.map(function (r) {
        return '<div class="ll-rm-item"><div class="ll-rm-item-head"><span>📌 ' +
          escapeHtml(r.subject) + " · " + escapeHtml(r.lesson) +
          '</span><span style="color:#64748B;font-size:11px;">' + escapeHtml(r.time) +
          '</span></div><div class="ll-rm-item-body">' + escapeHtml(r.feedback) + "</div></div>";
      }).join("");
    }

    function refresh() {
      document.getElementById("ll-rm-status").textContent = "☁️ 正在讀取雲端戰報...";
      return fetchCloudPending().then(render);
    }

    document.getElementById("ll-report-btn").addEventListener("click", function () {
      modal.classList.add("show");
      refresh();
    });
    document.getElementById("ll-rm-close").addEventListener("click", function () {
      modal.classList.remove("show");
    });
    document.getElementById("ll-rm-refresh").addEventListener("click", refresh);

    document.getElementById("ll-rm-copy").addEventListener("click", function () {
      if (!currentPending.length) {
        alert("目前暫時未有未處理嘅戰報喔！");
        return;
      }
      var text = buildCombinedText(currentPending);
      copyTextSafe(text).then(function () {
        var btn = document.getElementById("ll-rm-copy");
        btn.textContent = "✅ 已複製！可以直接貼給總管";
        setTimeout(function () { btn.textContent = "📋 一鍵複製全部未處理戰報"; }, 2200);
      });
    });

    document.getElementById("ll-rm-done").addEventListener("click", function () {
      if (!currentPending.length) return;
      if (!confirm("確定已將這 " + currentPending.length + " 份戰報交給總管？（Google Sheet 歷史紀錄會永久保留，只會將狀態改為「已處理」）")) return;
      markAllDone().then(function () {
        setTimeout(refresh, 600);
      });
    });

    document.getElementById("ll-rm-test").addEventListener("click", function () {
      saveReport("系統測試", "雲端連線測試", "【測試成功】玲玲學習樂園已成功接通 Google Sheet 雲端戰報系統！", { term: DEFAULT_TERM });
      document.getElementById("ll-rm-status").textContent = "🚀 已發送測試戰報，2 秒後自動刷新...";
      setTimeout(refresh, 2000);
    });

    // 載入主頁時背景讀取一次未讀數字
    fetchCloudPending().then(render);
  }

  window.LinglingReport = {
    version: "3.0",
    save: saveReport,
    getApiUrl: function () { return CLOUD_API_URL; }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (document.getElementById("sec-cn-class")) mountHomepageHub();
    });
  } else {
    if (document.getElementById("sec-cn-class")) mountHomepageHub();
  }
})();
