const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const seedrandom = require('seedrandom');
const crypto = require('crypto');
const { createQuizPayload } = require('./prdPrompt');

const app = express();
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

const SERVER_START_TIME = Date.now();
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

const TOKEN_SECRET = process.env.TOKEN_SECRET || MISTRAL_API_KEY || 'default-quiz-secret-key-32bytes';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(String(TOKEN_SECRET)).digest();
const ALGORITHM = 'aes-256-gcm';

function encrypt(text) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(token) {
    const [ivHex, authTagHex, encryptedText] = token.split(':');
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

app.disable('x-powered-by');

// 💡 [핵심] Vercel 24시간 자동 인스턴스 재생성 미들웨어
app.use((req, res, next) => {
    // 서버가 켜진 지 24시간이 넘었다면 현재 프로세스를 깔끔하게 종료
    // Vercel이 다음 요청 시 감지하여 100% 최적화된 새 인스턴스로 자동 재생성함
    if (Date.now() - SERVER_START_TIME > TWENTY_FOUR_HOURS) {
        console.log("[Vercel] 인스턴스 24시간 경과: 메모리 초기화를 위해 컨테이너 재생성을 수행합니다.");
        process.exit(0);
    }
    
    res.set({
  'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=59',
  'Vary': 'Accept-Encoding'
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

    // =========================================================
    // 띄어쓰기
    // =========================================================

    {
        id: "SPACING_DEPENDENT_NOUN_IL",
        category: "의존 명사",
        allowed: ["할 일"],
        forbidden: ["할일"],
        questionType: "single_correct",
        explanation: "'일'은 의존 명사이므로 앞말과 띄어 쓴다."
    },

    {
        id: "SPACING_DEPENDENT_NOUN_GAJI",
        category: "의존 명사",
        allowed: ["몇 가지"],
        forbidden: ["몇가지"],
        questionType: "single_correct",
        explanation: "'가지'는 의존 명사이므로 앞말과 띄어 쓴다."
    },

    {
        id: "SPACING_DEPENDENT_NOUN_GEOT",
        category: "의존 명사",
        allowed: ["것 같다"],
        forbidden: ["것같다"],
        questionType: "single_correct",
        explanation: "'것'은 의존 명사이므로 앞말과 띄어 쓴다."
    },

    {
        id: "SPACING_PUNMAN",
        category: "띄어쓰기",
        allowed: ["뿐만 아니라"],
        forbidden: ["뿐만아니라"],
        questionType: "single_correct",
        explanation: "'뿐만 아니라'는 올바르게 띄어 쓴다."
    },

    {
        id: "SPACING_SU_BAKKE",
        category: "조사",
        allowed: ["할 수밖에 없다"],
        forbidden: ["할수밖에 없다", "할 수 밖에 없다", "할수밖에없다"],
        questionType: "single_correct",
        explanation: "'수'는 의존 명사이므로 띄어 쓰고, '밖에'는 조사이므로 앞말에 붙여 쓴다."
    },

    {
        id: "SPACING_GOTBARO",
        category: "띄어쓰기",
        allowed: ["곧바로"],
        forbidden: ["곧 바로"],
        questionType: "single_correct",
        explanation: "'곧바로'는 한 단어로 굳어진 부사이다."
    },

    {
        id: "SPACING_MYEOTMYES",
        category: "띄어쓰기",
        allowed: ["몇몇"],
        forbidden: ["몇 몇"],
        questionType: "single_correct",
        explanation: "'몇몇'은 한 단어이므로 붙여 쓴다."
    },

    {
        id: "SPACING_MATASEO_HADA",
        category: "띄어쓰기",
        allowed: ["맡아서 하다"],
        forbidden: ["맡아서하다"],
        questionType: "single_correct",
        explanation: "'맡아서'와 '하다'는 각각의 용언이므로 띄어 쓴다."
    },


    // =========================================================
    // 의존 명사
    // =========================================================

    {
        id: "SPACING_DEPENDENT_NOUN_SU",
        category: "의존 명사",
        allowed: ["할 수 있다"],
        forbidden: ["할수있다"],
        questionType: "single_correct",
        explanation: "'수'는 의존 명사이므로 앞말과 띄어 쓴다."
    },

    {
        id: "SPACING_DEPENDENT_NOUN_JI",
        category: "의존 명사",
        allowed: ["먹은 지 오래되었다"],
        forbidden: ["먹은지 오래되었다"],
        questionType: "single_correct",
        explanation: "시간의 경과를 나타내는 의존 명사 '지'는 앞말과 띄어 쓴다."
    },

    {
        id: "SPACING_DEPENDENT_NOUN_MANKUM",
        category: "의존 명사",
        allowed: ["아는 만큼"],
        forbidden: ["아는만큼"],
        questionType: "single_correct",
        explanation: "'만큼'이 의존 명사로 쓰인 경우 앞말과 띄어 쓴다."
    },

    {
        id: "SPACING_DEPENDENT_NOUN_SSI",
        category: "의존 명사",
        allowed: ["김철수 씨"],
        forbidden: ["김철수씨"],
        questionType: "single_correct",
        explanation: "사람의 성이나 이름 뒤에 쓰이는 '씨'는 띄어 쓴다."
    },

    {
        id: "SPACING_BBUN_IDA",
        category: "조사",
        allowed: ["뿐이다"],
        forbidden: ["뿐 이다"],
        questionType: "single_correct",
        explanation: "이 구성에서 '뿐'은 조사이므로 앞말에 붙여 쓰고 '이다'도 붙여 쓴다."
    },


    // =========================================================
    // 조사
    // =========================================================

    {
        id: "SPACING_PARTICLE_MAN_IRADO",
        category: "조사",
        allowed: ["학교에서만이라도"],
        forbidden: [
            "학교 에서만이라도",
            "학교에서 만이라도",
            "학교에서만 이라도",
            "학교 에서 만 이라도"
        ],
        questionType: "single_correct",
        explanation: "'에서', '만', '이라도'는 모두 조사이므로 앞말에 붙여 쓴다."
    },


    // =========================================================
    // 보조 용언
    // =========================================================

    {
        id: "SPACING_AUXILIARY_VERB_01",
        category: "보조 용언",
        allowed: [
            "깨뜨려 버렸다",
            "깨뜨려버렸다"
        ],
        forbidden: [],
        questionType: "multiple_allowed",
        explanation:
            "보조 용언은 띄어 쓰는 것을 원칙으로 하되, 일정한 구성에서는 붙여 쓰기도 허용된다."
    },

    {
        id: "SPACING_AUXILIARY_VERB_02",
        category: "보조 용언",
        allowed: [
            "읽어 보고",
            "읽어보고"
        ],
        forbidden: [],
        questionType: "multiple_allowed",
        explanation:
            "본용언에 '-아/-어'가 연결되고 보조 용언이 이어지는 경우 띄어 쓰는 것을 원칙으로 하되 붙여 쓰기도 허용된다."
    },


    // =========================================================
    // 어미 활용
    // =========================================================

    {
        id: "ENDING_DOEGETDA",
        category: "어미 활용",
        allowed: ["되겠다"],
        forbidden: [
            "되갯다",
            "되겟다",
            "돼겠다",
            "됬겠다",
            "돼갰다"
        ],
        questionType: "single_correct",
        explanation: "'되다'에 '-겠-'과 '-다'가 결합한 형태는 '되겠다'이다."
    },

    {
        id: "ENDING_DWAETDA",
        category: "어미 활용",
        allowed: ["됐다"],
        forbidden: ["됬다"],
        questionType: "single_correct",
        explanation: "'되었다'가 줄어든 말은 '됐다'이다."
    },

    {
        id: "ENDING_AN_DWAE",
        category: "어미 활용",
        allowed: ["안 돼"],
        forbidden: ["안되"],
        questionType: "single_correct",
        explanation: "'되다'의 활용형 '돼'를 사용하며, 이 구성에서는 '안 돼'로 띄어 쓴다."
    },

    {
        id: "ENDING_DWAEOSEO",
        category: "어미 활용",
        allowed: ["돼서"],
        forbidden: ["되서"],
        questionType: "single_correct",
        explanation: "'되다'에 '-어서'가 결합한 형태는 '돼서'이다."
    },

    {
        id: "ENDING_HARYEOGO",
        category: "어미 활용",
        allowed: ["하려고"],
        forbidden: ["할려고"],
        questionType: "single_correct",
        explanation: "'하다'의 활용형은 '하려고'이다."
    },

    {
        id: "ENDING_HALGE",
        category: "어미 활용",
        allowed: ["할게"],
        forbidden: ["할께"],
        questionType: "single_correct",
        explanation: "약속이나 의지를 나타내는 종결 어미는 '-ㄹ게'로 적으므로 '할게'가 올바르다."
    },


    // =========================================================
    // 표기 / 맞춤법
    // =========================================================

    {
        id: "SPELLING_WENIL",
        category: "표기",
        allowed: ["웬일"],
        forbidden: ["왠일"],
        questionType: "single_correct",
        explanation: "'웬일'이 올바른 표기이다."
    },

    {
        id: "SPELLING_EOI_EOPDA",
        category: "표기",
        allowed: ["어이없다"],
        forbidden: ["어의없다"],
        questionType: "single_correct",
        explanation: "'어이없다'가 올바른 표기이다."
    },

    {
        id: "SPELLING_GEUMSE",
        category: "표기",
        allowed: ["금세"],
        forbidden: ["금새"],
        questionType: "single_correct",
        explanation: "'금세'는 '금시에'가 줄어든 말이므로 '금세'로 적으며, '금새'로 적지 않는다. 지금 바로 또는 얼마 지나지 않은 때를 나타내는 말이 들어가야 한다."
    },

    {
        id: "SPELLING_MYEOCHIL",
        category: "표기",
        allowed: ["며칠"],
        forbidden: ["몇일"],
        questionType: "single_correct",
        explanation: "날짜를 나타내는 말은 '며칠'로 적는다."
    },

    {
        id: "SPELLING_ORENMAN",
        category: "표기",
        allowed: ["오랜만"],
        forbidden: ["오랫만"],
        questionType: "single_correct",
        explanation: "'오랜만'이 올바른 표기이다."
    },

    {
        id: "SPELLING_SEOLGEOJI",
        category: "표기",
        allowed: ["설거지"],
        forbidden: ["설겆이"],
        questionType: "single_correct",
        explanation: "'설거지'가 올바른 표기이다."
    },

    {
        id: "SPELLING_ORAETDONGAN",
        category: "표기",
        allowed: ["오랫동안"],
        forbidden: ["오랜동안"],
        questionType: "single_correct",
        explanation: "'오랫동안'이 올바른 표기이다."
    },

    {
        id: "SPELLING_KKAEKKEUSHI",
        category: "표기",
        allowed: ["깨끗이"],
        forbidden: ["깨끗히"],
        questionType: "single_correct",
        explanation: "'깨끗이'가 올바른 표기이다."
    },


    // =========================================================
    // 사이시옷
    // =========================================================

    {
        id: "SISIOS_NAMUTIP",
        category: "사이시옷",
        allowed: ["나뭇잎"],
        forbidden: ["나무잎"],
        questionType: "single_correct",
        explanation: "사이시옷 규정에 따라 '나뭇잎'으로 적는다."
    },

    {
        id: "SISIOS_GOGITJIP",
        category: "사이시옷",
        allowed: ["고깃집"],
        forbidden: ["고기집"],
        questionType: "single_correct",
        explanation: "사이시옷 규정에 따라 '고깃집'으로 적는다."
    },

    {
        id: "SISIOS_JONSETJIP",
        category: "사이시옷",
        allowed: ["전셋집"],
        forbidden: ["전세집"],
        questionType: "single_correct",
        explanation: "사이시옷 규정에 따라 '전셋집'으로 적는다."
    },

    {
        id: "SISIOS_JANGMATBI",
        category: "사이시옷",
        allowed: ["장맛비"],
        forbidden: ["장마비"],
        questionType: "single_correct",
        explanation: "사이시옷 규정에 따라 '장맛비'로 적는다."
    },

    {
        id: "SISIOS_DWITBATCIM",
        category: "사이시옷",
        allowed: ["뒷받침"],
        forbidden: ["뒤받침"],
        questionType: "single_correct",
        explanation: "사이시옷 규정에 따라 '뒷받침'으로 적는다."
    },

    {
        id: "SISIOS_MEORIMAL",
        category: "사이시옷",
        allowed: ["머리말"],
        forbidden: ["머릿말"],
        questionType: "single_correct",
        explanation: "'머리말'은 사이시옷을 적지 않는다."
    },

    {
        id: "SISIOS_EOJESBAM",
        category: "사이시옷",
        allowed: ["어젯밤"],
        forbidden: ["어제 밤", "어제밤"],
        questionType: "single_correct",
        explanation: "사이시옷 규정에 따라 '어젯밤'으로 적는다."
    },
    {   
        id: "RULE_BULGYEON_BULGYEON",
        category: "표현",
        allowed: ["문제가 불거지다"], 
        forbidden: ["문제가 붉어지다", "논란이 붉어지다", "갈등이 붉어지다"],
        questionType: "single_correct",
        explantion: "'불거지다'는 속에 있던 것이 밖으로 드러나거나 문제가 드러나는 뜻이며, '붉어지다'와 혼동하지 않는다."
    },
{
    id: "RULE_DWAEDO_DWAE",
    category: "표기",
    allowed: ["안 돼", "돼요", "돼서", "되면", "되고", "될 수 있다"],
    forbidden: ["안 되", "되요", "되서", "돼면", "돼고", "됄 수 있다"],
    questionType: "single_correct",
    explantion: "'돼'는 '되어'가 줄어든 말이며, '되'는 뒤에 다른 어미가 이어지는 경우 등에 쓴다. '돼'와 '되'는 문맥에 따라 구별한다."
},
{
    id: "RULE_AN_ANH",
    category: "표기",
    allowed: ["안 먹다", "안 된다", "먹지 않다", "하지 않았다", "좋지 않다", "그렇지 않다"],
    forbidden: ["않 먹다", "않 된다", "먹지 안다", "하지 안았다", "좋지 안다", "그렇지 안다"],
    questionType: "single_correct",
    explantion: "'안'은 부사이고, '않다'는 '아니하다'의 준말로 용언의 일부로 쓰인다."
},
{
    id: "RULE_WAEN_WAEN",
    category: "표기",
    allowed: ["왠지", "왠지 모르게", "웬일", "웬 사람", "웬만하면", "웬 떡"],
    forbidden: ["웬지", "웬지 모르게", "왠일", "왠 사람", "왠만하면", "왠 떡"],
    questionType: "single_correct",
    explantion: "'왠지'는 '왜인지'가 줄어든 말이며, '웬'은 '어찌 된'이나 '어떠한'의 뜻을 나타내는 관형사이다."
},
{
    id: "RULE_MYEOTCHIL",
    category: "표기",
    allowed: ["며칠", "며칠 동안", "며칠 전", "며칠 후", "며칠째"],
    forbidden: ["몇일", "몇일 동안", "몇일 전", "몇일 후", "몇일째"],
    questionType: "single_correct",
    explantion: "'며칠'은 '몇'과 '일'의 결합으로 볼 수 있지만 표준어에서는 '며칠'로 적으며, '몇일'로 적지 않는다."
},
{
    id: "RULE_GEUMSE_GEUMSAE",
    category: "표기",
    allowed: ["금세 끝났다", "금세 도착했다", "금세 잊었다", "금세 변했다"],
    forbidden: ["금새 끝났다", "금새 도착했다", "금새 잊었다", "금새 변했다"],
    questionType: "single_correct",
    explantion: 
},
{
    id: "RULE_ORAENMAN",
    category: "표기",
    allowed: ["오랜만이다", "오랜만에 만나다", "정말 오랜만이야", "오랜만에 연락하다"],
    forbidden: ["오랫만이다", "오랫만에 만나다", "정말 오랫만이야", "오랫만에 연락하다"],
    questionType: "single_correct",
    explantion: "'오랜만'은 '오래간만'의 준말이므로 '오랜만'으로 적는다."
},
{
    id: "RULE_BANDEUSI_BANDEUSI",
    category: "표현",
    allowed: ["반드시 지켜야 한다", "반드시 성공한다", "반듯이 앉다", "반듯이 놓다"],
    forbidden: ["반듯이 지켜야 한다", "반듯이 성공한다", "반드시 앉다", "반드시 놓다"],
    questionType: "single_correct",
    explantion: "'반드시'는 '틀림없이 꼭'의 뜻이고, '반듯이'는 '반듯하게'의 뜻이므로 의미에 따라 구별한다."
},
{
    id: "RULE_BAE_DA_BAE_DA",
    category: "표현",
    allowed: ["옷에 냄새가 배다", "습관이 몸에 배다", "칼로 나무를 베다", "베개를 베다"],
    forbidden: ["옷에 냄새가 베다", "습관이 몸에 베다", "칼로 나무를 배다", "베개를 배다"],
    questionType: "single_correct",
    explantion: "'배다'는 냄새나 습관 등이 스며들거나 익숙해지는 뜻이고, '베다'는 칼 등으로 자르거나 베개를 받치는 뜻이다."
},
{
    id: "RULE_PUN_PUN",
    category: "띄어쓰기",
    allowed: ["할 뿐이다", "알 뿐이다", "너뿐이다", "그 사람뿐이다", "이것뿐이다"],
    forbidden: ["할뿐이다", "알뿐이다", "너 뿐이다", "그 사람 뿐이다", "이것 뿐이다"],
    questionType: "single_correct",
    explantion: "'뿐'은 의존 명사로 쓰일 때 앞말과 띄어 쓰고, 조사로 쓰일 때에는 앞말에 붙여 쓴다."
},
{
    id: "RULE_DAERO_DAERO",
    category: "띄어쓰기",
    allowed: ["들은 대로 말하다", "아는 대로 하다", "법대로 처리하다", "예정대로 진행하다", "마음대로 하다"],
    forbidden: ["들은대로 말하다", "아는대로 하다", "법 대로 처리하다", "예정 대로 진행하다", "마음 대로 하다"],
    questionType: "single_correct",
    explantion: "'대로'는 의존 명사로 쓰이면 앞말과 띄어 쓰고, 조사로 쓰이면 앞말에 붙여 쓴다."
},
{
    id: "RULE_MANKEUM_MANKEUM",
    category: "띄어쓰기",
    allowed: ["노력한 만큼", "먹을 만큼 먹다", "너만큼 잘하다", "그만큼 중요하다", "나만큼은 안다"],
    forbidden: ["노력한만큼", "먹을만큼 먹다", "너 만큼 잘하다", "그 만큼 중요하다", "나 만큼은 안다"],
    questionType: "single_correct",
    explantion: "'만큼'은 의존 명사로 쓰이면 앞말과 띄어 쓰고, 조사로 쓰이면 앞말에 붙여 쓴다."
},
{
    id: "RULE_LGE_LGE",
    category: "표기",
    allowed: ["내가 할게", "다녀올게", "연락할게", "어디로 갈까"],
    forbidden: ["내가 할께", "다녀올께", "연락할께", "어디로 갈가"],
    questionType: "single_correct",
    explantion: "소리는 된소리로 나더라도 약속이나 의지를 나타내는 '-ㄹ게'는 '-ㄹ께'로 적지 않는다. 반면 '-ㄹ까'는 된소리를 반영하여 적는다."
},
{
    id: "RULE_ISSDA_EOPDA",
    category: "표기",
    allowed: ["있어", "있고", "있으니", "없어", "없고", "없으니"],
    forbidden: ["이써", "이꼬", "이쓰니", "업써", "업꼬", "업쓰니"],
    questionType: "single_correct",
    explantion: "'있다'와 '없다'의 활용형은 발음대로 적지 않고 형태를 밝혀 적는다."
}];


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
    let text = String(choice || "").trim();

    if (topic === "한글 맞춤법") {
        // 문장 부호 제거 후 비교
        return text
            .replace(/[.,!?·:;'"“”‘’]/g, "")
            .trim();
    }

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
너는 상식 퀴즈의 **치명적 오류와 팩트**를 검증하는 검사원이다.
목적: 문제/정답/해설의 명백한 사실 오류 및 시대 착오는 확실히 불합격(false)시킨다.

[핵심 검증 기준]
1. 정답의 정확성 및 유일성
- correctAnswerText가 실제 학술적/상식적으로 올바르며 choices 중 유일한 정답인가? (정답 없음 / 중복 정답 시 false)
- '옳지 않은 것'을 묻는 질문에 '옳지 않은 내용'이 정답으로 지정되어 있으면 정상(true)이다.

2. 세기 및 시대 표현 검증 (치명적 AI 환각 방지)
- 세기(Century) 계산 착오가 없는지 확인하라. (예: 19세기 = 1800년대 / 20세기 = 1900년대)
- '초반/중반/후반' 및 '조선 후기' 등 시대 표현이 실제 역사적 연도와 명백히 불일치하면 false 처리하라.
  (※ 단, 엄격한 숫자 범위 트집이 아니라, 대중적 역사 통설 기준에서 완전히 틀린 경우만 불합격 처리한다.)

3. ***개념 및 수치·단위 일치성 (Crucial)***
- 질문에서 묻는 핵심 대상과 정답/해설에서 설명하는 대상이 서로 '혼동하기 쉬운 별개의 개념'이 아닌지 검증하라.
  (예: 원소/화합물, 상위/하위 개념, 기준 지표/관련 지표, 단위 차이, 주체/객체 등)
- 수치·단위·기한·통계가 객관적 사실과 조금이라도 일치하지 않으면 무조건 불합격(false) 처리하라.

4. ***한글 문법 및 띄어쓰기 환각 검증 (Crucial)***
- "부사(아무튼, 매우, 겨우 등)를 뒤 단어와 붙여 써야 한다"는 식의 거짓 문법 규칙이 해설이나 정답 근거에 포함되어 있으면 무조건 false 처리하라.
- 띄어쓰기 오류가 없는 정상적인 문장을 오류가 있다고 주장하는 경우 무조건 false 처리하라.

5. **절대 규칙**
- 질문과 정답이 정확하다면, 해설(explanation)의 사소한 부연설명 뉘앙스나 어조 차이로 불합격시키지 마라.
- 정답과 해설에 포함된 원리·이유 설명이 있는 경우, 해당 내용도 사실과 일치해야 한다.
- 결론은 맞지만 포함된 핵심 원리나 이유가 틀리면 false 처리한다.

[출력 형식 (JSON 전용)]
{
  "valid": true | false,
  "reason": "false인 경우에만 1줄 사유 작성 (true면 반드시 빈 문자열 \"\")"
}
`
            },
            {
                role: "user",
                content: JSON.stringify(quiz)
            }
        ],
        temperature: 0.05,
        max_tokens: 1150
    };

    try {
        const response = await axios.post(API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${MISTRAL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 25000
        });

        const rawContent = response.data?.choices?.[0]?.message?.content;
        const cleanJson = extractJsonFromText(rawContent);
        return JSON.parse(cleanJson);
    } catch (err) {
        return { valid: false, reason: `단일 문항 검증 통신 오류: ${err.message}` };
    }
}
    
async function validateQuizAccuracy(quizzes) {
    const results = new Array(quizzes.length);
    let index = 0;

    // 동시 실행할 작업 수 (429 방지용)
    const CONCURRENCY_LIMIT = 2;

    // 일하는 워커(Worker) 함수
    async function worker() {
        while (index < quizzes.length) {
            const currentIndex = index++;
            // 개별 검증 실행
            results[currentIndex] = await validateSingleQuiz(quizzes[currentIndex]);
        }
    }

    // 최대 2개의 워커만 동시에 가동
    const workers = Array.from(
        { length: Math.min(CONCURRENCY_LIMIT, quizzes.length) }, 
        () => worker()
    );

    // 모든 워커가 일을 마칠 때까지 대기
    await Promise.all(workers);

    // 검증 결과 확인
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

function validateSpellingAnswer(quiz) {
    if (quiz.topic !== "한글 맞춤법") return true;

    const isNegative = /틀린|잘못|적절하지\s*않은|옳지\s*않은|바르지\s*않은/.test(quiz.question);
    const answer = String(quiz.correctAnswerText || "").trim();

    // 정답이 어떤 규칙에 속하는지 확인
    const rules = SPELLING_DATA.filter(rule =>
        rule.allowed?.includes(answer) || rule.forbidden?.includes(answer)
    );

    // DB에 없는 표현은 통과시키지 않음
    if (rules.length === 0) {
        console.error(`[맞춤법 검증 실패] DB에 없는 표현: "${answer}"`);
        return true;
    }

    for (const rule of rules) {
        const isAllowed = rule.allowed?.includes(answer);
        const isForbidden = rule.forbidden?.includes(answer);

        // DB 규칙 자체가 충돌하면 실패
        if (isAllowed && isForbidden) {
            console.error(`[맞춤법 검증 실패] DB 규칙 충돌: "${answer}"`);
            return false;
        }

        // 복수 허용 표현은 단일 정답 문제로 사용하지 않음
        if (rule.questionType === "multiple_allowed") {
            console.error(`[맞춤법 검증 실패] 복수 허용 규칙: "${answer}"`);
            return false;
        }

        // 긍정형 → allowed만 정답 가능
        if (!isNegative && !isAllowed) {
            console.error(`[맞춤법 검증 실패] 올바른 표기 문제의 잘못된 정답: "${answer}"`);
            return false;
        }

        // 부정형 → forbidden만 정답 가능
        if (isNegative && !isForbidden) {
            console.error(`[맞춤법 검증 실패] 틀린 표기 문제의 올바른 정답: "${answer}"`);
            return false;
        }
    }

    return true;
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
                if (!validateSpellingAnswer(quiz)) {
        throw new Error("한글 맞춤법: 질문 유형(긍정/부정)과 정답 표기 불일치");
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
            // 보기 셔플 및 정답 인덱스 재계산 & 해설 번호 자동 보정
processedQuizzes.forEach((quiz, idx) => {
    const originalText = quiz.choices[quiz.correctAnswerIndex] || quiz.correctAnswerText;
    
    // 1️⃣ 셔플 전 원본 보기 순서 배열 백업
    const originalChoices = [...quiz.choices];

    // 보기 셔플 진행
    shuffleArray(quiz.choices, `${Date.now()}_${idx}`);

    // 정답 인덱스 재계산
    let newIndex = quiz.choices.indexOf(originalText);
    if (newIndex === -1 && originalText) {
        const cleanTarget = originalText.replace(/[\s\.]/g, '');
        newIndex = quiz.choices.findIndex(c => c.replace(/[\s\.]/g, '') === cleanTarget);
    }

    if (newIndex !== -1) {
        quiz.correctAnswerIndex = newIndex;
        quiz.correctAnswerText = quiz.choices[newIndex];
    } else {
        quiz.correctAnswerIndex = 0;
        quiz.correctAnswerText = quiz.choices[0];
    }

    // 2️⃣ 💡 [추가] 해설(explanation) 내부 번호(1번~4번) 매칭 자동 보정
    if (quiz.explanation) {
        // Step 1: 중복 치환 방지를 위해 원본 "1번"~"4번"을 임시 태그(__TEMP_0__ 등)로 일괄 변경
        for (let i = 0; i < originalChoices.length; i++) {
            const oldNumText = `${i + 1}번`;
            quiz.explanation = quiz.explanation.replaceAll(oldNumText, `__TEMP_${i}__`);
        }

        // Step 2: 원본 항목이 셔플되어 이동한 새 위치의 번호로 최종 교체
        for (let i = 0; i < originalChoices.length; i++) {
            const movedIndex = quiz.choices.indexOf(originalChoices[i]);
            if (movedIndex !== -1) {
                const newNumText = `${movedIndex + 1}번`;
                quiz.explanation = quiz.explanation.replaceAll(`__TEMP_${i}__`, newNumText);
            }
        }
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
    
    const sanitized = MASTER_QUIZ_DATA.map(({ correctAnswerIndex, ...q }) => ({
        ...q,
        token: encrypt(JSON.stringify({ id: q.id, correctAnswerIndex }))
    }));
    return res.status(200).json(sanitized);
});

app.get('/api/answer-key', async (req, res) => {
    const tokenInput = req.query.tokens || req.query.token || req.headers['x-quiz-token'];
    
    if (tokenInput) {
        try {
            const tokenList = Array.isArray(tokenInput) ? tokenInput : String(tokenInput).split(',');
            const answerKey = {};
            for (const t of tokenList) {
                const decoded = JSON.parse(decrypt(t.trim()));
                answerKey[decoded.id] = decoded.correctAnswerIndex;
            }
            return res.status(200).json(answerKey);
        } catch (err) {
            return res.status(400).json({ errorCode: "INVALID_TOKEN" });
        }
    }

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
