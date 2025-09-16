const dbService = require("../services/dbService");
const {
  optimizeRouteWithBruteForce,
  calculateDistance,
  getDrivingRoute,
  getRouteInstructions,
  getBestRoute,
  hasOneWayViolation,
} = require("../services/routeOptimizer");

const escapeMarkdown = (text) => {
  if (typeof text !== "string") {
    console.error("escapeMarkdown received non-string:", text);
    return String(text);
  }
  return text.replace(/([\_*\[\]\(\)~\`>\#\+\-=\|{}\.!])/g, "\\$1");
};
 
const isWithinRadius = (lat1, lon1, lat2, lon2, radiusMeters = 50) => {
  const distance = calculateDistance(
    { lat: lat1, lon: lon1 },
    { lat: lat2, lon: lon2 }
  );
  return distance <= radiusMeters;
};

module.exports = (bot, stateManager) => {
  // Command untuk memilih kunjungan
  bot.onText(/\/pilihkunjungan/, async (msg) => {
    const chatId = msg.chat.id;
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();
    const formattedDate = `${year}-${month}-${day}`;

    try {
      const user = await dbService.getUserByUsername(msg.from.username);
      if (!user) {
        return bot.sendMessage(chatId, "❌ User tidak ditemukan.");
      }

      // Dapatkan rencana kunjungan hari ini
      const todayPlans = await dbService.getTodayPlans(user.username);

      if (todayPlans.length === 0) {
        return bot.sendMessage(
          chatId,
          "📋 Tidak ada rencana kunjungan untuk hari ini. Buat rencana baru dengan /buatrencana."
        );
      }

      todayPlans.sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      );

      const options = {
        reply_markup: {
          inline_keyboard: todayPlans.map((plan, index) => [
            {
              text: `Rencana ${index + 1} - ${plan.location_count} lokasi`,
              callback_data: `select_plan_${plan.id}_${index}`,
            },
          ]),
        },
      };

      let message = escapeMarkdown("📋 PILIH RENCANA KUNJUNGAN:") + "\n";
      todayPlans.forEach((plan, index) => {
        message += escapeMarkdown(`Rencana ${index + 1}:`) + "\n";
        message += escapeMarkdown("Tanggal: " + formattedDate) + "\n";
        message +=
          escapeMarkdown("Jumlah Lokasi: " + plan.location_count) + "\n";
        message += escapeMarkdown("Status: " + plan.status) + "\n\n";
      });

      // Perbaikan: Simpan hasil sendMessage ke variabel
      const sentMessage = await bot.sendMessage(chatId, message, {
        parse_mode: "MarkdownV2",
        reply_markup: options.reply_markup,
      });

      stateManager.setState(chatId, {
        ...stateManager.getState(chatId),
        planSelectionMessageId: sentMessage.message_id,
      });
    } catch (error) {
      console.error("Error mendapatkan rencana:", error);
      bot.sendMessage(chatId, "❌ Gagal mengambil daftar rencana.");
    }
  });

  // Handler untuk callback query (pemilihan rencana)
  bot.on("callback_query", async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;

    const state = stateManager.getState(chatId);

    // Perbaikan: Handle error saat menghapus keyboard
    if (state && state.planSelectionMessageId) {
      try {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          {
            chat_id: chatId,
            message_id: state.planSelectionMessageId,
          }
        );
      } catch (error) {
        if (
          !error.response.body.description.includes("message is not modified")
        ) {
          console.error("Error menghapus keyboard:", error);
        }
      }
    }

    if (data.startsWith("select_plan_")) {
      const parts = data.split("_");
      const planId = parts[2];
      const planIndex = parseInt(parts[3]) + 1;

      try {
        const plan = await dbService.getPlan(planId);
        if (!plan) {
          return bot.answerCallbackQuery(callbackQuery.id, {
            text: "Rencana tidak ditemukan.",
          });
        }

        // Periksa apakah rencana sudah lewat harinya
        const planDate = new Date(plan.tanggal);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        planDate.setHours(0, 0, 0, 0);

        if (planDate < today) {
          return bot.answerCallbackQuery(callbackQuery.id, {
            text: "Rencana ini sudah lewat harinya. Buat rencana baru.",
          });
        }

        // Dapatkan daftar kunjungan yang sudah dikerjakan
        const completedVisits = await dbService.getCompletedVisits(planId);
        const remainingVisits = plan.optimized_route.filter(
          (_, index) => !completedVisits.includes(index)
        );

        if (remainingVisits.length === 0) {
          await dbService.updatePlanStatus(planId, "COMPLETED");
          return bot.answerCallbackQuery(callbackQuery.id, {
            text: "Semua kunjungan dalam rencana ini sudah selesai.",
          });
        }

        // Tampilkan pilihan lokasi kunjungan yang tersisa
        const options = {
          reply_markup: {
            inline_keyboard: remainingVisits.map((loc, index) => [
              {
                text: loc.name,
                callback_data: `start_visit_${planId}_${index}`,
              },
            ]),
          },
        };

        let message = escapeMarkdown("📍 PILIH LOKASI AWAL KUNJUNGAN:") + "\n";
        remainingVisits.forEach((loc, index) => {
          message += escapeMarkdown(`${index + 1}. ${loc.name}`) + "\n";
        });

        // Simpan message_id untuk lokasi selection
        const locationSelectionMsg = await bot.sendMessage(chatId, message, {
          parse_mode: "MarkdownV2",
          reply_markup: options.reply_markup,
        });

        // Simpan message_id ke state
        stateManager.setState(chatId, {
          ...state,
          locationSelectionMessageId: locationSelectionMsg.message_id,
        });

        bot.answerCallbackQuery(callbackQuery.id, {
          text: "Silakan pilih lokasi awal kunjungan.",
        });
      } catch (error) {
        console.error("Error saat memilih rencana:", error);
        bot.answerCallbackQuery(callbackQuery.id, {
          text: "Gagal memuat rencana.",
        });
      }
    }
    // Handler untuk memilih lokasi awal kunjungan
    // Handler untuk memilih lokasi awal kunjungan
    else if (data.startsWith("start_visit_")) {
      const parts = data.split("_");
      const planId = parts[2];
      const startIndex = parseInt(parts[3]);

      try {
        // Hapus inline keyboard untuk pemilihan lokasi
        const currentState = stateManager.getState(chatId);
        if (currentState && currentState.locationSelectionMessageId) {
          try {
            await bot.editMessageReplyMarkup(
              { inline_keyboard: [] },
              {
                chat_id: chatId,
                message_id: currentState.locationSelectionMessageId,
              }
            );
          } catch (error) {
            console.error("Error menghapus keyboard:", error);
          }
        }

        const plan = await dbService.getPlan(planId);
        if (!plan) {
          return bot.answerCallbackQuery(callbackQuery.id, {
            text: "Rencana tidak ditemukan.",
          });
        }

        const completedVisits = await dbService.getCompletedVisits(planId);
        let remainingVisits = plan.optimized_route.filter(
          (_, index) => !completedVisits.includes(index)
        );

        if (startIndex > 0) {
          const selectedLocation = remainingVisits[startIndex];
          remainingVisits.splice(startIndex, 1);

          const locationsForOptimization = [
            {
              lat: selectedLocation.lat,
              lon: selectedLocation.lon,
              name: selectedLocation.name,
              is_start: true,
              is_visit: false,
            },
            ...remainingVisits.map((loc) => ({
              lat: loc.lat,
              lon: loc.lon,
              name: loc.name,
              is_start: false,
              is_visit: true,
            })),
          ];

          // Kirim pesan sedang memproses
          const processingMsg = await bot.sendMessage(
            chatId,
            "🔄 Menghitung rute optimal yang menghindari jalan satu arah..."
          );

          let optimizedRemaining;
          try {
            // Gunakan opsi untuk menghindari jalan one-way
            optimizedRemaining = await optimizeRouteWithBruteForce(
              locationsForOptimization,
              true,
              { avoidOneWay: true } // Tambahkan opsi ini
            );
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
            optimizedRemaining = await optimizeRouteWithBruteForce(
              locationsForOptimization,
              false
            );
          }

          // Hapus pesan processing
          await bot.deleteMessage(chatId, processingMsg.message_id);

          remainingVisits = optimizedRemaining.route.filter(
            (loc) => !loc.is_start
          );

          // Tambahkan lokasi yang dipilih di awal
          remainingVisits.unshift(selectedLocation);
        }

        // Set state eksekusi
        stateManager.setState(chatId, {
          executingPlan: true,
          planId: plan.id,
          remainingVisits: remainingVisits.map((loc, idx) => ({
            ...loc,
            originalIndex: plan.optimized_route.findIndex(
              (item) => item.name === loc.name
            ),
          })),
          currentVisitIndex: 0,
          currentLocation: plan.user_location,
        });

        bot.answerCallbackQuery(callbackQuery.id, {
          text: "Lokasi awal dipilih. Menghitung rute...",
        });

        // Langsung berikan rekomendasi rute tanpa meminta lokasi user
        const currentVisit = remainingVisits[0];

        // Dapatkan rute dari lokasi user ke lokasi kunjungan
        const userLocation = plan.user_location;
        const targetLocation = {
          lat: currentVisit.lat,
          lon: currentVisit.lon,
        };

        // Kirim pesan sedang memproses
        const processingMsg = await bot.sendMessage(
          chatId,
          "🔄 Menganalisis rute terbaik..."
        );

        try {
          const routeInfo = await getBestRoute(userLocation, targetLocation, {
            avoidTolls: false,
            avoidHighways: false,
            preferShortest: false,
          });

          // Dapatkan petunjuk rute dengan await yang benar
          const routeInstructions = await getRouteInstructions(routeInfo.steps);

          await bot.deleteMessage(chatId, processingMsg.message_id);

          // Format pesan dengan rekomendasi rute
          const distanceKm = (routeInfo.distance / 1000).toFixed(1);
          const durationMin = Math.ceil(routeInfo.duration / 60);

          let message = escapeMarkdown("🚀 MEMULAI KUNJUNGAN") + "\n";
          message +=
            escapeMarkdown("Rencana:") + ` ${escapeMarkdown(`#${plan.id}`)}\n`;
          message +=
            escapeMarkdown("Lokasi:") +
            ` *${escapeMarkdown(currentVisit.name)}*\n\n`;
          message += escapeMarkdown("📊 INFO RUTE:") + "\n";
          message +=
            escapeMarkdown("Jarak:") + ` ${escapeMarkdown(distanceKm)} km\n`;
          message +=
            escapeMarkdown("Perkiraan Waktu:") +
            ` ${escapeMarkdown(String(durationMin))} menit\n\n`;
          message += escapeMarkdown("📍 PETUNJUK RUTE:") + "\n";
          message += escapeMarkdown(routeInstructions) + "\n";
          message += escapeMarkdown(
            "Silakan menuju ke lokasi tersebut. Setelah sampai, kirim lokasi dan foto sebagai bukti."
          );

          await bot.sendMessage(chatId, message, { parse_mode: "MarkdownV2" });
        } catch (error) {
          console.error("Error mendapatkan rute:", error);
          await bot.deleteMessage(chatId, processingMsg.message_id);
          await bot.sendMessage(
            chatId,
            "❌ Gagal mendapatkan rute. Silakan coba lagi."
          );
        }
      } catch (error) {
        console.error("Error saat memilih lokasi awal:", error);
        bot.answerCallbackQuery(callbackQuery.id, {
          text: "Gagal memulai kunjungan.",
        });
      }
    }
  });

  // Handler untuk lokasi selama eksekusi kunjungan
  bot.on("location", async (msg) => {
    const chatId = msg.chat.id;
    const locationMsg = msg.location;
    const state = stateManager.getState(chatId);

    if (!state || !state.executingPlan) return;

    const currentVisit = state.remainingVisits[state.currentVisitIndex];

    // Periksa apakah lokasi user dalam radius 100 meter dari lokasi kunjungan
    if (
      !isWithinRadius(
        locationMsg.latitude,
        locationMsg.longitude,
        currentVisit.lat,
        currentVisit.lon,
        100
      )
    ) {
      return bot.sendMessage(
        chatId,
        `❌ Anda berada di luar radius 100 meter dari ${currentVisit.name}.
Silakan menuju ke lokasi yang benar.`
      );
    }

    // Simpan lokasi kunjungan
    state.currentVisitLocation = {
      lat: locationMsg.latitude,
      lon: locationMsg.longitude,
    };
    stateManager.setState(chatId, state);

    bot.sendMessage(
      chatId,
      "📍 Lokasi valid." + "\n Sekarang kirim foto sebagai bukti kunjungan."
    );
  });

  // Handler untuk foto selama eksekusi kunjungan
  bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const state = stateManager.getState(chatId);
    const photo = msg.photo[msg.photo.length - 1]; // Foto dengan resolusi tertinggi

    if (!state || !state.executingPlan || !state.currentVisitLocation) return;

    try {
      const currentVisit = state.remainingVisits[state.currentVisitIndex];

      // Simpan eksekusi kunjungan
      await dbService.saveVisitExecution({
        plan_id: state.planId,
        tanggal: new Date(),
        user_name: msg.from.username,
        nama: `${msg.from.first_name} ${msg.from.last_name || ""}`,
        location_index: currentVisit.originalIndex,
        execution_time: new Date(),
        execution_photo: photo.file_id,
        execution_location: state.currentVisitLocation,
      });

      // Update state - gunakan lokasi kunjungan saat ini sebagai titik awal berikutnya
      const nextIndex = state.currentVisitIndex + 1;
      state.currentLocation = {
        lat: currentVisit.lat,
        lon: currentVisit.lon,
      };
      delete state.currentVisitLocation;

      // Jika masih ada kunjungan berikutnya
      if (nextIndex < state.remainingVisits.length) {
        state.currentVisitIndex = nextIndex;
        stateManager.setState(chatId, state);

        const nextVisit = state.remainingVisits[nextIndex];

        const routeInfo = await getBestRoute(
          state.currentLocation,
          {
            lat: nextVisit.lat,
            lon: nextVisit.lon,
          },
          {
            avoidTolls: false,
            avoidHighways: false,
            avoidOneWay: true,
            preferShortest: false,
          }
        );

        const routeInstructions = await getRouteInstructions(routeInfo.steps);
        const distanceKm = (routeInfo.distance / 1000).toFixed(1);
        const durationMin = Math.ceil(routeInfo.duration / 60);

        let message = escapeMarkdown("✅ Kunjungan berhasil dicatat.") + "\n";
        message +=
          escapeMarkdown("Lokasi berikutnya:") +
          ` *${escapeMarkdown(nextVisit.name)}*\n\n`;
        message += escapeMarkdown("📊 INFO RUTE:") + "\n";
        message +=
          escapeMarkdown("Jarak:") + ` ${escapeMarkdown(distanceKm)} km\n`;
        message +=
          escapeMarkdown("Perkiraan Waktu:") +
          ` ${escapeMarkdown(String(durationMin))} menit\n\n`;
        message += escapeMarkdown("📍 PETUNJuk RUTE:") + "\n";
        message += escapeMarkdown(routeInstructions) + "\n";
        message += escapeMarkdown("Silakan menuju ke lokasi berikutnya.");

        bot.sendMessage(chatId, message, { parse_mode: "MarkdownV2" });
      } else {
        // Semua kunjungan selesai
        await dbService.updatePlanStatus(state.planId, "COMPLETED");
        bot.sendMessage(
          chatId,
          "🎉 Selamat! Semua kunjungan dalam rencana ini telah selesai."
        );
        stateManager.deleteState(chatId);
      }
    } catch (error) {
      console.error("Error saat mencatat kunjungan:", error);
      bot.sendMessage(
        chatId,
        "❌ Gagal mencatat kunjungan. Silakan coba lagi."
      );
    }
  });
};
