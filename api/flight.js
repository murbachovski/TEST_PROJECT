// 항공편 찾기 — 인천국제공항공사 여객편 주간 운항 현황(출발), 오늘~6일 뒤.
// 키: INCHEON_FLY_INFO (공공데이터포털 OpenAPI KEY, Decoding 값). 화면으로 내려가지 않는다.
// 키가 없거나 호출이 실패하면 found:false 를 돌려주고, 화면은 형식 확인 + 직접 입력으로 넘어간다.
//
// 하루 500회 한도 보호: 받은 자료를 필요한 칸만 줄여 저장소(Redis)에 10분 동안 둔다.
// 함수 인스턴스가 여러 개여도 저장소를 함께 보므로, 10분에 한 번만 공공데이터를 부른다.
// 동시에 비어 있으면 「잠금」을 잡은 한 곳만 부르고 나머지는 잠깐 기다렸다가 저장소에서 읽는다.

const { 명령 } = require("./_store");

const URL_출발 = "https://apis.data.go.kr/B551177/StatusOfPassengerFlightsDSOdp/getPassengerDeparturesDSOdp";
const 캐시_초 = 600;
const 저장키 = "hd:flights:v1";
const 잠금키 = "hd:flights:lock";
const 터미널 = { P01: "제1터미널", P02: "탑승동(제1터미널)", P03: "제2터미널" };

let 메모리 = { 시각: 0, 목록: null }; // 같은 인스턴스 안에서는 저장소도 부르지 않는다
let 실패시각 = 0;

module.exports = async (req, res) => {
  const 편명 = String(req.query.flight || "").toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9]{2}\d{1,4}$/.test(편명)) {
    return res.status(400).json({ error: "항공편 번호 형식이 아닙니다. 예: KE703" });
  }

  const 목록 = await 운항목록();
  if (!목록) return res.json({ found: false, source: "none", flights: [] });

  // 줄인 한 줄: [편명, 예정시각, 변경시각, 터미널코드, 도착지, 항공사, 공동운항, 실제편명, 현황]
  const 찾음 = 목록
    .filter((f) => f[0] === 편명)
    .map(([flightId, sched, est, term, airport, airline, codeshare, master, remark]) => ({
      flightId,
      masterFlightId: codeshare === "Slave" ? master || null : null,
      airline,
      destination: airport,
      // 자료의 시각은 한국 시간(KST)이다. 서버(UTC)에서 헷갈리지 않게 +09:00 을 붙여 넘긴다
      departure: kst(sched),
      estimated: kst(est),
      terminal: 터미널[term] || term || "확인 필요",
      remark: remark || "예정",
    }));

  res.setHeader("Cache-Control", "s-maxage=300");
  return res.json({ found: 찾음.length > 0, source: "data.go.kr", flights: 찾음 });
};

async function 저장소(args) {
  try {
    return await 명령(args);
  } catch {
    return null; // 저장소가 없거나 오류면 이 인스턴스 메모리만으로 버틴다
  }
}

let 받는중 = null;

// 같은 인스턴스로 동시에 들어온 요청은 진행 중인 하나를 함께 기다린다
function 운항목록() {
  if (메모리.목록 && Date.now() - 메모리.시각 < 캐시_초 * 1000) return Promise.resolve(메모리.목록);
  if (!받는중) 받는중 = 운항목록_받기().finally(() => (받는중 = null));
  return 받는중;
}

async function 운항목록_받기() {

  const 저장된 = await 저장소(["GET", 저장키]);
  if (저장된) return 기억(JSON.parse(저장된));

  // 실패 직후 2분은 다시 부르지 않고 예전 자료라도 쓴다
  if (Date.now() - 실패시각 < 2 * 60 * 1000) return 메모리.목록;

  // 한 곳만 공공데이터를 부르게 잠금(60초)을 잡는다. 저장소가 없으면("OK" 를 못 받으면) 그냥 부른다
  const 잠금 = await 저장소(["SET", 잠금키, "1", "NX", "EX", 60]);
  if (잠금 !== "OK") {
    // 다른 곳이 받는 중이거나 저장소 오류 — 잠깐 기다렸다가 저장소에서 읽어 보고, 없으면 직접 부른다
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const 다시 = await 저장소(["GET", 저장키]);
      if (다시) return 기억(JSON.parse(다시));
    }
  }

  const 목록 = await 불러오기();
  if (!목록) {
    실패시각 = Date.now();
    return 메모리.목록;
  }
  await 저장소(["SET", 저장키, JSON.stringify(목록), "EX", 캐시_초]);
  await 저장소(["INCR", `hd:flights:calls:${new Date().toISOString().slice(0, 10)}`]); // 하루 호출 수 (점검용)
  return 기억(목록);
}

function 기억(목록) {
  메모리 = { 시각: Date.now(), 목록 };
  return 목록;
}

async function 불러오기() {
  const key = String(process.env.INCHEON_FLY_INFO || "").trim();
  if (!key) return null;
  try {
    const u = new URL(URL_출발);
    u.searchParams.set("serviceKey", key);
    u.searchParams.set("type", "json");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(u, { signal: ctl.signal }).finally(() => clearTimeout(t));
    const data = await r.json();
    if (data?.response?.header?.resultCode !== "00") return null;
    return (data.response.body.items || []).map((f) => [
      f.flightId, f.scheduleDateTime, f.estimatedDateTime, f.terminalid, f.airport, f.airline, f.codeshare, f.masterflightid, f.remark,
    ]);
  } catch {
    return null;
  }
}

function kst(s) {
  if (!/^\d{12}$/.test(s || "")) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:00+09:00`;
}
