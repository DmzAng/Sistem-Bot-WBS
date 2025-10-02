const pool = require("../../config/database");

function getCurrentWITADateTime() {
  const now = new Date();

  const witaOffset = 8 * 60 * 60 * 1000;
  const witaTime = new Date(now.getTime() + witaOffset);

  const year = witaTime.getUTCFullYear();
  const month = String(witaTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(witaTime.getUTCDate()).padStart(2, "0");
  const hours = String(witaTime.getUTCHours()).padStart(2, "0");
  const minutes = String(witaTime.getUTCMinutes()).padStart(2, "0");
  const seconds = String(witaTime.getUTCSeconds()).padStart(2, "0");

  return {
    formattedDate: `${year}-${month}-${day}`,
    formattedTime: `${hours}:${minutes}:${seconds}`,
    year: parseInt(year),
    month: parseInt(month),
    day: parseInt(day),
  };
}

module.exports = {
  getCurrentWITADateTime,
  // User operations
  getUserByUsername: async (username) => {
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );
    return rows[0];
  },

  createUser: async (userData) => {
    const { username, nama, entity_type, posisi, status, asal, unit } =
      userData;
    const { rows } = await pool.query(
      `INSERT INTO users (username, nama, entity_type, posisi, status, asal, unit) 
     VALUES ($1, $2, $3, $4, $5, $6, $7) 
     RETURNING id`,
      [username, nama, entity_type, posisi, status, asal, unit]
    );
    return rows[0].id;
  },

  // Attendance operations
  saveAttendance: async (entityType, attendanceData) => {
    const { formattedDate, formattedTime } = getCurrentWITADateTime();

    const tableName = `absen_${entityType.toLowerCase()}`;
    const {
      user_name,
      nama,
      status_kehadiran,
      status_kesehatan,
      foto,
      lokasi_lat,
      lokasi_lon,
      lokasi_alamat,
      keterangan,
    } = attendanceData;

    const { rows } = await pool.query(
      `INSERT INTO ${tableName} 
   (user_name, nama, tanggal, waktu, status_kehadiran, status_kesehatan, foto, lokasi_lat, lokasi_lon, lokasi_alamat, keterangan)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
   RETURNING id`,
      [
        user_name,
        nama,
        formattedDate,
        formattedTime,
        status_kehadiran,
        status_kesehatan,
        foto,
        lokasi_lat,
        lokasi_lon,
        lokasi_alamat,
        keterangan,
      ]
    );
    return rows[0].id; // Get inserted ID
  },

  getTodayAttendanceByUsername: async (username, entityType) => {
    const { formattedDate } = getCurrentWITADateTime();
    const tableName = `absen_${entityType.toLowerCase()}`;
    const { rows } = await pool.query(
      `SELECT 1 FROM ${tableName} 
   WHERE user_name = $1 AND tanggal = $2
   LIMIT 1`,
      [username, formattedDate]
    );
    return rows.length > 0;
  },

  saveTodoItems: async (username, nama, items, date) => {
    const values = items
      .map((item) => `('${username}', '${nama}', '${date}', '${item}', false)`)
      .join(",");
    const { rowCount } = await pool.query(
      `INSERT INTO todos (user_name, nama, tanggal, kegiatan, selesai) 
       VALUES ${values}`
    );
    return rowCount;
  },

  getPendingTodos: async (username, date) => {
    const { rows } = await pool.query(
      `SELECT id, kegiatan FROM todos 
       WHERE user_name = $1 AND tanggal = $2 AND selesai = false`,
      [username, date]
    );
    return rows;
  },

  markTodoAsDone: async (todoId) => {
    const { rowCount } = await pool.query(
      `UPDATE todos SET selesai = true 
       WHERE id = $1`,
      [todoId]
    );
    return rowCount;
  },

  getAllUncompletedTodos: async (username) => {
    const { rows } = await pool.query(
      `SELECT kegiatan FROM todos 
       WHERE user_name = $1 AND selesai = false AND tanggal < CURRENT_DATE`,
      [username]
    );
    return rows.map((row) => row.kegiatan);
  },

  getMonthlyAttendanceForEntity: async (entityType, year, month) => {
    const tableName = `absen_${entityType.toLowerCase()}`;

    const monthFormatted = month < 10 ? `0${month}` : month;

    const { rows } = await pool.query(
      `SELECT a.user_name, a.tanggal, a.status_kehadiran 
     FROM ${tableName} a
     JOIN users u ON a.user_name = u.username
     WHERE u.entity_type = $1 
       AND EXTRACT(YEAR FROM a.tanggal) = $2 
       AND EXTRACT(MONTH FROM a.tanggal) = $3`,
      [entityType, year, month]
    );

    console.log(
      `Query: ${entityType}, ${year}-${monthFormatted}, Results: ${rows.length}`
    );
    return rows;
  },

  getDailyAttendanceForEntity: async (entityType, year, month, day) => {
    const tableName = `absen_${entityType.toLowerCase()}`;

    const { rows } = await pool.query(
      `SELECT a.user_name, a.nama, a.status_kehadiran, a.keterangan, a.waktu,
            u.posisi, u.status, u.asal, u.unit
     FROM ${tableName} a
     JOIN users u ON a.user_name = u.username
     WHERE EXTRACT(YEAR FROM a.tanggal) = $1 
       AND EXTRACT(MONTH FROM a.tanggal) = $2
       AND EXTRACT(DAY FROM a.tanggal) = $3`,
      [year, month, day]
    );

    return rows;
  },

  getStudentsForEntity: async (entityType) => {
    const { rows } = await pool.query(
      `SELECT username, nama, posisi, status, asal, unit 
       FROM users 
       WHERE entity_type = $1`,
      [entityType]
    );
    return rows;
  },

  savePlan: async (planData) => {
    const {
      user_name,
      nama,
      user_location,
      locations,
      optimized_route,
      status,
    } = planData;
    const { rows } = await pool.query(
      `INSERT INTO visiting_plans (tanggal, user_name, nama, user_location, locations, optimized_route, status) 
     VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6) 
     RETURNING id`,
      [
        user_name,
        nama,
        JSON.stringify(user_location),
        JSON.stringify(locations),
        JSON.stringify(optimized_route),
        status,
      ]
    );
    return rows[0].id;
  },

  getPlan: async (planId) => {
    const { rows } = await pool.query(
      `SELECT * FROM visiting_plans 
     WHERE id = $1`,
      [planId]
    );
    if (rows.length === 0) return null;

    const plan = rows[0];

    // Perbaikan: Hanya parse jika field adalah string
    try {
      if (typeof plan.user_location === "string") {
        plan.user_location = JSON.parse(plan.user_location);
      }
      if (typeof plan.locations === "string") {
        plan.locations = JSON.parse(plan.locations);
      }
      if (typeof plan.optimized_route === "string") {
        plan.optimized_route = JSON.parse(plan.optimized_route);
      }
    } catch (error) {
      console.error("Error parsing JSON fields:", error);
    }

    return plan;
  },

  getTodayPlans: async (username) => {
    const { rows } = await pool.query(
      `SELECT id, status, created_at, tanggal,
            jsonb_array_length(locations) as location_count 
     FROM visiting_plans 
     WHERE user_name = $1 AND tanggal = CURRENT_DATE AND status != 'COMPLETED'`,
      [username]
    );
    return rows;
  },

  saveVisitExecution: async (execution) => {
    const {
      plan_id,
      tanggal,
      user_name,
      nama,
      location_index,
      execution_time,
      execution_photo,
      execution_location,
    } = execution;

    const { rows } = await pool.query(
      `INSERT INTO visit_executions 
     (plan_id, tanggal, user_name, nama, location_index, execution_time, execution_photo, execution_location) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
     RETURNING id`,
      [
        plan_id,
        tanggal,
        user_name,
        nama,
        location_index,
        execution_time,
        execution_photo,
        JSON.stringify(execution_location),
      ]
    );
    return rows[0].id;
  },

  getCompletedVisits: async (planId) => {
    const { rows } = await pool.query(
      `SELECT location_index FROM visit_executions 
     WHERE plan_id = $1`,
      [planId]
    );
    return rows.map((row) => row.location_index);
  },

  getUserPlans: async (username) => {
    const { rows } = await pool.query(
      `SELECT id, status, created_at, 
            jsonb_array_length(locations) as location_count 
     FROM visiting_plans 
     WHERE user_name = $1 AND status != 'COMPLETED'`,
      [username]
    );
    return rows;
  },

  saveExecution: async (execution) => {
    const {
      plan_id,
      location_index,
      start_time,
      end_time,
      start_photo,
      end_photo,
    } = execution;
    const { rows } = await pool.query(
      `INSERT INTO visit_executions 
       (plan_id, location_index, start_time, end_time, start_photo, end_photo) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id`,
      [plan_id, location_index, start_time, end_time, start_photo, end_photo]
    );
    return rows[0].id;
  },

  updatePlanStatus: async (planId, status) => {
    const { rowCount } = await pool.query(
      `UPDATE visiting_plans SET status = $1 
       WHERE id = $2`,
      [status, planId]
    );
    return rowCount;
  },
};
