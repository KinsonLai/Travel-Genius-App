import { ItineraryResult } from '../types';

const escapeXml = (unsafe: string) => {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
};

export const generateKML = (itinerary: ItineraryResult): string => {
  let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(itinerary.tripTitle)}</name>
    <description>${escapeXml(itinerary.summary)}</description>
    <Style id="icon-seq">
      <IconStyle>
        <scale>1.1</scale>
      </IconStyle>
    </Style>`;

  itinerary.days.forEach(day => {
    // 每一天作為一個 Folder (在 Google My Maps 中會變成一個圖層 Layer)
    kml += `
    <Folder>
      <name>Day ${day.dayNumber} - ${day.date}</name>`;
    
    day.activities.forEach((act, index) => {
      // 只加入有座標的點
      if (act.latitude && act.longitude) {
        kml += `
      <Placemark>
        <name>${index + 1}. ${escapeXml(act.placeName)}</name>
        <description>
          <![CDATA[
            時間: ${act.time}<br/>
            類別: ${act.isMeal ? '餐飲' : '景點'}<br/>
            費用: ${act.cost}<br/>
            說明: ${act.description}
          ]]>
        </description>
        <styleUrl>#icon-seq</styleUrl>
        <Point>
          <coordinates>${act.longitude},${act.latitude},0</coordinates>
        </Point>
      </Placemark>`;
      }
    });

    kml += `
    </Folder>`;
  });

  kml += `
  </Document>
</kml>`;

  return kml;
};

export const downloadKML = (itinerary: ItineraryResult) => {
  const kmlContent = generateKML(itinerary);
  const blob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `${itinerary.tripTitle.replace(/\s+/g, '_')}_Itinerary.kml`;
  document.body.appendChild(link);
  link.click();
  
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};