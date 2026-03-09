import React, { useState, useEffect, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, X 
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp
} from 'firebase/firestore';

// --- 환경 변수 에러 방지 및 설정 ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : {
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
const appId = typeof __app_id !== 'undefined' ? __app_id : 'monthly-planner-560a3';

const getKSTDateString = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Seoul'
  });
  const parts = formatter.formatToParts(date);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
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

  useEffect(() => {
    if (!user) return;

    const plansRef = collection(db, 'artifacts', appId, 'public', 'data', 'monthly_plans');
    
    const unsubscribe = onSnapshot(plansRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => (a.date > b.date ? 1 : -1));
      setPlans(data);
      setLoading(false);
    }, (err) => {
      console.error("Firestore Error:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (message.text) {
      const timer = setTimeout(() => setMessage({ type: '', text: '' }), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // --- 자동 스크롤 로직 ---
  useEffect(() => {
    let animationFrameId;
    const scrollSpeed = 0.5;

    const scrollLoop = () => {
      const containers = document.querySelectorAll('.auto-scroll-container');
      const now = Date.now();
      
      containers.forEach(container => {
        if (!container.dataset.initialized) {
          container.addEventListener('mouseenter', () => container.dataset.isHovered = 'true');
          container.addEventListener('mouseleave', () => container.dataset.isHovered = 'false');
          container.dataset.direction = '1';
          container.dataset.exactScroll = '0';
          container.dataset.initialized = 'true';
        }

        if (container.dataset.isHovered === 'true') {
          container.dataset.exactScroll = container.scrollTop;
          return;
        }
        
        if (container.scrollHeight <= container.clientHeight) {
          container.scrollTop = 0;
          return;
        }
        
        const pauseUntil = parseInt(container.dataset.pauseUntil || '0', 10);
        if (now < pauseUntil) return;

        let dir = parseFloat(container.dataset.direction);
        let exactScroll = parseFloat(container.dataset.exactScroll);
        
        exactScroll += dir * scrollSpeed;
        container.dataset.exactScroll = exactScroll;
        container.scrollTop = exactScroll;

        if (dir === 1 && container.scrollTop >= container.scrollHeight - container.clientHeight - 1) {
          container.dataset.direction = '-1';
          container.dataset.pauseUntil = (now + 2000).toString();
        } else if (dir === -1 && container.scrollTop <= 0) {
          container.dataset.direction = '1';
          container.dataset.pauseUntil = (now + 2000).toString();
        }
      });
      animationFrameId = requestAnimationFrame(scrollLoop);
    };

    animationFrameId = requestAnimationFrame(scrollLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay(); 
  
  const calendarDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < firstDayIndex; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    
    const remainder = days.length % 7;
    if (remainder !== 0) {
      for (let i = 0; i < 7 - remainder; i++) days.push(null);
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
        <div className="text-slate-500 text-lg">데이터 연결 중입니다...</div>
      </div>
    );
  }

  const todayStr = getKSTDateString();
  const gridLayout = "grid-cols-5";
  const weeksCount = calendarDays.length / 7;

  return (
    <div className="h-screen w-screen bg-slate-100 p-2 text-slate-900 font-sans selection:bg-blue-100 flex flex-col overflow-hidden">
      
      <style>{`
        .cell-scroll::-webkit-scrollbar { width: 6px; }
        .cell-scroll::-webkit-scrollbar-track { background: transparent; }
        .cell-scroll::-webkit-scrollbar-thumb { background-color: rgba(0,0,0,0.15); border-radius: 10px; }
      `}</style>

      {message.text && (
        <div className={`fixed top-8 right-8 z-[200] p-6 rounded-2xl flex items-center gap-4 shadow-2xl animate-bounce ${message.type === 'success' ? 'bg-slate-900' : 'bg-red-600'} text-white`}>
          <span className="font-black text-2xl">{message.text}</span>
        </div>
      )}

      {/* 달력 본문: 전체 화면 높이를 모두 차지하도록 설정 */}
      <div className="flex-1 w-full h-full bg-slate-900 p-[2px] shadow-2xl rounded-xl overflow-hidden border-2 border-slate-900 flex flex-col relative">
        <div 
          className={`grid ${gridLayout} w-full h-full`}
          style={{ gridTemplateRows: `auto repeat(${weeksCount}, minmax(0, 1fr))` }}
        >
          {['월', '화', '수', '목', '금'].map((d) => (
            <div key={d} className="py-4 text-center text-3xl font-black border-r border-b border-slate-900 last:border-r-0 flex items-center justify-center bg-yellow-500 text-slate-900">
              {d}
            </div>
          ))}

          {calendarDays.map((day, idx) => {
            if (idx % 7 === 0 || idx % 7 === 6) return null; // 일요일(0), 토요일(6) 렌더링 제외

            if (day === null) {
              return <div key={`empty-${idx}`} className={`border-r border-t border-slate-900 bg-slate-200`}></div>;
            }
            
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayPlans = plans.filter(p => p.date === dateStr);
            const isToday = todayStr === dateStr;

            return (
              <div 
                key={day} 
                onClick={() => handleDateClick(dateStr)}
                className="p-2 border-r border-t border-slate-900 group cursor-pointer transition-all relative flex flex-col overflow-hidden bg-white hover:bg-slate-100"
              >
                <div className="flex justify-between items-start mb-1 shrink-0">
                  {/* 날짜 숫자 크기 조정 (text-4xl -> text-2xl, w-14 -> w-10) */}
                  <span className={`text-2xl font-black ${isToday ? 'bg-blue-700 text-white w-10 h-10 flex items-center justify-center rounded-full shadow-lg ring-2 ring-blue-200' : 'text-slate-900'}`}>
                    {day}
                  </span>
                </div>
                
                {/* 간격 및 여백 축소 (space-y-2 -> space-y-1, mt-1 -> mt-0) */}
                <div className="flex-1 space-y-1 mt-0 overflow-y-auto cell-scroll auto-scroll-container pr-1 pb-1">
                  {dayPlans.map(p => (
                    <div key={p.id} className="group/item flex items-center justify-between gap-2 py-0.5 px-2 rounded-lg bg-white/60 border border-transparent hover:border-slate-400 hover:shadow-md transition-all">
                      {/* 텍스트 크기 조정 (text-3xl -> text-2xl) */}
                      <span className="text-2xl font-black break-all tracking-tight leading-tight text-slate-900">
                        {p.title}
                      </span>
                      <button 
                        onClick={(e) => handleDelete(e, p.id)} 
                        className="opacity-0 group-hover/item:opacity-100 text-slate-500 hover:text-red-600 shrink-0 p-0.5 bg-white rounded-md shadow-sm border border-slate-300 transition-opacity"
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

        {/* 연/월 조작 플로팅 컨트롤러 (우측 하단) */}
        <div className="absolute bottom-6 right-6 z-40 flex items-center bg-slate-900 text-white rounded-2xl p-2 shadow-[0_10px_40px_rgba(0,0,0,0.5)] border border-slate-600/50 backdrop-blur-md">
          <button onClick={prevMonth} className="p-3 hover:bg-slate-800 rounded-xl transition-all active:scale-95 text-slate-300 hover:text-white"><ChevronLeft size={40}/></button>
          <span className="px-6 font-black min-w-[240px] text-center text-4xl tracking-tighter">{year}년 {month + 1}월</span>
          <button onClick={nextMonth} className="p-3 hover:bg-slate-800 rounded-xl transition-all active:scale-95 text-slate-300 hover:text-white"><ChevronRight size={40}/></button>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
          <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in duration-200">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-4xl font-black text-slate-800 flex items-center gap-3">
                <div className="bg-blue-600 p-3 rounded-xl text-white">
                  <CalendarIcon size={32} />
                </div>
                {selectedDate} 일정 등록
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-3 hover:bg-slate-200 rounded-full text-slate-500 transition-colors">
                <X size={36} />
              </button>
            </div>
            <form onSubmit={handleAddPlan} className="p-10 space-y-8">
              <div>
                <label className="text-lg font-black text-slate-500 uppercase mb-4 block tracking-widest">일정명</label>
                <input 
                  type="text" 
                  placeholder="예: 기말고사 시작"
                  value={title}
                  autoFocus
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full p-6 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:border-blue-500 focus:bg-white outline-none font-black text-4xl text-slate-900 transition-all placeholder:text-slate-300"
                  required
                />
              </div>
              <div>
                <label className="text-lg font-black text-slate-500 uppercase mb-4 block tracking-widest">세부 사항</label>
                <textarea 
                  rows="3"
                  placeholder="추가 메모"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full p-6 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:border-blue-500 focus:bg-white outline-none font-bold text-3xl resize-none transition-all placeholder:text-slate-300"
                ></textarea>
              </div>
              <div className="flex gap-4 pt-6">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-6 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl font-black text-3xl transition-colors">취소</button>
                <button type="submit" className="flex-[2] py-6 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-3xl shadow-xl shadow-blue-200 active:scale-[0.98] transition-all">저장하기</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
