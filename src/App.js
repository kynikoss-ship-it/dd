import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, X 
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, query
} from 'firebase/firestore';

// --- 환경 변수 및 설정 ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'monthly-planner-560a3';

// 한국 시간 기준 YYYY-MM-DD 문자열 생성 함수
const getKSTDateString = (date = new Date()) => {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Seoul'
  }).format(date).replace(/\. /g, '-').replace(/\./g, '');
};

export default function App() {
  const [user, setUser] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ type: '', text: '' });

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(getKSTDateString());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 1. 인증 로직 (시스템 규칙 준수)
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth Error:", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. 실시간 데이터 동기화 (표준 경로 사용)
  useEffect(() => {
    if (!user) return;

    // 규칙 1에 따른 데이터 경로 설정
    const plansRef = collection(db, 'artifacts', appId, 'public', 'data', 'monthly_plans');
    
    const unsubscribe = onSnapshot(plansRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // 클라이언트 측 정렬 (규칙 2 준수)
      data.sort((a, b) => (a.date > b.date ? 1 : -1));
      setPlans(data);
      setLoading(false);
    }, (err) => {
      console.error("Firestore Error:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  // 알림 메시지 자동 삭제
  useEffect(() => {
    if (message.text) {
      const timer = setTimeout(() => setMessage({ type: '', text: '' }), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // 달력 계산 로직
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay(); 
  
  const calendarDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < firstDayIndex; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
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
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'monthly_plans', id);
      await deleteDoc(docRef);
      setMessage({ type: 'success', text: '삭제되었습니다.' });
    } catch (error) {
      setMessage({ type: 'error', text: '삭제 실패' });
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen font-sans font-bold gap-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <div className="text-slate-500 text-lg">교무실 학사 일정을 동기화 중입니다...</div>
      </div>
    );
  }

  // 오늘 날짜 계산 (KST 기준)
  const todayStr = getKSTDateString();
  const gridLayout = "grid-cols-[0.6fr_1.2fr_1.2fr_1.2fr_1.2fr_1.2fr_0.6fr]";

  return (
    <div className="min-h-screen bg-white p-2 md:p-4 text-slate-900 font-sans selection:bg-blue-100">
      <div className="max-w-full mx-auto space-y-4">
        <header className="flex items-center justify-between mb-4 px-1">
          <div className="flex items-center gap-6">
             <div className="flex items-center bg-slate-100 rounded-xl p-1.5 border border-slate-300 shadow-sm">
                <button onClick={prevMonth} className="p-2 hover:bg-white rounded-lg transition-all active:scale-95"><ChevronLeft size={24}/></button>
                <span className="px-6 font-black min-w-[180px] text-center text-2xl tracking-tighter">{year}년 {month + 1}월</span>
                <button onClick={nextMonth} className="p-2 hover:bg-white rounded-lg transition-all active:scale-95"><ChevronRight size={24}/></button>
              </div>
              <h1 className="hidden lg:block text-3xl font-black text-slate-900 tracking-tighter">School Academic Calendar</h1>
          </div>
          <div className="text-sm font-bold bg-blue-50 px-4 py-2 rounded-xl border border-blue-100 text-blue-600 shadow-sm">
            💡 날짜를 클릭하여 주요 학사 일정을 입력하세요
          </div>
        </header>

        {message.text && (
          <div className={`fixed top-8 right-8 z-[200] p-5 rounded-2xl flex items-center gap-4 shadow-2xl animate-bounce ${message.type === 'success' ? 'bg-slate-900' : 'bg-red-600'} text-white`}>
            <span className="font-black text-lg">{message.text}</span>
          </div>
        )}

        <div className="w-full bg-slate-900 p-[2px] shadow-2xl rounded-lg overflow-x-auto border-2 border-slate-900">
          <div className={`grid ${gridLayout} min-w-[1200px]`}>
            {['일', '월', '화', '수', '목', '금', '토'].map((d, idx) => (
              <div key={d} className={`py-4 text-center text-xl font-black border-r border-slate-900 last:border-r-0 bg-[#FEFF9C] ${idx === 0 ? 'text-red-600' : idx === 6 ? 'text-blue-600' : 'text-slate-900'}`}>
                {d}
              </div>
            ))}

            {calendarDays.map((day, idx) => {
              if (day === null) return <div key={`empty-${idx}`} className="bg-slate-50 border-r border-t border-slate-900 h-[180px]"></div>;
              
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayPlans = plans.filter(p => p.date === dateStr);
              const isToday = todayStr === dateStr;
              const isSunday = idx % 7 === 0;
              const isSaturday = idx % 7 === 6;

              return (
                <div 
                  key={day} 
                  onClick={() => handleDateClick(dateStr)}
                  className={`min-h-[180px] p-3 border-r border-t border-slate-900 group cursor-pointer transition-all relative
                    ${isSunday ? 'bg-[#FFF2F2]' : isSaturday ? 'bg-[#F2F9FF]' : 'bg-white hover:bg-blue-50/30'}
                  `}
                >
                  <div className="flex justify-between items-start mb-3">
                    <span className={`text-2xl font-black ${isToday ? 'bg-blue-600 text-white w-10 h-10 flex items-center justify-center rounded-full shadow-lg ring-4 ring-blue-100' : isSunday ? 'text-red-600' : isSaturday ? 'text-blue-600' : 'text-slate-900'}`}>
                      {day}
                    </span>
                  </div>
                  
                  <div className="space-y-2 mt-2">
                    {dayPlans.map(p => (
                      <div key={p.id} className="group/item flex items-start justify-between gap-2 py-1.5 px-2 rounded-lg bg-white/50 border border-transparent hover:border-slate-200 hover:shadow-sm transition-all">
                        <span className={`text-xl font-black break-all tracking-tight leading-tight ${isSunday ? 'text-red-700' : 'text-slate-900'}`}>
                          {p.title}
                        </span>
                        <button 
                          onClick={(e) => handleDelete(e, p.id)} 
                          className="opacity-0 group-hover/item:opacity-100 text-slate-300 hover:text-red-600 shrink-0 p-1 bg-white rounded-md shadow-sm border border-slate-100 transition-opacity"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
            <div className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in duration-200">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <h3 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                  <div className="bg-blue-600 p-2 rounded-xl text-white">
                    <CalendarIcon size={24} />
                  </div>
                  {selectedDate} 일정 등록
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors">
                  <X size={28} />
                </button>
              </div>
              <form onSubmit={handleAddPlan} className="p-8 space-y-8">
                <div>
                  <label className="text-xs font-black text-slate-400 uppercase mb-3 block tracking-widest">Event Title</label>
                  <input 
                    type="text" 
                    placeholder="예: 1학기 중간고사, 현장체험학습"
                    value={title}
                    autoFocus
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full p-5 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:border-blue-500 focus:bg-white outline-none font-black text-2xl text-slate-900 transition-all placeholder:text-slate-300"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-black text-slate-400 uppercase mb-3 block tracking-widest">Details (Optional)</label>
                  <textarea 
                    rows="3"
                    placeholder="준비물 또는 세부 장소 등"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full p-5 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:border-blue-500 focus:bg-white outline-none font-bold text-xl resize-none transition-all placeholder:text-slate-300"
                  ></textarea>
                </div>
                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-black text-xl transition-colors">취소</button>
                  <button type="submit" className="flex-[2] py-5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-xl shadow-xl shadow-blue-200 active:scale-[0.98] transition-all">일정 저장하기</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
