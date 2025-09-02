const { getEntityByType } = require("../services/telegramBotService");
const fetch = require("node-fetch");
const { downloadPDF, convertPDFToImages } = require("../services/pdfService");
const fs = require("fs");
const dbService = require("../services/dbService");
const googleSheetsService = require("../services/googleSheetsService");

async function generateAndSendRekap(bot, entityType) {
  console.log(`🔄 generateAndSendRekap started for entityType=${entityType}`);
  try {
    const url = `${process.env.APPSCRIPT_URL}?sheet=${entityType}`;
    console.log(`🌐 Fetching PDF URL from AppScript: ${url}`);
    const response = await fetch(url);
    const responseText = await response.text();
    console.log(`📥 Response status=${response.status}, body=${responseText}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = JSON.parse(responseText);
    if (!data.fileUrl) {
      throw new Error(data.error || "URL PDF tidak valid dari AppScript");
    }

    console.log(`⬇️ Downloading PDF from ${data.fileUrl}`);
    const pdfPath = await downloadPDF(
      data.fileUrl,
      `rekap_${entityType}_${Date.now()}.pdf`
    );
    console.log(`💾 PDF saved to ${pdfPath}`);

    const imagePaths = await convertPDFToImages(pdfPath);
    console.log(`🖼️ Converted to images: ${imagePaths.join(", ")}`);

    const topicId = getEntityByType(entityType).topicId;
    console.log(
      `📌 Sending images to GROUP_CHAT_ID=${process.env.GROUP_CHAT_ID}, thread=${topicId}`
    );
    for (const imgPath of imagePaths) {
      await bot.sendPhoto(process.env.GROUP_CHAT_ID, imgPath, {
        message_thread_id: topicId,
      });
      console.log(`✅ Sent image ${imgPath}`);
    }

    fs.unlinkSync(pdfPath);
    imagePaths.forEach((img) => fs.unlinkSync(img));
    console.log("🧹 Cleaned up PDF and images");

    return true;
  } catch (error) {
    console.error("Error in generateAndSendRekap:", error);
    throw error;
  }
}

async function getLocationName(lat, lon) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`
    );
    const data = await response.json();

    const addressComponents = [];
    if (data.address.road) addressComponents.push(data.address.road);

    const city = data.address.city || data.address.town || data.address.village;
    if (city) addressComponents.push(city);

    if (data.address.state) addressComponents.push(data.address.state);
    if (data.address.postcode) addressComponents.push(data.address.postcode);
    if (data.address.country) addressComponents.push(data.address.country);

    return {
      city: city || "-",
      state: data.address.state || "-",
      country: data.address.country || "-",
      full_address: addressComponents.join(", ") || "Lokasi tidak dikenal",
    };
  } catch (error) {
    console.error("Error geocoding:", error);
    return null;
  }
}

async function sendDataToSheets(entityType) {
  try {
    // Dapatkan waktu dengan timezone Indonesia Tengah (WITA)
    const now = new Date();
    const offset = 8 * 60; // UTC+8 dalam menit
    const localTime = new Date(now.getTime() + offset * 60 * 1000);

    const year = localTime.getUTCFullYear();
    const month = localTime.getUTCMonth() + 1;
    const day = localTime.getUTCDate();

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

async function saveAttendanceData(bot, userStates, chatId, state) {
  console.log(`🔄 saveAttendanceData: chatId=${chatId}, state=`, state);
  try {
    const isSehat = state.healthStatus === "Sehat";
    console.log(`🩺 Health status=${state.healthStatus}, isSehat=${isSehat}`);

    if (isSehat) {
      if (!state.location || !state.photo) {
        throw new Error("Data lokasi atau foto tidak lengkap");
      }
    }

    const lokasiData = isSehat
      ? await getLocationName(state.location?.lat, state.location?.lon)
      : { full_address: "Tidak diperlukan" };
    console.log(`📍 Lokasi data resolved:`, lokasiData);

    // Dapatkan waktu dengan timezone Indonesia Tengah (WITA)
    const now = new Date();
    const offset = 8 * 60;
    const localTime = new Date(now.getTime() + offset * 60 * 1000);

    const day = String(localTime.getUTCDate()).padStart(2, "0");
    const month = String(localTime.getUTCMonth() + 1).padStart(2, "0");
    const year = localTime.getUTCFullYear();
    const formattedDate = `${year}-${month}-${day}`;
    const formattedTime = [
      localTime.getUTCHours(),
      localTime.getUTCMinutes(),
      localTime.getUTCSeconds(),
    ]
      .map((n) => String(n).padStart(2, "0"))
      .join(":");

    console.log(`⏰ Date=${formattedDate}, Time=${formattedTime}`);

    // Dapatkan user dari database
    const user = await dbService.getUserByUsername(state.student.username);
    if (!user) {
      throw new Error("User tidak ditemukan di database");
    }

    let statusKehadiran;
    if (isSehat) {
      if (state.entityType === "MAGANG") {
        // Untuk Magang, cek apakah sebelum jam 9 pagi WITA
        statusKehadiran = localTime.getUTCHours() < 1 ? "HADIR" : "TERLAMBAT";
      } else {
        statusKehadiran = "ONSITE";
      }
    } else {
      if (state.entityType === "MAGANG") {
        statusKehadiran = "TERLAMBAT";
      } else {
        statusKehadiran = "REMOTE";
      }
    }

    // Simpan ke database
    const attendanceData = {
      user_name: user.username,
      nama: user.nama,
      tanggal: formattedDate,
      waktu: formattedTime,
      status_kehadiran: statusKehadiran,
      status_kesehatan: state.healthStatus,
      foto: isSehat ? state.photo?.fileUrl || null : null,
      lokasi_lat: isSehat ? state.location?.lat || null : null,
      lokasi_lon: isSehat ? state.location?.lon || null : null,
      lokasi_alamat: lokasiData?.full_address || null,
      keterangan: state.keterangan || null,
    };

    await dbService.saveAttendance(state.entityType, attendanceData);
    console.log("✅ Attendance saved to database");

    await sendDataToSheets(state.entityType);

    // Buat caption untuk semua status kesehatan
    const caption = `📋 *LAPORAN ABSENSI* 📋
Nama : ${state.student.nama}
Posisi : ${state.student.posisi}
Status : ${state.healthStatus}
\`\`\`yaml
Tanggal: ${day}/${month}/${year}
Waktu: ${formattedTime}
Lokasi: ${lokasiData?.full_address || "Tidak terdeteksi"}
Status: ${statusKehadiran}
\`\`\``;

    console.log("📸 Sending attendance report to group");

    // Kirim ke grup untuk semua status kesehatan
    if (isSehat) {
      // Untuk status sehat, kirim foto yang diambil
      await bot.sendPhoto(process.env.GROUP_CHAT_ID, state.photo.fileId, {
        caption: caption,
        parse_mode: "MarkdownV2",
        message_thread_id:
          process.env[`REKAP_${state.entityType.toUpperCase()}_TOPIC_ID`],
      });
    } else {
      // Untuk status tidak sehat, kirim pesan teks saja
      await bot.sendMessage(process.env.GROUP_CHAT_ID, caption, {
        parse_mode: "MarkdownV2",
        message_thread_id:
          process.env[`REKAP_${state.entityType.toUpperCase()}_TOPIC_ID`],
      });
    }

    // Kirim konfirmasi ke user
    if (isSehat) {
      bot.sendMessage(
        chatId,
        `✅ Absensi berhasil!\nStatus: ${statusKehadiran}\nLokasi: ${
          lokasiData?.full_address || "Tidak terdeteksi"
        }`,
        {
          reply_markup: { remove_keyboard: true },
        }
      );
    } else {
      bot.sendMessage(
        chatId,
        `✅ Izin/sakit berhasil dicatat: ${state.keterangan}`,
        {
          reply_markup: { remove_keyboard: true },
        }
      );
    }

    delete userStates[chatId];

    generateAndSendRekap(bot, state.entityType).catch((error) =>
      console.error("Gagal mengirim rekap:", error)
    );
  } catch (error) {
    console.error("Error saveAttendanceData:", error);
    bot.sendMessage(
      chatId,
      `❌ Gagal menyimpan data absensi: ${error.message}`
    );
    delete userStates[chatId];
  }
}

module.exports = (bot, userStates) => {
  // Handler Absen
  bot.onText(/\/absen/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;

    if (!username) {
      return bot.sendMessage(
        chatId,
        "❌ Anda harus memiliki username Telegram untuk absen"
      );
    }

    try {
      // Cek di database
      const user = await dbService.getUserByUsername(username);
      if (!user) {
        return bot.sendMessage(
          chatId,
          "❌ Anda belum terdaftar. Silakan daftar dulu"
        );
      }

      // Dapatkan waktu dengan timezone Indonesia Tengah (WITA)
      const now = new Date();
      const offset = 8 * 60; // UTC+8 dalam menit
      const localTime = new Date(now.getTime() + offset * 60 * 1000);

      // Cek apakah sudah absen hari ini
      const hasCheckedIn = await dbService.getTodayAttendanceByUsername(
        user.username,
        user.entity_type
      );
      if (hasCheckedIn) {
        return bot.sendMessage(
          chatId,
          "❌ Anda sudah melakukan absen hari ini."
        );
      }

      userStates[chatId] = {
        step: 1,
        student: { ...user, username },
        entityType: user.entity_type,
        healthStatus: null,
        keterangan: null,
        status: localTime.getUTCHours() < 1 ? "HADIR" : "TERLAMBAT",
      };

      bot.sendMessage(chatId, "🩺 Pilih Status Kesehatan:", {
        reply_markup: {
          keyboard: [getEntityByType(user.entity_type).healthOptions],
          one_time_keyboard: true,
        },
      });
    } catch (error) {
      console.error(`[ABSEN] Error:`, error);
      bot.sendMessage(chatId, "❌ Gagal memproses absen");
    }
  });

  // Handle Input Absen
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    if (!msg.text) return;
    const text = msg.text;
    const state = userStates[chatId];

    if (!state || state.registration) return;

    switch (state.step) {
      case 1:
        if (!getEntityByType(state.entityType).healthOptions.includes(text)) {
          return bot.sendMessage(chatId, "❌ Pilihan tidak valid!");
        }

        state.healthStatus = text;
        if (text === "Sehat") {
          bot.sendMessage(
            chatId,
            `📸 Silakan:
1. Buka kamera Telegram
2. Aktifkan GPS
3. Ambil foto menggunakan kamera
4. Kirim foto tersebut`,
            {
              reply_markup: {
                force_reply: true,
                remove_keyboard: true,
              },
            }
          );
        } else {
          state.step = 2;
          bot.sendMessage(chatId, "📝 Mohon tulis keterangan Anda:");
        }
        break;

      case 2:
        if (state.healthStatus !== "Sehat") {
          state.keterangan = text;
          await saveAttendanceData(bot, userStates, chatId, state);
          delete userStates[chatId];
        }
        break;
    }
  });

  // Handle Foto untuk absen sehat
  bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const state = userStates[chatId];

    if (!state || state.registration || state.healthStatus !== "Sehat") return;

    try {
      // Dapatkan file_id dari foto yang dikirim
      const photo = msg.photo[msg.photo.length - 1];
      state.photo = {
        fileId: photo.file_id,
        fileUrl: await bot.getFileLink(photo.file_id),
      };

      // Dapatkan lokasi jika ada
      if (msg.location) {
        state.location = {
          lat: msg.location.latitude,
          lon: msg.location.longitude,
        };
      }

      // Simpan data absensi
      await saveAttendanceData(bot, userStates, chatId, state);
    } catch (error) {
      console.error("Error processing photo:", error);
      bot.sendMessage(chatId, "❌ Gagal memproses foto. Silakan coba lagi.");
    }
  });
};

module.exports.saveAttendanceData = saveAttendanceData;
module.exports.getLocationName = getLocationName;
