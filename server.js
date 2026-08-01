const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const seedrandom = require('seedrandom');

const app = express();
const HF_TOKEN = process.env.HF_TOKEN; 

const MODEL_ID = "google/gemma-4-26B-A4B-it:novita";
const API_URL = "https://router.huggingface.co/v1/chat/completions";

const ONE_HOUR = 3600000; 

let MASTER_QUIZ_DATA = []; 
let LAST_FETCH_TIME = 0;

const ALL_TOPICS = [
    "문화예술", "환경", "과학", "역사", "디지털 리터러시", 
    "인권 리터러시", "한글 맞춤법", "코딩", "안전 및 건강상식", 
    "경제", "지리", "정치", "심리학"
];

function getSelectedTopics() {
    const shuffled = [...ALL_TOPICS].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 5);
}

function createQuizPayload(selectedTopics) {
    return {
        model: MODEL_ID,
        messages: [
            {
                role: "system",
                content: "You are a JSON generator. Respond ONLY with valid JSON inside a standard ```json code block. Do not add intro or outro text."
            },
            {
                role: "user",
                content: `선택된 5개 분야(${selectedTopics.join(', ')})에서 각각 1문제씩 총 5개의 상식 퀴즈를 생성하세요.

필수 규칙:
1. 선택된 5개 분야 각각 정확히 1문제씩 출제 (총 5문제).
2. 한글 맞춤법 문제는 2026년 현행 표준 규정 기준.
3. 코딩 문제는 문제 내용에 마크다운 코드 블록 포함.
4. choices는 정확히 4개 작성.
5. correctAnswerText는 choices 배열 중 하나와 완벽히 일치.
6. correctAnswerIndex는 정답의 인덱스(0~3).
7. explanation은 "정답은 [correctAnswerText]입니다."로 시작하고 최대 3문장 이내로 간결히 작성.

응답 형식:
\`\`\`json
{
  "quizzes": [
    {
      "topic": "분야명",
      "question": "문제 내용",
      "choices": ["보기1", "보기2", "보기3", "보기4"],
      "correctAnswerIndex": 0,
      "correctAnswerText": "보기1",
      "explanation": "정답은 보기1입니다. ..."
    }
  ]
}\`\`\``
            }
        ],
        temperature: 0.3,
        max_tokens: 3000 // ★ 토큰 수를 대폭 늘려 JSON 잘림 방지
    };
}

function autoFixQuiz(quiz) {
    if (!Array.isArray(quiz.choices)) return quiz;
    if (quiz.correctAnswerText) {
        const textIndex = quiz.choices.findIndex(
            choice => choice && choice.trim() === quiz.correctAnswerText.trim()
        );
        if (textIndex !== -1) {
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

// JSON 추출 및 정제 함수
function extractJsonFromText(text) {
    // 1. 마크다운 코드 블록 안의 JSON 추출
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
        return codeBlockMatch[1].trim();
    }
    
    // 2. 코드 블록이 없을 경우 최외곽 { ... } 추출
    const jsonObjectMatch = text.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
        return jsonObjectMatch[0].trim();
    }

    return text.trim();
}

async function fetchNewQuizData() {
    if (!HF_TOKEN) {
        console.error("[ERROR] HF_TOKEN 환경변수가 설정되지 않았습니다.");
        return false;
    }

    const selectedTopics = getSelectedTopics();
    console.log(`[API] 퀴즈 생성 요청 중... (분야: ${selectedTopics.join(', ')})`);
    
    try {
        const payload = createQuizPayload(selectedTopics);
        const response = await axios.post(API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${HF_TOKEN}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30초 타임아웃
        });
        
        const message = response.data?.choices?.[0]?.message;
        if (!message || !message.content) {
            throw new Error("API 응답 내용이 비어있습니다.");
        }

        const rawContent = message.content;
        const cleanJson = extractJsonFromText(rawContent);
        const parsed = JSON.parse(cleanJson);
        const rawQuizzes = parsed.quizzes || (Array.isArray(parsed) ? parsed : null);

        if (!rawQuizzes || !Array.isArray(rawQuizzes) || rawQuizzes.length === 0) {
            throw new Error("유효한 퀴즈 배열을 파싱하지 못했습니다.");
        }

        MASTER_QUIZ_DATA = rawQuizzes.map((q, idx) => {
            const fixed = autoFixQuiz(q);
            return { ...fixed, id: Date.now() + idx };
        });

        LAST_FETCH_TIME = Date.now();
        console.log(`[API] 퀴즈 ${MASTER_QUIZ_DATA.length}개 생성 완료`);
        return true;
    } catch (error) {
        console.error("[DATA ERROR] 퀴즈 생성 실패:", error.response?.data || error.message);
        return false;
    }
}

async function ensureDataFreshness() {
    if (MASTER_QUIZ_DATA.length === 0 || (Date.now() - LAST_FETCH_TIME) > ONE_HOUR) {
        await fetchNewQuizData();
    }
}

app.use(cors());
app.use(express.json());

app.get('/api/quiz', async (req, res) => {
    await ensureDataFreshness();
    if (MASTER_QUIZ_DATA.length === 0) {
        return res.status(503).json({ errorCode: "DATA_UNAVAILABLE", message: "퀴즈 데이터를 불러올 수 없습니다." });
    }
    
    try {
        const dailyQuiz = getDailyQuestions(5, MASTER_QUIZ_DATA);
        return res.status(200).json(sanitizeQuizData(dailyQuiz));
    } catch (error) {
        return res.status(500).json({ errorCode: "SERVER_ERROR" });
    }
});

app.get('/api/answer-key', async (req, res) => {
    await ensureDataFreshness();
    if (MASTER_QUIZ_DATA.length === 0) {
        return res.status(503).json({ error: "Data unavailable" });
    }
    
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

// 로컬 직접 실행 시 포트 개방 (Vercel 등 서버리스 환경 호환)
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
