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
  // 문화예술
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
    id: 1014,
    topic: "문화예술",
    question: "조선시대 김홍도와 신윤복이 대표적인 화가로 꼽히며, 일반 대중의 일상생활과 풍속을 그린 그림을 무엇이라 하는가?",
    choices: ["진경산수화", "풍속화", "문인화", "민화"],
    correctAnswerIndex: 1,
    correctAnswerText: "풍속화",
    explanation: "정답은 풍속화입니다. 당대 서민과 양반층의 생활상, 놀이, 풍속을 사실적이고 해학적으로 담아낸 그림 양식입니다."
  },

  // 환경
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
    id: 1015,
    topic: "환경",
    question: "플라스틱이 바다에서 마모되어 직경 5mm 이하로 작아진 미세 입자로, 해양 생태계를 위협하는 물질은?",
    choices: ["마이크로 플라스틱", "스모그", "아황산가스", "프레온 가스"],
    correctAnswerIndex: 0,
    correctAnswerText: "마이크로 플라스틱",
    explanation: "정답은 마이크로 플라스틱입니다. 미세 플라스틱은 플랑크톤부터 어류까지 분해되지 않고 체내에 축적됩니다."
  },

  // 과학
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
    id: 1016,
    topic: "과학",
    question: "원소를 원자 번호 순으로 배열하여 화학적 성질이 비슷한 원소가 같은 세로줄에 오도록 정리한 표는?",
    choices: ["원소 주기율표", "방사성 동위원소표", "분자량 표준표", "화학 반응표"],
    correctAnswerIndex: 0,
    correctAnswerText: "원소 주기율표",
    explanation: "정답은 원소 주기율표입니다. 멘델레예프가 처음 제안하였으며 원소의 주기성을 한눈에 보여줍니다."
  },

  // 역사
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
    id: 1017,
    topic: "역사",
    question: "1919년 3월 1일 일제의 강점치하에 저항하여 전국적으로 일어난 비폭력 독립운동의 명칭은?",
    choices: ["6·10 만세운동", "3·1 운동", "광주학생항일운동", "물산장려운동"],
    correctAnswerIndex: 1,
    correctAnswerText: "3·1 운동",
    explanation: "정답은 3·1 운동입니다. 대한민국 임시정부 수립의 직접적인 계기가 된 최대 규모의 민족 독립운동입니다."
  },

  // 디지털 리터러시
  {
    id: 1005,
    topic: "디지털 리터러시",
    question: "출처가 불분명한 이메일이나 문자 메시지의 링크를 클릭하도록 유도하여 개인정보를 탈취하는 사이버 사기 수법은?",
    choices: ["디도스(DDoS)", "피싱(Phishing)", "파밍(Pharming)", "스미싱(Smishing)"],
    correctAnswerIndex: 1,
    correctAnswerText: "피싱(Phishing)",
    explanation: "정답은 피싱(Phishing)입니다. 신뢰할 수 있는 기관이나 사람을 가장해 비밀번호, 금융 정보 등 개인정보를 낚아채는 공격 방식입니다."
  },

  // 인권 리터러시
  {
    id: 1006,
    topic: "인권 리터러시",
    question: "1948년 UN 총회에서 채택되어 모든 인간의 기본적 권리와 존엄성을 최초로 국제적으로 선언한 문서의 이름은?",
    choices: ["세계인권선언", "시민적 및 정치적 권리에 관한 국제규약", "아동의 권리에 관한 협약", "마그나 카르타"],
    correctAnswerIndex: 0,
    correctAnswerText: "세계인권선언",
    explanation: "정답은 세계인권선언입니다. 1948년 12월 10일 UN 총회에서 채택된 인권 보호의 역사적 이정표입니다."
  },

  // 한글 맞춤법
  {
    id: 1007,
    topic: "한글 맞춤법",
    question: "다음 중 2026년 현행 한글 맞춤법 표기법상 올바른 문장은 무엇일까요?",
    choices: ["오랫만에 친구를 만났다.", "오랜만에 친구를 만났다.", "오랜간만에 친구를 만났다.", "오래간에 친구를 만났다."],
    correctAnswerIndex: 1,
    correctAnswerText: "오랜만에 친구를 만났다.",
    explanation: "정답은 오랜만에 친구를 만났다.입니다. '오랜만'은 '오래간만'의 줄임말로 '오랜만에'가 올바른 표기입니다."
  },

  // 코딩
  {
    id: 1008,
    topic: "코딩",
    question: "다음 JavaScript 코드의 실행 결과로 올바른 것은?\n```javascript\nconst arr = [1, 2, 3];\nconst result = arr.map(x => x * 2);\nconsole.log(result);\n```",
    choices: ["[1, 2, 3]", "[2, 4, 6]", "6", "undefined"],
    correctAnswerIndex: 1,
    correctAnswerText: "[2, 4, 6]",
    explanation: "정답은 [2, 4, 6]입니다. Array.prototype.map() 메서드는 배열의 모든 요소에 콜백 함수를 실행하여 새로운 배열을 반환합니다."
  },

  // 안전 및 건강상식
  {
    id: 1009,
    topic: "안전 및 건강상식",
    question: "심정지 환자가 발생했을 때 시행하는 심폐소생술(CPR)의 가슴 압박 위치와 권장 속도는?",
    choices: [
      "가슴 뼈 중앙(복장뼈 하부), 분당 100~120회",
      "명치 끝부분, 분당 60~80회",
      "왼쪽 가슴 위, 분당 140회 이상",
      "오른쪽 가슴 중앙, 분당 80~100회"
    ],
    correctAnswerIndex: 0,
    correctAnswerText: "가슴 뼈 중앙(복장뼈 하부), 분당 100~120회",
    explanation: "정답은 가슴 뼈 중앙(복장뼈 하부), 분당 100~120회입니다. 약 5cm 깊이로 강하고 빠르게 가슴 중앙을 압박해야 합니다."
  },

  // 경제
  {
    id: 1010,
    topic: "경제",
    question: "물가가 지속적으로 상승하여 화폐의 가치가 떨어지는 현상을 무엇이라 하는가?",
    choices: ["디플레이션", "인플레이션", "스태그플레이션", "디레버리징"],
    correctAnswerIndex: 1,
    correctAnswerText: "인플레이션",
    explanation: "정답은 인플레이션입니다. 통화량 증가나 수요 공급 균형 변화로 지속적으로 재화와 서비스 가격이 상승하는 현상입니다."
  },
  {
    id: 1018,
    topic: "경제",
    question: "주식 시장에서 기업이 발행한 주식 전체의 시장 가치 총액을 무엇이라 하는가?",
    choices: ["시가총액", "자가자본", "액면가", "배당금"],
    correctAnswerIndex: 0,
    correctAnswerText: "시가총액",
    explanation: "정답은 시가총액입니다. (상장주식수 × 주가)로 계산되며 기업의 규모를 측정하는 주요 지표입니다."
  },

  // 지리
  {
    id: 1011,
    topic: "지리",
    question: "세계에서 면적이 가장 넓은 국가는 어디일까요?",
    choices: ["캐나다", "미국", "중국", "러시아"],
    correctAnswerIndex: 3,
    correctAnswerText: "러시아",
    explanation: "정답은 러시아입니다. 러시아의 면적은 약 1,710만 ㎢로 유라시아 대륙 북부에 걸쳐 있는 세계 최대 영토 국가입니다."
  },
  {
    id: 1019,
    topic: "지리",
    question: "세계에서 가장 유량이 풍부하고 넓은 유역 면적을 가진 남미의 강은 어디일까요?",
    choices: ["나일강", "미시시피강", "아마존강", "양쯔강"],
    correctAnswerIndex: 2,
    correctAnswerText: "아마존강",
    explanation: "정답은 아마존강입니다. 아마존강은 세계 최대의 수량을 자랑하며 열대우림 생태계의 중심입니다."
  },

  // 정치
  {
    id: 1012,
    topic: "정치",
    question: "국가의 권력을 입법, 사법, 행정의 세 기관으로 나누어 상호 견제와 균형을 이루게 하는 원리는?",
    choices: ["국민주권의 원리", "삼권분립의 원리", "의회주의의 원리", "직접민주주의의 원리"],
    correctAnswerIndex: 1,
    correctAnswerText: "삼권분립의 원리",
    explanation: "정답은 삼권분립의 원리입니다. 몽테스키외가 제창한 통치 구조 원리로 몽테스키외의 '법의 정신'에 명시되어 있습니다."
  },
  {
    id: 1020,
    topic: "정치",
    question: "대한민국 헌법 제1조 제1항의 내용은 무엇일까요?",
    choices: [
      "대한민국은 민주공화국이다.",
      "대한민국의 주권은 국민에게 있고, 모든 권력은 국민으로부터 나온다.",
      "대한민국은 통일을 지향한다.",
      "모든 국민은 법 앞에 평등하다."
    ],
    correctAnswerIndex: 0,
    correctAnswerText: "대한민국은 민주공화국이다.",
    explanation: "정답은 대한민국은 민주공화국이다.입니다. 제1조 제2항이 '대한민국의 주권은 국민에게 있고 모든 권력은 국민으로부터 나온다'입니다."
  },

  // 심리학
  {
    id: 1013,
    topic: "심리학",
    question: "자신이 어떤 사람인지, 어떤 능력을 가졌는지에 대한 주관적인 믿음과 긍정적 평가를 뜻하는 심리학 용어는?",
    choices: ["자아존중감(Self-esteem)", "방어기제", "인지적 불협화음", "동조 현상"],
    correctAnswerIndex: 0,
    correctAnswerText: "자아존중감(Self-esteem)",
    explanation: "정답은 자아존중감(Self-esteem)입니다. 자신을 가치 있는 존재로 인식하고 존중하는 자기 평가 감정입니다."
  },
  {
    id: 1021,
    topic: "심리학",
    question: "자신의 신념이나 행동과 대립되는 인지 상태에 처했을 때 발생하는 심리적 불쾌감과 이를 해소하려는 성향을 뜻하는 용어는?",
    choices: ["인지 부조화(Cognitive Dissonance)", "피그말리온 효과", "플라시보 효과", "바넘 효과"],
    correctAnswerIndex: 0,
    correctAnswerText: "인지 부조화(Cognitive Dissonance)",
    explanation: "정답은 인지 부조화(Cognitive Dissonance)입니다. 페스팅거가 제안한 이론으로 신념과 실제 행동 사이의 차이로 생기는 갈등입니다."
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
                content: `선택된 분야: ${selectedTopics.join(', ')}

필수 규칙:
1. 선택된 분야들 각각에서 정확히 1문제씩 출제한다.
2. 선택되지 않은 분야의 문제는 절대로 출제하지 마라.
3. 총 문제 수는 ${selectedTopics.length}개여야 함.
4. choices는 정확히 4개 작성한다.
5. correctAnswerText는 choices 배열의 요소와 완전히 일치해야 한다.
6. correctAnswerIndex는 정답 보기의 인덱스(0~3)다.
7. explanation은 반드시 "정답은 [correctAnswerText]입니다."로 시작한다.

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
            const matchedQuizzes = [];
            if (customTopics && customTopics.length > 0) {
                customTopics.forEach((topic, idx) => {
                    const pool = FALLBACK_QUIZZES.filter(q => q.topic === topic);
                    if (pool.length > 0) {
                        const picked = pool[Math.floor(Math.random() * pool.length)];
                        matchedQuizzes.push({ ...picked, id: Date.now() + idx * 10 });
                    }
                });
            }

            if (matchedQuizzes.length > 0) {
                newQuizzes = matchedQuizzes;
            } else {
                const shuffledFallback = [...FALLBACK_QUIZZES].sort(() => 0.5 - Math.random());
                newQuizzes = shuffledFallback.slice(0, 5).map((q, idx) => ({ ...q, id: Date.now() + idx }));
            }
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
        return res.status(200).json(sanitizeQuizData(FALLBACK_QUIZZES.slice(0, 5)));
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
        FALLBACK_QUIZZES.slice(0, 5).forEach(q => { answerKey[q.id] = q.correctAnswerIndex; });
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
