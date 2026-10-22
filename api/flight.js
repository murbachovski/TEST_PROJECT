// 항공편 찾기 — 인천국제공항공사 여객편 주간 운항 현황(출발), 오늘~6일 뒤.
// 키: INCHEON_FLY_INFO (공공데이터포털 OpenAPI KEY, Decoding 값). 화면으로 내려가지 않는다.
// 키가 없거나 호출이 실패하면 found:false 를 돌려주고, 화면은 형식 확인 + 직접 입력으로 넘어간다.

const URL_출발 = "https://apis.data.go.kr/B551177/StatusOfPassengerFlightsDSOdp/getPassengerDeparturesDSOdp";
const 캐시_분 = 10; // 하루 500회 한도를 아끼려고 한 번 받은 자료를 10분간 다시 쓴다
const 터미널 = { P01: "제1터미널", P02: "탑승동(제1터미널)", P03: "제2터미널" };

let 캐시 = { 시각: 0, 목록: null };

module.exports = async (req, res) => {
  const 편명 = String(req.query.flight || "").toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9]{2}\d{1,4}$/.test(편명)) {
    return res.status(400).json({ error: "항공편 번호 형식이 아닙니다. 예: KE703" });
  }

  const 목록 = await 운항목록();
  if (!목록) return res.json({ found: false, source: "none", flights: [] });

  const 찾음 = 목록
    .filter((f) => f.flightId === 편명)
    .map((f) => ({
      flightId: f.flightId,
      masterFlightId: f.codeshare === "Slave" ? f.masterflightid || null : null,
      airline: f.airline,
      destination: f.airport,
      // 자료의 시각은 한국 시간(KST)이다. 서버(UTC)에서 헷갈리지 않게 +09:00 을 붙여 넘긴다
      departure: kst(f.scheduleDateTime),
      estimated: kst(f.estimatedDateTime),
      terminal: 터미널[f.terminalid] || f.terminalid || "확인 필요",
      remark: f.remark || "예정",
    }));

  res.setHeader("Cache-Control", "s-maxage=300");
  return res.json({ found: 찾음.length > 0, source: "data.go.kr", flights: 찾음 });
};

async function 운항목록() {
  if (캐시.목록 && Date.now() - 캐시.시각 < 캐시_분 * 60 * 1000) return 캐시.목록;
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
    const 목록 = data.response.body.items || [];
    캐시 = { 시각: Date.now(), 목록 };
    return 목록;
  } catch {
    return null;
  }
}

function kst(s) {
  if (!/^\d{12}$/.test(s || "")) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:00+09:00`;
}
