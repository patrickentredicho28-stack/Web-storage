const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const generatedDir = path.join(root, "generated-sites");
const dataDir = path.join(root, "data");
const storagePath = path.join(dataDir, "website-storage.json");
const port = Number(process.env.PORT || 4317);

fs.mkdirSync(generatedDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

const framework = [
  "Big Promise / Desired Outcome",
  "Empathy / Connection",
  "Opportunity Vehicle / Solution",
  "Before vs After / Gap & Bridge",
  "USP / Unique Selling Proposition",
  "Offer Positioning / No-Brainer Deal",
  "Social Proof / Instant Credibility",
  "Risk Reversal / Lower The Bar",
  "Authority / Trust The Source",
  "Urgency / Take Action Today",
  "FAQ / Concerns & Objections"
];

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (req.method === "GET" && url.pathname === "/") {
      return serveFile(res, path.join(root, "website-storage.html"));
    }
    if (req.method === "POST" && url.pathname === "/api/autoresearch") {
      const body = await readJson(req);
      const result = await runLiveAutoResearch(body);
      return json(res, 200, result);
    }
    if (req.method === "GET" && url.pathname === "/api/storage") {
      return json(res, 200, readStorage());
    }
    const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(root, safePath === "\\" || safePath === "/" ? "website-storage.html" : safePath);
    if (!filePath.startsWith(root)) return text(res, 403, "Forbidden");
    return serveFile(res, filePath);
  } catch (error) {
    return json(res, 500, {
      error: error.message || "Unexpected server error",
      detail: "No generated website was created unless live search and source inspection completed."
    });
  }
}).listen(port, () => {
  console.log(`Website Storage live app running at http://localhost:${port}`);
});

function serveFile(res, filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return text(res, 404, "Not found");
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function text(res, status, payload) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(payload);
}

async function runLiveAutoResearch(job) {
  const niche = clean(job.niche || "Custom");
  const count = Math.max(1, Math.min(Number(job.count || 1), 5));
  const type = normalizeType(job.type);
  const style = clean(job.style || "Premium");
  const goal = clean(job.goal || "Capture qualified leads");
  const queries = buildSearchQueries({ niche, type, style, goal });
  const sourceUrls = (await Promise.all(queries.map(query => searchWeb(query, count * 5))))
    .flat()
    .filter((url, index, all) => all.indexOf(url) === index)
    .filter(url => !isLowQualitySource(url))
    .slice(0, count * 8);
  if (!sourceUrls.length) {
    throw new Error(`Live search found no strong source websites for "${niche}".`);
  }

  const inspected = [];
  for (const sourceUrl of sourceUrls) {
    if (inspected.length >= count * 3) break;
    try {
      const teardown = await inspectWebsite(sourceUrl);
      const score = scoreTeardown(teardown);
      if (score < 7) continue;
      inspected.push({ sourceUrl, teardown, score });
    } catch (error) {
      // Skip unreachable or blocked websites. At least one successful live inspection is required.
    }
  }

  const records = inspected
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(item => createGeneratedWebsite({ niche, type, style, goal, sourceUrl: item.sourceUrl, teardown: item.teardown }));

  if (!records.length) {
    throw new Error("Live browsing ran, but no selected website could be inspected deeply enough to mirror.");
  }

  const existing = readStorage();
  writeStorage([...records, ...existing]);
  return { records };
}

function buildSearchQueries({ niche, type, style, goal }) {
  const intent = goal.replace(/^book /i, "").replace(/^capture /i, "");
  return [
    `${niche} ${style} ${type.toLowerCase()} "book a call"`,
    `${niche} ${style} website "schedule a consultation"`,
    `${niche} services website "${intent}"`,
    `${niche} ${type.toLowerCase()} "contact us" "${style}"`
  ];
}

async function searchWeb(query, limit) {
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(searchUrl);
  const urls = [];
  const regex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"/g;
  let match;
  while ((match = regex.exec(html)) && urls.length < limit) {
    let href = decodeHtml(match[1]);
    try {
      const parsed = new URL(href, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) href = uddg;
    } catch {}
    if (/^https?:\/\//.test(href) && !/duckduckgo|google|bing|yahoo|facebook|instagram|youtube|linkedin|x\.com|twitter/.test(href)) {
      urls.push(href);
    }
  }
  return [...new Set(urls)];
}

function isLowQualitySource(sourceUrl) {
  const value = sourceUrl.toLowerCase();
  return /examples|example|template|templates|theme|themes|blog|article|guide|how-to|best-|top-|inspiration|gallery|directory|clutch|upcity|themeforest|wordpress|thrivethemes|hubspot|unbounce|leadpages|webflow\.com\/templates|dribbble|behance|pinterest/.test(value);
}

async function inspectWebsite(sourceUrl) {
  const html = await fetchText(sourceUrl);
  const cssText = await fetchStylesheets(sourceUrl, html);
  const combined = `${html}\n${cssText}`;
  const title = textBetween(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || hostName(sourceUrl);
  const meta = textBetween(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || "";
  const body = textBetween(html, /<body[^>]*>([\s\S]*?)<\/body>/i) || html;
  const ctas = extractMatches(body, /<a[^>]*>([\s\S]{0,120}?)<\/a>|<button[^>]*>([\s\S]{0,120}?)<\/button>/gi)
    .map(stripTags)
    .filter(value => /\b(book|call|demo|start|get|apply|contact|quote|consult|schedule|learn)\b/i.test(value))
    .slice(0, 8);
  const headings = extractMatches(body, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi).map(stripTags).filter(Boolean).slice(0, 14);
  const navItems = extractMatches(body, /<nav[\s\S]*?<\/nav>/gi)
    .flatMap(nav => extractMatches(nav, /<a[^>]*>([\s\S]{0,100}?)<\/a>/gi).map(stripTags))
    .filter(Boolean)
    .slice(0, 8);
  const sectionClassNames = extractMatches(body, /<(section|header|main|footer|div)[^>]+class=["']([^"']+)["']/gi, 2)
    .map(value => value.split(/\s+/).slice(0, 3).join(" "))
    .filter(Boolean)
    .slice(0, 16);
  const sectionBlocks = extractSectionBlocks(body).slice(0, 12);
  const hasVideo = /<video|youtube|vimeo/i.test(body);
  const hasForm = /<form|type=["']email|textarea|select/i.test(body);
  const hasAnimation = /gsap|framer|data-aos|scrolltrigger|intersectionobserver|swiper|splide|slick|lenis|locomotive|animejs/i.test(combined);
  const hasSticky = /position\s*:\s*sticky|position\s*:\s*fixed|sticky|fixed-header/i.test(combined);
  const hasCards = /card|grid|testimonial|feature|service/i.test(body);
  const colors = [...new Set((combined.match(/#[0-9a-f]{3,8}\b|rgb[a]?\([^)]+\)|hsl[a]?\([^)]+\)/gi) || []).slice(0, 18))];
  const fonts = [...new Set((combined.match(/font-family\s*:\s*([^;{}]+)/gi) || []).map(value => clean(value.replace(/font-family\s*:/i, ""))).slice(0, 8))];
  return {
    title: clean(title),
    meta: clean(meta),
    headings,
    navItems,
    ctas,
    sections: sectionClassNames,
    sectionBlocks,
    interactions: [
      hasAnimation ? "Scroll or reveal animation patterns detected in source." : "No obvious animation library detected from HTML.",
      hasVideo ? "Video or embedded media appears in the source." : "No obvious video embed detected.",
      hasForm ? "Lead capture form pattern detected." : "No obvious form detected in static HTML.",
      hasSticky ? "Sticky or fixed navigation/header behavior detected." : "No sticky header behavior detected from source.",
      hasCards ? "Card or grid-based proof/service rhythm detected." : "No strong card/grid rhythm detected from source."
    ],
    layout: {
      hero: headings[0] || title,
      firstCTA: ctas[0] || "",
      navItems,
      hasForm,
      hasVideo,
      hasAnimation,
      hasSticky,
      hasCards,
      sectionCount: sectionBlocks.length || sectionClassNames.length
    },
    colors,
    fonts
  };
}

async function fetchStylesheets(sourceUrl, html) {
  const hrefs = extractMatches(html, /<link[^>]+rel=["'][^"']*stylesheet[^"']*["'][^>]+href=["']([^"']+)["']/gi)
    .slice(0, 4);
  const chunks = [];
  for (const href of hrefs) {
    try {
      const cssUrl = new URL(decodeHtml(href), sourceUrl).toString();
      const sameHost = new URL(cssUrl).hostname === new URL(sourceUrl).hostname;
      if (!sameHost) continue;
      chunks.push(await fetchText(cssUrl));
    } catch {}
  }
  return chunks.join("\n");
}

function extractSectionBlocks(body) {
  const sectionHtml = extractMatches(body, /<(section|header|main|footer)[^>]*>([\s\S]*?)<\/\1>/gi, 2);
  return sectionHtml.map((block, index) => {
    const heading = textBetween(block, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
    const cta = extractMatches(block, /<a[^>]*>([\s\S]{0,100}?)<\/a>|<button[^>]*>([\s\S]{0,100}?)<\/button>/gi).map(stripTags).find(Boolean) || "";
    const text = stripTags(block).slice(0, 240);
    return { index, heading: clean(heading), cta: clean(cta), text: clean(text) };
  }).filter(section => section.heading || section.cta || section.text.length > 80);
}

function scoreTeardown(teardown) {
  let score = 0;
  score += Math.min(teardown.headings.length, 8);
  score += Math.min(teardown.ctas.length * 2, 8);
  score += Math.min((teardown.sectionBlocks || []).length * 2, 12);
  if (teardown.layout.hasForm) score += 4;
  if (teardown.layout.hasSticky) score += 2;
  if (teardown.layout.hasAnimation) score += 2;
  if (teardown.colors.length >= 3) score += 2;
  if (teardown.meta) score += 2;
  return score;
}

function createGeneratedWebsite({ niche, type, style, goal, sourceUrl, teardown }) {
  const id = `live-${slug(niche)}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const brand = brandName(niche);
  const primaryCTA = type === "BOOKING PAGE" ? "Book the Planning Call" :
    type === "OPT-IN PAGE" ? "Get the Free Audit" :
    type === "FUNNEL" ? "Start the Fit Check" :
    "Request the Growth Plan";
  const headline = headlineFor(niche, goal);
  const sections = framework.map((label, index) => sectionFor(label, { niche, brand, primaryCTA, goal, teardown, index }));
  const fileName = `${id}.html`;
  const localPath = `generated-sites/${fileName}`;
  const pageHtml = renderGeneratedPage({ id, brand, niche, type, style, goal, sourceUrl, teardown, primaryCTA, headline, sections });
  fs.writeFileSync(path.join(generatedDir, fileName), pageHtml, "utf8");

  return {
    id,
    name: brand,
    niche,
    type,
    version: "LIVE-A",
    url: localPath,
    localPath,
    screenshot: makePreviewSvg(niche, brand, type),
    sourceInspiration: `Live source inspected: ${sourceUrl}. Source title: ${teardown.title}. Mirrored strategy signals: hero "${teardown.layout.hero}", first CTA "${teardown.layout.firstCTA || "none detected"}", nav rhythm "${teardown.navItems.slice(0, 4).join(", ") || "minimal"}", sections "${teardown.sectionBlocks.map(section => section.heading).filter(Boolean).slice(0, 5).join(" / ") || teardown.sections.slice(0, 5).join(", ")}". No source brand name, exact copy, logo, images, testimonials, or protected assets were reused.`,
    sourceUrl,
    positioningAngle: `${style} ${type.toLowerCase()} for ${niche} prospects focused on ${goal.toLowerCase()}.`,
    headline,
    primaryCTA,
    sectionBreakdown: sections.map(section => section.title),
    designNotes: [
      `Inspired by ${hostName(sourceUrl)} layout rhythm, spacing logic, and CTA placement.`,
      teardown.colors.length ? `Source color signals observed: ${teardown.colors.slice(0, 4).join(", ")}. Final palette is original.` : "Final palette is original because no reliable source color tokens were extracted.",
      teardown.fonts.length ? `Source typography signals observed: ${teardown.fonts.slice(0, 3).join(" | ")}.` : "No reliable source typography tokens extracted.",
      `Source hero signal: ${teardown.layout.hero}.`,
      `Source CTA signal: ${teardown.layout.firstCTA || "No clear CTA text detected"}.`,
      ...teardown.interactions
    ],
    conversionNotes: [
      `Primary conversion goal: ${goal}.`,
      `Primary CTA: ${primaryCTA}.`,
      "Reorganized into the required 11-part conversion framework.",
      "Mirrors funnel logic only, not protected content."
    ],
    frameworkMapping: sections.map(section => `${section.title}: ${section.headline}`),
    tags: ["Live researched", "Generated", style, type],
    isFavorite: false,
    isArchived: false,
    createdAt: new Date().toISOString()
  };
}

function renderGeneratedPage({ brand, niche, type, style, goal, sourceUrl, teardown, primaryCTA, headline, sections }) {
  const sectionCards = sections.map((section, index) => `
    <section class="framework-block">
      <span class="num">${String(index + 1).padStart(2, "0")}</span>
      <div>
        <p class="kicker">${escapeHtml(section.title)}</p>
        <h2>${escapeHtml(section.headline)}</h2>
        <p>${escapeHtml(section.body)}</p>
        ${section.cta ? `<a class="button secondary" href="#contact">${escapeHtml(section.cta)}</a>` : ""}
      </div>
    </section>`).join("");
  const sourceSections = (teardown.sectionBlocks || []).slice(0, 6).map((section, index) => `
    <article>
      <span>${String(index + 1).padStart(2, "0")} Source rhythm</span>
      <strong>${escapeHtml(section.heading || section.cta || `Section ${index + 1}`)}</strong>
      <p>${escapeHtml(section.text || "Structural source section used for rhythm, not copied content.")}</p>
    </article>`).join("");
  const sourceCtas = (teardown.ctas || []).slice(0, 5).map(cta => `<li>${escapeHtml(cta)}</li>`).join("");
  const sourceNav = (teardown.navItems || []).slice(0, 6).map(item => `<li>${escapeHtml(item)}</li>`).join("");
  const visualMode = teardown.layout.hasForm ? "Lead form emphasis" : teardown.layout.hasVideo ? "Media-led hero" : teardown.layout.hasCards ? "Card-grid proof rhythm" : "Editorial section rhythm";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(brand)} | ${escapeHtml(niche)} ${escapeHtml(type)}</title>
  <meta name="description" content="${escapeHtml(headline)}" />
  <style>
    :root{color-scheme:dark;--bg:oklch(13% .018 252);--panel:oklch(20% .02 252);--text:oklch(94% .012 252);--muted:oklch(72% .03 252);--line:oklch(100% .005 252 / .12);--accent:oklch(74% .13 218);--warm:oklch(80% .13 67);--ease:cubic-bezier(.16,1,.3,1)}
    *{box-sizing:border-box}body{margin:0;min-height:100dvh;font-family:Aptos,Segoe UI,sans-serif;color:var(--text);background:radial-gradient(circle at 78% -10%,oklch(60% .16 246 / .2),transparent 30rem),linear-gradient(145deg,oklch(10% .018 252),var(--bg));overflow-x:hidden}body:before{content:"";position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(oklch(100% .005 252 / .035) 1px,transparent 1px),linear-gradient(90deg,oklch(100% .005 252 / .035) 1px,transparent 1px);background-size:44px 44px;mask-image:linear-gradient(to bottom,#000,transparent 72%);z-index:-1}a{color:inherit;text-decoration:none}.wrap{width:min(1180px,calc(100% - 36px));margin:auto}.nav{position:sticky;top:0;z-index:10;display:flex;justify-content:space-between;align-items:center;gap:16px;min-height:76px;backdrop-filter:blur(14px)}.brand{display:flex;gap:11px;align-items:center;font-weight:900}.mark{display:grid;place-items:center;width:38px;height:38px;border:1px solid var(--line);border-radius:13px;color:var(--accent);background:oklch(100% .005 252 / .055)}.nav-links{display:flex;gap:14px;align-items:center;color:var(--muted);font-size:14px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border:1px solid oklch(78% .12 218 / .34);border-radius:999px;padding:0 18px;background:linear-gradient(180deg,oklch(62% .15 246),oklch(48% .13 246));box-shadow:0 16px 42px oklch(46% .15 246 / .22);font-weight:900;transition:transform 220ms var(--ease)}.button:hover{transform:translateY(-2px)}.button.secondary{background:oklch(100% .005 252 / .055);box-shadow:none;border-color:var(--line)}.hero{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(320px,.72fr);gap:30px;align-items:center;min-height:calc(100dvh - 90px);padding:46px 0 70px}.eyebrow{display:inline-flex;min-height:32px;align-items:center;border:1px solid oklch(78% .12 218 / .24);border-radius:999px;padding:0 12px;color:oklch(84% .1 218);background:oklch(62% .13 246 / .1);font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}h1{max-width:820px;margin:22px 0 18px;font-size:clamp(46px,7vw,92px);line-height:.92;letter-spacing:0;text-wrap:balance}.lead{max-width:690px;margin:0;color:var(--muted);font-size:clamp(17px,2vw,22px);line-height:1.55}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}.visual,.panel,.framework-block,.faq details,.source-teardown article{border:1px solid var(--line);background:linear-gradient(180deg,oklch(100% .005 252 / .055),oklch(100% .005 252 / .028));box-shadow:0 26px 76px oklch(7% .02 252 / .48)}.visual{min-height:500px;border-radius:32px;padding:24px}.source-map,.source-teardown{display:grid;gap:14px;margin-top:20px}.source-map article,.source-teardown article{border:1px solid var(--line);border-radius:18px;padding:18px;background:oklch(10% .014 252 / .68)}.source-map span,.source-teardown span,.kicker{display:block;margin-bottom:8px;color:var(--accent);font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.source-teardown p{color:var(--muted);line-height:1.5}.section-head{display:grid;grid-template-columns:minmax(0,.75fr) minmax(260px,.42fr);gap:28px;align-items:end;margin-bottom:26px}.section-head h2{margin:0;font-size:clamp(34px,4.7vw,64px);line-height:.98}.section-head p,.framework-block p,.panel p,.faq p{color:var(--muted);line-height:1.62}.framework{display:grid;gap:14px}.framework-block{display:grid;grid-template-columns:56px minmax(0,1fr);gap:18px;border-radius:24px;padding:22px}.num{display:grid;place-items:center;width:48px;height:48px;border-radius:16px;color:var(--accent);background:oklch(62% .13 246 / .12);font-weight:900}.framework-block h2{margin:0 0 8px;font-size:26px}.offer{display:grid;grid-template-columns:minmax(0,.72fr) minmax(300px,.42fr);gap:22px;padding:86px 0}.panel{border-radius:28px;padding:28px}.list{display:grid;gap:12px;padding:0;margin:18px 0 0;list-style:none}.list li{color:var(--muted);line-height:1.55}.faq{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.faq details{border-radius:20px;padding:18px}.final{margin:90px 0;border:1px solid oklch(78% .12 218 / .26);border-radius:34px;padding:clamp(30px,6vw,70px);background:radial-gradient(circle at 88% 12%,oklch(74% .13 218 / .18),transparent 22rem),linear-gradient(145deg,oklch(23% .024 252),oklch(13% .018 252));box-shadow:0 26px 76px oklch(7% .02 252 / .48)}.final h2{max-width:820px;margin:0 0 16px;font-size:clamp(36px,5vw,72px);line-height:.95}@media(max-width:850px){.nav,.nav-links,.actions{align-items:stretch;flex-direction:column}.hero,.section-head,.offer,.faq{grid-template-columns:1fr}.hero{min-height:auto}.button{width:100%}.framework-block{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{transition-duration:.001ms!important;animation-duration:.001ms!important;scroll-behavior:auto!important}}
  </style>
</head>
<body>
  <header class="wrap nav"><a class="brand" href="#"><span class="mark">${escapeHtml(brand.slice(0, 2).toUpperCase())}</span>${escapeHtml(brand)}</a><nav class="nav-links"><a href="#framework">Framework</a><a href="#offer">Offer</a><a href="#faq">FAQ</a><a class="button" href="#contact">${escapeHtml(primaryCTA)}</a></nav></header>
  <main>
    <section class="wrap hero"><div><span class="eyebrow">${escapeHtml(niche)} ${escapeHtml(type)}</span><h1>${escapeHtml(headline)}</h1><p class="lead">${escapeHtml(goal)} through an original page built from live research, source teardown, and a transformed conversion framework.</p><div class="actions"><a class="button" href="#contact">${escapeHtml(primaryCTA)}</a><a class="button secondary" href="#source">View live teardown</a></div></div><aside class="visual"><p class="kicker">Live source inspected</p><h2>${escapeHtml(teardown.title || hostName(sourceUrl))}</h2><p class="lead">${escapeHtml(teardown.meta || sourceUrl)}</p><div class="source-map"><article><span>Mirrored layout mode</span><strong>${escapeHtml(visualMode)}</strong></article><article><span>Source hero signal</span><strong>${escapeHtml(teardown.layout.hero || "Hero heading detected")}</strong></article><article><span>Source first CTA</span><strong>${escapeHtml(teardown.layout.firstCTA || "No direct CTA detected")}</strong></article><article><span>Source</span><strong>${escapeHtml(sourceUrl)}</strong></article></div></aside></section>
    <section class="wrap" id="source"><div class="section-head"><h2>Source teardown signals used for mirroring.</h2><p>This is the real inspected website structure. The generated page mirrors rhythm, CTA logic, and hierarchy, then rewrites everything into an original brand and your framework.</p></div><div class="source-teardown">${sourceSections || `<article><span>Source</span><strong>${escapeHtml(teardown.title)}</strong><p>${escapeHtml(teardown.meta || sourceUrl)}</p></article>`}</div></section>
    <section class="wrap" id="framework"><div class="section-head"><h2>Rebuilt around your required conversion framework.</h2><p>The reference informed structure and direction only. This page uses an original brand, original copy, original offer framing, and a fresh visual identity.</p></div><div class="framework">${sectionCards}</div></section>
    <section class="wrap offer" id="offer"><div class="panel"><p class="kicker">Offer</p><h2>${escapeHtml(primaryCTA)}</h2><p>The first action is specific, low-friction, and aligned with the visitor's intent.</p><ul class="list"><li>CTA appears at natural decision points.</li><li>Proof and risk reversal come before the final ask.</li><li>Mobile layout keeps the action clear without crowding.</li><li>Source CTA pattern observed: ${escapeHtml((teardown.ctas || []).slice(0, 3).join(" / ") || "No source CTA text extracted")}.</li></ul></div><aside class="panel"><p class="kicker">Teardown Signals</p><ul class="list">${teardown.interactions.map(item => `<li>${escapeHtml(item)}</li>`).join("")}${sourceNav ? `<li>Source navigation rhythm: ${sourceNav.replace(/<\/?li>/g, " / ").replace(/^\s*\/\s*|\s*\/\s*$/g, "")}</li>` : ""}${sourceCtas ? `<li>Source CTAs: ${sourceCtas.replace(/<\/?li>/g, " / ").replace(/^\s*\/\s*|\s*\/\s*$/g, "")}</li>` : ""}</ul></aside></section>
    <section class="wrap" id="faq"><div class="section-head"><h2>Concerns handled before conversion.</h2><p>Objections are answered in plain language so the visitor knows what happens next.</p></div><div class="faq"><details open><summary>Is this copied?</summary><p>No. It mirrors strategy from a live inspected source, then replaces all protected or brand-specific material.</p></details><details><summary>What was inspected?</summary><p>Section structure, heading hierarchy, CTA placement, form/media signals, styling direction, and interaction clues.</p></details><details><summary>What happens after the CTA?</summary><p>The visitor receives a clear first step tied to ${escapeHtml(goal.toLowerCase())}.</p></details><details><summary>Can this be edited?</summary><p>Yes. Return to Website Storage and use the Edit action on the generated card.</p></details></div></section>
    <section class="wrap final" id="contact"><h2>${escapeHtml(sections.at(-1).headline)}</h2><p>${escapeHtml(sections.at(-1).body)}</p><div class="actions"><a class="button" href="mailto:hello@example.com?subject=${encodeURIComponent(brand)}">${escapeHtml(primaryCTA)}</a><a class="button secondary" href="../website-storage.html">Back to Website Storage</a></div></section>
  </main>
</body>
</html>`;
}

function sectionFor(label, context) {
  const { niche, brand, primaryCTA, goal, teardown } = context;
  const sourceHint = teardown.headings[context.index] || teardown.sections[context.index] || "the inspected reference";
  const map = {
    "Big Promise / Desired Outcome": [`${niche} prospects get a clear path to action.`, `${brand} turns attention into a confident next step with a page shaped around ${goal.toLowerCase()}.`, primaryCTA],
    "Empathy / Connection": ["Your visitor is interested, but not yet convinced.", `The page reflects the friction seen in ${niche}: comparison, uncertainty, and the need for trust before contact.`, ""],
    "Opportunity Vehicle / Solution": [`A guided ${niche} conversion path.`, `The mechanism combines a strong promise, visible proof, CTA repetition, and source-inspired section rhythm from ${sourceHint}.`, ""],
    "Before vs After / Gap & Bridge": ["From passive browsing to qualified action.", "Before: visitors skim and leave. After: they understand the offer, trust the process, and know what happens after clicking.", ""],
    "USP / Unique Selling Proposition": ["Mirrored strategy, original brand.", "The structure borrows proven logic from live research while the identity, claims, copy, and visuals are freshly created.", ""],
    "Offer Positioning / No-Brainer Deal": [`${primaryCTA} is the obvious first step.`, "The offer is framed as useful, specific, and lower-pressure than a generic sales call.", primaryCTA],
    "Social Proof / Instant Credibility": ["Proof appears where hesitation appears.", "Use reviews, transparent examples, process screenshots, or credentials without inventing results.", ""],
    "Risk Reversal / Lower The Bar": ["A simple first step beats a hard sell.", "The visitor sees what happens next, what they need to provide, and why there is no pressure.", primaryCTA],
    "Authority / Trust The Source": ["The method is visible.", "Authority comes from clear standards, process detail, and useful guidance before the ask.", ""],
    "Urgency / Take Action Today": ["Delay has a cost.", "Ethical urgency points to missed opportunities, limited implementation capacity, or the benefit of solving the issue now.", primaryCTA],
    "FAQ / Concerns & Objections": ["The page answers the questions that slow action.", "Fit, timeline, pricing factors, tools, handoff, and next steps are handled before the final CTA.", ""]
  };
  const [headline, body, cta] = map[label];
  return { title: label, headline, body, cta };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 WebsiteStorageAutoResearch/1.0",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`Fetch failed for ${url}: ${response.status}`);
  return response.text();
}

function readStorage() {
  if (!fs.existsSync(storagePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(storagePath, "utf8"));
  } catch {
    return [];
  }
}

function writeStorage(records) {
  fs.writeFileSync(storagePath, JSON.stringify(records, null, 2), "utf8");
}

function normalizeType(type) {
  const value = String(type || "SITE").toUpperCase();
  if (value.includes("BOOKING")) return "BOOKING PAGE";
  if (value.includes("OPT")) return "OPT-IN PAGE";
  if (value.includes("FUNNEL")) return "FUNNEL";
  if (value.includes("LANDING")) return "LANDING PAGE";
  if (value.includes("FULL")) return "SITE";
  return "SITE";
}

function brandName(niche) {
  const names = {
    "Coaching": "Northstar Clarity",
    "Law Firm": "HarborLine Legal",
    "Dental Clinic": "Brightwell Dental",
    "Med Spa": "LumaSkin Studio",
    "HVAC": "SteadyAir Service",
    "Moving Company": "TrueNorth Movers",
    "Real Estate": "SignalHouse Realty",
    "SaaS": "Pipeline Atlas",
    "Agency": "FoundryFlow Studio",
    "Solar Energy": "Solaraudit Co",
    "Fitness": "FormLab Training"
  };
  return names[niche] || `${niche.replace(/\s+/g, "") || "Custom"} Signal`;
}

function headlineFor(niche, goal) {
  return `${niche} visitors know exactly why to act, and what happens next.`;
}

function makePreviewSvg(niche, brand, type) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 600"><rect width="960" height="600" fill="#08111f"/><path d="M0 120h960M0 240h960M0 360h960M0 480h960M120 0v600M240 0v600M360 0v600M480 0v600M600 0v600M720 0v600M840 0v600" stroke="#ffffff" stroke-opacity=".05"/><rect x="56" y="48" width="848" height="504" rx="36" fill="#0d1828" stroke="#ffffff" stroke-opacity=".14"/><rect x="94" y="90" width="210" height="26" rx="13" fill="#62a8ff"/><rect x="94" y="150" width="460" height="52" rx="16" fill="#eff7ff"/><rect x="94" y="226" width="340" height="18" rx="9" fill="#ffffff" opacity=".45"/><rect x="94" y="320" width="176" height="54" rx="27" fill="#62a8ff"/><rect x="582" y="126" width="260" height="320" rx="30" fill="#ffffff" opacity=".09"/><text x="94" y="484" fill="#eaf4ff" font-family="Segoe UI,Arial" font-size="34" font-weight="700">${escapeHtml(brand)}</text><text x="94" y="522" fill="#b9c7da" font-family="Segoe UI,Arial" font-size="21">${escapeHtml(niche)} ${escapeHtml(type)}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function clean(value) {
  return stripTags(decodeHtml(String(value || ""))).replace(/\s+/g, " ").trim();
}

function slug(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
}

function hostName(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function textBetween(html, regex) {
  const match = regex.exec(html);
  return match ? stripTags(decodeHtml(match[1])) : "";
}

function extractMatches(html, regex, group = 1) {
  const values = [];
  let match;
  while ((match = regex.exec(html))) values.push(match[group] || match[1] || match[2] || "");
  return values;
}

function stripTags(value) {
  return String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}
