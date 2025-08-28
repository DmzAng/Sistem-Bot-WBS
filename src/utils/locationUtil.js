const attendanceHandler = require("../handlers/attendanceHandler");
const { saveAttendanceData } = require("../handlers/attendanceHandler");

module.exports = (bot, userStates) => {
  bot.on("location", async (msg) => {
    const chatId = msg.chat.id;
    const state = userStates[chatId];

    if (!state || !state.step || state.step !== 1 || state.creatingPlan) {
      return;
    }

    try {
      state.location = {
        lat: msg.location.latitude,
        lon: msg.location.longitude,
      };

      await saveAttendanceData(bot, userStates, chatId, state);
    } catch (error) {
      console.error(`[LOKASI] Error:`, error);
      bot.sendMessage(chatId, "❌ Gagal memproses lokasi: " + error.message);
    }
  });
};