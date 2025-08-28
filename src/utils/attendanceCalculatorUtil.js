// attendanceCalculator.js
function calculateWorkingDays(year, month) {
  let count = 0;
  const date = new Date(year, month, 1);

  while (date.getMonth() === month) {
    const day = date.getDay();
    if (day >= 1 && day <= 5) count++;
    date.setDate(date.getDate() + 1);
  }
  return count;
}

function getAttendanceWeight(status, entityType) {
  // Handle perbedaan status antara MAGANG dan WBS
  const statusUpper = status.toUpperCase();

  if (entityType === "WBS") {
    switch (statusUpper) {
      case "ONSITE":
        return 1.0;
      case "REMOTE":
        return 0.7;
      case "IZIN":
        return 0.3;
      case "SAKIT":
        return 0.5;
      default:
        return 0;
    }
  } else {
    // Untuk MAGANG dan entity lainnya
    switch (statusUpper) {
      case "HADIR":
        return 1.0;
      case "TERLAMBAT":
        return 0.7;
      case "IZIN":
        return 0.3;
      case "SAKIT":
        return 0.5;
      default:
        return 0;
    }
  }
}

function evaluateThreshold(percentage) {
  if (percentage >= 95) return "BAIK SEKALI 🏆";
  if (percentage >= 80) return "BAIK 👍";
  if (percentage >= 70) return "CUKUP ⚠️";
  return "BURUK ❌";
}

function calculateAttendancePercentage(
  records,
  year,
  month,
  entityType = "MAGANG"
) {
  const workingDays = calculateWorkingDays(year, month);
  let totalScore = 0;

  // Hitung skor berbobot
  records.forEach((record) => {
    totalScore += getAttendanceWeight(record.status_kehadiran, entityType);
  });

  const percentage = (totalScore / workingDays) * 100;
  return {
    percentage: Math.round(percentage * 100) / 100,
    evaluation: evaluateThreshold(percentage),
    workingDays,
    presentDays: records.length,
    absentDays: workingDays - records.length,
  };
}

module.exports = {
  calculateWorkingDays,
  calculateAttendancePercentage,
};
