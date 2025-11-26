// server.js (Vercel 배포 및 1시간 갱신 로직 적용)
const express = require('express');
const cors = require('cors');
const seedrandom = require('seedrandom'); 
const axios = require('axios'); 
const path = require('path'); // 💡 정적 파일 처리를 위한 path 모듈 추가
const app = express();

// 💡 환경 변수에서 API 키를 안전하게 불러옵니다. (Vercel 대시보드에서 설정된 키 사용)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
const ONE_HOUR = 3600000; // 1시간 (밀리초)

// 💡 데이터 및 갱신 시간 저장 공간
let MASTER_QUIZ_DATA = [];
let LAST_FETCH_TIME = 0; // 마지막 데이터 로드 시간 (타임스탬프)

// ==========================================================
// 퀴즈 생성 프롬프트 및 설정
// ==========================================================
const QUIZ_GENERATION_PROMPT = {
    contents: [
        {
            role: "user",
            parts: [
                {
                    text: `
# Role and Task
당신은 상식 퀴즈를 생성하는 전문가이자 엄격한 사실 검증가입니다. 아래의 필수 준수 사항을 모두 지켜 5개의 독특하고 새로운 상식 퀴즈 질문을 생성해야 합니다.

# Essential Constraints
1.  **[중복 문제 방지/다양성]:** **절대 이전에 생성한 질문과 답을 재사용하지 마십시오.** 이전 요청과는 완전히 다른 새로운 지식 분야(환경, 과학, 역사, 한글 맞춤법, 코딩, 디지털 리터러시, 스포츠, 경제, 지리, 정치, 사회, 문화예술 등)에서 퀴즈를 생성하여 다양성을 확보해야 합니다.
2.  **[지식 분야는 순환식으로 낼 것]:** **퀴즈 요청이 들어올 때마다** 이전에 출제된 지식 분야를 피하고, 다양한 주제를 각 문제마다 다른 주제로 순환식으로 다루어야 합니다. 예를 들어, 오늘 환경, 코딩, 역사, 스포츠, 경제 관련 문제가 출제되었다면, 다음 요청에서는 과학, 지리, 정치, 문화예술, 한글 맞춤법 등 다른 분야에서 문제를 출제해야 합니다. 모든 지식 분야를 다 써야 하며, 그 후에 다시 처음부터 순환합니다.
3.  **[정확성 검증 - 국립국어원]:** 모든 질문과 해설은 **100% 정확한 사실**에 기반해야 합니다. 특히 한글 맞춤법 및 어문 규범 관련 문제는 **국립국어원 표준 규정**을 엄격히 준수하여 논란의 여지가 없어야 합니다. **특히 한글 맞춤법은 띄어쓰기 뿐만 아니라 사이시옷, 외래어 표기법, 된소리 규칙 등 폭넓게 출제되어야 합니다.**
4.  **[난이도 조절]:** 난이도는 **중급에서 상급(Medium-High)** 사이로 설정하여, 단순 암기가 아닌 사고력과 깊이 있는 이해를 요하도록 문제를 구성해야 합니다.
5.  **[자세한 해설]:** 해설(explanation)은 **매우 자세하게** 작성되어야 하며, 정답의 근거뿐만 아니라 **오답 보기들이 왜 틀렸는지까지** 명확하게 설명해야 합니다.
6.  **[JSON 포맷]:** 아래 JSON 형식에 정확히 맞추어 질문, choices(보기는 3개 이상), explanation(해설), 그리고 정답의 인덱스(0부터 시작)인 correctAnswerIndex를 포함해야 합니다.
7.  **[정답 인덱스 일치 필터링]:** 해설(explanation) 내에 명시되는 정답 번호(예: '정답은 N번입니다.')의 N과 JSON 필드 "correctAnswerIndex" (0부터 시작)는 반드시 일치해야 합니다. (예: 해설에 '정답은 2번입니다.'라고 명시했다면, "correctAnswerIndex"는 1이 되어야 합니다.)

# Output Format
다른 설명 없이 **JSON 배열만을 반환**해야 합니다. 응답은 JSON Markdown 형식으로 제공되어야 합니다. [REQUEST_ID: ${Date.now()}]
`,
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
// 1. 핵심 유틸리티 함수
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
// 2. 외부 데이터 로딩 및 갱신 함수
// ==========================================================

async function fetchNewQuizData() {
    console.log(`[DATA] Gemini API를 통해 새로운 퀴즈 데이터 로딩을 시작합니다...`);
    
    const uniqueId = Date.now(); 
    const currentPrompt = JSON.parse(JSON.stringify(QUIZ_GENERATION_PROMPT));
    currentPrompt.contents[0].parts[0].text = currentPrompt.contents[0].parts[0].text.replace(/\[REQUEST_ID: \d+\]/, `[REQUEST_ID: ${uniqueId}]`);

    try {
        const response = await axios.post(
            GEMINI_API_URL, 
            currentPrompt
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
            console.log(`[DATA] 퀴즈 데이터 갱신 완료. 총 ${MASTER_QUIZ_DATA.length}개의 새로운 문제가 로드되었습니다.`);
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
    // Vercel의 경우, 함수가 재시작되면 MASTER_QUIZ_DATA가 비어있고 LAST_FETCH_TIME이 0입니다.
    const isDataStale = (Date.now() - LAST_FETCH_TIME) > ONE_HOUR;

    if (MASTER_QUIZ_DATA.length === 0 || isDataStale) {
        // 데이터가 없거나 1시간이 지났으면 갱신 시도
        console.log(`[CHECK] Data is stale or missing. Attempting refresh...`);
        await fetchNewQuizData();
    }
}

// 💡 루트 경로 (/) 라우트: index.html 파일 제공 (정적 호스팅 역할)
app.get('/', (req, res) => {
    // Vercel 환경에서 index.html 파일을 클라이언트에게 제공합니다.
    res.sendFile(path.join(__dirname, 'index.html'));
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
module.exports = app;