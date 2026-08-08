/**
 * Director Voice Mode — overlay listening UI with live captions + volume rings.
 * Pipeline: user gesture → getUserMedia (volume) → SpeechRecognition (transcript).
 * Never silently fails; surfaces permission / unsupported / network errors.
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
    onError: null,
    stopping: false,
    starting: false,
    autoFinishTimer: 0
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
    ov.setAttribute('hidden', '');
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
      '<div class="dir-voice-hint" id="dir-voice-hint">Speak naturally. Director is listening</div>' +
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

  function setHint(text) {
    var el = $('dir-voice-hint');
    if (el) el.textContent = text || '';
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
    return !!(
      global.isSecureContext ||
      location.protocol === 'https:' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1'
    );
  }

  function errorMessage(err) {
    var name = (err && (err.name || err.error || err.message)) || '';
    var n = String(name).toLowerCase();
    if (
      n.indexOf('notallowed') >= 0 ||
      n.indexOf('permission') >= 0 ||
      n === 'not-allowed' ||
      n.indexOf('denied') >= 0
    ) {
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
    if (n === 'service-not-allowed' || n === 'not-supported' || n.indexOf('unsupported') >= 0) {
      return 'Voice mode isn’t available in this browser. Type your request instead.';
    }
    if (n.indexOf('secure') >= 0) {
      return 'Voice mode requires a secure connection (HTTPS).';
    }
    return 'Couldn’t start voice mode. Check microphone permissions and try again.';
  }

  function emitError(msg) {
    if (typeof state.onError === 'function') state.onError(msg);
  }

  function clearAutoFinish() {
    if (state.autoFinishTimer) {
      clearTimeout(state.autoFinishTimer);
      state.autoFinishTimer = 0;
    }
  }

  function scheduleAutoFinish() {
    clearAutoFinish();
    /* After a final utterance settles, auto-send like a typed Go */
    state.autoFinishTimer = setTimeout(function () {
      state.autoFinishTimer = 0;
      if (!state.open || state.stopping) return;
      var t = String(state.finalText || state.interimText || '').trim();
      if (t) finishWithText(t);
    }, 1100);
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
      rec.onstart = null;
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

  function attachStream(stream) {
    state.stream = stream;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return;
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
  }

  function requestMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject({ name: 'NotSupportedError', message: 'unsupported' });
    }
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
  }

  function finishWithText(text) {
    var t = String(text || '').trim();
    clearAutoFinish();
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
    var cb = state.onFinal;
    setTimeout(function () {
      closeVoiceMode({ cancel: false });
      if (typeof cb === 'function') cb(t);
    }, 180);
  }

  function failAndClose(msg) {
    clearAutoFinish();
    state.stopping = true;
    stopRecognition();
    stopAudio();
    setStatus('Can’t start', 'error');
    setHint(msg);
    var ov = $('dir-voice-ov');
    if (ov) ov.classList.add('error');
    emitError(msg);
    setTimeout(function () {
      closeVoiceMode({ cancel: true });
    }, 1600);
  }

  function closeVoiceMode(opts) {
    opts = opts || {};
    clearAutoFinish();
    state.stopping = true;
    state.starting = false;
    stopRecognition();
    stopAudio();
    state.open = false;
    state.finalText = '';
    state.interimText = '';
    state.onFinal = null;
    state.onError = null;
    var ov = $('dir-voice-ov');
    if (ov) {
      ov.classList.remove('open', 'processing', 'error');
      ov.setAttribute('hidden', '');
      ov.hidden = true;
    }
    document.documentElement.classList.remove('dir-voice-active');
    var btn = $('dir-cmd-mic');
    if (btn) btn.classList.remove('listening');
  }

  function isTouchMobile() {
    try {
      return (
        (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
        (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer:coarse)').matches) ||
        /iPhone|iPad|iPod|Android/i.test((navigator && navigator.userAgent) || '')
      );
    } catch (e) {
      return false;
    }
  }

  function isIOSLike() {
    try {
      return /iPhone|iPad|iPod/i.test((navigator && navigator.userAgent) || '') ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    } catch (e) {
      return false;
    }
  }

  function startRecognition(SR, lang) {
    var rec = new SR();
    state.rec = rec;
    rec.lang = lang || 'en-US';
    /* Safari/iOS: continuous sessions often die after one utterance — use one-shot */
    rec.continuous = !isIOSLike();
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = function () {
      if (!state.open || state.stopping) return;
      setStatus('Listening…', 'listening');
      setHint('Speak naturally. Director is listening');
      var micBtn = $('dir-cmd-mic');
      if (micBtn) micBtn.classList.add('listening');
    };

    rec.onresult = function (ev) {
      if (!state.open || state.stopping) return;
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
        scheduleAutoFinish();
      } else {
        clearAutoFinish();
      }
      state.interimText = interim;
      setCaptions(state.finalText, state.interimText);
      setStatus('Listening…', 'listening');
    };

    rec.onerror = function (ev) {
      if (state.stopping || !state.open) return;
      var code = (ev && ev.error) || 'error';
      if (code === 'no-speech' || code === 'aborted') {
        if (!state.finalText && !state.interimText) {
          setStatus('Listening…', 'listening');
        }
        return;
      }
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        failAndClose(errorMessage({ error: code }));
        return;
      }
      if (code === 'network' && !(state.finalText || state.interimText)) {
        failAndClose('Speech recognition needs a network connection. Check Wi‑Fi and try again, or type your request.');
        return;
      }
      var msg = errorMessage({ error: code });
      setStatus('Can’t hear', 'error');
      setHint(msg);
      var ov = $('dir-voice-ov');
      if (ov) ov.classList.add('error');
      emitError(msg);
      if (code !== 'network' || !(state.finalText || state.interimText)) {
        stopAudio();
      }
    };

    rec.onend = function () {
      if (state.stopping || !state.open) return;
      if (isIOSLike()) {
        if (state.finalText || state.interimText) {
          finishWithText(state.finalText || state.interimText);
        } else {
          setStatus('Ready', 'ok');
          setHint('Tap Done if you finished, or speak again');
          try {
            rec.start();
          } catch (e2) {}
        }
        return;
      }
      try {
        state.rec = rec;
        rec.start();
      } catch (e) {
        if (state.finalText || state.interimText) {
          finishWithText(state.finalText || state.interimText);
        } else {
          setStatus('Ready', 'ok');
          setHint('Tap the mic again, or type your request');
        }
      }
    };

    try {
      rec.start();
    } catch (e) {
      failAndClose('Couldn’t start voice recognition. Type your request instead.');
    }
  }

  function openVoiceMode(opts) {
    opts = opts || {};
    if (state.open || state.starting) {
      closeVoiceMode({ cancel: true });
      /* Allow immediate re-open from the same tap cycle via next call */
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
    state.starting = true;
    state.stopping = false;
    state.finalText = '';
    state.interimText = '';
    state.onFinal = opts.onFinal || null;
    state.onError = opts.onError || null;
    ov.hidden = false;
    ov.removeAttribute('hidden');
    ov.classList.remove('processing', 'error');
    requestAnimationFrame(function () {
      ov.classList.add('open');
    });
    document.documentElement.classList.add('dir-voice-active');
    setStatus('Starting…', 'listening');
    setCaptions('', '');
    setHint('Allow microphone access if prompted');
    /* Don't mark mic listening until recognition actually starts */

    /* Mic first (volume + permission), then recognition — avoids mobile dual-start races */
    requestMic()
      .then(function (stream) {
        if (!state.open || state.stopping) {
          try {
            stream.getTracks().forEach(function (t) {
              t.stop();
            });
          } catch (e) {}
          return;
        }
        if (isIOSLike()) {
          /* iOS: avoid holding GUM while SpeechRecognition runs — release tracks, keep UI rings idle */
          try {
            stream.getTracks().forEach(function (t) {
              t.stop();
            });
          } catch (e) {}
          state.starting = false;
          setStatus('Starting…', 'listening');
          setHint('Speak naturally. Director is listening');
          startRecognition(SR, opts.lang || 'en-US');
          return;
        }
        attachStream(stream);
        state.starting = false;
        setStatus('Starting…', 'listening');
        setHint('Speak naturally. Director is listening');
        startRecognition(SR, opts.lang || 'en-US');
      })
      .catch(function (err) {
        if (!state.open || state.stopping) return;
        var hardDeny =
          err &&
          (err.name === 'NotAllowedError' ||
            err.name === 'PermissionDeniedError' ||
            err.name === 'SecurityError');
        /* Mobile: never soft-fail into a fake Listening state */
        if (hardDeny || isTouchMobile()) {
          state.starting = false;
          failAndClose(
            hardDeny
              ? errorMessage(err)
              : 'Microphone unavailable. Check Settings → PreShoot / Safari → Microphone, then try again — or type your request.'
          );
          return;
        }
        state.starting = false;
        setStatus('Starting…', 'listening');
        setHint('Speak naturally. Director is listening');
        startRecognition(SR, opts.lang || 'en-US');
      });
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
