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
        <title>PreShoot: AI Video Ideas for Creators</title>
        <meta
          name="description"
          content="Scan anything. Get six film-ready ideas. In thirty seconds."
        />
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
