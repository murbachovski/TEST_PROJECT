// 홈드롭 예약 챗봇 화면.
// - 자유 질문 → /api/chat (답변참고문서 근거 답변)
// - 예약 → 정해진 순서로 하나씩 묻는다 (AI 키가 없어도 동작)
// - 접수된 예약 → 관리자 예약표 (시연용: 이 브라우저 localStorage 에만 저장)

const 저장키 = "homedrop.bookings.v1";
const 지역 = ["서울", "인천", "경기"];
const 상태목록 = ["수거 대기", "배차 확정", "수거 완료", "취소"];

const $ = (s) => document.querySelector(s);
const log = $("#chatLog");
const chips = $("#chips");
const input = $("#chatInput");

// ───────── 공통 ─────────
const 원 = (n) => n.toLocaleString("ko-KR") + "원";
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

function 불러오기() {
  try { return JSON.parse(localStorage.getItem(저장키)) || []; } catch { return []; }
}
function 저장(list) {
  try { localStorage.setItem(저장키, JSON.stringify(list)); } catch { /* 저장 불가 환경 */ }
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
function 근거표시(files) {
  if (!files || !files.length) return null;
  const s = document.createElement("span");
  s.className = "src";
  s.append("근거 문서");
  for (const f of files) {
    const c = document.createElement("span");
    c.textContent = f;
    s.appendChild(c);
  }
  return s;
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
const 대화 = [];
async function 질문하기(q) {
  const wait = 말풍선("bot pending", "문서를 찾고 있어요…");
  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, history: 대화.slice(-6) }),
    });
    const d = await r.json();
    wait.remove();
    const 답 = d.answer || d.error || "답을 만들지 못했어요.";
    말풍선("bot", 답, 근거표시(d.sources));
    대화.push({ role: "user", content: q }, { role: "assistant", content: 답 });
  } catch {
    wait.remove();
    말풍선("bot", "서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
  }
  기본선택지();
}

function 기본선택지() {
  선택지([
    { label: "예약 시작", primary: true, run: 예약시작 },
    { label: "요금이 얼마예요?", run: () => 질문하기("요금이 얼마예요?") },
    { label: "보조배터리도 맡길 수 있나요?", run: () => 질문하기("보조배터리도 맡길 수 있나요?") },
    { label: "이지드랍과 뭐가 달라요?", run: () => 질문하기("이지드랍은 어떤 서비스이고 홈드롭과 뭐가 달라요?") },
  ]);
}

// ───────── 예약 (하나씩 묻기) ─────────
let 예약 = null; // 진행 중인 예약. null 이면 자유 질문 모드

const 단계 = {
  이름: {
    묻기: "예약을 시작할게요. 예약자 성함을 알려 주세요. (시연용이니 가명으로 적어 주세요)",
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
      const 구 = v.split(/\s+/)[1] || "";
      예약.region = 시 + (구 ? " " + 구 : "");
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
      let d = null;
      try { d = await (await fetch("/api/flight?flight=" + encodeURIComponent(편))).json(); } catch { /* 형식 확인으로 */ }
      찾는중.remove();
      const 범위 = (f) => { const t = new Date(f.departure); return t >= new Date() && t < 오늘부터(7); };
      const 후보 = (d && d.flights ? d.flights : []).filter(범위);
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
      const m = v.match(/(\d{4})[-./]\s?(\d{1,2})[-./]\s?(\d{1,2})\D+(\d{1,2}):(\d{2})/);
      if (!m) return "「2026-10-25 14:30」처럼 날짜와 시각을 함께 적어 주세요.";
      const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T${m[4].padStart(2, "0")}:${m[5]}:00+09:00`;
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
    칩: () => [1, 2, 3, 4, 5].map((n) => ({ label: n + "개", run: () => 받아서(String(n)) })),
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
      // 시연용 규칙: 08~20시 짝수 정각, 출발 6~30시간 전, 지금부터 2시간 이후, 출발에 가까운 3개
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
        기본선택지();
        return "죄송해요. 이 항공편은 시연용 수거 규칙(08~20시, 출발 6~30시간 전, 지금부터 2시간 이후)에 맞는 수거 시각이 없어요. 공항 카운터나 이지드랍 이용을 검토해 주세요.";
      }
      선택지(후보.map((t) => ({ label: 보기시각(t) + " 수거", run: () => { 예약.pickup = t.toISOString(); 이동("확인"); } })));
      return `출발 시각 ${보기시각(출발)} 기준으로 가능한 수거 시각이에요. 하나를 골라 주세요.`;
    },
    받기: () => "아래 버튼에서 수거 시각을 골라 주세요.",
  },
  확인: {
    묻기() {
      const dl = document.createElement("dl");
      dl.className = "summary";
      const 줄 = [
        ["예약자", 예약.name], ["연락처", 예약.phone], ["수거 주소", 예약.address],
        ["항공편", `${예약.flight}${예약.airline ? " (" + 예약.airline + ")" : ""}`],
        ["출발", `${보기시각(new Date(예약.departure))} · ${예약.terminal}`],
        ["수거", 보기시각(new Date(예약.pickup))], ["짐", 예약.bags + "개"], ["요금(시연용)", 원(예약.fee)],
      ];
      for (const [k, v] of 줄) {
        const dt = document.createElement("dt"); dt.textContent = k;
        const dd = document.createElement("dd"); dd.textContent = v;
        dl.append(dt, dd);
      }
      말풍선("bot", "아래 내용으로 접수할까요? 보조배터리·전자담배·라이터는 짐에서 꺼내 주세요.", dl);
      선택지([
        { label: "이대로 접수", primary: true, run: 접수 },
        { label: "처음부터 다시", run: 예약시작 },
        { label: "그만두기", run: 그만두기 },
      ]);
      return "대기";
    },
    받기: () => "아래 버튼으로 접수 여부를 골라 주세요.",
  },
};

let 지금단계 = null;

function 이동(이름) {
  지금단계 = 이름;
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
  예약 = { id: Date.now().toString(36) };
  이동("이름");
  input.focus();
}

function 그만두기() {
  예약 = null;
  지금단계 = null;
  말풍선("bot", "예약을 멈췄어요. 궁금한 점을 물어보셔도 돼요.");
  기본선택지();
}

function 접수() {
  const list = 불러오기();
  const 날 = kst날짜(new Date()).slice(2).replace(/-/g, "");
  const 같은날 = list.filter((b) => b.tag.startsWith("HD-" + 날)).length;
  const tag = `HD-${날}-${String(같은날 + 1).padStart(4, "0")}`;
  list.push({ ...예약, tag, status: "수거 대기", createdAt: new Date().toISOString() });
  저장(list);
  const t = document.createElement("div");
  t.className = "tag";
  t.textContent = tag;
  말풍선("bot", "접수되었어요. 태그 번호를 짐에 적어 두세요. 배차는 관리자가 확인 후 확정합니다.", t);
  예약 = null;
  지금단계 = null;
  선택지([
    { label: "관리자 예약표 보기", primary: true, run: () => (location.hash = "#admin") },
    { label: "새 예약", run: 예약시작 },
  ]);
}

// 입력창
$("#chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = input.value.trim();
  if (!v) return;
  input.value = "";
  말풍선("user", v);
  if (예약 && 지금단계) {
    if (/^(그만|취소|중단)/.test(v)) return 그만두기();
    선택지([]);
    return 받아서(v);
  }
  if (/예약|맡기|맡길래|수거해/.test(v) && !/요금|얼마|취소|변경|기간/.test(v)) return 예약시작();
  선택지([]);
  질문하기(v);
});

$("#startBooking").onclick = () => { location.hash = "#chat"; 말풍선("user", "예약 시작"); 예약시작(); };
$("#startBookingTop").onclick = $("#startBooking").onclick;
document.querySelectorAll("[data-ask]").forEach((b) =>
  b.addEventListener("click", () => { 말풍선("user", b.dataset.ask); 질문하기(b.dataset.ask); log.scrollIntoView({ behavior: "smooth", block: "center" }); })
);

// ───────── 관리자 예약표 ─────────
function 관리자그리기() {
  const list = 불러오기().sort((a, b) => a.pickup.localeCompare(b.pickup));
  const sel = $("#dateFilter");
  const 날짜들 = [...new Set(list.map((b) => kst날짜(new Date(b.pickup))))];
  const 고른날 = sel.value;
  sel.innerHTML = '<option value="">전체</option>' + 날짜들.map((d) => `<option>${d}</option>`).join("");
  sel.value = 날짜들.includes(고른날) ? 고른날 : "";
  const 보기 = list.filter((b) => !sel.value || kst날짜(new Date(b.pickup)) === sel.value);

  const 수 = (st) => 보기.filter((b) => b.status === st).length;
  $("#stats").innerHTML = [
    ["전체 예약", 보기.length, ""], ["수거 대기", 수("수거 대기"), "focus"],
    ["배차 확정", 수("배차 확정"), ""], ["수거 완료", 수("수거 완료"), ""],
  ].map(([k, v, c]) => `<div class="stat ${c}"><b>${v}</b><span>${k}</span></div>`).join("");

  const tbody = $("#rows");
  tbody.innerHTML = "";
  for (const b of 보기) {
    const tr = document.createElement("tr");
    const 칸 = [b.tag, 보기시각(new Date(b.pickup)), b.region, b.name, `${b.flight} · ${b.terminal}`, b.bags + "개", 원(b.fee)];
    for (const v of 칸) { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); }
    const td = document.createElement("td");
    const s = document.createElement("select");
    s.className = "select";
    s.setAttribute("aria-label", b.tag + " 상태");
    s.innerHTML = 상태목록.map((x) => `<option${x === b.status ? " selected" : ""}>${x}</option>`).join("");
    s.onchange = () => {
      const all = 불러오기();
      const t = all.find((x) => x.tag === b.tag);
      if (t) t.status = s.value;
      저장(all);
      관리자그리기();
    };
    td.appendChild(s);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  $("#empty").hidden = 보기.length > 0;

  // 배차 후보 묶음: 날짜 + 2시간 시간대 + 지역
  const 묶음 = new Map();
  for (const b of 보기.filter((x) => x.status === "수거 대기")) {
    const t = new Date(b.pickup);
    const h = kst시(t) - (kst시(t) % 2);
    const key = `${kst날짜(t)} ${String(h).padStart(2, "0")}:00~${String(h + 2).padStart(2, "0")}:00|${b.region}`;
    if (!묶음.has(key)) 묶음.set(key, []);
    묶음.get(key).push(b);
  }
  $("#groups").innerHTML = 묶음.size
    ? [...묶음].map(([k, arr]) => {
        const [시간, 곳] = k.split("|");
        const 짐 = arr.reduce((s, b) => s + b.bags, 0);
        return `<div class="group"><b>${esc(곳)}</b><span>${esc(시간)} · ${arr.length}건 · 짐 ${짐}개</span><ul>${arr.map((b) => `<li>${esc(b.tag)} (${b.bags}개)</li>`).join("")}</ul></div>`;
      }).join("")
    : '<p class="empty">수거 대기 중인 예약이 없습니다.</p>';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("#dateFilter").onchange = 관리자그리기;
$("#clearAll").onclick = () => { if (confirm("이 브라우저에 저장된 시연 예약을 모두 지울까요?")) { 저장([]); 관리자그리기(); } };
$("#seed").onclick = () => {
  // 합성 데이터 — 실제 사람 정보가 아니다
  const 예시 = [
    ["김하늘", "서울 성북구 삼선교로 16길", "서울 성북구", 2, 1, 9],
    ["이도윤", "서울 성북구 보문로 34", "서울 성북구", 3, 1, 9],
    ["박서연", "서울 강남구 테헤란로 152", "서울 강남구", 1, 1, 14],
    ["최지우", "인천 연수구 송도과학로 32", "인천 연수구", 2, 2, 8],
    ["정민준", "경기 고양시 일산동구 중앙로 1275", "경기 고양시", 4, 3, 11],
  ];
  const list = 불러오기();
  const 날 = kst날짜(new Date()).slice(2).replace(/-/g, "");
  예시.forEach(([name, address, region, bags, 일, 시], i) => {
    const pickup = new Date(kst날짜(오늘부터(일)) + `T${String(시).padStart(2, "0")}:00:00+09:00`);
    list.push({
      id: "seed" + i + Date.now(), tag: `HD-${날}-S${String(list.length + 1).padStart(3, "0")}`,
      name, phone: "010-0000-000" + i, address, region, flight: ["KE703", "OZ102", "7C1101", "LJ203", "ZE605"][i],
      departure: new Date(pickup.getTime() + 10 * 3600000).toISOString(), terminal: i % 2 ? "제1터미널" : "제2터미널",
      bags, fee: 요금(bags), pickup: pickup.toISOString(), status: "수거 대기", createdAt: new Date().toISOString(),
    });
  });
  저장(list);
  관리자그리기();
};

// ───────── 화면 전환 ─────────
function 화면() {
  const admin = location.hash === "#admin";
  $("#view-chat").hidden = admin;
  $("#view-admin").hidden = !admin;
  document.querySelectorAll("[data-tab]").forEach((a) => a.setAttribute("aria-selected", String((a.dataset.tab === "admin") === admin)));
  if (admin) 관리자그리기();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", 화면);
window.addEventListener("storage", () => location.hash === "#admin" && 관리자그리기());

말풍선("bot", "안녕하세요, 홈드롭 예약 챗봇이에요. 집 앞에서 짐을 수거해 인천공항까지 옮겨 드리는 서비스(수업 시연용)예요.\n예약하시려면 「예약 시작」, 궁금한 점은 편하게 물어보세요.");
기본선택지();
화면();
