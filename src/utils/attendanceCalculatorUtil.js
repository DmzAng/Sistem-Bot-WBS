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
  if (!status) return 0;
  const statusUpper = status.toString().trim().toUpperCase();

  const MAGANG_MAP = {
    HADIR: 1.0,
    PRESENT: 1.0,
    P: 1.0,
    ONTIME: 1.0,
    TERLAMBAT: 0.7,
    LATE: 0.7,
    IZIN: 0.3,
    PERMISSION: 0.3,
    SAKIT: 0.5,
    SICK: 0.5,
  };

  const WBS_MAP = {
    ONSITE: 1.0,
    ONS: 1.0,
    REMOTE: 0.7,
    WORKFROMHOME: 0.7,
    WFH: 0.7,
    IZIN: 0.3,
    PERMISSION: 0.3,
    SAKIT: 0.5,
    SICK: 0.5,
  };

  if (entityType === "WBS") {
    return WBS_MAP[statusUpper] ?? 0;
  } else {
    return MAGANG_MAP[statusUpper] ?? 0;
  }
}

function evaluateThreshold(percentage) {
  if (percentage >= 95) return "BAIK SEKALI";
  if (percentage >= 80) return "BAIK";
  if (percentage >= 70) return "CUKUP";
  return "BURUK";
}

function calculateAttendancePercentage(
  records,
  year,
  month,
  entityType = "MAGANG"
) {
  const workingDays = calculateWorkingDays(year, month);
  let totalScore = 0;
  let izinDays = 0;
  let sakitDays = 0;

  // Hitung skor berbobot dan hitung izin/sakit
  records.forEach((record) => {
    const status = record.status_kehadiran.toUpperCase();
    if (status === "IZIN") {
      izinDays++;
    } else if (status === "SAKIT") {
      sakitDays++;
    }
    totalScore += getAttendanceWeight(record.status_kehadiran, entityType);
  });

  const percentage = (totalScore / workingDays) * 100;
  return {
    percentage: Math.round(percentage * 100) / 100,
    evaluation: evaluateThreshold(percentage),
    workingDays,
    presentDays: records.length,
    izinDays,
    sakitDays,
    absentDays: workingDays - records.length,
  };
}

module.exports = {
  calculateWorkingDays,
  calculateAttendancePercentage,
};
