// 강의 플레이어
// 형광펜 진행 바(내가 실제로 본 곳), 목차 눈금, 자막, 잘라낸 구간 건너뛰기, 영상 위 그림, 학생 이름 부르기를 한곳에서 해요.
import { html, useState, useEffect, useRef, Icon, toast } from './ui.js';

export const fmtT = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};

// ------------------------------------------------------------ 자막 (WebVTT)
export function parseVtt(text) {
  const cues = [];
  const toSec = (x) => {
    const p = String(x).trim().replace(',', '.').split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  };
  for (const b of String(text || '').replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = b.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i].split('-->');
    const s = toSec(a);
    const e = toSec(String(z).trim().split(/\s+/)[0]);
    const t = lines.slice(i + 1).join('\n').trim();
    if (Number.isFinite(s) && Number.isFinite(e) && t) cues.push({ s, e, text: t });
  }
  return cues;
}
export function toVtt(cues) {
  const ts = (x) => {
    const v = Math.max(0, Number(x) || 0);
    const h = Math.floor(v / 3600);
    const m = Math.floor((v % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${(v % 60).toFixed(3).padStart(6, '0')}`;
  };
  return ['WEBVTT', '', ...cues.filter((c) => String(c.text || '').trim()).flatMap((c) => [`${ts(c.s)} --> ${ts(Math.max(c.e, c.s + 0.3))}`, String(c.text).trim(), ''])].join('\n');
}

// ------------------------------------------------------------ 영상 위 그림
export function videoRect(v, W, H) {
  const vw = (v && v.videoWidth) || 16;
  const vh = (v && v.videoHeight) || 9;
  const k = Math.min(W / vw, H / vh);
  return { x: (W - vw * k) / 2, y: (H - vh * k) / 2, w: vw * k, h: vh * k };
}

// 점 좌표는 영상 화면 기준 0~1000. w 는 영상 높이 1000 기준 굵기.
export function drawStroke(ctx, s, rect, upto = 1, alpha = 1) {
  const p = s.p;
  const n = p.length / 2;
  const m = Math.max(2, Math.ceil(n * upto));
  if (n < 2) return;
  const X = (i) => rect.x + (p[i * 2] / 1000) * rect.w;
  const Y = (i) => rect.y + (p[i * 2 + 1] / 1000) * rect.h;
  ctx.save();
  ctx.globalAlpha = alpha * (s.k === 'hl' ? 0.42 : 1);
  if (s.k === 'hl') ctx.globalCompositeOperation = 'multiply';
  ctx.strokeStyle = s.c;
  ctx.lineWidth = Math.max(1, (s.w / 1000) * rect.h);
  ctx.lineCap = s.k === 'hl' ? 'butt' : 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(X(0), Y(0));
  for (let i = 1; i < m - 1; i++) {
    const mx = (X(i) + X(i + 1)) / 2;
    const my = (Y(i) + Y(i + 1)) / 2;
    ctx.quadraticCurveTo(X(i), Y(i), mx, my);
  }
  ctx.lineTo(X(m - 1), Y(m - 1));
  ctx.stroke();
  ctx.restore();
}

export function strokesAt(list, t) {
  return (list || []).filter((s) => t >= s.t - 0.001 && (!(s.d > 0) || t < s.t + s.d));
}

// ------------------------------------------------------------ 플레이어
const SPEEDS = [1, 1.25, 1.5, 0.8];
const isTouch = () => window.matchMedia && window.matchMedia('(hover: none)').matches;

export function Player({
  src, poster, subtitle, cuts = [], chapters = [], strokes = [], slots = [], name = null,
  skipCuts = true, canSeek, watched, onApi, overlay, compact = false, tracking = null, instant = false, cueList = null, cls = '', duration = 0,
}) {
  const wrap = useRef(null);
  const vref = useRef(null);
  const cvs = useRef(null);
  const barCvs = useRef(null);
  const timeEl = useRef(null);
  const knob = useRef(null);
  const fill = useRef(null);
  const capEl = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [dur, setDur] = useState(0);
  const [ui, setUi] = useState(true);
  const [fs, setFs] = useState(false);
  const [cc, setCc] = useState(true);
  const [rate, setRate] = useState(1);
  const [bubble, setBubble] = useState(0);
  const [cues, setCues] = useState([]);
  const [flash, setFlash] = useState(null);
  const R = useRef({ hideT: 0, raf: 0, autoSeek: false, played: new Set(), unmuteAt: null, audio: null, unlocked: false, lastTap: 0, cap: '', drag: false });
  const props = useRef({});
  props.current = { cuts, slots, strokes, name, skipCuts, canSeek, watched, cues, cc, instant, duration };

  // 자막 파일 읽기 (편집 화면은 고치는 중인 자막을 바로 넘겨줘요)
  useEffect(() => {
    if (cueList) return setCues(cueList);
    if (!subtitle) return setCues([]);
    let off = false;
    fetch(subtitle, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((t) => !off && setCues(parseVtt(t)))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [subtitle, cueList]);

  // 이름 목소리
  useEffect(() => {
    if (!name || !name.clip) return;
    const a = new Audio(name.clip);
    a.preload = 'auto';
    R.current.audio = a;
    return () => {
      a.pause();
      R.current.audio = null;
    };
  }, [name && name.clip]);

  const unlockAudio = () => {
    const a = R.current.audio;
    if (!a || R.current.unlocked) return;
    R.current.unlocked = true;
    a.muted = true;
    a.play()
      .then(() => {
        a.pause();
        a.currentTime = 0;
        a.muted = false;
      })
      .catch(() => {
        a.muted = false;
        R.current.unlocked = false;
      });
  };

  const showUi = () => {
    setUi(true);
    clearTimeout(R.current.hideT);
    R.current.hideT = setTimeout(() => {
      const v = vref.current;
      if (v && !v.paused && !R.current.drag) setUi(false);
    }, 2600);
  };

  // 진행 바 그리기: 본 곳(형광펜), 잘라낸 곳(빗금), 목차 눈금
  const paintBar = () => {
    const c = barCvs.current;
    const v = vref.current;
    if (!c || !v) return;
    const D = v.duration || dur;
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (!W || !D) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr);
    if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const P = props.current;
    const w = P.watched && P.watched();
    if (w && w.bits && w.dur) {
      g.fillStyle = 'rgba(255, 226, 90, 0.95)';
      let start = -1;
      for (let i = 0; i <= w.dur; i++) {
        const on = i < w.dur && w.bits[i >> 3] & (1 << (i & 7));
        if (on && start < 0) start = i;
        if (!on && start >= 0) {
          g.fillRect((start / D) * W, 0, ((i - start) / D) * W, H);
          start = -1;
        }
      }
    }
    for (const [a, b] of P.cuts || []) {
      const x = (a / D) * W;
      const ww = Math.max(2, ((b - a) / D) * W);
      g.fillStyle = 'rgba(20, 24, 40, 0.55)';
      g.fillRect(x, 0, ww, H);
      g.strokeStyle = 'rgba(255, 110, 100, 0.9)';
      g.lineWidth = 1;
      g.beginPath();
      for (let k = x - H; k < x + ww; k += 5) {
        g.moveTo(Math.max(x, k), Math.min(H, H - (Math.max(x, k) - k)));
        g.lineTo(Math.min(x + ww, k + H), Math.max(0, H - (Math.min(x + ww, k + H) - k)));
      }
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.95)';
    for (const ch of chapters || []) {
      if (ch.t <= 0.5) continue;
      g.fillRect(Math.round((ch.t / D) * W) - 1, 0, 2, H);
    }
  };

  const setPos = (t) => {
    const v = vref.current;
    const D = (v && v.duration) || dur || props.current.duration || 1;
    const pct = Math.max(0, Math.min(100, (t / D) * 100));
    if (fill.current) fill.current.style.width = `${pct}%`;
    if (knob.current) knob.current.style.left = `${pct}%`;
    if (timeEl.current) timeEl.current.textContent = `${fmtT(t)} / ${fmtT(D)}`;
  };
  // 시간 글자는 화면 코드가 직접 바꿔요 (Preact 가 그리면 글자가 겹쳐요)
  useEffect(() => {
    const v = vref.current;
    setPos((v && v.currentTime) || 0);
  }, [dur, duration]);

  // 화면 위 그림 다시 그리기
  const paintOverlay = (t) => {
    const c = cvs.current;
    const v = vref.current;
    const W = c && c.clientWidth;
    const H = c && c.clientHeight;
    if (!c || !W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr);
    if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const list = strokesAt(props.current.strokes, t);
    if (!list.length) return;
    const rect = videoRect(v, W, H);
    for (const s of list) {
      const grow = props.current.instant ? 1 : Math.min(1, (t - s.t) / 0.5 + 0.02);
      const end = s.d > 0 ? s.t + s.d : Infinity;
      const alpha = end - t < 0.3 ? Math.max(0, (end - t) / 0.3) : 1;
      drawStroke(g, s, rect, grow, alpha);
    }
  };

  const caption = (t) => {
    const P = props.current;
    let text = '';
    if (P.cc) for (const q of P.cues) if (t >= q.s && t < q.e) { text = q.text; break; }
    if (text !== R.current.cap && capEl.current) {
      R.current.cap = text;
      capEl.current.textContent = text;
      capEl.current.style.display = text ? '' : 'none';
    }
  };

  // 매 장면마다: 잘라낸 곳 건너뛰기, 이름 부르기, 그림, 자막, 시간
  const frame = () => {
    const v = vref.current;
    if (!v) return;
    const t = v.currentTime;
    const P = props.current;
    if (P.skipCuts && !v.seeking) {
      for (const [a, b] of P.cuts || []) {
        if (t >= a && t < b - 0.05) {
          R.current.autoSeek = true;
          v.currentTime = Math.min(b, (v.duration || b) - 0.05);
          break;
        }
      }
    }
    if (P.slots && P.slots.length && P.name) {
      for (const sl of P.slots) {
        if (t < sl.t - 0.6) R.current.played.delete(sl.t);
        if (!v.paused && t >= sl.t - 0.06 && t < sl.t + sl.d - 0.3 && !R.current.played.has(sl.t)) {
          R.current.played.add(sl.t);
          setBubble((x) => x + 1);
          const a = R.current.audio;
          if (a && R.current.unlocked && a.readyState >= 2) {
            v.muted = true;
            R.current.unmuteAt = sl.t + sl.d - 0.03;
            const clip = a.duration && Number.isFinite(a.duration) ? a.duration : 0.7;
            const at = sl.t + Math.max(0, (sl.d - clip) / 2);
            const delay = Math.max(0, (at - t) / (v.playbackRate || 1));
            setTimeout(() => {
              a.currentTime = 0;
              a.playbackRate = Math.min(1.25, v.playbackRate || 1);
              a.play().catch(() => {});
            }, delay * 1000);
          }
        }
      }
      const um = R.current.unmuteAt;
      if (um !== null && (t >= um || t < um - 3)) {
        v.muted = false;
        R.current.unmuteAt = null;
      }
    }
    paintOverlay(t);
    caption(t);
    if (!R.current.drag) setPos(t);
  };

  const loop = () => {
    frame();
    const v = vref.current;
    if (v && !v.paused && !v.ended) R.current.raf = requestAnimationFrame(loop);
  };

  const trySeek = (t, quiet) => {
    const v = vref.current;
    if (!v) return false;
    const D = v.duration || dur;
    const tt = Math.max(0, Math.min(D ? D - 0.1 : t, t));
    const ok = props.current.canSeek ? props.current.canSeek(tt) : true;
    if (ok !== true) {
      if (!quiet) toast(typeof ok === 'string' ? ok : '아직 볼 수 없는 곳이에요', 'err');
      return false;
    }
    v.currentTime = tt;
    setPos(tt);
    frame();
    return true;
  };

  const toggle = () => {
    const v = vref.current;
    if (!v) return;
    unlockAudio();
    if (v.paused || v.ended) v.play().catch(() => {});
    else v.pause();
  };

  useEffect(() => {
    const v = vref.current;
    if (!v) return;
    const onPlay = () => {
      setPlaying(true);
      showUi();
      cancelAnimationFrame(R.current.raf);
      R.current.raf = requestAnimationFrame(loop);
    };
    const onPause = () => {
      setPlaying(false);
      setUi(true);
      if (R.current.unmuteAt !== null) {
        v.muted = false;
        R.current.unmuteAt = null;
      }
      frame();
      paintBar();
    };
    const onMeta = () => {
      setDur(v.duration || 0);
      setPos(v.currentTime);
      paintBar();
      paintOverlay(v.currentTime);
    };
    const onSeeked = () => {
      R.current.autoSeek = false;
      frame();
      paintBar();
    };
    const onTime = () => {
      if (v.paused) frame();
    };
    const onFs = () => setFs(!!(document.fullscreenElement || document.webkitFullscreenElement) || wrap.current.classList.contains('pseudo'));
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onPause);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('timeupdate', onTime);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    const ro = new ResizeObserver(() => {
      paintBar();
      paintOverlay(v.currentTime);
    });
    ro.observe(wrap.current);
    const barT = setInterval(paintBar, 3000);
    const api = {
      video: v,
      seek: (t) => trySeek(t),
      play: () => v.play().catch(() => {}),
      pause: () => v.pause(),
      redraw: () => {
        paintBar();
        paintOverlay(v.currentTime);
      },
      get autoSeek() {
        return R.current.autoSeek;
      },
    };
    if (onApi) onApi(api);
    if (tracking) tracking(v, api);
    return () => {
      cancelAnimationFrame(R.current.raf);
      clearInterval(barT);
      clearTimeout(R.current.hideT);
      ro.disconnect();
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onPause);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('timeupdate', onTime);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
    };
  }, [src]);

  useEffect(() => {
    paintBar();
    const v = vref.current;
    if (v) paintOverlay(v.currentTime);
  }, [JSON.stringify(cuts), JSON.stringify(chapters), strokes, dur]);
  useEffect(() => {
    const v = vref.current;
    if (v) caption(v.currentTime);
  }, [cues, cc]);

  // 진행 바 끌기
  const barPos = (e) => {
    const r = barCvs.current.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    return Math.max(0, Math.min(1, x / r.width)) * ((vref.current && vref.current.duration) || dur);
  };
  const onBarDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    R.current.drag = true;
    showUi();
    const move = (ev) => setPos(barPos(ev));
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      R.current.drag = false;
      const t = barPos(ev);
      if (!trySeek(t)) setPos(vref.current.currentTime);
      showUi();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    setPos(barPos(e));
  };

  const fullscreen = async () => {
    const el = wrap.current;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    if (el.classList.contains('pseudo')) {
      el.classList.remove('pseudo');
      document.documentElement.classList.remove('pl-lock');
      setFs(false);
      return;
    }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) {
      try {
        await req.call(el);
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        return;
      } catch {
        /* 아이폰 등은 아래 방식으로 */
      }
    }
    el.classList.add('pseudo');
    document.documentElement.classList.add('pl-lock');
    setFs(true);
  };

  // 화면 누르기: 휴대폰은 한 번 누르면 조작 막대, 두 번 누르면 10초 앞뒤로
  const onSurface = (e) => {
    if (e.target.closest('.pl-bar') || e.target.closest('.pl-mid')) return;
    const now = Date.now();
    if (isTouch()) {
      const r = wrap.current.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      if (now - R.current.lastTap < 300 && (x < 0.35 || x > 0.65)) {
        const v = vref.current;
        const d = x < 0.35 ? -10 : 10;
        if (trySeek(v.currentTime + d)) setFlash({ d, k: now });
        R.current.lastTap = 0;
        return;
      }
      R.current.lastTap = now;
      if (ui && playing) setUi(false);
      else showUi();
    } else toggle();
  };

  const onKey = (e) => {
    const v = vref.current;
    if (!v || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      toggle();
    } else if (e.key === 'ArrowRight') trySeek(v.currentTime + 5);
    else if (e.key === 'ArrowLeft') trySeek(v.currentTime - 5);
    else if (e.key === 'f') fullscreen();
    else if (e.key === 'c') setCc(!cc);
    showUi();
  };

  const cycleRate = () => {
    const next = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length];
    setRate(next);
    if (vref.current) vref.current.playbackRate = next;
    showUi();
  };

  return html`<div class=${`pl ${playing ? 'playing' : 'paused'} ${ui || !playing ? 'ui' : ''} ${fs ? 'fs' : ''} ${compact ? 'compact' : ''} ${cls}`} ref=${wrap} tabindex="0" onKeyDown=${onKey}
      onPointerMove=${() => !isTouch() && showUi()}>
    <video ref=${vref} src=${src} poster=${poster} playsinline webkit-playsinline="true" preload="metadata" controlslist="nodownload" disablepictureinpicture onClick=${(e) => e.preventDefault()}></video>
    <canvas class="pl-draw" ref=${cvs} aria-hidden="true"></canvas>
    <div class="pl-surface" onClick=${onSurface}></div>
    ${overlay}
    <div class="pl-cap" ref=${capEl} style="display:none"></div>
    ${name && bubble > 0 && html`<div class="pl-name" key=${bubble}><span>${name.text}</span></div>`}
    ${flash && html`<div class=${`pl-flash ${flash.d < 0 ? 'l' : 'r'}`} key=${flash.k}><${Icon} name=${flash.d < 0 ? 'back10' : 'fwd10'} size="lg" /><b>10초</b></div>`}
    <button class="pl-mid" onClick=${toggle} aria-label=${playing ? '멈추기' : '재생'}><${Icon} name=${playing ? 'pause' : 'play'} size="xl" /></button>
    <div class="pl-bar" onClick=${(e) => e.stopPropagation()}>
      <div class="pl-seek" onPointerDown=${onBarDown}>
        <canvas ref=${barCvs}></canvas>
        <div class="pl-fill" ref=${fill}></div>
        <div class="pl-knob" ref=${knob}></div>
      </div>
      <div class="pl-row">
        <button class="pl-b" onClick=${toggle} aria-label=${playing ? '멈추기' : '재생'}><${Icon} name=${playing ? 'pause' : 'play'} /></button>
        <span class="pl-time num" ref=${timeEl} data-d=${fmtT(dur || duration)}></span>
        <span class="spacer"></span>
        ${cues.length > 0 && html`<button class=${`pl-b ${cc ? 'on' : ''}`} onClick=${() => setCc(!cc)} aria-label="자막" aria-pressed=${cc}><${Icon} name="captions" /></button>`}
        <button class="pl-b pl-rate num" onClick=${cycleRate} aria-label="재생 속도">${rate}×</button>
        <button class="pl-b" onClick=${fullscreen} aria-label=${fs ? '작게 보기' : '크게 보기'}><${Icon} name=${fs ? 'minimize' : 'maximize'} /></button>
      </div>
    </div>
  </div>`;
}
