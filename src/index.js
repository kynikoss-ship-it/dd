import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Trash2, 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  X,
  FileText
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp
} from 'firebase/firestore';

// --- Firebase Initialization ---
// --- Firebase Initialization ---

const firebaseConfig = {
  apiKey: "AIzaSyCO3bou4eMc-b4npOT99knhwBn_AAt2Kjc",
  authDomain: "monthly-planner-560a3.firebaseapp.com",
  projectId: "monthly-planner-560a3",
  storageBucket: "monthly-planner-560a3.firebasestorage.app",
  messagingSenderId: "1022766430649",
  appId: "1:1022766430649:web:f094b81940b863f0481e68"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'school-calendar-planner';

export default function App() {
  const [user, setUser] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ type: '', text: '' });

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth Error:", error);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const plansRef = collection(db, 'artifacts', appId, 'public', 'data', 'monthly_plans');
    const unsubscribe = onSnapshot(plansRef, 
      (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        data.sort((a, b) => {
          if (a.date === b.date) return b.createdAt - a.createdAt;
          return a.date > b.date ? 1 : -1;
        });
        setPlans(data);
        setLoading(false);
      },
      (err) => {
        console.error("Firestore Error:", err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (message.text) {
      const timer = setTimeout(() => setMessage({ type: '', text: '' }), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay(); 
  
  const calendarDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < firstDayIndex; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }
    return days;
  }, [year, month, daysInMonth, firstDayIndex]);

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  const handleDateClick = (dateStr) => {
    setSelectedDate(dateStr);
    setIsModalOpen(true);
  };

  const handleAddPlan = async (e) => {
    e.preventDefault();
    if (!user || !title.trim()) return;

    try {
      const plansRef = collection(db, 'artifacts', appId, 'public', 'data', 'monthly_plans');
      await addDoc(plansRef, {
        date: selectedDate,
        title,
        description,
        createdAt: serverTimestamp(),
        userId: user.uid
      });

      setMessage({ type: 'success', text: '일정이 등록되었습니다.' });
      setTitle('');
      setDescription('');
      setIsModalOpen(false);
    } catch (error) {
      setMessage({ type: 'error', text: '저장 실패' });
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'monthly_plans', id));
      setMessage({ type: 'success', text: '삭제되었습니다.' });
    } catch (error) {
      setMessage({ type: 'error', text: '삭제 실패' });
    }
  };

 if (loading) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 font-bold">
      <div className="animate-pulse">데이터 동기화 중...</div>
      <div className="p-4 bg-slate-100 rounded-lg text-sm font-mono">
        <p>1. 인증 상태: {user ? "✅ 로그인 완료 (UID: " + user.uid.substring(0,5) + "...)" : "⏳ 로그인 대기 중"}</p>
        <p>2. 데이터 개수: {plans.length}개</p>
      </div>
      {!user && <p className="text-red-500 text-xs">Firebase Console에서 '익명 로그인'이 활성화되었는지 확인하세요.</p>}
    </div>
  );
}

  const todayStr = new Date().toISOString().split('T')[0];
  const gridLayout = "grid-cols-[0.6fr_1.2fr_1.2fr_1.2fr_1.2fr_1.2fr_0.6fr]";

  return (
    <div className="min-h-screen bg-white p-2 md:p-4 text-slate-900 font-sans">
      <div className="max-w-full mx-auto space-y-4">
        
        <header className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-6">
             <div className="flex items-center bg-slate-100 rounded-xl p-1.5 border border-slate-300 shadow-sm">
                <button onClick={prevMonth} className="p-2 hover:bg-white rounded-lg transition-all"><ChevronLeft size={24}/></button>
                <span className="px-6 font-black min-w-[180px] text-center text-2xl tracking-tighter">{year}년 {month + 1}월</span>
                <button onClick={nextMonth} className="p-2 hover:bg-white rounded-lg transition-all"><ChevronRight size={24}/></button>
              </div>
              <h1 className="hidden lg:block text-3xl font-black text-slate-900 tracking-tighter">월중 행사표</h1>
          </div>
          <div className="text-sm font-bold bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500">
            날짜 클릭 시 일정 추가
          </div>
        </header>

        {message.text && (
          <div className={`fixed top-8 right-8 z-[200] p-5 rounded-2xl flex items-center gap-4 shadow-2xl animate-in fade-in slide-in-from-top-6 ${message.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
            <span className="font-black text-lg">{message.text}</span>
          </div>
        )}

        <div className="w-full bg-slate-900 p-[1.5px] shadow-lg rounded-sm overflow-x-auto">
          <div className={`grid ${gridLayout} min-w-[1100px]`}>
            {['일', '월', '화', '수', '목', '금', '토'].map((d, idx) => (
              <div key={d} className={`py-3 text-center text-lg font-black border-r border-slate-900 last:border-r-0 bg-[#FEFF9C] ${idx === 0 ? 'text-red-600' : idx === 6 ? 'text-blue-600' : 'text-slate-900'}`}>
                {d}
              </div>
            ))}

            {calendarDays.map((day, idx) => {
              if (day === null) return <div key={`empty-${idx}`} className="bg-slate-50 border-r border-t border-slate-900 h-[160px]"></div>;
              
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayPlans = plans.filter(p => p.date === dateStr);
              const isToday = todayStr === dateStr;
              const isSunday = idx % 7 === 0;
              const isSaturday = idx % 7 === 6;

              return (
                <div 
                  key={day} 
                  onClick={() => handleDateClick(dateStr)}
                  className={`min-h-[160px] p-2 border-r border-t border-slate-900 group cursor-pointer transition-colors relative
                    ${isSunday ? 'bg-[#FFF2F2]' : isSaturday ? 'bg-[#F2F9FF]' : 'bg-white hover:bg-slate-50'}
                  `}
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className={`text-xl font-black ${isToday ? 'bg-blue-600 text-white w-9 h-9 flex items-center justify-center rounded-full shadow-md' : isSunday ? 'text-red-600' : isSaturday ? 'text-blue-600' : 'text-slate-900'}`}>
                      {day}
                    </span>
                  </div>
                  
                  <div className="space-y-1 mt-1">
                    {dayPlans.map(p => (
                      <div key={p.id} className="group/item flex items-start justify-between gap-1 text-[16px] leading-[1.3] py-1 px-1.5 rounded hover:bg-black/5 transition-colors">
                        <span className={`font-bold break-all tracking-tight ${isSunday ? 'text-red-700' : 'text-slate-900'}`}>
                          {p.title}
                        </span>
                        <button 
                          onClick={(e) => handleDelete(e, p.id)} 
                          className="opacity-0 group-hover/item:opacity-100 text-slate-400 hover:text-red-600 shrink-0 p-0.5"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="absolute inset-0 border-[3px] border-transparent group-hover:border-blue-400/50 pointer-events-none transition-colors"></div>
                </div>
              );
            })}
          </div>
        </div>

        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-slate-200">
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                  <CalendarIcon size={24} className="text-blue-600" />
                  {selectedDate} 일정 추가
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-white rounded-full text-slate-400 border border-slate-200">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleAddPlan} className="p-6 space-y-6">
                <div>
                  <label className="text-sm font-black text-slate-500 uppercase mb-2 block tracking-tight">일정 내용</label>
                  <input 
                    type="text" 
                    placeholder="예: 기말고사, 개교기념일 등"
                    value={title}
                    autoFocus
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full p-4 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:border-blue-500 outline-none font-black text-xl text-slate-900 transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-black text-slate-500 uppercase mb-2 block tracking-tight">세부 내용 (선택)</label>
                  <textarea 
                    rows="3"
                    placeholder="추가 설명이 필요한 경우 입력"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full p-4 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:border-blue-500 outline-none font-bold text-lg resize-none"
                  ></textarea>
                </div>
                <div className="flex gap-3 pt-2">
                  <button 
                    type="button" 
                    onClick={() => setIsModalOpen(false)} 
                    className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-black text-lg"
                  >
                    취소
                  </button>
                  <button 
                    type="submit" 
                    className="flex-[2] py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-lg shadow-xl shadow-blue-100"
                  >
                    저장하기
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
import ReactDOM from 'react-dom/client';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
