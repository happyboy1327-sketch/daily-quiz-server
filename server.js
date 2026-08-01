const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const seedrandom = require('seedrandom');

const app = express();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

// Gemma 2 모델 설정
const MODEL_NAME = "gemma-4-26b-a4b-it"; 
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;
const ONE_HOUR = 3600000; 

let MASTER_QUIZ_DATA = []; 
let LAST_FETCH_TIME = 0;

// ==========================================================
// 1. 퀴즈 생성 프롬프트 (정확히 5문제)
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
8. topic 필드는 제시된 13가지 분야명 중 하나를 사용할 것.

응답은 반드시 아래 JSON 배열 형식으로만 반환하고, 다른 설명 없이 JSON만 출력하라:
[{"topic":"string", "question":"string", "choices":["string","string","string","string"], "correctAnswerIndex":0, "correctAnswerText":"string", "explanation":"string"}]`
        }]
    }],
    generationConfig: {
        responseMimeType: "application/json", 
        temperature: 0.3,
    }
};

// ==========================================================
// 2. 핵심 유틸리티 함수
// ==========================================================

// Gemma 2의 마크다운 찌꺼기 제거 후 JSON 파싱
function extractJson(text) {
    try {
        const regex = /```(?:json)?\s*([\s\S]*?)\s*```/;
        const match = text.match(regex);
        const jsonString = match ? match[1].trim() : text.trim();
        return JSON.parse(jsonString);
    } catch (e) {
        console.error("[PARSE ERROR] JSON 파싱 실패:", e);
        return null;
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
    const shuffled = [...data].sort(() => 0.5 - rng());
    return shuffled.slice(0, k);
}

// ==========================================================
// 3. 데이터 로딩 로직
// ==========================================================

async function fetchNewQuizData() {
    console.log(`[API] Gemma 2 퀴즈 5문제 생성 요청 중...`);
    try {
        const response = await axios.post(GEMINI_API_URL, QUIZ_GENERATION_PROMPT);
        const responseText = response.data.candidates[0].content.parts[0].text;
        const rawQuizzes = extractJson(responseText);

        if (!rawQuizzes || !Array.isArray(rawQuizzes)) throw new Error("Invalid JSON array");

        MASTER_QUIZ_DATA = rawQuizzes.map((q, idx) => {
            const fixed = autoFixQuiz(q);
            return { ...fixed, id: Date.now() + idx };
        });

        LAST_FETCH_TIME = Date.now();
        return true;
    } catch (error) {
        console.error(`[DATA ERROR] 퀴즈 생성 실패: ${error.message}`);
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
        // 오늘 날짜 시드로 5문제 추출
        const dailyQuiz = getDailyQuestions(5, MASTER_QUIZ_DATA);
        // HTML의 sanitize 로직에 맞춰 정답/해설 제외하고 전송
        return res.status(200).json(sanitizeQuizData(dailyQuiz));
    } catch (error) {
        return res.status(500).json({ errorCode: "SERVER_ERROR" });
    }
});

// 2. 정답 키 제공 API (HTML의 correctAnswerMap[q.id] 구조에 맞춤)
app.get('/api/answer-key', async (req, res) => {
    await ensureDataFreshness();
    if (MASTER_QUIZ_DATA.length === 0) return res.status(503).json({ error: "Data unavailable" });
    
    try {
        const dailyQuiz = getDailyQuestions(5, MASTER_QUIZ_DATA);
        const answerKey = {};
        dailyQuiz.forEach(q => {
            answerKey[q.id] = q.correctAnswerIndex;
        });
        return res.status(200).json(answerKey);
    } catch (e) {
        return res.status(500).json({ errorCode: "SERVER_ERROR" });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(3000, async () => {
    console.log('Gemma 2 Daily Quiz Server running on port 3000');
    await fetchNewQuizData(); // 서버 시작 시 미리 생성
});

module.exports = app;
