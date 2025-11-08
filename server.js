// server.js
const express = require('express');
const cors = require('cors');
const seedrandom = require('seedrandom'); 
const axios = require('axios'); 
const app = express();
const PORT = 8080; // 포트 8080

// 🚨 보안 경고: 실제 키는 환경 변수로 관리해야 합니다.
 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

let MASTER_QUIZ_DATA = [];

// ==========================================================
// 퀴즈 생성 프롬프트 및 설정
// ==========================================================
const QUIZ_GENERATION_PROMPT = {
    contents: [
        {
            role: "user",
            parts: [
                {
                    // 💡 해설(explanation) 필드를 명시적으로 요청
                    text: `당신은 상식 퀴즈를 생성하는 전문가입니다. **절대 이전에 생성한 질문을 재사용하지 마세요.** 이전 요청과는 완전히 다른 새로운 지식 분야(예: 과학, 역사, 지리, 사회, 코딩, 디지털 리터러시, 경제, 정치, 한글 맞춤법, 스포츠 등)에서 5개의 독특하고 새로운 상식 퀴즈 질문을 생성하세요. 아래 JSON 형식에 정확히 맞추어 질문, choices(보기는 3개 이상), explanation(해설), 그리고 정답의 인덱스(0부터 시작)인 correctAnswerIndex를 포함해야 합니다. 다른 설명 없이 JSON 배열만을 반환해야 합니다. 응답은 JSON Markdown 형식으로 제공되어야 합니다. [REQUEST_ID: ${Date.now()}]`, 
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
// 1. 핵심 유틸리티 함수 (매일 시드, 셔플, 보안)
// ==========================================================

function getDailySeed() {
    const today = new Date();
    const year = today.getUTCFullYear();
    const month = String(today.getUTCMonth() + 1).padStart(2, '0');
    const day = String(today.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`; 
}

/** 시드 기반 Fisher-Yates 셔플 알고리즘. */
function shuffleArray(array, seed) {
    const rng = seedrandom(seed); 
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1)); 
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/** 💡 퀴즈 데이터에 고유 ID를 부여합니다. */
function assignQuizIds(quizData) {
    // 퀴즈 데이터에 순차적인 ID를 부여하여 클라이언트가 정답 키를 요청할 수 있도록 합니다.
    return quizData.map((q, index) => ({
        ...q,
        id: index + 1 
    }));
}

/** 💡 getDailySeed를 사용하여 K개의 질문을 추출합니다. */
function getKRandomQuestions(K, masterData) {
    const seed = getDailySeed();
    const dataCopy = [...masterData]; 
    const count = Math.min(K, dataCopy.length);
    const shuffledCopy = shuffleArray(dataCopy, seed);
    return shuffledCopy.slice(0, count);
}

/** 보안 정제: 민감한 'correctAnswerIndex' 필드만 제거하고 ID와 해설은 유지합니다. */
function sanitizeQuizData(questions) {
    return questions.map(q => {
        // correctAnswerIndex만 제거하고, ID, explanation, question, choices는 남깁니다.
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
    const currentPromptText = QUIZ_GENERATION_PROMPT.contents[0].parts[0].text;
    const updatedPromptText = currentPromptText.replace(/\[REQUEST_ID: \d+\]/, `[REQUEST_ID: ${uniqueId}]`);
    
    const currentPrompt = JSON.parse(JSON.stringify(QUIZ_GENERATION_PROMPT));
    currentPrompt.contents[0].parts[0].text = updatedPromptText;

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
            // 💡 퀴즈 데이터에 ID 부여 후 저장
            MASTER_QUIZ_DATA = assignQuizIds(newQuizData); 
            console.log(`[DATA] 퀴즈 데이터 갱신 완료. 총 ${MASTER_QUIZ_DATA.length}개의 새로운 문제가 Gemini로부터 로드되었습니다.`);
        } else {
            throw new Error("Gemini API에서 유효한 퀴즈 배열을 가져오지 못했습니다.");
        }
        
    } catch (error) {
        console.error('[DATA ERROR] 퀴즈 데이터를 가져오는 데 실패했습니다. 기존 데이터 유지:', error.message);
        if (error.response) {
             console.error('API Response Status:', error.response.status);
             console.error('API Response Data:', error.response.data);
        } else {
             console.error('Network or Parsing Error:', error);
        }
    }
}


// ==========================================================
// 3. 미들웨어 및 라우트 설정
// ==========================================================

app.use(cors());
app.use(express.json());

/**
 * GET /api/quiz : 정답 인덱스가 제거된 퀴즈 목록 (ID, 해설 포함)을 반환합니다.
 */
app.get('/api/quiz', (req, res) => {
    if (MASTER_QUIZ_DATA.length === 0) {
        return res.status(503).json({ 
            errorCode: "DATA_UNAVAILABLE",
            message: "Quiz data is currently loading or unavailable. Please wait for initial data fetch." 
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
 * 💡 GET /api/answer-key : 클라이언트가 정답을 확인할 수 있도록 정답 키 매핑을 반환합니다.
 * 보안을 위해 퀴즈 ID와 정답 인덱스만 제공합니다.
 */
app.get('/api/answer-key', (req, res) => {
    if (MASTER_QUIZ_DATA.length === 0) {
        return res.status(503).json({ error: "Data unavailable" });
    }

    const K = 5;
    
    try {
        // 1. 오늘 추출된 퀴즈 5개를 가져옵니다.
        const todaysQuestions = getKRandomQuestions(K, MASTER_QUIZ_DATA); 
        
        // 2. { id: correctAnswerIndex } 매핑 객체를 생성합니다.
        const answerKey = todaysQuestions.reduce((acc, q) => {
            // 정답 인덱스는 MASTER_QUIZ_DATA에만 존재합니다.
            if (typeof q.id === 'number' && typeof q.correctAnswerIndex === 'number') {
                acc[q.id] = q.correctAnswerIndex;
            }
            return acc;
        }, {});
        
        // 3. 응답 전송
        return res.status(200).json(answerKey);
    } catch (error) {
        console.error("Answer Key API Error:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});


// ==========================================================
// 4. 서버 리스닝 시작 및 데이터 초기 로딩 & 주기적 갱신
// ==========================================================
app.listen(PORT, async () => {
    console.log(`Quiz API Server is running and listening on port ${PORT}`); 
    console.log(`💡 오늘의 시드: ${getDailySeed()}`); 
    
    await fetchNewQuizData();
    
    const TWO_HOUR = 7200000; 
    console.log(`[OPERATIONAL MODE] 퀴즈 데이터는 ${TWO_HOUR / 3600000}시간마다 갱신됩니다.`);
    
    setInterval(fetchNewQuizData, TWO_HOUR); 
});