/**
 * TrendPulse Bot — Solana Edition
 * Sources: TikTok Creative Center + Google Trends + Reddit Memes + DEX Screener
 * TOKEN and WEBAPP_URL must be set in Railway Variables
 */

const https = require("https");
const http = require("http");

const TOKEN = process.env.TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || "";

// ─── Telegram ─────────────────────────────────────────────────────────────────
function apiCall(method, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${TOKEN}/${method}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy());
    req.write(body);
    req.end();
  });
}

function send(chatId, text, extra = {}) {
  return apiCall("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
}
function sendPhoto(chatId, photo, caption, extra = {}) {
  return apiCall("sendPhoto", { chat_id: chatId, photo, caption, parse_mode: "HTML", ...extra });
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "application/json, text/html, */*",
        "Accept-Language": "en-US,en;q=0.9",
        ...headers
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location, headers).then(resolve).catch(reject);
      }
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    req.setTimeout(12000, () => req.destroy(new Error("timeout")));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── TikTok Creative Center (public endpoint, no API key) ────────────────────
async function fetchTikTokTrending() {
  try {
    // TikTok Creative Center trending hashtags — public, no auth
    const res = await get(
      "https://ads.tiktok.com/creative_radar_api/v1/popular_trend/hashtag/list?period=7&page=1&limit=20&country_code=US",
      {
        "Referer": "https://ads.tiktok.com/business/creativecenter/trends/hashtag/pc/en",
        "Origin": "https://ads.tiktok.com"
      }
    );

    if (res.status !== 200) {
      console.log("TikTok CC status:", res.status);
      return [];
    }

    const json = JSON.parse(res.body);
    const items = json?.data?.list || json?.data?.hashtag_list || [];

    return items.slice(0, 10).map(item => ({
      tag: item.hashtag_name || item.name || item.title || "",
      posts: item.publish_cnt || item.video_count || 0,
      views: item.vv || item.view_count || 0,
      trend: item.trend || "rising"
    })).filter(i => i.tag);
  } catch (e) {
    console.error("TikTok CC error:", e.message);
    return [];
  }
}

// Fallback: TikTok trending via Reddit r/TikTokTrends
async function fetchTikTokReddit() {
  try {
    const res = await get("https://www.reddit.com/r/TikTokTrends/hot.json?limit=10&raw_json=1");
    if (res.status !== 200) return [];
    const json = JSON.parse(res.body);
    return (json?.data?.children || [])
      .filter(p => !p.data.stickied)
      .slice(0, 8)
      .map(p => ({
        title: p.data.title,
        score: p.data.score,
        url: "https://reddit.com" + p.data.permalink,
        image: p.data.preview?.images?.[0]?.resolutions?.slice(-1)[0]?.url?.replace(/&amp;/g,"&") || 
               (p.data.thumbnail?.startsWith("http") ? p.data.thumbnail : null)
      }));
  } catch (e) {
    console.error("TikTok Reddit error:", e.message);
    return [];
  }
}

// ─── Google Trends ────────────────────────────────────────────────────────────
async function fetchGoogleTrends() {
  try {
    const rssUrl = encodeURIComponent("https://trends.google.com/trends/trendingsearches/daily/rss?geo=US");
    const res = await get(`https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}&count=10`);
    if (res.status !== 200) return [];
    const json = JSON.parse(res.body);
    if (json.status !== "ok" || !json.items) return [];
    return json.items.map((item, i) => ({
      rank: i + 1,
      title: item.title,
      url: item.link || "",
      desc: (item.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)
    }));
  } catch (e) {
    console.error("Google Trends error:", e.message);
    return [];
  }
}

// ─── Reddit Memes ─────────────────────────────────────────────────────────────
async function fetchMemes() {
  try {
    const subs = ["memes", "dankmemes", "funny", "me_irl"];
    const all = [];
    for (const sub of subs) {
      try {
        const res = await get(`https://www.reddit.com/r/${sub}/hot.json?limit=6&raw_json=1`);
        if (res.status !== 200) continue;
        const json = JSON.parse(res.body);
        const posts = (json?.data?.children || [])
          .filter(p => !p.data.stickied && p.data.score > 100)
          .map(p => ({
            title: p.data.title,
            score: p.data.score,
            sub: p.data.subreddit,
            url: "https://reddit.com" + p.data.permalink,
            image: p.data.preview?.images?.[0]?.resolutions?.slice(-1)[0]?.url?.replace(/&amp;/g,"&") ||
                   (p.data.thumbnail?.startsWith("http") ? p.data.thumbnail : null)
          }));
        all.push(...posts);
        await sleep(300);
      } catch(e) { continue; }
    }
    const seen = new Set();
    return all
      .filter(p => { if(seen.has(p.title)) return false; seen.add(p.title); return true; })
      .sort((a,b) => b.score - a.score)
      .slice(0, 8);
  } catch(e) {
    console.error("Memes error:", e.message);
    return [];
  }
}

// ─── DEX Screener — Top Solana Token Launches ─────────────────────────────────
async function fetchSolanaTokens() {
  try {
    // Get latest boosted/trending tokens on Solana
    const [boostRes, profileRes] = await Promise.all([
      get("https://api.dexscreener.com/token-boosts/top/v1"),
      get("https://api.dexscreener.com/token-profiles/latest/v1")
    ]);

    const tokens = [];

    // Parse boosted tokens
    if (boostRes.status === 200) {
      try {
        const boosted = JSON.parse(boostRes.body);
        const solana = (Array.isArray(boosted) ? boosted : boosted.data || [])
          .filter(t => t.chainId === "solana")
          .slice(0, 8);
        solana.forEach(t => {
          tokens.push({
            name: t.description || t.tokenAddress?.slice(0,8) || "Unknown",
            address: t.tokenAddress || "",
            url: t.url || `https://dexscreener.com/solana/${t.tokenAddress}`,
            totalAmount: t.totalAmount || 0,
            icon: t.icon || null,
            type: "boosted"
          });
        });
      } catch(e) { console.log("Boost parse error:", e.message); }
    }

    // Parse new token profiles
    if (profileRes.status === 200) {
      try {
        const profiles = JSON.parse(profileRes.body);
        const solProfiles = (Array.isArray(profiles) ? profiles : profiles.data || [])
          .filter(t => t.chainId === "solana")
          .slice(0, 6);
        solProfiles.forEach(t => {
          tokens.push({
            name: t.description || t.tokenAddress?.slice(0,8) || "New Token",
            address: t.tokenAddress || "",
            url: t.url || `https://dexscreener.com/solana/${t.tokenAddress}`,
            icon: t.icon || null,
            type: "new"
          });
        });
      } catch(e) { console.log("Profile parse error:", e.message); }
    }

    // Deduplicate
    const seen = new Set();
    return tokens.filter(t => {
      if (seen.has(t.address)) return false;
      seen.add(t.address);
      return true;
    }).slice(0, 10);

  } catch(e) {
    console.error("DEX Screener error:", e.message);
    return [];
  }
}

// ─── Score meme/trend for token potential ─────────────────────────────────────
function scoreForToken(title, score) {
  let pts = 0;
  const t = title.toLowerCase();

  // Short = good for tickers
  if (title.split(" ").length <= 3) pts += 3;
  if (title.split(" ").length === 1) pts += 2;

  // Animal = historically strong
  if (t.match(/\b(cat|dog|frog|pepe|doge|shib|bear|bull|ape|monkey|fish|shark|whale|bird|fox)\b/)) pts += 4;

  // Meme culture keywords
  if (t.match(/\b(gm|wagmi|ngmi|moon|pump|based|chad|gigachad|wojak|boomer|zoomer|sigma|alpha)\b/)) pts += 3;

  // Pop culture
  if (t.match(/\b(trump|elon|musk|ai|gpt|robot|cyber|turbo|mega|ultra|super|hyper)\b/)) pts += 2;

  // Engagement score
  if (score > 50000) pts += 3;
  else if (score > 10000) pts += 2;
  else if (score > 1000) pts += 1;

  // Negative signals
  if (title.length > 60) pts -= 2;
  if (t.includes("?") || t.includes("why") || t.includes("when")) pts -= 1;

  return Math.min(10, Math.max(0, pts));
}

function tokenEmoji(score) {
  if (score >= 8) return "🔥🔥";
  if (score >= 6) return "🔥";
  if (score >= 4) return "⚡";
  return "💤";
}

// ─── Compose Solana token ideas digest ───────────────────────────────────────
async function sendSolanaDigest(chatId) {
  await send(chatId, "🔍 <b>Scanning trends for Solana token ideas...</b>\n\nFetching TikTok • Google • Memes • DEX Screener");

  const [tiktokTrends, tiktokReddit, googleTrends, memes, solTokens] = await Promise.all([
    fetchTikTokTrending(),
    fetchTikTokReddit(),
    fetchGoogleTrends(),
    fetchMemes(),
    fetchSolanaTokens()
  ]);

  // ── Section 1: TikTok Trending Hashtags
  if (tiktokTrends.length > 0) {
    let msg = "🎵 <b>TIKTOK TRENDING HASHTAGS</b> — Token Ideas\n\n";
    tiktokTrends.forEach((t, i) => {
      const ticker = t.tag.replace(/[^a-zA-Z0-9]/g,"").toUpperCase().slice(0,8);
      const views = t.views > 1e9 ? (t.views/1e9).toFixed(1)+"B" : t.views > 1e6 ? (t.views/1e6).toFixed(1)+"M" : t.views > 1000 ? (t.views/1000).toFixed(0)+"K" : t.views||"—";
      const score = scoreForToken(t.tag, t.views > 1000000 ? 50000 : 1000);
      msg += `${tokenEmoji(score)} <b>#${t.tag}</b> → <code>$${ticker}</code>\n`;
      msg += `👁 ${views} views • Token score: ${score}/10\n\n`;
    });
    await send(chatId, msg);
    await sleep(800);
  } else if (tiktokReddit.length > 0) {
    // Fallback to Reddit TikTok
    let msg = "🎵 <b>TIKTOK VIRAL — Reddit Picks</b> → Token Ideas\n\n";
    tiktokReddit.slice(0, 5).forEach(p => {
      const words = p.title.split(" ").filter(w => w.length > 2);
      const ticker = (words[0]||"TREND").replace(/[^a-zA-Z]/g,"").toUpperCase().slice(0,6);
      const score = scoreForToken(p.title, p.score);
      msg += `${tokenEmoji(score)} <b>${p.title.slice(0,60)}</b>\n`;
      msg += `💡 Ticker idea: <code>$${ticker}</code> • Score: ${score}/10\n`;
      msg += `🔗 <a href="${p.url}">View TikTok post</a>\n\n`;
    });
    await send(chatId, msg);
    await sleep(800);
  }

  // ── Section 2: Google Trends → Token Ideas
  if (googleTrends.length > 0) {
    let msg = "📈 <b>GOOGLE TRENDS</b> → Token Ideas\n\n";
    googleTrends.slice(0, 8).forEach(t => {
      const words = t.title.split(" ").filter(w=>w.length>2);
      const ticker = words.slice(0,2).map(w=>w.replace(/[^a-zA-Z]/g,"").toUpperCase().slice(0,4)).join("").slice(0,8) || "TREND";
      const score = scoreForToken(t.title, 10000);
      msg += `${tokenEmoji(score)} <b>${t.title}</b> → <code>$${ticker}</code>\n`;
      msg += `Score: ${score}/10`;
      if (t.url) msg += ` • <a href="${t.url}">News</a>`;
      msg += "\n\n";
    });
    await send(chatId, msg);
    await sleep(800);
  }

  // ── Section 3: Top Memes → Token Names
  if (memes.length > 0) {
    let msg = "😂 <b>TOP REDDIT MEMES</b> → Token Names\n\n";
    for (const meme of memes.slice(0, 5)) {
      const words = meme.title.split(" ").filter(w=>w.length>2);
      const ticker = (words[0]||"MEME").replace(/[^a-zA-Z]/g,"").toUpperCase().slice(0,6);
      const score = scoreForToken(meme.title, meme.score);
      const caption =
        `${tokenEmoji(score)} <b>${meme.title.slice(0,80)}</b>\n` +
        `💡 <code>$${ticker}</code> • Score: ${score}/10\n` +
        `⬆ ${meme.score > 999 ? (meme.score/1000).toFixed(1)+"K" : meme.score} upvotes • r/${meme.sub}\n` +
        `🔗 <a href="${meme.url}">View meme</a>`;
      if (meme.image) {
        try { await sendPhoto(chatId, meme.image, caption); }
        catch { await send(chatId, caption); }
      } else {
        await send(chatId, caption);
      }
      await sleep(700);
    }
  }

  // ── Section 4: Top Solana Launches (DEX Screener)
  if (solTokens.length > 0) {
    let msg = "🟣 <b>TOP SOLANA LAUNCHES</b> — DEX Screener\n<i>What's currently getting traction:</i>\n\n";
    solTokens.forEach((t, i) => {
      const label = t.type === "boosted" ? "🚀 Boosted" : "🆕 New";
      msg += `${label} <b>${t.name.slice(0,50)}</b>\n`;
      if (t.totalAmount) msg += `💰 Boost: $${t.totalAmount.toLocaleString()}\n`;
      msg += `🔗 <a href="${t.url}">View on DEX Screener</a>\n\n`;
    });
    msg += `<i>Pattern: short names, animal themes, pop culture = best launches</i>`;
    await send(chatId, msg);
    await sleep(500);
  } else {
    await send(chatId, "⚠️ DEX Screener unavailable right now.");
  }

  // ── Summary
  await send(chatId,
    `✅ <b>Scan complete!</b>\n\n` +
    `🏆 <b>What makes a good Solana token:</b>\n` +
    `• 1-2 word name, max 6 char ticker\n` +
    `• Animal, meme, or pop culture theme\n` +
    `• Currently trending on TikTok or Google\n` +
    `• Score 7+ = strong launch potential\n\n` +
    `⏰ Next scan in <b>1 hour</b>\n` +
    `💡 Use /solana anytime for a fresh scan`,
    WEBAPP_URL ? { reply_markup: { inline_keyboard: [[{ text: "📱 Open Tracker", web_app: { url: WEBAPP_URL } }]] } } : {}
  );
}

// ─── Regular trends digest ────────────────────────────────────────────────────
async function sendTrendsDigest(chatId) {
  await send(chatId, "🔄 <b>Fetching live trends...</b>");

  const [googleTrends, tiktokReddit, memes] = await Promise.all([
    fetchGoogleTrends(),
    fetchTikTokReddit(),
    fetchMemes()
  ]);

  if (googleTrends.length > 0) {
    let msg = "📈 <b>GOOGLE TRENDS — US Right Now</b>\n\n";
    googleTrends.forEach(t => {
      msg += `<b>${t.rank}. ${t.title}</b>\n`;
      if (t.desc) msg += `<i>${t.desc}</i>\n`;
      if (t.url) msg += `🔗 <a href="${t.url}">Read</a>\n`;
      msg += "\n";
    });
    await send(chatId, msg);
    await sleep(800);
  }

  if (tiktokReddit.length > 0) {
    await send(chatId, "🎵 <b>TIKTOK VIRAL — Reddit Hot Posts</b>\n\nTop viral content 👇");
    for (const post of tiktokReddit.slice(0, 5)) {
      const caption =
        `🔥 <b>${post.title}</b>\n` +
        `⬆ ${post.score > 999 ? (post.score/1000).toFixed(1)+"K" : post.score} upvotes\n` +
        `🔗 <a href="${post.url}">View Post</a>`;
      if (post.image) {
        try { await sendPhoto(chatId, post.image, caption); }
        catch { await send(chatId, caption); }
      } else {
        await send(chatId, caption);
      }
      await sleep(600);
    }
  }

  if (memes.length > 0) {
    await send(chatId, "😂 <b>TOP MEMES RIGHT NOW</b>\n\nHot from Reddit 👇");
    for (const meme of memes.slice(0, 4)) {
      const caption =
        `😂 <b>${meme.title.slice(0,80)}</b>\n` +
        `⬆ ${meme.score > 999 ? (meme.score/1000).toFixed(1)+"K" : meme.score} • r/${meme.sub}\n` +
        `🔗 <a href="${meme.url}">View</a>`;
      if (meme.image) {
        try { await sendPhoto(chatId, meme.image, caption); }
        catch { await send(chatId, caption); }
      } else {
        await send(chatId, caption);
      }
      await sleep(600);
    }
  }

  await send(chatId,
    `✅ <b>Done!</b> Next auto-update in <b>1 hour</b>\n` +
    `💡 /solana — scan for Solana token ideas`,
    WEBAPP_URL ? { reply_markup: { inline_keyboard: [[{ text: "📱 Open Tracker", web_app: { url: WEBAPP_URL } }]] } } : {}
  );
}

// ─── State ────────────────────────────────────────────────────────────────────
const subscribers = new Set();
const userAlerts = {};
function getAlerts(id) {
  if (!userAlerts[id]) userAlerts[id] = new Set();
  return userAlerts[id];
}

const mainKeyboard = {
  keyboard: [
    ["🔥 Live Trends", "🟣 Solana Ideas"],
    ["🎵 TikTok Viral", "😂 Top Memes"],
    ["📈 Google Trends", "🔬 Tech News"],
    ["⏰ Subscribe", "🔕 Unsubscribe"],
    ["🔔 My Alerts", "/help"]
  ],
  resize_keyboard: true
};

// ─── Handle messages ──────────────────────────────────────────────────────────
async function handle(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();

  if (text === "/start") {
    subscribers.add(chatId);
    await send(chatId,
      `🚀 <b>Welcome to TrendPulse — Solana Edition!</b>\n\n` +
      `I track what's trending and score it for Solana token potential:\n\n` +
      `🎵 <b>TikTok Trending</b> — viral hashtags\n` +
      `📈 <b>Google Trends</b> — top US searches\n` +
      `😂 <b>Reddit Memes</b> — hottest memes with images\n` +
      `🟣 <b>Solana Launches</b> — top new tokens on DEX Screener\n\n` +
      `✅ Subscribed to <b>hourly updates</b>\n\n` +
      `Tap <b>🟣 Solana Ideas</b> to scan right now!`,
      { reply_markup: mainKeyboard }
    );
    return;
  }

  if (text === "/help") {
    await send(chatId,
      `<b>Commands:</b>\n\n` +
      `/trends — Full live trend digest\n` +
      `/solana — Scan for Solana token ideas 🟣\n` +
      `/tiktok — TikTok viral posts\n` +
      `/memes — Top Reddit memes with images\n` +
      `/google — Google Trends only\n` +
      `/technews — Hacker News top stories\n` +
      `/subscribe — Hourly auto-updates on\n` +
      `/unsubscribe — Hourly auto-updates off\n` +
      `/alert [word] — Alert when word trends\n` +
      `/myalerts — Your active alerts\n` +
      `/removealert [word] — Remove alert`,
      { reply_markup: mainKeyboard }
    );
    return;
  }

  if (text === "/trends" || text === "🔥 Live Trends") {
    await sendTrendsDigest(chatId);
    return;
  }

  if (text === "/solana" || text === "🟣 Solana Ideas") {
    await sendSolanaDigest(chatId);
    return;
  }

  if (text === "/tiktok" || text === "🎵 TikTok Viral") {
    await send(chatId, "⏳ Fetching TikTok viral posts...");
    const posts = await fetchTikTokReddit();
    if (!posts.length) { await send(chatId, "⚠️ No TikTok posts right now, try again shortly."); return; }
    for (const post of posts) {
      const caption = `🔥 <b>${post.title}</b>\n⬆ ${post.score > 999 ? (post.score/1000).toFixed(1)+"K" : post.score}\n🔗 <a href="${post.url}">View</a>`;
      if (post.image) { try { await sendPhoto(chatId, post.image, caption); } catch { await send(chatId, caption); } }
      else { await send(chatId, caption); }
      await sleep(600);
    }
    return;
  }

  if (text === "/memes" || text === "😂 Top Memes") {
    await send(chatId, "⏳ Fetching top memes...");
    const memes = await fetchMemes();
    if (!memes.length) { await send(chatId, "⚠️ No memes right now, try again shortly."); return; }
    for (const meme of memes) {
      const caption = `😂 <b>${meme.title.slice(0,80)}</b>\n⬆ ${meme.score > 999 ? (meme.score/1000).toFixed(1)+"K" : meme.score} • r/${meme.sub}\n🔗 <a href="${meme.url}">View</a>`;
      if (meme.image) { try { await sendPhoto(chatId, meme.image, caption); } catch { await send(chatId, caption); } }
      else { await send(chatId, caption); }
      await sleep(600);
    }
    return;
  }

  if (text === "/google" || text === "📈 Google Trends") {
    await send(chatId, "⏳ Fetching Google Trends...");
    const trends = await fetchGoogleTrends();
    if (!trends.length) { await send(chatId, "⚠️ Google Trends unavailable, try again shortly."); return; }
    let msg = "📈 <b>GOOGLE TRENDS — US Right Now</b>\n\n";
    trends.forEach(t => {
      msg += `<b>${t.rank}. ${t.title}</b>\n`;
      if (t.desc) msg += `<i>${t.desc}</i>\n`;
      if (t.url) msg += `🔗 <a href="${t.url}">Read</a>\n`;
      msg += "\n";
    });
    await send(chatId, msg);
    return;
  }

  if (text === "/technews" || text === "🔬 Tech News") {
    await send(chatId, "⏳ Fetching Hacker News...");
    try {
      const res = await get("https://hacker-news.firebaseio.com/v0/topstories.json");
      const ids = JSON.parse(res.body).slice(0, 10);
      const stories = (await Promise.all(
        ids.map(id => get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => JSON.parse(r.body)).catch(()=>null))
      )).filter(s => s && s.title && s.score > 50).sort((a,b)=>b.score-a.score).slice(0,8);
      if (!stories.length) { await send(chatId, "⚠️ Hacker News unavailable right now."); return; }
      let msg = "🔬 <b>TRENDING TECH — Hacker News</b>\n\n";
      stories.forEach((s,i) => { msg += `<b>${i+1}. ${s.title}</b>\n⬆ ${s.score} • 💬 ${s.descendants||0} • <a href="${s.url||`https://news.ycombinator.com/item?id=${s.id}`}">Read</a>\n\n`; });
      await send(chatId, msg);
    } catch(e) { await send(chatId, "⚠️ Hacker News unavailable right now."); }
    return;
  }

  if (text === "/subscribe" || text === "⏰ Subscribe") {
    subscribers.add(chatId);
    await send(chatId, "✅ <b>Subscribed!</b> Hourly trend + Solana scans are on.");
    return;
  }

  if (text === "/unsubscribe" || text === "🔕 Unsubscribe") {
    subscribers.delete(chatId);
    await send(chatId, "🔕 <b>Unsubscribed.</b> Use /subscribe to turn back on.");
    return;
  }

  if (text === "/app") {
    await send(chatId, "📱 Open TrendPulse:",
      WEBAPP_URL ? { reply_markup: { inline_keyboard: [[{ text: "📱 Open TrendPulse", web_app: { url: WEBAPP_URL } }]] } } : {}
    );
    return;
  }

  if (text.startsWith("/alert ")) {
    const kw = text.replace("/alert","").trim().toLowerCase();
    if (!kw) { await send(chatId, "Usage: <code>/alert cat</code>"); return; }
    getAlerts(chatId).add(kw);
    await send(chatId, `🔔 Alert set for <b>"${kw}"</b>!\nActive: ${[...getAlerts(chatId)].map(a=>`<code>${a}</code>`).join(", ")}`);
    return;
  }

  if (text === "/myalerts" || text === "🔔 My Alerts") {
    const alerts = getAlerts(chatId);
    if (!alerts.size) { await send(chatId, "No alerts. Use <code>/alert [keyword]</code>"); return; }
    await send(chatId, `🔔 <b>Alerts:</b>\n\n${[...alerts].map((a,i)=>`${i+1}. <code>${a}</code>`).join("\n")}\n\nRemove: <code>/removealert [word]</code>`);
    return;
  }

  if (text.startsWith("/removealert ")) {
    const kw = text.replace("/removealert","").trim().toLowerCase();
    if (getAlerts(chatId).has(kw)) { getAlerts(chatId).delete(kw); await send(chatId, `✅ Removed alert for <b>"${kw}"</b>.`); }
    else { await send(chatId, `⚠️ No alert for <b>"${kw}"</b>.`); }
    return;
  }

  await send(chatId, "Use /help to see all commands.", { reply_markup: mainKeyboard });
}

// ─── Hourly broadcast ─────────────────────────────────────────────────────────
async function broadcast() {
  if (!subscribers.size) return;
  console.log(`📡 Broadcasting to ${subscribers.size} subscriber(s)...`);
  for (const chatId of [...subscribers]) {
    try {
      await sendTrendsDigest(chatId);
      await sleep(1000);
      await sendSolanaDigest(chatId);
      await sleep(2000);
    } catch(e) {
      console.error("Broadcast error:", e.message);
      subscribers.delete(chatId);
    }
  }
}

// ─── Polling ──────────────────────────────────────────────────────────────────
let offset = 0;
async function poll() {
  try {
    const res = await apiCall("getUpdates", { offset, timeout: 30, allowed_updates: ["message"] });
    if (res.ok && res.result.length > 0) {
      for (const u of res.result) {
        offset = u.update_id + 1;
        if (u.message) { try { await handle(u.message); } catch(e) { console.error("Handle error:", e.message); } }
      }
    }
  } catch(e) {
    console.error("Poll error:", e.message);
    await sleep(5000);
  }
  setImmediate(poll);
}

// ─── Keep-alive ───────────────────────────────────────────────────────────────
http.createServer((req, res) => { res.writeHead(200); res.end("TrendPulse Solana Edition ✅"); }).listen(process.env.PORT || 3000);

// ─── Start ────────────────────────────────────────────────────────────────────
console.log("🚀 TrendPulse Solana Edition starting...");
apiCall("deleteWebhook", {}).then(() => {
  console.log("✅ Polling started");
  poll();
  setInterval(broadcast, 60 * 60 * 1000);
  setTimeout(broadcast, 8000);
}).catch(console.error);
