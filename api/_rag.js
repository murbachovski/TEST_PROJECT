// 임베딩 기반 검색 (RAG 의 R).
// 1) 문서 조각 전체를 Gemini 임베딩으로 바꿔 메모리에 둔다 (함수가 처음 깨어날 때 한 번, 문서가 바뀌면 다시)
// 2) 질문도 임베딩으로 바꿔, 뜻이 가장 가까운 조각을 코사인 유사도로 고른다
// 키: GEMINI_API_KEYS (쉼표로 여러 개, 막히면 다음 키). 실패하면 null → chat.js 가 키워드 검색으로 대신한다.

const { 문서읽기, 임베딩글 } = require("./_docs");

const 모델 = () => process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
const 차원 = 768;
const 묶음크기 = 50;
const 제한초 = 15;

let 색인 = null; // { 해시, 벡터: Float32Array[] }
let 만드는중 = null;

function 키목록() {
  return ["GEMINI_API_KEYS", "GEMINI_API_KEY"]
    .flatMap((n) => String(process.env[n] || "").split(","))
    .map((k) => k.trim())
    .filter(Boolean);
}

function 정규화(v) {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return Float32Array.from(v, (x) => x / n);
}

async function 임베딩(글들, taskType) {
  const m = 모델();
  const body = JSON.stringify({
    requests: 글들.map((text) => ({
      model: `models/${m}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: 차원,
    })),
  });
  for (const key of 키목록()) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 제한초 * 1000);
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:batchEmbedContents`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body,
        signal: ctl.signal,
      });
      if (!r.ok) {
        console.error("임베딩 실패", m, r.status); // 키 값은 남기지 않는다
        continue;
      }
      const data = await r.json();
      const 결과 = (data.embeddings || []).map((e) => 정규화(e.values || []));
      if (결과.length === 글들.length) return 결과;
    } catch (e) {
      console.error("임베딩 오류", e.name);
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

async function 색인얻기() {
  const { 조각, 해시 } = 문서읽기();
  if (색인 && 색인.해시 === 해시) return 색인;
  if (!만드는중) {
    만드는중 = (async () => {
      const 벡터 = [];
      for (let i = 0; i < 조각.length; i += 묶음크기) {
        const 부분 = await 임베딩(조각.slice(i, i + 묶음크기).map(임베딩글), "RETRIEVAL_DOCUMENT");
        if (!부분) return null;
        벡터.push(...부분);
      }
      return { 해시, 벡터 };
    })().finally(() => (만드는중 = null));
  }
  const 새색인 = await 만드는중;
  if (새색인) 색인 = 새색인;
  return 새색인;
}

// 질문과 뜻이 가까운 조각 상위 k개. 실패하면 null
async function 임베딩찾기(질문, k = 6) {
  if (!키목록().length) return null;
  const [idx, q] = await Promise.all([색인얻기(), 임베딩([질문], "RETRIEVAL_QUERY")]);
  if (!idx || !q) return null;
  const { 조각 } = 문서읽기();
  const qv = q[0];
  return 조각
    .map((c, i) => {
      const v = idx.벡터[i];
      let s = 0;
      for (let j = 0; j < v.length; j++) s += v[j] * qv[j];
      return { ...c, 점수: s };
    })
    .sort((a, b) => b.점수 - a.점수)
    .slice(0, k);
}

module.exports = { 임베딩찾기 };
