const haversine = require("haversine-distance");
const axios = require("axios");

const OSRM_BASE_URL =
  process.env.OSRM_BASE_URL || "http://router.project-osrm.org";

async function getRoadInfo(point) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${point.lat}&lon=${point.lon}&zoom=18&addressdetails=1`;
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Your-App-Name", // Required by Nominatim
      },
    });

    if (response.data && response.data.address) {
      const address = response.data.address;
      const roadName =
        address.road || address.pedestrian || address.footway || "";

      const oneWayIndicators = [
        "satu arah",
        "one way",
        "one-way",
        "searah",
        "arah tunggal",
      ];

      const isOneWay = oneWayIndicators.some((indicator) =>
        roadName.toLowerCase().includes(indicator)
      );

      return {
        name: roadName,
        isOneWay: isOneWay,
      };
    }
  } catch (error) {
    console.error("Error getting road info:", error);
  }
  return null;
}

async function getDrivingDistance(point1, point2, options = {}) {
  try {
    const { avoidTolls = false, avoidHighways = false } = options;
    let url = `${OSRM_BASE_URL}/route/v1/driving/${point1.lon},${point1.lat};${point2.lon},${point2.lat}?overview=false`;

    // Tambahkan parameter untuk menghindari jalan tertentu
    if (avoidTolls) url += "&avoid=tolls";
    if (avoidHighways) url += "&avoid=highways";

    const response = await axios.get(url);

    if (response.data.code === "Ok" && response.data.routes.length > 0) {
      return response.data.routes[0].distance;
    } else {
      throw new Error("Tidak ada rute yang ditemukan");
    }
  } catch (error) {
    console.error("Error getting driving distance:", error);
    // Fallback ke haversine distance jika OSRM tidak available
    return haversine(
      { latitude: point1.lat, longitude: point1.lon },
      { latitude: point2.lat, longitude: point2.lon }
    );
  }
}

// routeOptimizer.js - Tambahkan fungsi ini
function detectOneWayRoad(step) {
  // Deteksi berdasarkan nama jalan yang mengandung indikator satu arah
  const oneWayIndicators = [
    "satu arah",
    "one way",
    "one-way",
    "searah",
    "arah tunggal",
  ];

  const roadName = step.name?.toLowerCase() || "";

  // Cek indikator dalam nama jalan
  const hasOneWayInName = oneWayIndicators.some((indicator) =>
    roadName.includes(indicator)
  );

  // Deteksi berdasarkan tipe maneuver yang biasanya terkait jalan satu arah
  const oneWayManeuvers = [
    "turn",
    "sharp turn",
    "merge",
    "on ramp",
    "off ramp",
    "roundabout",
    "rotary",
  ];

  const isOneWayManeuver = oneWayManeuvers.includes(step.maneuver.type);

  // Deteksi berdasarkan modifier yang menunjukkan pembatasan arah
  const restrictiveModifiers = ["uturn", "sharp left", "sharp right"];

  const hasRestrictiveModifier = restrictiveModifiers.includes(
    step.maneuver.modifier
  );

  return hasOneWayInName || isOneWayManeuver || hasRestrictiveModifier;
}

function isOneWayStep(step) {
  return detectOneWayRoad(step);
}

// Fungsi untuk mendapatkan rute jalan dari OSRM
async function getDrivingRoute(point1, point2, options = {}) {
  try {
    const { avoidTolls = false, avoidHighways = false } = options;
    let url = `${OSRM_BASE_URL}/route/v1/driving/${point1.lon},${point1.lat};${point2.lon},${point2.lat}?overview=full&geometries=geojson&steps=true`;

    // Tambahkan parameter untuk menghindari jalan tertentu
    if (avoidTolls) url += "&avoid=tolls";
    if (avoidHighways) url += "&avoid=highways";

    const response = await axios.get(url);

    if (response.data.code === "Ok" && response.data.routes.length > 0) {
      const route = response.data.routes[0];
      return {
        distance: route.distance,
        duration: route.duration,
        geometry: route.geometry,
        steps: route.legs[0].steps,
      };
    } else {
      throw new Error("Tidak ada rute yang ditemukan");
    }
  } catch (error) {
    console.error("Error getting driving route:", error);
    // Fallback ke perhitungan garis lurus
    const distance = haversine(
      { latitude: point1.lat, longitude: point1.lon },
      { latitude: point2.lat, longitude: point2.lon }
    );
    return {
      distance: distance,
      duration: (distance / 1.4) * 3.6,
      geometry: null,
      steps: [],
    };
  }
}

// Fungsi untuk mendapatkan rute dengan alternatif (jika tersedia)
async function getAlternativeRoutes(point1, point2, alternatives = 2) {
  try {
    const url = `${OSRM_BASE_URL}/route/v1/driving/${point1.lon},${point1.lat};${point2.lon},${point2.lat}?overview=full&geometries=geojson&steps=true&alternatives=${alternatives}`;
    const response = await axios.get(url);

    if (response.data.code === "Ok" && response.data.routes.length > 0) {
      return response.data.routes.map((route) => ({
        distance: route.distance,
        duration: route.duration,
        geometry: route.geometry,
        steps: route.legs[0].steps,
      }));
    } else {
      throw new Error("Tidak ada rute yang ditemukan");
    }
  } catch (error) {
    console.error("Error getting alternative routes:", error);
    return [];
  }
}

async function getRouteInstructions(steps) {
  if (!steps || steps.length === 0) return "Tidak ada petunjuk rute tersedia.";

  let instructions = "";
  let count = 1;

  // Terjemahan untuk tipe manuver
  const maneuverTranslations = {
    turn: "Belok",
    "new name": "Lanjutkan",
    depart: "Mulai",
    arrive: "Tiba",
    roundabout: "Bundaran",
    fork: "Persimpangan",
    merge: "Gabung",
    "on ramp": "Masuk",
    "off ramp": "Keluar",
    "end of road": "Akhir",
    continue: "Lanjutkan",
    notification: "Pemberitahuan",
  };

  // Terjemahan untuk modifier
  const modifierTranslations = {
    left: "kiri",
    right: "kanan",
    "sharp left": "kiri tajam",
    "sharp right": "kanan tajam",
    "slight left": "agak kiri",
    "slight right": "agak kanan",
    straight: "lurus",
    uturn: "putar balik",
  };

  try {
    const importantSteps = steps
      .filter(
        (step) =>
          step.maneuver.type !== "depart" &&
          step.maneuver.type !== "arrive" &&
          step.distance > 50
      )
      .slice(0, 5);

    for (const step of importantSteps) {
      const distance = (step.distance / 1000).toFixed(1);
      let instruction = "";

      // Dapatkan info jalan tambahan
      const roadInfo = await getRoadInfo({
        lat: step.maneuver.location[1],
        lon: step.maneuver.location[0],
      });

      // Terjemahkan tipe manuver
      const maneuverType =
        maneuverTranslations[step.maneuver.type] || step.maneuver.type;

      // Terjemahkan modifier jika ada
      const maneuverModifier =
        modifierTranslations[step.maneuver.modifier] || step.maneuver.modifier;

      // Dapatkan nama jalan
      const roadName = step.name || "jalan tidak bernama";

      // Tambahkan indikator one-way jika perlu
      const oneWayIndicator =
        isOneWayStep(step) || (roadInfo && roadInfo.isOneWay) ? "" : "";

      switch (step.maneuver.type) {
        case "turn":
          instruction = `${maneuverType} ${
            maneuverModifier || ""
          } ke ${roadName}${oneWayIndicator}`;
          break;
        case "new name":
        case "continue":
          instruction = `${maneuverType} lurus di ${roadName}`;
          break;
        case "depart":
          instruction = `${maneuverType} perjalanan di ${roadName}`;
          break;
        case "arrive":
          instruction = `${maneuverType} di tujuan di ${roadName}`;
          break;
        case "roundabout":
          instruction = `Masuk ${maneuverType.toLowerCase()} dan ambil jalan keluar ${
            step.maneuver.exit || ""
          } ke ${roadName}${oneWayIndicator}`;
          break;
        case "fork":
        case "on ramp":
        case "off ramp":
          instruction = `Ambil ${
            maneuverModifier || "jalur"
          } di ${maneuverType.toLowerCase()} ke ${roadName}${oneWayIndicator}`;
          break;
        case "end of road":
          instruction = `Di ${maneuverType.toLowerCase()} ${roadName}, belok ${maneuverModifier}${oneWayIndicator}`;
          break;
        default:
          instruction = `${maneuverType}${
            maneuverModifier ? " " + maneuverModifier : ""
          } ke ${roadName}${oneWayIndicator}`;
      }

      instruction = instruction.replace(/\s+/g, " ").trim() + oneWayIndicator;
      instructions += `${count}. ${instruction} (${distance} km)\n`;
      count++;
    }

    return instructions || "Ikuti rute utama menuju tujuan.";
  } catch (error) {
    console.error("Error generating route instructions:", error);
    return "Tidak dapat menghasilkan petunjuk rute.";
  }
}

// Fungsi untuk mendapatkan ringkasan rute
function getRouteSummary(routeInfo) {
  const distanceKm = (routeInfo.distance / 1000).toFixed(1);
  const durationMin = Math.ceil(routeInfo.duration / 60);

  return {
    distance: distanceKm,
    duration: durationMin,
    summary: `Jarak: ${distanceKm} km, Perkiraan Waktu: ${durationMin} menit`,
  };
}

async function getBestRoute(point1, point2, preferences = {}) {
  const {
    preferShortest = false,
    avoidTolls = false,
    avoidHighways = false,
    avoidOneWay = false,
  } = preferences;

  try {
    let url = `${OSRM_BASE_URL}/route/v1/driving/${point1.lon},${point1.lat};${point2.lon},${point2.lat}?overview=full&geometries=geojson&steps=true&alternatives=3`;

    if (avoidTolls) url += "&avoid=tolls";
    if (avoidHighways) url += "&avoid=highways";

    const response = await axios.get(url);

    if (response.data.code !== "Ok") {
      throw new Error("Tidak ada rute yang ditemukan");
    }

    let routes = response.data.routes;

    // Filter rute yang mengandung pelanggaran one-way jika dihindari
    if (avoidOneWay) {
      routes = routes.filter((route) => {
        return !hasOneWayViolation(route.legs[0].steps);
      });
    }

    if (routes.length === 0) {
      throw new Error("Tidak ada rute yang memenuhi preferensi");
    }

    // Pilih rute berdasarkan preferensi
    let bestRoute = routes[0];

    if (preferShortest) {
      bestRoute = routes.reduce(
        (shortest, route) =>
          route.distance < shortest.distance ? route : shortest,
        routes[0]
      );
    } else {
      bestRoute = routes.reduce(
        (fastest, route) =>
          route.duration < fastest.duration ? route : fastest,
        routes[0]
      );
    }

    return {
      distance: bestRoute.distance,
      duration: bestRoute.duration,
      geometry: bestRoute.geometry,
      steps: bestRoute.legs[0].steps,
    };
  } catch (error) {
    console.error("Error getting best route:", error);
    // Fallback ke rute biasa
    return await getDrivingRoute(point1, point2, { avoidTolls, avoidHighways });
  }
}

function calculateDistance(point1, point2) {
  return haversine(
    { latitude: point1.lat, longitude: point1.lon },
    { latitude: point2.lat, longitude: point2.lon }
  );
}

function generatePermutations(arr) {
  if (arr.length <= 1) return [arr];

  const permutations = [];
  for (let i = 0; i < arr.length; i++) {
    const current = arr[i];
    const remaining = [...arr.slice(0, i), ...arr.slice(i + 1)];
    const remainingPerms = generatePermutations(remaining);

    for (const perm of remainingPerms) {
      permutations.push([current, ...perm]);
    }
  }
  return permutations;
}

async function calculateTotalDistance(
  route,
  useDrivingDistance = true,
  options = {}
) {
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    if (useDrivingDistance) {
      total += await getDrivingDistance(route[i], route[i + 1], options);
    } else {
      total += calculateDistance(route[i], route[i + 1]);
    }
  }
  return total;
}

async function optimizeRouteWithBruteForce(
  locations,
  useDrivingDistance = true,
  options = {}
) {
  const MAX_LOCATIONS = 10;
  if (locations.length > MAX_LOCATIONS) {
    throw new Error(
      `Brute Force hanya efisien untuk maksimal ${MAX_LOCATIONS} lokasi`
    );
  }

  if (locations.length === 1) {
    return {
      route: locations,
      distance: 0,
    };
  }

  const startPoint = locations.find((loc) => loc.is_start);
  if (!startPoint) {
    throw new Error("Lokasi awal tidak ditemukan");
  }

  const visitPoints = locations.filter((loc) => !loc.is_start);

  if (visitPoints.length === 0) {
    return {
      route: [startPoint],
      distance: 0,
    };
  }

  const allPermutations = generatePermutations(visitPoints);
  let bestRoute = null;
  let minDistance = Infinity;
  let validRoutes = [];

  for (const visitPermutation of allPermutations) {
    const route = [startPoint, ...visitPermutation];
    let isValidRoute = true;

    // Periksa setiap segmen rute untuk menghindari jalan one-way
    for (let i = 0; i < route.length - 1; i++) {
      const currentPoint = route[i];
      const nextPoint = route[i + 1];

      // Dapatkan info rute antara dua titik
      try {
        const routeInfo = await getDrivingRoute(
          currentPoint,
          nextPoint,
          options
        );

        // Periksa apakah rute mengandung jalan one-way yang dilawan arah
        if (hasOneWayViolation(routeInfo.steps)) {
          isValidRoute = false;
          break;
        }
      } catch (error) {
        console.error("Error checking route segment:", error);
        isValidRoute = false;
        break;
      }
    }

    if (isValidRoute) {
      const distance = await calculateTotalDistance(
        route,
        useDrivingDistance,
        options
      );

      validRoutes.push({ route, distance });

      if (distance < minDistance) {
        minDistance = distance;
        bestRoute = route;
      }
    }
  }

  // Jika tidak ada rute yang valid tanpa one-way violation, fallback ke rute terpendek
  if (validRoutes.length === 0) {
    console.warn(
      "Tidak ada rute yang valid tanpa pelanggaran one-way, menggunakan semua rute"
    );

    for (const visitPermutation of allPermutations) {
      const route = [startPoint, ...visitPermutation];
      const distance = await calculateTotalDistance(
        route,
        useDrivingDistance,
        options
      );

      if (distance < minDistance) {
        minDistance = distance;
        bestRoute = route;
      }
    }
  }

  return {
    route: bestRoute,
    distance: minDistance,
    validRoutes: validRoutes, // Untuk debugging
  };
}

function hasOneWayViolation(steps) {
  if (!steps || steps.length === 0) return false;

  for (const step of steps) {
    if (isOneWayViolationStep(step)) {
      return true;
    }
  }

  return false;
}

function isOneWayViolationStep(step) {
  const violationManeuvers = ["uturn", "sharp left", "sharp right", "turn"];

  const violationModifiers = ["uturn", "sharp left", "sharp right"];

  // Jika maneuver adalah "uturn" atau modifier adalah "uturn", kemungkinan melanggar one-way
  if (step.maneuver.type === "uturn" || step.maneuver.modifier === "uturn") {
    return true;
  }

  // Deteksi berdasarkan nama jalan yang mengandung indikator one-way
  const roadName = step.name?.toLowerCase() || "";
  const oneWayIndicators = [
    "satu arah",
    "one way",
    "one-way",
    "searah",
    "arah tunggal",
  ];

  const isOneWayRoad = oneWayIndicators.some((indicator) =>
    roadName.includes(indicator)
  );

  // Jika jalan adalah one-way dan maneuver adalah turn, kemungkinan melanggar
  if (isOneWayRoad && violationManeuvers.includes(step.maneuver.type)) {
    return true;
  }

  return false;
}

module.exports = {
  optimizeRouteWithBruteForce,
  calculateDistance,
  getDrivingDistance,
  getDrivingRoute,
  getRouteInstructions,
  getBestRoute,
  getRouteSummary,
  getAlternativeRoutes,
  getRoadInfo,
  hasOneWayViolation,
  isOneWayViolationStep,
};
