const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const seedrandom = require('seedrandom');

const app = express();
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

// 모델명을 변경해 테스트해보세요
const MODEL_ID = "mistral-small-latest";

const API_URL = "https://api.mistral.ai/v1/chat/completions";

const ONE_HOUR = 3600000; 

let MASTER_QUIZ_DATA = []; 
let LAST_FETCH_TIME = 0;
const SPELLING_DATA = [
{correct:"할 일",wrong:["할일"],category:"띄어쓰기"},
{correct:"할 수 있다",wrong:["할수있다"],category:"띄어쓰기"},
{correct:"한 번",wrong:["한번"],category:"띄어쓰기"},
{correct:"몇 가지",wrong:["몇가지"],category:"띄어쓰기"},
{correct:"것 같다",wrong:["것같다"],category:"띄어쓰기"},
{correct:"뿐만 아니라",wrong:["뿐만아니라"],category:"띄어쓰기"},
{correct:"할 수밖에 없다",wrong:["할수밖에없다"],category:"띄어쓰기"},
{correct:"곧바로",wrong:["곧 바로"],category:"띄어쓰기"},
{correct:"몇몇",wrong:["몇 몇"],category:"띄어쓰기"},

{correct:"할 만하다",wrong:["할만하다"],category:"의존 명사"},
{correct:"될 법하다",wrong:["될법하다"],category:"의존 명사"},
{correct:"아는 체하다",wrong:["아는체하다"],category:"의존 명사"},
{correct:"올 듯하다",wrong:["올듯하다"],category:"의존 명사"},
{correct:"뿐이다",wrong:["뿐 이다"],category:"의존 명사"},

{correct:"되겠다",wrong:["되갯다","되겟다","돼겠다","됬겠다","돼갰다"],category:"어미 활용"},
{correct:"됐다",wrong:["됬다"],category:"어미 활용"},
{correct:"안 돼",wrong:["안되"],category:"어미 활용"},
{correct:"돼서",wrong:["되서"],category:"어미 활용"},

{correct:"하려고",wrong:["할려고"],category:"어미"},
{correct:"할게",wrong:["할께"],category:"어미"},

{correct:"웬일",wrong:["왠일"],category:"표기"},
{correct:"어이없다",wrong:["어의없다"],category:"표기"},
{correct:"금세",wrong:["금새"],category:"표기"},
{correct:"며칠",wrong:["몇일"],category:"표기"},
{correct:"오랜만",wrong:["오랫만"],category:"표기"},
{correct:"설거지",wrong:["설겆이"],category:"표기"},
{correct:"오랫동안",wrong:["오랜동안"],category:"표기"},
{correct:"따뜻하다",wrong:["따듯하다"],category:"표기"},

{correct:"나뭇잎",wrong:["나무잎"],category:"사이시옷"},
{correct:"고깃집",wrong:["고기집"],category:"사이시옷"},
{correct:"전셋집",wrong:["전세집"],category:"사이시옷"},
{correct:"장맛비",wrong:["장마비"],category:"사이시옷"},
{correct:"뒷받침",wrong:["뒤받침"],category:"사이시옷"},
{correct:"머리말",wrong:["머릿말"],category:"사이시옷"},

{correct:"해 버리다",wrong:["해버리다"],category:"보조 용언"},
{correct:"가 버리다",wrong:["가버리다"],category:"보조 용언"},
{correct:"깨뜨려 버리다",wrong:["깨뜨려버리다"],category:"보조 용언"},
{correct:"알아 두다",wrong:["알아두다"],category:"보조 용언"}
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

function getSelectedTopics() {
    const shuffled = [...ALL_TOPICS].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 5);
}

function createQuizPayload(selectedTopics) {
    return {
        model: MODEL_ID,

        response_format: {
            type: "json_schema",
            json_schema: {
                name: "quiz_response",
                strict: true,
                schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["quizzes"],
                    properties: {
                        quizzes: {
                            type: "array",
                            minItems: 5,
                            maxItems: 5,
                            items: {
                                type: "object",
                                additionalProperties: false,
                                required: [
                                    "topic",
                                    "question",
                                    "choices",
                                    "correctAnswerIndex",
                                    "correctAnswerText",
                                    "explanation"
                                ],
                                properties: {
                                    topic: {
                                        type: "string"
                                    },
                                    question: {
                                        type: "string"
                                    },
                                    choices: {
                                        type: "array",
                                        minItems: 4,
                                        maxItems: 4,
                                        items: {
                                            type: "string"
                                        }
                                    },
                                    correctAnswerIndex: {
                                        type: "integer",
                                        minimum: 0,
                                        maximum: 3
                                    },
                                    correctAnswerText: {
                                        type: "string"
                                    },
                                    explanation: {
                                        type: "string"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },

        messages: [
            {
                role: "system",
                content: `
너는 상식 퀴즈 출제 전문가다.

반드시 JSON Schema 구조를 준수한다.

규칙:
- JSON 외의 텍스트를 출력하지 않는다.
- 마크다운을 사용하지 않는다.
- 코드 블록을 사용하지 않는다.
- 생성 과정이나 검토 과정은 출력하지 않는다.

출제 기준:
- 역사/학술/뉴스 등에 존재하는 공식 명칭과 객관적 사실만 사용한다.
- 뻔한 기초 상식보다 검증 가능한 중간 난이도 문제를 우선한다.
`
            },
            {
                role: "user",
                content: `
선택된 5개 분야:
${selectedTopics.join(", ")}

각 분야마다 정확히 1문제씩 총 5개의 퀴즈를 생성하세요.

필수 규칙:

1. 선택된 분야별 문제 수는 정확히 1개다.

2. 한글 맞춤법 문제:
- 2026년 현행 표준 규정 기준.
- 괄호 설명, 추가 부연 설명 금지.
- 띄어쓰기 문제는 각 선택지가 실제 사용 가능한 표현이어야 한다.
- 선택지는 정답과 오답을 명확히 구분할 수 있도록 구성한다.
- 필요 이상으로 의미가 다른 표현을 섞어 정답 판별을 어렵게 만들지 않는다.

3. 코딩 문제:
- 코드 작성 가능.
- 마크다운 코드 블록 금지.
- 일반 문자열로 작성.

4. choices:
- 반드시 4개.
- 모든 선택지는 서로 달라야 한다.
- 정답 외에도 그럴듯한 오답을 작성한다.

5. 정답:
- correctAnswerText는 choices 중 하나와 글자 하나까지 동일해야 한다.
- correctAnswerIndex는 correctAnswerText 위치와 일치해야 한다.

6. explanation:
- 최대 3문장.
- 반드시 첫 문장은 아래 형식:
정답은 {correctAnswerText}입니다.
- {correctAnswerText}는 choices의 실제 문자열과 완전히 동일해야 한다.
- 이후 오답 선택지가 틀린 이유를 설명한다.

7. 생성 전 내부 검토:
- 질문 전제가 성립하는가?
- "최초", "최대", "가장", "유일", "현행" 조건이 사실과 일치하는가?
- 시간 조건이 있으면 실제 발생 시점과 비교한다.
- 보기 중 복수 정답 가능성이 없는가?
- explanation이 사실과 일치하는가?

오류가 발견된 문제는 수정 후 출력한다.
검토 과정은 출력하지 않는다.
`
            }
        ],

        reasoning_effort: "high",

        temperature: 0.25,

        max_tokens: 4200
    };
}

function validateSpellingQuiz(quiz) {
    const text = [
        quiz.question,
        ...quiz.choices,
        quiz.explanation
    ].join(" ");

    return !SPELLING_REGEX.test(text);
}

// 📌 보정 로직 개선된 autoFixQuiz
function autoFixQuiz(quiz) {
    if (!quiz || !Array.isArray(quiz.choices)) return quiz;

    // 1. 모든 보기의 양끝 공백, 양끝 따옴표, 마크다운(**) 제거
    quiz.choices = quiz.choices.map(c => 
        String(c || '').trim().replace(/^["'`]|["'`]$/g, '').replace(/\*\*(.*?)\*\*/g, '$1').trim()
    );

    // 2. correctAnswerText도 동일하게 정제
    if (quiz.correctAnswerText) {
        quiz.correctAnswerText = String(quiz.correctAnswerText)
            .trim()
            .replace(/^["'`]|["'`]$/g, '')
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .trim();
    }

    // 3. 텍스트 기준으로 인덱스 재설정 (우선순위 1)
    const textIndex = quiz.choices.findIndex(
        choice => choice === quiz.correctAnswerText
    );

    if (textIndex !== -1) {
        quiz.correctAnswerIndex = textIndex;
        quiz.correctAnswerText = quiz.choices[textIndex]; // 토씨 하나 안 틀리게 원본과 일치
    } 
    // 4. 텍스트 매칭 안 되면 인덱스 기준으로 텍스트 재설정 (우선순위 2)
    else if (
    typeof quiz.correctAnswerIndex === 'number' &&
    quiz.correctAnswerIndex >= 0 &&
    quiz.correctAnswerIndex < 4
) {
    // index는 유지하지만 correctAnswerText는 덮어쓰지 않음
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

1-1. 시대 범위 표현 규칙:
- "세기 초반"은 해당 세기의 00년~33년으로 해석한다.
- "세기 중반"은 해당 세기의 34년~66년으로 해석한다.
- "세기 후반"은 해당 세기의 67년~99년으로 해석한다.
- **조선 후기 = 임진왜란 이후~대한제국 성립 전후(일반적으로 17세기 이후~19세기 말)**
- 질문에 시간 조건이 포함된 경우 정답의 실제 발생 시점과 반드시 비교한다.
- 시간 범위를 벗어난 정답은 오류이므로 false로 반환한다.

2. 정답 검증
- correctAnswerText가 실제 정답인지 확인한다.
- choices 전체를 검토하여 질문 조건에 맞는 정답이 오직 하나만 존재하는지 확인한다.
- correctAnswerText 외에 다른 choice가 정답이 될 수 있으면 false로 한다.
- correctAnswerText가 틀렸거나, 보기 안에 올바른 정답이 없으면 false로 한다.

3. 해설 검증
일반 topic:
- explanation 첫 문장이 정답 설명과 일치하는지 확인한다.
- 첫 문장에 사실 오류나 부정확한 정보가 있으면 false 반환한다.

단, topic이 "한글 맞춤법"인 경우:
- 위 검증에 추가하여 아래 항목을 모두 검증한다.
- correctAnswerText의 맞춤법과 띄어쓰기가 올바른지 확인한다.
- 보기 자체의 표기가 올바른지 확인한다.
- explanation 전체에서 맞춤법 설명 오류가 있는지 확인한다.
- 표준 맞춤법 기준으로 판단한다.


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

        temperature: 0.1,
        max_tokens: 1000
    };

    try {
        const response = await axios.post(API_URL, payload, {
            headers: {
                "Authorization": `Bearer ${MISTRAL_API_KEY}`,
                "Content-Type": "application/json"
            },
            timeout: 60000
        });

        const content = response.data?.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error("검증 응답 없음");
        }
        const cleanJson = extractJsonFromText(content); // 마크다운 제거 후 JSON만 추출
        const result = JSON.parse(cleanJson);

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
                        timeout: 60000
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

            let rawContent = message.content;

            if (Array.isArray(rawContent)) {
                const textPart = rawContent.find(
                    part => part.type === "text" && typeof part.text === "string"
                );

                rawContent = textPart?.text;
            }

            console.log("[MISTRAL RAW RESPONSE]");
            console.log(rawContent);

            if (!rawContent || typeof rawContent !== "string") {
                throw new Error("응답 텍스트 없음");
            }

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

            // 📌 [통합] 보정 후 검증 수행
            const processedQuizzes = [];
            const topicSet = new Set();

            for (let quiz of rawQuizzes) {
                // 📌 [핵심] 검증 시작하기 전에 먼저 보정부터 수행
                quiz = autoFixQuiz(quiz);

                if (quiz.topic === "한글 맞춤법") {
                  if (!validateSpellingQuiz(quiz)) {
                     throw new Error("한글 맞춤법 오류 발견");
                      }
                }

                // 1. 필수 필드 및 개수 검사
                if (!quiz.topic || !quiz.question || !Array.isArray(quiz.choices) || 
                    !quiz.correctAnswerText || typeof quiz.correctAnswerIndex !== "number" || !quiz.explanation) {
                    throw new Error("퀴즈 필수 필드 누락");
                }

                if (quiz.choices.length !== 4) throw new Error("보기 개수 오류");
                if (new Set(quiz.choices).size !== 4) throw new Error("보기 중복 또는 빈 보기 오류");
                if (quiz.choices.some(c => !c)) throw new Error("빈 보기 발견");

                if (quiz.correctAnswerIndex < 0 || quiz.correctAnswerIndex > 3) {
                    throw new Error("정답 인덱스 범위 오류");
                }

                // 📌 보정 후 완벽히 일치하는지 최종 확인
                if (quiz.choices[quiz.correctAnswerIndex] !== quiz.correctAnswerText) {
                    throw new Error("정답 텍스트/인덱스 불일치");
                }

                // 해설 시작 형식 검증 (정답 텍스트 포함 확인)
                const compareAnswer = quiz.correctAnswerText
                    .replace(/\s*\([^)]*\)/g, "")
                    .replace(/[.!?。？！]$/, "")
                    .trim();
                const compareExplanation = quiz.explanation
                    .replace(/^정답은\s*/, "")
                    .trim();

                const normalize = (text) =>
                    text
                        .replace(/[.]/g, "")
                        .replace(/합니다/g, "한다")
                        .trim();
                
                if (!normalize(compareExplanation).startsWith(normalize(compareAnswer))) {
                    throw new Error(`해설 형식 오류: (정답: ${quiz.correctAnswerText} / 해설: ${quiz.explanation})`);
                }

                 //if (!compareExplanation.startsWith(compareAnswer)) ///{///
                         //throw new Error(`해설 형식 오류: (정답: ${quiz.correctAnswerText} / 해설: ${quiz.explanation})`);//
                      //}
                
                //if (!cleanExplanation.startsWith(cleanAnswer)) {
                    //throw new Error
                //

                // 2. 분야 중복 검사
                if (!selectedTopics.includes(quiz.topic)) throw new Error(`잘못된 분야: ${quiz.topic}`);
                if (topicSet.has(quiz.topic)) throw new Error(`중복 분야: ${quiz.topic}`);

                topicSet.add(quiz.topic);
                processedQuizzes.push(quiz);
            }

            // 보정 및 정제 완료된 processedQuizzes로 교제/사실 검증
            const accuracyValid = await validateQuizAccuracy(
                processedQuizzes.map(q => ({
                    ...q,
                    explanation:
                        q.topic === "한글 맞춤법"
                            ? q.explanation
                            : q.explanation.match(/^.*?입니다\./)?.[0] || q.explanation
                }))
            );

            if (!accuracyValid) {
                throw new Error("질문 전제 또는 사실 검증 실패");
            }      

            MASTER_QUIZ_DATA = processedQuizzes.map((q, idx) => {
                return { ...q, id: Date.now() + idx };
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
