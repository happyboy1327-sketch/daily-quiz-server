const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const seedrandom = require('seedrandom');

const app = express();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

if (!GEMINI_API_KEY) {
    console.error('[FATAL] GEMINI_API_KEY 환경변수가 설정되지 않았습니다. 퀴즈 생성이 실패합니다.');
}

// Gemma 모델 설정
const MODEL_NAME = "gemma-4-26b-a4b-it"; 
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
const ONE_HOUR = 3600000; 

let MASTER_QUIZ_DATA = []; 
let LAST_FETCH_TIME = 0;

// ==========================================================
// 1. 퀴즈 생성 프롬프트 및 JSON 스키마 강제 적용
// ==========================================================
const QUIZ_GENERATION_PROMPT = {
    contents: [{
        role: "user",
        parts: [{
            text: `퀴즈 출제 분야는 문화예술, 환경, 과학, 역사, 디지털 리터러시, 인권 리터러시, 한글 맞춤법, 코딩, 안전 및 건강상식, 경제, 지리, 정치, 심리학으로 총 13가지 분야에서 중하급-중급 난이도의 상식 퀴즈 정확히 5개를 생성하여라.

**필수 규칙**
1. 지정된 분야 중 서로 다른 5개 분야를 선택하여 출제하여라.
2. 뻔한 소재를 피하고 세부 영역에서 다양하게 선택할 것.
3. 한글 맞춤법은 2026년 현행 표준 규정 기준.
4. 코딩 문제는 반드시 문제 본문에 마크다운 코드 블록을 포함할 것.
5. 보기(choices)는 정확히 4개 작성.
6. correctAnswerText는 choices의 요소와 정확히 일치해야 하며, correctAnswerIndex는 그 인덱스(0-3)여야 함.
7. explanation은 반드시 "정답은 [correctAnswerText]입니다."로 시작하고 최대 4문장으로 작성.
8. topic 필드는 제시된 13가지 분야명 중 하나를 사용할 것.`
        }]
    }],
    generationConfig: {
        temperature: 0.3,
        // API 레벨에서 JSON 출력을 강제하는 핵심 설정
        responseMimeType: "application/json",
        responseSchema: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    topic: { type: "STRING" },
                    question: { type: "STRING" },
                    choices: { 
                        type: "ARRAY", 
                        items: { type: "STRING" } 
                    },
                    correctAnswerIndex: { type: "INTEGER" },
                    correctAnswerText: { type: "STRING" },
                    explanation: { type: "STRING" }
                },
                required: ["topic", "question", "choices", "correctAnswerIndex", "correctAnswerText", "explanation"]
            }
        }
    }
};

// ==========================================================
// 2. 핵심 유틸리티 함수
// ==========================================================

// 모델이 순수 JSON만 반환하므로 로직을 단순화하되, 만약을 대비한 방어 코드 유지
function extractJson(text) {
    try {
        // 1차 시도: API가 순수 JSON을 줬을 것이라 가정하고 바로 파싱
        return JSON.parse(text);
    } catch (e1) {
        // 2차 시도: 혹시라도 마크다운 찌꺼기가 섞여 있을 경우를 대비한 백업(Fallback)
        try {
            const trimmed = text.trim();
            const start = trimmed.indexOf('[');
            const end = trimmed.lastIndexOf(']');

            if (start === -1 || end === -1 || end <= start) {
                throw new Error("JSON 배열의 시작/끝 대괄호를 찾지 못했습니다.");
            }

            const jsonString = trimmed.slice(start, end + 1);
            return JSON.parse(jsonString);
        } catch (e2) {
            console.error("[PARSE ERROR] JSON 파싱 실패:", e2.message);
            console.error("[PARSE ERROR] 원본 응답 일부:", text.slice(0, 300));
            return null;
        }
    }
}

function autoFixQuiz(quiz) {
    if (!Array.isArray(quiz.choices)) return quiz;
    if (quiz.correctAnswerText) {
        const textIndex = quiz.choices.findIndex(
            choice => choice && choice.trim() === quiz.correctAnswerText.trim()
        );
        if (textIndex !== -1 && textIndex !== quiz.correctAnswerIndex) {
            quiz.correctAnswerIndex = textIndex;
        }
    }
    return quiz;
}

// 모델이 생성한 문제가 최소 요건(보기 4개, 정답 인덱스 범위 등)을 만족하는지 검증
function isValidQuiz(quiz) {
    return (
        quiz &&
        typeof quiz.question === 'string' && quiz.question.trim().length > 0 &&
        Array.isArray(quiz.choices) && quiz.choices.length === 4 &&
        quiz.choices.every(c => typeof c === 'string' && c.trim().length > 0) &&
        Number.isInteger(quiz.correctAnswerIndex) &&
        quiz.correctAnswerIndex >= 0 && quiz.correctAnswerIndex <= 3
    );
}

// seedrandom 기반 시드 고정 Fisher-Yates 셔플
function seededShuffle(arr, rng) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// 제공해주신 HTML의 loadQuizData 함수가 요구하는 형태로 데이터 정제
function sanitizeQuizData(quizzes) {
    return quizzes.map(({ topic, question, choices, id }) => ({
        id, topic, question, choices
    }));
}

// seedrandom을 이용해 오늘 날짜 기준 동일한 문제 세트 추출
function getDailyQuestions(k, data) {
    const today = new Date().toISOString().split('T')[0];
    const rng = seedrandom(today); 
    const shuffled = seededShuffle(data, rng);
    return shuffled.slice(0, k);
}

// 하루 동안 /api/quiz 와 /api/answer-key가 서로 다른 문제 세트를 반환하지 않도록 캐싱
let CACHED_DAILY_QUIZ = null;
let CACHED_DAILY_KEY = null;

function getCachedDailyQuiz() {
    const today = new Date().toISOString().split('T')[0];
    if (CACHED_DAILY_KEY !== today || !CACHED_DAILY_QUIZ) {
        CACHED_DAILY_QUIZ = getDailyQuestions(5, MASTER_QUIZ_DATA);
        CACHED_DAILY_KEY = today;
    }
    return CACHED_DAILY_QUIZ;
}

// ==========================================================
// 3. 데이터 로딩 로직
// ==========================================================

async function fetchNewQuizData() {
    console.log(`[API] 퀴즈 5문제 생성 요청 중...`);
    try {
        const response = await axios.post(GEMINI_API_URL, QUIZ_GENERATION_PROMPT);
        const responseText = response.data.candidates[0].content.parts[0].text;
        const rawQuizzes = extractJson(responseText);

        if (!rawQuizzes || !Array.isArray(rawQuizzes)) throw new Error("Invalid JSON array");

        const cleaned = rawQuizzes
            .map(autoFixQuiz)
            .filter(isValidQuiz);

        if (cleaned.length === 0) throw new Error("No valid quiz questions after validation");

        MASTER_QUIZ_DATA = cleaned.map((q, idx) => ({ ...q, id: Date.now() + idx }));

        LAST_FETCH_TIME = Date.now();
        // 새 문제가 들어왔으므로 캐시된 오늘의 퀴즈 세트를 무효화
        CACHED_DAILY_QUIZ = null;
        CACHED_DAILY_KEY = null;
        console.log(`[API] 퀴즈 생성 성공! (${cleaned.length}문제 확보)`);
        return true;
    } catch (error) {
        console.error(`[DATA ERROR] 퀴즈 생성 실패: ${error.message}`);
        if (error.response) {
            console.error(`[API DETAILS]`, JSON.stringify(error.response.data, null, 2));
        }
        return false;
    }
}

async function ensureDataFreshness() {
    if (MASTER_QUIZ_DATA.length === 0 || (Date.now() - LAST_FETCH_TIME) > ONE_HOUR) {
        await fetchNewQuizData();
    }
}

// ==========================================================
// 4. 라우트 설정 (HTML과 완벽 매칭)
// ==========================================================

app.use(cors());
app.use(express.json());

// 1. 문제 목록 제공 API
app.get('/api/quiz', async (req, res) => {
    await ensureDataFreshness();
    if (MASTER_QUIZ_DATA.length === 0) return res.status(503).json({ errorCode: "DATA_UNAVAILABLE" });
    
    try {
        // 오늘 날짜 기준으로 캐싱된 5문제 세트 사용
        const dailyQuiz = getCachedDailyQuiz();
        // HTML의 sanitize 로직에 맞춰 정답/해설 제외하고 전송
        return res.status(200).json(sanitizeQuizData(dailyQuiz));
    } catch (error) {
        return res.status(500).json({ errorCode: "SERVER_ERROR" });
    }
});

// 2. 정답 키 제공 API
app.get('/api/answer-key', async (req, res) => {
    await ensureDataFreshness();
    if (MASTER_QUIZ_DATA.length === 0) return res.status(503).json({ error: "Data unavailable" });
    
    try {
        const dailyQuiz = getCachedDailyQuiz();
        const answerKey = {};
        dailyQuiz.forEach(q => {
            answerKey[q.id] = {
                correctAnswerIndex: q.correctAnswerIndex,
                explanation: q.explanation
            };
        });
        return res.status(200).json(answerKey);
    } catch (e) {
        return res.status(500).json({ errorCode: "SERVER_ERROR" });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Gemma Daily Quiz Server running on port ${PORT}`);
    await fetchNewQuizData(); // 서버 시작 시 미리 생성
});

module.exports = app;
