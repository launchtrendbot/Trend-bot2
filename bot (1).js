/**
 * TrendPulse Telegram Bot
 * ─────────────────────────────────────────
 * Replace YOUR_BOT_TOKEN_HERE with your token from BotFather
 * Replace YOUR_WEBAPP_URL with the URL where you host index.html
 */

const TOKEN = process.env.TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || "YOUR_WEBAPP_URL"; // set this in Railway variables too

const https = require("https");
const http = require("http");

// ─── Trend Data ───────────────────────────────────────────────────────────────
const trends = [
  {
    id: 1, cat: "animals", emoji: "🐱", title: "Cat Yoga Challenge",
    desc: "Cats photobombing their owners doing yoga. Peak chaos energy.",
    heat: 98, views: "847M", likes: "52M", shares: "8.2M",
    tags: ["#catyoga", "#petsoftiktok", "#catlife", "#funnycats"],
    rising: true
  },
  {
    id: 2, cat: "memes", emoji: "😭", title: "This Is Fine Dog",
    desc: "New wave of 'everything is fine' memes with absurdist twists.",
    heat: 94, views: "612M", likes: "38M", shares: "11M",
    tags: ["#thisisfine", "#memegen", "#relateable", "#xyzbca"],
    rising: false
  },
  {
    id: 3, cat: "toys", emoji: "🪄", title: "Magnetic Sand ASMR",
    desc: "Kinetic magnetic sand sculptures going absolutely viral.",
    heat: 91, views: "503M", likes: "29M", shares: "6.7M",
    tags: ["#magneticsand", "#asmr", "#satisfying", "#oddlysatisfying"],
    rising: false
  },
  {
    id: 4, cat: "trends", emoji: "💃", title: "Slow Mo Mirror Dance",
    desc: "Unexpected slow-motion mirror transitions with dramatic music.",
    heat: 99, views: "1.2B", likes: "79M", shares: "14M",
    tags: ["#mirrordance", "#slowmo", "#fyp", "#dancechallenge"],
    rising: true
  },
  {
    id: 5, cat: "animals", emoji: "🐶", title: "Dog Outfit Reviews",
    desc: "Dogs reviewing their own Halloween outfits. The side-eye is everything.",
    heat: 86, views: "389M", likes: "24M", shares: "4.1M",
    tags: ["#dogoutfit", "#dogmom", "#dogsoftiktok", "#petfashion"],
    rising: false
  },
  {
    id: 6, cat: "memes", emoji: "🤌", title: "Italian Hand Gestures",
    desc: "Teaching random words using only Italian hand gestures.",
    heat: 88, views: "445M", likes: "31M", shares: "9.8M",
    tags: ["#italian", "#handgestures", "#language", "#culturetok"],
    rising: true
  },
  {
    id: 7, cat: "toys", emoji: "🎮", title: "Rubik's Speed Solve",
    desc: "Teens solving Rubik's cubes with increasingly dramatic setups.",
    heat: 82, views: "298M", likes: "19M", shares: "3.4M",
    tags: ["#speedcubing", "#rubikscube", "#satisfying", "#skills"],
    rising: false
  },
  {
    id: 8, cat: "trends", emoji: "🌊", title: "Ocean Cleanup POV",
    desc: "Satisfying ocean cleanup videos with before/after reveals.",
    heat: 90, views: "567M", likes: "45M", shares: "12M",
    tags: ["#oceancleanup", "#satisfying", "#earthtok", "#fyp"],
    rising: true
  },
  {
    id: 9, cat: "animals", emoji: "🐦", title: "Parrot Cooking Reviews",
    desc: "Parrots critiquing their owners' cooking with surprisingly accurate commentary.",
    heat: 84, views: "321M", likes: "22M", shares: "5.3M",
    tags: ["#parrot", "#birdtok", "#cooking", "#funnypets"],
    rising: false
  },
  {
    id: 10, cat: "trends", emoji: "🎭", title: "Silent Disco In Public",
    desc: "Spontaneous silent disco flash mobs in shopping malls.",
    heat: 93, views: "678M", likes: "51M", shares: "13M",
    tags: ["#silentdisco", "#flashmob", "#publicprank", "#viral"],
    rising: true
  }
];

// ─── State ────────────────────────────────────────────────────────────────────
// chatId → { alerts: Set<string>, alertsEnabled: boolean }
const userState = {};

function getUser(chatId) {
  if (!userState[chatId]) {
    userState[chatId] = { alerts: new Set(), alertsEnabled: true };
  }
  return userState[chatId];
}

// ─── Telegram API helpers ─────────────────────────────────────────────────────
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
    ...extra
  });
}

// ─── Message formatters ───────────────────────────────────────────────────────
function formatTrend(t) {
  const risingTag = t.rising ? " 📈 <b>RISING</b>" : "";
  return (
    `${t.emoji} <b>${t.title}</b>${risingTag}\n` +
    `📂 Category: <code>${t.cat}</code>\n` +
    `🔥 Heat: <b>${t.heat}/100</b>\n` +
    `👁 Views: <b>${t.views}</b>  ❤️ Likes: <b>${t.likes}</b>  🔁 Shares: <b>${t.shares}</b>\n` +
    `📝 ${t.desc}\n` +
    `🏷 ${t.tags.join("  ")}`
  );
}

function hotTrendsMessage(filter = "all") {
  let list = filter === "all" ? trends : trends.filter(t => t.cat === filter);
  list = [...list].sort((a, b) => b.heat - a.heat).slice(0, 5);

  const header = filter === "all"
    ? "🔥 <b>TOP 5 HOTTEST TRENDS RIGHT NOW</b>\n\n"
    : `🔥 <b>TOP ${filter.toUpperCase()} TRENDS</b>\n\n`;

  return header + list.map((t, i) =>
    `<b>${i + 1}.</b> ${t.emoji} ${t.title} — 🔥 ${t.heat} | 👁 ${t.views}${t.rising ? " 📈" : ""}`
  ).join("\n");
}

function risingMessage() {
  const rising = trends.filter(t => t.rising);
  return (
    "📈 <b>RISING FAST — Watch These Now</b>\n\n" +
    rising.map(t =>
      `${t.emoji} <b>${t.title}</b> [${t.cat}]\n🔥 Heat: ${t.heat} | 👁 ${t.views}\n${t.tags.slice(0,2).join(" ")}`
    ).join("\n\n")
  );
}

function alertsMatchMessage(t) {
  return (
    `🔔 <b>TREND ALERT MATCH!</b>\n\n` +
    formatTrend(t) + "\n\n" +
    `<i>This matched one of your keywords.</i>`
  );
}

// ─── Keyboards ────────────────────────────────────────────────────────────────
const mainKeyboard = {
  keyboard: [
    ["🔥 Hot Trends", "📈 Rising Fast"],
    ["🐾 Animals", "😂 Memes"],
    ["🧸 Toys", "📊 Viral Trends"],
    ["🔔 My Alerts", "📱 Open Full Tracker"]
  ],
  resize_keyboard: true
};

function openAppButton() {
  return {
    inline_keyboard: [[
      {
        text: "📱 Open TrendPulse Tracker",
        web_app: { url: WEBAPP_URL }
      }
    ]]
  };
}

// ─── Command / message handler ────────────────────────────────────────────────
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  const user = getUser(chatId);

  // ── /start
  if (text === "/start" || text === "🏠 Home") {
    await sendMessage(chatId,
      `👋 <b>Welcome to TrendPulse!</b>\n\n` +
      `Your personal TikTok trend tracker for:\n` +
      `🐾 Animals  😂 Memes  🧸 Toys  📊 Viral Trends\n\n` +
      `Use the menu below to explore — or open the full interactive tracker.\n\n` +
      `<b>Commands:</b>\n` +
      `/trends — Top trending now\n` +
      `/rising — Rising fast\n` +
      `/alert [keyword] — Set a keyword alert\n` +
      `/myalerts — See your alerts\n` +
      `/removealert [keyword] — Remove an alert\n` +
      `/help — Show this message`,
      { reply_markup: mainKeyboard }
    );
    return;
  }

  // ── /help
  if (text === "/help") {
    await sendMessage(chatId,
      `<b>TrendPulse Commands</b>\n\n` +
      `/trends — Top 5 hottest trends\n` +
      `/rising — Trends rising fast right now\n` +
      `/animals — Top animal trends\n` +
      `/memes — Top meme trends\n` +
      `/toys — Top toy trends\n` +
      `/viral — Top viral trends\n` +
      `/alert [keyword] — e.g. /alert cat\n` +
      `/myalerts — List your active alerts\n` +
      `/removealert [keyword] — Remove a keyword alert\n` +
      `/app — Open the full tracker`,
      { reply_markup: mainKeyboard }
    );
    return;
  }

  // ── /trends or button
  if (text === "/trends" || text === "🔥 Hot Trends") {
    await sendMessage(chatId, hotTrendsMessage("all"), {
      reply_markup: {
        inline_keyboard: [[{ text: "📱 See Full Dashboard", web_app: { url: WEBAPP_URL } }]]
      }
    });
    return;
  }

  // ── /rising or button
  if (text === "/rising" || text === "📈 Rising Fast") {
    await sendMessage(chatId, risingMessage(), {
      reply_markup: {
        inline_keyboard: [[{ text: "📱 See Full Dashboard", web_app: { url: WEBAPP_URL } }]]
      }
    });
    return;
  }

  // ── Category filters
  const catMap = {
    "/animals": "animals", "🐾 Animals": "animals",
    "/memes": "memes", "😂 Memes": "memes",
    "/toys": "toys", "🧸 Toys": "toys",
    "/viral": "trends", "📊 Viral Trends": "trends"
  };

  if (catMap[text]) {
    const cat = catMap[text];
    const list = [...trends].filter(t => t.cat === cat).sort((a, b) => b.heat - a.heat).slice(0, 3);
    const msgs = list.map(t => formatTrend(t)).join("\n\n─────────────────\n\n");
    await sendMessage(chatId, `📂 <b>TOP ${cat.toUpperCase()} TRENDS</b>\n\n` + msgs, {
      reply_markup: {
        inline_keyboard: [[{ text: "📱 See All in App", web_app: { url: WEBAPP_URL } }]]
      }
    });
    return;
  }

  // ── /app or button
  if (text === "/app" || text === "📱 Open Full Tracker") {
    await sendMessage(chatId,
      "📱 <b>Open TrendPulse</b>\n\nTap below to launch the full interactive tracker with live filters, watchlist, and hashtag charts.",
      { reply_markup: openAppButton() }
    );
    return;
  }

  // ── /alert [keyword]
  if (text.startsWith("/alert ") || text.startsWith("/alert\n")) {
    const keyword = text.replace("/alert", "").trim().toLowerCase();
    if (!keyword) {
      await sendMessage(chatId, "⚠️ Usage: <code>/alert [keyword]</code>\nExample: <code>/alert cat</code>");
      return;
    }
    user.alerts.add(keyword);
    await sendMessage(chatId,
      `🔔 Alert set for <b>"${keyword}"</b>!\n\nI'll notify you whenever a trend matches this keyword.\n\nYour active alerts: ${[...user.alerts].map(a => `<code>${a}</code>`).join(", ")}`
    );
    // Immediately check existing trends
    const matches = trends.filter(t =>
      t.title.toLowerCase().includes(keyword) ||
      t.desc.toLowerCase().includes(keyword) ||
      t.tags.some(tag => tag.toLowerCase().includes(keyword)) ||
      t.cat.toLowerCase().includes(keyword)
    );
    if (matches.length > 0) {
      await sendMessage(chatId,
        `✅ <b>${matches.length} existing trend(s) match "${keyword}":</b>\n\n` +
        matches.map(t => `${t.emoji} ${t.title} — 🔥 ${t.heat}`).join("\n")
      );
    }
    return;
  }

  // ── /myalerts or button
  if (text === "/myalerts" || text === "🔔 My Alerts") {
    if (user.alerts.size === 0) {
      await sendMessage(chatId,
        "🔔 <b>Your Alerts</b>\n\nYou have no alerts set.\n\nUse <code>/alert [keyword]</code> to set one.\nExample: <code>/alert cat</code>"
      );
    } else {
      await sendMessage(chatId,
        `🔔 <b>Your Active Alerts</b>\n\n` +
        [...user.alerts].map((a, i) => `${i + 1}. <code>${a}</code>`).join("\n") +
        "\n\nUse <code>/removealert [keyword]</code> to remove one."
      );
    }
    return;
  }

  // ── /removealert [keyword]
  if (text.startsWith("/removealert ")) {
    const keyword = text.replace("/removealert", "").trim().toLowerCase();
    if (user.alerts.has(keyword)) {
      user.alerts.delete(keyword);
      await sendMessage(chatId, `✅ Alert for <b>"${keyword}"</b> removed.`);
    } else {
      await sendMessage(chatId, `⚠️ No alert found for <b>"${keyword}"</b>.`);
    }
    return;
  }

  // ── Unknown
  await sendMessage(chatId,
    `❓ I didn't understand that. Use the menu below or type /help.`,
    { reply_markup: mainKeyboard }
  );
}

// ─── Polling ──────────────────────────────────────────────────────────────────
let offset = 0;

async function poll() {
  try {
    const res = await apiCall("getUpdates", {
      offset,
      timeout: 30,
      allowed_updates: ["message"]
    });

    if (res.ok && res.result.length > 0) {
      for (const update of res.result) {
        offset = update.update_id + 1;
        if (update.message) {
          try {
            await handleMessage(update.message);
          } catch (e) {
            console.error("Handler error:", e.message);
          }
        }
      }
    }
  } catch (e) {
    console.error("Poll error:", e.message);
  }

  // Poll again immediately
  setImmediate(poll);
}

// ─── Scheduled alert broadcasts (every 2 hours) ───────────────────────────────
async function broadcastAlerts() {
  const risingTrends = trends.filter(t => t.rising);

  for (const [chatId, state] of Object.entries(userState)) {
    if (!state.alertsEnabled || state.alerts.size === 0) continue;

    for (const keyword of state.alerts) {
      const matches = risingTrends.filter(t =>
        t.title.toLowerCase().includes(keyword) ||
        t.desc.toLowerCase().includes(keyword) ||
        t.tags.some(tag => tag.toLowerCase().includes(keyword)) ||
        t.cat.toLowerCase().includes(keyword)
      );

      for (const match of matches) {
        try {
          await sendMessage(chatId, alertsMatchMessage(match), {
            reply_markup: {
              inline_keyboard: [[{ text: "📱 View in Tracker", web_app: { url: WEBAPP_URL } }]]
            }
          });
        } catch (e) {
          console.error(`Alert send error for ${chatId}:`, e.message);
        }
      }
    }
  }
}

// ─── Keep-alive HTTP server (for hosting platforms like Railway/Render) ────────
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("TrendPulse Bot is running ✅");
}).listen(process.env.PORT || 3000);

// ─── Start ────────────────────────────────────────────────────────────────────
console.log("🚀 TrendPulse Bot starting...");

// Delete any existing webhook so long polling works
apiCall("deleteWebhook", {}).then(() => {
  console.log("✅ Webhook cleared — starting long poll");
  poll();
  // Broadcast alerts every 2 hours
  setInterval(broadcastAlerts, 2 * 60 * 60 * 1000);
  console.log("🔔 Alert scheduler running (every 2 hours)");
}).catch(console.error);
