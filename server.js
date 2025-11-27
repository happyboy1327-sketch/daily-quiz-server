// server.js (Vercel 배포 및 1시간 갱신 로직 적용)
const express = require('express');
const cors = require('cors');
const seedrandom = require('seedrandom'); 
const axios = require('axios'); 
const path = require('path');
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
6.  **[JSON 포맷]:** 아래 JSON 형식에 정확히 맞추어 질문, choices(보기는 4개), explanation(해설), 그리고 정답의 인덱스(0부터 시작)인 correctAnswerIndex를 포함해야 합니다.
7.  **[정답 인덱스 무결성 규칙 - 매우 중요]:**
    - correctAnswerIndex는 **0부터 시작하는 배열 인덱스**입니다.
    - 예시: 첫 번째 보기가 정답이면 correctAnswerIndex = 0, 두 번째 보기가 정답이면 correctAnswerIndex = 1, 세 번째 보기가 정답이면 correctAnswerIndex = 2, 네 번째 보기가 정답이면 correctAnswerIndex = 3
    - 해설(explanation)의 첫 문장은 **반드시 "정답: [정답 보기 텍스트]"** 형식으로 시작해야 합니다.
    - 예시: 만약 choices[1]이 정답이라면, explanation은 "정답: [choices[1]의 텍스트]. [상세 설명...]" 형식으로 작성해야 합니다.
    - **절대로 "정답은 N번입니다" 형식을 사용하지 마세요.** 보기 텍스트를 직접 명시하세요.

# JSON Output Format Example
[
  {
    "question": "질문 내용",
    "choices": ["보기1", "보기2", "보기3", "보기4"],
    "correctAnswerIndex": 1,
    "explanation": "정답: 보기2. 이 보기가 정답인 이유는... 보기1은 틀렸습니다. 왜냐하면... 보기3은... 보기4는..."
  }
]

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

/**
 * 개별 퀴즈 문제가 올바른지 검증합니다.
 * @param {Object} quiz - 검증할 퀴즈 객체
 * @param {number} index - 문제 번호 (로그용)
 * @returns {Object} { isValid: boolean, errors: Array }
 */
function validateSingleQuiz(quiz, index) {
    const errors = [];
    
    // 필수 필드 확인
    if (!quiz.question || !Array.isArray(quiz.choices) || typeof quiz.correctAnswerIndex !== 'number' || !quiz.explanation) {
        errors.push(`필수 필드 누락`);
        return { isValid: false, errors };
    }
    
    // choices 배열 확인 (최소 3개, 최대 5개)
    if (quiz.choices.length < 3 || quiz.choices.length > 5) {
        errors.push(`보기 개수가 올바르지 않음 (현재: ${quiz.choices.length}개)`);
    }
    
    // correctAnswerIndex 범위 확인
    if (quiz.correctAnswerIndex < 0 || quiz.correctAnswerIndex >= quiz.choices.length) {
        errors.push(`correctAnswerIndex(${quiz.correctAnswerIndex})가 범위 초과 (0-${quiz.choices.length - 1})`);
    }
    
    // 해설에 정답 보기 텍스트가 포함되어 있는지 확인
    const correctChoice = quiz.choices[quiz.correctAnswerIndex];
    if (correctChoice && !quiz.explanation.includes(correctChoice)) {
        errors.push(`해설에 정답 텍스트 미포함`);
    }
    
    // 빈 보기가 있는지 확인
    quiz.choices.forEach((choice, choiceIndex) => {
        if (!choice || choice.trim() === '') {
            errors.push(`보기 ${choiceIndex + 1}이 비어있음`);
        }
    });
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

/**
 * 퀴즈 데이터 배열을 검증하고 유효한 문제만 필터링합니다.
 * @param {Array} quizData - 검증할 퀴즈 데이터 배열
 * @returns {Object} { validQuizzes: Array, invalidCount: number, errors: Array }
 */
function filterValidQuizzes(quizData) {
    if (!Array.isArray(quizData) || quizData.length === 0) {
        return { validQuizzes: [], invalidCount: 0, errors: ['퀴즈 데이터가 배열이 아니거나 비어있습니다.'] };
    }
    
    const validQuizzes = [];
    const allErrors = [];
    let invalidCount = 0;
    
    quizData.forEach((quiz, index) => {
        const validation = validateSingleQuiz(quiz, index);
        
        if (validation.isValid) {
            validQuizzes.push(quiz);
        } else {
            invalidCount++;
            allErrors.push(`문제 ${index + 1}: ${validation.errors.join(', ')}`);
        }
    });
    
    return {
        validQuizzes,
        invalidCount,
        errors: allErrors
    };
}

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
    // 퀴즈 데이터에 고유 ID를 부여합니다.
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
    // 클라이언트에게 전송하기 전에 정답 인덱스(correctAnswerIndex)와 해설을 제거합니다.
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

    const MAX_RETRIES = 2; 
    let success = false;
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            console.log(`[DATA] API 호출 재시도 중... (시도 ${attempt + 1}/${MAX_RETRIES + 1})`);
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay)); 
        }

        try {
            const response = await axios.post(
                GEMINI_API_URL, 
                currentPrompt,
                { timeout: 90000 } 
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
            
            // 💡 필터링 검증 로직: 유효한 문제만 추출
            const filterResult = filterValidQuizzes(newQuizData);
            
            if (filterResult.invalidCount > 0) {
                console.warn(`[VALIDATION WARNING] ${filterResult.invalidCount}개의 문제가 검증 실패로 제외되었습니다:`);
                filterResult.errors.forEach(err => console.warn(`  ⚠️  ${err}`));
            }
            
            // 💡 최소 3개 이상의 유효한 문제가 있어야 성공으로 간주
            if (filterResult.validQuizzes.length >= 3) {
                MASTER_QUIZ_DATA = assignQuizIds(filterResult.validQuizzes); 
                LAST_FETCH_TIME = Date.now(); 
                console.log(`[DATA] ✅ 퀴즈 데이터 갱신 완료. 총 ${MASTER_QUIZ_DATA.length}개의 문제가 로드되었습니다.`);
                if (filterResult.invalidCount === 0) {
                    console.log(`[VALIDATION] ✅ 모든 퀴즈 데이터가 검증을 통과했습니다.`);
                } else {
                    console.log(`[VALIDATION] ⚠️  ${filterResult.validQuizzes.length}개 문제만 사용 (${filterResult.invalidCount}개 제외됨)`);
                }
                success = true;
                break;
            } else {
                throw new Error(`유효한 퀴즈가 ${filterResult.validQuizzes.length}개뿐입니다 (최소 3개 필요). 재시도합니다.`);
            }
            
        } catch (error) {
            lastError = error;
            console.error(`[DATA ERROR] 퀴즈 데이터를 가져오는 데 실패했습니다 (시도 ${attempt + 1}/${MAX_RETRIES + 1}). 오류: ${error.message}`);
            
            if (error.code === 'ECONNABORTED') {
                 console.error("[TIMEOUT] Axios 요청이 90초 타임아웃되었습니다. Vercel 함수 제한 시간 초과 가능성 있음.");
            } else if (error.response) {
                 console.error(`[API FAIL] Gemini API 응답 상태 코드: ${error.response.status}`);
            }
        }
    }
    
    if (!success) {
        console.error('[DATA FAIL] ❌ 모든 시도에서 퀴즈 데이터 로딩에 실패했습니다.');
    }
    
    return success;
}


// ==========================================================
// 3. 미들웨어 및 라우트 설정
// ==========================================================

app.use(cors());
app.use(express.json());

async function ensureDataFreshness() {
    const isDataStale = (Date.now() - LAST_FETCH_TIME) > ONE_HOUR;

    if (MASTER_QUIZ_DATA.length === 0 || isDataStale) {
        console.log(`[CHECK] Data is stale or missing. Attempting refresh...`);
        await fetchNewQuizData();
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/quiz', async (req, res) => {
    await ensureDataFreshness();

    if (MASTER_QUIZ_DATA.length === 0) {
        return res.status(503).json({ 
            errorCode: "DATA_UNAVAILABLE",
            message: "Quiz data is currently loading or unavailable. Please try again shortly. This may indicate a temporary issue with the LLM API or a Vercel timeout." 
        });
    }
    
    const K = 5; 
    
    try {
        const todaysQuestions = getKRandomQuestions(K, MASTER_QUIZ_DATA);
        const sortedQuestions = todaysQuestions.sort((a, b) => a.id - b.id);
        const safePayload = sanitizeQuizData(sortedQuestions);
        
        return res.status(200).json(safePayload);
    } catch (error) {
        console.error("Quiz API Error:", error);
        return res.status(500).json({ 
             errorCode: "SERVER_ERROR", 
             message: "Internal server error occurred during data retrieval." 
          });
    }
});

app.get('/api/answer-key', async (req, res) => {
    await ensureDataFreshness();

    if (MASTER_QUIZ_DATA.length === 0) {
        return res.status(503).json({ error: "Data unavailable" });
    }

    const K = 5;
    
    try {
        const todaysQuestions = getKRandomQuestions(K, MASTER_QUIZ_DATA); 
        const sortedQuestions = todaysQuestions.sort((a, b) => a.id - b.id);

        const answerKey = sortedQuestions.reduce((acc, q) => {
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