// 답변참고문서 읽기 + 질문과 가까운 대목 찾기.
// docs/답변참고문서 의 .md · .txt 만 근거로 쓴다 (docs/기획서 는 쓰지 않는다).

const fs = require("fs");
const path = require("path");

let 캐시 = null;

// 한글 폴더 이름은 운영체제에 따라 글자 조합 방식(NFC/NFD)이 달라 직접 이름으로 찾는다
function 문서폴더() {
  const docs = path.join(process.cwd(), "docs");
  const 이름 = fs.readdirSync(docs).find((n) => n.normalize("NFC") === "답변참고문서");
  if (!이름) throw new Error("docs/답변참고문서 폴더가 없습니다");
  return path.join(docs, 이름);
}

// 문서를 「## 제목」 단위 대목으로 나눈다
function 대목목록() {
  if (캐시) return 캐시;
  const 폴더 = 문서폴더();
  const 대목 = [];
  for (const 파일 of fs.readdirSync(폴더).sort()) {
    if (!/\.(md|txt)$/i.test(파일)) continue;
    const 이름 = 파일.normalize("NFC");
    const 본문 = fs.readFileSync(path.join(폴더, 파일), "utf8");
    const 제목줄 = (본문.match(/^# (.+)$/m) || [, 이름])[1];
    for (const 조각 of 본문.split(/\n(?=## )/)) {
      const 소제목 = (조각.match(/^## (.+)$/m) || [, "개요"])[1];
      대목.push({ 파일: 이름, 문서: 제목줄, 소제목, 내용: 조각.trim() });
    }
  }
  캐시 = 대목;
  return 대목;
}

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

const 흔한말 = new Set(["알려", "려줘", "해줘", "주세", "세요", "어떻", "떻게", "있나", "나요", "는지", "되나", "인가", "뭐야", "무엇", "얼마"]);

function 찾기(질문, 개수 = 4) {
  const 질문조각 = [...조각내기(질문)].filter((t) => !흔한말.has(t));
  if (!질문조각.length) return [];
  return 대목목록()
    .map((d) => {
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

module.exports = { 찾기, 대목목록 };
