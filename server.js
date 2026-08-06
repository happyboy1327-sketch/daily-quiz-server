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
  // [띄어쓰기]
  { correct: "할 일", wrong: ["할일"], category: "띄어쓰기" },
  { correct: "몇 가지", wrong: ["몇가지"], category: "띄어쓰기" },
  { correct: "것 같다", wrong: ["것같다"], category: "띄어쓰기" },
  { correct: "뿐만 아니라", wrong: ["뿐만아니라"], category: "띄어쓰기" },
  { correct: "할 수밖에 없다", wrong: ["할수밖에없다"], category: "띄어쓰기" },
  { correct: "곧바로", wrong: ["곧 바로"], category: "띄어쓰기" },
  { correct: "몇몇", wrong: ["몇 몇"], category: "띄어쓰기" },
  { correct: "맡아서 하다", wrong: ["맡아서하다"], category: "띄어쓰기" },

  // [의존 명사 - 띄어쓰기 필수 항목들]
  { correct: "할 수 있다", wrong: ["할수있다"], category: "의존 명사" },
  { correct: "먹은 지 오래되었다", wrong: ["먹은지 오래되었다"], category: "의존 명사" },
  { correct: "아는 만큼", wrong: ["아는만큼"], category: "의존 명사" },
  { correct: "김철수 씨", wrong: ["김철수씨"], category: "의존 명사" },
  { correct: "뿐이다", wrong: ["뿐 이다"], category: "의존 명사" },

  // [조사 - 붙여쓰기 필수 항목들]
  { correct: "학교에서만이라도", wrong: ["학교 에서 만 이라도", "학교에서 만이라도"], category: "조사" },

  // [보조 용언 - 붙여쓰기가 규정상 절대 금지되는 케이스들]
  { correct: "읽어도 보고", wrong: ["읽어도보고"], category: "보조 용언" },
  { correct: "떠내려가 버리다", wrong: ["떠내려가버리다"], category: "보조 용언" },
  { correct: "깨뜨려 버리다", wrong: ["깨뜨려버리다"], category: "보조 용언" },

  // [어미 활용]
  { correct: "되겠다", wrong: ["되갯다", "되겟다", "돼겠다", "됬겠다", "돼갰다"], category: "어미 활용" },
  { correct: "됐다", wrong: ["됬다"], category: "어미 활용" },
  { correct: "안 돼", wrong: ["안되"], category: "어미 활용" },
  { correct: "돼서", wrong: ["되서"], category: "어미 활용" },
  { correct: "하려고", wrong: ["할려고"], category: "어미" },
  { correct: "할게", wrong: ["할께"], category: "어미" },

  // [표기 / 맞춤법]
  { correct: "웬일", wrong: ["왠일"], category: "표기" },
  { correct: "어이없다", wrong: ["어의없다"], category: "표기" },
  { correct: "금세", wrong: ["금새"], category: "표기" },
  { correct: "며칠", wrong: ["몇일"], category: "표기" },
  { correct: "오랜만", wrong: ["오랫만"], category: "표기" },
  { correct: "설거지", wrong: ["설겆이"], category: "표기" },
  { correct: "오랫동안", wrong: ["오랜동안"], category: "표기" },
  { correct: "깨끗이", wrong: ["깨끗히"], category: "표기" },

  // [사이시옷]
  { correct: "나뭇잎", wrong: ["나무잎"], category: "사이시옷" },
  { correct: "고깃집", wrong: ["고기집"], category: "사이시옷" },
  { correct: "전셋집", wrong: ["전세집"], category: "사이시옷" },
  { correct: "장맛비", wrong: ["장마비"], category: "사이시옷" },
  { correct: "뒷받침", wrong: ["뒤받침"], category: "사이시옷" },
  { correct: "머리말", wrong: ["머릿말"], category: "사이시옷" },
  { correct: "어젯밤", wrong: ["어제 밤", "어제밤"], category: "사이시옷" }
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

function extractJsonFromText(text) {
    if (typeof text !== "string") throw new Error("응답이 문자열이 아닙니다.");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) throw new Error("JSON 객체를 찾지 못했습니다.");
    return text.slice(start, end + 1).trim();
}

/**
 * 단일 문항 팩트체크 (초고속 병렬 처리용)
 */
async function validateSingleQuiz(quiz) {
    const payload = {
        model: "mistral-small-latest",
        response_format: { type: "json_object" },
        messages: [
            {
                role: "system",
                content: `
너는 정확성과 신뢰성을 우선으로 검증하는 상식 퀴즈 검사원이다.
주어진 단일 퀴즈(1개)의 사실 관계 및 오류를 엄격하게 판단한다.

[검증 기준]
1. 질문 전제 검증
- 질문 자체가 성립하는가?
- 존재하지 않는 개념이나 잘못된 비교 기준이 없는가?
- "최초", "최대", "가장", "유일" 등 비교·최상급 조건이나 "천연" 같은 분류 조건이 사실과 맞는가?
- 정답이 여러 개가 될 가능성이 있으면 false로 한다.

1-1. 시대 범위 표현 규칙:
- "세기 초반": 해당 세기의 00년~33년
- "세기 중반": 해당 세기의 34년~66년
- "세기 후반": 해당 세기의 67년~99년
- 조선 후기 = 임진왜란 이후~대한제국 성립 전후(17세기 이후~19세기 말)
- 질문에 시간 조건이 포함된 경우 정답의 실제 발생 시점과 비교하여 벗어나면 false로 한다.

2. 정답 검증
- correctAnswerText가 실제 정답인지 확인한다.
- choices 전체를 검토하여 질문 조건에 맞는 정답이 오직 하나만 존재하는지 확인한다.
- correctAnswerText 외에 다른 choice가 정답이 될 수 있으면 false로 한다.
- correctAnswerText가 틀렸거나, 보기 안에 올바른 정답이 없으면 false로 한다.

3. 해설 검증
- 해설의 사실 정보가 객관적 사실과 일치하는지 확인한다.
- topic이 "한글 맞춤법"인 경우, 표준 맞춤법 및 표준 발음법 기준으로 발음/맞춤법 설명이 정확한지 엄격히 검증한다.

오류 발견 시 valid를 false로 하고 reason에 구체적 사유를 명시한다.

[출력 형식 (JSON)]
{
  "valid": true | false,
  "reason": "오류 내용 (valid가 true면 빈 문자열)"
}
`
            },
            {
                role: "user",
                content: JSON.stringify(quiz)
            }
        ],
        temperature: 0.1,
        max_tokens: 1000
    };

    try {
        const response = await axios.post(API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${MISTRAL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        const rawContent = response.data?.choices?.[0]?.message?.content;
        const cleanJson = extractJsonFromText(rawContent);
        return JSON.parse(cleanJson);
    } catch (err) {
        return { valid: false, reason: `단일 문항 검증 통신 오류: ${err.message}` };
    }
}

/**
 * 5개 문항 병렬(Promise.all) 교차 검증
 */
async function validateQuizAccuracy(quizzes) {
    const results = await Promise.all(quizzes.map(quiz => validateSingleQuiz(quiz)));

    for (let i = 0; i < results.length; i++) {
        if (!results[i].valid) {
            return {
                valid: false,
                reason: `[${i + 1}번 문항 (${quizzes[i].topic})] ${results[i].reason}`
            };
        }
    }

    return { valid: true, reason: "" };
}

async function fetchNewQuizData() {
    if (!MISTRAL_API_KEY) {
        console.error("[ERROR] MISTRAL_API_KEY 환경변수가 설정되지 않았습니다.");
        return false;
    }

    const selectedTopics = getSelectedTopics();
    console.log(`[API] 퀴즈 생성 요청 중... (분야: ${selectedTopics.join(', ')})`);

    for (let generationAttempt = 1; generationAttempt <= 3; generationAttempt++) {
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

                // 4. 해설 첫 문장 정규화
                const targetPrefix = `정답은 ${quiz.correctAnswerText}입니다.`;
                const trimmedExp = quiz.explanation.trim();

                if (!trimmedExp.startsWith(targetPrefix)) {
                  const splitIndex = trimmedExp.indexOf('입니다.');
               if (splitIndex !== -1) {
                  const cleanExp = trimmedExp.slice(splitIndex + 4).trim();
                   quiz.explanation = `${targetPrefix} ${cleanExp}`;
    }
}

                if (!selectedTopics.includes(quiz.topic) || topicSet.has(quiz.topic)) {
                    throw new Error(`분야 오류 또는 중복 분야: ${quiz.topic}`);
                }

                topicSet.add(quiz.topic);
                processedQuizzes.push(quiz);
            }

            // 보기 셔플 및 정답 인덱스 재계산
            processedQuizzes.forEach((quiz, idx) => {
                const targetText = quiz.correctAnswerText;
                shuffleArray(quiz.choices, `${Date.now()}_${idx}`);

                let newIndex = quiz.choices.indexOf(targetText);
                if (newIndex === -1 && targetText) {
                    const cleanTarget = targetText.replace(/[\s\.]/g, '');
                    newIndex = quiz.choices.findIndex(c => c.replace(/[\s\.]/g, '') === cleanTarget);
                }

                if (newIndex !== -1) {
                    quiz.correctAnswerIndex = newIndex;
                    quiz.correctAnswerText = quiz.choices[newIndex];
                }
            });

            // 5. 문항별 병렬(Promise.all) 교차 검증 수행
            console.log(`[API] AI 2차 문항별 병렬 크로스 팩트체크 수행 중...`);
            const validation = await validateQuizAccuracy(processedQuizzes);
            if (!validation.valid) {
                throw new Error(`AI 교차 검증 실패: ${validation.reason}`);
            }

            MASTER_QUIZ_DATA = processedQuizzes.map((q, idx) => ({
                id: idx + 1,
                topic: q.topic,
                question: q.question,
                choices: q.choices,
                correctAnswerIndex: q.correctAnswerIndex,
                correctAnswerText: q.correctAnswerText,
                explanation: q.explanation
            }));
            
            LAST_FETCH_TIME = Date.now();
            LAST_TOPICS = [...selectedTopics];
            console.log(`[API] 퀴즈 생성 및 병렬 2차 검증 최종 승인 완료 (${MASTER_QUIZ_DATA.length}개)`);
            return true;
        } catch (error) {
            console.error(`[DATA ERROR] 시도 ${generationAttempt}/3 실패:`, error.message);
            if (generationAttempt === 3) return false;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

async function ensureDataFreshness() {
    // 이미 데이터가 유효하면 즉시 리턴
    if (MASTER_QUIZ_DATA.length > 0 && (Date.now() - LAST_FETCH_TIME) <= ONE_HOUR) {
        return;
    }

    // 이미 다른 요청이 데이터 fetching 중이라면 해당 프로미스를 함께 대기
    if (fetchPromise) {
        await fetchPromise;
        return;
    }

    // 락 생성 및 실행
    fetchPromise = (async () => {
        try {
            let success = false;
            let attempts = 0;
            // 실패하더라도 무한 루프가 돌지 않도록 상한선 설정
            while (!success && attempts < 2) {
                attempts++;
                success = await fetchNewQuizData();
            }
        } finally {
            fetchPromise = null;
        }
    })();

    await fetchPromise;
}

app.use(cors());
app.use(express.json());

app.get('/api/quiz', async (req, res) => {
    await ensureDataFreshness();
    if (MASTER_QUIZ_DATA.length === 0) {
        return res.status(503).json({ errorCode: "DATA_UNAVAILABLE" });
    }
    
    const sanitized = MASTER_QUIZ_DATA.map(({ correctAnswerIndex, ...q }) => q);
    return res.status(200).json(sanitized);
});

app.get('/api/answer-key', async (req, res) => {
    await ensureDataFreshness();
    if (MASTER_QUIZ_DATA.length === 0) {
        return res.status(503).json({ errorCode: "DATA_UNAVAILABLE" });
    }
    
    const answerKey = MASTER_QUIZ_DATA.reduce((acc, q) => {
        acc[q.id] = q.correctAnswerIndex;
        return acc;
    }, {});
    
    return res.status(200).json(answerKey);
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
