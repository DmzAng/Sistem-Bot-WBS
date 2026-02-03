const { getEntityByType } = require("../services/telegramBotService");
const dbService = require("../services/dbService");

module.exports = (bot, userStates) => {
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `
👋 *Selamat datang di Bot Absensi WBS!*

Sebelum melakukan absen, silakan daftar terlebih dahulu:

📝 *Daftar* – Untuk semua jenis pengguna
   👉 Gunakan perintah: /register

📋 *Visiting Planing* – Rencanakan visiting ke klien
   👉 Membuat Rencana: /buatvisiting 
   👉 Menjalankan Rencana: /pilihvisiting 

_📌 Pastikan Anda sudah memiliki username Telegram sebelum mendaftar._
    `;

    bot.sendMessage(chatId, welcomeMessage, {
      parse_mode: "Markdown",
    });
  });

  bot.onText(/\/register/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;

    if (!username) {
      return bot.sendMessage(
        chatId,
        "❌ Anda harus memiliki username Telegram untuk mendaftar"
      );
    }

    try {
      const existing = await dbService.getUserByUsername(username);
      if (existing) {
        return bot.sendMessage(
          chatId,
          `❌ Username @${username} sudah terdaftar!`
        );
      }

      userStates[chatId] = {
        registration: {
          step: 1,
          data: {},
        },
      };

      bot.sendMessage(chatId, "👤 Pilih jenis pengguna:", {
        reply_markup: {
          keyboard: [["Karyawan", "Magang"]],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      });
    } catch (error) {
      console.error(error);
      bot.sendMessage(chatId, "❌ Gagal memproses pendaftaran");
    }
  });

  // Handle Input Pendaftaran
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    if (!msg.text) return;
    const text = msg.text;
    const state = userStates[chatId]?.registration;
    const user = msg.from.username || "tidak_ada_username";

    if (!state) return;

    // Step 1: Pilih jenis pengguna (Karyawan/Magang)
    if (state.step === 1) {
      if (!["Karyawan", "Magang"].includes(text)) {
        return bot.sendMessage(
          chatId,
          "❌ Pilihan tidak valid! Silakan pilih Karyawan atau Magang."
        );
      }

      state.data.userType = text;

      if (text === "Magang") {
        state.entityType = "MAGANG";
        state.step = 2;
        bot.sendMessage(chatId, "📝 Silakan masukkan Nama Lengkap Anda:");
      } else {
        // Karyawan
        state.step = 2;
        bot.sendMessage(chatId, "📝 Silakan masukkan Nama Lengkap Anda:");
      }
      return;
    }

    // Step 2: Input nama lengkap (untuk semua jenis)
    if (state.step === 2) {
      state.data.nama = text;

      if (state.data.userType === "Magang") {
        state.step = 3;
        bot.sendMessage(chatId, "📌 Pilih Status:", {
          reply_markup: {
            keyboard: [["PKL", "Magang"]],
            one_time_keyboard: true,
          },
        });
      } else {
        // Karyawan
        state.step = 3;
        bot.sendMessage(chatId, "💼 Pilih Posisi:", {
          reply_markup: {
            keyboard: [["Account Representative", "Sales Assistant", "Lainnya"]],
            one_time_keyboard: true,
            resize_keyboard: true,
          },
        });
      }
      return;
    }

    // PROSES MAGANG
    if (state.data.userType === "Magang") {
      switch (state.step) {
        case 3: // Status (PKL/Magang)
          if (!["PKL", "Magang"].includes(text)) {
            return bot.sendMessage(chatId, "❌ Pilihan tidak valid!");
          }
          state.data.status = text;
          state.step = 4;
          bot.sendMessage(chatId, "🏫 Masukkan Asal Sekolah/Universitas:");
          break;

        case 4: // Asal sekolah/universitas
          state.data.asal = text;
          state.step = 5;
          const magangEntity = getEntityByType("MAGANG");
          bot.sendMessage(chatId, "🏢 Pilih Unit Penempatan:", {
            reply_markup: {
              keyboard: [magangEntity.unitOptions],
              one_time_keyboard: true,
            },
          });
          break;

        case 5: // Unit penempatan
          state.data.unit = text;
          state.data.username = user;

          // Simpan ke database
          await dbService.createUser({
            username: user,
            nama: state.data.nama,
            entity_type: "MAGANG",
            posisi: "",
            status: state.data.status,
            asal: state.data.asal,
            unit: state.data.unit,
          });

          delete userStates[chatId];
          console.log(
            `✅ Pendaftaran Magang atas nama ${state.data.nama} berhasil!`
          );
          bot.sendMessage(
            chatId,
            "✅ Pendaftaran Magang berhasil!\n\nAnda sekarang dapat menggunakan fitur absensi."
          );
          break;
      }
    }

    // PROSES KARYAWAN
    if (state.data.userType === "Karyawan") {
      switch (state.step) {
        case 3: // Pilih posisi (AR/SA/Lainnya)
          if (
            !["Account Representative", "Sales Assistant", "Lainnya"].includes(
              text
            )
          ) {
            return bot.sendMessage(chatId, "❌ Pilihan tidak valid!");
          }

          if (text === "Account Representative") {
            state.entityType = "AR";
            state.data.posisi = "Account Representative";
            state.data.unit = getEntityByType("AR").unit;
          } else if (text === "Sales Assistant") {
            state.entityType = "SA";
            state.data.posisi = "Sales Assistant";
            state.data.unit = getEntityByType("SA").unit;
          } else {
            state.entityType = "WBS";
            state.step = 4; // Lanjut ke input posisi manual
            bot.sendMessage(chatId, "💼 Masukkan Posisi/Jabatan Anda:");
            return;
          }

          // Simpan langsung untuk AR/SA
          state.data.username = user;
          await dbService.createUser({
            username: user,
            nama: state.data.nama,
            entity_type: state.entityType,
            posisi: state.data.posisi,
            status: "",
            asal: "",
            unit: state.data.unit,
          });

          delete userStates[chatId];
          const entityName =
            state.entityType === "AR"
              ? "Account Representative"
              : "Sales Assistant";
          bot.sendMessage(
            chatId,
            `✅ Pendaftaran ${entityName} berhasil!\n\nAnda sekarang dapat menggunakan fitur perencaan kunjungan.`
          );
          break;

        case 4: // Input posisi manual untuk WBS
          state.data.posisi = text;
          state.data.unit = getEntityByType("WBS").unit;
          state.data.username = user;

          // Simpan ke database
          await dbService.createUser({
            username: user,
            nama: state.data.nama,
            entity_type: "WBS",
            posisi: state.data.posisi,
            status: "",
            asal: "",
            unit: state.data.unit,
          });

          delete userStates[chatId];
          bot.sendMessage(
            chatId,
            "✅ Pendaftaran WBS berhasil!\n\nAnda sekarang dapat menggunakan fitur absensi."
          );
          break;
      }
    }
  });
};
