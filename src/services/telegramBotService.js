const TelegramBot = require("node-telegram-bot-api");
const { ensureDirectories } = require("./pdfService");

const ENTITIES = {
  MAGANG: {
    dataSheet: "Magang",
    rekapSheet: "RekapMAGANG",
    sendRekapSheet: "SendRekapMagang",
    buttons: ["HADIR", "IZIN", "SAKIT"],
    topicId: process.env.REKAP_MAGANG_TOPIC_ID,
    hasAsal: true,
    unitOptions: ["Witel Business Service"],
    healthOptions: ["Sehat", "Kurang Fit", "Izin"],
  },
  WBS: {
    dataSheet: "WBS",
    rekapSheet: "RekapWBS",
    sendRekapSheet: "SendRekapWBS",
    buttons: ["ONSITE", "REMOTE"],
    topicId: process.env.REKAP_WBS_TOPIC_ID,
    hasAsal: false,
    unit: "Witel Business Service",
    unitOptions: ["Witel Business Service"],
    healthOptions: ["Sehat", "Kurang Fit", "Izin"],
  },
  AR: {
    healthOptions: ["Sehat", "Izin", "Sakit"],
    rekapSheet: "RekapAR",
    sendRekapSheet: "SendRekapAR",
    topicId: process.env.REKAP_AR_TOPIC_ID,
    registrationSheet: "RegistrasiAR",
    columns: ["username", "nama", "posisi", "unit"],
  },
  SA: {
    healthOptions: ["Sehat", "Izin", "Sakit"],
    rekapSheet: "RekapSA",
    sendRekapSheet: "SendRekapSA",
    topicId: process.env.REKAP_SA_TOPIC_ID,
    registrationSheet: "RegistrasiSA",
    columns: ["username", "nama", "posisi", "unit"],
  },
};

module.exports = {
  getEntityByType(type) {
    if (!type || typeof type !== "string") {
      throw new Error("Tipe entitas harus berupa string");
    }
    return ENTITIES[type.toUpperCase()];
  },

  createBot: () => {
    const bot = new TelegramBot(process.env.TOKEN, {
      polling: {
        interval: 3000,
        param: 10000,
        autoStart: true,
        params: {
          timeout: 10,
        },
      },
      request: {
        agentOptions: {
          keepAlive: true,
          maxSockets: 50,
        },
      },
      onlyFirstMatch: true,
    });

    bot.on("error", (error) => {
      console.error("Bot error:", error);
      if (error.code === "EFATAL") {
        setTimeout(() => bot.startPolling(), 5000);
      }
    });

    ensureDirectories();
    return bot;
  },

  createKeyboard: (entityType) => {
    const entity = ENTITIES[entityType.toUpperCase()];
    if (!entity) {
      throw new Error(`Entity ${entityType} tidak ditemukan`);
    }
    return {
      keyboard: [entity.buttons.map((btn) => ({ text: btn }))],
      one_time_keyboard: true,
      resize_keyboard: true,
    };
  },

  isOfficeHours: () => {
    const now = new Date();
    return now.getHours() >= 0 && now.getHours() < 23;
  },
};
