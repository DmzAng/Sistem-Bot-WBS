const dbService = require("../services/dbService");
const {
  calculateAttendancePercentage,
  calculateWorkingDays,
} = require("../utils/attendanceCalculatorUtil");
const { getEntityByType } = require("../services/telegramBotService");
const {
  generatePercentageReportImage,
} = require("../utils/reportGeneratorUtil");
const googleSheetsService = require("../services/googleSheetsService");

// Fungsi untuk mendapatkan waktu WITA
function getWITADate() {
  const now = new Date();
  const witaOffset = 8 * 60 * 60 * 1000; // UTC+8
  return new Date(now.getTime() + witaOffset);
}

// Fungsi untuk cek apakah hari Jumat di WITA
function isFridayWITA() {
  const witaDate = getWITADate();
  return witaDate.getUTCDay() === 5; // 5 = Jumat
}

// Fungsi untuk cek apakah akhir bulan di WITA
function isMonthEndWITA() {
  const witaDate = getWITADate();
  const year = witaDate.getUTCFullYear();
  const month = witaDate.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return witaDate.getUTCDate() === lastDay;
}

module.exports = (bot) => {
  bot.onText(/\/persentase(?:\s+(\w+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;
    const entityParam = match[1] ? match[1].toUpperCase() : null;

    if (!username) {
      return bot.sendMessage(
        chatId,
        "❌ Anda harus memiliki username Telegram"
      );
    }

    let loadingMessage = null;

    try {
      const now = new Date();
      let entityType = entityParam;

      if (!entityType) {
        const user = await dbService.getUserByUsername(username);
        if (!user) {
          throw new Error("Data pengguna tidak ditemukan");
        }
        entityType = user.entity_type;
      }

      if (!["MAGANG", "WBS"].includes(entityType)) {
        return bot.sendMessage(
          chatId,
          "❌ Entity tidak valid. Gunakan MAGANG atau WBS"
        );
      }

      loadingMessage = await bot.sendMessage(
        chatId,
        "🔄 Sedang membuat laporan..."
      );

      await generateAndSendPercentageReport(
        bot,
        entityType,
        true,
        chatId,
        loadingMessage
      );
    } catch (error) {
      console.error("Error:", error);

      if (loadingMessage) {
        await bot
          .deleteMessage(chatId, loadingMessage.message_id)
          .catch(console.error);
      }

      bot.sendMessage(
        chatId,
        `❌ Gagal menghasilkan laporan: ${error.message}`
      );
    }
  });

  // Fungsi terpusat untuk generate laporan persentase
  const generateAndSendPercentageReport = async (
    bot,
    entityType,
    isManual,
    chatId = null,
    loadingMessage = null
  ) => {
    try {
      const witaDate = getWITADate();
      const allUsers = await dbService.getStudentsForEntity(entityType);
      const records = await dbService.getMonthlyAttendanceForEntity(
        entityType,
        witaDate.getUTCFullYear(),
        witaDate.getUTCMonth() + 1
      );

      console.log(`Found ${records.length} records for ${entityType}`);
      console.log(`Processing ${allUsers.length} users`);

      // Kelompokkan per user
      const userMap = {};
      records.forEach((record) => {
        const usernameKey = record.user_name.toLowerCase();
        if (!userMap[usernameKey]) {
          userMap[usernameKey] = [];
        }
        userMap[usernameKey].push(record);
      });

      const reportData = [];
      const workingDays = calculateWorkingDays(
        witaDate.getUTCFullYear(),
        witaDate.getUTCMonth()
      );

      for (const user of allUsers) {
        const usernameClean = user.username.toLowerCase();
        const userRecords = userMap[usernameClean] || [];

        console.log(`User: ${user.username}, Records: ${userRecords.length}`);

        if (userRecords.length === 0) {
          reportData.push({
            nama: user.nama,
            posisi: entityType === "WBS" ? `${user.posisi}` : `${user.status}`,
            presentDays: 0,
            izinDays: 0,
            sakitDays: 0,
            absentDays: workingDays,
            percentage: 0,
            evaluation: "BURUK",
          });
        } else {
          let izinDays = 0;
          let sakitDays = 0;

          userRecords.forEach((record) => {
            const status = record.status_kehadiran.toUpperCase();
            if (status === "IZIN") {
              izinDays++;
            } else if (status === "SAKIT") {
              sakitDays++;
            }
          });

          const result = calculateAttendancePercentage(
            userRecords,
            witaDate.getUTCFullYear(),
            witaDate.getUTCMonth(),
            entityType
          );

          reportData.push({
            nama: user.nama,
            posisi: entityType === "WBS" ? `${user.posisi}` : `${user.status}`,
            presentDays: result.presentDays,
            izinDays: izinDays,
            sakitDays: sakitDays,
            absentDays: result.absentDays,
            percentage: result.percentage,
            evaluation: result.evaluation,
          });
        }
      }

      reportData.sort((a, b) => a.nama.localeCompare(b.nama));

      const entityConfig = getEntityByType(entityType);
      const groupChatId = process.env.GROUP_CHAT_ID;
      const topicId = entityConfig.topicId;

      await googleSheetsService.writePercentageReport(reportData);
      await generatePercentageReportImage(bot, groupChatId, {
        message_thread_id: topicId,
      });

      if (isManual && chatId) {
        await bot.sendMessage(
          chatId,
          `✅ Laporan persentase ${entityType} telah dikirim ke grup`
        );

        if (loadingMessage) {
          await bot.deleteMessage(chatId, loadingMessage.message_id);
        }
      }

      console.log(`✅ Laporan persentase ${entityType} berhasil dikirim`);
    } catch (error) {
      console.error(`Error generating report for ${entityType}:`, error);

      if (isManual && chatId) {
        if (loadingMessage) {
          await bot
            .deleteMessage(chatId, loadingMessage.message_id)
            .catch(console.error);
        }
        await bot.sendMessage(
          chatId,
          `❌ Gagal menghasilkan laporan: ${error.message}`
        );
      }
      throw error;
    }
  };

  // Fungsi untuk laporan otomatis dengan timezone WITA
  const sendScheduledReports = async () => {
    try {
      const isFriday = isFridayWITA();
      const isMonthEnd = isMonthEndWITA();

      console.log(
        `📅 Schedule check - Friday: ${isFriday}, MonthEnd: ${isMonthEnd}, WITA Date: ${getWITADate().toUTCString()}`
      );

      if (!isFriday && !isMonthEnd) {
        console.log(
          "⏭️ Scheduled report skipped: not Friday and not month end"
        );
        return;
      }

      const entityTypes = ["MAGANG", "WBS"];

      for (const entityType of entityTypes) {
        await generateAndSendPercentageReport(bot, entityType, false);
        console.log(`✅ Scheduled report for ${entityType} completed`);
      }
    } catch (error) {
      console.error("Error in scheduled reports:", error);
    }
  };

  const scheduleReport = () => {
    const witaNow = getWITADate();
    const target = new Date(witaNow);

    target.setUTCHours(16, 45, 0, 0);

    if (witaNow > target) {
      target.setUTCDate(target.getUTCDate() + 1);
    }

    const timeout = target - witaNow;
    console.log(
      `⏰ Scheduled report will run in ${Math.round(
        timeout / 1000 / 60
      )} minutes at ${target.toUTCString()}`
    );

    setTimeout(() => {
      sendScheduledReports();
      setInterval(sendScheduledReports, 24 * 60 * 60 * 1000);
    }, timeout);
  };

  // Jalankan scheduling
  scheduleReport();
};
