const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const seedrandom = require('seedrandom');

const app = express();
const HF_TOKEN = process.env.HF_TOKEN; // Hugging Face 토큰

// Hugging Face Inference API 설정
const MODEL_ID = "google/gemma-4-26B-A4B-it";

const API_URL = "https://router.huggingface.co/v1/chat/completions";

const ONE_HOUR = 3600000; 

let MASTER_QUIZ_DATA = []; 
let LAST_FETCH_TIME = 0;

// 전체 13가지 분야 정의
const ALL_TOPICS = [
    "문화예술", "환경", "과학", "역사", "디지털 리터러시", 
    "인권 리터러시", "한글 맞춤법", "코딩", "안전 및 건강상식", 
    "경제", "지리", "정치", "심리학"
];

// 13개 중 5개 분야를 무작위로 동적 선택하는 함수
function getSelectedTopics() {
    const shuffled = [...ALL_TOPICS].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 5);
}

// ==========================================================
// 1. 동적 토픽 및 Function Calling 페이로드 생성
// ==========================================================
function createQuizPayload(selectedTopics) {
    return {
        model: MODEL_ID,
        messages: [{
            role: "user",
            content: `총 13가지 분야(문화예술, 환경, 과학, 역사, 디지털 리터러시, 인권 리터러시, 한글 맞춤법, 코딩, 안전 및 건강상식, 경제, 지리, 정치, 심리학) 중 다음 **선택된 5개 분야**에서 각각 정확히 1문제씩 총 5개의 중하급-중급 난이도 상식 퀴즈를 생성해 주세요.

**선택된 5개 분야:** ${selectedTopics.join(', ')}

**필수 규칙**
1. 위 5개 분야 각각에 대해 정확히 1문제씩 출제할 것.
2. 뻔한 소재를 피하고 세부 영역에서 다양하게 선택할 것.
3. 한글 맞춤법은 2026년 현행 표준 규정 기준.
4. 코딩 문제는 반드시 문제 본문에 마크다운 코드 블록을 포함할 것.
5. 보기(choices)는 정확히 4개 작성.
6. correctAnswerText는 choices의 요소와 정확히 일치해야 하며, correctAnswerIndex는 그 인덱스(0-3)여야 함.
7. explanation은 반드시 "정답은 [correctAnswerText]입니다."로 시작하고 최대 4문장으로 작성.
8. topic 필드는 위에서 선택된 5개 분야명 중 하나를 사용할 것.`
        }],
        tools: [{
            type: "function",
            function: {
                name: "generate_quizzes",
                description: "Generate a list of 5 trivia quiz questions based on the requested criteria.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        quizzes: {
                            type: "ARRAY",
                            description: "Array of 5 quiz objects",
                            items: {
                                type: "OBJECT",
                                properties: {
                                    topic: { type: "STRING", description: "One of the 5 selected topics" },
                                    question: { type: "STRING", description: "The quiz question text" },
                                    choices: { 
                                        type: "ARRAY", 
                                        items: { type: "STRING" }, 
                                        description: "Array of 4 choice options" 
                                    },
                                    correctAnswerIndex: { type: "INTEGER", description: "Index of the correct choice (0-3)" },
                                    correctAnswerText: { type: "STRING", description: "Text of the correct choice" },
                                    explanation: { type: "STRING", description: "Explanation starting with '정답은 [correctAnswerText]입니다.'" }
                                },
                                required: ["topic", "question", "choices", "correctAnswerIndex", "correctAnswerText", "explanation"]
                            }
                        }
                    },
                    required: ["quizzes"]
                }
            }
        }],
        tool_choice: "auto"
    };
}

// ==========================================================
// 2. 핵심 유틸리티 함수
// ==========================================================

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

function sanitizeQuizData(questions) {
    return questions.map(q => {
        const { correctAnswerIndex, ...safeQuestion } = q;
        return safeQuestion; 
    });
}

function getDailyQuestions(k, data) {
    const today = new Date().toISOString().split('T')[0];
    const rng = seedrandom(today); 
    const shuffled = [...data].sort(() => 0.5 - rng());
    return shuffled.slice(0, k);
}

// ==========================================================
// 3. 데이터 로딩 로직 (Hugging Face API 연동)
// ==========================================================

async function fetchNewQuizData() {
    const selectedTopics = getSelectedTopics();
    console.log(`[API] Hugging Face 퀴즈 생성 요청 중... (선택 분야: ${selectedTopics.join(', ')})`);
    
    try {
        const payload = createQuizPayload(selectedTopics);
        const response = await axios.post(API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${HF_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        
        const message = response.data.choices[0].message;
        if (!message.tool_calls || message.tool_calls.length === 0) {
            throw new Error("Model did not return a tool call");
        }

        const toolCall = message.tool_calls[0];
        const args = typeof toolCall.function.arguments === 'string' 
            ? JSON.parse(toolCall.function.arguments) 
            : toolCall.function.arguments;

        const rawQuizzes = args.quizzes;

        if (!rawQuizzes || !Array.isArray(rawQuizzes)) {
            throw new Error("Invalid quizzes format in tool call arguments");
        }

        MASTER_QUIZ_DATA = rawQuizzes.map((q, idx) => {
            const fixed = autoFixQuiz(q);
            return { ...fixed, id: Date.now() + idx };
        });

        LAST_FETCH_TIME = Date.now();
        console.log(`[API] 퀴즈 생성 완료 (${MASTER_QUIZ_DATA.length}문제)`);
        return true;
    } catch (error) {
        console.error("[DATA ERROR] 퀴즈 생성 실패");
        if (error.response) {
            console.error("HTTP STATUS:", error.response.status);
            console.error(JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message || error);
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
// 4. 라우트 설정
// ==========================================================

app.use(cors());
app.use(express.json());

app.get('/api/quiz', async (req, res) => {
    await ensureDataFreshness();
    if (MASTER_QUIZ_DATA.length === 0) return res.status(503).json({ errorCode: "DATA_UNAVAILABLE" });
    
    try {
        const dailyQuiz = getDailyQuestions(5, MASTER_QUIZ_DATA);
        return res.status(200).json(sanitizeQuizData(dailyQuiz));
    } catch (error) {
        return res.status(500).json({ errorCode: "SERVER_ERROR" });
    }
});

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


module.exports = app;
