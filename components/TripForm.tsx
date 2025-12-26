import React, { useState } from 'react';
import { UserPreferences, Hotel } from '../types';
import { CURRENCIES, TRAVEL_STYLES, FOCUS_AREAS, TRANSPORT_PREFS } from '../constants';
import { Plus, Trash2, MapPin, Calendar, Plane, Wallet, Settings, X, Users } from 'lucide-react';
import DateRangePicker from './DateRangePicker';

interface TripFormProps {
  onSubmit: (prefs: UserPreferences) => void;
  isLoading: boolean;
}

const TripForm: React.FC<TripFormProps> = ({ onSubmit, isLoading }) => {
  const [dates, setDates] = useState({ start: '', end: '', startTime: '09:00', endTime: '18:00' });
  const [airport, setAirport] = useState('');
  const [travelers, setTravelers] = useState(2); // Default 2 people
  const [budget, setBudget] = useState({ amount: 15000, currency: 'HKD' });
  const [style, setStyle] = useState<UserPreferences['style']>({
    pace: 'moderate',
    focus: 'balanced',
    transportPreference: 'balanced',
  });
  
  const [hotels, setHotels] = useState<Hotel[]>([
    { id: '1', name: '', location: '', checkIn: '', checkOut: '' }
  ]);

  // State to manage which hotel's date picker is open
  const [activeHotelDateId, setActiveHotelDateId] = useState<string | null>(null);

  const addHotel = () => {
    // Auto-calculate dates for the new hotel based on the previous one
    const lastHotel = hotels[hotels.length - 1];
    let defaultCheckIn = '';
    let defaultCheckOut = '';
    
    // If previous hotel has checkout, that becomes new checkin
    if (lastHotel && lastHotel.checkOut) {
        defaultCheckIn = lastHotel.checkOut;
        // If we have a total trip end date, assume this might be the last leg
        if (dates.end) {
            defaultCheckOut = dates.end;
        }
    }

    setHotels([...hotels, { 
      id: Date.now().toString(), 
      name: '', 
      location: '', 
      checkIn: defaultCheckIn, 
      checkOut: defaultCheckOut 
    }]);
  };

  const removeHotel = (id: string) => {
    if (hotels.length > 1) {
      setHotels(hotels.filter(h => h.id !== id));
    }
  };

  const updateHotel = (id: string, field: keyof Hotel, value: string) => {
    setHotels(hotels.map(h => h.id === id ? { ...h, [field]: value } : h));
  };

  const handleTripDateChange = (start: string, end: string) => {
    setDates(prev => ({ ...prev, start, end }));
    // Auto-fill first hotel dates if empty
    if (hotels.length === 1 && !hotels[0].checkIn && !hotels[0].checkOut && start && end) {
        updateHotel(hotels[0].id, 'checkIn', start);
        updateHotel(hotels[0].id, 'checkOut', end);
    }
  };

  const handleHotelDateChange = (id: string, start: string, end: string) => {
      // 1. Update current hotel dates
      const newHotels = hotels.map(h => {
          if (h.id === id) {
              return { ...h, checkIn: start, checkOut: end };
          }
          return h;
      });

      // 2. Smart Logic: Ripple effect to next hotel
      if (end) {
          const idx = newHotels.findIndex(h => h.id === id);
          // If there is a next hotel
          if (idx !== -1 && idx < newHotels.length - 1) {
              const nextHotel = newHotels[idx + 1];
              
              // Logic: Set next hotel check-in to current hotel check-out
              let nextCheckOut = nextHotel.checkOut;
              
              // If next hotel's checkout is now invalid (before its new checkin), reset it to trip end
              if (nextCheckOut && new Date(nextCheckOut) <= new Date(end)) {
                  nextCheckOut = dates.end || '';
              } else if (!nextCheckOut && dates.end) {
                  // If next hotel has no checkout, default to trip end
                  nextCheckOut = dates.end;
              }

              newHotels[idx + 1] = {
                  ...nextHotel,
                  checkIn: end,
                  checkOut: nextCheckOut
              };
          }
      }

      setHotels(newHotels);

      if (end) {
        // Close picker after selecting end date
        setTimeout(() => setActiveHotelDateId(null), 300); 
      }
  };

  const handleSubmit = (e: React.FormEvent) => {
    if (!dates.start || !dates.end) {
      alert("請選擇旅行日期區間");
      return;
    }
    e.preventDefault();
    onSubmit({ dates, travelers, airport, hotels, budget, style });
  };

  return (
    <div className="max-w-4xl mx-auto bg-slate-800 p-6 md:p-8 rounded-2xl shadow-xl border border-slate-700">
      <h2 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
        <Plane className="w-8 h-8 text-blue-500" />
        開始規劃您的旅程
      </h2>

      <form onSubmit={handleSubmit} className="space-y-8">
        
        {/* Section 1: Basic Info with Calendar */}
        <section className="space-y-4">
          <h3 className="text-xl font-semibold text-blue-300 flex items-center gap-2 border-b border-slate-700 pb-2">
            <Calendar className="w-5 h-5 text-blue-500" /> 日期與基本資訊
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">選擇旅行日期 (點擊開始，再點擊結束)</label>
                <div className="flex justify-center md:justify-start">
                    <DateRangePicker startDate={dates.start} endDate={dates.end} onChange={handleTripDateChange} />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                   <label className="block text-sm font-medium text-slate-400 mb-1">出發時間</label>
                   <input required type="time" className="w-full p-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 outline-none" 
                    value={dates.startTime} onChange={e => setDates({...dates, startTime: e.target.value})} />
                </div>
                <div>
                   <label className="block text-sm font-medium text-slate-400 mb-1">回程時間</label>
                   <input required type="time" className="w-full p-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 outline-none" 
                    value={dates.endTime} onChange={e => setDates({...dates, endTime: e.target.value})} />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">抵達/出發機場</label>
                <input required type="text" placeholder="例如：東京成田機場 (NRT)" className="w-full p-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none" 
                  value={airport} onChange={e => setAirport(e.target.value)} />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                    <span className="flex items-center gap-2"><Users className="w-4 h-4" /> 旅遊人數</span>
                </label>
                <input required type="number" min="1" max="50" className="w-full p-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 outline-none" 
                  value={travelers} onChange={e => setTravelers(parseInt(e.target.value) || 1)} />
              </div>

              <div className="bg-slate-700/50 p-4 rounded-lg border border-slate-700">
                <p className="text-sm text-slate-400">
                  <span className="text-blue-400 font-bold">已選日期：</span> 
                  {dates.start ? dates.start : '---'} 至 {dates.end ? dates.end : '---'}
                </p>
                {dates.start && dates.end && (
                  <p className="text-xs text-slate-500 mt-1">
                     共 {(new Date(dates.end).getTime() - new Date(dates.start).getTime()) / (1000 * 3600 * 24) + 1} 天
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Hotels */}
        <section className="space-y-4 relative z-0">
          <h3 className="text-xl font-semibold text-blue-300 flex items-center gap-2 border-b border-slate-700 pb-2">
            <MapPin className="w-5 h-5 text-blue-500" /> 住宿資訊
          </h3>
          <div className="space-y-4">
            {hotels.map((hotel, index) => (
              <div 
                key={hotel.id} 
                className={`p-4 bg-slate-700/50 rounded-lg border border-slate-600 relative transition-all duration-200 ${activeHotelDateId === hotel.id ? 'z-50 ring-2 ring-blue-500 bg-slate-700 shadow-2xl' : 'z-auto'}`}
              >
                <div className="flex justify-between items-center mb-3">
                  <span className="font-bold text-slate-200">酒店 #{index + 1}</span>
                  {hotels.length > 1 && (
                    <button type="button" onClick={() => removeHotel(hotel.id)} className="text-red-400 hover:text-red-300 transition">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input required placeholder="酒店名稱" className="p-2 bg-slate-800 border border-slate-600 rounded text-white placeholder-slate-500" 
                    value={hotel.name} onChange={e => updateHotel(hotel.id, 'name', e.target.value)} />
                  <input required placeholder="地點/地址" className="p-2 bg-slate-800 border border-slate-600 rounded text-white placeholder-slate-500" 
                    value={hotel.location} onChange={e => updateHotel(hotel.id, 'location', e.target.value)} />
                  
                  {/* Hotel Date Selection */}
                  <div className="md:col-span-2 relative">
                      <label className="text-xs text-slate-400 block mb-1">住宿日期</label>
                      <button 
                        type="button"
                        onClick={() => setActiveHotelDateId(activeHotelDateId === hotel.id ? null : hotel.id)}
                        className="w-full p-2 bg-slate-800 border border-slate-600 rounded text-white text-left flex justify-between items-center hover:bg-slate-750 transition"
                      >
                         <span>{hotel.checkIn || '入住日期'} &rarr; {hotel.checkOut || '退房日期'}</span>
                         <Calendar className="w-4 h-4 text-slate-400" />
                      </button>

                      {/* Popup DatePicker */}
                      {activeHotelDateId === hotel.id && (
                          <div className="absolute top-full left-0 z-50 mt-2 p-2 bg-slate-800 border border-slate-500 rounded-xl shadow-2xl animate-fade-in">
                             <div className="flex justify-end mb-2">
                                 <button type="button" onClick={() => setActiveHotelDateId(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4"/></button>
                             </div>
                             <DateRangePicker 
                                startDate={hotel.checkIn} 
                                endDate={hotel.checkOut} 
                                onChange={(s, e) => handleHotelDateChange(hotel.id, s, e)} 
                             />
                          </div>
                      )}
                  </div>
                </div>
              </div>
            ))}
            <button type="button" onClick={addHotel} className="flex items-center gap-2 text-sm text-blue-400 font-medium hover:text-blue-300 transition">
              <Plus className="w-4 h-4" /> 新增另一間酒店 (若是多城市旅遊)
            </button>
          </div>
        </section>

        {/* Section 3: Budget & Preferences */}
        <section className="space-y-4">
          <h3 className="text-xl font-semibold text-blue-300 flex items-center gap-2 border-b border-slate-700 pb-2">
            <Wallet className="w-5 h-5 text-blue-500" /> 預算與偏好
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">每人預算 (當地消費)</label>
              <div className="flex gap-2">
                <input required type="number" className="flex-1 p-2 bg-slate-700 border border-slate-600 rounded-lg text-white" 
                  value={budget.amount} onChange={e => setBudget({...budget, amount: Number(e.target.value)})} />
                <select className="w-32 p-2 bg-slate-700 border border-slate-600 rounded-lg text-white" 
                  value={budget.currency} onChange={e => setBudget({...budget, currency: e.target.value})}>
                  {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </div>
              <p className="text-xs text-slate-500 mt-1">AI 將自動換算匯率，並以此貨幣顯示所有費用</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">行程節奏</label>
              <select className="w-full p-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                value={style.pace} onChange={e => setStyle({...style, pace: e.target.value as any})}>
                {TRAVEL_STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">旅遊重點</label>
              <select className="w-full p-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                value={style.focus} onChange={e => setStyle({...style, focus: e.target.value as any})}>
                {FOCUS_AREAS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">交通權衡</label>
              <select className="w-full p-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                value={style.transportPreference} onChange={e => setStyle({...style, transportPreference: e.target.value as any})}>
                {TRANSPORT_PREFS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
        </section>

        <button 
          type="submit" 
          disabled={isLoading}
          className={`w-full py-4 px-6 rounded-xl text-white font-bold text-lg shadow-lg transition transform hover:-translate-y-1 ${isLoading ? 'bg-slate-600 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500'}`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <Settings className="animate-spin" /> AI 正在全力規劃中 (約需 30-60 秒)...
            </span>
          ) : (
            "開始生成行程"
          )}
        </button>

      </form>
    </div>
  );
};

export default TripForm;