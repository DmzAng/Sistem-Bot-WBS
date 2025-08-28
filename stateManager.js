class StateManager {
  constructor() {
    this.states = new Map();
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [chatId, state] of this.states) {
        if (now - state.lastActivity > 3600000) {
          // 1 jam
          this.states.delete(chatId);
        }
      }
    }, 60000); // Setiap 1 menit
  }

  getState(chatId) {
    return this.states.get(chatId);
  }

  setState(chatId, state) {
    this.states.set(chatId, {
      ...state,
      lastActivity: Date.now(),
    });
  }

  deleteState(chatId) {
    this.states.delete(chatId);
  }
}

module.exports = new StateManager();
