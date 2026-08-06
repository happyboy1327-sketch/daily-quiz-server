const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const seedrandom = require('seedrandom');
const { createQuizPayload } = require('./prdPrompt');

const app = express();
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

app.disable('x-powered-by');

app.use((req, res, next) => {
    res.set({
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300', 
      'Vary': 'Accept-Encoding',
    });
    next();
});

const API_URL = "https://api.mistral.ai/v1/chat/completions";
const ONE_HOUR = 3600000; 

let MASTER_QUIZ_DATA = []; 
let LAST_FETCH_TIME = 0;
let LAST_TOPICS = [];
let fetchPromise = null;

const SPELLING_DATA = [
  { correct: "할 일", wrong: ["할일"], category: "띄어쓰기" },
  { correct: "몇 가지", wrong: ["몇가지"], category: "띄어쓰기" },
  { correct: "것 같다", wrong: ["것같다"], category: "띄어쓰기" },
  { correct: "할 수밖에 없다", wrong: ["할수밖에없다"], category: "띄어쓰기" },
  { correct: "되겠다", wrong: ["되갯다", "되겟다", "돼겠다", "됬겠다"], category: "어미 활용" },
  { correct: "됐다", wrong: ["됬다"], category: "어미 활용" },
  { correct: "안 돼", wrong: ["안되"], category: "어미 활용" },
  { correct: "돼서", wrong: ["되서"], category: "어미 활용" },
  { correct: "웬일", wrong: ["왠일"], category: "표기" },
  { correct: "어이없다", wrong: ["어의없다"], category: "표기" },
  { correct: "금세", wrong: ["금새"], category: "표기" },
  { correct: "며칠", wrong: ["몇일"], category: "표기" },
  { correct: "오랜만", wrong: ["오랫만"], category: "표기" },
  { correct: "설거지", wrong: ["설겆이"], category: "표기" }
];

const SPELLING_REGEX = new RegExp(
    SPELLING_DATA
        .flatMap(item => item.wrong)
        .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|")
);

const ALL_TOPICS = [
    "문화예술", "환경", "과학", "역사", "디지털 리터러시", 
    "인권 리터러시", "한글 맞춤법", "코딩", "안전 및 건강상식", 
    "경제", "지리", "정치", "심리학"
];

const HANJA_AND_FOREIGN_REGEX = /[\u4E00-\u9FFF\u0400-\u04FF]/;

function shuffleArray(array, seed) {
    const rng = seedrandom(seed); 
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1)); 
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function getSelectedTopics() {
    const availableTopics = ALL_TOPICS.filter(topic => !LAST_TOPICS.includes(topic));
    const topicPool = availableTopics.length >= 5 ? availableTopics : ALL_TOPICS;
    return shuffleArray([...topicPool], Date.now().toString()).slice(0, 5);
}

function normalizeChoice(choice, topic) {
    const text = String(choice || "").trim();
    if (topic === "한글 맞춤법") return text;
    return text.replace(/\s+/g, "");
}

function hasDuplicateChoices(quiz) {
    const normalized = quiz.choices.map(choice => normalizeChoice(choice, quiz.topic));
    return new Set(normalized).size !== normalized.length;
}

function autoFixQuiz(quiz) {
    if (!quiz || !Array.isArray(quiz.choices)) return quiz;

    quiz.choices = quiz.choices.map(c => 
        String(c || '').trim().replace(/^["'`]|["'`]$/g, '').replace(/\*\*(.*?)\*\*/g, '$1').trim()
    );

    if (quiz.correctAnswerText) {
        quiz.correctAnswerText = String(quiz.correctAnswerText)
            .trim()
            .replace(/^["'`]|["'`]$/g, '')
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .trim();
    }

    const textIndex = quiz.choices.findIndex(choice => choice === quiz.correctAnswerText);
    if (textIndex !== -1) {
        quiz.correctAnswerIndex = textIndex;
        quiz.correctAnswerText = quiz.choices[textIndex];
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

function extractJsonFromText(text) {
    if (typeof text !== "string") throw new Error("응답이 문자열이 아닙니다.");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) throw new Error("JSON 객체를 찾지 못했습니다.");
    return text.slice(start, end + 1).trim();
}

async function fetchNewQuizData() {
    if (!MISTRAL_API_KEY) {
        console.error("[ERROR] MISTRAL_API_KEY 환경변수가 설정되지 않았습니다.");
        return false;
    }

    const selectedTopics = getSelectedTopics();
    console.log(`[API] PRD 모듈 기반 퀴즈 생성 요청 중... (분야: ${selectedTopics.join(', ')})`);

    for (let generationAttempt = 1; generationAttempt <= 2; generationAttempt++) {
        try {
            const payload = createQuizPayload(selectedTopics);
            const response = await axios.post(API_URL, payload, {
                headers: {
                    'Authorization': `Bearer ${MISTRAL_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 70000
            });
            
            const message = response.data?.choices?.[0]?.message;
            if (!message?.content) throw new Error("API 응답 내용이 비어있습니다.");

            let rawContent = message.content;
            if (Array.isArray(rawContent)) {
                const textPart = rawContent.find(p => p.type === "text" && typeof p.text === "string");
                rawContent = textPart?.text;
            }

            const cleanJson = extractJsonFromText(rawContent);
            const parsed = JSON.parse(cleanJson);
            const rawQuizzes = parsed.quizzes || (Array.isArray(parsed) ? parsed : null);

            if (!Array.isArray(rawQuizzes) || rawQuizzes.length !== 5) {
                throw new Error(`퀴즈 개수 오류 (기대값 5개, 수신 ${rawQuizzes?.length}개)`);
            }

            const processedQuizzes = [];
            const topicSet = new Set();

            for (let quiz of rawQuizzes) {
                quiz = autoFixQuiz(quiz);

                // 1. 한자 / 금지 언어 포함 여부 검증
                const fullText = [quiz.question, ...quiz.choices, quiz.explanation, quiz.correctAnswerText].join(" ");
                if (HANJA_AND_FOREIGN_REGEX.test(fullText)) {
                    throw new Error("금지된 한자/외국 문자 포함");
                }

                // 2. 한글 맞춤법 전용 오답 DB 대조
                if (quiz.topic === "한글 맞춤법" && SPELLING_REGEX.test(quiz.choices.join(" "))) {
                    throw new Error("한글 맞춤법 금지 오답 패턴 발견");
                }

                // 3. 필드 및 구조 검증
                if (!quiz.topic || !quiz.question || !Array.isArray(quiz.choices) || 
                    !quiz.correctAnswerText || typeof quiz.correctAnswerIndex !== "number" || !quiz.explanation) {
                    throw new Error("필수 필드 누락");
                }

                if (hasDuplicateChoices(quiz) || quiz.choices.some(c => !c)) {
                    throw new Error("보기 중복 또는 빈 보기 발견");
                }

                if (quiz.correctAnswerIndex < 0 || quiz.correctAnswerIndex > 3 || 
                    quiz.choices[quiz.correctAnswerIndex] !== quiz.correctAnswerText) {
                    throw new Error("정답 인덱스/텍스트 불일치");
                }

                // 4. 해설 첫 문장 "정답은 {correctAnswerText}입니다." 확인
                if (!quiz.explanation.trim().startsWith(`정답은 ${quiz.correctAnswerText}입니다.`)) {
                    throw new Error("해설 규격 미달 ('정답은 {text}입니다.'로 시작하지 않음)");
                }

                if (!selectedTopics.includes(quiz.topic) || topicSet.has(quiz.topic)) {
                    throw new Error(`분야 오류 또는 중복 분야: ${quiz.topic}`);
                }

                topicSet.add(quiz.topic);
                processedQuizzes.push(quiz);
            }

            // 보기 셔플 및 정답 인덱스 재계산
            processedQuizzes.forEach((quiz, idx) => {
                const answer = quiz.choices[quiz.correctAnswerIndex];
                shuffleArray(quiz.choices, `${Date.now()}_${idx}`);
                quiz.correctAnswerIndex = quiz.choices.indexOf(answer);
                quiz.correctAnswerText = answer;
            });

            MASTER_QUIZ_DATA = processedQuizzes.map((q, idx) => ({ ...q, id: Date.now() + idx }));
            LAST_FETCH_TIME = Date.now();
            LAST_TOPICS = [...selectedTopics];
            console.log(`[API] PRD 생성 및 내부 검증 완료 (${MASTER_QUIZ_DATA.length}개)`);
            return true;
        } catch (error) {
            console.error(`[DATA ERROR] 생성 시도 ${generationAttempt}/2 실패:`, error.message);
            if (generationAttempt === 2) return false;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

async function ensureDataFreshness() {
    if (MASTER_QUIZ_DATA.length === 0 || (Date.now() - LAST_FETCH_TIME) > ONE_HOUR) {
        if (!fetchPromise) {
            fetchPromise = fetchNewQuizData().finally(() => {
                fetchPromise = null;
            });
        }
        await fetchPromise;
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
        const sortedQuestions = [...dailyQuiz].sort((a, b) => a.id - b.id);
        return res.status(200).json(sanitizeQuizData(sortedQuestions));
    } catch (error) {
        return res.status(500).json({ errorCode: "SERVER_ERROR" });
    }
});

app.get('/api/answer-key', async (req, res) => {
    await ensureDataFreshness();
    if (MASTER_QUIZ_DATA.length === 0) {
        return res.status(503).json({ errorCode: "DATA_UNAVAILABLE", message: "퀴즈 데이터를 불러올 수 없습니다." });
    }
    
    try {
        const dailyQuiz = getDailyQuestions(5, MASTER_QUIZ_DATA);
        const sortedQuestions = [...dailyQuiz].sort((a, b) => a.id - b.id);
        
        const answerKey = sortedQuestions.reduce((acc, q) => {
            if (typeof q.id === 'number' && Number.isInteger(q.correctAnswerIndex)) {
                acc[q.id] = q.correctAnswerIndex;
            }
            return acc;
        }, {});
        
        return res.status(200).json(answerKey);
    } catch (e) {
        return res.status(500).json({ errorCode: "SERVER_ERROR" });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
