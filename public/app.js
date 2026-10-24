// 홈드롭 예약 챗봇 화면.
// - 자유 질문 → /api/chat (안내 자료 근거 답변, 출처 링크)
// - 예약 → 정해진 순서로 하나씩 묻고 /api/bookings 에 접수 (서버가 다시 검사하고 태그 번호를 매긴다)
// - 관리자 예약표 → 비밀번호로 로그인한 관리자만 /api/bookings 를 읽고 상태를 바꾼다

const 지역 = ["서울", "인천", "경기"];
const 상태목록 = ["수거 대기", "배차 확정", "수거 완료", "취소"];
const 출입증키 = "homedrop.admin.token";

const $ = (s) => document.querySelector(s);
const log = $("#chatLog");
const chips = $("#chips");
const input = $("#chatInput");

// ───────── 공통 ─────────
const 원 = (n) => Number(n).toLocaleString("ko-KR") + "원";
const 요금 = (짐) => 30000 + 25000 * (짐 - 1);

function kst(date, opts) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", ...opts }).format(date);
}
function kst날짜(date) {
  // YYYY-MM-DD (한국 시간)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}
function kst시(date) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23" }).format(date));
}
const 보기시각 = (d) => kst(d, { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function 오늘부터(일) {
  const 오늘 = new Date(kst날짜(new Date()) + "T00:00:00+09:00");
  return new Date(오늘.getTime() + 일 * 86400000);
}

// 「2026-10-25 14:30」「10/25 14:30」「10월 25일 오후 2시 30분」「내일 오후 2시」 → ISO(+09:00). 못 읽으면 null
function 날짜읽기(v) {
  const 오늘 = kst날짜(new Date());
  let y = Number(오늘.slice(0, 4)), mo, d;
  let m;
  if ((m = v.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/))) [, y, mo, d] = m.map(Number);
  else if ((m = v.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)) || (m = v.match(/(?:^|\s)(\d{1,2})\s*[/.-]\s*(\d{1,2})(?=\s|$)/))) [, mo, d] = m.map(Number);
  else if ((m = v.match(/오늘|내일|모레/))) {
    const t = 오늘부터({ 오늘: 0, 내일: 1, 모레: 2 }[m[0]]);
    [y, mo, d] = kst날짜(t).split("-").map(Number);
  } else return null;

  let h, mi = 0;
  if ((m = v.match(/(\d{1,2}):(\d{2})/))) [h, mi] = [Number(m[1]), Number(m[2])];
  else if ((m = v.match(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분|\s*반)?/))) [h, mi] = [Number(m[1]), m[2] ? Number(m[2]) : /반/.test(m[0]) ? 30 : 0];
  else return null;
  if (/오후|저녁|밤/.test(v) && h < 12) h += 12;
  if (/오전|새벽/.test(v) && h === 12) h = 0;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:00+09:00`;
}

// 서버 호출. 응답 본문이 JSON 이 아니어도(빈 400 등) 오류 문구를 만들어 준다
async function 요청(url, opts = {}) {
  const 출입증 = 관리자출입증();
  const headers = { "Content-Type": "application/json", ...(출입증 ? { Authorization: "Bearer " + 출입증 } : {}), ...(opts.headers || {}) };
  const r = await fetch(url, { ...opts, headers });
  let d = {};
  try { d = await r.json(); } catch { /* 빈 본문 */ }
  if (!r.ok) {
    const e = new Error(d.error || `요청이 실패했어요 (${r.status})`);
    e.status = r.status;
    throw e;
  }
  return d;
}

// ───────── 채팅 그리기 ─────────
function 말풍선(who, text, extra) {
  const el = document.createElement("div");
  el.className = "msg " + who;
  el.textContent = text;
  if (extra) el.appendChild(extra);
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function 기다림() {
  const el = document.createElement("div");
  el.className = "msg bot typing";
  el.setAttribute("aria-label", "드롭이가 답을 준비하고 있어요");
  el.innerHTML = "<i></i><i></i><i></i>";
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

// 답 아래 덧붙임: 「AI 생성 답변」 표시 + 출처(기관·페이지 이름과 링크)
function 출처표시(sources, mode) {
  const box = document.createElement("span");
  box.className = "src";
  if (mode === "safety") {
    // 위기 안내: 휴대전화에서 바로 걸 수 있게
    for (const [n, t] of [["109", "109 전화하기"], ["15770199", "1577-0199"], ["119", "119"]]) {
      const a = document.createElement("a");
      a.href = "tel:" + n;
      a.className = "tel";
      a.textContent = t;
      box.appendChild(a);
    }
  }
  if (mode === "ai") {
    const ai = document.createElement("span");
    ai.className = "ai-badge";
    ai.textContent = "AI 생성 답변";
    box.appendChild(ai);
  }
  for (const s of sources || []) {
    if (s.url && /^https:\/\//.test(s.url)) {
      const a = document.createElement("a");
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = s.label + " ↗";
      box.appendChild(a);
    } else {
      const t = document.createElement("span");
      t.className = "demo";
      t.textContent = s.label;
      box.appendChild(t);
    }
  }
  return box.childNodes.length ? box : null;
}

function 입력잠금(잠금) {
  input.disabled = 잠금;
  $("#chatForm button").disabled = 잠금;
  chips.querySelectorAll("button").forEach((b) => (b.disabled = 잠금));
}
function 선택지(list) {
  chips.innerHTML = "";
  for (const o of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (o.primary ? " primary" : "");
    b.textContent = o.label;
    b.onclick = () => { 말풍선("user", o.label); 선택지([]); o.run(); };
    chips.appendChild(b);
  }
}

// ───────── 자유 질문 ─────────
const 대화 = []; // 이용자가 한 질문만 (서버도 AI 답은 받지 않는다)
async function 질문하기(q) {
  const wait = 기다림();
  입력잠금(true);
  try {
    const d = await 요청("/api/chat", { method: "POST", body: JSON.stringify({ question: q, history: 대화.slice(-6) }) });
    wait.remove();
    말풍선("bot", d.answer || "답을 만들지 못했어요.", 출처표시(d.sources, d.mode));
    대화.push({ role: "user", content: q });
  } catch (e) {
    wait.remove();
    말풍선("bot", e.status ? e.message : "서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
  }
  입력잠금(false);
  기본선택지();
  input.focus();
}

function 기본선택지() {
  선택지([
    { label: "예약 시작", primary: true, run: 예약시작 },
    { label: "짐 3개면 얼마예요?", run: () => 질문하기("짐 3개면 요금이 얼마예요?") },
    { label: "보조배터리도 맡길 수 있나요?", run: () => 질문하기("보조배터리도 맡길 수 있나요?") },
    { label: "몇 시에 수거해 가요?", run: () => 질문하기("수거는 몇 시에 해 가나요?") },
    { label: "제2터미널 항공사는?", run: () => 질문하기("인천공항 제2터미널을 쓰는 항공사는 어디예요?") },
  ]);
}

const 첫인사 = "안녕하세요, 홈드롭 안내 도우미 「드롭이」예요. 무거운 짐은 집 앞에서 받아 인천공항까지 옮겨 드릴게요(수업 시연용).\n예약은 「예약 시작」을 눌러 주시고, 요금·수거 시간·맡길 수 없는 물품·공항 이용이 궁금하면 편하게 물어보세요.";

function 대화새로() {
  log.innerHTML = "";
  대화.length = 0;
  예약 = null;
  지금단계 = null;
  진행표시();
  말풍선("bot", 첫인사);
  기본선택지();
}

// ───────── 예약 (하나씩 묻기) ─────────
let 예약 = null; // 진행 중인 예약. null 이면 자유 질문 모드
let 지금단계 = null;
const 순서 = ["동의", "이름", "연락처", "주소", "항공편", "짐", "수거시각", "확인"];

const 단계 = {
  동의: {
    묻기() {
      const 안내 = document.createElement("a");
      안내.href = "privacy.html";
      안내.target = "_blank";
      안내.rel = "noopener";
      안내.className = "inline-link";
      안내.textContent = "개인정보 처리 안내 전체 보기 ↗";
      말풍선("bot", "예약 전에 개인정보 수집·이용 동의가 필요해요.\n• 모으는 정보: 성함, 휴대전화 번호, 수거 주소, 항공편, 짐 개수\n• 쓰는 곳: 예약 확인, 수거 연락, 배차\n• 보관: 접수 후 30일 뒤 자동 삭제\n• 저장 위치: 미국(Upstash·Vercel 서버)\n동의하지 않으면 예약할 수 없지만, 안내 질문은 계속 할 수 있어요.", 안내);
      return "대기";
    },
    칩: () => [
      { label: "동의하고 예약 시작", primary: true, run: () => 받아서("동의") },
      { label: "동의하지 않음", run: 그만두기 },
    ],
    받기(v) {
      if (!/^(동의|네|예|좋아|확인)/.test(v)) return "예약하려면 「동의」라고 적거나 아래 버튼을 눌러 주세요. 그만하려면 「그만」이라고 적어 주세요.";
      예약.consent = true;
    },
    다음: "이름",
  },
  이름: {
    묻기: "예약자 성함을 알려 주세요. (시연용이니 가명으로 적어 주세요)",
    받기(v) {
      if (v.length < 2 || v.length > 20) return "성함은 2~20자로 적어 주세요.";
      예약.name = v;
    },
    다음: "연락처",
  },
  연락처: {
    묻기: () => `${예약.name} 님, 연락처를 알려 주세요. (예: 010-0000-0000 — 실제 번호는 넣지 마세요)`,
    받기(v) {
      const n = v.replace(/\D/g, "");
      if (!/^01[016789]\d{7,8}$/.test(n)) return "휴대전화 번호 형식이 아니에요. 예: 010-0000-0000";
      예약.phone = n.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
    },
    다음: "주소",
  },
  주소: {
    묻기: "짐을 수거할 주소를 알려 주세요. 시연에서는 서울·인천·경기만 받아요. (예: 서울 성북구 삼선교로 16길)",
    받기(v) {
      const 시 = 지역.find((g) => v.startsWith(g));
      if (!시) return "주소는 서울·인천·경기로 시작하게 적어 주세요. (시연용 수거 가능 지역)";
      if (v.length < 6) return "주소를 조금 더 자세히 적어 주세요.";
      예약.address = v;
    },
    다음: "항공편",
  },
  항공편: {
    묻기: "탑승하실 항공편 번호를 알려 주세요. (예: KE703, OZ102, 7C1101)",
    async 받기(v) {
      const 편 = v.toUpperCase().replace(/\s+/g, "");
      if (!/^[A-Z0-9]{2}\d{1,4}$/.test(편)) return "항공편 번호는 영문 2자리 + 숫자예요. 예: KE703";
      예약.flight = 편;
      const 찾는중 = 말풍선("bot pending", "인천공항 운항 현황에서 찾는 중…");
      입력잠금(true);
      let d = null;
      try { d = await 요청("/api/flight?flight=" + encodeURIComponent(편)); } catch { /* 형식 확인으로 */ }
      찾는중.remove();
      입력잠금(false);
      const 범위 = (f) => { const t = new Date(f.departure); return t >= new Date() && t < 오늘부터(7); };
      const 전체 = d && d.flights ? d.flights : [];
      const 후보 = 전체.filter(범위);
      if (전체.length && !후보.length) {
        말풍선("bot", `${편}편은 운항 현황에 있지만, 예약할 수 있는 출발편이 없어요(오늘 편은 이미 출발했거나 6일 뒤를 넘었어요). 다른 항공편 번호를 알려 주세요.`);
        return "대기";
      }
      if (후보.length) {
        말풍선("bot", `${편}편을 찾았어요. 출발 날짜를 골라 주세요. (오늘~6일 뒤, 인천국제공항공사 운항 현황)`);
        선택지(후보.map((f) => ({
          label: `${보기시각(new Date(f.departure))} · ${f.terminal}${f.destination ? " · " + f.destination : ""}`,
          run: () => { 예약.departure = f.departure; 예약.terminal = f.terminal; 예약.airline = f.airline; 예약.destination = f.destination; 이동("짐"); },
        })));
        return "대기";
      }
      말풍선("bot", `운항 현황 자료에서 ${편}편을 찾지 못했어요. 번호 형식은 맞으니 출발 날짜와 시각을 직접 적어 주세요.`);
      return 이동("출발시각");
    },
  },
  출발시각: {
    묻기: () => `출발 날짜와 시각을 적어 주세요. 오늘부터 6일 뒤(${kst날짜(오늘부터(6))})까지만 예약할 수 있어요. (예: ${kst날짜(오늘부터(2))} 14:30)`,
    받기(v) {
      const iso = 날짜읽기(v);
      if (!iso) return "「10/25 14:30」이나 「10월 25일 오후 2시 30분」처럼 날짜와 시각을 함께 적어 주세요.";
      const t = new Date(iso);
      if (isNaN(t)) return "날짜를 읽지 못했어요. 다시 적어 주세요.";
      if (t < new Date() || t >= 오늘부터(7)) return `오늘부터 ${kst날짜(오늘부터(6))}까지 출발편만 예약할 수 있어요.`;
      예약.departure = iso;
      예약.terminal = "확인 필요";
    },
    다음: "짐",
  },
  짐: {
    묻기: "맡기실 짐은 몇 개인가요? (1~5개, 1개당 32kg·세 변 합 203cm 이하 — 시연용 기준)",
    칩: () => [1, 2, 3, 4, 5].map((n) => ({ label: `${n}개 · ${원(요금(n))}`, run: () => 받아서(String(n)) })),
    받기(v) {
      const n = Number((v.match(/\d+/) || [])[0]);
      if (!(n >= 1 && n <= 5)) return "짐은 1~5개까지 받아요. 숫자로 알려 주세요.";
      예약.bags = n;
      예약.fee = 요금(n);
    },
    다음: "수거시각",
  },
  수거시각: {
    묻기() {
      const 출발 = new Date(예약.departure);
      const 지금 = Date.now();
      // 시연용 규칙: 08~20시 짝수 정각, 출발 6~30시간 전, 지금부터 2시간 이후, 출발에 가까운 3개 (서버도 같은 규칙으로 다시 검사)
      const 후보 = [];
      for (let 일 = -2; 일 <= 0; 일++) {
        const 날 = kst날짜(new Date(출발.getTime() + 일 * 86400000));
        for (const h of [8, 10, 12, 14, 16, 18, 20]) {
          const t = new Date(`${날}T${String(h).padStart(2, "0")}:00:00+09:00`);
          const 전 = (출발 - t) / 3600000;
          if (전 >= 6 && 전 <= 30 && t.getTime() >= 지금 + 2 * 3600000) 후보.push(t);
        }
      }
      후보.sort((a, b) => b - a).splice(3);
      if (!후보.length) {
        예약 = null;
        진행표시();
        기본선택지();
        return "죄송해요. 이 항공편은 수거 규칙(08~20시, 출발 6~30시간 전, 지금부터 2시간 이후)에 맞는 수거 시각이 없어요. 공항 카운터나 이지드랍 이용을 검토해 주세요.";
      }
      선택지(후보.map((t) => ({ label: 보기시각(t) + " 수거", run: () => { 예약.pickup = t.toISOString(); 이동("확인"); } })));
      return `출발 시각 ${보기시각(출발)} 기준으로 가능한 수거 시각이에요. 하나를 골라 주세요.`;
    },
    받기: () => "아래 버튼에서 수거 시각을 골라 주세요.",
  },
  확인: {
    묻기() {
      말풍선("bot", "아래 내용으로 접수할까요? 보조배터리·전자담배·라이터는 짐에서 꺼내 주세요.", 요약표([
        ["예약자", 예약.name], ["연락처", 예약.phone], ["수거 주소", 예약.address],
        ["항공편", `${예약.flight}${예약.airline ? " (" + 예약.airline + ")" : ""}`],
        ["출발", `${보기시각(new Date(예약.departure))} · ${예약.terminal}`],
        ["수거", 보기시각(new Date(예약.pickup))], ["짐", 예약.bags + "개"], ["요금(시연용)", 원(예약.fee)],
      ]));
      확인선택지();
      return "대기";
    },
    받기: () => "아래 버튼으로 접수 여부를 골라 주세요.",
  },
};

function 요약표(줄) {
  const dl = document.createElement("dl");
  dl.className = "summary";
  for (const [k, v] of 줄) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    dl.append(dt, dd);
  }
  return dl;
}

function 확인선택지() {
  선택지([
    { label: "이대로 접수", primary: true, run: 접수 },
    { label: "처음부터 다시", run: 예약시작 },
    { label: "그만두기", run: 그만두기 },
  ]);
}

// 예약 진행 표시 (몇 번째 단계인지)
function 진행표시() {
  const el = $("#progress");
  if (!예약 || !지금단계) { el.hidden = true; return; }
  const 이름 = 지금단계 === "출발시각" ? "항공편" : 지금단계;
  const i = 순서.indexOf(이름);
  el.hidden = false;
  el.querySelector("span").textContent = `예약 ${i + 1} / ${순서.length} · ${{ 동의: "개인정보 동의", 이름: "성함", 연락처: "연락처", 주소: "수거 주소", 항공편: "항공편", 짐: "짐 개수", 수거시각: "수거 시각", 확인: "확인" }[이름]}`;
  el.querySelector("i").style.width = `${((i + 1) / 순서.length) * 100}%`;
}

function 이동(이름) {
  지금단계 = 이름;
  진행표시();
  const s = 단계[이름];
  const 글 = typeof s.묻기 === "function" ? s.묻기() : s.묻기;
  if (글 && 글 !== "대기") 말풍선("bot", 글);
  if (!예약) return "대기";
  if (s.칩) 선택지(s.칩());
  else if (!["수거시각", "확인"].includes(이름)) 선택지([{ label: "그만두기", run: 그만두기 }]);
  return "대기";
}

async function 받아서(v) {
  const s = 단계[지금단계];
  const 결과 = await s.받기(v);
  if (결과 === "대기") return;
  if (typeof 결과 === "string") { 말풍선("bot", 결과); return; }
  이동(s.다음);
}

function 예약시작() {
  예약 = {};
  이동("동의");
  input.focus();
}

function 그만두기() {
  예약 = null;
  지금단계 = null;
  진행표시();
  말풍선("bot", "예약을 멈췄어요. 궁금한 점을 물어보셔도 돼요.");
  기본선택지();
}

async function 접수() {
  const wait = 말풍선("bot pending", "예약을 접수하고 있어요…");
  입력잠금(true);
  try {
    const d = await 요청("/api/bookings", { method: "POST", body: JSON.stringify(예약) });
    wait.remove();
    접수증(d.booking);
    예약 = null;
    지금단계 = null;
    진행표시();
    선택지([
      { label: "새 예약", primary: true, run: 예약시작 },
      { label: "보조배터리 맡길 수 있나요?", run: () => 질문하기("보조배터리도 맡길 수 있나요?") },
    ]);
  } catch (e) {
    wait.remove();
    말풍선("bot", `접수하지 못했어요. ${e.message}`);
    확인선택지();
  }
  입력잠금(false);
}

function 접수증(b) {
  const box = document.createElement("div");
  box.className = "receipt";
  const 태그 = document.createElement("div");
  태그.className = "tag";
  태그.textContent = b.tag;
  const 복사 = document.createElement("button");
  복사.type = "button";
  복사.className = "copy";
  복사.textContent = "태그 번호 복사";
  복사.onclick = async () => {
    try { await navigator.clipboard.writeText(b.tag); 복사.textContent = "복사했어요"; } catch { 복사.textContent = "직접 적어 두세요"; }
  };
  box.append(태그, 복사, 요약표([
    ["수거", 보기시각(new Date(b.pickup))], ["수거 주소", b.address],
    ["항공편", `${b.flight} · ${보기시각(new Date(b.departure))}`], ["짐 · 요금", `${b.bags}개 · ${원(b.fee)} (시연용)`],
  ]));
  말풍선("bot", "접수되었어요. 태그 번호를 짐에 적어 두세요. 수거 차량 배차는 관리자가 확인한 뒤 확정합니다.", box);
}

// 입력창
$("#chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = input.value.trim();
  if (!v) return;
  input.value = "";
  말풍선("user", v);
  if (예약 && 지금단계) {
    // 예약 중이라도 위기 표현은 입력값으로 받지 않고 서버 안내로 넘긴다
    if (/죽고\s*싶|자살|자해|살기\s*싫|사라지고\s*싶|목숨|극단\s*적/.test(v)) {
      예약 = null;
      지금단계 = null;
      진행표시();
      선택지([]);
      return 질문하기(v);
    }
    if (/^(그만|취소|중단)/.test(v)) return 그만두기();
    return 받아서(v); // 버튼은 다음 단계로 넘어갈 때 바뀐다 — 잘못 입력해도 지금 단계 버튼은 남는다
  }
  if (/예약|맡기|맡길래|수거해/.test(v) && !/요금|얼마|취소|변경|기간|어떻게|방법|\?/.test(v)) return 예약시작();
  선택지([]);
  질문하기(v);
});

function 채팅으로() {
  if (location.hash === "#admin") location.hash = "#chat";
  $(".chat-card").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("#startBooking").onclick = () => { 채팅으로(); 말풍선("user", "예약 시작"); 예약시작(); };
$("#startBookingTop").onclick = $("#startBooking").onclick;
$("#resetChat").onclick = 대화새로;
document.querySelectorAll("[data-ask]").forEach((b) =>
  b.addEventListener("click", () => { 채팅으로(); 말풍선("user", b.dataset.ask); 질문하기(b.dataset.ask); })
);

// ───────── 관리자 예약표 ─────────
let 예약목록 = [];

function 관리자출입증() {
  try {
    const t = sessionStorage.getItem(출입증키);
    if (t && Number(t.split(".")[0]) > Date.now()) return t;
  } catch { /* 저장 불가 환경 */ }
  return null;
}
function 출입증저장(t) {
  try { t ? sessionStorage.setItem(출입증키, t) : sessionStorage.removeItem(출입증키); } catch { /* 무시 */ }
}

function 관리자상태(로그인) {
  $("#adminLogin").hidden = 로그인;
  $("#adminBoard").hidden = !로그인;
}

async function 관리자열기() {
  if (!관리자출입증()) return 관리자상태(false);
  관리자상태(true);
  await 목록불러오기();
}

async function 목록불러오기() {
  $("#adminMsg").textContent = "불러오는 중…";
  try {
    예약목록 = (await 요청("/api/bookings")).bookings;
    $("#adminMsg").textContent = `${kst(new Date(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} 기준`;
    관리자그리기();
  } catch (e) {
    if (e.status === 401) { 출입증저장(null); 관리자상태(false); $("#loginMsg").textContent = "로그인이 만료되었어요. 다시 로그인해 주세요."; return; }
    $("#adminMsg").textContent = e.message;
  }
}

async function 상태바꾸기(tags, status) {
  try {
    예약목록 = (await 요청("/api/bookings", { method: "PATCH", body: JSON.stringify({ tags, status }) })).bookings;
    관리자그리기();
  } catch (e) {
    $("#adminMsg").textContent = e.message;
  }
}

function 관리자그리기() {
  const sel = $("#dateFilter");
  const 날짜들 = [...new Set(예약목록.map((b) => kst날짜(new Date(b.pickup))))];
  const 고른날 = sel.value;
  sel.innerHTML = '<option value="">전체</option>' + 날짜들.map((d) => `<option>${esc(d)}</option>`).join("");
  sel.value = 날짜들.includes(고른날) ? 고른날 : "";
  const 찾기 = $("#adminSearch").value.trim();
  const 보기 = 예약목록.filter((b) =>
    (!sel.value || kst날짜(new Date(b.pickup)) === sel.value) &&
    (!찾기 || [b.tag, b.name, b.flight, b.region].some((x) => String(x).includes(찾기))));

  const 수 = (st) => 보기.filter((b) => b.status === st).length;
  $("#stats").innerHTML = [
    ["전체 예약", 보기.length, ""], ["수거 대기", 수("수거 대기"), "focus"],
    ["배차 확정", 수("배차 확정"), ""], ["수거 완료", 수("수거 완료"), ""],
  ].map(([k, v, c]) => `<div class="stat ${c}"><b>${Number(v)}</b><span>${k}</span></div>`).join("");

  const tbody = $("#rows");
  tbody.innerHTML = "";
  for (const b of 보기) {
    const tr = document.createElement("tr");
    const 칸 = [b.tag, 보기시각(new Date(b.pickup)), b.region, b.name, b.phone, `${b.flight} · ${b.terminal}`, Number(b.bags) + "개", 원(b.fee)];
    for (const v of 칸) { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); }
    const td = document.createElement("td");
    const s = document.createElement("select");
    s.className = "select status-" + 상태목록.indexOf(b.status);
    s.setAttribute("aria-label", b.tag + " 상태");
    for (const x of 상태목록) s.add(new Option(x, x, false, x === b.status));
    s.onchange = () => 상태바꾸기([b.tag], s.value);
    td.appendChild(s);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  $("#empty").hidden = 보기.length > 0;

  // 배차 후보 묶음: 날짜 + 2시간 시간대 + 지역 → 묶음째 배차 확정
  const 묶음 = new Map();
  for (const b of 보기.filter((x) => x.status === "수거 대기")) {
    const t = new Date(b.pickup);
    const h = kst시(t) - (kst시(t) % 2);
    const key = `${kst날짜(t)} ${String(h).padStart(2, "0")}:00~${String(h + 2).padStart(2, "0")}:00|${b.region}`;
    if (!묶음.has(key)) 묶음.set(key, []);
    묶음.get(key).push(b);
  }
  const 칸 = $("#groups");
  칸.innerHTML = 묶음.size ? "" : '<p class="empty">수거 대기 중인 예약이 없습니다.</p>';
  for (const [k, arr] of 묶음) {
    const [시간, 곳] = k.split("|");
    const 짐 = arr.reduce((s, b) => s + Number(b.bags), 0);
    const g = document.createElement("div");
    g.className = "group";
    g.innerHTML = `<b>${esc(곳)}</b><span>${esc(시간)} · ${arr.length}건 · 짐 ${짐}개</span><ul>${arr.map((b) => `<li>${esc(b.tag)} · ${esc(b.name)} (${Number(b.bags)}개)</li>`).join("")}</ul>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-primary btn-sm";
    btn.textContent = "이 묶음 배차 확정";
    btn.onclick = () => 상태바꾸기(arr.map((b) => b.tag), "배차 확정");
    g.appendChild(btn);
    칸.appendChild(g);
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 엑셀에서 열리는 CSV (수식 주입 막기: =,+,-,@ 로 시작하는 값 앞에 ' 를 붙인다)
function csv내보내기() {
  const 머리 = ["태그", "상태", "수거 시각", "지역", "주소", "예약자", "연락처", "항공편", "터미널", "출발", "짐", "요금"];
  const 셀 = (v) => { let s = String(v ?? ""); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const 줄 = 예약목록.map((b) => [b.tag, b.status, 보기시각(new Date(b.pickup)), b.region, b.address, b.name, b.phone, b.flight, b.terminal, 보기시각(new Date(b.departure)), b.bags, b.fee].map(셀).join(","));
  const blob = new Blob(["﻿" + [머리.map(셀).join(","), ...줄].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `홈드롭_예약_${kst날짜(new Date())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$("#adminLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("#adminPassword");
  $("#loginMsg").textContent = "확인 중…";
  try {
    const d = await 요청("/api/admin-login", { method: "POST", body: JSON.stringify({ password: pw.value }) });
    출입증저장(d.token);
    pw.value = "";
    $("#loginMsg").textContent = "";
    await 관리자열기();
  } catch (err) {
    $("#loginMsg").textContent = err.message;
  }
});
$("#logout").onclick = () => { 출입증저장(null); 예약목록 = []; 관리자상태(false); };
$("#refresh").onclick = 목록불러오기;
$("#exportCsv").onclick = csv내보내기;
$("#dateFilter").onchange = 관리자그리기;
$("#adminSearch").oninput = 관리자그리기;
$("#clearAll").onclick = async () => {
  if (!confirm("저장된 예약을 모두 지울까요? 되돌릴 수 없습니다.")) return;
  try { 예약목록 = (await 요청("/api/bookings", { method: "DELETE" })).bookings; 관리자그리기(); } catch (e) { $("#adminMsg").textContent = e.message; }
};
$("#seed").onclick = async () => {
  try { 예약목록 = (await 요청("/api/bookings", { method: "POST", body: JSON.stringify({ seed: true }) })).bookings; 관리자그리기(); } catch (e) { $("#adminMsg").textContent = e.message; }
};

// ───────── 화면 전환 ─────────
function 화면() {
  const admin = location.hash === "#admin";
  $("#view-chat").hidden = admin;
  $("#view-admin").hidden = !admin;
  document.querySelectorAll("[data-tab]").forEach((a) => a.setAttribute("aria-selected", String((a.dataset.tab === "admin") === admin)));
  if (admin) 관리자열기();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", 화면);

대화새로();
화면();
