const haversine = require("haversine-distance");
const axios = require("axios");

// Fungsi untuk mendapatkan jarak berdasarkan jalan dari OSRM
async function getDrivingDistance(point1, point2) {
  try {
    const url = `http://router.project-osrm.org/route/v1/driving/${point1.lon},${point1.lat};${point2.lon},${point2.lat}?overview=false`;
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

// Fungsi untuk mendapatkan rute jalan dari OSRM
async function getDrivingRoute(point1, point2) {
  try {
    const url = `http://router.project-osrm.org/route/v1/driving/${point1.lon},${point1.lat};${point2.lon},${point2.lat}?overview=full&geometries=geojson&steps=true`;
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

// Fungsi untuk mendapatkan petunjuk arah dari steps dalam bahasa Indonesia
function getRouteInstructions(steps) {
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
    "on ramp": "Masuk jalan",
    "off ramp": "Keluar jalan",
    "end of road": "Akhir jalan",
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

  // Ambil beberapa petunjuk penting saja (maksimal 5)
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

    // Terjemahkan tipe manuver
    const maneuverType =
      maneuverTranslations[step.maneuver.type] || step.maneuver.type;

    // Terjemahkan modifi er jika ada
    const maneuverModifier =
      modifierTranslations[step.maneuver.modifier] || step.maneuver.modifier;

    switch (step.maneuver.type) {
      case "turn":
        instruction = `${maneuverType} ${maneuverModifier || ""}`;
        break;
      case "new name":
      case "continue":
        instruction = `${maneuverType} lurus`;
        break;
      case "depart":
        instruction = `${maneuverType} perjalanan`;
        break;
      case "arrive":
        instruction = `${maneuverType} di tujuan`;
        break;
      case "roundabout":
        instruction = `Masuk ${maneuverType.toLowerCase()} dan ambil jalan keluar ${
          step.maneuver.exit || ""
        }`;
        break;
      case "fork":
      case "on ramp":
      case "off ramp":
        instruction = `Ambil ${
          maneuverModifier || "jalur"
        } di ${maneuverType.toLowerCase()}`;
        break;
      default:
        instruction = `${maneuverType}${
          maneuverModifier ? " " + maneuverModifier : ""
        }`;
    }

    instructions += `${count}. ${instruction} (${distance} km)\n`;
    count++;
  }

  return instructions || "Ikuti rute utama menuju tujuan.";
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

async function calculateTotalDistance(route, useDrivingDistance = true) {
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    if (useDrivingDistance) {
      total += await getDrivingDistance(route[i], route[i + 1]);
    } else {
      total += calculateDistance(route[i], route[i + 1]);
    }
  }
  return total;
}

async function optimizeRouteWithBruteForce(
  locations,
  useDrivingDistance = true
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

  for (const visitPermutation of allPermutations) {
    const route = [startPoint, ...visitPermutation];
    const distance = await calculateTotalDistance(route, useDrivingDistance);

    if (distance < minDistance) {
      minDistance = distance;
      bestRoute = route;
    }
  }

  return {
    route: bestRoute,
    distance: minDistance,
  };
}

module.exports = {
  optimizeRouteWithBruteForce,
  calculateDistance,
  getDrivingDistance,
  getDrivingRoute,
  getRouteInstructions,
};
