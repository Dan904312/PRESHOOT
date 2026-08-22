/**
 * PreShootOrb — vanilla JS port of the 21st.dev / OGL Orb React component.
 * Renders an animated WebGL orb into a container; used for the home scan CTA.
 */
import { Renderer, Program, Mesh, Triangle, Vec3 } from 'https://cdn.jsdelivr.net/npm/ogl@1.0.11/src/index.js';

var VERT = /* glsl */ `
  precision highp float;
  attribute vec2 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

var FRAG = /* glsl */ `
  precision highp float;

  uniform float iTime;
  uniform vec3 iResolution;
  uniform float hue;
  uniform float hover;
  uniform float rot;
  uniform float hoverIntensity;
  varying vec2 vUv;

  vec3 rgb2yiq(vec3 c) {
    float y = dot(c, vec3(0.299, 0.587, 0.114));
    float i = dot(c, vec3(0.596, -0.274, -0.322));
    float q = dot(c, vec3(0.211, -0.523, 0.312));
    return vec3(y, i, q);
  }

  vec3 yiq2rgb(vec3 c) {
    float r = c.x + 0.956 * c.y + 0.621 * c.z;
    float g = c.x - 0.272 * c.y - 0.647 * c.z;
    float b = c.x - 1.106 * c.y + 1.703 * c.z;
    return vec3(r, g, b);
  }

  vec3 adjustHue(vec3 color, float hueDeg) {
    float hueRad = hueDeg * 3.14159265 / 180.0;
    vec3 yiq = rgb2yiq(color);
    float cosA = cos(hueRad);
    float sinA = sin(hueRad);
    float i = yiq.y * cosA - yiq.z * sinA;
    float q = yiq.y * sinA + yiq.z * cosA;
    yiq.y = i;
    yiq.z = q;
    return yiq2rgb(yiq);
  }

  vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
    p3 += dot(p3, p3.yxz + 19.19);
    return -1.0 + 2.0 * fract(vec3(
      p3.x + p3.y,
      p3.x + p3.z,
      p3.y + p3.z
    ) * p3.zyx);
  }

  float snoise3(vec3 p) {
    const float K1 = 0.333333333;
    const float K2 = 0.166666667;
    vec3 i = floor(p + (p.x + p.y + p.z) * K1);
    vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
    vec3 e = step(vec3(0.0), d0 - d0.yzx);
    vec3 i1 = e * (1.0 - e.zxy);
    vec3 i2 = 1.0 - e.zxy * (1.0 - e);
    vec3 d1 = d0 - (i1 - K2);
    vec3 d2 = d0 - (i2 - K1);
    vec3 d3 = d0 - 0.5;
    vec4 h = max(0.6 - vec4(
      dot(d0, d0),
      dot(d1, d1),
      dot(d2, d2),
      dot(d3, d3)
    ), 0.0);
    vec4 n = h * h * h * h * vec4(
      dot(d0, hash33(i)),
      dot(d1, hash33(i + i1)),
      dot(d2, hash33(i + i2)),
      dot(d3, hash33(i + 1.0))
    );
    return dot(vec4(31.316), n);
  }

  vec4 extractAlpha(vec3 colorIn) {
    float a = max(max(colorIn.r, colorIn.g), colorIn.b);
    return vec4(colorIn.rgb / (a + 1e-5), a);
  }

  const vec3 baseColor1 = vec3(0.611765, 0.262745, 0.996078);
  const vec3 baseColor2 = vec3(0.298039, 0.760784, 0.913725);
  const vec3 baseColor3 = vec3(0.062745, 0.078431, 0.600000);
  const float innerRadius = 0.6;
  const float noiseScale = 0.65;

  float light1(float intensity, float attenuation, float dist) {
    return intensity / (1.0 + dist * attenuation);
  }

  float light2(float intensity, float attenuation, float dist) {
    return intensity / (1.0 + dist * dist * attenuation);
  }

  vec4 draw(vec2 uv) {
    vec3 color1 = adjustHue(baseColor1, hue);
    vec3 color2 = adjustHue(baseColor2, hue);
    vec3 color3 = adjustHue(baseColor3, hue);

    float ang = atan(uv.y, uv.x);
    float len = length(uv);
    float invLen = len > 0.0 ? 1.0 / len : 0.0;

    float n0 = snoise3(vec3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
    float r0 = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
    float d0 = distance(uv, (r0 * invLen) * uv);
    float v0 = light1(1.0, 10.0, d0);
    v0 *= smoothstep(r0 * 1.05, r0, len);
    float cl = cos(ang + iTime * 2.0) * 0.5 + 0.5;

    float a = iTime * -1.0;
    vec2 pos = vec2(cos(a), sin(a)) * r0;
    float d = distance(uv, pos);
    float v1 = light2(1.5, 5.0, d);
    v1 *= light1(1.0, 50.0, d0);

    float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
    float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);

    vec3 col = mix(color1, color2, cl);
    col = mix(color3, col, v0);
    col = (col + v1) * v2 * v3;
    col = clamp(col, 0.0, 1.0);

    return extractAlpha(col);
  }

  vec4 mainImage(vec2 fragCoord) {
    vec2 center = iResolution.xy * 0.5;
    float size = min(iResolution.x, iResolution.y);
    vec2 uv = (fragCoord - center) / size * 2.0;

    float angle = rot;
    float s = sin(angle);
    float c = cos(angle);
    uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);

    uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime);
    uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime);

    return draw(uv);
  }

  void main() {
    vec2 fragCoord = vUv * iResolution.xy;
    vec4 col = mainImage(fragCoord);
    gl_FragColor = vec4(col.rgb * col.a, col.a);
  }
`;

/* Shader baseColor1 RGB(0.612, 0.263, 0.996) ≈ HSL hue 269°.
   The `hue` uniform is a RELATIVE rotation from that base — not an absolute HSL hue.
   Passing absolute accent hue (e.g. blue 212°) was rotating purple into green/yellow. */
var ORB_BASE_HUE = 269;

function hexToAbsoluteHue(hex) {
  if (!hex || typeof hex !== 'string') return 212; /* #4A9EFF */
  var h = hex.replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return 212;
  var r = parseInt(h.slice(0, 2), 16) / 255;
  var g = parseInt(h.slice(2, 4), 16) / 255;
  var b = parseInt(h.slice(4, 6), 16) / 255;
  var max = Math.max(r, g, b);
  var min = Math.min(r, g, b);
  var d = max - min;
  if (d < 1e-6) return 212;
  var hue;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return hue;
}

function hexToHue(hex) {
  return hexToAbsoluteHue(hex) - ORB_BASE_HUE;
}

function createOrb(container, options) {
  options = options || {};
  if (!container) return null;

  var hue = options.hue != null ? options.hue : hexToHue('#4A9EFF');
  var hoverIntensity = options.hoverIntensity != null ? options.hoverIntensity : 0.6;
  var rotateOnHover = options.rotateOnHover !== false;
  var forceHoverState = !!options.forceHoverState;
  var paused = false;

  var renderer = null;
  var gl = null;
  var program = null;
  var mesh = null;
  var rafId = 0;
  var targetHover = 0;
  var lastTime = 0;
  var currentRot = 0;
  var rotationSpeed = 0.3;
  var destroyed = false;

  try {
    renderer = new Renderer({
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      dpr: Math.min(window.devicePixelRatio || 1, 2)
    });
    gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.canvas.style.display = 'block';
    gl.canvas.style.width = '100%';
    gl.canvas.style.height = '100%';
    gl.canvas.style.pointerEvents = 'none';

    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(gl.canvas);

    var geometry = new Triangle(gl);
    program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        iTime: { value: 0 },
        iResolution: {
          value: new Vec3(gl.canvas.width, gl.canvas.height, 1)
        },
        hue: { value: hue },
        hover: { value: 0 },
        rot: { value: 0 },
        hoverIntensity: { value: hoverIntensity }
      }
    });
    mesh = new Mesh(gl, { geometry: geometry, program: program });
  } catch (err) {
    console.error('PreShootOrb: WebGL init failed', err);
    return null;
  }

  function resize() {
    if (destroyed || !container || !renderer || !gl || !program) return;
    var width = container.clientWidth;
    var height = container.clientHeight;
    if (width < 2 || height < 2) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.dpr = dpr;
    renderer.setSize(width, height);
    gl.canvas.style.width = width + 'px';
    gl.canvas.style.height = height + 'px';
    program.uniforms.iResolution.value.set(
      gl.canvas.width,
      gl.canvas.height,
      gl.canvas.width / Math.max(gl.canvas.height, 1)
    );
  }

  function pointerFromEvent(e) {
    var rect = container.getBoundingClientRect();
    var clientX = e.clientX;
    var clientY = e.clientY;
    if (e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    var x = clientX - rect.left;
    var y = clientY - rect.top;
    var size = Math.min(rect.width, rect.height);
    var uvX = ((x - rect.width / 2) / size) * 2.0;
    var uvY = ((y - rect.height / 2) / size) * 2.0;
    targetHover = Math.sqrt(uvX * uvX + uvY * uvY) < 0.8 ? 1 : 0;
  }

  function onLeave() {
    targetHover = 0;
  }

  function update(t) {
    if (destroyed) return;
    rafId = requestAnimationFrame(update);
    if (paused || !program || !renderer || !mesh) return;

    var dt = (t - lastTime) * 0.001;
    lastTime = t;
    program.uniforms.iTime.value = t * 0.001;
    program.uniforms.hue.value = hue;
    program.uniforms.hoverIntensity.value = hoverIntensity;

    var effectiveHover = forceHoverState ? 1 : targetHover;
    program.uniforms.hover.value += (effectiveHover - program.uniforms.hover.value) * 0.1;

    if (rotateOnHover && effectiveHover > 0.5) {
      currentRot += dt * rotationSpeed;
    }
    program.uniforms.rot.value = currentRot;
    renderer.render({ scene: mesh });
  }

  var host = options.interactionHost || container;
  window.addEventListener('resize', resize);
  host.addEventListener('mousemove', pointerFromEvent);
  host.addEventListener('mouseleave', onLeave);
  host.addEventListener('touchstart', pointerFromEvent, { passive: true });
  host.addEventListener('touchmove', pointerFromEvent, { passive: true });
  host.addEventListener('touchend', onLeave);
  host.addEventListener('touchcancel', onLeave);

  resize();
  rafId = requestAnimationFrame(update);

  return {
    setHue: function (v) {
      hue = v;
    },
    setHoverIntensity: function (v) {
      hoverIntensity = v;
    },
    setForceHover: function (v) {
      forceHoverState = !!v;
    },
    setPaused: function (v) {
      paused = !!v;
      if (!paused) lastTime = performance.now();
    },
    resize: resize,
    destroy: function () {
      destroyed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      host.removeEventListener('mousemove', pointerFromEvent);
      host.removeEventListener('mouseleave', onLeave);
      host.removeEventListener('touchstart', pointerFromEvent);
      host.removeEventListener('touchmove', pointerFromEvent);
      host.removeEventListener('touchend', onLeave);
      host.removeEventListener('touchcancel', onLeave);
      if (gl && gl.canvas && gl.canvas.parentNode === container) {
        container.removeChild(gl.canvas);
      }
      if (gl) {
        var ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
    }
  };
}

var scanOrbInstance = null;

function mountScanOrb() {
  var ring = document.getElementById('scan-ring');
  var mount = document.getElementById('scan-orb');
  if (!ring || !mount) return;

  if (scanOrbInstance) {
    scanOrbInstance.destroy();
    scanOrbInstance = null;
  }

  var accent = (typeof S !== 'undefined' && S.accent) ? S.accent : '#4A9EFF';
  scanOrbInstance = createOrb(mount, {
    hue: hexToHue(accent),
    hoverIntensity: 0.6,
    rotateOnHover: true,
    forceHoverState: false,
    interactionHost: ring
  });

  syncScanOrbVisibility();
}

function syncScanOrbVisibility() {
  if (!scanOrbInstance) return;
  var home = document.getElementById('screen-home');
  var visible = !!(home && home.classList.contains('active'));
  scanOrbInstance.setPaused(!visible);
  if (visible) scanOrbInstance.resize();
}

function setScanOrbHueFromAccent(hex) {
  if (scanOrbInstance) scanOrbInstance.setHue(hexToHue(hex));
}

window.PreShootOrb = {
  create: createOrb,
  mountScanOrb: mountScanOrb,
  syncVisibility: syncScanOrbVisibility,
  setAccent: setScanOrbHueFromAccent,
  hexToHue: hexToHue
};

function boot() {
  mountScanOrb();
  /* Re-sync when tabs change — goTab mutates .active on screens */
  var home = document.getElementById('screen-home');
  if (home && typeof MutationObserver !== 'undefined') {
    new MutationObserver(syncScanOrbVisibility).observe(home, {
      attributes: true,
      attributeFilter: ['class']
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
