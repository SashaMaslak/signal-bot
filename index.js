/**
 * RSIBOT v3.2 AUTO/MANUAL — Node.js
 * Smart Money focused
 */

const TelegramBot = require("node-telegram-bot-api")
const axios = require("axios")
const dayjs = require("dayjs")
const utc = require("dayjs/plugin/utc")

dayjs.extend(utc)
const { RSI, SMA, ATR } = require("technicalindicators")

// ================= CONFIG =================
const BOT_TOKEN =
  process.env.BOT_TOKEN || "8537751440:AAEeO99b8TT4IoDi28Co9y13RJebC9l_aZ0"
const USER_ID = Number(process.env.USER_ID || 1446848390)

const PAIRS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "USDCAD",
  "AUDUSD",
  "EURGBP",
  "EURJPY",
  "EURCHF",
  "EURAUD",
  "EURCAD",
  "GBPJPY",
  "GBPCHF",
  "GBPAUD",
  "GBPCAD",
  "AUDJPY",
  "AUDCHF",
  "AUDCAD",
  "CADCHF",
  "CADJPY",
  "CHFJPY",
]

const TIMEFRAME = "5m"
const RSI_PERIOD = 14
const OVERBOUGHT = 80
const OVERSOLD = 20
const AUTO_INTERVAL = 600_000 // 10 хв
const REQUEST_PAUSE = 400
const AUTO_MIN_PROB = 70

// ================= BOT =================
const bot = new TelegramBot(BOT_TOKEN, { polling: true })

// ================= UTILS =================
const sleep = ms => new Promise(r => setTimeout(r, ms))

function log(msg) {
  console.log(`[${dayjs().format("YYYY-MM-DD HH:mm:ss")}] ${msg}`)
}

function isForexOpen() {
  const now = dayjs().utc()
  const d = now.day()
  if (d === 0 || d === 6) return false
  if (now.hour() < 5 || now.hour() >= 20) return false
  return true
}

// ================= DATA =================
async function fetchOHLC(pair, range = "7d") {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${pair}=X?interval=${TIMEFRAME}&range=${range}`
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })
    const r = data.chart?.result?.[0]
    if (!r) return null
    const q = r.indicators.quote[0]
    return r.timestamp
      .map((_, i) => ({
        open: q.open[i],
        high: q.high[i],
        low: q.low[i],
        close: q.close[i],
      }))
      .filter(c => c.close !== null)
  } catch {
    return null
  }
}

// ================= INDICATORS =================
function computeIndicators(candles) {
  const close = candles.map(x => x.close)
  const high = candles.map(x => x.high)
  const low = candles.map(x => x.low)

  return {
    rsi: RSI.calculate({ values: close, period: RSI_PERIOD }).at(-1),
    ma50: SMA.calculate({ values: close, period: 50 }).at(-1),
    ma200: SMA.calculate({ values: close, period: 200 }).at(-1),
    atr: ATR.calculate({ high, low, close, period: 14 }).at(-1),
  }
}

// ================= SMART MONEY =================
function smartMoneyScore(candles) {
  let score = 0
  if (candles.length < 20) return 50

  if (candles.at(-1).high > candles.at(-5).high) score += 15
  if (candles.at(-1).low < candles.at(-5).low) score += 15

  const body = Math.abs(candles.at(-2).close - candles.at(-2).open)
  const wick = candles.at(-2).high - candles.at(-2).low
  if (wick > body * 2) score += 20

  return Math.min(score, 100)
}

// ================= ANALYSIS =================
async function analyzePair(pair) {
  if (!isForexOpen()) return null
  const candles = await fetchOHLC(pair)
  if (!candles || candles.length < 50) return null

  const ind = computeIndicators(candles)
  const sm = smartMoneyScore(candles)

  let probability = 20 + sm * 0.6
  const trend =
    ind.ma50 && ind.ma200 ? (ind.ma50 > ind.ma200 ? "up" : "down") : null
  if (trend) probability += 8

  let direction = "NEUTRAL"
  if (ind.rsi > OVERBOUGHT) direction = "ВНИЗ"
  else if (ind.rsi < OVERSOLD) direction = "ВГОРУ"
  else if (trend) direction = trend === "up" ? "ВГОРУ" : "ВНИЗ"

  return {
    pair,
    direction,
    rsi: ind.rsi.toFixed(2),
    probability: Math.min(95, Math.round(probability)),
  }
}

// ================= FIND TOP N =================
async function findTopPairs(n = 3) {
  const results = []
  for (const p of PAIRS) {
    const r = await analyzePair(p)
    if (r) results.push(r)
    await sleep(REQUEST_PAUSE)
  }
  results.sort((a, b) => b.probability - a.probability)
  return results.slice(0, n)
}

// ================= MANUAL =================
async function bestPairManual(chatId) {
  log("👤 РУЧНИЙ запуск: ТОП-3 пар")
  const topPairs = await findTopPairs(3)
  if (!topPairs.length) return

  let msg = "🏆 *ТОП-3 пари (ручний запит)*\n"
  topPairs.forEach((r, i) => {
    msg += `${i + 1}. 💱 ${r.pair} | 📈 ${r.direction} | RSI: ${
      r.rsi
    } | Ймовірність: ${r.probability}%\n`
  })

  bot.sendMessage(chatId, msg, { parse_mode: "Markdown" })
}

// ================= AUTO =================
async function bestPairAuto() {
  if (!isForexOpen()) return
  log("🔁 АВТОЗАПУСК: пошук ТОП-1 пари")

  const topPairs = await findTopPairs(1)
  if (!topPairs.length) return
  const best = topPairs[0]

  if (best.probability >= AUTO_MIN_PROB) {
    const msg =
      `🤖 *AUTO ТОП-1 пара*\n` +
      `💱 ${best.pair}\n` +
      `📈 ${best.direction}\n` +
      `RSI: ${best.rsi}\n` +
      `Ймовірність: *${best.probability}%*`
    bot.sendMessage(USER_ID, msg, { parse_mode: "Markdown" })
    log(`📩 AUTO сигнал відправлено (${best.probability}%)`)
  } else {
    log(`⏭ AUTO пропуск — ${best.probability}% < ${AUTO_MIN_PROB}%`)
  }
}

// ================= UI =================
bot.on("message", async msg => {
  if (msg.text === "Найкраща пара") {
    await bestPairManual(msg.chat.id)
  }
})

// ================= AUTO LOOP =================
setInterval(bestPairAuto, AUTO_INTERVAL)

// ================= START =================
bot.getMe().then(me => {
  log(`🤖 Bot connected: @${me.username}`)
  bot.sendMessage(
    USER_ID,
    `🤖 *RSIBOT запущений*\nTF: ${TIMEFRAME}\nAUTO: 10 хв (70%+)`,
    { parse_mode: "Markdown" }
  )
})

log("✅ RSIBOT AUTO/MANUAL стартував")
