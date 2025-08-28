  module.exports = {
      apps: [
        {
          name: 'telegram-bot',
          script: 'main.js',
          cwd: 'C:/Users/ASUS/Downloads/Skripsi/BotWBS',
          instances: 1,
          autorestart: true,
          watch: false,
          intepreter: 'C:/Program Files/nodejs/node.exe',
          env: {
            NODE_ENV: 'production',
          }
        }
      ]
    };
    