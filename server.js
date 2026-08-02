const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const seedrandom = require('seedrandom');

const app = express();
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

const MODEL_ID = "ministral-8b-latest";
const API_URL = "https://api.mistral.ai/v1/chat/completions";

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

        response_format: {
            type: "json_object"
        },

        messages: [
            {
                role: "system",
                content: `
You generate valid JSON only.

Rules:
- Output only JSON.
- Do not use markdown.
- Do not use code fences.
- Do not add explanations.
- Do not add text before or after the JSON.
`
            },
            {
                role: "user",
                content: `선택된 5개 분야(${selectedTopics.join(', ')})에서 각각 1문제씩 총 5개의 상식 퀴즈를 생성하세요.

필수 규칙:
1. 선택된 5개 분야 각각 정확히 1문제씩 출제 (총 5문제).
2. 한글 맞춤법 문제는 2026년 현행 표준 규정 기준.
3. 코딩 문제는 코드 내용을 포함할 수 있지만, 마크다운 코드 블록은 사용하지 말고 일반 문자열 형태로 작성.
4. choices는 정확히 4개 작성.
5. correctAnswerText는 choices 배열 중 하나와 완벽히 일치.
6. correctAnswerIndex는 정답의 인덱스(0~3).
7. explanation은 "정답은 [correctAnswerText]입니다."로 시작하고 최대 3문장 이내로 정답 이외의 나머지 선택지가 틀린 이유도 작성.
8. 최종 출력 전에 각 문제를 내부 검토한다:
- 정답이 실제 사실과 일치하는가?
- 보기 중 정답이 여러 개 존재하지 않는가?
- 해설 내용이 정답 및 사실과 일치하는가?
- 해설에 언급된 정답이 correctAnswerText와 정확히 같은가?
- 질문의 조건(최초, 최대, 유일, 천연, 현행 등)이 정답과 모순되지 않는가?

검토 결과 오류가 발견된 문제는 폐기하고 올바른 문제로 다시 생성한다.
검토 과정은 출력하지 말고 최종 JSON만 반환한다.

응답 형식:

{
  "quizzes": [
    {
      "topic": "분야명",
      "question": "문제",
      "choices": ["보기1", "보기2", "보기3", "보기4"],
      "correctAnswerIndex": 0,
      "correctAnswerText": "보기1",
      "explanation": "정답은 보기1입니다."
    }
  ]
}`
            }
        ],

        temperature: 0.1,
        max_tokens: 2300
    };
}


function autoFixQuiz(quiz) {
    if (!Array.isArray(quiz.choices)) return quiz;

    if (quiz.correctAnswerText) {
        const textIndex = quiz.choices.findIndex(
            choice =>
                choice &&
                choice.trim() === quiz.correctAnswerText.trim()
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
    if (typeof text !== "string") {
        throw new Error("응답이 문자열이 아닙니다.");
    }

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1 || end < start) {
        throw new Error("JSON 객체를 찾지 못했습니다.");
    }

    return text.slice(start, end + 1).trim();
}


async function validateQuizAccuracy(quizzes) {
    const payload = {
        model: MODEL_ID,

        response_format: {
            type: "json_object"
        },

        messages: [
            {
                role: "system",
                content: `
너는 상식 퀴즈 검증 전문가다.

주어진 퀴즈들을 검사하고 사실 오류가 있는지 판단한다.

반드시 다음을 검증한다.

1. 질문 전제 검증
- 질문 자체가 성립하는가?
- 존재하지 않는 개념이나 잘못된 비교 기준이 없는가?
- "최초", "최대", "가장", "유일", "천연" 같은 조건이 사실과 맞는가?

2. 정답 검증
- correctAnswerText가 실제 정답인가?
- choices 중 다른 정답이 가능한 경우가 없는가?

3. 해설 검증
- 해설 내용이 사실과 일치하는가?
- 해설이 정답과 모순되지 않는가?
- 잘못된 정보를 포함하지 않는가?

하나라도 오류가 있으면 valid를 false로 한다.

출력은 반드시 JSON만 작성한다.

형식:
{
  "valid": true
}
`
            },
            {
                role: "user",
                content: JSON.stringify(quizzes)
            }
        ],

        temperature: 0,
        max_tokens: 50
    };

    try {
        const response = await axios.post(API_URL, payload, {
            headers: {
                "Authorization": `Bearer ${MISTRAL_API_KEY}`,
                "Content-Type": "application/json"
            },
            timeout: 30000
        });

        const content = response.data?.choices?.[0]?.message?.content;

        if (!content) {
            throw new Error("검증 응답 없음");
        }

        const result = JSON.parse(content);

        return result.valid === true;

    } catch (error) {
        console.error(
            "[ACCURACY VALIDATION ERROR]",
            error.response?.data || error.message
        );

        // 검증 실패 시 안전하게 차단
        return false;
    }
}

async function fetchNewQuizData() {
    if (!MISTRAL_API_KEY) {
        console.error("[ERROR] MISTRAL_API_KEY 환경변수가 설정되지 않았습니다.");
        return false;
    }

    const selectedTopics = getSelectedTopics();
console.log(`[API] 퀴즈 생성 요청 중... (분야: ${selectedTopics.join(', ')})`);

for (let generationAttempt = 1; generationAttempt <= 2; generationAttempt++) {
    
    try {
        const payload = createQuizPayload(selectedTopics);
        let response;

for (let attempt = 1; attempt <= 2; attempt++) {
    try {
        response = await axios.post(API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${MISTRAL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        break;

    } catch (error) {

        console.error(
            `[MISTRAL ERROR] 시도 ${attempt}/2`,
            error.response?.data || error.message
        );

        if (attempt === 2) {
            throw error;
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}
        
        const message = response.data?.choices?.[0]?.message;
        if (!message || !message.content) {
            throw new Error("API 응답 내용이 비어있습니다.");
        }

        const rawContent = message.content;

console.log("[MISTRAL RAW RESPONSE]");
console.log(rawContent);

const cleanJson = extractJsonFromText(rawContent);

let parsed;

try {
    parsed = JSON.parse(cleanJson);
} catch (jsonError) {
    console.error("[JSON PARSE ERROR]");
    console.error(cleanJson);
    throw jsonError;
}
        const rawQuizzes = parsed.quizzes || (Array.isArray(parsed) ? parsed : null);

if (!Array.isArray(rawQuizzes) || rawQuizzes.length !== 5) {
    throw new Error(`퀴즈 개수 오류: ${rawQuizzes?.length}`);
}
        const topicSet = new Set();
       for (const quiz of rawQuizzes) {

    if (!quiz.topic ||
        !quiz.question ||
        !Array.isArray(quiz.choices) ||
        !quiz.correctAnswerText ||
        typeof quiz.correctAnswerIndex !== "number" ||
        !quiz.explanation) {

        throw new Error("퀴즈 필수 필드 누락");
    }


    if (quiz.choices.length !== 4) {
        throw new Error("보기 개수 오류");
    }

    if (new Set(quiz.choices).size !== 4) {
    throw new Error("보기 중복 오류");
}

    if (quiz.choices.some(choice => !choice || !choice.trim())) {
    throw new Error("빈 보기 발견");
}


    if (
        quiz.correctAnswerIndex < 0 ||
        quiz.correctAnswerIndex > 3
    ) {
        throw new Error("정답 인덱스 오류");
    }


    if (!quiz.choices.includes(quiz.correctAnswerText)) {
        throw new Error("정답 텍스트 불일치");
    }

    const explanationStart = quiz.explanation
    .replace(/^정답은\s*/, "")
    .trim();

const answerText = quiz.correctAnswerText
    .replace(/^['"]|['"]$/g, "")
    .trim();

if (!explanationStart.startsWith(answerText)) {
    throw new Error("해설 형식 오류");
}

    if (!selectedTopics.includes(quiz.topic)) {
    throw new Error(`잘못된 분야: ${quiz.topic}`);
}

if (topicSet.has(quiz.topic)) {
    throw new Error(`중복 분야: ${quiz.topic}`);
}

topicSet.add(quiz.topic);  
}

        const accuracyValid = await validateQuizAccuracy(rawQuizzes);

if (!accuracyValid) {
    throw new Error("질문 전제 또는 사실 검증 실패");
}      
        MASTER_QUIZ_DATA = rawQuizzes.map((q, idx) => {
    const fixed = autoFixQuiz(q);

    if (fixed.choices[fixed.correctAnswerIndex] !== fixed.correctAnswerText) {
        throw new Error("최종 정답 인덱스 불일치");
    }

    return { ...fixed, id: Date.now() + idx };
});

        LAST_FETCH_TIME = Date.now();
        console.log(`[API] 퀴즈 ${MASTER_QUIZ_DATA.length}개 생성 완료`);
        return true;
    } catch (error) {
    console.error(
        `[DATA ERROR] 퀴즈 생성 실패 ${generationAttempt}/2:`,
        error.response?.data || error.message
    );

    if (generationAttempt === 2) {
        return false;
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
}
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
