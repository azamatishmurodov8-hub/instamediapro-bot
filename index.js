const { Bot, InputFile, InlineKeyboard } = require("grammy");
const axios = require("axios");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const yts = require("yt-search");
const { Ytdl, chooseFormat, createPoTokenProvider } = require("@distube/ytdl-core");

const BOT_TOKEN = "9116531079:AAH5SvgJ54BQFGraDar5vsurix_txhjRiTI";
const RAPIDAPI_KEY = "3060c13eb0msh0e38d762e05eff2p17e1ccjsn142f3fe89ca7";
const RAPIDAPI_HOST = "instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com";
const AUDD_TOKEN = "45bfa4f2c8d79ff031413aff5f1f9657";
const FFMPEG_BIN = process.env.FFMPEG_BIN || (fs.existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg");
const WHISPER_BIN = process.env.WHISPER_BIN || (fs.existsSync("/opt/homebrew/bin/whisper-cli") ? "/opt/homebrew/bin/whisper-cli" : "whisper-cli");
const WHISPER_MODEL = path.join(__dirname, "models", "ggml-tiny.bin");

const bot = new Bot(BOT_TOKEN);
const mediaStore = new Map();

console.log("⚡ InstaMediaPro_bot (Tezkor Qidiruv + Tanlov Tugmalari + Instagram) ishga tushmoqda...");

let poTokenProvider = null;
let ytdlClient = null;

async function getYtdl() {
  if (!ytdlClient) {
    try {
      poTokenProvider = await createPoTokenProvider({ timeoutMs: 15000 });
      ytdlClient = new Ytdl({ getPoToken: poTokenProvider });
      console.log("✅ YouTube PO-Token provayderi muvaffaqiyatli ishga tushdi");
    } catch (e) {
      console.error("⚠️ PO-Token provayder xatosi, oddiy Ytdl rejimiga o'tilmoqda:", e.message);
      ytdlClient = new Ytdl();
    }
  }
  return ytdlClient;
}

async function resetYtdl() {
  try {
    if (poTokenProvider) await poTokenProvider.dispose().catch(() => {});
  } catch (_) {}
  poTokenProvider = null;
  ytdlClient = null;
}

// Bot boshlanishi bilan PO-Token provayderini tayyorlab qo'yish
getYtdl().catch(() => {});

// 1. YouTube trekini tezkor yuklab olish
async function downloadTrackFromYt(trackOrUrl, outBase) {
  const url = typeof trackOrUrl === "string" ? trackOrUrl : trackOrUrl.url;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const client = await getYtdl();
      const info = await client.getInfo(url);

      const m4a = info.formats.find((f) => f.itag === 140);
      const format =
        m4a ||
        chooseFormat(info.formats, {
          quality: "highestaudio",
          filter: { hasAudio: true, hasVideo: false },
        }) ||
        info.formats.find((f) => f.hasAudio);

      if (!format) return null;

      const isDirectM4a = !!m4a || (format.container === "mp4" && format.audioCodec?.includes("mp4a"));
      const outPath = isDirectM4a ? `${outBase}.m4a` : `${outBase}.mp3`;

      if (isDirectM4a) {
        const stream = client.download(info, { format });
        const writer = fs.createWriteStream(outPath);
        await new Promise((resolve, reject) => {
          stream.pipe(writer);
          writer.on("finish", resolve);
          stream.on("error", reject);
          writer.on("error", reject);
        });
      } else {
        const outStream = spawn(FFMPEG_BIN, [
          "-i",
          "pipe:0",
          "-vn",
          "-c:a",
          "libmp3lame",
          "-b:a",
          "192k",
          outPath,
          "-y",
        ]);
        const stream = client.download(info, { format });
        stream.pipe(outStream.stdin);
        await new Promise((resolve, reject) => {
          outStream.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exit code ${code}`));
          });
          outStream.on("error", reject);
          stream.on("error", reject);
        });
      }

      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 100000) {
        return {
          path: outPath,
          title: info.videoDetails.title || (typeof trackOrUrl === "object" ? trackOrUrl.title : "Musiqa"),
          author: info.videoDetails.author?.name || (typeof trackOrUrl === "object" ? trackOrUrl.author?.name : "Artist"),
          duration:
            info.videoDetails.lengthSeconds
              ? Math.floor(info.videoDetails.lengthSeconds / 60) +
                ":" +
                String(info.videoDetails.lengthSeconds % 60).padStart(2, "0")
              : (typeof trackOrUrl === "object" ? trackOrUrl.timestamp : "3:00"),
        };
      }
    } catch (err) {
      console.error(`Yuklash xatosi (urinish ${attempt}):`, err.message);
      if (attempt === 1) {
        await resetYtdl();
      }
    }
  }
  return null;
}

// 2. Qo'shiq qidirish va yuklab olish (Title/Artist bo'yicha)
async function fetchFullSong(title, artist, outBase) {
  try {
    const cleanTitle = encodeURIComponent(title.replace(/[^\w\s]/gi, "").trim());
    const cleanArtist = encodeURIComponent(artist.replace(/[^\w\s]/gi, "").trim());
    const res = await axios.get(
      `https://fast-saavn.vercel.app/?title=${cleanTitle}&artist=${cleanArtist}`,
      { timeout: 3000 }
    );
    const mediaId = String(res.data || "").trim();
    if (mediaId && mediaId.includes("/")) {
      const cdnUrl = `https://aac.saavncdn.com/${mediaId}_320.mp4`;
      const outPath = `${outBase}.m4a`;
      const writer = fs.createWriteStream(outPath);
      const stream = await axios({
        url: cdnUrl,
        method: "GET",
        responseType: "stream",
        timeout: 10000,
      });
      await new Promise((resolve, reject) => {
        stream.data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 100000) {
        return { path: outPath, format: "m4a" };
      }
    }
  } catch (e) {
    // Saavn bo'lmasa YouTube'ga o'tadi
  }

  const r = await yts(`${artist} - ${title}`);
  const top = r.videos.find((v) => v.seconds >= 45 && v.seconds <= 600) || r.videos[0];
  if (top) {
    return await downloadTrackFromYt(top, outBase);
  }
  return null;
}

// 3. Video ovozidan matnni ajratish (Whisper AI)
async function transcribeSpeech(audioPath) {
  try {
    const wavPath = `${audioPath}_temp.wav`;
    await new Promise((res) => {
      exec(`"${FFMPEG_BIN}" -i "${audioPath}" -ar 16000 -ac 1 "${wavPath}" -y`, () => res());
    });

    if (!fs.existsSync(wavPath)) return null;

    const rawOutput = await new Promise((resolve) => {
      exec(
        `"${WHISPER_BIN}" -m "${WHISPER_MODEL}" -f "${wavPath}" -nt 2>/dev/null`,
        (err, stdout) => resolve(stdout || "")
      );
    });

    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);

    const cleanLines = rawOutput
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) =>
          l.length > 0 &&
          !l.startsWith("main:") &&
          !l.startsWith("whisper_") &&
          !l.startsWith("ggml_") &&
          l !== "[Music]"
      );

    return cleanLines.join(" ").trim() || null;
  } catch (e) {
    console.error("Transcribe error:", e.message);
    return null;
  }
}

// ==========================================
// TELEGRAM BUYRUQLAR
// ==========================================

bot.command("start", async (ctx) => {
  await ctx.reply(
    `👋 <b>Assalomu alaykum, ${ctx.from.first_name || "do'stim"}!</b>\n\n` +
      `⚡ <b>InstaMediaPro Bot</b> sizning xizmatingizda:\n\n` +
      `1️⃣ <b>Instagram havolasi yuborsangiz:</b>\n` +
      `   • 🎬 <b>Video</b> — bir zumda yuboriladi\n` +
      `   • 🎙 <b>Videodagi musiqa (ovoz)</b> — avtomatik ajratib tashlanadi\n` +
      `   • 📝 <b>Video matni</b> va 🎵 <b>Asl musiqa</b> — tugmalar orqali xohlaganingizcha olasiz!\n\n` +
      `2️⃣ <b>Musiqa qidirish:</b>\n` +
      `   • Shunchaki qo'shiq yoki til nomini yozing (masalan: <code>Miyagi</code> yoki <code>uzbekcha</code>)\n` +
      `   • Bot 1–5 gacha raqamli ro'yxat chiqaradi — xohlagan raqamingizni bosasiz va o'sha qo'shiq tezkor yuklanadi! 🎵\n\n` +
      `<i>Hoziroq sinab koʻring!</i>`,
    { parse_mode: "HTML" }
  );
});

// ==========================================
// TUGMALARNI BOSGANDA (CALLBACK QUERY)
// ==========================================
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;

  // A) MUSIQA RO'YXATIDAN BITTA RAQAM TANLANGANDA (dl:videoId yoki dltrack:searchId:index)
  if (data.startsWith("dl:") || data.startsWith("dltrack:")) {
    let targetUrl = "";
    let defaultTitle = "Musiqa";
    let defaultAuthor = "Artist";
    let defaultDuration = "";

    if (data.startsWith("dl:")) {
      const videoId = data.slice(3);
      targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
      await ctx.answerCallbackQuery({ text: "⏳ Musiqa yuklanmoqda..." });
    } else {
      const [, searchId, indexStr] = data.split(":");
      const index = parseInt(indexStr, 10);
      const searchData = mediaStore.get(searchId);

      if (!searchData || !searchData.tracks || !searchData.tracks[index]) {
        return ctx.answerCallbackQuery({
          text: "⚠️ Qidiruv natijasi eskirgan. Qaytadan qidiring.",
          show_alert: true,
        });
      }

      const selectedTrack = searchData.tracks[index];
      targetUrl = selectedTrack.url;
      defaultTitle = selectedTrack.title;
      defaultAuthor = selectedTrack.author?.name || "Original Musiqa";
      defaultDuration = selectedTrack.timestamp || "";
      await ctx.answerCallbackQuery({ text: `⏳ ${index + 1}-raqamdagi musiqa yuklanmoqda...` });
    }

    const statusMsg = await ctx.reply(
      `📥 <b>Yuklanmoqda:</b> ${defaultTitle}...`,
      { parse_mode: "HTML" }
    );
    ctx.replyWithChatAction("upload_voice").catch(() => {});

    const timestamp = Date.now();
    const tmpDir = path.join(__dirname, "tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
    const outBase = path.join(tmpDir, `track_${timestamp}`);

    try {
      const musicInfo = await downloadTrackFromYt(targetUrl, outBase);

      if (musicInfo && fs.existsSync(musicInfo.path)) {
        await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

        const safeTitle = (musicInfo.title || defaultTitle).replace(/[^\w\s\-\.\(\)]/gi, "").trim();
        const ext = path.extname(musicInfo.path) || ".m4a";

        await ctx.replyWithAudio(
          new InputFile(musicInfo.path, `${safeTitle || "Musiqa"}${ext}`),
          {
            caption:
              `🎵 <b>${musicInfo.title || defaultTitle}</b>\n` +
              `⏱ <b>Davomiyligi:</b> ${musicInfo.duration || defaultDuration}\n` +
              `👤 <b>Ijrochi:</b> ${musicInfo.author || defaultAuthor}\n\n` +
              `🤖 @InstaMediaPro_bot`,
            title: musicInfo.title || defaultTitle,
            performer: musicInfo.author || defaultAuthor,
            parse_mode: "HTML",
          }
        );
        fs.unlinkSync(musicInfo.path);
      } else {
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          "❌ Kechirasiz, ushbu musiqani yuklab bo‘lmadi. Boshqa raqamni tanlab ko‘ring."
        ).catch(() => {});
      }
    } catch (e) {
      console.error("dl error:", e.message);
      await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
    }
    return;
  }

  // B) INSTAGRAM QO'SHIMCHA TUGMALARI (text, music, audio)
  const [action, id] = data.split(":");
  const media = mediaStore.get(id);
  if (!media) {
    return ctx.answerCallbackQuery({
      text: "⚠️ Ushbu media eskirgan. Iltimos, havolani qayta yuboring.",
      show_alert: true,
    });
  }

  const timestamp = Date.now();
  const tmpDir = path.join(__dirname, "tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

  const videoFile = path.join(tmpDir, `btn_vid_${timestamp}.mp4`);
  const audioFile = path.join(tmpDir, `btn_aud_${timestamp}.m4a`);

  // 1. VIDEO MATNINI AJRATISH (SPEECH-TO-TEXT / LYRICS)
  if (action === "text") {
    await ctx.answerCallbackQuery({ text: "📝 Video matni tahlil qilinmoqda..." });
    const waitMsg = await ctx.reply("⏳ Video matni tayyorlanmoqda...");

    try {
      const writer = fs.createWriteStream(videoFile);
      const vidStream = await axios({
        url: media.url,
        method: "GET",
        responseType: "stream",
        timeout: 20000,
      });

      await new Promise((res, rej) => {
        vidStream.data.pipe(writer);
        writer.on("finish", res);
        writer.on("error", rej);
      });

      await new Promise((res) => {
        exec(
          `"${FFMPEG_BIN}" -i "${videoFile}" -vn -c:a copy "${audioFile}" -y 2>/dev/null || "${FFMPEG_BIN}" -i "${videoFile}" -vn -c:a libmp3lame -b:a 128k "${audioFile}" -y`,
          () => res()
        );
      });

      // A) Qo'shiq matnini (Lyrics) tekshirish
      let lyricsText = "";
      try {
        const snippet = path.join(tmpDir, `snip_${timestamp}.m4a`);
        await new Promise((res) => {
          exec(`"${FFMPEG_BIN}" -ss 0 -t 10 -i "${audioFile}" -c:a copy "${snippet}" -y 2>/dev/null`, () => res());
        });

        const form = new FormData();
        form.append("api_token", AUDD_TOKEN);
        form.append("file", fs.createReadStream(snippet));

        const auddRes = await axios.post("https://api.audd.io/", form, {
          headers: form.getHeaders(),
          timeout: 4000,
        });

        if (auddRes.data?.result?.title) {
          const lRes = await axios.get(
            `https://api.audd.io/findLyrics/?api_token=${AUDD_TOKEN}&q=${encodeURIComponent(
              auddRes.data.result.artist + " " + auddRes.data.result.title
            )}`,
            { timeout: 4000 }
          );
          if (lRes.data?.result?.[0]?.lyrics) {
            lyricsText = lRes.data.result[0].lyrics;
          }
        }
        if (fs.existsSync(snippet)) fs.unlinkSync(snippet);
      } catch (e) {}

      if (lyricsText) {
        await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        return await ctx.reply(
          `📝 <b>Qoʻshiq matni (Lyrics):</b>\n\n${lyricsText.slice(0, 3800)}\n\n🤖 @InstaMediaPro_bot`,
          { parse_mode: "HTML" }
        );
      }

      // B) Whisper AI orqali nutqni matnga aylantirish
      const speechText = await transcribeSpeech(audioFile);
      await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

      if (speechText) {
        await ctx.reply(
          `📝 <b>Videodagi nutq matni (AI Transkripsiya):</b>\n\n"${speechText}"\n\n🤖 @InstaMediaPro_bot`,
          { parse_mode: "HTML" }
        );
      } else {
        await ctx.reply("ℹ️ Ushbu videoda aniq so‘zlashuv yoki matn aniqlanmadi.");
      }
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      await ctx.reply("❌ Matnni tahlil qilishda xatolik yuz berdi.");
    } finally {
      if (fs.existsSync(videoFile)) fs.unlinkSync(videoFile);
      if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);
    }
    return;
  }

  // 2. ASL TO'LIQ MUSIQA
  if (action === "music") {
    await ctx.answerCallbackQuery({ text: "🎵 Musiqa qidirilmoqda..." });
    const waitMsg = await ctx.reply("🔍 Asl to'liq musiqa qidirilmoqda...");

    const fullTrackBase = path.join(tmpDir, `full_${timestamp}`);

    try {
      const writer = fs.createWriteStream(videoFile);
      const vidStream = await axios({
        url: media.url,
        method: "GET",
        responseType: "stream",
        timeout: 20000,
      });

      await new Promise((res, rej) => {
        vidStream.data.pipe(writer);
        writer.on("finish", res);
        writer.on("error", rej);
      });

      await new Promise((res) => {
        exec(
          `"${FFMPEG_BIN}" -i "${videoFile}" -vn -c:a copy "${audioFile}" -y 2>/dev/null || "${FFMPEG_BIN}" -i "${videoFile}" -vn -c:a libmp3lame -b:a 128k "${audioFile}" -y`,
          () => res()
        );
      });

      const snippet = path.join(tmpDir, `snip_${timestamp}.m4a`);
      await new Promise((res) => {
        exec(`"${FFMPEG_BIN}" -ss 0 -t 10 -i "${audioFile}" -c:a copy "${snippet}" -y 2>/dev/null`, () => res());
      });

      const form = new FormData();
      form.append("api_token", AUDD_TOKEN);
      form.append("file", fs.createReadStream(snippet));

      const auddRes = await axios.post("https://api.audd.io/", form, {
        headers: form.getHeaders(),
        timeout: 5000,
      });

      if (fs.existsSync(snippet)) fs.unlinkSync(snippet);

      if (auddRes.data?.status === "success" && auddRes.data?.result) {
        const songTitle = auddRes.data.result.title;
        const songArtist = auddRes.data.result.artist;

        const songRes = await fetchFullSong(songTitle, songArtist, fullTrackBase);
        await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

        if (songRes && fs.existsSync(songRes.path)) {
          await ctx.replyWithAudio(
            new InputFile(songRes.path, `${songArtist} - ${songTitle}.m4a`),
            {
              caption:
                `🎵 <b>Toʻliq Asl Musiqa (Original Track)</b>\n\n` +
                `👤 <b>Artist:</b> ${songArtist}\n` +
                `🎼 <b>Nomi:</b> ${songTitle}\n\n` +
                `🤖 @InstaMediaPro_bot`,
              title: songTitle,
              performer: songArtist,
              parse_mode: "HTML",
            }
          );
          fs.unlinkSync(songRes.path);
          return;
        }
      }

      await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      await ctx.reply("❌ Ushbu videodagi musiqa aniqlanmadi.");
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      await ctx.reply("❌ Musiqani yuklashda xatolik yuz berdi.");
    } finally {
      if (fs.existsSync(videoFile)) fs.unlinkSync(videoFile);
      if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);
    }
    return;
  }
});

// ==========================================
// ASOSIY XABARLARNI QABUL QILISH
// ==========================================
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  const igRegex =
    /(?:https?:\/\/)?(?:www\.)?(?:instagram\.com)\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i;
  const igMatch = text.match(igRegex);

  // ==========================================
  // REJIM 1: FOYDALANUVCHI MUSIQA QIDIRGANDA
  // (Raqamli ro'yxat + Tugmalar chiqaradi, zudlik bilan!)
  // ==========================================
  if (!igMatch) {
    const searchWait = await ctx.reply(
      `🔍 <b>"${text}"</b> bo‘yicha qidirilmoqda...`,
      { parse_mode: "HTML" }
    );

    try {
      const r = await yts(text);
      let tracks = r.videos
        .filter((v) => !v.live && (v.seconds === 0 || (v.seconds >= 30 && v.seconds <= 900)))
        .slice(0, 5);

      if (tracks.length === 0 && r.videos && r.videos.length > 0) {
        tracks = r.videos.slice(0, 5);
      }

      if (!tracks || tracks.length === 0) {
        return await ctx.api.editMessageText(
          ctx.chat.id,
          searchWait.message_id,
          `❌ Kechirasiz, <b>"${text}"</b> bo‘yicha musiqa topilmadi.`,
          { parse_mode: "HTML" }
        ).catch(() => {});
      }

      const searchId = `s_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      mediaStore.set(searchId, { tracks, createdAt: Date.now() });

      let msgText = `🔍 <b>"${text}" bo‘yicha topilgan musiqalar:</b>\n\n`;
      const keyboard = new InlineKeyboard();

      const numEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
      tracks.forEach((track, index) => {
        msgText += `${numEmojis[index]} <b>${track.title}</b> (${track.timestamp})\n`;
        const cb = track.videoId ? `dl:${track.videoId}` : `dltrack:${searchId}:${index}`;
        keyboard.text(numEmojis[index], cb);
      });

      msgText += `\n👇 <i>Yuklab olish uchun pastdagi raqamni bosing:</i>`;

      await ctx.api.editMessageText(ctx.chat.id, searchWait.message_id, msgText, {
        reply_markup: keyboard,
        parse_mode: "HTML",
      });
    } catch (err) {
      console.error("Qidiruv xatosi:", err.message);
      await ctx.api.editMessageText(
        ctx.chat.id,
        searchWait.message_id,
        "❌ Qidirishda xatolik yuz berdi."
      ).catch(() => {});
    }
    return;
  }

  // ==========================================
  // REJIM 2: INSTAGRAM REELS / POST YUKLASH
  // (Video + Musiqa avtomatik darhol chiqadi! Qolgani tugmada)
  // ==========================================
  const cleanUrl = igMatch[0];
  const waitMsg = await ctx.reply("⏳ Video yuklanmoqda...");

  try {
    const response = await axios.get(
      `https://${RAPIDAPI_HOST}/convert?url=${encodeURIComponent(cleanUrl)}`,
      {
        headers: {
          "x-rapidapi-host": RAPIDAPI_HOST,
          "x-rapidapi-key": RAPIDAPI_KEY,
        },
        timeout: 25000,
      }
    );

    const data = response.data;
    if (!data || !data.media || data.media.length === 0) {
      await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      return ctx.reply("❌ Kechirasiz, ushbu Instagram postni yuklab bo‘lmadi.");
    }

    // 1. VIDEONI YUBORISH (Tugmalar bilan)
    for (const item of data.media) {
      if (item.type === "video") {
        const mediaId = `m_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        mediaStore.set(mediaId, { url: item.url, createdAt: Date.now() });

        const keyboard = new InlineKeyboard()
          .text("📝 Video matni (AI)", `text:${mediaId}`)
          .text("🎵 Asl toʻliq musiqa", `music:${mediaId}`);

        await ctx.replyWithVideo(item.url, {
          caption: `🎬 <b>Instagram Video</b>\n\n🤖 @InstaMediaPro_bot`,
          reply_markup: keyboard,
          parse_mode: "HTML",
        });

        // 2. VIDEODAGI OVOZ (MUSIQA)NI HAM ZUDLIK BILAN ALOHIDA YUBORISH!
        const timestamp = Date.now();
        const tmpDir = path.join(__dirname, "tmp");
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

        const videoFile = path.join(tmpDir, `vid_${timestamp}.mp4`);
        const videoAudioFile = path.join(tmpDir, `audio_${timestamp}.m4a`);

        try {
          const writer = fs.createWriteStream(videoFile);
          const vidStream = await axios({
            url: item.url,
            method: "GET",
            responseType: "stream",
            timeout: 20000,
          });

          await new Promise((res, rej) => {
            vidStream.data.pipe(writer);
            writer.on("finish", res);
            writer.on("error", rej);
          });

          await new Promise((res) => {
            exec(
              `"${FFMPEG_BIN}" -i "${videoFile}" -vn -c:a copy "${videoAudioFile}" -y 2>/dev/null || "${FFMPEG_BIN}" -i "${videoFile}" -vn -c:a libmp3lame -b:a 128k "${videoAudioFile}" -y`,
              () => res()
            );
          });

          if (fs.existsSync(videoAudioFile)) {
            await ctx.replyWithAudio(
              new InputFile(videoAudioFile, "Video_Musiqasi.m4a"),
              {
                caption: `🎙 <b>Videodagi musiqa (Audio)</b>\n\n🤖 @InstaMediaPro_bot`,
                title: "Videodagi Musiqa",
                performer: "Instagram Audio",
                parse_mode: "HTML",
              }
            );
          }
        } catch (audErr) {
          console.error("Audio ajratish xatosi:", audErr.message);
        } finally {
          if (fs.existsSync(videoFile)) fs.unlinkSync(videoFile);
          if (fs.existsSync(videoAudioFile)) fs.unlinkSync(videoAudioFile);
        }
      } else if (item.type === "image") {
        await ctx.replyWithPhoto(item.url, {
          caption: `📸 <b>Instagram Rasm</b>\n\n🤖 @InstaMediaPro_bot`,
          parse_mode: "HTML",
        });
      }
    }

    await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
  } catch (err) {
    console.error("Umumiy xato:", err.message);
    await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
    await ctx.reply("❌ Media faylni yuklashda xatolik yuz berdi.");
  }
});

bot.catch((err) => {
  console.error("Bot xatosi:", err.message);
});

bot.start();
