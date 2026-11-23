/**
 * 玲玲學習樂園 — 全站共用中英雙軌語音引擎 (voice-engine.js v1)
 * 專為 iPad Safari 實測優化：
 * 1. 採用單一常駐原生 <audio playsinline>，完全棄用會被 iPad 中斷的 AudioContext
 * 2. 首次點擊呼叫 LinglingVoice.unlock() 即同步解鎖，之後在 onend 內亦 100% 暢順播英文 MP3
 * 3. cancel() 後強制留 60ms 緩衝防吞聲 + onend 保險計時器 + 120ms 交棒緩衝
 * 4. 支援單句播音、中英雙軌 (playHybrid) 及多步驟排隊 (playQueue)
 */
(function (global) {
  'use strict';

  const SILENT_WAV =
    'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

  global.utterancePool = global.utterancePool || [];

  let enPlayer = null;
  let audioToken = 0;
  let speechDelayTimer = null;
  let speechSafetyTimer = null;
  let handoverTimer = null;
  let isUnlocked = false;

  function ensurePlayer() {
    if (enPlayer) return enPlayer;
    enPlayer = document.getElementById('lingling-en-player');
    if (!enPlayer) {
      enPlayer = document.createElement('audio');
      enPlayer.id = 'lingling-en-player';
      enPlayer.setAttribute('playsinline', '');
      enPlayer.setAttribute('webkit-playsinline', '');
      enPlayer.preload = 'auto';
      enPlayer.style.display = 'none';
      if (document.body) {
        document.body.appendChild(enPlayer);
      } else {
        document.addEventListener('DOMContentLoaded', function () {
          if (!document.getElementById('lingling-en-player')) {
            document.body.appendChild(enPlayer);
          }
        });
      }
    }
    return enPlayer;
  }

  function clearTimers() {
    if (speechDelayTimer) {
      clearTimeout(speechDelayTimer);
      speechDelayTimer = null;
    }
    if (speechSafetyTimer) {
      clearTimeout(speechSafetyTimer);
      speechSafetyTimer = null;
    }
    if (handoverTimer) {
      clearTimeout(handoverTimer);
      handoverTimer = null;
    }
  }

  function unlock() {
    const player = ensurePlayer();
    try {
      player.src = SILENT_WAV;
      player.volume = 1.0;
      const p = player.play();
      if (p && typeof p.then === 'function') {
        p.then(function () {
          player.pause();
          player.currentTime = 0;
        }).catch(function () {});
      }
    } catch (e) {}

    if ('speechSynthesis' in global) {
      try {
        global.speechSynthesis.getVoices();
      } catch (e) {}
    }
    isUnlocked = true;
  }

  function stop() {
    audioToken += 1;
    clearTimers();

    if ('speechSynthesis' in global) {
      try {
        global.speechSynthesis.cancel();
      } catch (e) {}
    }
    global.utterancePool = [];

    const player = ensurePlayer();
    try {
      player.onended = null;
      player.onerror = null;
      player.pause();
      player.currentTime = 0;
    } catch (e) {}
  }

  function _speakZhInternal(text, myToken, opts, onEnd) {
    if (!('speechSynthesis' in global) || !text) {
      if (onEnd && myToken === audioToken) onEnd();
      return;
    }

    const rate = (opts && opts.rate) || 0.78;
    const pitch = (opts && opts.pitch) || 1.05;
    const volume = opts && typeof opts.volume === 'number' ? opts.volume : 0.55;

    speechDelayTimer = setTimeout(function () {
      if (myToken !== audioToken) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-HK';
      u.rate = rate;
      u.pitch = pitch;
      u.volume = volume;

      const voices = global.speechSynthesis.getVoices();
      const hkVoice =
        voices.find(function (v) {
          return v.lang && v.lang.toLowerCase().indexOf('zh-hk') !== -1;
        }) ||
        voices.find(function (v) {
          return v.lang && v.lang.toLowerCase().indexOf('yue') !== -1;
        });
      if (hkVoice) u.voice = hkVoice;

      global.utterancePool.push(u);
      let finished = false;

      function done() {
        if (finished) return;
        finished = true;
        if (speechSafetyTimer) {
          clearTimeout(speechSafetyTimer);
          speechSafetyTimer = null;
        }
        global.utterancePool = global.utterancePool.filter(function (x) {
          return x !== u;
        });
        if (onEnd && myToken === audioToken) onEnd();
      }

      u.onend = done;
      u.onerror = done;

      // 防 iPad Safari 偶發漏觸發 onend 導致卡死
      const estMs = Math.max(2200, text.length * 360 + 900);
      speechSafetyTimer = setTimeout(done, estMs);

      global.speechSynthesis.speak(u);
    }, 60);
  }

  function _playMp3Internal(filename, myToken, opts, onEnd) {
    if (!filename) {
      if (onEnd && myToken === audioToken) onEnd();
      return;
    }

    const player = ensurePlayer();
    const url = filename.indexOf('/') === -1 ? 'audio/' + filename : filename;
    const startAt = opts && typeof opts.startAt === 'number' ? opts.startAt : 0;

    try {
      player.onended = null;
      player.onerror = null;
      player.pause();
      player.src = url;
      player.volume = 1.0;
      player.load();

      player.onended = function () {
        player.onended = null;
        player.onerror = null;
        if (onEnd && myToken === audioToken) onEnd();
      };
      player.onerror = function () {
        player.onended = null;
        player.onerror = null;
        if (onEnd && myToken === audioToken) onEnd();
      };

      const startPlay = function () {
        if (myToken !== audioToken) return;
        if (startAt > 0) {
          try {
            player.currentTime = startAt;
          } catch (e) {}
        }
        const p = player.play();
        if (p && typeof p.catch === 'function') {
          p.catch(function () {
            if (onEnd && myToken === audioToken) onEnd();
          });
        }
      };

      if (startAt > 0) {
        player.onloadedmetadata = function () {
          player.onloadedmetadata = null;
          startPlay();
        };
      } else {
        startPlay();
      }
    } catch (e) {
      if (onEnd && myToken === audioToken) onEnd();
    }
  }

  function playZh(text, onEnd, opts) {
    stop();
    _speakZhInternal(text, audioToken, opts, onEnd);
  }

  function playMp3(filename, onEnd, opts) {
    stop();
    _playMp3Internal(filename, audioToken, opts, onEnd);
  }

  function playHybrid(zhText, enFile, onAllDone, opts) {
    stop();
    const myToken = audioToken;
    if (zhText && enFile) {
      _speakZhInternal(zhText, myToken, opts, function () {
        if (myToken !== audioToken) return;
        handoverTimer = setTimeout(function () {
          if (myToken !== audioToken) return;
          _playMp3Internal(enFile, myToken, opts, onAllDone);
        }, 120);
      });
    } else if (enFile) {
      _playMp3Internal(enFile, myToken, opts, onAllDone);
    } else if (zhText) {
      _speakZhInternal(zhText, myToken, opts, onAllDone);
    } else if (onAllDone) {
      onAllDone();
    }
  }

  /**
   * 支援多步驟排隊：
   * steps 例如：
   * [
   *   { type: 'zh', text: '留心聽問題：' },
   *   { type: 'mp3', file: 'en-is-this-your-cat.mp3' }
   * ]
   */
  function playQueue(steps, onAllDone) {
    stop();
    const myToken = audioToken;
    const list = Array.isArray(steps) ? steps : [];
    let idx = 0;

    function next() {
      if (myToken !== audioToken) return;
      if (idx >= list.length) {
        if (onAllDone) onAllDone();
        return;
      }
      const step = list[idx++];
      const advance = function () {
        if (myToken !== audioToken) return;
        handoverTimer = setTimeout(next, 120);
      };

      if (step.type === 'zh') {
        _speakZhInternal(step.text, myToken, step, advance);
      } else if (step.type === 'mp3') {
        _playMp3Internal(step.file, myToken, step, advance);
      } else {
        advance();
      }
    }

    next();
  }

  global.LinglingVoice = {
    unlock: unlock,
    stop: stop,
    playZh: playZh,
    playMp3: playMp3,
    playHybrid: playHybrid,
    playQueue: playQueue,
    isUnlocked: function () {
      return isUnlocked;
    }
  };
})(window);
