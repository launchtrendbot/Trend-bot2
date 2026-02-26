/**
 * TrendPulse Bot — Live Edition
 * ─────────────────────────────────────────
 * Combines Google Trends + Reddit for real hourly trend alerts
 * Set these in Railway Variables:
 *   TOKEN      = your Telegram bot token
 *   WEBAPP_URL = your Netlify Mini App URL
 */

const https = require("https");
const http = require("http");

const TOKEN = process.env.TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || "";

// ─── Telegram API ─────────────────────────────────────────────────────────────
function apiCall(method, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${TOKEN}/${method}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function sendMessage(chatId, text, extra = {}) {
  return apiCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: false,
    ...extra
  });
}

function sendPhoto(chatId, photoUrl, caption, extra = {}) {
  return apiCall("sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption,
    parse_mode: "HTML",
    ...extra
  });
}

// ─── HTTP GET helper ──────────────────────────────────────────────────────────
function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const options = { headers: { "User-Agent": "TrendPulseBot/1.0 (Telegram Bot)", ...headers } };
    mod.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, headers).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

// ─── Google Trends RSS ────────────────────────────────────────────────────────
async function fetchGoogleTrends() {
  try {
    const url = "https://trends.google.com/trends/trendingsearches/daily/rss?geo=US";
    const res = await fetchUrl(url);
    if (res.status !== 200) return [];
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(res.body)) !== null) {
      const block = match[1];
      const titleMatch = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || block.match(/<title>(.*?)<\/title>/);
      const trafficMatch = block.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/);
      const newsMatch = block.match(/<ht:news_item_title><!\[CDATA\[(.*?)\]\]><\/ht:news_item_title>/);
      const newsUrlMatch = block.match(/<ht:news_item_url><!\[CDATA\[(.*?)\]\]><\/ht:news_item_url>/);
      const pictureMatch = block.match(/<ht:picture>(.*?)<\/ht:picture>/);
      if (titleMatch) {
        items.push({
          title: titleMatch[1].trim(),
          traffic: trafficMatch ? trafficMatch[1].trim() : "N/A",
          newsTitle: newsMatch ? newsMatch[1].trim() : null,
          newsUrl: newsUrlMatch ? newsUrlMatch[1].trim() : null,
          picture: pictureMatch ? pictureMatch[1].trim() : null
        });
      }
    }
    return items.slice(0, 5);
  } catch (e) {
    console.error("Google Trends error:", e.message);
    return [];
  }
}

// ─── Reddit fetcher ───────────────────────────────────────────────────────────
async function fetchReddit(subreddit, limit = 3) {
  try {
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`;
    const res = await fetchUrl(url, { "Accept": "application/json" });
    if (res.status !== 200) return [];
    const json = JSON.parse(res.body);
    return (json?.data?.children || [])
      .filter(p => !p.data.stickied)
      .map(p => ({
        title: p.data.title,
        url: `https://reddit.com${p.data.permalink}`,
        score: p.data.score,
        preview: p.data.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, "&") || null,
        thumbnail: (p.data.thumbnail?.startsWith("http")) ? p.data.thumbnail : null,
        externalUrl: p.data.url || null,
        subreddit: p.data.subreddit
      }));
  } catch (e) {
    console.error(`Reddit error (${subreddit}):`, e.message);
    return [];
  }
}

async function fetchTikTokRedditTrends() {
  const all = [];
  for (const sub of ["TikTokTrends", "tiktok", "blowup", "viral"]) {
    const posts = await fetchReddit(sub, 3);
    all.push(...posts);
  }
  const seen = new Set();
  return all
    .filter(p => { if (seen.has(p.title)) return false; seen.add(p.title); return true; })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

// ─── Send full digest ─────────────────────────────────────────────────────────
async function sendTrendDigest(chatId) {
  await sendMessage(chatId, "🔄 <b>Fetching live trends...</b>");

  // Google Trends
  const googleTrends = await fetchGoogleTrends();
  if (googleTrends.length > 0) {
    let msg = "📈 <b>GOOGLE TRENDS — Trending in the US</b>\n\n";
    googleTrends.forEach((t, i) => {
      msg += `<b>${i + 1}. ${t.title}</b>\n🔍 ${t.traffic} searches\n`;
      if (t.newsTitle && t.newsUrl) msg += `📰 <a href="${t.newsUrl}">${t.newsTitle}</a>\n`;
      msg += "\n";
    });
    msg += `<i>Updated: ${new Date().toUTCString()}</i>`;
    const withPic = googleTrends.find(t => t.picture);
    if (withPic?.picture) {
      try { await sendPhoto(chatId, withPic.picture, msg); }
      catch { await sendMessage(chatId, msg); }
    } else {
      await sendMessage(chatId, msg);
    }
  } else {
    await sendMessage(chatId, "⚠️ Google Trends unavailable right now.");
  }

  await new Promise(r => setTimeout(r, 1500));

  // Reddit
  const redditPosts = await fetchTikTokRedditTrends();
  if (redditPosts.length > 0) {
    await sendMessage(chatId, "🎵 <b>TIKTOK TRENDS — Hot on Reddit</b>\n\nSending top posts with links 👇");
    for (const post of redditPosts) {
      const caption =
        `🔥 <b>${post.title}</b>\n\n` +
        `📊 ${post.score.toLocaleString()} upvotes • r/${post.subreddit}\n` +
        `🔗 <a href="${post.url}">View on Reddit</a>` +
        (post.externalUrl && post.externalUrl !== post.url ? `\n🎬 <a href="${post.externalUrl}">View Content</a>` : "");
      const img = post.preview || post.thumbnail;
      if (img) {
        try { await sendPhoto(chatId, img, caption); }
        catch { await sendMessage(chatId, caption); }
      } else {
        await sendMessage(chatId, caption);
      }
      await new Promise(r => setTimeout(r, 800));
    }
  } else {
    await sendMessage(chatId, "⚠️ Reddit trends unavailable right now.");
  }

  await sendMessage(chatId,
    `✅ <b>Done!</b> Next auto-update in <b>1 hour</b>\n💡 Tap <b>🔥 Live Trends Now</b> anytime for a fresh update`,
    WEBAPP_URL ? { reply_markup: { inline_keyboard: [[{ text: "📱 Open Full Tracker", web_app: { url: WEBAPP_URL } }]] } } : {}
  );
}

// ─── State ────────────────────────────────────────────────────────────────────
const subscribers = new Set();
const userAlerts = {};
function getAlerts(chatId) {
  if (!userAlerts[chatId]) userAlerts[chatId] = new Set();
  return userAlerts[chatId];
}

const mainKeyboard = {
  keyboard: [
    ["🔥 Live Trends Now", "📈 Google Trends"],
    ["🎵 TikTok Reddit", "🔔 My Alerts"],
    ["⏰ Subscribe Hourly", "🔕 Unsubscribe"],
    ["📱 Open Full Tracker", "/help"]
  ],
  resize_keyboard: true
};

// ─── Message handler ──────────────────────────────────────────────────────────
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();

  if (text === "/start") {
    subscribers.add(chatId);
    await sendMessage(chatId,
      `🚀 <b>Welcome to TrendPulse Live!</b>\n\n` +
      `I send you real trending content every hour:\n` +
      `📈 <b>Google Trends</b> — what the world is searching\n` +
      `🎵 <b>Reddit TikTok</b> — viral videos & images with links\n\n` +
      `You're now <b>subscribed to hourly updates</b> ✅\n\n` +
      `Tap <b>🔥 Live Trends Now</b> for an instant digest!`,
      { reply_markup: mainKeyboard }
    );
    return;
  }

  if (text === "/help") {
    await sendMessage(chatId,
      `<b>Commands:</b>\n\n` +
      `/trends — Fresh trend digest now\n` +
      `/google — Google Trends only\n` +
      `/reddit — Reddit TikTok only\n` +
      `/subscribe — Hourly auto-updates on\n` +
      `/unsubscribe — Hourly auto-updates off\n` +
      `/alert cat — Alert when "cat" trends\n` +
      `/myalerts — Your active alerts\n` +
      `/removealert cat — Remove alert\n` +
      `/app — Open full tracker`,
      { reply_markup: mainKeyboard }
    );
    return;
  }

  if (text === "/trends" || text === "🔥 Live Trends Now") {
    await sendTrendDigest(chatId);
    return;
  }

  if (text === "/google" || text === "📈 Google Trends") {
    await sendMessage(chatId, "⏳ Fetching Google Trends...");
    const trends = await fetchGoogleTrends();
    if (!trends.length) { await sendMessage(chatId, "⚠️ Unavailable right now, try again shortly."); return; }
    let msg = "📈 <b>GOOGLE TRENDS — US Right Now</b>\n\n";
    trends.forEach((t, i) => {
      msg += `<b>${i + 1}. ${t.title}</b> — 🔍 ${t.traffic}\n`;
      if (t.newsTitle && t.newsUrl) msg += `   📰 <a href="${t.newsUrl}">${t.newsTitle}</a>\n`;
      msg += "\n";
    });
    const pic = trends.find(t => t.picture);
    if (pic?.picture) { try { await sendPhoto(chatId, pic.picture, msg); return; } catch {} }
    await sendMessage(chatId, msg);
    return;
  }

  if (text === "/reddit" || text === "🎵 TikTok Reddit") {
    await sendMessage(chatId, "⏳ Fetching Reddit TikTok trends...");
    const posts = await fetchTikTokRedditTrends();
    if (!posts.length) { await sendMessage(chatId, "⚠️ Unavailable right now, try again shortly."); return; }
    for (const post of posts) {
      const caption =
        `🔥 <b>${post.title}</b>\n\n` +
        `📊 ${post.score.toLocaleString()} upvotes • r/${post.subreddit}\n` +
        `🔗 <a href="${post.url}">View on Reddit</a>` +
        (post.externalUrl && post.externalUrl !== post.url ? `\n🎬 <a href="${post.externalUrl}">View Content</a>` : "");
      const img = post.preview || post.thumbnail;
      if (img) { try { await sendPhoto(chatId, img, caption); } catch { await sendMessage(chatId, caption); } }
      else { await sendMessage(chatId, caption); }
      await new Promise(r => setTimeout(r, 800));
    }
    return;
  }

  if (text === "/subscribe" || text === "⏰ Subscribe Hourly") {
    subscribers.add(chatId);
    await sendMessage(chatId, "✅ <b>Subscribed!</b> You'll get a trend digest every hour.\n\nUse /unsubscribe to stop.");
    return;
  }

  if (text === "/unsubscribe" || text === "🔕 Unsubscribe") {
    subscribers.delete(chatId);
    await sendMessage(chatId, "🔕 <b>Unsubscribed.</b> No more hourly updates.\n\nUse /subscribe to turn back on.");
    return;
  }

  if (text === "/app" || text === "📱 Open Full Tracker") {
    await sendMessage(chatId, "📱 Open TrendPulse:",
      WEBAPP_URL ? { reply_markup: { inline_keyboard: [[{ text: "📱 Open TrendPulse", web_app: { url: WEBAPP_URL } }]] } } : {}
    );
    return;
  }

  if (text.startsWith("/alert ")) {
    const kw = text.replace("/alert", "").trim().toLowerCase();
    if (!kw) { await sendMessage(chatId, "Usage: <code>/alert cat</code>"); return; }
    getAlerts(chatId).add(kw);
    await sendMessage(chatId, `🔔 Alert set for <b>"${kw}"</b>!\n\nActive: ${[...getAlerts(chatId)].map(a => `<code>${a}</code>`).join(", ")}`);
    return;
  }

  if (text === "/myalerts" || text === "🔔 My Alerts") {
    const alerts = getAlerts(chatId);
    if (!alerts.size) { await sendMessage(chatId, "No alerts. Use <code>/alert [keyword]</code>"); return; }
    await sendMessage(chatId, `🔔 <b>Alerts:</b>\n\n${[...alerts].map((a,i) => `${i+1}. <code>${a}</code>`).join("\n")}\n\nRemove: <code>/removealert [keyword]</code>`);
    return;
  }

  if (text.startsWith("/removealert ")) {
    const kw = text.replace("/removealert", "").trim().toLowerCase();
    if (getAlerts(chatId).has(kw)) { getAlerts(chatId).delete(kw); await sendMessage(chatId, `✅ Removed alert for <b>"${kw}"</b>`); }
    else { await sendMessage(chatId, `⚠️ No alert for <b>"${kw}"</b>`); }
    return;
  }

  await sendMessage(chatId, "❓ Use the menu or /help", { reply_markup: mainKeyboard });
}

// ─── Keyword alert checker ────────────────────────────────────────────────────
async function checkKeywordAlerts(googleTrends, redditPosts) {
  for (const [chatId, keywords] of Object.entries(userAlerts)) {
    if (!keywords.size) continue;
    for (const kw of keywords) {
      const gMatch = googleTrends.find(t => t.title.toLowerCase().includes(kw));
      if (gMatch) {
        await sendMessage(chatId,
          `🔔 <b>ALERT: "${kw}" is trending on Google!</b>\n\n` +
          `<b>${gMatch.title}</b> — ${gMatch.traffic} searches\n` +
          (gMatch.newsUrl ? `📰 <a href="${gMatch.newsUrl}">${gMatch.newsTitle}</a>` : "")
        ).catch(() => {});
      }
      const rMatch = redditPosts.find(p => p.title.toLowerCase().includes(kw));
      if (rMatch) {
        const caption = `🔔 <b>ALERT: "${kw}" trending on Reddit!</b>\n\n<b>${rMatch.title}</b>\n📊 ${rMatch.score.toLocaleString()} upvotes\n🔗 <a href="${rMatch.url}">View Post</a>`;
        if (rMatch.preview) { await sendPhoto(chatId, rMatch.preview, caption).catch(async () => sendMessage(chatId, caption).catch(() => {})); }
        else { await sendMessage(chatId, caption).catch(() => {}); }
      }
    }
  }
}

// ─── Hourly broadcast ─────────────────────────────────────────────────────────
async function hourlyBroadcast() {
  if (!subscribers.size) return;
  console.log(`📡 Broadcasting to ${subscribers.size} subscriber(s)...`);
  const googleTrends = await fetchGoogleTrends();
  const redditPosts = await fetchTikTokRedditTrends();
  for (const chatId of [...subscribers]) {
    try {
      await sendTrendDigest(chatId);
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.error(`Broadcast error ${chatId}:`, e.message);
      subscribers.delete(chatId);
    }
  }
  await checkKeywordAlerts(googleTrends, redditPosts);
}

// ─── Polling ──────────────────────────────────────────────────────────────────
let offset = 0;
async function poll() {
  try {
    const res = await apiCall("getUpdates", { offset, timeout: 30, allowed_updates: ["message"] });
    if (res.ok && res.result.length > 0) {
      for (const update of res.result) {
        offset = update.update_id + 1;
        if (update.message) {
          try { await handleMessage(update.message); }
          catch (e) { console.error("Handler error:", e.message); }
        }
      }
    }
  } catch (e) {
    console.error("Poll error:", e.message);
    await new Promise(r => setTimeout(r, 5000));
  }
  setImmediate(poll);
}

// ─── Keep-alive ───────────────────────────────────────────────────────────────
http.createServer((req, res) => { res.writeHead(200); res.end("TrendPulse Live ✅"); }).listen(process.env.PORT || 3000);

// ─── Start ────────────────────────────────────────────────────────────────────
console.log("🚀 TrendPulse Live Bot starting...");
apiCall("deleteWebhook", {}).then(() => {
  console.log("✅ Ready — polling started");
  poll();
  setInterval(hourlyBroadcast, 60 * 60 * 1000);
  setTimeout(hourlyBroadcast, 5000);
  console.log("⏰ Hourly broadcast scheduled");
}).catch(console.error);
