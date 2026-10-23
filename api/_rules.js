// 예약 규칙 (시연용 운영규칙 문서와 같은 값). 화면(app.js)도 같은 규칙으로 후보를 보여 주지만,
// 화면 값은 믿지 않고 서버가 여기서 다시 검사한다.

const 지역 = ["서울", "인천", "경기"];
const 수거시각 = [8, 10, 12, 14, 16, 18, 20];
const 상태목록 = ["수거 대기", "배차 확정", "수거 완료", "취소"];

const 요금 = (짐) => 30000 + 25000 * (짐 - 1);

const kst날짜 = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
const kst시분 = (d) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const 오늘부터 = (일) => new Date(new Date(kst날짜(new Date()) + "T00:00:00+09:00").getTime() + 일 * 86400000);

const 글 = (v, 최대) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 최대);

// 입력을 검사해 저장할 예약으로 만든다. 문제가 있으면 { 오류 }
function 예약검사(b) {
  const name = 글(b.name, 20);
  if (name.length < 2) return { 오류: "성함은 2~20자로 적어 주세요." };

  const 숫자 = String(b.phone || "").replace(/\D/g, "");
  if (!/^01[016789]\d{7,8}$/.test(숫자)) return { 오류: "휴대전화 번호 형식이 아닙니다." };
  const phone = 숫자.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");

  const address = 글(b.address, 100);
  const 시 = 지역.find((g) => address.startsWith(g));
  if (!시 || address.length < 6) return { 오류: "수거 주소는 서울·인천·경기로 시작해야 합니다." };
  const 구 = address.split(/\s+/)[1] || "";
  const region = 시 + (구 ? " " + 구 : "");

  const flight = 글(b.flight, 6).toUpperCase();
  if (!/^[A-Z0-9]{2}\d{1,4}$/.test(flight)) return { 오류: "항공편 번호 형식이 아닙니다." };

  const 출발 = new Date(b.departure);
  if (isNaN(출발) || 출발 < new Date() || 출발 >= 오늘부터(7)) return { 오류: "오늘부터 6일 뒤까지 출발편만 예약할 수 있습니다." };

  const bags = Number(b.bags);
  if (!Number.isInteger(bags) || bags < 1 || bags > 5) return { 오류: "짐은 1~5개까지 받습니다." };

  const 수거 = new Date(b.pickup);
  const 전 = (출발 - 수거) / 3600000;
  const [시각, 분] = isNaN(수거) ? [-1, -1] : kst시분(수거).split(":").map(Number);
  if (isNaN(수거) || 분 !== 0 || !수거시각.includes(시각) || 전 < 6 || 전 > 30 || 수거 - Date.now() < 2 * 3600000) {
    return { 오류: "수거 시각이 규칙(08~20시 짝수 정각, 출발 6~30시간 전, 지금부터 2시간 이후)에 맞지 않습니다." };
  }

  return {
    예약: {
      name, phone, address, region, flight,
      airline: 글(b.airline, 30), destination: 글(b.destination, 30), terminal: 글(b.terminal, 20) || "확인 필요",
      departure: 출발.toISOString(), pickup: 수거.toISOString(), bags, fee: 요금(bags),
    },
  };
}

module.exports = { 예약검사, 상태목록, 요금, kst날짜, 오늘부터 };
