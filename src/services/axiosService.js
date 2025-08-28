const axios = require("axios");
const https = require("https");

const instance = axios.create({
  httpsAgent: new https.Agent({
    keepAlive: true,
    maxSockets: 50,
    rejectUnauthorized: false,
  }),
  timeout: 30000,
});

instance.interceptors.response.use(undefined, async (error) => {
  const config = error.config;

  if (!config || !error.response) {
    return Promise.reject(error);
  }

  config.retryCount = config.retryCount || 0;

  if (config.retryCount < 3) {
    config.retryCount += 1;
    await new Promise((resolve) =>
      setTimeout(resolve, 1000 * config.retryCount)
    );
    return instance(config);
  }

  return Promise.reject(error);
});

module.exports = instance;
