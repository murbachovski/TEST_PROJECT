// 임베딩 기반 검색 (RAG 의 R).
// 1) 문서 조각마다 Gemini 임베딩을 한 번만 계산해 저장소(Redis)에 둔다. 키는 「조각 내용의 해시」라서
//    문서를 고치면 바뀐 조각만 다시 계산한다. 함수가 새로 깨어나도 저장소에서 읽기만 한다.
// 2) 질문도 임베딩으로 바꿔(같은 질문은 하루 동안 저장해 둔 값을 쓴다) 코사인 유사도로 가까운 조각을 고른다.
// 키: GEMINI_API_KEYS (쉼표로 여러 개, 막히면 다음 키). 한도 초과(429) 등으로 실패하면 5분 동안 쉬고,
//     그동안 chat.js 는 키워드 검색으로 대신한다 — 실패한 뒤 질문마다 다시 시도해 한도를 태우지 않게.

const crypto = require("crypto");
const { 문서읽기, 임베딩글 } = require("./_docs");
const { 명령 } = require("./_store");

// 한도는 모델마다 따로라, 앞 모델이 막히면 다음 모델로 색인을 만든다. 질문은 색인과 같은 모델로만 바꾼다
const 모델목록 = () => (process.env.GEMINI_EMBED_MODEL ? [process.env.GEMINI_EMBED_MODEL] : ["gemini-embedding-2", "gemini-embedding-001"]);
const 차원 = 768;
const 묶음크기 = 50;
const 제한초 = 15;
const 쉬는시간 = 5 * 60 * 1000;

let 색인 = null; // { 해시, 벡터: Float32Array[] }
let 만드는중 = null;
let 쉬는까지 = 0;

const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 20);
const 조각키 = (m, c) => `hd:emb:${m}:${차원}:${sha(임베딩글(c))}`;
const 질문키 = (m, q) => `hd:qemb:${m}:${차원}:${sha(q)}`;
const 담기 = (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
const 꺼내기 = (s) => {
  const b = Buffer.from(s, "base64");
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

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

// 저장소가 없거나 오류여도 검색은 계속되게 (캐시는 있으면 좋은 것)
async function 저장소(args) {
  try {
    return await 명령(args);
  } catch {
    return null;
  }
}

// gemini-embedding-2 는 taskType 대신 글 앞에 작업 머리말을 붙인다 (ai.google.dev/gemini-api/docs/embeddings)
function 요청(m, text, taskType) {
  if (/embedding-2/.test(m)) {
    const 머리 = taskType === "RETRIEVAL_QUERY" ? "task: search result | query: " : "title: none | text: ";
    return { model: `models/${m}`, content: { parts: [{ text: 머리 + text }] }, outputDimensionality: 차원 };
  }
  return { model: `models/${m}`, content: { parts: [{ text }] }, taskType, outputDimensionality: 차원 };
}

async function 임베딩(m, 글들, taskType) {
  const body = JSON.stringify({ requests: 글들.map((t) => 요청(m, t, taskType)) });
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
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        // 키 값은 남기지 않는다. 한도 종류(분당/일일)를 알 수 있게 오류 문구 앞부분만 남긴다
        console.error("임베딩 실패", m, r.status, String(data?.error?.message || "").slice(0, 120));
        continue;
      }
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

async function 색인만들기(조각, 해시) {
  // 1) 저장소에 이미 다 계산된 모델이 있으면 API 를 부르지 않고 그것을 쓴다
  for (const m of 모델목록()) {
    const 결과 = await 모델로색인(m, 조각, 해시, true);
    if (결과) return 결과;
  }
  // 2) 없으면 모델 순서대로 빈 조각을 계산한다
  for (const m of 모델목록()) {
    const 결과 = await 모델로색인(m, 조각, 해시, false);
    if (결과) return 결과;
  }
  쉬는까지 = Date.now() + 쉬는시간;
  return null;
}

async function 모델로색인(m, 조각, 해시, 저장된것만) {
  const 키 = 조각.map((c) => 조각키(m, c));
  const 저장된 = (await 저장소(["MGET", ...키])) || [];
  const 벡터 = 조각.map((_, i) => (저장된[i] ? 꺼내기(저장된[i]) : null));
  const 빈곳 = 벡터.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  if (저장된것만 && 빈곳.length) return null;
  for (let s = 0; s < 빈곳.length; s += 묶음크기) {
    const 이번 = 빈곳.slice(s, s + 묶음크기);
    const 결과 = await 임베딩(m, 이번.map((i) => 임베딩글(조각[i])), "RETRIEVAL_DOCUMENT");
    if (!결과) return null;
    for (let j = 0; j < 이번.length; j++) {
      벡터[이번[j]] = 결과[j];
      await 저장소(["SET", 키[이번[j]], 담기(결과[j]), "EX", 90 * 86400]);
    }
  }
  return { 해시, 벡터, 모델: m };
}

async function 색인얻기() {
  const { 조각, 해시 } = 문서읽기();
  if (색인 && 색인.해시 === 해시) return 색인;
  if (Date.now() < 쉬는까지) return null;
  if (!만드는중) 만드는중 = 색인만들기(조각, 해시).finally(() => (만드는중 = null));
  const 새색인 = await 만드는중;
  if (새색인) 색인 = 새색인;
  return 새색인;
}

async function 질문벡터(m, 질문) {
  const 키 = 질문키(m, 질문);
  const 저장된 = await 저장소(["GET", 키]);
  if (저장된) return 꺼내기(저장된);
  const r = await 임베딩(m, [질문], "RETRIEVAL_QUERY");
  if (!r) {
    쉬는까지 = Date.now() + 쉬는시간;
    return null;
  }
  await 저장소(["SET", 키, 담기(r[0]), "EX", 86400]);
  return r[0];
}

// 질문과 뜻이 가까운 조각 상위 k개. 실패하면 null
async function 임베딩찾기(질문, k = 6) {
  if (!키목록().length || Date.now() < 쉬는까지) return null;
  const idx = await 색인얻기();
  if (!idx) return null;
  const qv = await 질문벡터(idx.모델, 질문);
  if (!qv) return null;
  const { 조각 } = 문서읽기();
  return 조각
    .map((c, i) => {
      const v = idx.벡터[i];
      let s = 0;
      for (let j = 0; j < v.length; j++) s += v[j] * qv[j];
      return { ...c, 점수: s, 모델: idx.모델 };
    })
    .sort((a, b) => b.점수 - a.점수)
    .slice(0, k);
}

module.exports = { 임베딩찾기 };
