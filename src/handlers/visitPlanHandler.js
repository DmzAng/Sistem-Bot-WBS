const dbService = require("../services/dbService");
const {
  optimizeRouteWithBruteForce,
  calculateDistance,
} = require("../services/routeOptimizer");

const escapeMarkdown = (text) => {
  return text.replace(/([\_*\[\]\(\)~\`>\#\+\-=\|{}\.!])/g, "\\$1");
};

module.exports = (bot, stateManager) => {
  // Command untuk memulai pembuatan rencana
  bot.onText(/\/buatrencana/, (msg) => {
    const chatId = msg.chat.id;
    stateManager.setState(chatId, {
      creatingPlan: true,
      step: "awaiting_count",
      plan: {
        user_location: null,
        visit_locations: [],
      },
    });
    bot.sendMessage(
      chatId,
      "📝 Masukkan jumlah LOKASI KUNJUNGAN yang akan dikunjungi (minimal 1):"
    );
  });

  // Handler untuk pesan teks selama proses pembuatan rencana
  bot.on("message", async (msg) => {
    if (!msg.text) return;
    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const state = stateManager.getState(chatId);

    if (!state || !state.creatingPlan) return;

    // Step: Menunggu jumlah lokasi kunjungan
    if (state.step === "awaiting_count") {
      const count = parseInt(text);
      if (isNaN(count) || count < 1) {
        return bot.sendMessage(
          chatId,
          "❌ Jumlah tidak valid. Minimal 1 lokasi kunjungan. Silakan ulangi."
        );
      }

      // Update state
      state.plan.visit_count = count;
      state.step = "awaiting_current_location";
      stateManager.setState(chatId, state);

      bot.sendMessage(
        chatId,
        "📍 Silakan kirim LOKASI AWAL/SAAT INI Anda (gunakan fitur lokasi Telegram) sebagai titik mulai."
      );
    }
    // Step: Menunggu nama lokasi kunjungan
    else if (state.step.startsWith("awaiting_visit_name_")) {
      const visitIndex = parseInt(state.step.split("_")[3]);

      // Simpan nama untuk lokasi kunjungan
      state.plan.visit_locations.push({
        name: text,
        coordinates: null,
      });

      state.step = `awaiting_visit_location_${visitIndex}`;
      stateManager.setState(chatId, state);

      bot.sendMessage(
        chatId,
        `📍 Silakan kirim lokasi "${text}" 
(gunakan fitur lokasi).`
      );
    }
    // Jika user mengirim pesan di luar konteks selama proses
    else if (state.step !== "complete") {
      // Beri petunjuk berdasarkan step saat ini
      if (state.step === "awaiting_current_location") {
        bot.sendMessage(
          chatId,
          "📍 Silakan kirim lokasi Anda saat ini menggunakan fitur lokasi Telegram."
        );
      } else if (state.step.startsWith("awaiting_visit_location_")) {
        const visitIndex = parseInt(state.step.split("_")[3]);
        const locationName = state.plan.visit_locations[visitIndex - 1].name;
        bot.sendMessage(
          chatId,
          `📍 Silakan kirim lokasi untuk "${locationName}" menggunakan fitur lokasi Telegram.`
        );
      }
    }
  });

  // Handler untuk lokasi selama pembuatan rencana
  bot.on("location", async (msg) => {
    const chatId = msg.chat.id;
    const locationMsg = msg.location;
    const state = stateManager.getState(chatId);

    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();
    const formattedDate = `${year}-${month}-${day}`;

    if (!state || !state.creatingPlan) return;

    // Jika sedang menunggu lokasi saat ini (titik awal)
    if (state.step === "awaiting_current_location") {
      // Simpan lokasi user
      state.plan.user_location = {
        lat: locationMsg.latitude,
        lon: locationMsg.longitude,
      };
      state.step = "awaiting_visit_name_1";
      stateManager.setState(chatId, state);

      bot.sendMessage(
        chatId,
        "✅ Lokasi awal tersimpan. Sekarang masukkan nama untuk LOKASI KUNJUNGAN ke-1:"
      );
    }
    // Jika sedang menunggu lokasi kunjungan
    else if (state.step.startsWith("awaiting_visit_location_")) {
      const visitIndex = parseInt(state.step.split("_")[3]);

      // Update lokasi kunjungan
      state.plan.visit_locations[visitIndex - 1].coordinates = {
        lat: locationMsg.latitude,
        lon: locationMsg.longitude,
      };

      // Jika masih ada lokasi kunjungan berikutnya
      if (visitIndex < state.plan.visit_count) {
        state.step = `awaiting_visit_name_${visitIndex + 1}`;
        stateManager.setState(chatId, state);
        bot.sendMessage(
          chatId,
          `✅ Lokasi kunjungan ke-${visitIndex} tersimpan. Masukkan nama untuk LOKASI KUNJUNGAN ke-${
            visitIndex + 1
          }:`
        );
      } else {
        // Semua lokasi terkumpul
        state.step = "complete";
        stateManager.setState(chatId, state);

        // Simpan rencana ke database
        try {
          const user = await dbService.getUserByUsername(msg.from.username);
          if (!user) throw new Error("User tidak ditemukan");

          // Gabungkan lokasi user dan lokasi kunjungan untuk optimasi rute
          const allLocations = [
            {
              ...state.plan.user_location,
              name: "Lokasi Awal",
              is_start: true,
              is_visit: false,
            },
            ...state.plan.visit_locations.map((loc) => ({
              ...loc.coordinates,
              name: loc.name,
              is_start: false,
              is_visit: true,
            })),
          ];

          // Kirim pesan sedang memproses
          const processingMsg = await bot.sendMessage(
            chatId,
            "🔄 Menghitung rute optimal berdasarkan jalan..."
          );

          let optimized;
          try {
            // Coba hitung dengan rute jalan
            optimized = await optimizeRouteWithBruteForce(allLocations, true);
          } catch (error) {
            console.error("Error dalam optimasi rute jalan:", error);
            // Fallback ke perhitungan garis lurus
            await bot.editMessageText(
              "⚠️ Tidak dapat menghitung rute jalan, menggunakan perhitungan garis lurus...",
              {
                chat_id: chatId,
                message_id: processingMsg.message_id,
              }
            );
            optimized = await optimizeRouteWithBruteForce(allLocations, false);
          }

          // Hapus pesan processing
          await bot.deleteMessage(chatId, processingMsg.message_id);

          // Simpan rencana ke database
          const planId = await dbService.savePlan({
            user_name: user.username,
            nama: user.nama,
            user_location: state.plan.user_location,
            locations: state.plan.visit_locations.map((loc) => ({
              name: loc.name,
              lat: loc.coordinates.lat,
              lon: loc.coordinates.lon,
            })),
            optimized_route: optimized.route.filter((loc) => !loc.is_start),
            status: "DRAFT",
          });

          let response = escapeMarkdown("✅ RENCANA KUNJUNGAN TERSIMPAN!");
          response +=
            escapeMarkdown("Tanggal Rencana: ") +
            ` ${escapeMarkdown(`${formattedDate}`)}\n`;
          response +=
            escapeMarkdown("Jumlah Kunjungan:") +
            ` ${escapeMarkdown(String(state.plan.visit_count))}\n`;
          response += escapeMarkdown("*Rute Optimal Kunjungan:*") + "\n";

          optimized.route
            .filter((loc) => !loc.is_start)
            .forEach((loc, index) => {
              response += escapeMarkdown(`${index + 1}. ${loc.name}`) + "\n";
            });

          response += `\n${escapeMarkdown("Total Jarak:")} ${escapeMarkdown(
            (optimized.distance / 1000).toFixed(2)
          )} ${escapeMarkdown("km")}\n`;
          response += escapeMarkdown(
            "Ketik /pilihkunjungan untuk memulai kunjungan."
          );

          bot.sendMessage(chatId, response, { parse_mode: "MarkdownV2" });
          stateManager.deleteState(chatId);
        } catch (error) {
          console.error("Error saat menyimpan rencana:", error);
          bot.sendMessage(
            chatId,
            `❌ Gagal menyimpan rencana: ${error.message}`
          );
        }
      }
    }
  });
};