
import React, { useState } from 'react';
import { ItineraryResult } from '../types';
import { DollarSign, Navigation, ExternalLink, Printer, Map as MapIcon, List, Users, Share2, MapPin, Download, Info, Lightbulb, Tag, AlertTriangle, Clock } from 'lucide-react';
import { triggerBrowserPrint } from '../utils/pdfGenerator';
import { downloadKML } from '../utils/kmlGenerator';
import { saveItineraryToCloud } from '../services/storageService';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import MapComponent from './MapComponent';

interface ItineraryViewProps {
  itinerary: ItineraryResult;
  travelers: number;
  onBack: () => void;
}

const ItineraryView: React.FC<ItineraryViewProps> = ({ itinerary, travelers, onBack }) => {
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [isSaving, setIsSaving] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [showKmlHelp, setShowKmlHelp] = useState(false);

  // Prepare chart data & calculations
  const costData = itinerary.days.map(day => ({
    name: `Day ${day.dayNumber}`,
    perPerson: day.activities.reduce((acc, act) => acc + (act.cost || 0) + (act.transportCost || 0), 0)
  }));

  const totalPerPerson = costData.reduce((acc, item) => acc + item.perPerson, 0);
  const totalGroup = totalPerPerson * travelers;
  
  const isOverBudget = itinerary.totalCostEstimate ? totalGroup > itinerary.totalCostEstimate : false;

  const handleShare = async () => {
    setIsSaving(true);
    try {
        const id = await saveItineraryToCloud(itinerary);
        const url = `${window.location.origin}${window.location.pathname}?shareId=${id}`;
        setShareUrl(url);
    } catch (e) {
        alert("儲存行程失敗，請稍後再試。");
    } finally {
        setIsSaving(false);
    }
  };

  const copyToClipboard = () => {
      if (shareUrl) {
          navigator.clipboard.writeText(shareUrl);
          setCopySuccess(true);
          setTimeout(() => setCopySuccess(false), 2000);
      }
  };

  const handleKmlExport = () => {
      downloadKML(itinerary);
      setShowKmlHelp(true);
  };

  const getDayDirectionsUrl = (activities: typeof itinerary.days[0]['activities']) => {
      const points = activities.filter(a => a.latitude && a.longitude);
      if (points.length < 2) return null;

      const origin = `${points[0].latitude},${points[0].longitude}`;
      const destination = `${points[points.length - 1].latitude},${points[points.length - 1].longitude}`;
      
      let waypoints = '';
      if (points.length > 2) {
          waypoints = '&waypoints=' + points.slice(1, points.length - 1).map(p => `${p.latitude},${p.longitude}`).join('|');
      }

      return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints}&travelmode=driving`;
  };

  const getNavUrl = (act: typeof itinerary.days[0]['activities'][0]) => {
      if (act.latitude && act.longitude) {
          return `https://www.google.com/maps/search/?api=1&query=${act.latitude},${act.longitude}`;
      } else {
          return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(act.placeName)}`;
      }
  };

  // Helper to safely format currency
  const fmtMoney = (val?: number) => val ? val.toLocaleString() : '0';

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-fade-in print:max-w-none print:w-full print:text-black">
      
      {/* Header & Actions */}
      <div className="bg-slate-800 p-6 rounded-2xl shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-6 print:shadow-none print:border-b print:bg-white print:text-black print:mb-4">
        <div className="w-full md:w-auto">
          <button onClick={onBack} className="text-sm text-slate-400 hover:text-white mb-2 print:hidden flex items-center gap-1">
            &larr; 返回編輯 / 新行程
          </button>
          <h1 className="text-3xl font-bold text-blue-400 print:text-blue-800">{itinerary.tripTitle}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
             <span className="text-slate-300 print:text-gray-600">{itinerary.summary}</span>
             <span className="bg-slate-700 text-slate-200 text-xs px-2 py-1 rounded-full flex items-center gap-1 print:border print:bg-gray-100 print:text-black whitespace-nowrap">
                <Users className="w-3 h-3" /> {travelers} 人
             </span>
          </div>
        </div>

        <div className="w-full md:w-auto flex flex-col gap-3">
          {/* Financial Summary */}
          <div className={`text-right bg-slate-750 p-3 rounded-lg border ${isOverBudget ? 'border-red-500/50 bg-red-900/10' : 'border-slate-700/50'} print:border-none print:bg-transparent print:p-0`}>
            <div className="text-xs text-slate-400 print:text-gray-600">總支出預估 ({travelers}人)</div>
            <div className={`text-2xl font-bold leading-none my-1 ${isOverBudget ? 'text-red-400' : 'text-green-400'} print:text-black`}>
                {itinerary.currency} {totalGroup.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 print:text-gray-500">
                每人: {itinerary.currency} {totalPerPerson.toLocaleString()}
            </div>
            {isOverBudget && <div className="text-xs text-red-400 mt-1 flex justify-end gap-1"><AlertTriangle className="w-3 h-3"/> 超出預算</div>}
          </div>

          <div className="grid grid-cols-2 sm:flex gap-2 print:hidden">
              <button onClick={handleShare} disabled={isSaving || !!shareUrl} className="flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-3 md:py-2 rounded-lg hover:bg-indigo-500 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                {isSaving ? <span className="animate-spin">⌛</span> : <Share2 className="w-4 h-4" />}
                {shareUrl ? '已建立' : '分享'}
              </button>
              
              <button onClick={handleKmlExport} className="flex items-center justify-center gap-2 bg-emerald-600 text-white px-4 py-3 md:py-2 rounded-lg hover:bg-emerald-500 transition text-sm font-medium">
                <Download className="w-4 h-4" /> 
                <span className="hidden md:inline">匯出地圖</span>
                <span className="md:hidden">KML</span>
              </button>

              <button onClick={triggerBrowserPrint} className="flex items-center justify-center gap-2 bg-slate-700 text-white px-4 py-3 md:py-2 rounded-lg hover:bg-slate-600 transition text-sm font-medium col-span-2 sm:col-span-1">
                <Printer className="w-4 h-4" /> 
                <span className="hidden md:inline">列印</span>
                <span className="md:hidden">PDF</span>
              </button>
          </div>
        </div>
      </div>

      {showKmlHelp && (
          <div className="bg-emerald-900/30 border border-emerald-500/50 p-4 rounded-xl flex items-start gap-4 animate-fade-in print:hidden">
            <Info className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-emerald-300 font-bold mb-1">已下載地圖檔案 (.kml)</h3>
              <p className="text-sm text-emerald-100/80 mb-2">
                請開啟 <a href="https://www.google.com/mymaps" target="_blank" className="underline text-white font-bold">Google My Maps</a>，建立新地圖並匯入此檔案。
              </p>
              <button onClick={() => setShowKmlHelp(false)} className="mt-2 text-xs bg-emerald-800 hover:bg-emerald-700 px-3 py-1 rounded text-white">關閉</button>
            </div>
          </div>
      )}

      {shareUrl && (
          <div className="bg-indigo-900/30 border border-indigo-500/50 p-4 rounded-xl flex flex-col md:flex-row items-center gap-4 animate-fade-in print:hidden">
              <div className="flex-1 w-full text-center md:text-left">
                  <h3 className="text-indigo-300 font-bold mb-1">分享連結已建立</h3>
                  <div className="flex gap-2">
                      <input readOnly value={shareUrl} className="flex-1 bg-slate-900 border border-indigo-500/30 rounded px-3 py-2 text-sm text-indigo-100 focus:outline-none" />
                      <button onClick={copyToClipboard} className={`px-4 py-2 rounded text-sm font-bold transition whitespace-nowrap ${copySuccess ? 'bg-green-600 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}>
                          {copySuccess ? '已複製' : '複製'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Toggle View */}
      <div className="flex gap-2 print:hidden sticky top-[70px] z-30 bg-slate-900 py-2">
        <button onClick={() => setViewMode('list')} className={`flex-1 md:flex-none flex justify-center items-center gap-2 px-6 py-3 rounded-lg transition font-medium ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
            <List className="w-4 h-4" /> 行程列表
        </button>
        <button onClick={() => setViewMode('map')} className={`flex-1 md:flex-none flex justify-center items-center gap-2 px-6 py-3 rounded-lg transition font-medium ${viewMode === 'map' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
            <MapIcon className="w-4 h-4" /> 地圖全覽
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 print:hidden">
        <div className={`lg:col-span-2 bg-slate-800 rounded-2xl shadow-lg overflow-hidden h-[400px] md:h-96 print:h-96 print:mb-6 ${viewMode === 'list' ? 'hidden lg:block' : 'block'}`}>
            <MapComponent itinerary={itinerary} />
        </div>
        <div className={`bg-slate-800 p-6 rounded-2xl shadow-lg print:break-inside-avoid print:bg-white print:border print:mb-6 ${viewMode === 'map' ? 'hidden lg:block' : 'block'}`}>
          <h3 className="text-lg font-bold text-slate-200 mb-4 print:text-black">每人每日預算 ({itinerary.currency})</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', color: '#f1f5f9' }} formatter={(value) => `${itinerary.currency} ${Number(value).toLocaleString()}`} />
                <Bar dataKey="perPerson" fill="#3b82f6" radius={[4, 4, 0, 0]}>
                  {costData.map((entry, index) => (<Cell key={`cell-${index}`} fill={`hsl(${210 + index * 10}, 80%, 60%)`} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className={`space-y-8 ${viewMode === 'map' ? 'hidden' : 'block'} print:block`}>
        {itinerary.days.map((day) => {
          const dayMapsUrl = getDayDirectionsUrl(day.activities);
          return (
          <div key={day.dayNumber} className="bg-slate-800 rounded-2xl shadow-lg overflow-hidden print:shadow-none print:border print:border-gray-300 print:mb-8 print:break-inside-avoid print:bg-white">
            <div className="bg-blue-600 text-white p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 print:bg-blue-700 print:text-white">
              <div className="flex-1">
                  <h2 className="text-xl font-bold flex items-center gap-2">第 {day.dayNumber} 天 - {day.date}</h2>
                  <span className="text-blue-100 font-medium text-sm mt-1 block">{day.summary}</span>
              </div>
              {dayMapsUrl && (
                  <a href={dayMapsUrl} target="_blank" rel="noopener noreferrer" className="w-full md:w-auto flex items-center justify-center gap-2 bg-white text-blue-600 px-4 py-2 rounded-lg font-bold text-sm shadow hover:bg-blue-50 transition print:hidden">
                      <MapPin className="w-4 h-4" /> 開啟本日導航
                  </a>
              )}
            </div>
            
            <div className="p-4 md:p-6 relative">
              <div className="absolute left-6 md:left-8 top-6 bottom-6 w-0.5 bg-slate-700 hidden md:block print:bg-gray-300"></div>
              <div className="space-y-6 md:space-y-8">
                {day.activities.map((activity, idx) => (
                  <div key={idx} className="relative flex flex-col md:flex-row gap-4 md:gap-8 group print:gap-4">
                    <div className="flex-none md:w-32 flex flex-row md:flex-col items-center md:items-end gap-3 md:gap-0 bg-slate-800 z-10 print:bg-white print:items-start print:w-20">
                      <div className="font-bold text-slate-200 text-lg print:text-black">{activity.time}</div>
                      <div className="text-xs text-slate-400 bg-slate-700 px-2 py-1 rounded-full print:bg-gray-100 print:text-gray-800 print:border print:border-gray-300 whitespace-nowrap">{activity.isMeal ? '餐飲' : '活動'}</div>
                    </div>

                    <div className={`hidden md:block absolute left-[-5px] top-2 w-3 h-3 rounded-full border-2 border-slate-800 shadow-sm z-20 print:border-white ${activity.isMeal ? 'bg-orange-400 print:bg-orange-500' : 'bg-blue-500 print:bg-blue-600'}`}></div>

                    <div className="flex-1 bg-slate-700/50 p-4 rounded-xl hover:bg-slate-700 transition border border-slate-700 print:bg-white print:border-gray-200 print:shadow-sm print:p-2">
                      <div className="flex flex-col md:flex-row justify-between items-start gap-2">
                        <div className="flex flex-col gap-1">
                            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2 print:text-black">
                              {activity.placeName}
                              {activity.rating && <span className="text-xs font-normal text-yellow-500 bg-yellow-900/30 px-1.5 py-0.5 rounded print:bg-white print:text-yellow-700 print:border print:border-yellow-500">★ {activity.rating}</span>}
                            </h3>
                            {/* Duration Display */}
                            {activity.duration && (
                                <div className="flex items-center gap-1 text-xs text-slate-400 print:text-gray-600">
                                    <Clock className="w-3 h-3" />
                                    <span>預計停留: {activity.duration}</span>
                                </div>
                            )}
                        </div>
                        
                        <div className="flex gap-2 w-full md:w-auto mt-2 md:mt-0 print:hidden">
                            <a href={getNavUrl(activity)} target="_blank" rel="noopener noreferrer" className="flex-1 md:flex-none flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-xs font-bold transition">
                                <Navigation className="w-3 h-3" /> 導航
                            </a>
                            
                            {/* Website Button Logic */}
                            {activity.website ? (
                                <a href={activity.website} target="_blank" rel="noopener noreferrer" className="flex-1 md:flex-none flex items-center justify-center gap-1 bg-slate-600 hover:bg-slate-500 text-slate-200 px-3 py-1.5 rounded text-xs font-medium transition">
                                    <ExternalLink className="w-3 h-3" /> 官網
                                </a>
                            ) : activity.googleMapsUri ? (
                                <a href={activity.googleMapsUri} target="_blank" rel="noopener noreferrer" className="flex-1 md:flex-none flex items-center justify-center gap-1 bg-slate-600 hover:bg-slate-500 text-slate-200 px-3 py-1.5 rounded text-xs font-medium transition">
                                    <ExternalLink className="w-3 h-3" /> 詳情
                                </a>
                            ) : null}
                        </div>
                      </div>
                      
                      {(activity.reasoning || (activity.matchTags && activity.matchTags.length > 0)) && (
                        <div className="mt-3 mb-2 bg-slate-800/60 p-3 rounded border-l-2 border-blue-400 print:bg-gray-50 print:border-blue-600">
                          {activity.reasoning && (
                            <div className="flex items-start gap-2 mb-2 text-sm text-blue-200 print:text-blue-800">
                              <Lightbulb className="w-4 h-4 mt-0.5 flex-shrink-0" />
                              <p>{activity.reasoning}</p>
                            </div>
                          )}
                          {activity.matchTags && activity.matchTags.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {activity.matchTags.map((tag, tIdx) => (
                                <span key={tIdx} className="inline-flex items-center gap-1 text-xs bg-slate-600 text-slate-300 px-2 py-0.5 rounded-full print:bg-gray-200 print:text-black">
                                  <Tag className="w-3 h-3" /> {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <p className="text-slate-300 mt-2 text-sm print:text-gray-700 leading-relaxed">{activity.description}</p>
                      
                      <div className="mt-4 border-t border-slate-600 pt-3 grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 text-sm print:border-gray-300">
                         <div className="flex items-center justify-between bg-slate-800/50 p-2 rounded print:bg-gray-50 print:border print:border-gray-200">
                            <div className="flex items-center gap-2 text-slate-300 print:text-black">
                                <DollarSign className="w-4 h-4 text-green-400 print:text-green-600" />
                                <span>{activity.isMeal ? '餐飲' : '門票/活動'}</span>
                            </div>
                            <div className="text-right">
                                <div className="text-green-400 font-bold print:text-green-700">{itinerary.currency} {fmtMoney(activity.cost * travelers)}</div>
                                <div className="text-xs text-slate-500 print:text-gray-500">單人: {fmtMoney(activity.cost)}</div>
                            </div>
                         </div>

                         <div className="flex items-center justify-between bg-slate-800/50 p-2 rounded print:bg-gray-50 print:border print:border-gray-200">
                            <div className="flex items-center gap-2 text-slate-300 print:text-black">
                                <Navigation className="w-4 h-4 text-indigo-400 print:text-indigo-600" />
                                <span>{activity.transportMethod || '步行/其他'} ({activity.transportTimeMinutes || 0}分)</span>
                            </div>
                            <div className="text-right">
                                <div className="text-indigo-400 font-bold print:text-indigo-700">
                                    {(activity.transportCost && activity.transportCost > 0) ? `${itinerary.currency} ${fmtMoney(activity.transportCost * travelers)}` : '免費'}
                                </div>
                                {(activity.transportCost && activity.transportCost > 0) ? (
                                    <div className="text-xs text-slate-500 print:text-gray-500">單人: {fmtMoney(activity.transportCost)}</div>
                                ) : null}
                            </div>
                         </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )})}
      </div>

      <div className="bg-slate-800 rounded-2xl shadow-lg p-6 overflow-hidden break-before-page print:bg-white print:border print:border-gray-300 print:shadow-none">
          <h2 className="text-2xl font-bold text-white mb-6 print:text-black">詳細支出報表 ({itinerary.currency})</h2>
          <div className="overflow-x-auto">
              <table className="w-full text-sm text-left text-slate-300 print:text-black min-w-[600px]">
                  <thead className="text-xs text-slate-400 uppercase bg-slate-700 print:bg-gray-200 print:text-black">
                      <tr>
                          <th className="px-4 py-3 rounded-tl-lg">日期</th>
                          <th className="px-4 py-3">項目</th>
                          <th className="px-4 py-3">類別</th>
                          <th className="px-4 py-3 text-right">單人費用</th>
                          <th className="px-4 py-3 rounded-tr-lg text-right">總計 ({travelers}人)</th>
                      </tr>
                  </thead>
                  <tbody>
                      {itinerary.days.map((day) => (
                          <React.Fragment key={day.dayNumber}>
                              <tr className="bg-slate-750 font-bold border-b border-slate-700 print:bg-gray-100 print:border-gray-300">
                                  <td colSpan={5} className="px-4 py-2 text-blue-400 print:text-blue-800">
                                      Day {day.dayNumber} - {day.date} ({day.summary})
                                  </td>
                              </tr>
                              {day.activities.map((act, i) => (
                                  <React.Fragment key={`${day.dayNumber}-${i}`}>
                                    <tr className="border-b border-slate-700 hover:bg-slate-700/50 print:border-gray-200">
                                        <td className="px-4 py-2 opacity-50">{act.time}</td>
                                        <td className="px-4 py-2 font-medium">
                                            {act.placeName}
                                            {act.duration && <span className="block text-xs text-slate-400 print:text-gray-500">停留: {act.duration}</span>}
                                        </td>
                                        <td className="px-4 py-2">{act.isMeal ? '餐飲' : '活動'}</td>
                                        <td className="px-4 py-2 text-right">{fmtMoney(act.cost)}</td>
                                        <td className="px-4 py-2 text-right font-bold">{fmtMoney((act.cost || 0) * travelers)}</td>
                                    </tr>
                                    {(act.transportCost! > 0 || act.transportTimeMinutes! > 10) && (
                                        <tr className="border-b border-slate-700 bg-slate-800/30 print:border-gray-200 print:bg-gray-50">
                                            <td className="px-4 py-2"></td>
                                            <td className="px-4 py-2 text-xs italic text-slate-400 print:text-gray-600">交通: {act.transportMethod || '移動'}</td>
                                            <td className="px-4 py-2 text-xs">交通</td>
                                            <td className="px-4 py-2 text-right text-xs">{fmtMoney(act.transportCost)}</td>
                                            <td className="px-4 py-2 text-right text-xs">{fmtMoney((act.transportCost || 0) * travelers)}</td>
                                        </tr>
                                    )}
                                  </React.Fragment>
                              ))}
                              <tr className="bg-slate-700/30 font-bold print:bg-gray-50 border-b-2 border-slate-600 print:border-gray-400">
                                  <td colSpan={3} className="px-4 py-2 text-right">Day {day.dayNumber} 小計:</td>
                                  <td className="px-4 py-2 text-right">
                                      {fmtMoney(day.activities.reduce((sum, a) => sum + (a.cost||0) + (a.transportCost || 0), 0))}
                                  </td>
                                  <td className="px-4 py-2 text-right text-green-400 print:text-black">
                                      {fmtMoney(day.activities.reduce((sum, a) => sum + (a.cost||0) + (a.transportCost || 0), 0) * travelers)}
                                  </td>
                              </tr>
                          </React.Fragment>
                      ))}
                  </tbody>
                  <tfoot className="bg-slate-700 font-bold text-white print:bg-gray-800 print:text-white">
                      <tr>
                          <td colSpan={3} className="px-4 py-4 text-right text-lg">總計</td>
                          <td className="px-4 py-4 text-right text-lg">{fmtMoney(totalPerPerson)}</td>
                          <td className="px-4 py-4 text-right text-xl text-green-400 print:text-green-300">{fmtMoney(totalGroup)}</td>
                      </tr>
                  </tfoot>
              </table>
          </div>
      </div>
    </div>
  );
};

export default ItineraryView;