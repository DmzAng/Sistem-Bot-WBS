  const { google } = require("googleapis");
  const axios = require("./axiosService");

  async function getAuthClient() {
    // Coba baca dari environment variable
    if (process.env.GOOGLE_CREDENTIALS) {
      const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
      return new google.auth.JWT(
        credentials.client_email,
        null,
        credentials.private_key,
        ["https://www.googleapis.com/auth/spreadsheets"]
      );
    } else {
      // Fallback ke file
      return google.auth.getClient({
        keyFile: "credentials.json",
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
    }
  }
  async function appendSheetData(spreadsheetId, range, values) {
    try {
      const auth = await getAuthClient();
      const sheets = google.sheets({ version: "v4", auth });

      const res = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: "RAW",
        resource: { values },
      });

      console.log("✅ Data appended:", res.data.updates);
      return res;
    } catch (error) {
      console.error("❌ Append error:", error.message);
      throw error;
    }
  }

  function getCurrentWITATime() {
  const now = new Date();
  const witaOffset = 8 * 60 * 60 * 1000;
  const witaTime = new Date(now.getTime() + witaOffset);
  
  const hours = String(witaTime.getUTCHours()).padStart(2, "0");
  const minutes = String(witaTime.getUTCMinutes()).padStart(2, "0");
  const seconds = String(witaTime.getUTCSeconds()).padStart(2, "0");
  
  return `${hours}:${minutes}:${seconds}`;
}

  module.exports = {
    saveToSendRekap: async (entityType, rowData) => {
      const spreadsheetId = process.env.SPREADSHEET_ID;
      const sheetName = `${
        entityType.charAt(0).toUpperCase() + entityType.slice(1)
      }`;
      const range = `${sheetName}!A3:Z`;
      await appendSheetData(spreadsheetId, range, [rowData]);
    },

    writePercentageReport: async (data) => {
      const spreadsheetId = process.env.SPREADSHEET_ID;
      const sheetName = "RekapPersentase";
      const auth = await getAuthClient();
      const sheets = google.sheets({ version: "v4", auth });

      // Clear existing data
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${sheetName}!A:Z`,
      });

      // Write headers dengan tambahan kolom Izin dan Sakit
      const headers = [
        "Nama",
        "Posisi",
        "Hadir",
        "Izin",
        "Sakit",
        "Tidak Hadir",
        "Persentase",
        "Evaluasi",
      ];
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: "RAW",
        resource: { values: [headers] },
      });

      // Write data dengan informasi izin dan sakit
      const rows = data.map((item) => [
        item.nama,
        item.posisi,
        item.presentDays,
        item.izinDays || 0,
        item.sakitDays || 0,
        item.absentDays,
        `${item.percentage}%`,
        item.evaluation,
      ]);

      if (rows.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${sheetName}!A2`,
          valueInputOption: "RAW",
          resource: { values: rows },
        });
      }
    },

    bulkSaveToSendRekap: async (sheetName, rowData) => {
      try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: "v4", auth });
        const spreadsheetId = process.env.SPREADSHEET_ID;

        // Clear existing data (mulai dari baris 3, pertahankan header di baris 1-2)
        await sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: `${sheetName}!A3:Z`,
        });

        // Append new data mulai dari baris 3
        if (rowData.length > 0) {
          await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A3:F`,
            valueInputOption: "RAW",
            resource: {
              values: rowData,
            },
          });
        }

        console.log(
          `✅ Data berhasil disimpan ke sheet ${sheetName}: ${rowData.length} records (mulai baris 3)`
        );
        return true;
      } catch (error) {
        console.error("Error bulk saving to sheet:", error);
        throw error;
      }
    },
  };
