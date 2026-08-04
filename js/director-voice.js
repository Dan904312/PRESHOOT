/**
 * Director Voice Mode — overlay listening UI with live captions + volume rings.
 * Uses Web Speech API + getUserMedia AnalyserNode for reactive animation.
 */
(function (global) {
  'use strict';

  var state = {
    open: false,
    rec: null,
    stream: null,
    audioCtx: null,
    analyser: null,
    raf: 0,
    finalText: '',
    interimText: '',
    onFinal: null,
    stopping: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function ensureOverlay() {
    var ov = $('dir-voice-ov');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'dir-voice-ov';
    ov.className = 'dir-voice-ov';
    ov.hidden = true;
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Director voice mode');
    ov.innerHTML =
      '<div class="dir-voice-backdrop" data-voice-close="1"></div>' +
      '<div class="dir-voice-sheet">' +
      '<button type="button" class="dir-voice-close" data-voice-close="1" aria-label="Close">×</button>' +
      '<div class="dir-voice-status" id="dir-voice-status">Listening…</div>' +
      '<div class="dir-voice-orb" id="dir-voice-orb" aria-hidden="true">' +
      '<span class="dir-voice-ring r1"></span>' +
      '<span class="dir-voice-ring r2"></span>' +
      '<span class="dir-voice-ring r3"></span>' +
      '<button type="button" class="dir-voice-mic-btn" id="dir-voice-mic-btn" aria-label="Stop listening">' +
      '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v3"/></svg>' +
      '</button>' +
      '</div>' +
      '<div class="dir-voice-hint" id="dir-voice-hint">Speak naturally — Director is listening</div>' +
      '<div class="dir-voice-captions" id="dir-voice-captions" aria-live="polite">' +
      '<span class="dir-voice-cap-placeholder">Start speaking…</span>' +
      '</div>' +
      '<div class="dir-voice-actions">' +
      '<button type="button" class="dir-voice-cancel" data-voice-close="1">Cancel</button>' +
      '<button type="button" class="dir-voice-done" id="dir-voice-done" disabled>Done</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-voice-close') === '1') {
        closeVoiceMode({ cancel: true });
      }
    });
    var doneBtn = $('dir-voice-done');
    if (doneBtn) {
      doneBtn.addEventListener('click', function () {
        finishWithText(state.finalText || state.interimText);
      });
    }
    var micBtn = $('dir-voice-mic-btn');
    if (micBtn) {
      micBtn.addEventListener('click', function () {
        if (state.finalText || state.interimText) {
          finishWithText(state.finalText || state.interimText);
        } else {
          closeVoiceMode({ cancel: true });
        }
      });
    }
    return ov;
  }

  function setStatus(text, cls) {
    var el = $('dir-voice-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'dir-voice-status' + (cls ? ' ' + cls : '');
  }

  function setCaptions(finalText, interimText) {
    var el = $('dir-voice-captions');
    if (!el) return;
    var f = String(finalText || '').trim();
    var i = String(interimText || '').trim();
    if (!f && !i) {
      el.innerHTML = '<span class="dir-voice-cap-placeholder">Start speaking…</span>';
      return;
    }
    el.innerHTML =
      '<span class="dir-voice-cap-final">' +
      escapeHtml(f) +
      '</span>' +
      (i
        ? '<span class="dir-voice-cap-interim">' +
          (f ? ' ' : '') +
          escapeHtml(i) +
          '</span>'
        : '');
    var done = $('dir-voice-done');
    if (done) done.disabled = !(f || i);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function speechRecognitionCtor() {
    return global.SpeechRecognition || global.webkitSpeechRecognition || null;
  }

  function isSecureContextOk() {
    return !!(global.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  }

  function errorMessage(err) {
    var name = (err && (err.name || err.error || err.message)) || '';
    var n = String(name).toLowerCase();
    if (n.indexOf('notallowed') >= 0 || n.indexOf('permission') >= 0 || n === 'not-allowed') {
      return 'Microphone access is disabled. Enable it in settings to use voice mode.';
    }
    if (n.indexOf('notfound') >= 0 || n === 'audio-capture') {
      return 'No microphone was found on this device.';
    }
    if (n === 'no-speech') {
      return 'I didn’t catch that. Tap the mic and try again.';
    }
    if (n === 'network') {
      return 'Voice recognition needs a network connection. Check your connection and try again.';
    }
    if (n === 'service-not-allowed' || n === 'not-supported') {
      return 'Voice mode isn’t available in this browser. Type your request instead.';
    }
    if (n.indexOf('secure') >= 0) {
      return 'Voice mode requires a secure connection (HTTPS).';
    }
    return 'Couldn’t start voice mode. Check microphone permissions and try again.';
  }

  function stopAudio() {
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
    if (state.stream) {
      try {
        state.stream.getTracks().forEach(function (t) {
          t.stop();
        });
      } catch (e) {}
      state.stream = null;
    }
    if (state.audioCtx) {
      try {
        state.audioCtx.close();
      } catch (e) {}
      state.audioCtx = null;
      state.analyser = null;
    }
    var orb = $('dir-voice-orb');
    if (orb) orb.style.setProperty('--level', '0');
  }

  function stopRecognition() {
    if (!state.rec) return;
    var rec = state.rec;
    state.rec = null;
    try {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.stop();
    } catch (e) {
      try {
        rec.abort();
      } catch (e2) {}
    }
  }

  function tickVolume() {
    if (!state.open || !state.analyser) return;
    var buf = new Uint8Array(state.analyser.fftSize);
    state.analyser.getByteTimeDomainData(buf);
    var sum = 0;
    for (var i = 0; i < buf.length; i++) {
      var v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    var rms = Math.sqrt(sum / buf.length);
    var level = Math.min(1, rms * 4.2);
    var orb = $('dir-voice-orb');
    if (orb) {
      var prev = parseFloat(orb.style.getPropertyValue('--level') || '0') || 0;
      var smooth = prev * 0.72 + level * 0.28;
      orb.style.setProperty('--level', smooth.toFixed(3));
    }
    state.raf = requestAnimationFrame(tickVolume);
  }

  function startVolumeMeter() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve(false);
    return navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then(function (stream) {
        state.stream = stream;
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return true;
        state.audioCtx = new AC();
        state.analyser = state.audioCtx.createAnalyser();
        state.analyser.fftSize = 512;
        state.analyser.smoothingTimeConstant = 0.82;
        var src = state.audioCtx.createMediaStreamSource(stream);
        src.connect(state.analyser);
        if (state.audioCtx.state === 'suspended') {
          state.audioCtx.resume().catch(function () {});
        }
        tickVolume();
        return true;
      });
  }

  function finishWithText(text) {
    var t = String(text || '').trim();
    state.stopping = true;
    stopRecognition();
    stopAudio();
    if (!t) {
      closeVoiceMode({ cancel: true });
      return;
    }
    setStatus('Got it', 'ok');
    setCaptions(t, '');
    var ov = $('dir-voice-ov');
    if (ov) ov.classList.add('processing');
    setTimeout(function () {
      var cb = state.onFinal;
      closeVoiceMode({ cancel: false, keepPanel: false });
      if (typeof cb === 'function') cb(t);
    }, 220);
  }

  function closeVoiceMode(opts) {
    opts = opts || {};
    state.stopping = true;
    stopRecognition();
    stopAudio();
    state.open = false;
    state.finalText = '';
    state.interimText = '';
    state.onFinal = null;
    var ov = $('dir-voice-ov');
    if (ov) {
      ov.classList.remove('open', 'processing', 'error');
      ov.hidden = true;
    }
    document.documentElement.classList.remove('dir-voice-active');
    var btn = $('dir-cmd-mic');
    if (btn) btn.classList.remove('listening');
  }

  function openVoiceMode(opts) {
    opts = opts || {};
    if (state.open) {
      closeVoiceMode({ cancel: true });
      return;
    }

    if (!isSecureContextOk()) {
      if (typeof opts.onError === 'function') {
        opts.onError('Voice mode requires a secure connection (HTTPS).');
      }
      return;
    }

    var SR = speechRecognitionCtor();
    if (!SR) {
      if (typeof opts.onError === 'function') {
        opts.onError('Voice mode isn’t available in this browser. Type your request instead.');
      }
      return;
    }

    var ov = ensureOverlay();
    state.open = true;
    state.stopping = false;
    state.finalText = '';
    state.interimText = '';
    state.onFinal = opts.onFinal || null;
    ov.hidden = false;
    ov.classList.remove('processing', 'error');
    requestAnimationFrame(function () {
      ov.classList.add('open');
    });
    document.documentElement.classList.add('dir-voice-active');
    setStatus('Listening…', 'listening');
    setCaptions('', '');
    var hint = $('dir-voice-hint');
    if (hint) hint.textContent = 'Speak naturally — Director is listening';
    var micBtn = $('dir-cmd-mic');
    if (micBtn) micBtn.classList.add('listening');

    startVolumeMeter().catch(function (err) {
      /* Mic for viz failed — still try speech recognition; surface permission errors */
      var msg = errorMessage(err);
      if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        setStatus('Mic blocked', 'error');
        ov.classList.add('error');
        if (hint) hint.textContent = msg;
        if (typeof opts.onError === 'function') opts.onError(msg);
        setTimeout(function () {
          closeVoiceMode({ cancel: true });
        }, 1600);
      }
    });

    var rec = new SR();
    state.rec = rec;
    rec.lang = opts.lang || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = function (ev) {
      var finalChunk = '';
      var interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var res = ev.results[i];
        var txt = res[0] && res[0].transcript ? res[0].transcript : '';
        if (res.isFinal) finalChunk += txt;
        else interim += txt;
      }
      if (finalChunk) {
        state.finalText = (state.finalText + ' ' + finalChunk).replace(/\s+/g, ' ').trim();
      }
      state.interimText = interim;
      setCaptions(state.finalText, state.interimText);
      setStatus('Listening…', 'listening');
    };

    rec.onerror = function (ev) {
      if (state.stopping) return;
      var code = (ev && ev.error) || 'error';
      if (code === 'no-speech' || code === 'aborted') {
        /* Soft — keep UI open so user can retry / tap Done */
        if (!state.finalText && !state.interimText) {
          setStatus('Listening…', 'listening');
        }
        return;
      }
      var msg = errorMessage({ error: code });
      setStatus('Can’t hear', 'error');
      ov.classList.add('error');
      var hintEl = $('dir-voice-hint');
      if (hintEl) hintEl.textContent = msg;
      stopAudio();
      if (typeof opts.onError === 'function') opts.onError(msg);
    };

    rec.onend = function () {
      if (state.stopping || !state.open) return;
      /* Chrome often ends continuous sessions — restart while overlay open */
      if (state.finalText && !state.interimText) {
        /* Brief pause then allow Done; also auto-finish if clear utterance */
        setStatus('Ready', 'ok');
        var hintEl = $('dir-voice-hint');
        if (hintEl) hintEl.textContent = 'Tap Done to send, or keep speaking';
        try {
          state.rec = rec;
          rec.start();
        } catch (e) {}
        return;
      }
      try {
        rec.start();
      } catch (e) {
        /* If restart fails and we have text, finish */
        if (state.finalText || state.interimText) {
          finishWithText(state.finalText || state.interimText);
        }
      }
    };

    try {
      rec.start();
    } catch (e) {
      stopAudio();
      var msg = errorMessage(e);
      setStatus('Can’t start', 'error');
      ov.classList.add('error');
      if (typeof opts.onError === 'function') opts.onError(msg);
      setTimeout(function () {
        closeVoiceMode({ cancel: true });
      }, 1400);
    }
  }

  function isOpen() {
    return !!state.open;
  }

  global.PreShootDirectorVoice = {
    open: openVoiceMode,
    close: closeVoiceMode,
    isOpen: isOpen,
    isSupported: function () {
      return !!speechRecognitionCtor() && isSecureContextOk();
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
