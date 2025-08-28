const fetch = require("node-fetch");
const { downloadPDF, convertPDFToImages } = require("../services/pdfService");
const fs = require("fs");

async function generatePercentageReportImage(bot, chatId, options = {}) {
  try {
    const url = `${process.env.APPSCRIPT_URL}?sheet=RekapPersentase`;
    console.log(`🌐 Mengakses AppScript: ${url}`);

    const response = await fetch(url);
    const responseText = await response.text();

    console.log(
      `📥 Status: ${response.status}, Panjang Respons: ${responseText.length}`
    );

    // Cek jika respons HTML (biasanya error)
    if (responseText.startsWith("<!DOCTYPE html>")) {
      throw new Error(
        `Apps Script mengembalikan HTML: ${responseText.slice(0, 500)}`
      );
    }

    // Coba parsing JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error(
        `Gagal parsing JSON: ${
          parseError.message
        }\nRespons: ${responseText.slice(0, 500)}`
      );
    }

    if (!data.fileUrl) {
      throw new Error(data.error || "URL PDF tidak valid");
    }

    console.log(`⬇️ Mengunduh PDF dari ${data.fileUrl}`);
    const pdfPath = await downloadPDF(
      data.fileUrl,
      `rekap_persentase_${Date.now()}.pdf`
    );
    console.log(`💾 PDF tersimpan di ${pdfPath}`);

    const imagePaths = await convertPDFToImages(pdfPath);
    console.log(`🖼️ PDF dikonversi ke gambar: ${imagePaths.join(", ")}`);

    console.log(`📤 Mengirim gambar ke chat ${chatId}`);
    for (const imgPath of imagePaths) {
      // Tambahkan penundaan antara pengiriman gambar
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await bot.sendPhoto(chatId, imgPath, options);
    }

    // Bersihkan file temporary
    fs.unlinkSync(pdfPath);
    imagePaths.forEach((path) => fs.unlinkSync(path));
    console.log("🧹 File temporary dihapus");

    return true;
  } catch (error) {
    console.error("❌ Gagal membuat laporan gambar:", error);
    throw new Error(`Gagal membuat laporan: ${error.message}`);
  }
}

module.exports = { generatePercentageReportImage };
