const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const seedrandom = require('seedrandom');
const http = require('http');
const https = require('https');

const app = express();
const HF_TOKEN = process.env.HF_TOKEN; 
const MODEL_ID = "google/gemma-4-26B-A4B-it";
const API_URL = "https://router.huggingface.co/v1/chat/completions";
const ONE_HOUR = 3600000; 

// Keep-Alive HTTP client for high-performance connection reuse
const axiosClient = axios.create({
    httpAgent: new http.Agent({ keepAlive: true, maxSockets: 50 }),
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 }),
    timeout: 10000
});

const FALLBACK_QUIZZES = [
    {
        id: 1001,
        topic: "문화예술",
        question: "레오나르도 다빈치의 명작 '모나리자'가 소장되어 있는 세계적인 미술관은 어디일까요?",
        choices: ["프라도 미술관", "루브르 박물관", "메트로폴리탄 미술관", "우피치 미술관"],
        correctAnswerIndex: 1,
        correctAnswerText: "루브르 박물관",
        explanation: "정답은 루브르 박물관입니다. 모나리자는 프랑스 파리의 루브르 박물관에 전시되어 있으며 세계에서 가장 유명한 초상화 중 하나입니다."
    },
    {
        id: 1002,
        topic: "환경",
        question: "지구 온난화의 주요 원인 중 하나로, 태양 열의 일부를 지구 표면에 가두어 지구를 따뜻하게 유지하는 효과를 무엇이라 하는가?",
        choices: ["온실효과", "엘니뇨 현상", "오존층 파괴", "열섬 현상"],
        correctAnswerIndex: 0,
        correctAnswerText: "온실효과",
        explanation: "정답은 온실효과입니다. 이산화탄소, 메탄 등 온실가스가 증가하면 온실효과가 과도해져 지구 기온이 상승하게 됩니다."
    },
    {
        id: 1003,
        topic: "과학",
        question: "빛의 속도는 초당 약 몇 km일까요?",
        choices: ["약 15만 km/s", "약 30만 km/s", "약 50만 km/s", "약 100만 km/s"],
        correctAnswerIndex: 1,
        correctAnswerText: "약 30만 km/s",
        explanation: "정답은 약 30만 km/s입니다. 진공에서의 빛의 속도는 정확히 299,792,458 m/s로, 초당 지구를 약 7바퀴 반 돌 수 있습니다."
    },
    {
        id: 1004,
        topic: "역사",
        question: "훈민정음을 창제하여 백성들이 쉽게 글을 익히도록 한 조선의 제4대 국왕은 누구인가요?",
        choices: ["태종", "세종대왕", "성종", "정조"],
        correctAnswerIndex: 1,
        correctAnswerText: "세종대왕",
        explanation: "정답은 세종대왕입니다. 세종대왕은 1443년 훈민정음을 창제하고 1446년에 반포하였습니다."
    },
    {
        id: 1005,
        topic: "디지털 리터러시",
        question: "출처가 불분명한 이메일이나 문자 메시지의 링크를 클릭하도록 유도하여 개인정보를 탈취하는 사이버 사기 수법은?",
        choices: ["디도스(DDoS)", "피싱(Phishing)", "파밍(Pharming)", "스미싱(Smishing)"],
        correctAnswerIndex: 1,
        correctAnswerText: "피싱(Phishing)",
        explanation: "정답은 피싱(Phishing)입니다. 신뢰할 수 있는 기관이나 사람을 가장해 비밀번호, 금융 정보 등 개인정보를 낚아채는 공격 방식입니다."
    }
];

let MASTER_QUIZ_DATA = [...FALLBACK_QUIZZES]; 
let LAST_FETCH_TIME = Date.now();
let IS_FETCHING = false;

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
    if (!quiz || typeof quiz !== 'object') return quiz;
    if (!Array.isArray(quiz.choices) || quiz.choices.length !== 4) {
        quiz.choices = ["보기1", "보기2", "보기3", "보기4"];
    }
    if (quiz.correctAnswerText) {
        const textIndex = quiz.choices.findIndex(
            choice => choice && String(choice).trim() === String(quiz.correctAnswerText).trim()
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
    if (IS_FETCHING) return false;
    IS_FETCHING = true;
    const selectedTopics = getSelectedTopics();
    console.log(`[API] Hugging Face Gemma (${MODEL_ID}) 퀴즈 생성 요청 중... (선택 분야: ${selectedTopics.join(', ')})`);
    
    try {
        const payload = createQuizPayload(selectedTopics);
        const response = await axiosClient.post(API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${HF_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        
        const message = response.data?.choices?.[0]?.message;
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
        console.log(`[API] Gemma 퀴즈 생성 완료 (${MASTER_QUIZ_DATA.length}문제)`);
        IS_FETCHING = false;
        return true;
    } catch (error) {
        console.error("[DATA ERROR] 퀴즈 생성 실패 - 기존 캐시/기본 데이터 유지");
        if (error.response) {
            console.error("HTTP STATUS:", error.response.status);
            console.error(JSON.stringify(error.response.data, null, 2));
        } else {
            console.error(error.message || error);
        }
        IS_FETCHING = false;
        return false;
    }
}

// Non-blocking async freshness check
async function ensureDataFreshness() {
    if (MASTER_QUIZ_DATA.length === 0) {
        await fetchNewQuizData();
    } else if ((Date.now() - LAST_FETCH_TIME) > ONE_HOUR && !IS_FETCHING) {
        fetchNewQuizData().catch(err => console.error("Background refresh error:", err));
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

// Boot pre-warming
ensureDataFreshness().catch(() => {});

module.exports = app;
