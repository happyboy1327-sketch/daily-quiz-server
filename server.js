const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const seedrandom = require('seedrandom');
const http = require('http');
const https = require('https');

const app = express();
const HF_TOKEN = process.env.HF_TOKEN; 

const MODEL_ID = "google/gemma-4-26B-A4B-it:novita";
const API_URL = "https://router.huggingface.co/v1/chat/completions";

const ONE_HOUR = 3600000; 

const axiosClient = axios.create({
    httpAgent: new http.Agent({ keepAlive: true, maxSockets: 50 }),
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 }),
    timeout: 8000
});

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

// 툴(Tools)을 완전히 제거하고 순수 JSON 텍스트 생성을 요구하는 페이로드
function createQuizPayload(selectedTopics) {
    return {
        model: MODEL_ID,
        messages: [
            {
                role: "system",
                content: "Output only valid JSON. No markdown. No extra text."
            },
            {
                role: "user",
                content: `총 13가지 분야(문화예술, 환경, 과학, 역사, 디지털 리터러시, 인권 리터러시, 한글 맞춤법, 코딩, 안전 및 건강상식, 경제, 지리, 정치, 심리학) 중 다음 선택된 5개 분야에서 각각 정확히 1문제씩 총 5개의 중급 난이도 상식 퀴즈를 생성하세요.
선택된 분야:${selectedTopics.join(', ')}

필수 규칙:
1. 중복없이 선택된 5개 분야 각각 정확히 1문제씩 출제한다.
2. 총 문제 수는 반드시 5개여야 함.
3. 지나치게 많이 출제되는 단골 소재는 피하고 흥미로운 사실을 우선 활용.
4. 한글 맞춤법 문제는 2026년 현행 표준 규정 기준으로 작성한다.
5. 코딩 문제는 반드시 문제 본문에 마크다운 코드 블록을 포함한다.
6. choices는 정확히 4개 작성한다.
7. correctAnswerText는 choices 배열의 요소와 완전히 일치해야 한다.
8. correctAnswerIndex는 정답 보기의 인덱스(0~3)다.
9. explanation은 반드시 "정답은 [correctAnswerText]입니다."로 시작한다.
10. explanation은 최대 4문장으로 작성한다. 오답이 틀린 이유도 포함.

반드시 아래 JSON 형식으로만 응답:
{
  "quizzes": [
    {
      "topic": "분야명",
      "question": "문제 내용",
      "choices": [
        "보기1",
        "보기2",
        "보기3",
        "보기4"
      ],
      "correctAnswerIndex": 0,
      "correctAnswerText": "보기1",
      "explanation": "정답은 보기1입니다. ..."
    }
  ]
}`
            }
        ],
        temperature: 0.3,
        max_tokens: 1400
    };
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

async function fetchNewQuizData() {
    const selectedTopics = getSelectedTopics();
    console.log(`[API] Hugging Face 퀴즈 생성 요청 중... (선택 분야: ${selectedTopics.join(', ')})`);
    
    try {
        const payload = createQuizPayload(selectedTopics);
        const response = await axiosClient.post(API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${HF_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        
        const message = response.data.choices[0].message;
        if (!message || !message.content) {
            throw new Error("Model did not return any content");
        }

        let rawQuizzes = null;
        let contentText = message.content.trim();

        try {
            const jsonMatch = contentText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, contentText];
            const cleanJson = jsonMatch[1].trim();
            const parsed = JSON.parse(cleanJson);
            rawQuizzes = parsed.quizzes || parsed;
        } catch (parseErr) {
            console.error("[PARSE ERROR] 모델 응답 JSON 파싱 실패:", contentText);
            throw new Error("Failed to parse model response as JSON");
        }

        if (!rawQuizzes || !Array.isArray(rawQuizzes)) {
            throw new Error("Invalid quizzes format parsed from text");
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
