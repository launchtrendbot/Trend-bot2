/**
 * TrendPulse Bot — Live Edition v3
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
  return apiCall("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: false, ...extra });
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
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/html, */*",
        "Accept-Language": "en-US,en;q=0.9",
        ...headers
      }
    }, res => {
      // follow redirects
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

// ─── HackerNews (100% reliable, no auth, no blocking) ────────────────────────
async function fetchHackerNews() {
  try {
    const res = await get("https://hacker-news.firebaseio.com/v0/topstories.json");
    if (res.status !== 200) return [];
    const ids = JSON.parse(res.body).slice(0, 15);

    const stories = await Promise.all(
      ids.map(id =>
        get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
          .then(r => JSON.parse(r.body))
          .catch(() => null)
      )
    );

    return stories
      .filter(s => s && s.title && s.score > 50)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(s => ({
        title: s.title,
        url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
        score: s.score,
        comments: s.descendants || 0,
        source: "HackerNews"
      }));
  } catch (e) {
    console.error("HN error:", e.message);
    return [];
  }
}

// ─── Reddit (with browser headers + multiple fallback subs) ──────────────────
async function fetchRedditSub(sub) {
  try {
    // Use old.reddit.com which is less aggressive with blocking
    const res = await get(`https://www.reddit.com/r/${sub}/hot.json?limit=8&raw_json=1`, {
      "Accept": "application/json",
      "Cache-Control": "no-cache"
    });

    if (res.status === 429) { console.log(`Reddit ${sub}: rate limited`); return []; }
    if (res.status !== 200) { console.log(`Reddit ${sub}: status ${res.status}`); return []; }

    const json = JSON.parse(res.body);
    return (json?.data?.children || [])
      .filter(p => !p.data.stickied && p.data.score > 10)
      .map(p => {
        const d = p.data;
        const imgs = d.preview?.images?.[0];
        const resolutions = imgs?.resolutions || [];
        const goodRes = resolutions.filter(r => r.width >= 300).sort((a,b) => a.width - b.width)[0];
        const preview = (goodRes?.url || imgs?.source?.url || "").replace(/&amp;/g, "&");
        const thumb = (d.thumbnail || "").startsWith("http") ? d.thumbnail : "";
        return {
          title: d.title,
          sub: d.subreddit,
          score: d.score,
          comments: d.num_comments || 0,
          image: preview || thumb,
          redditUrl: "https://reddit.com" + d.permalink,
          contentUrl: (d.url && !d.url.includes("reddit.com")) ? d.url : ""
        };
      });
  } catch (e) {
    console.error(`Reddit ${sub} error:`, e.message);
    return [];
  }
}

async function fetchReddit() {
  const subs = ["TikTokTrends", "tiktok", "blowup", "viral", "memes", "aww", "funny"];
  const results = [];
  // Fetch sequentially to avoid rate limiting
  for (const sub of subs) {
    const posts = await fetchRedditSub(sub);
    results.push(...posts);
    if (posts.length > 0) await sleep(300); // small delay between requests
  }
  const seen = new Set();
  return results
    .filter(p => { if (seen.has(p.title)) return false; seen.add(p.title); return true; })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

// ─── Google Trends via RSS2JSON ───────────────────────────────────────────────
async function fetchGoogleTrends() {
  try {
    const rssUrl = encodeURIComponent("https://trends.google.com/trends/trendingsearches/daily/rss?geo=US");
    const res = await get(`https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}&count=8`);
    if (res.status !== 200) return [];
    const json = JSON.parse(res.body);
    if (json.status !== "ok" || !json.items) return [];
    return json.items.map((item, i) => ({
      rank: i + 1,
      title: item.title,
      url: item.link || "",
      description: (item.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 100)
    }));
  } catch (e) {
    console.error("Google Trends error:", e.message);
    return [];
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Format and send digest ───────────────────────────────────────────────────
async function sendDigest(chatId) {
  await send(chatId, "🔄 <b>Fetching live trends...</b>");

  // Fetch all sources in parallel
  const [googleTrends, redditPosts, hnStories] = await Promise.all([
    fetchGoogleTrends(),
    fetchReddit(),
    fetchHackerNews()
  ]);

  const hasGoogle = googleTrends.length > 0;
  const hasReddit = redditPosts.length > 0;
  const hasHN = hnStories.length > 0;

  // ── Google Trends
  if (hasGoogle) {
    let msg = "📈 <b>GOOGLE TRENDS — Trending in the US</b>\n\n";
    googleTrends.forEach((t, i) => {
      msg += `<b>${t.rank}. ${t.title}</b>\n`;
      if (t.description) msg += `<i>${t.description}</i>\n`;
      if (t.url) msg += `🔗 <a href="${t.url}">Read more</a>\n`;
      msg += "\n";
    });
    msg += `<i>Updated: ${new Date().toUTCString()}</i>`;
    await send(chatId, msg);
  } else {
    await send(chatId, "⚠️ Google Trends unavailable right now.");
  }

  await sleep(1000);

  // ── Reddit
  if (hasReddit) {
    await send(chatId, "🎵 <b>TIKTOK & VIRAL — Reddit Hot Posts</b>\n\nSending top posts 👇");
    for (const post of redditPosts) {
      const caption =
        `🔥 <b>${post.title}</b>\n\n` +
        `📊 ${post.score > 999 ? (post.score/1000).toFixed(1)+"K" : post.score} upvotes • r/${post.sub}\n` +
        `💬 ${post.comments} comments\n` +
        `🔗 <a href="${post.redditUrl}">View on Reddit</a>` +
        (post.contentUrl ? `\n🎬 <a href="${post.contentUrl}">View Content</a>` : "");
      if (post.image) {
        try { await sendPhoto(chatId, post.image, caption); }
        catch { await send(chatId, caption); }
      } else {
        await send(chatId, caption);
      }
      await sleep(600);
    }
  } else {
    await send(chatId, "⚠️ Reddit unavailable right now.");
  }

  await sleep(800);

  // ── HackerNews as bonus trending tech
  if (hasHN) {
    let msg = "🔬 <b>TRENDING TECH & NEWS — Hacker News</b>\n\n";
    hnStories.slice(0, 5).forEach((s, i) => {
      msg += `<b>${i+1}. ${s.title}</b>\n`;
      msg += `⬆ ${s.score} points • 💬 ${s.comments} comments\n`;
      msg += `🔗 <a href="${s.url}">${s.source}</a>\n\n`;
    });
    await send(chatId, msg);
  }

  await sleep(500);

  await send(chatId,
    `✅ <b>Trend digest complete!</b>\n\n` +
    `⏰ Next auto-update in <b>1 hour</b>\n` +
    `💡 Use /trends anytime for a fresh update`,
    WEBAPP_URL ? {
      reply_markup: { inline_keyboard: [[{ text: "📱 Open Full Tracker", web_app: { url: WEBAPP_URL } }]] }
    } : {}
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
    ["🔥 Live Trends Now", "📈 Google Trends"],
    ["🎵 TikTok Reddit", "🔬 Tech News"],
    ["⏰ Subscribe Hourly", "🔕 Unsubscribe"],
    ["🔔 My Alerts", "/help"]
  ],
  resize_keyboard: true
};

// ─── Handler ──────────────────────────────────────────────────────────────────
async function handle(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();

  if (text === "/start") {
    subscribers.add(chatId);
    await send(chatId,
      `🚀 <b>Welcome to TrendPulse Live!</b>\n\n` +
      `I send real trending content every hour:\n` +
      `📈 <b>Google Trends</b> — top US searches\n` +
      `🎵 <b>Reddit TikTok</b> — viral posts with images\n` +
      `🔬 <b>Hacker News</b> — trending tech & news\n\n` +
      `✅ You're now <b>subscribed to hourly updates</b>\n\n` +
      `Tap <b>🔥 Live Trends Now</b> for an instant digest!`,
      { reply_markup: mainKeyboard }
    );
    return;
  }

  if (text === "/help") {
    await send(chatId,
      `<b>Commands:</b>\n\n` +
      `/trends — Full live trend digest\n` +
      `/google — Google Trends only\n` +
      `/reddit — Reddit TikTok only\n` +
      `/technews — Hacker News top stories\n` +
      `/subscribe — Hourly auto-updates on\n` +
      `/unsubscribe — Hourly auto-updates off\n` +
      `/alert [word] — Alert when word trends\n` +
      `/myalerts — Your active alerts\n` +
      `/removealert [word] — Remove an alert\n` +
      `/app — Open full tracker`,
      { reply_markup: mainKeyboard }
    );
    return;
  }

  if (text === "/trends" || text === "🔥 Live Trends Now") {
    await sendDigest(chatId);
    return;
  }

  if (text === "/google" || text === "📈 Google Trends") {
    await send(chatId, "⏳ Fetching Google Trends...");
    const trends = await fetchGoogleTrends();
    if (!trends.length) { await send(chatId, "⚠️ Google Trends unavailable, try again shortly."); return; }
    let msg = "📈 <b>GOOGLE TRENDS — US Right Now</b>\n\n";
    trends.forEach(t => {
      msg += `<b>${t.rank}. ${t.title}</b>\n`;
      if (t.description) msg += `<i>${t.description}</i>\n`;
      if (t.url) msg += `🔗 <a href="${t.url}">Read more</a>\n`;
      msg += "\n";
    });
    await send(chatId, msg);
    return;
  }

  if (text === "/reddit" || text === "🎵 TikTok Reddit") {
    await send(chatId, "⏳ Fetching Reddit trends...");
    const posts = await fetchReddit();
    if (!posts.length) { await send(chatId, "⚠️ Reddit unavailable, try again shortly."); return; }
    for (const post of posts) {
      const caption =
        `🔥 <b>${post.title}</b>\n\n` +
        `📊 ${post.score > 999 ? (post.score/1000).toFixed(1)+"K" : post.score} upvotes • r/${post.sub}\n` +
        `🔗 <a href="${post.redditUrl}">View on Reddit</a>` +
        (post.contentUrl ? `\n🎬 <a href="${post.contentUrl}">View Content</a>` : "");
      if (post.image) {
        try { await sendPhoto(chatId, post.image, caption); }
        catch { await send(chatId, caption); }
      } else {
        await send(chatId, caption);
      }
      await sleep(600);
    }
    return;
  }

  if (text === "/technews" || text === "🔬 Tech News") {
    await send(chatId, "⏳ Fetching Hacker News...");
    const stories = await fetchHackerNews();
    if (!stories.length) { await send(chatId, "⚠️ Hacker News unavailable, try again shortly."); return; }
    let msg = "🔬 <b>TRENDING TECH — Hacker News</b>\n\n";
    stories.forEach((s, i) => {
      msg += `<b>${i+1}. ${s.title}</b>\n⬆ ${s.score} • 💬 ${s.comments} • <a href="${s.url}">Read</a>\n\n`;
    });
    await send(chatId, msg);
    return;
  }

  if (text === "/subscribe" || text === "⏰ Subscribe Hourly") {
    subscribers.add(chatId);
    await send(chatId, "✅ <b>Subscribed!</b> Hourly trend digests are on.\n\nUse /unsubscribe to stop.");
    return;
  }

  if (text === "/unsubscribe" || text === "🔕 Unsubscribe") {
    subscribers.delete(chatId);
    await send(chatId, "🔕 <b>Unsubscribed.</b> No more hourly updates.\n\nUse /subscribe to turn back on.");
    return;
  }

  if (text === "/app") {
    await send(chatId, "📱 Open TrendPulse:",
      WEBAPP_URL ? { reply_markup: { inline_keyboard: [[{ text: "📱 Open TrendPulse", web_app: { url: WEBAPP_URL } }]] } } : {}
    );
    return;
  }

  if (text.startsWith("/alert ")) {
    const kw = text.replace("/alert", "").trim().toLowerCase();
    if (!kw) { await send(chatId, "Usage: <code>/alert cat</code>"); return; }
    getAlerts(chatId).add(kw);
    await send(chatId, `🔔 Alert set for <b>"${kw}"</b>!\n\nActive: ${[...getAlerts(chatId)].map(a => `<code>${a}</code>`).join(", ")}`);
    return;
  }

  if (text === "/myalerts" || text === "🔔 My Alerts") {
    const alerts = getAlerts(chatId);
    if (!alerts.size) { await send(chatId, "No alerts set.\n\nUse <code>/alert [keyword]</code> to add one."); return; }
    await send(chatId, `🔔 <b>Your Alerts:</b>\n\n${[...alerts].map((a,i)=>`${i+1}. <code>${a}</code>`).join("\n")}\n\nRemove: <code>/removealert [keyword]</code>`);
    return;
  }

  if (text.startsWith("/removealert ")) {
    const kw = text.replace("/removealert", "").trim().toLowerCase();
    if (getAlerts(chatId).has(kw)) { getAlerts(chatId).delete(kw); await send(chatId, `✅ Removed alert for <b>"${kw}"</b>.`); }
    else { await send(chatId, `⚠️ No alert for <b>"${kw}"</b>.`); }
    return;
  }

  await send(chatId, "Use /help to see all commands.", { reply_markup: mainKeyboard });
}

// ─── Keyword alerts checker ───────────────────────────────────────────────────
async function checkAlerts(redditPosts, hnStories) {
  for (const [chatId, keywords] of Object.entries(userAlerts)) {
    if (!keywords.size) continue;
    for (const kw of keywords) {
      const rMatch = redditPosts.find(p => p.title.toLowerCase().includes(kw));
      if (rMatch) {
        const caption = `🔔 <b>ALERT: "${kw}" is trending!</b>\n\n<b>${rMatch.title}</b>\n📊 ${rMatch.score} upvotes • r/${rMatch.sub}\n🔗 <a href="${rMatch.redditUrl}">View Post</a>`;
        if (rMatch.image) {
          await sendPhoto(chatId, rMatch.image, caption).catch(() => send(chatId, caption).catch(() => {}));
        } else {
          await send(chatId, caption).catch(() => {});
        }
      }
      const hMatch = hnStories.find(s => s.title.toLowerCase().includes(kw));
      if (hMatch) {
        await send(chatId, `🔔 <b>ALERT: "${kw}" on Hacker News!</b>\n\n<b>${hMatch.title}</b>\n⬆ ${hMatch.score} points\n🔗 <a href="${hMatch.url}">Read</a>`).catch(() => {});
      }
    }
  }
}

// ─── Hourly broadcast ─────────────────────────────────────────────────────────
async function broadcast() {
  if (!subscribers.size) return;
  console.log(`📡 Broadcasting to ${subscribers.size} subscriber(s)...`);
  const [redditPosts, hnStories] = await Promise.all([fetchReddit(), fetchHackerNews()]);
  for (const chatId of [...subscribers]) {
    try { await sendDigest(chatId); await sleep(1500); }
    catch (e) { console.error("Broadcast error:", e.message); subscribers.delete(chatId); }
  }
  await checkAlerts(redditPosts, hnStories);
}

// ─── Polling ──────────────────────────────────────────────────────────────────
let offset = 0;
async function poll() {
  try {
    const res = await apiCall("getUpdates", { offset, timeout: 30, allowed_updates: ["message"] });
    if (res.ok && res.result.length > 0) {
      for (const u of res.result) {
        offset = u.update_id + 1;
        if (u.message) { try { await handle(u.message); } catch (e) { console.error("Handle error:", e.message); } }
      }
    }
  } catch (e) {
    console.error("Poll error:", e.message);
    await sleep(5000);
  }
  setImmediate(poll);
}

// ─── Keep-alive ───────────────────────────────────────────────────────────────
http.createServer((req, res) => { res.writeHead(200); res.end("TrendPulse v3 ✅"); }).listen(process.env.PORT || 3000);

// ─── Start ────────────────────────────────────────────────────────────────────
console.log("🚀 TrendPulse v3 starting...");
apiCall("deleteWebhook", {}).then(() => {
  console.log("✅ Polling started");
  poll();
  setInterval(broadcast, 60 * 60 * 1000);
  setTimeout(broadcast, 8000);
}).catch(console.error);
