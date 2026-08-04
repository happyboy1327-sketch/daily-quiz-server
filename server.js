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
let LAST_TOPICS = [];

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
{correct:"어젯밤",wrong:["어제 밤", "어제밤"],category:"사이시옷"},

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
                
당신은 정확성과 신뢰성을 최우선으로 하는 전문 출제위원입니다.
제공된 5개 분야에 대해 객관적 사실에 기반한 중급 난도의 퀴즈를 각 1문제씩 출제하세요.

반드시 JSON Schema 구조를 준수한다.


[출제 원칙]
1. 질문의 범위와 판단 기준을 명확히 설정하여, 정답이 하나로 결정될 수 있도록 한다.
2. 공식 문서, 학술적 통설, 현행 규정 등 객관적으로 검증 가능한 정보만 사용한다.
3. 논란이 있거나 기준에 따라 답이 달라지는 내용, 지나치게 지엽적인 내용은 제외한다.
4. "최초", "유일", "가장", "최대" 등의 표현은 명확한 공식 기준이 있을 때만 사용한다.
5. 단순 암기보다 원리, 특징, 원인, 결과, 영향을 이해해야 풀 수 있는 문제를 우선한다.

[공통 규칙]
- 해설에는 검증되지 않은 추가 정보나 오류 가능성이 있는 내용을 포함하지 않는다.
- 질문과 해설의 모든 내용은 서로 모순되지 않아야 한다.

 `           },
            {
                role: "user",
                content: `
선택된 5개 분야:
${selectedTopics.join(", ")}

각 분야마다 정확히 1문제씩 총 5개의 퀴즈를 생성하세요.

필수 규칙:

1. 선택된 분야별 문제 수는 정확히 1개다.

2. 한글 맞춤법 문제:
- 현행 표준 규정 기준.
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
- [필수 규격] 첫 문장은 아래 <FORMAT>을 토시 하나, 공백 하나 바꾸지 말고 '완전히 똑같이' 시작해야 합니다.
     <FORMAT>: 정답은 {correctAnswerText}입니다.
- 반드시 <FORMAT>을 포함하여 4문장 이상 작성해야 한다.
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
    const text = quiz.choices.join(" ");

    return !SPELLING_REGEX.test(text);
}

const FOREIGN_SCRIPT_REGEX = /[\u0400-\u04FF]/;

function validateForeignScript(quiz) {
    if (!quiz) return false;

    const text = [
        quiz.question || "",
        ...(Array.isArray(quiz.choices) ? quiz.choices : []),
        quiz.explanation || "",
        quiz.correctAnswerText || ""
    ].join(" ");

    return !FOREIGN_SCRIPT_REGEX.test(text);
}

function normalizeChoice(choice, topic) {
    const text = String(choice || "").trim();

    // 한글 맞춤법은 내부 띄어쓰기가 의미이므로 유지
    if (topic === "한글 맞춤법") {
        return text;
    }

    // 일반 분야는 공백 차이만 다른 보기 방지
    return text.replace(/\s+/g, "");
}

function hasDuplicateChoices(quiz) {
    const normalized = quiz.choices.map(choice =>
        normalizeChoice(choice, quiz.topic)
    );

    return new Set(normalized).size !== normalized.length;
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
너는 정확성과 신뢰성을 우선으로 검증하는 상식 퀴즈 검사원이다.

주어진 퀴즈들을 검사하고 사실 오류가 있는지 판단한다.

반드시 다음을 검증한다.

1. 질문 전제 검증
- 질문 자체가 성립하는가?
- 질문의 범위와 판단 기준이 명확한가?
- 존재하지 않는 개념이나 잘못된 비교 기준이 없는가?
- "최초", "최대", "가장", "유일" 등 비교·최상급 조건이나 "천연" 같은 분류 조건이 사실과 맞는가?
- 정답이 여러 개가 될 가능성이 있으면 false로 한다.

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
- 첫 문장이 correctAnswerText를 정답으로 제시하는지 확인한다.
- 해설의 사실 정보가 객관적 사실과 일치하는지 확인한다.
- 검증되지 않은 추가 정보나 오류 가능성이 있는 내용이 있으면 false로 한다.

단, topic의 값이 "한글 맞춤법"인 경우:
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

                if (!validateForeignScript(quiz)) {
              throw new Error("허용되지 않는 외국 문자 발견");
                }

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

                if (hasDuplicateChoices(quiz)) {
                   throw new Error("보기 중복 또는 빈 보기 오류");
                 }
                
                if (quiz.choices.some(c => !c)) throw new Error("빈 보기 발견");

                if (quiz.correctAnswerIndex < 0 || quiz.correctAnswerIndex > 3) {
                    throw new Error("정답 인덱스 범위 오류");
                }

                // 📌 보정 후 완벽히 일치하는지 최종 확인
                if (quiz.choices[quiz.correctAnswerIndex] !== quiz.correctAnswerText) {
                    throw new Error("정답 텍스트/인덱스 불일치");
                }

                function getFirstSentence(text) {
                   return text.match(/^.*?[.!?。？！]/u)?.[0] || text;
                }

               function normalizeEnding(text) {
                          return text
                                   .trim()
                                   .replace(/[.!?。？！]$/u, "")
                                   .replace(/(입니다|습니다|합니다|한다|이다|다)$/u, "");
                                   }

                const firstSentence = getFirstSentence(quiz.explanation);

                const explanationMatch = firstSentence.match(
                   /^정답은\s+(.+?)(?:입니다|습니다|합니다|한다|이다|다)\.?$/u
                   );

                if (!explanationMatch) {
                   throw new Error(`해설 형식 오류: ${firstSentence}`);
                   }

                  const explanationAnswer = normalizeEnding(explanationMatch[1]);
                  const correctAnswer = normalizeEnding(quiz.correctAnswerText);

                  if (explanationAnswer !== correctAnswer) {
                     throw new Error(
                     `해설 정답 불일치: (정답: ${correctAnswer} / 해설: ${explanationAnswer})`
    );
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

            processedQuizzes.forEach((quiz, idx) => {
               const answer = quiz.choices[quiz.correctAnswerIndex];

               shuffleArray(quiz.choices, `${Date.now()}_${idx}`);

            quiz.correctAnswerIndex = quiz.choices.indexOf(answer);
            quiz.correctAnswerText = answer;
           });

            MASTER_QUIZ_DATA = processedQuizzes.map((q, idx) => {
                return { ...q, id: Date.now() + idx };
            });

            LAST_FETCH_TIME = Date.now();
            LAST_TOPICS = [...selectedTopics];
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
