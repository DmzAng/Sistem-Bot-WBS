const dbService = require("../services/dbService");

module.exports = (bot, userStates) => {
  // Handler /todo
  bot.onText(/\/todo/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;

    if (!username) {
      return bot.sendMessage(
        chatId,
        "❌ Anda harus memiliki username Telegram"
      );
    }

    userStates[chatId] = { waitingForTodo: true };
    bot.sendMessage(
      chatId,
      "📝 Masukkan list kegiatan (pisahkan dengan enter):",
      {
        reply_markup: { force_reply: true },
      }
    );
  });

  // Handler input todo
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    if (!userStates[chatId]?.waitingForTodo) return;

    const username = msg.from.username;
    const items = msg.text.split("\n").filter((item) => item.trim());

    if (!items.length) {
      return bot.sendMessage(chatId, "❌ Tidak ada kegiatan yang dimasukkan");
    }

    try {
      const user = await dbService.getUserByUsername(username);
      if (!user) {
        throw new Error("User tidak ditemukan");
      }

      const today = new Date().toISOString().split("T")[0];
      await dbService.saveTodoItems(user.username, user.nama, items, today);
      bot.sendMessage(chatId, `✅ ${items.length} kegiatan ditambahkan!`);
    } catch (error) {
      console.error(error);
      bot.sendMessage(chatId, "❌ Gagal menyimpan todo");
    }

    delete userStates[chatId];
  });

  // Handler /finishtodo
  bot.onText(/\/finishtodo/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;

    try {
      const user = await dbService.getUserByUsername(username);
      if (!user) {
        throw new Error("User tidak ditemukan");
      }

      const today = new Date().toISOString().split("T")[0];
      const todos = await dbService.getPendingTodos(
        user.username,
        today
      );

      if (!todos.length) {
        const uncompleted = await dbService.getAllUncompletedTodos(user.username);
        if (uncompleted.length > 0) {
          return bot.sendMessage(
            chatId,
            `📂 Anda memiliki ${uncompleted.length} tugas belum selesai dari hari sebelumnya.\nGunakan /histori untuk melihat daftar lengkap.`
          );
        }
        return bot.sendMessage(chatId, "🎉 Semua tugas sudah selesai!");
      }

      const keyboard = todos.map((todo) => [
        {
          text: `${todo.id}. ${todo.kegiatan}`,
          callback_data: `complete_${todo.id}`,
        },
      ]);

      bot.sendMessage(chatId, "📋 Pilih tugas yang selesai:", {
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (error) {
      console.error(error);
      bot.sendMessage(chatId, "❌ Gagal mengambil todo");
    }
  });

  bot.onText(/\/histori/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;

    try {
      const user = await dbService.getUserByUsername(username);
      if (!user) {
        throw new Error("User tidak ditemukan");
      }

      const uncompleted = await dbService.getAllUncompletedTodos(user.username);
      if (!uncompleted.length) {
        return bot.sendMessage(
          chatId,
          "📭 Tidak ada histori tugas yang belum selesai"
        );
      }

      const message = `📚 Histori Tugas Belum Selesai:\n${uncompleted
        .map((item, i) => `${i + 1}. ${item}`)
        .join("\n")}`;
      bot.sendMessage(chatId, message);
    } catch (error) {
      console.error(error);
      bot.sendMessage(chatId, "❌ Gagal mengambil histori");
    }
  });

  // Handler callback query
  bot.on("callback_query", async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const username = callbackQuery.from.username;

    if (data.startsWith("complete_")) {
      const todoId = parseInt(data.split("_")[1]);

      try {
        await dbService.markTodoAsDone(todoId);
        bot.answerCallbackQuery(callbackQuery.id, {
          text: "✅ Tugas selesai!",
        });

        bot.editMessageText("✔️ Tugas berhasil ditandai selesai!", {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
        });
      } catch (error) {
        console.error(error);
        bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ Gagal menandai tugas",
        });
      }
    }
  });
};
