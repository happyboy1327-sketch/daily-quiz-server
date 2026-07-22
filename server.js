// server.js (Vercel 배포 및 1시간 갱신 로직 적용)
const express = require('express');
const cors = require('cors');
const seedrandom = require('seedrandom'); 
const axios = require('axios'); 
const path = require('path');
const app = express();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
const ONE_HOUR = 3600000;

let MASTER_QUIZ_DATA = [];
let LAST_FETCH_TIME = 0;
let LAST_TOPICS = [];

// ==========================================================
// 퀴즈 생성 프롬프트 및 설정
// ==========================================================
const QUIZ_GENERATION_PROMPT = {
    contents: [
        {
            role: "user",
            parts: [
                {
                    text: `퀴즈 출제 분야는 문화예술, 환경, 과학, 역사, 디지털 리터러시, 인권 리터러시, 한글 맞춤법, 코딩, 안전 및 건강상식, 경제, 지리, 정치, 심리학으로 총 13가지 분야입니다.
위 분야에서 중하급-중급 난이도의 상식 퀴즈 5개를 생성하세요.

**필수 규칙:**
1. 지정된 분야 중 중복 없이 선택하여 출제.
2. [소재 다변화 및 1순위 대표 키워드 출제 제한] 각 분야의 뻔한 단골 소재(예: 역사=세종대왕, 건강=CPR, 예술=모나리자)는 출제를 지양하고,약 30% 확률로만 흔한 소재를 허용합니다. 세부 하위 영역(세계사, 천문학, 생활금융 등)에서 유익한 소재를 발굴하세요.
3. [한글 맞춤법] 2026년 현행 국립국어원 표준 규정 준수. 띄어쓰기, 외래어표기법, 사이시옷 등을 다뤄야 하며, 선택지(choices)와 해설(explanation) 논리 완벽 일치(오답 띄어쓰기는 선택지 텍스트 자체에 직접 반영할 것).
4. 보기는 정확히 4개. 문제와 정답은 반드시 논리적으로 일치.
5. correctAnswerIndex는 0부터 시작 (0, 1, 2, 3).
6. explanation은 "정답은 [정답보기텍스트]입니다."로 시작하여, 정답 이유와 오답 보기가 틀린 핵심 이유를 포함해 4문장 이내로 요약 작성하세요.
7. 각 문제는 반드시 topic 필드에 출제 분야를 정확히 기입하세요.
**JSON 형식 예시:**
[
  [
  {
    "topic": "과학",
    "question": "질문 내용",
    "choices": ["보기1", "보기2", "보기3", "보기4"],
    "correctAnswerIndex": 1,
    "explanation": "정답은 보기2입니다..."
  }
]
]

JSON 배열만 반환하세요. [REQUEST_ID: ${Date.now()}]`
                }
            ]
        }
    ],
    generationConfig: { 
        responseMimeType: "application/json",
        temperature: 0.4,
        // 💡 생각 토큰을 적정 수준(1,024 토큰)으로 제어하여 비용과 맞춤법 논리 품질을 동시에 확보
        thinkingConfig: {
            thinkingBudget: 1024
        }
    }
};

// ==========================================================
// 1. 핵심 유틸리티 함수
// ==========================================================

function autoFixQuiz(quiz) {
    if (!quiz.explanation || !Array.isArray(quiz.choices)) return quiz;

    const explanationMatch = quiz.explanation.match(/정답은\s+['"‘“]?([^'”’.]+)['"’”?]?입니다/);
    if (!explanationMatch) return quiz;
    
    const explanationAnswer = explanationMatch[1].trim();
    let correctIndex = quiz.choices.findIndex(choice => choice && choice.trim() === explanationAnswer);
    
    if (correctIndex === -1) {
        const viewMatch = explanationAnswer.match(/보기\s*([1-4])/);
        if (viewMatch) correctIndex = parseInt(viewMatch[1], 10) - 1;
    }
    
    if (correctIndex !== -1 && correctIndex !== quiz.correctAnswerIndex) {
        console.log(`[AUTO-FIX] 정답 인덱스 자동 수정: ${quiz.correctAnswerIndex} → ${correctIndex} ("${explanationAnswer}")`);
        quiz.correctAnswerIndex = correctIndex;
    }
    return quiz;
}

async function validateQuizQuality(quiz) {
    const prompt = `
다음 퀴즈를 검증하세요.

문제:
${quiz.question}

보기:
${quiz.choices.map((c, i) => `${i + 1}. ${c}`).join("\n")}

현재 정답:
${quiz.correctAnswerIndex + 1}번

해설:
${quiz.explanation}

검사:
1. 실제 정답 보기가 정확히 1개인가?
2. 현재 정답 번호가 맞는가?
3. 해설의 설명에 오류가 없는가?

반드시 JSON만 반환하세요.

{
  "valid": true,
  "answerCount": 1,
  "correctIndex": 0,
  "explanationError": false,
  "reason": ""
}
`;

    try {
        const response = await axios.post(
            GEMINI_API_URL,
            {
                contents: [
                    {
                        role: "user",
                        parts: [
                            {
                                text: prompt
                            }
                        ]
                    }
                ],
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.1
                }
            },
            {
                timeout: 20000
            }
        );

        const text = response.data.candidates[0].content.parts[0].text;

console.log("===== GEMINI RAW =====");
console.log(text);

const cleaned = text.replace(/```json|```/g, '').trim();

console.log("===== CLEANED =====");
console.log(cleaned);

const result = JSON.parse(cleaned);

console.log("===== PARSED RESULT =====");
console.log(result);

return result;

    } catch (error) {
        console.error("[QUALITY CHECK ERROR]", error.message);

        // 검증 실패로 서버 전체가 죽지 않게 처리
        return {
            valid: true,
            reason: "검증 API 실패로 통과 처리"
        };
    }
}

async function validateSingleQuiz(quiz, index) {
    const errors = [];

    if (!quiz.topic || !quiz.question || !Array.isArray(quiz.choices) || typeof quiz.correctAnswerIndex !== 'number' || !quiz.explanation) {
        return { isValid: false, errors: ['필수 필드 누락'] };
    }

    if (quiz.choices.length !== 4) {
        errors.push(`보기 개수 오류 (${quiz.choices.length}개)`);
    }

    if (quiz.correctAnswerIndex < 0 || quiz.correctAnswerIndex >= quiz.choices.length) {
        errors.push(`correctAnswerIndex 범위 초과`);
    }

    quiz.choices.forEach((choice, choiceIndex) => {
        if (!choice || choice.trim() === '') {
            errors.push(`보기 ${choiceIndex + 1} 비어있음`);
        }
    });

    if (!/^정답은\s+.+?입니다/.test(quiz.explanation.trim())) {
        errors.push(`해설 시작 형식 불일치`);
    }

    // 해설 정답과 실제 정답 번호 비교
    const explanationMatch = quiz.explanation.match(
        /정답은\s+['"‘“]?(.+?)['"’”]?(?:입니다|입니다\.)/
    );

    if (explanationMatch) {
        const explanationAnswer = explanationMatch[1].trim();

        const explanationIndex = quiz.choices.findIndex(
            choice => choice.trim() === explanationAnswer
        );

        if (explanationIndex === -1) {
            errors.push(`해설 정답이 보기와 불일치`);
        } else if (explanationIndex !== quiz.correctAnswerIndex) {
            errors.push(`정답 번호와 해설 불일치`);
        }
    }


    // 로컬 검사에서 이미 오류 있으면 AI 호출 생략
    if (errors.length > 0) {
        return {
            isValid: false,
            errors
        };
    }


    // AI 내용 검증
    const qualityResult = await validateQuizQuality(quiz);

    console.log("===== QUALITY RESULT =====");
    console.log(qualityResult);
    console.log("치명적 오류이니 꼭 해결하세요.");

    if (!qualityResult.valid) {
        errors.push(
            `AI 내용 검증 실패: ${qualityResult.reason || '알 수 없는 오류'}`
        );
    }


    return {
        isValid: errors.length === 0,
        errors,
        quality: qualityResult
    };
}
    
async function filterValidQuizzes(quizData) {
    if (!Array.isArray(quizData) || quizData.length === 0) {
        return { validQuizzes: [], invalidCount: 0, errors: ['퀴즈 데이터가 배열이 아니거나 비어있습니다.'] };
    }
    
    const validQuizzes = [];
    const allErrors = [];
    let invalidCount = 0;
    let fixedCount = 0;

    const topics = quizData.map(q => q.topic);

    if (topics.includes(undefined) || topics.includes("")) {
        return {
            validQuizzes: [],
            invalidCount: quizData.length,
            fixedCount: 0,
            errors: ["topic 누락"]
        };
    }

    if (new Set(topics).size !== topics.length) {
        return {
            validQuizzes: [],
            invalidCount: quizData.length,
            fixedCount: 0,
            errors: ["출제 분야 중복"]
        };
    }
    
    const results = await Promise.all(
        quizData.map(async (quiz, index) => {
            const originalIndex = quiz.correctAnswerIndex;
            const fixedQuiz = autoFixQuiz(quiz);
            const validation = await validateSingleQuiz(fixedQuiz, index);

            return {
                fixedQuiz,
                validation,
                originalIndex,
                index
            };
        })
    );

    for (const { fixedQuiz, validation, originalIndex, index } of results) {
        if (validation.isValid) {
            validQuizzes.push(fixedQuiz);
            if (fixedQuiz.correctAnswerIndex !== originalIndex) {
                fixedCount++;
            }
        } else {
            invalidCount++;
            allErrors.push(`문제 ${index + 1}: ${validation.errors.join(', ')}`);
        }
    }

    // 💥 누락되었던 최종 결과 반환 및 함수 닫기 중괄호
    return {
        validQuizzes,
        invalidCount,
        fixedCount,
        errors: allErrors
    };
}

function getDailySeed() {
    const today = new Date();
    return `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, '0')}${String(today.getUTCDate()).padStart(2, '0')}`;
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
    "문화예술", "환경", "과학", "역사", "디지털 리터러시", "인권 리터러시", 
    "한글 맞춤법", "코딩", "안전 및 건강상식", "경제", "지리", "정치", "심리학"
];

function getSelectedTopics() {
    const availableTopics = TOPICS.filter(topic => !LAST_TOPICS.includes(topic));
    const topicPool = availableTopics.length >= 5 ? availableTopics : TOPICS;
    return shuffleArray([...topicPool], Date.now().toString()).slice(0, 5);
}

function assignQuizIds(quizData) {
    return quizData.map((q, index) => ({ ...q, id: index + 1 }));
}

function getKRandomQuestions(K, masterData) {
    const seed = getDailySeed();
    const dataCopy = [...masterData]; 
    const count = Math.min(K, dataCopy.length);
    return shuffleArray(dataCopy, seed).slice(0, count);
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
    
    currentPrompt.contents[0].parts[0].text = currentPrompt.contents[0].parts[0].text.replace(
        '위 분야에서 중하급-중급 난이도의 상식 퀴즈 5개를 생성하세요.',
        `다음 5개 분야에서만 각각 정확히 1문제씩 총 5문제를 생성하세요: ${selectedTopics.join(', ')}

[이번 회차 출제 가이드]
- 실생활 사례, 기초 개념, 역사적 배경, 최신 용어 등 매번 다채로운 관점의 소재를 골라 출제하세요.
- 분야별 대표 키워드 대신 세부 주제와 풍부한 단어를 활용하세요.`
    );
    
    currentPrompt.contents[0].parts[0].text = currentPrompt.contents[0].parts[0].text.replace(
        /\[REQUEST_ID: \d+\]/,
        `[REQUEST_ID: ${uniqueId}]`
    );

    const MAX_RETRIES = 2; 
    let success = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            console.log(`[DATA] 재시도 중... (${attempt + 1}/${MAX_RETRIES + 1})`);
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000)); 
        }

        try {
            const response = await axios.post(GEMINI_API_URL, currentPrompt, { timeout: 70000 });
            const generatedContent = response.data;
            
            if (!generatedContent.candidates || generatedContent.candidates.length === 0) {
                throw new Error("Gemini API 응답 결과가 없습니다.");
            }

            const quizJsonText = generatedContent.candidates[0].content.parts[0].text;
            const cleanedJsonText = quizJsonText.replace(/```json|```/g, '').trim();
            const newQuizData = JSON.parse(cleanedJsonText);
            
            
            const filterResult = await filterValidQuizzes(newQuizData);
            
            if (filterResult.fixedCount > 0) console.log(`[AUTO-FIX] ✅ ${filterResult.fixedCount}개 자동 수정 완료`);
            if (filterResult.invalidCount > 0) console.warn(`[WARNING] ${filterResult.invalidCount}개 문제 검증 제외`);
            
            if (filterResult.validQuizzes.length >= 3) {
                MASTER_QUIZ_DATA = assignQuizIds(filterResult.validQuizzes);
                LAST_TOPICS = [...selectedTopics];
                LAST_FETCH_TIME = Date.now(); 
                console.log(`[DATA] ✅ 퀴즈 데이터 갱신 완료 (${MASTER_QUIZ_DATA.length}개 로드)`);
                success = true;
                break;
            } else {
                throw new Error(`유효한 퀴즈 부족 (${filterResult.validQuizzes.length}개)`);
            }
        } catch (error) {
            console.error(`[DATA ERROR] (시도 ${attempt + 1}): ${error.message}`);
        }
    }
    
    if (!success) console.error('[DATA FAIL] ❌ 퀴즈 데이터 로딩 최종 실패');
    return success;
}

// ==========================================================
// 3. 미들웨어 및 라우트 설정
// ==========================================================

app.use(cors());
app.use(express.json());

async function ensureDataFreshness() {
    if (MASTER_QUIZ_DATA.length === 0 || (Date.now() - LAST_FETCH_TIME) > ONE_HOUR) {
        console.log(`[CHECK] 데이터 갱신 필요. 실행 중...`);
        await fetchNewQuizData();
    }
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/quiz', async (req, res) => {
    await ensureDataFreshness();

    if (MASTER_QUIZ_DATA.length === 0) {
        return res.status(503).json({ errorCode: "DATA_UNAVAILABLE", message: "Quiz data is unavailable." });
    }
    
    try {
        const todaysQuestions = getKRandomQuestions(5, MASTER_QUIZ_DATA);
        const sortedQuestions = todaysQuestions.sort((a, b) => a.id - b.id);
        return res.status(200).json(sanitizeQuizData(sortedQuestions));
    } catch (error) {
        console.error("Quiz API Error:", error);
        return res.status(500).json({ errorCode: "SERVER_ERROR" });
    }
});

        
app.get('/api/answer-key', async (req, res) => {
    console.log("1");
    await ensureDataFreshness();
    console.log("2");


    if (MASTER_QUIZ_DATA.length === 0) {
        console.log("3");
        return res.status(503).json({ error: "Data unavailable" });
    }
    
    try {
        console.log("4");
        const todaysQuestions = getKRandomQuestions(5, MASTER_QUIZ_DATA); 
        console.log("5");
        const sortedQuestions = todaysQuestions.sort((a, b) => a.id - b.id);

        const answerKey = sortedQuestions.reduce((acc, q) => {
            if (typeof q.id === 'number' && typeof q.correctAnswerIndex === 'number') {
                acc[q.id] = q.correctAnswerIndex;
                console.log("정답 확인완료");
            }
            return acc;
        }, {});
        
        return res.status(200).json(answerKey);
    } catch (e) {
        console.log("ERROR", e);
        return res.status(500).json({ errorCode: "SERVER_ERROR" });
    }
});
module.exports = app;
