// 답변참고문서 읽기 → 검색 단위(조각)로 나누기 + 키워드 검색(임베딩이 안 될 때 대신 쓴다).
// docs/답변참고문서 의 .md · .txt 만 근거로 쓴다 (docs/기획서 는 쓰지 않는다).
//
// 문서 머리의 출처 줄 형식:
//   > 출처: [기관 「페이지 제목」](https://...)   ← 화면에 링크로 보인다
//   > 출처: 시연용 가정 (1팀 운영규칙)            ← 링크 없는 출처(시연용 문서)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const 조각_최대글자 = 800;
let 캐시 = null;

// 한글 폴더 이름은 운영체제에 따라 글자 조합 방식(NFC/NFD)이 달라 직접 이름으로 찾는다
function 문서폴더() {
  const docs = path.join(process.cwd(), "docs");
  const 이름 = fs.readdirSync(docs).find((n) => n.normalize("NFC") === "답변참고문서");
  if (!이름) throw new Error("docs/답변참고문서 폴더가 없습니다");
  return path.join(docs, 이름);
}

function 출처읽기(본문) {
  const 출처 = [];
  for (const 줄 of 본문.split("\n")) {
    const m = 줄.match(/^>\s*출처:\s*(.+)$/);
    if (!m) continue;
    const 링크 = m[1].match(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/);
    출처.push(링크 ? { label: 링크[1].trim(), url: 링크[2] } : { label: m[1].trim(), url: null });
  }
  return 출처;
}

// 긴 절은 문단 단위로 잘라 조각 하나가 너무 길지 않게 한다
function 자르기(글) {
  if (글.length <= 조각_최대글자) return [글];
  const 결과 = [];
  let 지금 = "";
  for (const 문단 of 글.split(/\n(?=\S)/)) {
    if (지금 && (지금 + "\n" + 문단).length > 조각_최대글자) {
      결과.push(지금);
      지금 = 문단;
    } else 지금 = 지금 ? 지금 + "\n" + 문단 : 문단;
  }
  if (지금) 결과.push(지금);
  return 결과;
}

function 문서읽기() {
  if (캐시) return 캐시;
  const 폴더 = 문서폴더();
  const 조각 = [];
  const 해시 = crypto.createHash("sha1");
  for (const 파일 of fs.readdirSync(폴더).sort()) {
    if (!/\.(md|txt)$/i.test(파일)) continue;
    const 이름 = 파일.normalize("NFC");
    const 본문 = fs.readFileSync(path.join(폴더, 파일), "utf8");
    해시.update(이름 + 본문);
    const 문서 = (본문.match(/^# (.+)$/m) || [, 이름])[1].trim();
    const 출처 = 출처읽기(본문);
    const 시연용 = 출처.length > 0 && 출처.every((s) => !s.url);
    for (const 절 of 본문.split(/\n(?=## )/)) {
      if (!/^## /.test(절)) continue; // 머리말(제목·출처 줄)은 검색 단위가 아니다
      const 소제목 = 절.match(/^## (.+)$/m)[1].trim();
      const 내용 = 절.replace(/^## .+\n?/, "").trim();
      for (const 부분 of 자르기(내용)) {
        조각.push({ id: 조각.length, 파일: 이름, 문서, 소제목, 내용: 부분, 출처, 시연용 });
      }
    }
  }
  캐시 = { 조각, 해시: 해시.digest("hex").slice(0, 12) };
  return 캐시;
}

// 임베딩에 넣을 글: 문서 제목 + 소제목 + 본문
const 임베딩글 = (c) => `${c.문서} - ${c.소제목}\n${c.내용}`;

// ── 키워드 검색 (임베딩이 실패했을 때만 쓴다) ──
// 한국어는 띄어쓰기가 들쭉날쭉해서 두 글자씩 끊어 겹치는 정도로 점수를 매긴다
function 조각내기(글) {
  const 깨끗 = 글.toLowerCase().replace(/[^0-9a-z가-힣]+/g, " ");
  const 모음 = new Set();
  for (const 낱말 of 깨끗.split(" ")) {
    if (낱말.length === 1) continue;
    for (let i = 0; i < 낱말.length - 1; i++) 모음.add(낱말.slice(i, i + 2));
  }
  return 모음;
}

const 흔한말 = new Set(["알려", "려줘", "해줘", "주세", "세요", "어떻", "떻게", "있나", "나요", "는지", "되나", "인가", "뭐야", "무엇", "얼마", "해요", "돼요"]);

function 키워드찾기(질문, 개수 = 4) {
  const 질문조각 = [...조각내기(질문)].filter((t) => !흔한말.has(t));
  if (!질문조각.length) return [];
  return 문서읽기()
    .조각.map((d) => {
      const 제목조각 = 조각내기(d.소제목 + " " + d.문서);
      const 본문조각 = 조각내기(d.내용);
      let 점수 = 0;
      for (const t of 질문조각) {
        if (제목조각.has(t)) 점수 += 2;
        else if (본문조각.has(t)) 점수 += 1;
      }
      return { ...d, 점수: 점수 / 질문조각.length };
    })
    .filter((d) => d.점수 >= 0.25)
    .sort((a, b) => b.점수 - a.점수)
    .slice(0, 개수);
}

// 문서에 출처가 여럿이면, 이 절의 내용과 이름이 가장 잘 맞는 출처 하나를 고른다
// (예: 교통 문서의 「리무진버스」 절에는 공항철도가 아니라 공항버스 안내 페이지)
function 알맞은출처(c) {
  if (c.출처.length <= 1) return c.출처;
  const 제목 = 조각내기(c.소제목);
  const 본문 = 조각내기(c.내용);
  const 기관 = /^(인천국제공항공사|인천국제공항|국가법령정보센터)\s*/;
  const 점수 = (s) => {
    const 낱 = [...조각내기(s.label.replace(기관, ""))];
    if (!낱.length) return 0;
    return 낱.reduce((합, t) => 합 + (제목.has(t) ? 2 : 본문.has(t) ? 1 : 0), 0) / 낱.length;
  };
  const 순위 = c.출처.map((s) => ({ s, 점: 점수(s) })).sort((a, b) => b.점 - a.점);
  const 고름 = 순위.filter((x, i) => i === 0 || (i === 1 && x.점 > 0 && x.점 >= 순위[0].점 * 0.8));
  return 고름.map((x) => x.s);
}

module.exports = { 문서읽기, 키워드찾기, 임베딩글, 알맞은출처 };
