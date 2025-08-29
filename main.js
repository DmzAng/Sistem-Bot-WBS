require("dotenv").config();
const { createBot } = require("./src/services/telegramBotService");
const StateManager = require("./stateManager");
const registrationHandler = require("./src/handlers/registrationHandler");
const attendanceHandler = require("./src/handlers/attendanceHandler");
const todoHandler = require("./src/handlers/todoHandler");
const photoHandler = require("./src/utils/photoUtil.js");
const locationHandler = require("./src/utils/locationUtil.js");
const rekapHandler = require("./src/handlers/rekapHandler");
const persentaseHandler = require("./src/handlers/persentaseHandler");
const visitPlanHandler = require("./src/handlers/visitPlanHandler");
const visitExecutionHandler = require("./src/handlers/visitExecutionHandler");
const pool = require('./config/database');

//check perubahan
async function testDbConnection() {
  try {
    const res = await pool.query("SELECT 1");
    console.log("✅ Database connected. Result:", res.rows[0]);
  } catch (error) {
    console.error("❌ Database connection failed", error);
    process.exit(1);
  }
}

testDbConnection();

const bot = createBot();
const stateManager = require("./stateManager");

// Inisialisasi semua handler
visitPlanHandler(bot, stateManager);
visitExecutionHandler(bot, stateManager);
registrationHandler(bot, stateManager);
attendanceHandler(bot, stateManager);
todoHandler(bot, stateManager);
photoHandler(bot, stateManager);
locationHandler(bot, stateManager);
rekapHandler(bot);
persentaseHandler(bot);

// Handle error polling
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
  setTimeout(() => bot.startPolling(), 5000);
});

process.on("SIGINT", () => {
  clearInterval(stateManager.cleanupInterval);
  process.exit();
});

console.log("🚀 Bot berhasil berjalan!");