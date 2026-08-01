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

// Keep-Alive HTTP client for connection reuse
const axiosClient = axios.create({
    httpAgent: new http.Agent({ keepAlive: true, maxSockets: 50 }),
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 }),
    timeout: 8000
});

const ALL_TOPICS = [
    "문화예술", "환경", "과학", "역사", "디지털 리터러시", 
    "인권 리터러시", "한글 맞춤법", "코딩", "안전 및 건강상식", 
    "경제", "지리", "정치", "심리학"
];

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
let LAST_LATENCY_MS = 2;
let LAST_PROVIDER = 'offline-cache';
let IS_FETCHING = false;

function getSelectedTopics(count = 5) {
    const shuffled = [...ALL_TOPICS].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

function createQuizPayload(selectedTopics) {
    return {
        model: MODEL_ID,
        messages: [
            {
                role: "system",
                content: "You are a quiz generation engine. Output only valid JSON inside a ```json ``` block. No conversational preamble."
            },
            {
                role: "user",
                content: `총 13가지 분야 중 다음 선택된 5개 분야에서 각각 1문제씩 총 5개의 상식 퀴즈를 생성하세요: ${selectedTopics.join(', ')}

반드시 아래 JSON 형식으로만 응답:
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
}`
            }
        ],
        temperature: 0.3,
        max_tokens: 1400
    };
}

function autoFixQuiz(quiz) {
    if (!quiz || typeof quiz !== 'object') {
        return {
            id: Date.now(),
            topic: "일반상식",
            question: "문제 예시",
            choices: ["보기1", "보기2", "보기3", "보기4"],
            correctAnswerIndex: 0,
            correctAnswerText: "보기1",
            explanation: "정답은 보기1입니다."
        };
    }
    
    const choices = Array.isArray(quiz.choices) && quiz.choices.length === 4 
        ? quiz.choices.map(String) 
        : ["보기1", "보기2", "보기3", "보기4"];

    let correctIndex = typeof quiz.correctAnswerIndex === 'number' ? quiz.correctAnswerIndex : 0;
    
    if (quiz.correctAnswerText) {
        const textIndex = choices.findIndex(
            choice => choice && String(choice).trim() === String(quiz.correctAnswerText).trim()
        );
        if (textIndex !== -1) {
            correctIndex = textIndex;
        }
    }

    const correctText = choices[correctIndex] || choices[0];
    const explanationStr = quiz.explanation 
        ? String(quiz.explanation) 
        : `정답은 ${correctText}입니다.`;

    return {
        id: quiz.id || (Date.now() + Math.floor(Math.random() * 10000)),
        topic: quiz.topic || "상식",
        question: quiz.question || "문제가 생성되는 중입니다.",
        choices,
        correctAnswerIndex: correctIndex,
        correctAnswerText: correctText,
        explanation: explanationStr.startsWith("정답은") ? explanationStr : `정답은 ${correctText}입니다. ${explanationStr}`
    };
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

async function fetchWithHuggingFace(selectedTopics) {
    if (!HF_TOKEN) {
        console.warn("[ENGINE] HF_TOKEN missing in environment variables. Serving fallback pool.");
        return null;
    }
    const startTime = Date.now();
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
            throw new Error("Hugging Face Gemma model returned no content");
        }

        const contentText = message.content.trim();
        const jsonMatch = contentText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, contentText];
        const cleanJson = jsonMatch[1].trim();
        const parsed = JSON.parse(cleanJson);
        const rawQuizzes = parsed.quizzes || parsed;

        if (!Array.isArray(rawQuizzes)) {
            throw new Error("Invalid quizzes format received from model");
        }

        const elapsed = Date.now() - startTime;
        LAST_LATENCY_MS = elapsed;
        LAST_PROVIDER = 'huggingface-gemma';
        console.log(`[ENGINE] Hugging Face Gemma (${MODEL_ID}) Quiz Generation Completed in ${elapsed}ms`);

        return rawQuizzes.map((q, idx) => {
            const fixed = autoFixQuiz(q);
            return { ...fixed, id: Date.now() + idx };
        });
    } catch (err) {
        console.error("[ENGINE] Hugging Face Gemma Generation Error:", err?.message || err);
        return null;
    }
}

async function fetchNewQuizData(customTopics) {
    if (IS_FETCHING) return false;
    IS_FETCHING = true;
    const topics = customTopics || getSelectedTopics(5);

    try {
        let newQuizzes = await fetchWithHuggingFace(topics);

        if (!newQuizzes || newQuizzes.length === 0) {
            const shuffledFallback = [...FALLBACK_QUIZZES].sort(() => 0.5 - Math.random());
            newQuizzes = shuffledFallback.slice(0, 5).map((q, idx) => ({ ...q, id: Date.now() + idx }));
            LAST_LATENCY_MS = 2;
            LAST_PROVIDER = 'offline-cache';
        }

        MASTER_QUIZ_DATA = newQuizzes;
        LAST_FETCH_TIME = Date.now();
        IS_FETCHING = false;
        return true;
    } catch (e) {
        IS_FETCHING = false;
        return false;
    }
}

async function ensureDataFreshness() {
    try {
        if (MASTER_QUIZ_DATA.length === 0) {
            await fetchNewQuizData();
        } else if ((Date.now() - LAST_FETCH_TIME) > ONE_HOUR && !IS_FETCHING) {
            fetchNewQuizData().catch(err => console.error("Background refresh error:", err));
        }
    } catch (e) {
        console.error("ensureDataFreshness error:", e);
    }
}

function getSpeedStats() {
    return {
        latencyMs: LAST_LATENCY_MS,
        provider: LAST_PROVIDER,
        cacheHit: Date.now() - LAST_FETCH_TIME < ONE_HOUR,
        lastFetchTime: LAST_FETCH_TIME,
        totalCachedQuestions: MASTER_QUIZ_DATA.length,
        selectedTopics: MASTER_QUIZ_DATA.map(q => q.topic)
    };
}

app.use(cors());
app.use(express.json());

// Serving index.html static asset from root directory
app.use(express.static(path.join(__dirname)));

// --- API ROUTES FIRST ---

app.get('/api/quiz', async (req, res) => {
    try {
        await ensureDataFreshness();
        const dailyQuiz = getDailyQuestions(5, MASTER_QUIZ_DATA);
        return res.status(200).json(sanitizeQuizData(dailyQuiz));
    } catch (error) {
        return res.status(200).json(sanitizeQuizData(FALLBACK_QUIZZES));
    }
});

app.get('/api/answer-key', async (req, res) => {
    try {
        await ensureDataFreshness();
        const dailyQuiz = getDailyQuestions(5, MASTER_QUIZ_DATA);
        const answerKey = {};
        dailyQuiz.forEach(q => {
            if (typeof q.correctAnswerIndex === 'number') {
                answerKey[q.id] = q.correctAnswerIndex;
            }
        });
        return res.status(200).json(answerKey);
    } catch (e) {
        const answerKey = {};
        FALLBACK_QUIZZES.forEach(q => { answerKey[q.id] = q.correctAnswerIndex; });
        return res.status(200).json(answerKey);
    }
});

app.post('/api/quiz/generate', async (req, res) => {
    const startTime = Date.now();
    const { topics } = req.body || {};
    const selectedTopics = Array.isArray(topics) && topics.length > 0 ? topics : undefined;
    
    try {
        await fetchNewQuizData(selectedTopics);
        const quizzes = MASTER_QUIZ_DATA;
        const answerKey = {};
        quizzes.forEach(q => {
            if (typeof q.correctAnswerIndex === 'number') {
                answerKey[q.id] = q.correctAnswerIndex;
            }
        });

        const stats = getSpeedStats();
        const totalTimeMs = Date.now() - startTime;

        return res.status(200).json({
            success: true,
            latencyMs: totalTimeMs,
            stats,
            quizzes: sanitizeQuizData(quizzes),
            fullQuizzes: quizzes,
            answerKey
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message || "Generation failed" });
    }
});

app.get('/api/quiz/stats', (req, res) => {
    return res.json(getSpeedStats());
});

app.get('/api/quiz/topics', (req, res) => {
    return res.json({ topics: ALL_TOPICS });
});

app.post('/api/admin/refresh', async (req, res) => {
    const success = await fetchNewQuizData();
    return res.json({ success, stats: getSpeedStats() });
});

// Safe Express 4/5 Fallback route for SPA index.html
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ errorCode: "NOT_FOUND", error: "API endpoint not found" });
    }
    return res.sendFile(path.join(__dirname, 'index.html'));
});

// Only listen locally if run directly with `node server.js`
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
}

module.exports = app;
