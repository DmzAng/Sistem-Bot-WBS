const { downloadPDF, convertPDFToImages } = require("../services/pdfService");
const fs = require("fs");
const fetch = require("node-fetch");
const dbService = require("../services/dbService");

module.exports = (bot) => {
  bot.onText(/\/rekap(?:\s(\w+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const entityType = match[1] ? match[1].toUpperCase() : null;

    if (!entityType || !["MAGANG", "WBS"].includes(entityType)) {
      return bot.sendMessage(
        chatId,
        "⚠️ Format salah. Gunakan /rekap <jenis>\nContoh: /rekap magang\nJenis yang valid: magang, wbs"
      );
    }

    try {
      // Kirim pesan loading
      const loadingMessage = await bot.sendMessage(
        chatId,
        "🔄 Sedang membuat rekap..."
      );

      // Pertama, pastikan data sudah dikirim ke Google Sheets
      await sendDataToSheets(entityType);

      // Kemudian panggil AppScript
      const response = await fetch(
        `${process.env.APPSCRIPT_URL}?sheet=${entityType.toLowerCase()}`
      );
      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = JSON.parse(responseText);
      if (!data.fileUrl) {
        throw new Error(data.error || "URL PDF tidak valid dari AppScript");
      }

      const pdfPath = await downloadPDF(
        data.fileUrl,
        `rekap_${entityType}_${Date.now()}.pdf`
      );
      const imagePaths = await convertPDFToImages(pdfPath);

      const topicId = process.env[`REKAP_${entityType}_TOPIC_ID`];
      for (const imgPath of imagePaths) {
        await bot.sendPhoto(process.env.GROUP_CHAT_ID, imgPath, {
          message_thread_id: topicId,
        });
      }

      fs.unlinkSync(pdfPath);
      imagePaths.forEach((img) => fs.unlinkSync(img));

      // Hapus pesan loading
      await bot.deleteMessage(chatId, loadingMessage.message_id);
    } catch (error) {
      console.error(error);
      bot.sendMessage(chatId, `❌ Gagal membuat rekap: ${error.message}`);
    }
  });
};

// Fungsi untuk mengirim data ke Google Sheets
async function sendDataToSheets(entityType) {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();

    // Dapatkan data absen hari ini dari database
    const records = await dbService.getDailyAttendanceForEntity(
      entityType,
      year,
      month,
      day
    );

    if (records.length === 0) {
      throw new Error("Tidak ada data absen hari ini di database");
    }

    // Format data untuk dikirim ke Google Sheets
    const rowData = records.map((record) => {
      const tanggal = `${String(day).padStart(2, "0")}/${String(month).padStart(
        2,
        "0"
      )}/${year}`;

      if (entityType === "MAGANG") {
        return [
          tanggal,
          record.nama,
          record.status || "-",
          record.asal || "-",
          record.unit,
          record.status_kehadiran,
        ];
      } else {
        // WBS
        return [
          tanggal,
          record.nama,
          record.posisi || "-",
          record.unit,
          record.status_kehadiran,
          record.keterangan || "-",
        ];
      }
    });

    // Kirim ke Google Sheets
    const googleSheetsService = require("../services/googleSheetsService");
    await googleSheetsService.bulkSaveToSendRekap(
      entityType === "MAGANG" ? "SendRekapMagang" : "SendRekapWBS",
      rowData
    );

    console.log(
      `✅ Data berhasil dikirim ke Google Sheets: ${rowData.length} records`
    );
  } catch (error) {
    console.error("Error sending data to sheets:", error);
    throw error;
  }
}
