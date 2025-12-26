import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import { ItineraryResult } from '../types';
import L from 'leaflet';

// Fix Leaflet's default icon path issues in React environment without bundlers
const iconUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png';
const iconRetinaUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png';
const shadowUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: iconUrl,
    iconRetinaUrl: iconRetinaUrl,
    shadowUrl: shadowUrl,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface MapComponentProps {
  itinerary: ItineraryResult;
}

// Component to adjust map view bounds
const ChangeView = ({ bounds }: { bounds: L.LatLngBoundsExpression }) => {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [bounds, map]);
  return null;
};

const MapComponent: React.FC<MapComponentProps> = ({ itinerary }) => {
  // Extract all coordinates
  const points: { lat: number; lng: number; name: string; day: number }[] = [];
  
  itinerary.days.forEach(day => {
    day.activities.forEach(act => {
      if (act.latitude && act.longitude) {
        points.push({
          lat: act.latitude,
          lng: act.longitude,
          name: act.placeName,
          day: day.dayNumber
        });
      }
    });
  });

  if (points.length === 0) {
    return <div className="h-64 flex items-center justify-center bg-slate-800 text-slate-400 rounded-xl">地圖資料載入中或無法取得...</div>;
  }

  const polylinePositions = points.map(p => [p.lat, p.lng] as [number, number]);
  const bounds = L.latLngBounds(polylinePositions);

  return (
    <MapContainer 
      center={[points[0].lat, points[0].lng]} 
      zoom={13} 
      scrollWheelZoom={false} 
      className="h-full w-full rounded-xl z-0"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ChangeView bounds={bounds} />
      
      {/* Draw route lines */}
      <Polyline positions={polylinePositions} color="#3b82f6" weight={4} opacity={0.7} />

      {/* Draw markers */}
      {points.map((point, idx) => (
        <Marker key={idx} position={[point.lat, point.lng]}>
          <Popup>
            <div className="font-bold text-gray-800">Day {point.day}: {point.name}</div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
};

export default MapComponent;