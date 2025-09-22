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

      // Kirim pesan loading dan simpan ID-nya
      loadingMessage = await bot.sendMessage(
        chatId,
        "🔄 Sedang membuat laporan..."
      );

      const allUsers = await dbService.getStudentsForEntity(entityType);
      const records = await dbService.getMonthlyAttendanceForEntity(
        entityType,
        now.getFullYear(),
        now.getMonth() + 1
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
        now.getFullYear(),
        now.getMonth()
      );

      // Di dalam loop for (const user of allUsers)
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
          // Hitung jumlah izin dan sakit
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
            now.getFullYear(),
            now.getMonth(),
            entityType
          );

          reportData.push({
            nama: user.nama,
            posisi: entityType === "WBS" ? `${user.posisi}` : `${user.status}`,
            presentDays: result.presentDays,
            izinDays: izinDays, // Tambahkan
            sakitDays: sakitDays, // Tambahkan
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

      // Tulis ke Google Sheets untuk AppScript generate PDF
      await googleSheetsService.writePercentageReport(reportData);

      // Generate dan kirim laporan
      await generatePercentageReportImage(bot, groupChatId, {
        message_thread_id: topicId,
      });

      await bot.sendMessage(
        chatId,
        `✅ Laporan persentase ${entityType} telah dikirim ke grup`
      );

      // Hapus pesan loading setelah selesai
      if (loadingMessage) {
        await bot.deleteMessage(chatId, loadingMessage.message_id);
      }
    } catch (error) {
      console.error("Error:", error);

      // Hapus pesan loading jika ada error
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

  // Fungsi untuk laporan otomatis
  const sendScheduledReports = async () => {
    try {
      const now = new Date();
      const isFriday = now.getDay() === 5; // 5 = Jumat
      const isMonthEnd =
        new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() ===
        now.getDate();

      if (!isFriday && !isMonthEnd) return;

      const entityTypes = ["MAGANG", "WBS"];

      for (const entityType of entityTypes) {
        const allUsers = await dbService.getStudentsForEntity(entityType);

        const records = await dbService.getMonthlyAttendanceForEntity(
          entityType,
          now.getFullYear(),
          now.getMonth() + 1
        );

        // Kelompokkan per user
        const userMap = {};
        records.forEach((record) => {
          const username = record.user_name.toLowerCase();
          if (!userMap[username]) {
            userMap[username] = [];
          }
          userMap[username].push(record);
        });

        const reportData = [];
        const workingDays = calculateWorkingDays(
          now.getFullYear(),
          now.getMonth()
        );

        for (const user of allUsers) {
          const usernameClean = user.username.toLowerCase();
          const userRecords = userMap[usernameClean] || [];

          if (userRecords.length === 0) {
            reportData.push({
              nama: user.nama,
              posisi:
                entityType === "WBS"
                  ? `${user.posisi} - ${user.unit}`
                  : `${user.status} - ${user.unit}`,
              presentDays: 0,
              absentDays: workingDays,
              percentage: 0,
              evaluation: "Poor ❌",
            });
          } else {
            const result = calculateAttendancePercentage(
              userRecords,
              now.getFullYear(),
              now.getMonth()
            );

            reportData.push({
              nama: user.nama,
              posisi:
                entityType === "WBS"
                  ? `${user.posisi} - ${user.unit}`
                  : `${user.status} - ${user.unit}`,
              presentDays: result.presentDays,
              absentDays: result.absentDays,
              percentage: result.percentage,
              evaluation: result.evaluation,
            });
          }
        }

        // Urutkan berdasarkan nama
        reportData.sort((a, b) => a.nama.localeCompare(b.nama));

        // Tulis ke sheet dan generate gambar
        await googleSheetsService.writePercentageReport(reportData);
        await generatePercentageReportImage(bot, process.env.GROUP_CHAT_ID, {
          message_thread_id: getEntityByType(entityType).topicId,
        });
      }
    } catch (error) {
      console.error("Error in scheduled reports:", error);
    }
  };

  // Jadwalkan tiap hari jam 17:00 WIB
  const scheduleReport = () => {
    const now = new Date();
    const target = new Date(now);

    // Set jam 17:00 WIB (UTC+7)
    target.setUTCHours(10, 0, 0, 0);

    if (now > target) {
      target.setDate(target.getDate() + 1);
    }

    const timeout = target - now;
    setTimeout(() => {
      sendScheduledReports();
      setInterval(sendScheduledReports, 24 * 60 * 60 * 1000); // Setiap 24 jam
    }, timeout);
  };

  // Mulai penjadwalan
  scheduleReport();
};
