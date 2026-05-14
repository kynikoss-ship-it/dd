import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, X, Check
} from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, updateDoc, writeBatch
} from 'firebase/firestore';

// --- 환경 변수 에러 방지 및 설정 ---
let firebaseConfig = {
  apiKey: "AIzaSyCO3bou4eMc-b4npOT99knhwBn_AAt2Kjc",
  authDomain: "monthly-planner-560a3.firebaseapp.com",
  projectId: "monthly-planner-560a3",
  storageBucket: "monthly-planner-560a3.firebasestorage.app",
  messagingSenderId: "1022766430649",
  appId: "1:1022766430649:web:f094b81940b863f0481e68"
};

try {
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    firebaseConfig = typeof __firebase_config === 'string' ? JSON.parse(__firebase_config) : __firebase_config;
  }
} catch (e) {
  console.error("Firebase Config Error:", e);
}

// 핫리로딩 환경 중복 초기화 방지
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const appId = (typeof __app_id !== 'undefined' && __app_id) ? __app_id : 'monthly-planner-560a3';

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

const getMsToNextHalfDayKST = () => {
  const now = new Date();
  const utcNow = now.getTime() + (now.getTimezoneOffset() * 60000);
  const kstNow = new Date(utcNow + (9 * 3600000));

  const target = new Date(kstNow);
  if (kstNow.getHours() < 12) {
    target.setHours(12, 0, 0, 0); 
  } else {
    target.setDate(target.getDate() + 1);
    target.setHours(0, 0, 0, 0); 
  }

  return target.getTime() - kstNow.getTime() + 1000;
};

// 테마 색상 설정
const COLOR_THEMES = [
  { id: 'red', hex: '#ef4444', label: '중요' },     
  { id: 'blue', hex: '#2563eb', label: '업무' },    
  { id: 'purple', hex: '#a855f7', label: '평가/시험' },  
  { id: 'orange', hex: '#f59e0b', label: '행사/일정' },  
  { id: 'green', hex: '#10b981', label: '기본' },     
];

const DEFAULT_THEME = COLOR_THEMES.find(t => t.id === 'green') ?? COLOR_THEMES[0];

const getThemeStyle = (colorId) => {
  const theme = COLOR_THEMES.find(t => t.id === colorId) ?? DEFAULT_THEME;
  return { backgroundColor: theme.hex, color: '#ffffff' };
};

// 플로팅 컨트롤러 대략적인 크기 (clamp용)
const CTRL_WIDTH = 360;
const CTRL_HEIGHT = 70;

export default function App() {
  const [user, setUser] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ type: '', text: '' });

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(getKSTDateString());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedColor, setSelectedColor] = useState('green');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState(null);

  // 컨트롤러 드래그 상태 관리
  const [ctrlPos, setCtrlPos] = useState({ x: 0, y: 0 });
  const [isDraggingCtrl, setIsDraggingCtrl] = useState(false);
  const dragStartOffset = useRef({ x: 0, y: 0 });

  // 날짜 자동 갱신: 풀 리로드 대신 selectedDate만 새로고침
  useEffect(() => {
    let timerId;
    const scheduleNext = () => {
      timerId = setTimeout(() => {
        setSelectedDate(getKSTDateString());
        scheduleNext();
      }, getMsToNextHalfDayKST());
    };
    scheduleNext();
    return () => clearTimeout(timerId);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth Error:", err);
        if (!cancelled) setLoading(false); 
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (cancelled) return;
      setUser(currentUser);
      if (!currentUser) setLoading(false); 
    });

    // 5초 폴백: 인증 실패 시 무한 로딩 방지용 (에러 상태로 전환)
    const fallbackTimer = setTimeout(() => {
      if (cancelled) return;
      setLoading(false);
      setMessage({ type: 'error', text: '연결 지연. 새로고침을 시도해 주세요.' });
    }, 5000);

    return () => {
      cancelled = true;
      unsubscribe();
      clearTimeout(fallbackTimer);
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    const plansRef = collection(db, 'artifacts', appId, 'public', 'data', 'monthly_plans');
    
    const unsubscribe = onSnapshot(plansRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // 날짜순, 이후 order 순으로 정렬
      data.sort((a, b) => {
        if (a.date > b.date) return 1;
        if (a.date < b.date) return -1;
        return (a.order || 0) - (b.order || 0);
      });
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

  // 자동 스크롤: 매 프레임 querySelectorAll 회피 + 리스너 누수 제거
  useEffect(() => {
    let animationFrameId;
    const scrollSpeed = 0.5;
    const trackedContainers = new WeakMap(); // container -> { isHovered, direction, exactScroll, pauseUntil, onEnter, onLeave }

    const ensureTracked = (container) => {
      if (trackedContainers.has(container)) return trackedContainers.get(container);
      const state = {
        isHovered: false,
        direction: 1,
        exactScroll: 0,
        pauseUntil: 0,
      };
      state.onEnter = () => { state.isHovered = true; };
      state.onLeave = () => { state.isHovered = false; };
      container.addEventListener('mouseenter', state.onEnter);
      container.addEventListener('mouseleave', state.onLeave);
      trackedContainers.set(container, state);
      return state;
    };

    let registered = new Set();

    const scrollLoop = () => {
      const containers = document.querySelectorAll('.auto-scroll-container');
      const now = Date.now();
      const seen = new Set();

      containers.forEach(container => {
        seen.add(container);
        const state = ensureTracked(container);
        registered.add(container);

        if (state.isHovered) {
          state.exactScroll = container.scrollTop;
          return;
        }
        
        if (container.scrollHeight <= container.clientHeight) {
          container.scrollTop = 0;
          return;
        }
        
        if (now < state.pauseUntil) return;

        state.exactScroll += state.direction * scrollSpeed;
        container.scrollTop = state.exactScroll;

        if (state.direction === 1 && container.scrollTop >= container.scrollHeight - container.clientHeight - 1) {
          state.direction = -1;
          state.pauseUntil = now + 2000;
        } else if (state.direction === -1 && container.scrollTop <= 0) {
          state.direction = 1;
          state.pauseUntil = now + 2000;
        }
      });

      // 사라진 컨테이너의 리스너 정리
      registered.forEach(container => {
        if (!seen.has(container)) {
          const state = trackedContainers.get(container);
          if (state) {
            container.removeEventListener('mouseenter', state.onEnter);
            container.removeEventListener('mouseleave', state.onLeave);
            trackedContainers.delete(container);
          }
          registered.delete(container);
        }
      });

      animationFrameId = requestAnimationFrame(scrollLoop);
    };

    animationFrameId = requestAnimationFrame(scrollLoop);
    return () => {
      cancelAnimationFrame(animationFrameId);
      registered.forEach(container => {
        const state = trackedContainers.get(container);
        if (state) {
          container.removeEventListener('mouseenter', state.onEnter);
          container.removeEventListener('mouseleave', state.onLeave);
        }
      });
    };
  }, []);

  // 플로팅 컨트롤러 드래그 이벤트 등록 + 뷰포트 경계 clamp
  useEffect(() => {
    const clampPos = (x, y) => {
      // 컨트롤러는 bottom-6 right-6 기준이므로 translate 범위:
      //   x: -(window.innerWidth - CTRL_WIDTH - 24) ~ +24 (대략)
      //   y: -(window.innerHeight - CTRL_HEIGHT - 24) ~ +24
      const maxX = 24;
      const minX = -(window.innerWidth - CTRL_WIDTH - 24);
      const maxY = 24;
      const minY = -(window.innerHeight - CTRL_HEIGHT - 24);
      return {
        x: Math.min(maxX, Math.max(minX, x)),
        y: Math.min(maxY, Math.max(minY, y)),
      };
    };

    const handleDragMove = (e) => {
      if (!isDraggingCtrl) return;
      if (e.type.includes('touch')) e.preventDefault();
      const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
      const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
      
      setCtrlPos(clampPos(
        clientX - dragStartOffset.current.x,
        clientY - dragStartOffset.current.y
      ));
    };

    const handleDragEnd = () => {
      setIsDraggingCtrl(false);
    };

    if (isDraggingCtrl) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove, { passive: false });
      window.addEventListener('touchend', handleDragEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDraggingCtrl]);

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

  const validWeeks = useMemo(() => {
    const weeks = [];
    for (let i = 0; i < calendarDays.length; i += 7) {
      const week = calendarDays.slice(i, i + 7);
      const hasWeekday = week.slice(1, 6).some(day => day !== null);
      if (hasWeekday) {
        weeks.push(week);
      }
    }
    return weeks;
  }, [calendarDays]);

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  const handleCtrlDragStart = (e) => {
    // 내부 버튼 클릭 시 드래그 동작 무시
    if (e.target.closest('button')) return;
    
    setIsDraggingCtrl(true);
    const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
    
    dragStartOffset.current = {
      x: clientX - ctrlPos.x,
      y: clientY - ctrlPos.y
    };
  };

  const handleDateClick = (dateStr) => {
    setEditingPlanId(null);
    setSelectedDate(dateStr);
    setTitle('');
    setDescription('');
    setSelectedColor('green'); 
    setIsModalOpen(true);
  };

  const handlePlanClick = (e, plan) => {
    e.stopPropagation();
    setEditingPlanId(plan.id);
    setSelectedDate(plan.date);
    setTitle(plan.title);
    setDescription(plan.description || '');
    setSelectedColor(plan.color || 'green');
    setIsModalOpen(true);
  };

  const handleSavePlan = async (e) => {
    e.preventDefault();
    if (!user || !title.trim()) return;

    try {
      if (editingPlanId) {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'monthly_plans', editingPlanId);
        await updateDoc(docRef, {
          title,
          description,
          color: selectedColor
        });
        setMessage({ type: 'success', text: '일정이 수정되었습니다.' });
      } else {
        const dayPlans = plans.filter(p => p.date === selectedDate);
        const nextOrder = dayPlans.length > 0 ? Math.max(...dayPlans.map(p => p.order || 0)) + 1 : 0;

        const plansRef = collection(db, 'artifacts', appId, 'public', 'data', 'monthly_plans');
        await addDoc(plansRef, {
          date: selectedDate,
          title,
          description,
          color: selectedColor,
          order: nextOrder,
          createdAt: serverTimestamp(),
          userId: user.uid
        });
        setMessage({ type: 'success', text: '일정이 등록되었습니다.' });
      }
      
      setTitle('');
      setDescription('');
      setEditingPlanId(null);
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

  // 드래그 정렬: writeBatch로 원자성 + 비용 감소
  const handleDrop = async (e, targetPlan) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === targetPlan.id) return;

    const draggedPlan = plans.find(p => p.id === draggedId);
    if (!draggedPlan || draggedPlan.date !== targetPlan.date) return;

    const dayPlans = plans.filter(p => p.date === targetPlan.date).sort((a, b) => (a.order || 0) - (b.order || 0));
    const draggedIdx = dayPlans.findIndex(p => p.id === draggedId);
    const targetIdx = dayPlans.findIndex(p => p.id === targetPlan.id);

    const newDayPlans = [...dayPlans];
    newDayPlans.splice(draggedIdx, 1);
    newDayPlans.splice(targetIdx, 0, draggedPlan);

    try {
      const batch = writeBatch(db);
      newDayPlans.forEach((plan, index) => {
        if ((plan.order || 0) !== index) {
          const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'monthly_plans', plan.id);
          batch.update(docRef, { order: index });
        }
      });
      await batch.commit();
    } catch (error) {
      console.error("Order update error:", error);
      setMessage({ type: 'error', text: '순서 변경 실패' });
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 font-sans font-bold gap-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <div className="text-slate-600 text-2xl">데이터 연결 중입니다...</div>
      </div>
    );
  }

  const todayStr = getKSTDateString();
  const gridLayout = "grid-cols-5";
  const weeksCount = validWeeks.length;
  const plansForSelectedDate = plans.filter(p => p.date === selectedDate);

  return (
    <div className="h-screen w-screen bg-slate-100 p-4 text-slate-800 font-sans selection:bg-blue-200 flex flex-col overflow-hidden">
      
      <style>{`
        .cell-scroll::-webkit-scrollbar { width: 6px; }
        .cell-scroll::-webkit-scrollbar-track { background: transparent; }
        .cell-scroll::-webkit-scrollbar-thumb { background-color: rgba(0,0,0,0.15); border-radius: 10px; }
        .cell-scroll::-webkit-scrollbar-thumb:hover { background-color: rgba(0,0,0,0.3); }
      `}</style>

      {message.text && (
        <div className={`fixed top-8 right-8 z-[200] p-6 rounded-2xl flex items-center gap-4 shadow-2xl animate-bounce ${message.type === 'success' ? 'bg-emerald-600' : 'bg-red-500'} text-white`}>
          <span className="font-bold text-2xl">{message.text}</span>
        </div>
      )}

      <div className="flex-1 w-full h-full bg-white shadow-xl rounded-xl overflow-hidden border border-slate-300 flex flex-col relative">
        <div 
          className={`grid ${gridLayout} w-full h-full`}
          style={{ gridTemplateRows: `auto repeat(${weeksCount}, minmax(0, 1fr))` }}
        >
          {['월', '화', '수', '목', '금'].map((d) => (
            <div key={d} className="py-4 text-center text-4xl font-black border-r border-b border-slate-200 last:border-r-0 flex items-center justify-center bg-yellow-500 text-slate-900">
              {d}
            </div>
          ))}

          {validWeeks.flatMap((week, weekIdx) => {
            return week.map((day, idx) => {
              if (idx === 0 || idx === 6) return null; 

              if (day === null) {
                return <div key={`empty-${weekIdx}-${idx}`} className={`border-r border-b border-slate-200 bg-slate-50/50`}></div>;
              }
              
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayPlans = plans.filter(p => p.date === dateStr);
              const isToday = todayStr === dateStr;

              return (
                <div 
                  key={day} 
                  onClick={() => handleDateClick(dateStr)}
                  className="p-1.5 border-r border-b border-slate-200 group cursor-pointer transition-all relative flex flex-col overflow-hidden bg-white hover:bg-blue-50/50"
                >
                  <div className="flex justify-start items-start mb-1 shrink-0 px-1 pt-1">
                    <span className={`text-4xl font-bold ${isToday ? 'bg-blue-600 text-white w-14 h-14 flex items-center justify-center rounded-full shadow-md' : 'text-slate-700'}`}>
                      {day}
                    </span>
                  </div>
                  
                  <div className="flex-1 space-y-2 mt-1 overflow-y-auto cell-scroll auto-scroll-container pb-1">
                    {dayPlans.map(p => (
                      <div 
                        key={p.id} 
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', p.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(e) => handleDrop(e, p)}
                        onClick={(e) => handlePlanClick(e, p)}
                        style={getThemeStyle(p.color)}
                        className="group/item flex items-center justify-between gap-2 py-3 px-3 rounded-lg transition-all shadow-md cursor-grab active:cursor-grabbing hover:brightness-95"
                      >
                        <span className="text-4xl font-extrabold break-all tracking-tight leading-snug flex-1 pointer-events-none drop-shadow-sm">
                          {p.title}
                        </span>
                        <button 
                          type="button"
                          onClick={(e) => handleDelete(e, p.id)} 
                          className="opacity-0 group-hover/item:opacity-100 text-white/80 hover:text-white shrink-0 p-1.5 bg-black/25 rounded-md transition-opacity"
                        >
                          <X size={28} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            });
          })}
        </div>

        {/* 연/월 조작 플로팅 컨트롤러 - 드래그 기능 + 뷰포트 clamp */}
        <div 
          className={`absolute bottom-6 right-6 z-40 flex items-center bg-white text-slate-800 rounded-xl p-1.5 shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-200 select-none ${isDraggingCtrl ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ transform: `translate(${ctrlPos.x}px, ${ctrlPos.y}px)` }}
          onMouseDown={handleCtrlDragStart}
          onTouchStart={handleCtrlDragStart}
        >
          <button type="button" onClick={prevMonth} className="p-3 hover:bg-slate-100 rounded-lg transition-all active:scale-95 text-slate-500 hover:text-slate-800 cursor-pointer"><ChevronLeft size={36}/></button>
          <span className="px-6 font-bold min-w-[220px] text-center text-3xl tracking-tighter pointer-events-none">{year}년 {month + 1}월</span>
          <button type="button" onClick={nextMonth} className="p-3 hover:bg-slate-100 rounded-lg transition-all active:scale-95 text-slate-500 hover:text-slate-800 cursor-pointer"><ChevronRight size={36}/></button>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white w-full max-w-2xl rounded-[24px] shadow-2xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in duration-200">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
                <div className="bg-blue-600 p-2.5 rounded-xl text-white shadow-md">
                  <CalendarIcon size={28} />
                </div>
                {selectedDate} {editingPlanId ? '일정 수정' : '일정 등록'}
              </h3>
              <button 
                type="button"
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingPlanId(null);
                }} 
                className="p-3 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={36} />
              </button>
            </div>
            
            {/* 등록 모드일 때 해당 날짜의 기존 일정 미리보기 */}
            {!editingPlanId && plansForSelectedDate.length > 0 && (
              <div className="px-8 pt-6">
                <label className="text-lg font-bold text-slate-500 uppercase mb-3 block tracking-widest">이 날짜의 기존 일정</label>
                <div className="space-y-2 max-h-40 overflow-y-auto cell-scroll">
                  {plansForSelectedDate.map(p => (
                    <div
                      key={p.id}
                      style={getThemeStyle(p.color)}
                      className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg shadow-sm cursor-pointer hover:brightness-95"
                      onClick={(e) => handlePlanClick(e, p)}
                    >
                      <span className="font-bold text-xl flex-1 truncate">{p.title}</span>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(e, p.id)}
                        className="text-white/80 hover:text-white p-1 bg-black/20 rounded-md"
                      >
                        <X size={20} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleSavePlan} className="p-8 space-y-8">
              <div>
                <label className="text-lg font-bold text-slate-500 uppercase mb-4 block tracking-widest">일정 분류 (색상)</label>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                  {COLOR_THEMES.map(theme => (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => setSelectedColor(theme.id)}
                      style={{ backgroundColor: theme.hex }}
                      className={`relative flex flex-col items-center justify-center p-3 rounded-xl transition-all ${selectedColor === theme.id ? 'ring-4 ring-blue-400 shadow-lg scale-105' : 'opacity-85 hover:opacity-100 shadow-sm'}`}
                    >
                      {selectedColor === theme.id && <Check size={20} className="text-white absolute top-1 right-1" />}
                      <span className="text-white font-semibold text-base mt-1">{theme.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-lg font-bold text-slate-500 uppercase mb-4 block tracking-widest">일정명</label>
                <input 
                  type="text" 
                  placeholder="예: 1차 고사 시험 감독"
                  value={title}
                  autoFocus
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full p-5 bg-white border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none font-bold text-3xl text-slate-800 transition-all placeholder:text-slate-300"
                  required
                />
              </div>
              
              <div>
                <label className="text-lg font-bold text-slate-500 uppercase mb-4 block tracking-widest">세부 사항</label>
                <textarea 
                  rows="2"
                  placeholder="추가 메모"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full p-5 bg-white border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none font-semibold text-2xl text-slate-800 resize-none transition-all placeholder:text-slate-300"
                ></textarea>
              </div>
              
              <div className="flex gap-4 pt-4">
                <button 
                  type="button" 
                  onClick={() => {
                    setIsModalOpen(false);
                    setEditingPlanId(null);
                  }} 
                  className="flex-1 py-5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold text-2xl transition-colors"
                >
                  취소
                </button>
                <button type="submit" className="flex-[2] py-5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-2xl shadow-lg shadow-blue-600/20 active:scale-[0.98] transition-all">
                  {editingPlanId ? '수정하기' : '저장하기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
