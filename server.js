// server.js (Vercel 배포 및 1시간 갱신 로직 적용)
const express = require('express');
const cors = require('cors');
const seedrandom = require('seedrandom'); 
const axios = require('axios'); 
const app = express();

// 💡 환경 변수에서 API 키를 안전하게 불러옵니다. (필수: Vercel 설정 확인)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
const ONE_HOUR = 3600000; // 1시간 (밀리초)

// 💡 데이터 및 갱신 시간 저장 공간
let MASTER_QUIZ_DATA = [];
let LAST_FETCH_TIME = 0; // 마지막 데이터 로드 시간 (타임스탬프)

// ==========================================================
// 퀴즈 생성 프롬프트 및 설정 (동일)
// ==========================================================
const QUIZ_GENERATION_PROMPT = {
    contents: [
        {
            role: "user",
            parts: [
                {
                    text: `당신은 상식 퀴즈를 생성하는 전문가입니다. **절대 이전에 생성한 질문을 재사용하지 마세요.** 이전 요청과는 완전히 다른 새로운 지식 분야(예: 과학, 역사, 대중문화, 코딩, 스포츠 등)에서 5개의 독특하고 새로운 상식 퀴즈 질문을 생성하세요. 아래 JSON 형식에 정확히 맞추어 질문, choices(보기는 3개 이상), explanation(해설), 그리고 정답의 인덱스(0부터 시작)인 correctAnswerIndex를 포함해야 합니다. 다른 설명 없이 JSON 배열만을 반환해야 합니다. 응답은 JSON Markdown 형식으로 제공되어야 합니다. [REQUEST_ID: ${Date.now()}]`, 
                }
            ]
        }
    ],
    generationConfig: { 
        responseMimeType: "application/json",
        temperature: 0.9, 
    }
};

// ==========================================================
// 1. 핵심 유틸리티 함수 (동일)
// ==========================================================

function getDailySeed() {
    const today = new Date();
    const year = today.getUTCFullYear();
    const month = String(today.getUTCMonth() + 1).padStart(2, '0');
    const day = String(today.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`; 
}

function shuffleArray(array, seed) {
    const rng = seedrandom(seed); 
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1)); 
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function assignQuizIds(quizData) {
    return quizData.map((q, index) => ({
        ...q,
        id: index + 1 
    }));
}

function getKRandomQuestions(K, masterData) {
    const seed = getDailySeed();
    const dataCopy = [...masterData]; 
    const count = Math.min(K, dataCopy.length);
    const shuffledCopy = shuffleArray(dataCopy, seed);
    return shuffledCopy.slice(0, count);
}

function sanitizeQuizData(questions) {
    return questions.map(q => {
        const { correctAnswerIndex, ...safeQuestion } = q;
        return safeQuestion; 
    });
}


// ==========================================================
// 2. 외부 데이터 로딩 및 갱신 함수 (LAST_FETCH_TIME 업데이트)
// ==========================================================

async function fetchNewQuizData() {
    console.log(`[DATA] Gemini API를 통해 새로운 퀴즈 데이터 로딩을 시작합니다...`);
    
    // ... (API 호출 로직은 동일) ...
    
    try {
        const response = await axios.post(
            GEMINI_API_URL, 
            QUIZ_GENERATION_PROMPT
        );
        
        const generatedContent = response.data;
        let quizJsonText = '';
        
        if (generatedContent.candidates && generatedContent.candidates.length > 0) {
            quizJsonText = generatedContent.candidates[0].content.parts[0].text;
        } else {
             throw new Error("Gemini API 응답에서 유효한 후보를 찾을 수 없습니다.");
        }

        const cleanedJsonText = quizJsonText.replace(/```json|```/g, '').trim();
        const newQuizData = JSON.parse(cleanedJsonText);
        
        if (Array.isArray(newQuizData) && newQuizData.length > 0) {
            MASTER_QUIZ_DATA = assignQuizIds(newQuizData); 
            // 💡 성공 시 마지막 갱신 시간 업데이트
            LAST_FETCH_TIME = Date.now(); 
            console.log(`[DATA] 퀴즈 데이터 갱신 완료. 총 ${MASTER_QUIZ_DATA.length}개의 새로운 문제가 로드되었습니다. (다음 갱신: ${new Date(LAST_FETCH_TIME + ONE_HOUR).toLocaleString()})`);
            return true;
        } else {
            throw new Error("Gemini API에서 유효한 퀴즈 배열을 가져오지 못했습니다.");
        }
        
    } catch (error) {
        console.error('[DATA ERROR] 퀴즈 데이터를 가져오는 데 실패했습니다. 오류:', error.message);
        return false;
    }
}


// ==========================================================
// 3. 미들웨어 및 라우트 설정
// ==========================================================

app.use(cors());
app.use(express.json());

// 💡 갱신 필요 여부를 확인하고 필요하면 데이터 로드 시도
async function ensureDataFreshness() {
    const isDataStale = (Date.now() - LAST_FETCH_TIME) > ONE_HOUR;

    if (MASTER_QUIZ_DATA.length === 0 || isDataStale) {
        // 데이터가 없거나 1시간이 지났으면 갱신 시도
        console.log(`[CHECK] Data is stale or missing. Attempting refresh...`);
        const success = await fetchNewQuizData();
        
        if (!success) {
            console.error(`[CHECK] Data refresh failed. Serving existing data or returning 503 if empty.`);
        }
    }
}

// 💡 루트 경로 (/) 라우트: 서버 상태 확인용
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: "OK", 
        message: "Quiz API Server is running. Use /api/quiz to get questions." 
    });
});


/**
 * GET /api/quiz
 */
app.get('/api/quiz', async (req, res) => {
    // 💡 요청이 올 때마다 데이터 갱신 필요 여부 확인 및 갱신 시도
    await ensureDataFreshness();

    if (MASTER_QUIZ_DATA.length === 0) {
        return res.status(503).json({ 
            errorCode: "DATA_UNAVAILABLE",
            message: "Quiz data is currently loading or unavailable. Please try again shortly." 
        });
    }
    
    // ... (퀴즈 추출 로직은 동일)
    const K = 5; 
    
    try {
        const todaysQuestions = getKRandomQuestions(K, MASTER_QUIZ_DATA);
        const safePayload = sanitizeQuizData(todaysQuestions);
        
        return res.status(200).json(safePayload);
    } catch (error) {
        console.error("Quiz API Error:", error);
        return res.status(500).json({ 
             errorCode: "SERVER_ERROR", 
             message: "Internal server error occurred during data retrieval." 
         });
    }
});


/**
 * GET /api/answer-key
 */
app.get('/api/answer-key', async (req, res) => {
    // 💡 요청이 올 때마다 데이터 갱신 필요 여부 확인 및 갱신 시도
    await ensureDataFreshness();

    if (MASTER_QUIZ_DATA.length === 0) {
        return res.status(503).json({ error: "Data unavailable" });
    }

    // ... (정답 키 추출 로직은 동일)
    const K = 5;
    
    try {
        const todaysQuestions = getKRandomQuestions(K, MASTER_QUIZ_DATA); 
        
        const answerKey = todaysQuestions.reduce((acc, q) => {
            if (typeof q.id === 'number' && typeof q.correctAnswerIndex === 'number') {
                acc[q.id] = q.correctAnswerIndex;
            }
            return acc;
        }, {});
        
        return res.status(200).json(answerKey);
    } catch (error) {
        console.error("Answer Key API Error:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});


// ==========================================================
// 4. Vercel 서버리스 모듈 내보내기 (필수)
// ==========================================================

// 💡 app.listen을 제거하고 Express 앱 객체만 내보냅니다.
module.exports = app;