import React, { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { 
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, X, Check,
  Lock, Unlock, Paperclip, Download, FileText, Pencil, Trash2, Upload
} from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, updateDoc, writeBatch, query, where
} from 'firebase/firestore';
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject
} from 'firebase/storage';

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

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const appId = (typeof __app_id !== 'undefined' && __app_id) ? __app_id : 'monthly-planner-560a3';

// --- [추가] 편집용 비밀번호 ---
const EDIT_PASSWORD = '3328';

const getKSTDateString = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul'
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

const getThemeLabel = (colorId) => (COLOR_THEMES.find(t => t.id === colorId) ?? DEFAULT_THEME).label;

const CTRL_WIDTH = 360;
const CTRL_HEIGHT = 70;

// 파일 크기 표시 헬퍼
const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

// 범위 쿼리용 - 보고 있는 달 ±1개월 범위 문자열 반환
const getQueryRange = (year, month) => {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month + 2, 0);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: fmt(startDate), end: fmt(endDate) };
};

// 일정 카드 컴포넌트 분리 + memo
const PlanCard = memo(function PlanCard({ plan, isUnlocked, onDragStart, onDragOver, onDrop, onClick, onDelete }) {
  const hasFiles = Array.isArray(plan.attachments) && plan.attachments.length > 0;
  return (
    <div 
      draggable={isUnlocked}
      onDragStart={(e) => onDragStart(e, plan)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, plan)}
      onClick={(e) => onClick(e, plan)}
      style={getThemeStyle(plan.color)}
      className={`group/item flex items-center justify-between gap-2 py-3 px-3 rounded-lg transition-all shadow-md hover:brightness-95 ${isUnlocked ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
    >
      <span className="text-4xl font-extrabold break-all tracking-tight leading-snug flex-1 pointer-events-none drop-shadow-sm">
        {plan.title}
      </span>
      <div className="flex items-center gap-1 shrink-0 pointer-events-none">
        {hasFiles && (
          <span className="flex items-center gap-1 bg-black/20 rounded-md px-2 py-1 text-xl font-bold">
            <Paperclip size={22} /> {plan.attachments.length}
          </span>
        )}
      </div>
      {isUnlocked && (
        <button 
          type="button"
          onClick={(e) => onDelete(e, plan.id)} 
          className="opacity-0 group-hover/item:opacity-100 text-white/80 hover:text-white shrink-0 p-1.5 bg-black/25 rounded-md transition-opacity"
        >
          <X size={28} />
        </button>
      )}
    </div>
  );
});

// 날짜 셀 컴포넌트 분리 + memo
const DayCell = memo(function DayCell({ 
  day, dateStr, isToday, dayPlans, isUnlocked, onDateClick, 
  onPlanDragStart, onPlanDragOver, onPlanDrop, onPlanClick, onPlanDelete 
}) {
  return (
    <div 
      onClick={() => onDateClick(dateStr)}
      className={`p-1.5 border-r border-b border-slate-200 group transition-all relative flex flex-col overflow-hidden bg-white hover:bg-blue-50/50 ${isUnlocked ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex justify-start items-start mb-1 shrink-0 px-1 pt-1">
        <span className={`text-4xl font-bold ${isToday ? 'bg-blue-600 text-white w-14 h-14 flex items-center justify-center rounded-full shadow-md' : 'text-slate-700'}`}>
          {day}
        </span>
      </div>
      <div className="flex-1 space-y-2 mt-1 overflow-y-auto cell-scroll auto-scroll-container pb-1">
        {dayPlans.map(p => (
          <PlanCard
            key={p.id}
            plan={p}
            isUnlocked={isUnlocked}
            onDragStart={onPlanDragStart}
            onDragOver={onPlanDragOver}
            onDrop={onPlanDrop}
            onClick={onPlanClick}
            onDelete={onPlanDelete}
          />
        ))}
      </div>
    </div>
  );
});

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

  // [추가] 편집 잠금 상태
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLockModalOpen, setIsLockModalOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');

  // [추가] 상세보기 모달
  const [detailPlanId, setDetailPlanId] = useState(null);

  // [추가] 첨부파일 업로드 대기 목록 + 저장중 상태
  const [newFiles, setNewFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  const [ctrlPos, setCtrlPos] = useState({ x: 0, y: 0 });
  const [isDraggingCtrl, setIsDraggingCtrl] = useState(false);
  const dragStartOffset = useRef({ x: 0, y: 0 });

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

    const fallbackTimer = setTimeout(() => {
      if (cancelled) return;
      setLoading(prev => {
        if (prev) {
          setMessage({ type: 'error', text: '연결 지연. 새로고침을 시도해 주세요.' });
          return false;
        }
        return prev;
      });
    }, 5000);

    return () => {
      cancelled = true;
      unsubscribe();
      clearTimeout(fallbackTimer);
    };
  }, []);

  // Firestore 쿼리에 날짜 범위 적용 - 전체 컬렉션 로드 방지
  useEffect(() => {
    if (!user) return;

    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const { start, end } = getQueryRange(year, month);

    const plansRef = collection(db, 'artifacts', appId, 'public', 'data', 'monthly_plans');
    const q = query(plansRef, where('date', '>=', start), where('date', '<=', end));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
  }, [user, currentMonth]);

  useEffect(() => {
    if (message.text) {
      const timer = setTimeout(() => setMessage({ type: '', text: '' }), 3000);
      return () => clearTimeout(timer);
    }
  }, [message.text]);

  // 자동 스크롤
  useEffect(() => {
    let animationFrameId;
    let refreshIntervalId;
    const scrollSpeed = 0.5;
    
    const containerStates = new Map();
    let activeContainers = [];

    const refreshContainers = () => {
      const found = document.querySelectorAll('.auto-scroll-container');
      const foundSet = new Set(found);
      
      foundSet.forEach(container => {
        if (!containerStates.has(container)) {
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
          containerStates.set(container, state);
        }
      });

      containerStates.forEach((state, container) => {
        if (!foundSet.has(container)) {
          container.removeEventListener('mouseenter', state.onEnter);
          container.removeEventListener('mouseleave', state.onLeave);
          containerStates.delete(container);
        }
      });

      activeContainers = Array.from(foundSet);
    };

    refreshContainers();
    refreshIntervalId = setInterval(refreshContainers, 1000);

    const scrollLoop = () => {
      const now = Date.now();
      for (let i = 0; i < activeContainers.length; i++) {
        const container = activeContainers[i];
        const state = containerStates.get(container);
        if (!state) continue;

        if (state.isHovered) {
          state.exactScroll = container.scrollTop;
          continue;
        }
        if (container.scrollHeight <= container.clientHeight) {
          container.scrollTop = 0;
          continue;
        }
        if (now < state.pauseUntil) continue;

        state.exactScroll += state.direction * scrollSpeed;
        container.scrollTop = state.exactScroll;

        if (state.direction === 1 && container.scrollTop >= container.scrollHeight - container.clientHeight - 1) {
          state.direction = -1;
          state.pauseUntil = now + 2000;
        } else if (state.direction === -1 && container.scrollTop <= 0) {
          state.direction = 1;
          state.pauseUntil = now + 2000;
        }
      }
      animationFrameId = requestAnimationFrame(scrollLoop);
    };

    animationFrameId = requestAnimationFrame(scrollLoop);
    
    return () => {
      cancelAnimationFrame(animationFrameId);
      clearInterval(refreshIntervalId);
      containerStates.forEach((state, container) => {
        container.removeEventListener('mouseenter', state.onEnter);
        container.removeEventListener('mouseleave', state.onLeave);
      });
      containerStates.clear();
      activeContainers = [];
    };
  }, []);

  useEffect(() => {
    const clampPos = (x, y) => {
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

    const handleDragEnd = () => setIsDraggingCtrl(false);

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

  const plansByDate = useMemo(() => {
    const map = new Map();
    for (const p of plans) {
      if (!map.has(p.date)) map.set(p.date, []);
      map.get(p.date).push(p);
    }
    return map;
  }, [plans]);
  
  const calendarDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < firstDayIndex; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    const remainder = days.length % 7;
    if (remainder !== 0) {
      for (let i = 0; i < 7 - remainder; i++) days.push(null);
    }
    return days;
  }, [daysInMonth, firstDayIndex]);

  const validWeeks = useMemo(() => {
    const weeks = [];
    for (let i = 0; i < calendarDays.length; i += 7) {
      const week = calendarDays.slice(i, i + 7);
      const hasWeekday = week.slice(1, 6).some(day => day !== null);
      if (hasWeekday) weeks.push(week);
    }
    return weeks;
  }, [calendarDays]);

  const prevMonth = useCallback(() => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)), []);
  const nextMonth = useCallback(() => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)), []);

  const handleCtrlDragStart = (e) => {
    if (e.target.closest('button')) return;
    setIsDraggingCtrl(true);
    const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
    dragStartOffset.current = {
      x: clientX - ctrlPos.x,
      y: clientY - ctrlPos.y
    };
  };

  // --- [추가] 비밀번호 잠금 해제/잠금 ---
  const handleToggleLock = () => {
    if (isUnlocked) {
      setIsUnlocked(false);
      setMessage({ type: 'success', text: '편집 모드를 종료했습니다.' });
    } else {
      setPasswordInput('');
      setIsLockModalOpen(true);
    }
  };

  const handleSubmitPassword = (e) => {
    e.preventDefault();
    if (passwordInput === EDIT_PASSWORD) {
      setIsUnlocked(true);
      setIsLockModalOpen(false);
      setPasswordInput('');
      setMessage({ type: 'success', text: '편집 모드가 활성화되었습니다.' });
    } else {
      setMessage({ type: 'error', text: '비밀번호가 일치하지 않습니다.' });
      setPasswordInput('');
    }
  };

  // 빈 날짜 클릭 → 신규 등록 (잠금 시 차단)
  const handleDateClick = useCallback((dateStr) => {
    if (!isUnlocked) {
      setMessage({ type: 'error', text: '편집하려면 우측 하단 자물쇠를 해제하세요.' });
      return;
    }
    setEditingPlanId(null);
    setSelectedDate(dateStr);
    setTitle('');
    setDescription('');
    setSelectedColor('green'); 
    setNewFiles([]);
    setIsModalOpen(true);
  }, [isUnlocked]);

  // 일정 클릭 → 상세보기 (잠금 여부 무관, 항상 읽기 가능)
  const handlePlanClick = useCallback((e, plan) => {
    e.stopPropagation();
    setDetailPlanId(plan.id);
  }, []);

  // 상세보기에서 [수정] 클릭 → 편집 모달 전환
  const openEditFromDetail = useCallback((plan) => {
    setDetailPlanId(null);
    setEditingPlanId(plan.id);
    setSelectedDate(plan.date);
    setTitle(plan.title);
    setDescription(plan.description || '');
    setSelectedColor(plan.color || 'green');
    setNewFiles([]);
    setIsModalOpen(true);
  }, []);

  const plansRef = useRef(plans);
  useEffect(() => { plansRef.current = plans; }, [plans]);

  // 일정 삭제 (첨부파일도 Storage에서 함께 삭제 시도)
  const handleDelete = useCallback(async (e, id) => {
    if (e) e.stopPropagation();
    if (!isUnlocked) return;
    try {
      const target = plansRef.current.find(p => p.id === id);
      if (target && Array.isArray(target.attachments)) {
        for (const att of target.attachments) {
          if (att.path) {
            try { await deleteObject(storageRef(storage, att.path)); } catch (_) {}
          }
        }
      }
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'monthly_plans', id);
      await deleteDoc(docRef);
      setDetailPlanId(prev => (prev === id ? null : prev));
      setMessage({ type: 'success', text: '삭제되었습니다.' });
    } catch (error) {
      setMessage({ type: 'error', text: '삭제 실패' });
    }
  }, [isUnlocked]);

  const handlePlanDragStart = useCallback((e, plan) => {
    e.dataTransfer.setData('text/plain', plan.id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handlePlanDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(async (e, targetPlan) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isUnlocked) return;
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === targetPlan.id) return;

    const currentPlans = plansRef.current;
    const draggedPlan = currentPlans.find(p => p.id === draggedId);
    if (!draggedPlan || draggedPlan.date !== targetPlan.date) return;

    const dayPlans = currentPlans.filter(p => p.date === targetPlan.date).sort((a, b) => (a.order || 0) - (b.order || 0));
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
  }, [isUnlocked]);

  // --- [추가] 첨부파일 선택 ---
  const handleFileSelect = (e) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length > 0) {
      setNewFiles(prev => [...prev, ...selected]);
    }
    e.target.value = '';
  };

  const removePendingFile = (idx) => {
    setNewFiles(prev => prev.filter((_, i) => i !== idx));
  };

  // --- [추가] 이미 저장된 첨부파일 삭제 ---
  const handleRemoveAttachment = async (planId, att) => {
    if (!isUnlocked) return;
    try {
      if (att.path) {
        try { await deleteObject(storageRef(storage, att.path)); } catch (_) {}
      }
      const target = plansRef.current.find(p => p.id === planId);
      const remaining = (target?.attachments || []).filter(a => a.path !== att.path);
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'monthly_plans', planId);
      await updateDoc(docRef, { attachments: remaining });
      setMessage({ type: 'success', text: '첨부파일을 삭제했습니다.' });
    } catch (error) {
      setMessage({ type: 'error', text: '첨부파일 삭제 실패' });
    }
  };

  // 일정 저장 (신규/수정 + 첨부파일 업로드)
  const handleSavePlan = async (e) => {
    e.preventDefault();
    if (!user || !title.trim() || !isUnlocked) return;

    setSaving(true);
    try {
      let planId = editingPlanId;
      const editingPlan = editingPlanId ? plans.find(p => p.id === editingPlanId) : null;
      let attachments = editingPlan && Array.isArray(editingPlan.attachments)
        ? [...editingPlan.attachments]
        : [];

      // 신규일 경우 먼저 문서 생성하여 ID 확보
      if (!editingPlanId) {
        const dayPlans = plans.filter(p => p.date === selectedDate);
        const nextOrder = dayPlans.length > 0 ? Math.max(...dayPlans.map(p => p.order || 0)) + 1 : 0;
        const ref = collection(db, 'artifacts', appId, 'public', 'data', 'monthly_plans');
        const created = await addDoc(ref, {
          date: selectedDate, title, description, color: selectedColor,
          order: nextOrder, attachments: [], createdAt: serverTimestamp(), userId: user.uid
        });
        planId = created.id;
      }

      // 첨부파일 업로드
      if (newFiles.length > 0) {
        for (const file of newFiles) {
          const safeName = file.name.replace(/[^\w.\-가-힣() ]/g, '_');
          const path = `artifacts/${appId}/attachments/${planId}/${Date.now()}_${safeName}`;
          const sRef = storageRef(storage, path);
          await uploadBytes(sRef, file);
          const url = await getDownloadURL(sRef);
          attachments.push({ name: file.name, url, path, size: file.size });
        }
      }

      // 본문 + 첨부 메타데이터 최종 반영
      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'monthly_plans', planId);
      await updateDoc(docRef, { title, description, color: selectedColor, attachments });

      setMessage({ type: 'success', text: editingPlanId ? '일정이 수정되었습니다.' : '일정이 등록되었습니다.' });

      setTitle('');
      setDescription('');
      setEditingPlanId(null);
      setNewFiles([]);
      setIsModalOpen(false);
    } catch (error) {
      console.error("Save error:", error);
      setMessage({ type: 'error', text: '저장 실패 (Storage 설정을 확인하세요)' });
    } finally {
      setSaving(false);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPlanId(null);
    setNewFiles([]);
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
  const plansForSelectedDate = plansByDate.get(selectedDate) || [];
  const detailPlan = detailPlanId ? plans.find(p => p.id === detailPlanId) : null;

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

          {validWeeks.flatMap((week, weekIdx) => 
            week.map((day, idx) => {
              if (idx === 0 || idx === 6) return null; 
              if (day === null) {
                return <div key={`empty-${weekIdx}-${idx}`} className="border-r border-b border-slate-200 bg-slate-50/50"></div>;
              }
              
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayPlans = plansByDate.get(dateStr) || [];
              const isToday = todayStr === dateStr;

              return (
                <DayCell
                  key={`${year}-${month}-${day}`}
                  day={day}
                  dateStr={dateStr}
                  isToday={isToday}
                  dayPlans={dayPlans}
                  isUnlocked={isUnlocked}
                  onDateClick={handleDateClick}
                  onPlanDragStart={handlePlanDragStart}
                  onPlanDragOver={handlePlanDragOver}
                  onPlanDrop={handleDrop}
                  onPlanClick={handlePlanClick}
                  onPlanDelete={handleDelete}
                />
              );
            })
          )}
        </div>

        <div 
          className={`absolute bottom-6 right-6 z-40 flex items-center bg-white text-slate-800 rounded-xl p-1.5 shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-200 select-none ${isDraggingCtrl ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ transform: `translate(${ctrlPos.x}px, ${ctrlPos.y}px)` }}
          onMouseDown={handleCtrlDragStart}
          onTouchStart={handleCtrlDragStart}
        >
          <button type="button" onClick={prevMonth} className="p-3 hover:bg-slate-100 rounded-lg transition-all active:scale-95 text-slate-500 hover:text-slate-800 cursor-pointer"><ChevronLeft size={36}/></button>
          <span className="px-6 font-bold min-w-[220px] text-center text-3xl tracking-tighter pointer-events-none">{year}년 {month + 1}월</span>
          <button type="button" onClick={nextMonth} className="p-3 hover:bg-slate-100 rounded-lg transition-all active:scale-95 text-slate-500 hover:text-slate-800 cursor-pointer"><ChevronRight size={36}/></button>
          {/* [추가] 잠금 토글 */}
          <button 
            type="button" 
            onClick={handleToggleLock} 
            className={`p-3 ml-1 rounded-lg transition-all active:scale-95 cursor-pointer ${isUnlocked ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            title={isUnlocked ? '편집 모드 (클릭 시 잠금)' : '잠금 상태 (클릭 시 해제)'}
          >
            {isUnlocked ? <Unlock size={32}/> : <Lock size={32}/>}
          </button>
        </div>
      </div>

      {/* [추가] 비밀번호 입력 모달 */}
      {isLockModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-[24px] shadow-2xl overflow-hidden border border-slate-200">
            <div className="p-7 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                <div className="bg-slate-700 p-2.5 rounded-xl text-white shadow-md"><Lock size={24} /></div>
                편집 모드 잠금 해제
              </h3>
              <button type="button" onClick={() => setIsLockModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-600">
                <X size={30} />
              </button>
            </div>
            <form onSubmit={handleSubmitPassword} className="p-7 space-y-6">
              <input 
                type="password" 
                inputMode="numeric"
                placeholder="비밀번호"
                value={passwordInput}
                autoFocus
                onChange={(e) => setPasswordInput(e.target.value)}
                className="w-full p-5 bg-white border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none font-bold text-3xl text-center tracking-[0.3em] text-slate-800"
              />
              <div className="flex gap-3">
                <button type="button" onClick={() => setIsLockModalOpen(false)} className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold text-xl">취소</button>
                <button type="submit" className="flex-[2] py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xl shadow-lg shadow-blue-600/20">해제</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* [추가] 상세보기 모달 */}
      {detailPlan && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={() => setDetailPlanId(null)}>
          <div className="bg-white w-full max-w-2xl rounded-[24px] shadow-2xl overflow-hidden border border-slate-200 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-8 flex justify-between items-start" style={getThemeStyle(detailPlan.color)}>
              <div className="flex-1">
                <span className="inline-block bg-black/25 rounded-md px-3 py-1 text-lg font-bold mb-3">{getThemeLabel(detailPlan.color)}</span>
                <h3 className="text-4xl font-extrabold break-all leading-snug drop-shadow-sm">{detailPlan.title}</h3>
                <p className="text-xl font-semibold opacity-90 mt-2">{detailPlan.date}</p>
              </div>
              <button type="button" onClick={() => setDetailPlanId(null)} className="p-2 hover:bg-black/20 rounded-full text-white/80 hover:text-white shrink-0">
                <X size={36} />
              </button>
            </div>

            <div className="p-8 space-y-7 overflow-y-auto cell-scroll">
              <div>
                <label className="text-base font-bold text-slate-400 uppercase mb-2 block tracking-widest">행사 개요 / 세부사항</label>
                <p className="text-2xl font-medium text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {detailPlan.description ? detailPlan.description : <span className="text-slate-300">등록된 세부사항이 없습니다.</span>}
                </p>
              </div>

              <div>
                <label className="text-base font-bold text-slate-400 uppercase mb-3 block tracking-widest flex items-center gap-2">
                  <Paperclip size={18}/> 첨부파일
                </label>
                {Array.isArray(detailPlan.attachments) && detailPlan.attachments.length > 0 ? (
                  <div className="space-y-2">
                    {detailPlan.attachments.map((att, i) => (
                      <div key={att.path || i} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                        <div className="bg-blue-600 text-white p-2 rounded-lg shrink-0"><FileText size={22}/></div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-xl text-slate-700 truncate">{att.name}</p>
                          <p className="text-base text-slate-400">{formatBytes(att.size)}</p>
                        </div>
                        <a href={att.url} target="_blank" rel="noopener noreferrer" download className="p-2.5 bg-slate-200 hover:bg-blue-100 text-slate-600 hover:text-blue-600 rounded-lg shrink-0" title="다운로드">
                          <Download size={24}/>
                        </a>
                        {isUnlocked && (
                          <button type="button" onClick={() => handleRemoveAttachment(detailPlan.id, att)} className="p-2.5 bg-red-50 hover:bg-red-100 text-red-500 rounded-lg shrink-0" title="삭제">
                            <Trash2 size={24}/>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xl text-slate-300 font-medium">첨부된 파일이 없습니다.</p>
                )}
              </div>
            </div>

            {isUnlocked && (
              <div className="p-6 border-t border-slate-100 bg-slate-50 flex gap-3">
                <button type="button" onClick={() => handleDelete(null, detailPlan.id)} className="flex-1 py-4 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl font-bold text-xl flex items-center justify-center gap-2">
                  <Trash2 size={24}/> 삭제
                </button>
                <button type="button" onClick={() => openEditFromDetail(detailPlan)} className="flex-[2] py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xl shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2">
                  <Pencil size={24}/> 수정하기
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 등록 / 수정 모달 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white w-full max-w-2xl rounded-[24px] shadow-2xl overflow-hidden border border-slate-200 max-h-[92vh] flex flex-col">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
                <div className="bg-blue-600 p-2.5 rounded-xl text-white shadow-md">
                  <CalendarIcon size={28} />
                </div>
                {selectedDate} {editingPlanId ? '일정 수정' : '일정 등록'}
              </h3>
              <button type="button" onClick={closeModal} className="p-3 hover:bg-slate-200 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                <X size={36} />
              </button>
            </div>

            <div className="overflow-y-auto cell-scroll">
              {!editingPlanId && plansForSelectedDate.length > 0 && (
                <div className="px-8 pt-6">
                  <label className="text-lg font-bold text-slate-500 uppercase mb-3 block tracking-widest">이 날짜의 기존 일정</label>
                  <div className="space-y-2 max-h-40 overflow-y-auto cell-scroll">
                    {plansForSelectedDate.map(p => (
                      <div
                        key={p.id}
                        style={getThemeStyle(p.color)}
                        className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg shadow-sm cursor-pointer hover:brightness-95"
                        onClick={() => openEditFromDetail(p)}
                      >
                        <span className="font-bold text-xl flex-1 truncate">{p.title}</span>
                        <button type="button" onClick={(e) => handleDelete(e, p.id)} className="text-white/80 hover:text-white p-1 bg-black/20 rounded-md">
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
                  <label className="text-lg font-bold text-slate-500 uppercase mb-4 block tracking-widest">행사 개요 / 세부 사항</label>
                  <textarea 
                    rows="4"
                    placeholder="행사 목적, 대상, 장소, 진행 방식 등 자세한 개요를 입력하세요."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full p-5 bg-white border-2 border-slate-200 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none font-semibold text-2xl text-slate-800 resize-none transition-all placeholder:text-slate-300"
                  ></textarea>
                </div>

                {/* [추가] 첨부파일 영역 */}
                <div>
                  <label className="text-lg font-bold text-slate-500 uppercase mb-4 block tracking-widest">첨부파일 (운영계획서 등)</label>

                  {/* 수정 시 기존 첨부 */}
                  {editingPlanId && (() => {
                    const ep = plans.find(p => p.id === editingPlanId);
                    const existing = ep?.attachments || [];
                    return existing.length > 0 ? (
                      <div className="space-y-2 mb-3">
                        {existing.map((att, i) => (
                          <div key={att.path || i} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                            <FileText size={22} className="text-blue-600 shrink-0"/>
                            <span className="flex-1 font-bold text-lg text-slate-700 truncate">{att.name}</span>
                            <span className="text-base text-slate-400 shrink-0">{formatBytes(att.size)}</span>
                            <button type="button" onClick={() => handleRemoveAttachment(editingPlanId, att)} className="p-2 bg-red-50 hover:bg-red-100 text-red-500 rounded-lg shrink-0">
                              <Trash2 size={20}/>
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null;
                  })()}

                  {/* 업로드 대기 파일 */}
                  {newFiles.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {newFiles.map((f, i) => (
                        <div key={i} className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                          <Upload size={22} className="text-blue-600 shrink-0"/>
                          <span className="flex-1 font-bold text-lg text-blue-700 truncate">{f.name}</span>
                          <span className="text-base text-blue-400 shrink-0">{formatBytes(f.size)}</span>
                          <button type="button" onClick={() => removePendingFile(i)} className="p-2 bg-white hover:bg-red-50 text-red-500 rounded-lg shrink-0">
                            <X size={20}/>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />
                  <button 
                    type="button" 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-4 border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/50 rounded-xl text-slate-500 hover:text-blue-600 font-bold text-xl flex items-center justify-center gap-2 transition-all"
                  >
                    <Paperclip size={24}/> 파일 추가
                  </button>
                </div>
                
                <div className="flex gap-4 pt-4">
                  <button type="button" onClick={closeModal} className="flex-1 py-5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold text-2xl transition-colors">
                    취소
                  </button>
                  <button type="submit" disabled={saving} className="flex-[2] py-5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl font-bold text-2xl shadow-lg shadow-blue-600/20 active:scale-[0.98] transition-all">
                    {saving ? '저장 중...' : (editingPlanId ? '수정하기' : '저장하기')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
