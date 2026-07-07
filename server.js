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

let LAST_TOPICS = [];

// ==========================================================
// 퀴즈 생성 프롬프트 및 설정 (수정됨)
// ==========================================================
const QUIZ_GENERATION_PROMPT = {
    contents: [
        {
            role: "user",
            parts: [
                {
                    text: `
퀴즈 출제 분야는 문화예술, 환경, 과학, 역사, 디지털 리터러시, 인권 리터러시, 한글 맞춤법, 코딩, 안전 및 건강상식, 경제, 지리, 정치, 심리학으로 총 13가지 분야입니다. 
위 분야에서 중하급-중급 난이도의 상식 퀴즈 5개를 생성하세요.

**필수 규칙:**
1. **각 문제는 위 분야들 중 랜덤으로 5개를 중복 없게 위에 나열된 순서에 상관없이 선택하여 출제한다. 단, 이전 세트에서 이미 출제된 분야는 나머지 모든 분야가 출제될 때까지 다시 선택하지 않는다.** 
2. **한 분야에서 같은 소재의 문제 출제를 지양하고 여러 다양한 소재를 활용하여 출제할 것.** **ex) 안전 및 건강 상식 분야에서 심폐소생술 뿐만 아니라 허리 건강, 재난 등의 다양한 소재를 쓸 것. 역사 분야에서도 다양한 시대배경에서 출제 요망.**

3. **[중요] 한글 맞춤법/띄어쓰기 문항 출제 규칙:**
- 2026년 현행 국립국어원 표준 규정(띄어쓰기, 사이시옷, 외래어 표기법 등)을 철저히 준수하세요.
- **선택지(choices)와 해설(explanation)의 논리가 완벽히 일치해야 합니다.**
- 예를 들어, 띄어쓰기 오류를 오답 보기로 만들고 싶다면 **선택지 텍스트 자체를 실제로 띄어 써야 합니다.** (예: 정답이 붙여 쓰는 '어젯밤'이라면, 오답 보기는 반드시 '어제 밤'과 같이 확실히 띄어 써진 형태여야 함. 이미 붙여 써놓고 해설에서 '붙여 써야 하므로 오답'이라고 말하는 논리 모순을 절대 금지합니다.)

4. 보기는 정확히 4개
5. 문제와 정답이 반드시 일치하고 말이 되도록 하기. Ex) 문제-소크라테스를 제외한 학자 중... 답-소크라테스 ←절대 금지
6. correctAnswerIndex는 0부터 시작 (첫 번째=0, 두 번째=1, 세 번째=2, 네 번째=3)
7. explanation은 반드시 "정답은 [정답보기텍스트]입니다. [이유...]" 형식으로 시작
8. explanation은 4문장 이내로 간결하게 작성하되, 각 오답 이유도 간단히 설명하기

**JSON 형식 예시:**
[
  {
    "question": "질문 내용",
    "choices": ["보기1", "보기2", "보기3", "보기4"],
    "correctAnswerIndex": 1,
    "explanation": "정답은 보기2입니다. 이유는... 보기1은 틀렸습니다. 왜냐하면... 보기3은... 보기4는..."
  }
]

JSON 배열만 반환하세요. [REQUEST_ID: ${Date.now()}]
`,
                }
            ]
        }
    ],
    generationConfig: { 
        responseMimeType: "application/json",
        temperature: 0.4
    }
};


// ==========================================================
// 1. 핵심 유틸리티 함수
// ==========================================================

/**
 * 퀴즈 데이터를 자동으로 수정합니다 (해설 기반으로 정답 인덱스 보정)
 * @param {Object} quiz - 수정할 퀴즈 객체
 * @returns {Object} 수정된 퀴즈 객체
 */
function autoFixQuiz(quiz) {
    if (!quiz.explanation || !Array.isArray(quiz.choices)) return quiz;

    // 💡 프롬프트 규칙("정답은 [텍스트]입니다.")에 맞게 정규식 매칭 수정
    const explanationMatch = quiz.explanation.match(/정답은\s+['"‘“]?([^'”’.]+)['"’”?]?입니다/);
    if (!explanationMatch) {
        return quiz; // 형식이 맞지 않으면 그대로 반환
    }
    
    const explanationAnswer = explanationMatch[1].trim();
    
    // choices에서 해설의 정답과 일치하는 항목 찾기
    let correctIndex = quiz.choices.findIndex(choice => 
        choice && choice.trim() === explanationAnswer
    );
    
    // AI가 텍스트 대신 "보기2" 처럼 숫자로 적었을 경우를 위한 보정 로직
    if (correctIndex === -1) {
        const viewMatch = explanationAnswer.match(/보기\s*([1-4])/);
        if (viewMatch) {
            correctIndex = parseInt(viewMatch[1], 10) - 1;
        }
    }
    
    if (correctIndex !== -1 && correctIndex !== quiz.correctAnswerIndex) {
        console.log(`[AUTO-FIX] 정답 인덱스 자동 수정: ${quiz.correctAnswerIndex} → ${correctIndex} ("${explanationAnswer}")`);
        quiz.correctAnswerIndex = correctIndex;
    }
    
    return quiz;
}

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
    
    // 💡 프롬프트 필수 규칙 3번("보기는 정확히 4개")에 맞게 조건 수정
    if (quiz.choices.length !== 4) {
        errors.push(`보기 개수가 올바르지 않음 (현재: ${quiz.choices.length}개)`);
    }
    
    // correctAnswerIndex 범위 확인
    if (quiz.correctAnswerIndex < 0 || quiz.correctAnswerIndex >= quiz.choices.length) {
        errors.push(`correctAnswerIndex(${quiz.correctAnswerIndex})가 범위 초과`);
    }
    
    // 빈 보기가 있는지 확인
    quiz.choices.forEach((choice, choiceIndex) => {
        if (!choice || choice.trim() === '') {
            errors.push(`보기 ${choiceIndex + 1}이 비어있음`);
        }
    });

    // 해설 시작 형식 검증 추가
    if (!/^정답은\s+.+?입니다/.test(quiz.explanation.trim())) {
        errors.push(`해설 시작 형식 불일치 ("정답은 ... 입니다."로 시작해야 함)`);
    }
    
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
    let fixedCount = 0;
    
    quizData.forEach((quiz, index) => {
        const originalIndex = quiz.correctAnswerIndex; // 변경 여부 감지용 원본 백업
        
        // 먼저 자동 수정 시도
        const fixedQuiz = autoFixQuiz(quiz);
        const validation = validateSingleQuiz(fixedQuiz, index);
        
        if (validation.isValid) {
            validQuizzes.push(fixedQuiz);
            if (fixedQuiz.correctAnswerIndex !== originalIndex) {
                fixedCount++;
            }
        } else {
            invalidCount++;
            allErrors.push(`문제 ${index + 1}: ${validation.errors.join(', ')}`);
        }
    });
    
    return {
        validQuizzes,
        invalidCount,
        fixedCount,
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

const TOPICS = [
    "문화예술",
    "환경",
    "과학",
    "역사",
    "디지털 리터러시",
    "인권 리터러시",
    "한글 맞춤법",
    "코딩",
    "안전 및 건강상식",
    "경제",
    "지리",
    "정치",
    "심리학"
];

function getSelectedTopics() {
    const availableTopics = TOPICS.filter(
        topic => !LAST_TOPICS.includes(topic)
    );

    const topicPool =
        availableTopics.length >= 5
            ? availableTopics
            : TOPICS;

    return shuffleArray(
        [...topicPool],
        Date.now().toString()
    ).slice(0, 5);
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
    const selectedTopics = getSelectedTopics();
    const currentPrompt = JSON.parse(JSON.stringify(QUIZ_GENERATION_PROMPT));
    
    currentPrompt.contents[0].parts[0].text =
        currentPrompt.contents[0].parts[0].text.replace(
            '위 분야에서 중하급-중급 난이도의 상식 퀴즈 5개를 생성하세요.',
            `
    다음 5개 분야에서만 각각 정확히 1문제씩 출제하세요.
    
    ${selectedTopics.join(', ')}
    
    총 5문제를 생성하세요.
    `
        );
    
    currentPrompt.contents[0].parts[0].text =
        currentPrompt.contents[0].parts[0].text.replace(
            /\[REQUEST_ID: \d+\]/,
            `[REQUEST_ID: ${uniqueId}]`
        );

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
                { timeout: 70000 } 
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
            
            const filterResult = filterValidQuizzes(newQuizData);
            
            if (filterResult.fixedCount > 0) {
                console.log(`[AUTO-FIX] ✅ ${filterResult.fixedCount}개의 문제 자동 수정 완료`);
            }
            
            if (filterResult.invalidCount > 0) {
                console.warn(`[VALIDATION WARNING] ${filterResult.invalidCount}개의 문제가 검증 실패로 제외되었습니다:`);
                filterResult.errors.forEach(err => console.warn(`  ⚠️  ${err}`));
            }
            
            if (filterResult.validQuizzes.length >= 3) {
                MASTER_QUIZ_DATA = assignQuizIds(filterResult.validQuizzes);
                LAST_TOPICS = [...selectedTopics];
                LAST_FETCH_TIME = Date.now(); 
                console.log(`[DATA] ✅ 퀴즈 데이터 갱신 완료. 총 ${MASTER_QUIZ_DATA.length}개의 문제가 로드되었습니다.`);
                success = true;
                break;
            } else {
                throw new Error(`유효한 퀴즈가 ${filterResult.validQuizzes.length}개뿐입니다 (최소 3개 필요). 재시도합니다.`);
            }
            
        } catch (error) {
            lastError = error;
            console.error(`[DATA ERROR] 퀴즈 데이터를 가져오는 데 실패했습니다 (시도 ${attempt + 1}/${MAX_RETRIES + 1}). 오류: ${error.message}`);
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
            message: "Quiz data is currently loading or unavailable." 
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
        return res.status(500).json({ errorCode: "SERVER_ERROR" });
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
        return res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = app;
