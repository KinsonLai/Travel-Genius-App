
import { CandidatePlace, UserPreferences, Hotel } from "../types";

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const isDateInHotelStay = (dateObj: Date, checkInStr: string, checkOutStr: string): boolean => {
    if (!checkInStr || !checkOutStr) return false;
    const checkIn = new Date(checkInStr);
    const checkOut = new Date(checkOutStr);
    checkIn.setHours(0,0,0,0);
    checkOut.setHours(0,0,0,0);
    dateObj.setHours(0,0,0,0);
    return dateObj.getTime() >= checkIn.getTime() && dateObj.getTime() < checkOut.getTime();
};

const parseTime = (timeStr: string): number => {
    if (!timeStr) return 9; 
    const [h, m] = timeStr.split(':').map(Number);
    return h + (m / 60);
};

export const rankCandidates = (
  candidates: CandidatePlace[],
  prefs: UserPreferences,
  hotels: Hotel[] 
): CandidatePlace[] => {

  return candidates.map(place => {
    let score = 0;
    const rating = place.rating || 4.0;
    score += (rating / 5) * 100 * 0.3;

    let matchScore = 50; 
    if (prefs.style.focus === 'balanced') matchScore = 80;
    else if (prefs.style.focus === place.category) matchScore = 100;
    else if (place.category === 'sightseeing') matchScore = 70;
    score += matchScore * 0.4;

    let minDistance = Infinity;
    hotels.forEach(h => {
        if (h.latitude && h.longitude && place.latitude && place.longitude) {
            const d = calculateDistance(h.latitude, h.longitude, place.latitude, place.longitude);
            if (d < minDistance) minDistance = d;
        }
    });

    if (minDistance !== Infinity) {
        place.distanceFromHotel = parseFloat(minDistance.toFixed(2));
        if (minDistance > 100) score -= 200; 
        else score += Math.max(0, (1 - minDistance / 30) * 100) * 0.2;
    } else {
        score -= 50; 
    }
    place.score = parseFloat(score.toFixed(1));
    return place;
  }).sort((a, b) => (b.score || 0) - (a.score || 0));
};

export const optimizeRoute = (
  candidates: CandidatePlace[],
  hotels: Hotel[],
  startDateStr: string,
  totalDays: number,
  airportCoords?: { lat: number, lng: number },
  flightTimes?: { start: string, end: string }
): CandidatePlace[] => {
  const finalOrderedList: CandidatePlace[] = [];
  const unvisited = [...candidates];
  const startDate = new Date(startDateStr);
  startDate.setHours(0,0,0,0);

  const arrivalTime = flightTimes ? parseTime(flightTimes.start) : 10;
  const departureTime = flightTimes ? parseTime(flightTimes.end) : 18;
  const defaultDuration = 1.5; 

  for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + (dayNum - 1));
    const currentDayOfWeek = currentDate.getDay();

    let activeHotel = hotels.find(h => isDateInHotelStay(currentDate, h.checkIn, h.checkOut));
    if (!activeHotel) {
        activeHotel = hotels.find(h => {
            const out = new Date(h.checkOut);
            out.setHours(0,0,0,0);
            return out.getTime() === currentDate.getTime();
        });
        if (!activeHotel) activeHotel = hotels[hotels.length - 1];
    }

    let currentTime = 9.0;
    let maxTime = 20.0; 

    // STRICT Time Constraints
    if (dayNum === 1) {
        // Arrival + 2.5 hours buffer
        currentTime = Math.max(arrivalTime + 2.5, 9.0);
    }
    if (dayNum === totalDays) {
        // Departure - 3.5 hours buffer
        maxTime = Math.min(departureTime - 3.5, 20.0);
    }

    // Identify if this is purely a travel day (little time left)
    const availableHours = maxTime - currentTime;
    
    if (availableHours < 2.0) {
         // Create a strict placeholder so prompt knows this is a travel day
         finalOrderedList.push({
             name: dayNum === 1 ? "抵達、辦理入境與前往飯店" : "前往機場、辦理登機",
             category: 'other',
             rating: 0,
             reviewCount: 0,
             priceLevel: 0,
             latitude: airportCoords?.lat || 0,
             longitude: airportCoords?.lng || 0,
             description: "Travel Time",
             suggestedDay: dayNum,
             matchReason: "時間緊迫，純移動行程",
             openingText: "",
             durationHours: 0
         });
         // Force continue to next day
         continue;
    }

    let currentLoc = { lat: activeHotel.latitude || 0, lng: activeHotel.longitude || 0 };
    if (dayNum === 1 && airportCoords && airportCoords.lat !== 0) {
        currentLoc = airportCoords;
    }

    const MAX_RADIUS = 30; // km
    const todaysCandidates = unvisited.filter(p => {
        if (p.closedDays && p.closedDays.includes(currentDayOfWeek)) return false;
        
        let dist = 999;
        if (activeHotel.latitude && activeHotel.longitude && p.latitude && p.longitude) {
            dist = calculateDistance(activeHotel.latitude, activeHotel.longitude, p.latitude, p.longitude);
        }

        if (dayNum === 1 && airportCoords) {
             const distAirport = calculateDistance(airportCoords.lat, airportCoords.lng, p.latitude, p.longitude);
             if (distAirport < 20) dist = distAirport; 
        }

        p.distanceFromHotel = parseFloat(dist.toFixed(1));
        const effectiveRadius = unvisited.length < 10 ? 100 : MAX_RADIUS;
        return dist <= effectiveRadius;
    });

    let spotsAdded = 0;
    // Greedy Loop
    while (currentTime < maxTime && todaysCandidates.length > 0) {
         let bestIdx = -1;
         let minDist = Infinity;

         for (let i=0; i < todaysCandidates.length; i++) {
             const cand = todaysCandidates[i];
             const d = calculateDistance(currentLoc.lat, currentLoc.lng, cand.latitude, cand.longitude);
             const weight = d - ((cand.score || 0) / 20);

             if (weight < minDist) {
                 minDist = weight;
                 bestIdx = i;
             }
         }

         if (bestIdx !== -1) {
             const chosen = todaysCandidates[bestIdx];
             const travelTime = (minDist / 30) + 0.3; 
             const duration = chosen.durationHours || defaultDuration;

             if (currentTime + travelTime + duration > maxTime + 0.5) {
                 todaysCandidates.splice(bestIdx, 1);
                 continue;
             }

             chosen.suggestedDay = dayNum;
             chosen.matchReason = `Day ${dayNum} (從${spotsAdded === 0 ? (dayNum===1 ? '機場/飯店' : '飯店') : '上一景點'}出發)`;
             finalOrderedList.push(chosen);
             
             currentTime += travelTime + duration;
             currentLoc = { lat: chosen.latitude, lng: chosen.longitude };
             spotsAdded++;
             
             const gIdx = unvisited.findIndex(u => u.name === chosen.name);
             if (gIdx !== -1) unvisited.splice(gIdx, 1);
             todaysCandidates.splice(bestIdx, 1);
         } else {
             break;
         }
    }

    // GUARANTEE: Never leave a day empty in the algorithm output
    // If no specific candidates matched, insert a "Free Exploration" placeholder
    if (spotsAdded === 0) {
        finalOrderedList.push({
            name: "市區自由探索 (AI 推薦)",
            category: 'other',
            rating: 0,
            reviewCount: 0,
            priceLevel: 0,
            latitude: activeHotel.latitude || 0,
            longitude: activeHotel.longitude || 0,
            description: "Relaxed exploration",
            suggestedDay: dayNum,
            matchReason: "行程彈性安排",
            openingText: "",
            durationHours: 2
        });
    }
  }

  return finalOrderedList;
};
