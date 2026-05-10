/* ============================================================
   사내 분실물 통합 관리 시스템  –  App.jsx (단일 파일)
   기술스택: React 18 (CDN), Tailwind CSS, Firebase v10 compat
   ============================================================ */

const { useState, useEffect, useRef, useCallback } = React;

// ───────────────────────────────────────────────
// 1. Firebase 설정 (실제 배포 시 아래 값 교체)
// ───────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// appId는 Firebase appId 마지막 세그먼트를 사용 (경로용)
const RAW_APP_ID = firebaseConfig.appId || "lost-and-found-app";
// Firebase 경로: /artifacts/${appId}/public/data/
const APP_ID      = RAW_APP_ID.replace(/[^a-zA-Z0-9_-]/g, "-");
const COLLECTION  = `artifacts/${APP_ID}/public/data/lost_items`;

let app, auth, db, storage;
try {
  app     = firebase.app();
} catch (e) {
  app     = firebase.initializeApp(firebaseConfig);
}
auth    = firebase.auth();
db      = firebase.firestore();
storage = firebase.storage();

// ───────────────────────────────────────────────
// 2. 상수 / 카테고리
// ───────────────────────────────────────────────
const CATEGORIES = [
  { value: "electronics", label: "전자기기" },
  { value: "clothing",    label: "의류" },
  { value: "wallet",      label: "지갑/가방" },
  { value: "keys",        label: "열쇠/카드" },
  { value: "glasses",     label: "안경/선글라스" },
  { value: "umbrella",    label: "우산" },
  { value: "documents",   label: "서류/문서" },
  { value: "food",        label: "식품/음료" },
  { value: "jewelry",     label: "귀중품/액세서리" },
  { value: "other",       label: "기타" },
];

const STATUS = {
  HOLDING:   "보관중",
  COMPLETED: "수령완료",
};

const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]));

// ───────────────────────────────────────────────
// 3. 유틸
// ───────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")}`;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function dataURLtoBlob(dataurl) {
  const arr = dataurl.split(","), mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mime });
}

// ───────────────────────────────────────────────
// 4. 아이콘 래퍼 (Lucide UMD)
// ───────────────────────────────────────────────
function Icon({ name, size = 20, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && window.lucide) {
      ref.current.innerHTML = "";
      const svg = lucide.createElement(lucide[name] || lucide["HelpCircle"]);
      svg.setAttribute("width",  size);
      svg.setAttribute("height", size);
      if (className) svg.setAttribute("class", className);
      ref.current.appendChild(svg);
    }
  }, [name, size, className]);
  return <span ref={ref} style={{ display:"inline-flex", alignItems:"center" }} />;
}

// ───────────────────────────────────────────────
// 5. 공통 컴포넌트
// ───────────────────────────────────────────────
function Badge({ status }) {
  const cls = status === STATUS.COMPLETED
    ? "status-badge-completed"
    : "status-badge-holding";
  return (
    <span className={`${cls} text-xs font-semibold px-2 py-0.5 rounded-full`}>
      {status}
    </span>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
    </div>
  );
}

function Toast({ msg, type }) {
  if (!msg) return null;
  const bg = type === "error" ? "bg-red-500" : "bg-green-500";
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] ${bg} text-white px-5 py-3 rounded-xl shadow-xl text-sm font-medium fade-in`}>
      {msg}
    </div>
  );
}

// ───────────────────────────────────────────────
// 6. 카메라 모달
// ───────────────────────────────────────────────
function CameraModal({ onCapture, onClose }) {
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const streamRef  = useRef(null);
  const [facing, setFacing]     = useState("environment"); // environment | user
  const [preview, setPreview]   = useState(null);
  const [camErr, setCamErr]     = useState(null);
  const [devices, setDevices]   = useState([]);

  const startStream = useCallback(async (facingMode) => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    try {
      const constraints = {
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCamErr(null);
    } catch (err) {
      setCamErr("카메라 접근 권한이 필요합니다. 브라우저 설정을 확인해 주세요.");
    }
  }, []);

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then(d => {
      setDevices(d.filter(d => d.kind === "videoinput"));
    });
    startStream(facing);
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  const flip = () => {
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    setPreview(null);
    startStream(next);
  };

  const capture = () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setPreview(dataUrl);
  };

  const confirm = () => {
    if (preview) onCapture(preview);
  };

  const retake = () => setPreview(null);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box p-0 overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-brand-800 text-white">
          <span className="font-semibold flex items-center gap-2">
            <Icon name="Camera" size={18} className="text-white" /> 사진 촬영
          </span>
          <button onClick={onClose} className="p-1 hover:bg-brand-700 rounded-lg">
            <Icon name="X" size={20} className="text-white" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {camErr ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm text-center">
              <Icon name="AlertCircle" size={24} className="text-red-400 mx-auto mb-2" />
              {camErr}
            </div>
          ) : preview ? (
            <div className="space-y-3">
              <img src={preview} alt="미리보기" className="w-full rounded-xl object-cover max-h-72" />
              <div className="flex gap-2">
                <button onClick={retake} className="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-medium text-sm hover:bg-slate-50 transition flex items-center justify-center gap-2">
                  <Icon name="RotateCcw" size={16} /> 다시 찍기
                </button>
                <button onClick={confirm} className="flex-1 py-2.5 rounded-xl bg-brand-700 text-white font-semibold text-sm hover:bg-brand-800 transition flex items-center justify-center gap-2">
                  <Icon name="Check" size={16} className="text-white" /> 이 사진 사용
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="camera-preview mx-auto block"
                style={{ maxHeight: "320px", objectFit: "cover" }}
              />
              <canvas ref={canvasRef} className="hidden" />
              <div className="flex gap-2">
                {devices.length > 1 && (
                  <button onClick={flip} className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-600 text-sm hover:bg-slate-50 transition flex items-center gap-1.5">
                    <Icon name="RefreshCw" size={15} /> 전환
                  </button>
                )}
                <button
                  onClick={capture}
                  className="flex-1 py-3 rounded-xl bg-brand-700 text-white font-bold text-base hover:bg-brand-800 active:scale-95 transition flex items-center justify-center gap-2 shadow-md"
                >
                  <Icon name="Camera" size={20} className="text-white" /> 촬영
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────
// 7. 등록 모달 (신규 등록)
// ───────────────────────────────────────────────
function RegisterModal({ onClose, onSaved, showToast }) {
  const [form, setForm] = useState({
    itemName:  "",
    location:  "",
    category:  "other",
    foundDate: today(),
    registrar: "",
    memo:      "",
  });
  const [imageDataUrl, setImageDataUrl] = useState(null);
  const [showCamera,   setShowCamera]   = useState(false);
  const [uploading,    setUploading]    = useState(false);
  const fileInputRef = useRef(null);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleCapture = (dataUrl) => {
    setImageDataUrl(dataUrl);
    setShowCamera(false);
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImageDataUrl(ev.target.result);
    reader.readAsDataURL(file);
  };

  const uploadImage = async () => {
    if (!imageDataUrl) return null;
    const blob = dataURLtoBlob(imageDataUrl);
    const ext  = blob.type === "image/jpeg" ? "jpg" : "png";
    const path = `artifacts/${APP_ID}/public/data/images/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const ref  = storage.ref(path);
    await ref.put(blob);
    return await ref.getDownloadURL();
  };

  const handleSubmit = async () => {
    if (!form.itemName.trim())  { showToast("물품명을 입력해 주세요.", "error"); return; }
    if (!form.location.trim())  { showToast("습득 장소를 입력해 주세요.", "error"); return; }
    if (!form.registrar.trim()) { showToast("등록자를 입력해 주세요.", "error"); return; }
    setUploading(true);
    try {
      const imageUrl = await uploadImage();
      await db.collection(COLLECTION).add({
        itemName:   form.itemName.trim(),
        location:   form.location.trim(),
        category:   form.category,
        foundDate:  form.foundDate,
        registrar:  form.registrar.trim(),
        memo:       form.memo.trim(),
        imageUrl:   imageUrl || "",
        status:     STATUS.HOLDING,
        createdAt:  firebase.firestore.FieldValue.serverTimestamp(),
        receivedDate:    "",
        receiverName:    "",
        receiverContact: "",
        handlerName:     "",
      });
      showToast("분실물이 등록되었습니다.", "success");
      onSaved();
    } catch (err) {
      showToast("등록 중 오류가 발생했습니다: " + err.message, "error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-box" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Icon name="PlusCircle" size={20} className="text-brand-600" /> 분실물 신규 등록
            </h2>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500">
              <Icon name="X" size={20} />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* 사진 촬영 */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">물품 사진</label>
              {imageDataUrl ? (
                <div className="relative rounded-xl overflow-hidden border border-slate-200 group">
                  <img src={imageDataUrl} alt="등록 이미지" className="w-full object-cover max-h-52" />
                  <button
                    onClick={() => setImageDataUrl(null)}
                    className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 shadow hover:bg-red-600 transition"
                  >
                    <Icon name="X" size={14} className="text-white" />
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setShowCamera(true)}
                    className="flex flex-col items-center gap-2 py-5 border-2 border-dashed border-brand-300 rounded-xl text-brand-700 hover:bg-brand-50 transition font-medium text-sm"
                  >
                    <Icon name="Camera" size={28} className="text-brand-500" />
                    카메라 촬영
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center gap-2 py-5 border-2 border-dashed border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 transition font-medium text-sm"
                  >
                    <Icon name="ImagePlus" size={28} className="text-slate-400" />
                    갤러리에서 선택
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
                </div>
              )}
            </div>

            {/* 물품명 */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">물품명 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.itemName}
                onChange={e => set("itemName", e.target.value)}
                placeholder="예: 검정 우산, 갤럭시 버즈, 갈색 지갑"
                className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
              />
            </div>

            {/* 카테고리 */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">카테고리</label>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORIES.map(c => (
                  <button
                    key={c.value}
                    onClick={() => set("category", c.value)}
                    className={`py-2 text-xs rounded-xl border font-medium transition ${
                      form.category === c.value
                        ? "border-brand-500 bg-brand-600 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:bg-brand-50"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 습득 장소 */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">습득 장소 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.location}
                onChange={e => set("location", e.target.value)}
                placeholder="예: 3층 회의실, 1층 로비, 카페테리아"
                className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
              />
            </div>

            {/* 습득 일자 & 등록자 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">습득 일자</label>
                <input
                  type="date"
                  value={form.foundDate}
                  onChange={e => set("foundDate", e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">등록자 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.registrar}
                  onChange={e => set("registrar", e.target.value)}
                  placeholder="성함 또는 부서명"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 transition"
                />
              </div>
            </div>

            {/* 메모 */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">메모 (선택)</label>
              <textarea
                value={form.memo}
                onChange={e => set("memo", e.target.value)}
                rows={2}
                placeholder="특이사항, 색상, 브랜드 등 추가 정보"
                className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 transition resize-none"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-slate-100 flex gap-3 sticky bottom-0 bg-white">
            <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-slate-300 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition">
              취소
            </button>
            <button
              onClick={handleSubmit}
              disabled={uploading}
              className="flex-1 py-3 rounded-xl bg-brand-700 text-white font-bold text-sm hover:bg-brand-800 transition disabled:opacity-60 flex items-center justify-center gap-2 shadow-md"
            >
              {uploading
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> 저장 중...</>
                : <><Icon name="Save" size={16} className="text-white" /> 등록 완료</>
              }
            </button>
          </div>
        </div>
      </div>

      {showCamera && (
        <CameraModal onCapture={handleCapture} onClose={() => setShowCamera(false)} />
      )}
    </>
  );
}

// ───────────────────────────────────────────────
// 8. 상세 / 수정 모달
// ───────────────────────────────────────────────
function DetailModal({ item, onClose, onUpdated, onDeleted, showToast }) {
  const [editing,    setEditing]    = useState(false);
  const [statusEdit, setStatusEdit] = useState(false);
  const [form, setForm] = useState({
    receivedDate:    item.receivedDate    || today(),
    receiverName:    item.receiverName    || "",
    receiverContact: item.receiverContact || "",
    handlerName:     item.handlerName     || "",
  });
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isCompleted = item.status === STATUS.COMPLETED;

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleStatusChange = async () => {
    if (!form.receiverName.trim())    { showToast("수령인 성함을 입력해 주세요.", "error"); return; }
    if (!form.receiverContact.trim()) { showToast("수령인 연락처를 입력해 주세요.", "error"); return; }
    if (!form.handlerName.trim())     { showToast("반출 담당자를 입력해 주세요.", "error"); return; }
    setSaving(true);
    try {
      await db.collection(COLLECTION).doc(item.id).update({
        status:          STATUS.COMPLETED,
        receivedDate:    form.receivedDate,
        receiverName:    form.receiverName.trim(),
        receiverContact: form.receiverContact.trim(),
        handlerName:     form.handlerName.trim(),
        updatedAt:       firebase.firestore.FieldValue.serverTimestamp(),
      });
      showToast("수령 완료로 상태가 변경되었습니다.", "success");
      onUpdated();
    } catch (err) {
      showToast("수정 중 오류: " + err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await db.collection(COLLECTION).doc(item.id).delete();
      showToast("항목이 삭제되었습니다.", "success");
      onDeleted();
    } catch (err) {
      showToast("삭제 중 오류: " + err.message, "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-800">분실물 상세</h2>
            <Badge status={item.status} />
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500">
            <Icon name="X" size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* 이미지 */}
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.itemName}
              className="w-full max-h-60 object-cover rounded-xl border border-slate-200 bg-slate-100"
            />
          ) : (
            <div className="w-full h-36 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-2 text-slate-400">
              <Icon name="Image" size={36} className="text-slate-300" />
              <span className="text-sm">등록된 사진 없음</span>
            </div>
          )}

          {/* 기본 정보 */}
          <div className="grid grid-cols-2 gap-3">
            <InfoRow label="물품명"   value={item.itemName} wide />
            <InfoRow label="카테고리" value={CATEGORY_MAP[item.category] || item.category} />
            <InfoRow label="습득 장소" value={item.location} />
            <InfoRow label="습득 일자" value={formatDate(item.foundDate)} />
            <InfoRow label="등록자"   value={item.registrar} />
            <InfoRow label="등록 일시" value={item.createdAt?.toDate ? formatDate(item.createdAt.toDate().toISOString().slice(0,10)) : "-"} />
            {item.memo && <InfoRow label="메모" value={item.memo} wide />}
          </div>

          {/* 수령 완료 정보 */}
          {isCompleted && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
              <p className="text-sm font-bold text-green-800 flex items-center gap-1.5">
                <Icon name="CheckCircle" size={16} className="text-green-600" /> 수령 완료 정보
              </p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <InfoRow label="수령 일자"   value={formatDate(item.receivedDate)} />
                <InfoRow label="반출 담당자" value={item.handlerName} />
                <InfoRow label="수령인"      value={item.receiverName} />
                <InfoRow label="수령인 연락처" value={item.receiverContact} />
              </div>
            </div>
          )}

          {/* 상태 변경 패널 */}
          {!isCompleted && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setStatusEdit(p => !p)}
                className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 transition"
              >
                <span className="flex items-center gap-2">
                  <Icon name="ArrowRightCircle" size={16} className="text-brand-500" />
                  수령 완료로 상태 변경
                </span>
                <Icon name={statusEdit ? "ChevronUp" : "ChevronDown"} size={16} />
              </button>

              {statusEdit && (
                <div className="p-4 space-y-3 bg-white">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">수령(반출) 일자 <span className="text-red-500">*</span></label>
                      <input
                        type="date"
                        value={form.receivedDate}
                        onChange={e => set("receivedDate", e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">반출 담당자 <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        value={form.handlerName}
                        onChange={e => set("handlerName", e.target.value)}
                        placeholder="담당자 성함"
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 transition"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">수령인 성함 <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={form.receiverName}
                      onChange={e => set("receiverName", e.target.value)}
                      placeholder="수령인 실명"
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">수령인 연락처 <span className="text-red-500">*</span></label>
                    <input
                      type="tel"
                      value={form.receiverContact}
                      onChange={e => set("receiverContact", e.target.value)}
                      placeholder="예: 010-0000-0000"
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 transition"
                    />
                  </div>
                  <button
                    onClick={handleStatusChange}
                    disabled={saving}
                    className="w-full py-2.5 rounded-xl bg-green-600 text-white font-bold text-sm hover:bg-green-700 transition disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {saving
                      ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> 저장 중...</>
                      : <><Icon name="CheckCircle" size={16} className="text-white" /> 수령 완료 처리</>
                    }
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 flex gap-3 sticky bottom-0 bg-white">
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 transition font-medium text-sm"
            >
              <Icon name="Trash2" size={15} /> 삭제
            </button>
          ) : (
            <div className="flex items-center gap-2 flex-1">
              <span className="text-sm text-red-600 font-semibold">정말 삭제하시겠습니까?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-2 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition"
              >
                확인
              </button>
              <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-2 rounded-xl border border-slate-300 text-slate-600 text-sm hover:bg-slate-50 transition">
                취소
              </button>
            </div>
          )}
          <button onClick={onClose} className="ml-auto px-5 py-2.5 rounded-xl border border-slate-300 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// 상세 정보 행
function InfoRow({ label, value, wide }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <dt className="text-xs text-slate-500 font-medium mb-0.5">{label}</dt>
      <dd className="text-sm font-semibold text-slate-800 break-words">{value || "-"}</dd>
    </div>
  );
}

// ───────────────────────────────────────────────
// 9. 분실물 카드 (Gallery View)
// ───────────────────────────────────────────────
function ItemCard({ item, onClick }) {
  const isCompleted = item.status === STATUS.COMPLETED;
  return (
    <div
      onClick={() => onClick(item)}
      className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden fade-in"
    >
      {/* 이미지 */}
      <div className="relative h-40 bg-slate-100">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.itemName} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-slate-300">
            <Icon name="Image" size={32} className="text-slate-200" />
            <span className="text-xs">사진 없음</span>
          </div>
        )}
        {isCompleted && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <span className="bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow">수령완료</span>
          </div>
        )}
        <div className="absolute top-2 left-2">
          <span className="bg-white/90 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full shadow-sm">
            {CATEGORY_MAP[item.category] || item.category}
          </span>
        </div>
      </div>

      {/* 내용 */}
      <div className="p-3 space-y-1.5">
        <p className="font-bold text-slate-800 text-sm truncate">{item.itemName}</p>
        <p className="text-xs text-slate-500 flex items-center gap-1 truncate">
          <Icon name="MapPin" size={12} className="text-slate-400 shrink-0" />
          {item.location}
        </p>
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-slate-400">{formatDate(item.foundDate)}</span>
          <Badge status={item.status} />
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────
// 10. 분실물 행 (List View)
// ───────────────────────────────────────────────
function ItemRow({ item, onClick }) {
  return (
    <tr
      onClick={() => onClick(item)}
      className="hover:bg-brand-50 cursor-pointer transition border-b border-slate-100 last:border-0 fade-in"
    >
      <td className="py-3 px-3">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200" loading="lazy" />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
            <Icon name="Image" size={16} className="text-slate-300" />
          </div>
        )}
      </td>
      <td className="py-3 px-2">
        <p className="font-semibold text-slate-800 text-sm">{item.itemName}</p>
        <p className="text-xs text-slate-400">{CATEGORY_MAP[item.category]}</p>
      </td>
      <td className="py-3 px-2 text-sm text-slate-600 hidden sm:table-cell">{item.location}</td>
      <td className="py-3 px-2 text-sm text-slate-500 hidden md:table-cell">{formatDate(item.foundDate)}</td>
      <td className="py-3 px-2 text-sm text-slate-500 hidden lg:table-cell">{item.registrar}</td>
      <td className="py-3 px-2">
        <Badge status={item.status} />
      </td>
    </tr>
  );
}

// ───────────────────────────────────────────────
// 11. 메인 앱
// ───────────────────────────────────────────────
function App() {
  const [items,       setItems]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [viewMode,    setViewMode]    = useState("gallery"); // gallery | list
  const [search,      setSearch]      = useState("");
  const [filterStatus, setFilterStatus] = useState("all"); // all | holding | completed
  const [filterCat,   setFilterCat]   = useState("all");
  const [showRegister, setShowRegister] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [toast, setToast] = useState({ msg: "", type: "" });
  const toastTimer = useRef(null);

  const showToast = useCallback((msg, type = "success") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast({ msg: "", type: "" }), 3200);
  }, []);

  // Firestore 실시간 구독
  useEffect(() => {
    setLoading(true);
    const unsub = db
      .collection(COLLECTION)
      .orderBy("createdAt", "desc")
      .onSnapshot(
        snap => {
          const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          setItems(data);
          setLoading(false);
        },
        err => {
          console.error(err);
          showToast("데이터를 불러오는 중 오류가 발생했습니다.", "error");
          setLoading(false);
        }
      );
    return () => unsub();
  }, []);

  // 필터링
  const filtered = items.filter(item => {
    const q = search.toLowerCase();
    const matchSearch = !q || item.itemName?.toLowerCase().includes(q) || item.location?.toLowerCase().includes(q) || item.registrar?.toLowerCase().includes(q);
    const matchStatus = filterStatus === "all"
      || (filterStatus === "holding"   && item.status === STATUS.HOLDING)
      || (filterStatus === "completed" && item.status === STATUS.COMPLETED);
    const matchCat = filterCat === "all" || item.category === filterCat;
    return matchSearch && matchStatus && matchCat;
  });

  // 통계
  const totalCount     = items.length;
  const holdingCount   = items.filter(i => i.status === STATUS.HOLDING).length;
  const completedCount = items.filter(i => i.status === STATUS.COMPLETED).length;

  const handleSaved = () => {
    setShowRegister(false);
  };
  const handleUpdated = () => {
    setSelectedItem(null);
  };
  const handleDeleted = () => {
    setSelectedItem(null);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── 헤더 ── */}
      <header className="bg-brand-800 text-white shadow-xl sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center shadow-inner shrink-0">
              <Icon name="Package" size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="font-extrabold text-base sm:text-lg leading-tight truncate">분실물 통합 관리</h1>
              <p className="text-brand-200 text-xs hidden sm:block">Lost &amp; Found Management System</p>
            </div>
          </div>
          <button
            onClick={() => setShowRegister(true)}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 bg-white text-brand-800 rounded-xl font-bold text-sm hover:bg-brand-50 active:scale-95 transition shadow-md"
          >
            <Icon name="PlusCircle" size={17} className="text-brand-700" />
            <span className="hidden sm:inline">분실물 등록</span>
            <span className="sm:hidden">등록</span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-5 space-y-5">

        {/* ── 요약 카드 ── */}
        <div className="grid grid-cols-3 gap-3">
          <SummaryCard
            label="전체"
            count={totalCount}
            icon="Archive"
            color="brand"
            active={filterStatus === "all"}
            onClick={() => setFilterStatus("all")}
          />
          <SummaryCard
            label="보관중"
            count={holdingCount}
            icon="PackageCheck"
            color="blue"
            active={filterStatus === "holding"}
            onClick={() => setFilterStatus("holding")}
          />
          <SummaryCard
            label="수령완료"
            count={completedCount}
            icon="CheckCircle"
            color="green"
            active={filterStatus === "completed"}
            onClick={() => setFilterStatus("completed")}
          />
        </div>

        {/* ── 검색 & 필터 바 ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 space-y-3">
          {/* 검색 */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="Search" size={17} />
            </span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="물품명, 장소, 등록자로 검색..."
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 transition"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <Icon name="X" size={15} />
              </button>
            )}
          </div>

          {/* 카테고리 필터 + 뷰 전환 */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 flex-1 min-w-0">
              <FilterChip label="전체" active={filterCat === "all"}  onClick={() => setFilterCat("all")} />
              {CATEGORIES.map(c => (
                <FilterChip key={c.value} label={c.label} active={filterCat === c.value} onClick={() => setFilterCat(c.value)} />
              ))}
            </div>
            {/* 뷰 전환 */}
            <div className="flex shrink-0 border border-slate-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setViewMode("gallery")}
                className={`px-3 py-2 transition ${viewMode === "gallery" ? "bg-brand-700 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
              >
                <Icon name="LayoutGrid" size={16} />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`px-3 py-2 transition ${viewMode === "list" ? "bg-brand-700 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
              >
                <Icon name="List" size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* ── 결과 헤더 ── */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {filtered.length > 0
              ? <><span className="font-bold text-slate-800">{filtered.length}</span>건 표시 중</>
              : "검색 결과 없음"
            }
          </p>
        </div>

        {/* ── 목록 ── */}
        {loading ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <EmptyState hasSearch={!!search || filterStatus !== "all" || filterCat !== "all"} onReset={() => { setSearch(""); setFilterStatus("all"); setFilterCat("all"); }} />
        ) : viewMode === "gallery" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filtered.map(item => (
              <ItemCard key={item.id} item={item} onClick={setSelectedItem} />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th className="py-3 px-3 w-14">사진</th>
                    <th className="py-3 px-2">물품명</th>
                    <th className="py-3 px-2 hidden sm:table-cell">장소</th>
                    <th className="py-3 px-2 hidden md:table-cell">습득일</th>
                    <th className="py-3 px-2 hidden lg:table-cell">등록자</th>
                    <th className="py-3 px-2">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => (
                    <ItemRow key={item.id} item={item} onClick={setSelectedItem} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* ── 모달들 ── */}
      {showRegister && (
        <RegisterModal
          onClose={() => setShowRegister(false)}
          onSaved={handleSaved}
          showToast={showToast}
        />
      )}
      {selectedItem && (
        <DetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
          showToast={showToast}
        />
      )}

      {/* ── 토스트 ── */}
      <Toast msg={toast.msg} type={toast.type} />
    </div>
  );
}

// ───────────────────────────────────────────────
// 12. 작은 공통 컴포넌트
// ───────────────────────────────────────────────
function SummaryCard({ label, count, icon, color, active, onClick }) {
  const base = "rounded-2xl p-3 sm:p-4 border cursor-pointer transition-all shadow-sm hover:shadow-md";
  const colorMap = {
    brand: { bg: active ? "bg-brand-700 border-brand-700 text-white" : "bg-white border-slate-200 text-slate-800", icon: active ? "text-white" : "text-brand-500" },
    blue:  { bg: active ? "bg-blue-600  border-blue-600  text-white" : "bg-white border-slate-200 text-slate-800", icon: active ? "text-white" : "text-blue-500" },
    green: { bg: active ? "bg-green-600 border-green-600 text-white" : "bg-white border-slate-200 text-slate-800", icon: active ? "text-white" : "text-green-500" },
  };
  const { bg, icon: iconCls } = colorMap[color];
  return (
    <div onClick={onClick} className={`${base} ${bg} active:scale-95`}>
      <div className="flex items-center justify-between mb-1.5">
        <Icon name={icon} size={18} className={iconCls} />
      </div>
      <p className={`text-2xl font-extrabold leading-tight ${active ? "text-white" : "text-slate-800"}`}>{count}</p>
      <p className={`text-xs font-medium mt-0.5 ${active ? "text-white/80" : "text-slate-500"}`}>{label}</p>
    </div>
  );
}

function FilterChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition whitespace-nowrap ${
        active
          ? "bg-brand-700 border-brand-700 text-white shadow-sm"
          : "bg-white border-slate-200 text-slate-600 hover:border-brand-300 hover:text-brand-700"
      }`}
    >
      {label}
    </button>
  );
}

function EmptyState({ hasSearch, onReset }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center fade-in">
      <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
        <Icon name={hasSearch ? "SearchX" : "PackageOpen"} size={36} className="text-slate-300" />
      </div>
      <p className="text-slate-700 font-bold text-lg mb-1">
        {hasSearch ? "검색 결과가 없습니다" : "등록된 분실물이 없습니다"}
      </p>
      <p className="text-slate-400 text-sm mb-5">
        {hasSearch ? "다른 키워드로 검색하거나 필터를 초기화해 보세요." : "상단의 '분실물 등록' 버튼을 눌러 첫 번째 항목을 등록하세요."}
      </p>
      {hasSearch && (
        <button onClick={onReset} className="px-5 py-2.5 bg-brand-700 text-white rounded-xl font-semibold text-sm hover:bg-brand-800 transition">
          필터 초기화
        </button>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────
// 13. 렌더링
// ───────────────────────────────────────────────
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
