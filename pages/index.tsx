import Head from 'next/head';

/**
 * PreShoot root route.
 * Production landing is the static index.html (vercel.json routes "/" → "/index.html").
 * This page exists only so a Next detection never briefly renders the old stub "Home Screen".
 * If Next ever serves "/", paint the same Hero first-frame immediately, then hand off.
 */
export default function LandingFallback() {
  return (
    <>
      <Head>
        <title>PreShoot — AI Creative Production Studio</title>
        <meta
          name="description"
          content="PreShoot helps creators and businesses turn ideas into production-ready content with AI-powered strategy, scripts, shot lists, and production planning."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://preshoot.vercel.app/" />
        <meta property="og:title" content="PreShoot — AI Creative Production Studio" />
        <meta property="og:description" content="PreShoot helps creators and businesses turn ideas into production-ready content with AI-powered strategy, scripts, shot lists, and production planning." />
        <meta property="og:image" content="https://preshoot.vercel.app/og/preshoot-cover.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="PreShoot — AI Creative Production Studio" />
        <meta name="twitter:description" content="PreShoot helps creators and businesses turn ideas into production-ready content with AI-powered strategy, scripts, shot lists, and production planning." />
        <meta name="twitter:image" content="https://preshoot.vercel.app/og/preshoot-cover.jpg" />
        <meta httpEquiv="refresh" content="0;url=/index.html" />
        <link rel="canonical" href="/" />
        <style>{`
          html,body{margin:0;background:#161618;color:#f4f4f6;font-family:system-ui,sans-serif}
          .hero{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px}
          .brand{font-size:1.5rem;font-weight:700;letter-spacing:-.03em;margin-bottom:14px}
          .brand span{color:#4A9EFF}
          .line{font-size:clamp(1.45rem,4.4vw,2.5rem);font-weight:700;letter-spacing:-.04em;line-height:1.15;max-width:16ch}
          .sub{margin-top:16px;font-size:clamp(15px,2.2vw,18px);color:rgba(244,244,246,.58);font-weight:500}
        `}</style>
      </Head>
      <main className="hero" aria-label="PreShoot">
        <div className="brand">
          Pre<span>Shoot</span>
        </div>
        <div className="line">Scan ANYTHING.</div>
        <div className="line">Get six film-ready ideas.</div>
        <p className="sub">In thirty seconds.</p>
      </main>
    </>
  );
}
