import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
}

const DateRangePicker: React.FC<DateRangePickerProps> = ({ startDate, endDate, onChange }) => {
  // Initialize view based on start date or today
  const [viewDate, setViewDate] = useState(() => {
    return startDate ? new Date(startDate) : new Date();
  });

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const getDaysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfMonth = (y: number, m: number) => new Date(y, m, 1).getDay();

  const daysInMonth = getDaysInMonth(year, month);
  const startDay = getFirstDayOfMonth(year, month);
  
  const formatDate = (date: Date) => {
    // Manually format to YYYY-MM-DD to avoid timezone issues
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const handleDateClick = (day: number) => {
    const clickedDate = new Date(year, month, day);
    const clickedStr = formatDate(clickedDate);

    // Logic:
    // 1. If range is full (Start & End exist) -> Reset, Start = Clicked, End = ''
    // 2. If no start -> Start = Clicked
    // 3. If start exists but no end -> 
    //    If clicked < start -> Reset, Start = Clicked (Correcting start)
    //    If clicked >= start -> End = Clicked
    
    if (startDate && endDate) {
      // Case 1: Full range exists, restart selection
      onChange(clickedStr, '');
    } else if (!startDate) {
      // Case 2: No start
      onChange(clickedStr, '');
    } else {
      // Case 3: Start exists, waiting for end
      const start = new Date(startDate);
      // We compare timestamps to verify order
      if (clickedDate.getTime() < start.getTime()) {
        // User clicked a date BEFORE the current start, update start instead
        onChange(clickedStr, '');
      } else {
        // User clicked valid end date
        onChange(startDate, clickedStr);
      }
    }
  };

  const changeMonth = (delta: number) => {
    setViewDate(new Date(year, month + delta, 1));
  };

  const isSelected = (day: number) => {
    const currentStr = formatDate(new Date(year, month, day));
    return currentStr === startDate || currentStr === endDate;
  };

  const isInRange = (day: number) => {
    if (!startDate || !endDate) return false;
    const date = new Date(year, month, day).getTime();
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    return date > start && date < end;
  };

  return (
    <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg select-none w-full max-w-[350px]">
      <div className="flex justify-between items-center mb-4 text-slate-200">
        <button type="button" onClick={() => changeMonth(-1)} className="p-1 hover:bg-slate-700 rounded-full">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="font-bold">
          {year}年 {month + 1}月
        </div>
        <button type="button" onClick={() => changeMonth(1)} className="p-1 hover:bg-slate-700 rounded-full">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
      
      <div className="grid grid-cols-7 gap-1 text-center text-sm mb-2 text-slate-400 font-medium">
        <div>日</div><div>一</div><div>二</div><div>三</div><div>四</div><div>五</div><div>六</div>
      </div>
      
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: startDay }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const selected = isSelected(day);
          const inRange = isInRange(day);
          
          return (
            <div
              key={day}
              onClick={() => handleDateClick(day)}
              className={`
                h-10 w-full flex items-center justify-center rounded-lg cursor-pointer transition text-sm relative
                ${selected ? 'bg-blue-600 text-white font-bold z-10 shadow-md' : ''}
                ${inRange ? 'bg-blue-900/40 text-blue-200 rounded-none' : ''}
                ${!selected && !inRange ? 'text-slate-300 hover:bg-slate-700 hover:text-white' : ''}
                ${inRange && day === 1 ? 'rounded-l-lg' : ''}
                ${inRange && day === daysInMonth ? 'rounded-r-lg' : ''}
              `}
            >
              {day}
            </div>
          );
        })}
      </div>
      <div className="mt-4 text-xs text-center text-slate-400 border-t border-slate-700 pt-2">
        {!startDate ? "請點擊 出發 日期" : !endDate ? "請點擊 回程 日期" : "已選擇區間 (再次點擊可重選)"}
      </div>
    </div>
  );
};

export default DateRangePicker;