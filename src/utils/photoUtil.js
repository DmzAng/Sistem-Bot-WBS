const fetch = require("node-fetch");
const exifParser = require("exif-parser");
const { saveAttendanceData } = require("../handlers/attendanceHandler");

module.exports = (bot, userStates) => {
  bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const state = userStates[chatId];

    if (!state || state.step !== 1) return;

    try {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const file = await bot.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TOKEN}/${file.file_path}`;

      state.photo = { fileId, fileUrl };

      const response = await fetch(fileUrl);
      const buffer = await response.buffer();
      const parser = exifParser.create(buffer);
      const exifData = parser.parse().tags;

      let finalLat, finalLon;
      if (exifData.GPSLatitude && exifData.GPSLongitude) {
        const latRef = exifData.GPSLatitudeRef || "N";
        const lonRef = exifData.GPSLongitudeRef || "E";

        finalLat =
          exifData.GPSLatitude[0] +
          exifData.GPSLatitude[1] / 60 +
          exifData.GPSLatitude[2] / 3600;
        finalLat = latRef === "S" ? -finalLat : finalLat;

        finalLon =
          exifData.GPSLongitude[0] +
          exifData.GPSLongitude[1] / 60 +
          exifData.GPSLongitude[2] / 3600;
        finalLon = lonRef === "W" ? -finalLon : finalLon;

        state.location = { lat: finalLat, lon: finalLon };
      }

      if (finalLat && finalLon) {
        return await saveAttendanceData(bot, userStates, chatId, state);
      }

      bot.sendMessage(chatId, "📍 Silakan bagikan lokasi Anda:", {
        reply_markup: {
          keyboard: [[{ text: "📌 Bagikan Lokasi", request_location: true }]],
          one_time_keyboard: true,
        },
      });
    } catch (error) {
      console.error(error);
      bot.sendMessage(chatId, "❌ Gagal memproses foto");
    }
  });
};
