import React, { useState, useEffect } from 'react';
import TripForm from './components/TripForm';
import ItineraryView from './components/ItineraryView';
import { UserPreferences, ItineraryResult } from './types';
import { generateItinerary } from './services/geminiService';
import { getItineraryFromCloud } from './services/storageService';
import { Map, Loader2 } from 'lucide-react';

const App: React.FC = () => {
  const [step, setStep] = useState<'input' | 'result'>('input');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [itinerary, setItinerary] = useState<ItineraryResult | null>(null);
  const [currentPrefs, setCurrentPrefs] = useState<UserPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check URL for shared itinerary ID on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedId = params.get('shareId');
    
    if (sharedId) {
      setIsLoading(true);
      setLoadingMessage("正在載入分享的行程...");
      getItineraryFromCloud(sharedId)
        .then(data => {
          if (data) {
            setItinerary(data);
            setStep('result');
          } else {
            setError("找不到該行程或連結已過期。");
          }
        })
        .catch(err => {
          console.error(err);
          setError("讀取行程時發生錯誤。");
        })
        .finally(() => {
          setIsLoading(false);
          setLoadingMessage("");
        });
    }
  }, []);

  const handleFormSubmit = async (prefs: UserPreferences) => {
    setIsLoading(true);
    setLoadingMessage("AI 正在搜尋最新景點並規劃最佳路線...");
    setError(null);
    setCurrentPrefs(prefs);
    try {
      const result = await generateItinerary(prefs);
      setItinerary(result);
      setStep('result');
    } catch (err: any) {
      console.error(err);
      setError("規劃行程時發生錯誤，請稍後再試。請確保您已選取有效的 API Key。" + (err.message || ""));
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 pb-12 transition-colors duration-300">
      {/* Navbar */}
      <nav className="bg-slate-800 shadow-sm sticky top-0 z-50 print:hidden border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => {
                setStep('input');
                window.history.pushState({}, '', window.location.pathname);
            }}>
              <div className="bg-blue-600 p-2 rounded-lg">
                <Map className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-white tracking-tight">AI TravelGenius</span>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
           <div className="bg-red-900/50 border-l-4 border-red-500 p-4 mb-6 rounded-r animate-fade-in">
             <div className="flex">
               <div className="ml-3">
                 <p className="text-sm text-red-200">{error}</p>
               </div>
             </div>
           </div>
        )}

        {step === 'input' && !isLoading && (
          <div className="animate-fade-in-up">
            <div className="text-center mb-10">
              <h1 className="text-4xl font-extrabold text-white sm:text-5xl sm:tracking-tight lg:text-6xl">
                打造您的<span className="text-blue-500">完美旅程</span>
              </h1>
              <p className="mt-5 max-w-xl mx-auto text-xl text-slate-400">
                輸入您的目的地、預算與喜好，讓 Google Gemini AI 為您即時搜尋最新資訊，規劃最佳路線。
              </p>
            </div>
            <TripForm onSubmit={handleFormSubmit} isLoading={isLoading} />
          </div>
        )}

        {isLoading && (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center animate-fade-in">
                <Loader2 className="w-16 h-16 text-blue-500 animate-spin mb-6" />
                <h2 className="text-2xl font-bold text-white mb-2">請稍候</h2>
                <p className="text-slate-400">{loadingMessage}</p>
            </div>
        )}

        {step === 'result' && itinerary && !isLoading && (
          <ItineraryView 
            itinerary={itinerary} 
            travelers={currentPrefs?.travelers || 2} 
            onBack={() => {
                setStep('input');
                window.history.pushState({}, '', window.location.pathname);
            }} 
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-slate-800 border-t border-slate-700 mt-auto py-8 print:hidden">
        <div className="text-center text-slate-500 text-sm">
          &copy; {new Date().getFullYear()} AI TravelGenius. Powered by Google Gemini 2.5.
        </div>
      </footer>

      {/* Tailwind Custom Animations */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-up {
          animation: fadeInUp 0.6s ease-out forwards;
        }
        .animate-fade-in {
          animation: fadeInUp 0.4s ease-out forwards;
        }
        @media print {
          body { background: white !important; color: black !important; }
          .no-print { display: none !important; }
          #root { width: 100%; }
        }
      `}</style>
    </div>
  );
};

export default App;