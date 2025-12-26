import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ItineraryResult } from '../types';

// NOTE: We need a font that supports Traditional Chinese. 
// Standard jsPDF fonts don't support Chinese characters.
// In a real production app, we would load a .ttf file.
// For this demo, we will attempt to use a CDN font or fallback to a standard font 
// acknowledging that characters might not render perfectly in client-side generation without a custom font file embedded.
// However, to make it work "best effort" without external assets, we will assume the user has a system font 
// or accept that we need to add a font.
// 
// WORKAROUND: Since we cannot easily upload a 5MB font file in this text-based response,
// We will generate the PDF but warn the user if characters are missing, 
// OR we can try to use a base64 encoded font subset if the prompt allowed massive outputs.
// 
// BETTER APPROACH FOR DEMO: We will use `html2canvas` logic or simple English headers with Chinese content 
// hoping the browser handles it, but jsPDF core doesn't support UTF-8 out of the box without a font.
// 
// ALTERNATIVE: We will generate a structured text file or a very simple HTML print view that the user can "Print to PDF".
// Implementing a robust "Print to PDF" button that triggers browser print is often better than jsPDF for CJK characters without font files.

export const triggerBrowserPrint = () => {
  window.print();
};

// Fallback logic for jsPDF if we had the font.
// Leaving this structure here if we wanted to extend it.
export const generatePDF = (itinerary: ItineraryResult) => {
    // This is a placeholder. 
    // Actual CJK PDF generation client-side requires loading a heavy font file (like NotoSansTC.ttf)
    // convert it to base64, and addFileToVFS.
    // For this specific constraint, "Print to PDF" via CSS @media print is the most reliable solution for CJK.
    triggerBrowserPrint();
};
