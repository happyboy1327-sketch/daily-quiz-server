const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const seedrandom = require('seedrandom');
const crypto = require('crypto');
const cheerio = require('cheerio');

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

app.use((req, res, next) => {
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

/**
 * 💡 [핵심 추가] 429 Too Many Requests 대응 지수 백오프 API 호출 래퍼
 */
async function postWithRetry(url, payload, options = {}, maxRetries = 3, baseDelayMs = 2500) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await axios.post(url, payload, options);
        } catch (err) {
            const status = err.response?.status;
            const isRateLimit = status === 429;
            
            if ((isRateLimit || err.code === 'ECONNABORTED') && attempt < maxRetries) {
                // 429 감지 시 지수 대기시간 적용 (2.5초, 5초, 10초)
                const delay = baseDelayMs * Math.pow(2, attempt - 1);
                console.warn(`[API 429 감지] 요청 제한 발생. ${delay}ms 대기 후 재시도합니다... (${attempt}/${maxRetries})`);
                await new Promise(res => setTimeout(res, delay));
            } else {
                throw err;
            }
        }
    }
}

const SPELLING_DATA = [
    { id: "SPACING_DEPENDENT_NOUN_IL", category: "의존 명사", allowed: ["할 일"], forbidden: ["할일"], questionType: "single_correct", explanation: "'일'은 의존 명사이므로 앞말과 띄어 쓴다." },
    { id: "SPACING_DEPENDENT_NOUN_GAJI", category: "의존 명사", allowed: ["몇 가지"], forbidden: ["몇가지"], questionType: "single_correct", explanation: "'가지'는 의존 명사이므로 앞말과 띄어 쓴다." },
    { id: "SPACING_DEPENDENT_NOUN_GEOT", category: "의존 명사", allowed: ["것 같다"], forbidden: ["것같다"], questionType: "single_correct", explanation: "'것'은 의존 명사이므로 앞말과 띄어 쓴다." },
    { id: "SPACING_PUNMAN", category: "띄어쓰기", allowed: ["뿐만 아니라"], forbidden: ["뿐만아니라"], questionType: "single_correct", explanation: "'뿐만 아니라'는 올바르게 띄어 쓴다." },
    { id: "SPACING_SU_BAKKE", category: "조사", allowed: ["할 수밖에 없다"], forbidden: ["할수밖에 없다", "할 수 밖에 없다", "할수밖에없다"], questionType: "single_correct", explanation: "'수'는 의존 명사이므로 띄어 쓰고, '밖에'는 조사이므로 앞말에 붙여 쓴다." },
    { id: "SPACING_GOTBARO", category: "띄어쓰기", allowed: ["곧바로"], forbidden: ["곧 바로"], questionType: "single_correct", explanation: "'곧바로'는 한 단어로 굳어진 부사이다." },
    { id: "SPACING_MYEOTMYES", category: "띄어쓰기", allowed: ["몇몇"], forbidden: ["몇 몇"], questionType: "single_correct", explanation: "'몇몇'은 한 단어이므로 붙여 쓴다." },
    { id: "SPACING_MATASEO_HADA", category: "띄어쓰기", allowed: ["맡아서 하다"], forbidden: ["맡아서하다"], questionType: "single_correct", explanation: "'맡아서'와 '하다'는 각각의 용언이므로 띄어 쓴다." },
    { id: "SPACING_DEPENDENT_NOUN_SU", category: "의존 명사", allowed: ["할 수 있다"], forbidden: ["할수있다"], questionType: "single_correct", explanation: "'수'는 의존 명사이므로 앞말과 띄어 쓴다." },
    { id: "SPACING_DEPENDENT_NOUN_JI", category: "의존 명사", allowed: ["먹은 지 오래되었다"], forbidden: ["먹은지 오래되었다"], questionType: "single_correct", explanation: "시간의 경과를 나타내는 의존 명사 '지'는 앞말과 띄어 쓴다." },
    { id: "SPACING_DEPENDENT_NOUN_MANKUM", category: "의존 명사", allowed: ["아는 만큼"], forbidden: ["아는만큼"], questionType: "single_correct", explanation: "'만큼'이 의존 명사로 쓰인 경우 앞말과 띄어 쓴다." },
    { id: "SPACING_DEPENDENT_NOUN_SSI", category: "의존 명사", allowed: ["김철수 씨"], forbidden: ["김철수씨"], questionType: "single_correct", explanation: "사람의 성이나 이름 뒤에 쓰이는 '씨'는 띄어 쓴다." },
    { id: "SPACING_BBUN_IDA", category: "조사", allowed: ["뿐이다"], forbidden: ["뿐 이다"], questionType: "single_correct", explanation: "이 구성에서 '뿐'은 조사이므로 앞말에 붙여 쓰고 '이다'도 붙여 쓴다." },
    { id: "SPACING_PARTICLE_MAN_IRADO", category: "조사", allowed: ["학교에서만이라도"], forbidden: ["학교 에서만이라도", "학교에서 만이라도", "학교에서만 이라도", "학교 에서 만 이라도"], questionType: "single_correct", explanation: "'에서', '만', '이라도'는 모두 조사이므로 앞말에 붙여 쓴다." },
    { id: "SPACING_AUXILIARY_VERB_01", category: "보조 용언", allowed: ["깨뜨려 버렸다", "깨뜨려버렸다"], forbidden: [], questionType: "multiple_allowed", explanation: "보조 용언은 띄어 쓰는 것을 원칙으로 하되, 일정한 구성에서는 붙여 쓰기도 허용된다." },
    { id: "SPACING_AUXILIARY_VERB_02", category: "보조 용언", allowed: ["읽어 보고", "읽어보고"], forbidden: [], questionType: "multiple_allowed", explanation: "본용언에 '-아/-어'가 연결되고 보조 용언이 이어지는 경우 띄어 쓰는 것을 원칙으로 하되 붙여 쓰기도 허용된다." },
    { id: "ENDING_DOEGETDA", category: "어미 활용", allowed: ["되겠다"], forbidden: ["되갯다", "되겟다", "돼겠다", "되겄다", "됬겠다", "돼갰다"], questionType: "single_correct", explanation: "'되다'에 '-겠-'과 '-다'가 결합한 형태는 '되겠다'이다." },
    { id: "ENDING_DWAETDA", category: "어미 활용", allowed: ["됐다"], forbidden: ["됬다"], questionType: "single_correct", explanation: "'되었다'가 줄어든 말은 '됐다'이다." },
    { id: "ENDING_AN_DWAE", category: "어미 활용", allowed: ["안 돼"], forbidden: ["안되"], questionType: "single_correct", explanation: "'되다'의 활용형 '돼'를 사용하며, 이 구성에서는 '안 돼'로 띄어 쓴다." },
    { id: "ENDING_DWAEOSEO", category: "어미 활용", allowed: ["돼서"], forbidden: ["되서"], questionType: "single_correct", explanation: "'되다'에 '-어서'가 결합한 형태는 '돼서'이다." },
    { id: "ENDING_HARYEOGO", category: "어미 활용", allowed: ["하려고"], forbidden: ["할려고"], questionType: "single_correct", explanation: "'하다'의 활용형은 '하려고'이다." },
    { id: "ENDING_HALGE", category: "어미 활용", allowed: ["할게"], forbidden: ["할께"], questionType: "single_correct", explanation: "약속이나 의지를 나타내는 종결 어미는 '-ㄹ게'로 적으므로 '할게'가 올바르다." },
    { id: "SPELLING_WENIL", category: "표기", allowed: ["웬일"], forbidden: ["왠일"], questionType: "single_correct", explanation: "'웬일'이 올바른 표기이다." },
    { id: "SPELLING_EOI_EOPDA", category: "표기", allowed: ["어이없다"], forbidden: ["어의없다"], questionType: "single_correct", explanation: "'어이없다'가 올바른 표기이다." },
    { id: "SPELLING_GEUMSE", category: "표기", allowed: ["금세"], forbidden: ["금새"], questionType: "single_correct", explanation: "'금세'는 '금시에'가 줄어든 말이므로 '금세'로 적으며, '금새'로 적지 않는다." },
    { id: "SPELLING_MYEOCHIL", category: "표기", allowed: ["며칠"], forbidden: ["몇일"], questionType: "single_correct", explanation: "날짜나 기간을 나타내는 말은 '며칠'로 적는다." },
    { id: "SPELLING_ORENMAN", category: "표기", allowed: ["오랜만"], forbidden: ["오랫만"], questionType: "single_correct", explanation: "'오랜만'이 올바른 표기이다." },
    { id: "SPELLING_SEOLGEOJI", category: "표기", allowed: ["설거지"], forbidden: ["설겆이"], questionType: "single_correct", explanation: "'설거지'가 올바른 표기이다." },
    { id: "SPELLING_ORAETDONGAN", category: "표기", allowed: ["오랫동안"], forbidden: ["오랜동안"], questionType: "single_correct", explanation: "'오랫동안'이 올바른 표기이다." },
    { id: "SPELLING_KKAEKKEUSHI", category: "표기", allowed: ["깨끗이"], forbidden: ["깨끗히"], questionType: "single_correct", explanation: "'깨끗이'가 올바른 표기이다." },
    { id: "SISIOS_NAMUTIP", category: "사이시옷", allowed: ["나뭇잎"], forbidden: ["나무잎"], questionType: "single_correct", explanation: "사이시옷 규정에 따라 '나뭇잎'으로 적는다." },
    { id: "SISIOS_GOGITJIP", category: "사이시옷", allowed: ["고깃집"], forbidden: ["고기집"], questionType: "single_correct", explanation: "사이시옷 규정에 따라 '고깃집'으로 적는다." },
    { id: "SISIOS_JONSETJIP", category: "사이시옷", allowed: ["전셋집"], forbidden: ["전세집"], questionType: "single_correct", explanation: "사이시옷 규정에 따라 '전셋집'으로 적는다." },
    { id: "SISIOS_JANGMATBI", category: "사이시옷", allowed: ["장맛비"], forbidden: ["장마비"], questionType: "single_correct", explanation: "사이시옷 규정에 따라 '장맛비'로 적는다." },
    { id: "SISIOS_DWITBATCIM", category: "사이시옷", allowed: ["뒷받침"], forbidden: ["뒤받침"], questionType: "single_correct", explanation: "사이시옷 규정에 따라 '뒷받침'으로 적는다." },
    { id: "SISIOS_MEORIMAL", category: "사이시옷", allowed: ["머리말"], forbidden: ["머릿말"], questionType: "single_correct", explanation: "'머리말'은 사이시옷을 적지 않는다." },
    { id: "SISIOS_EOJESBAM", category: "사이시옷", allowed: ["어젯밤"], forbidden: ["어제 밤", "어제밤"], questionType: "single_correct", explanation: "사이시옷 규정에 따라 '어젯밤'으로 적는다." },
    { id: "RULE_BULGYEON_BULGYEON", category: "표현", allowed: ["문제가 불거지다"], forbidden: ["문제가 붉어지다", "논란이 붉어지다", "갈등이 붉어지다"], questionType: "single_correct", explanation: "'불거지다'는 속에 있던 것이 밖으로 드러나거나 문제가 드러나는 뜻이며, '붉어지다'와 혼동하지 않는다." },
    { id: "RULE_DWAEDO_DWAE", category: "표기", allowed: ["안 돼", "돼요", "돼서", "되면", "되고", "될 수 있다"], forbidden: ["안 되", "되요", "되서", "돼면", "돼고", "됄 수 있다"], questionType: "single_correct", explanation: "'돼'는 '되어'가 줄어든 말이며, '되'는 뒤에 다른 어미가 이어지는 경우 등에 쓴다. '돼'와 '되'는 문맥에 따라 구별한다." },
    { id: "RULE_AN_ANH", category: "표기", allowed: ["안 먹다", "안 된다", "먹지 않다", "하지 않았다", "좋지 않다", "그렇지 않다"], forbidden: ["않 먹다", "않 된다", "먹지 안다", "하지 안았다", "좋지 안다", "그렇지 안다"], questionType: "single_correct", explanation: "'안'은 부사이고, '않다'는 '아니하다'의 준말로 용언의 일부로 쓰인다." },
    { id: "RULE_WAEN_WAEN", category: "표기", allowed: ["왠지", "왠지 모르게", "웬일", "웬 사람", "웬만하면", "웬 떡"], forbidden: ["웬지", "웬지 모르게", "왠일", "왠 사람", "왠만하면", "왠 떡"], questionType: "single_correct", explanation: "'왠지'는 '왜인지'가 줄어든 말이며, '웬'은 '어찌 된'이나 '어떠한'의 뜻을 나타내는 관형사이다." },
    { id: "RULE_MYEOTCHIL", category: "표기", allowed: ["며칠", "며칠 동안", "며칠 전", "며칠 후", "며칠째"], forbidden: ["몇일", "몇일 동안", "몇일 전", "몇일 후", "몇일째"], questionType: "single_correct", explanation: "'며칠'은 날짜나 기간을 나타내는 말로, 표준어에서는 '며칠'로 적으며 '몇일'로 적지 않는다." },
    { id: "RULE_GEUMSE_GEUMSAE", category: "표기", allowed: ["금세 끝났다", "금세 도착했다", "금세 잊었다", "금세 변했다"], forbidden: ["금새 끝났다", "금새 도착했다", "금새 잊었다", "금새 변했다"], questionType: "single_correct", explanation: "'금세'는 '금시에'가 줄어든 말이므로 '금세'로 적으며, '금새'로 적지 않는다." },
    { id: "RULE_ORAENMAN", category: "표기", allowed: ["오랜만이다", "오랜만에 만나다", "정말 오랜만이야", "오랜만에 연락하다"], forbidden: ["오랫만이다", "오랫만에 만나다", "정말 오랫만이야", "오랫만에 연락하다"], questionType: "single_correct", explanation: "'오랜만'은 '오래간만'의 준말이므로 '오랜만'으로 적는다." },
    { id: "RULE_BANDEUSI_BANDEUSI", category: "표현", allowed: ["반드시 지켜야 한다", "반드시 성공한다", "반듯이 앉다", "반듯이 놓다"], forbidden: ["반듯이 지켜야 한다", "반듯이 성공한다", "반드시 앉다", "반드시 놓다"], questionType: "single_correct", explanation: "'반드시'는 '틀림없이 꼭'의 뜻이고, '반듯이'는 '반듯하게'의 뜻이므로 의미에 따라 구별한다." },
    { id: "RULE_BAE_DA_BAE_DA", category: "표현", allowed: ["옷에 냄새가 배다", "습관이 몸에 배다", "칼로 나무를 베다", "베개를 베다"], forbidden: ["옷에 냄새가 베다", "습관이 몸에 베다", "칼로 나무를 배다", "베개를 배다"], questionType: "single_correct", explanation: "'배다'는 냄새나 습관 등이 스며들거나 익숙해지는 뜻이고, '베다'는 칼 등으로 자르거나 베개를 받치는 뜻이다." },
    { id: "RULE_PUN_PUN", category: "띄어쓰기", allowed: ["할 뿐이다", "알 뿐이다", "너뿐이다", "그 사람뿐이다", "이것뿐이다"], forbidden: ["할뿐이다", "알뿐이다", "너 뿐이다", "그 사람 뿐이다", "이것 뿐이다"], questionType: "single_correct", explanation: "'뿐'은 의존 명사로 쓰일 때 앞말과 띄어 쓰고, 조사로 쓰일 때에는 앞말에 붙여 쓴다." },
    { id: "RULE_DAERO_DAERO", category: "띄어쓰기", allowed: ["들은 대로 말하다", "아는 대로 하다", "법대로 처리하다", "예정대로 진행하다", "마음대로 하다"], forbidden: ["들은대로 말하다", "아는대로 하다", "법 대로 처리하다", "예정 대로 진행하다", "마음 대로 하다"], questionType: "single_correct", explanation: "'대로'는 의존 명사로 쓰이면 앞말과 띄어 쓰고, 조사로 쓰이면 앞말에 붙여 쓴다." },
    { id: "RULE_MANKEUM_MANKEUM", category: "띄어쓰기", allowed: ["노력한 만큼", "먹을 만큼 먹다", "너만큼 잘하다", "그만큼 중요하다", "나만큼은 안다"], forbidden: ["노력한만큼", "먹을만큼 먹다", "너 만큼 잘하다", "그 만큼 중요하다", "나 만큼은 안다"], questionType: "single_correct", explanation: "'만큼'은 의존 명사로 쓰이면 앞말과 띄어 쓰고, 조사로 쓰이면 앞말에 붙여 쓴다." },
    { id: "RULE_LGE_LGE", category: "표기", allowed: ["내가 할게", "다녀올게", "연락할게", "어디로 갈까"], forbidden: ["내가 할께", "다녀올께", "연락할께", "어디로 갈가"], questionType: "single_correct", explanation: "소리는 된소리로 나더라도 약속이나 의지를 나타내는 '-ㄹ게'는 '-ㄹ께'로 적지 않는다. 반면 '-ㄹ까'는 '까'로 적는다." },
    { id: "RULE_ISSDA_EOPDA", category: "표기", allowed: ["있어", "있고", "있으니", "없어", "없고", "없으니"], forbidden: ["이써", "이꼬", "이쓰니", "업써", "업꼬", "업쓰니"], questionType: "single_correct", explanation: "'있다'와 '없다'의 활용형은 발음대로 적지 않고 형태를 밝혀 적는다." }
];

const ALL_TOPICS = [
    "문화예술", "환경", "과학", "역사", "디지털 리터러시", 
    "인권 리터러시", "한글 맞춤법", "코딩", "안전 및 건강상식", 
    "경제", "지리", "정치", "심리학"
];

const HANJA_AND_FOREIGN_REGEX = /[\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0300-\u036F\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF\u0400-\u04FF]/;

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
        return text.replace(/[.,!?·:;'"“”‘’]/g, "").trim();
    }
    return text.replace(/\s+/g, "");
}

function hasDuplicateChoices(quiz) {
    const norm = quiz.choices.map(c => normalizeChoice(c, quiz.topic).toLowerCase());
    return norm.some((a, i) => norm.some((b, j) => i !== j && (a.includes(b) || b.includes(a))));
}

function autoFixQuiz(quiz) {
    if (!quiz || !Array.isArray(quiz.choices)) return quiz;

    const cleanText = text => 
        String(text || '')
            .trim()
            .replace(/^["'`]|["'`]$/g, '')
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\s*\([^)]*\d[^)]*\)/g, '')
            .trim();

    quiz.choices = quiz.choices.map(cleanText);

    if (quiz.correctAnswerText) {
        quiz.correctAnswerText = cleanText(quiz.correctAnswerText);
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
 * 단일 문항 팩트체크 (postWithRetry 적용)
 */
async function validateSingleQuiz(quiz) {
    const payload = {
        model: "mistral-small-latest",
        response_format: { type: "json_object" },
        messages: [
            {
                role: "system",
                content: `
You are a strict trivia fact-checker.
REJECT (valid: false) if any rule fails.

### CRITICAL RULES
1. Distractor Check:
   - REJECT only if a wrong choice is a valid or functionally equivalent alternative answer.
   - Do NOT reject simply because a wrong choice shares the same topic if it fails the core condition.
   - Ensure 1:1 mapping: The explanation must explicitly address and invalidate each wrong choice.
   
2. [Premise & Explanation Match / Century Calculation]
   - Check century math (e.g., 19세기 = 1800년대).
   - [Premise Check] Is the Question's premise 100% historically/factually true? If the premise itself is false, REJECT.
   - [Goalpost Shifting Check] Does the Explanation prove the EXACT premise of the Question? Guard against Goalpost Shifting: If the question asks "When did X start?" but the explanation proves "When did X decrease?", REJECT immediately.

3. [Concept, Numbers, Units & Statistics Consistency (Crucial)]
   - Verify whether the core target asked in the question and the target explained in the answer/explanation are distinct, easily confused concepts.
   - If numbers, units, deadlines, or statistics do not match objective facts even slightly, REJECT immediately.

4. [Korean Grammar Hallucination]
   - If the explanation invents false Korean spacing/grammar rules, REJECT immediately.

5. [Answer Leak & Self-Revealing Choice Check]
   - If a question asks for comparisons, check if the choices contain explicit numerical values that directly give away the answer. If trivially exposed, REJECT.

6. [Explanation Factuality & Historical Accuracy (Crucial)]
   - Strictly verify whether ALL historical facts, dates, relationships, and achievements mentioned inside the Explanation are 100% real-world true.
   - REJECT immediately if the Explanation fabricates false historical claims or false biographies about distractors.

### OUTPUT FORMAT (JSON ONLY)
{
  "valid": true | false,
  "reason": "If false, write EXACTLY 1 concise sentence explaining the failure. If true, leave empty string \"\"."
}
`
            },
            {
                role: "user",
                content: JSON.stringify(quiz)
            }
        ],
        temperature: 0,
        max_tokens: 1350
    };

    try {
        // postWithRetry 적용
        const response = await postWithRetry(API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${MISTRAL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 27000
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
    const CONCURRENCY_LIMIT = 2;

    async function worker() {
        while (index < quizzes.length) {
            const currentIndex = index++;
            results[currentIndex] = await validateSingleQuiz(quizzes[currentIndex]);
            // 요청 간 300ms 미세 대기로 트래픽 폭주 방지
            await new Promise(res => setTimeout(res, 300));
        }
    }

    const workers = Array.from(
        { length: Math.min(CONCURRENCY_LIMIT, quizzes.length) }, 
        () => worker()
    );

    await Promise.all(workers);

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

    const rules = SPELLING_DATA.filter(rule =>
        rule.allowed?.includes(answer) || rule.forbidden?.includes(answer)
    );

    for (const rule of rules) {
        const isAllowed = rule.allowed?.includes(answer);
        const isForbidden = rule.forbidden?.includes(answer);

        if (isAllowed && isForbidden) {
            console.error(`[맞춤법 검증 실패] DB 규칙 충돌: "${answer}"`);
            return false;
        }

        if (rule.questionType === "multiple_allowed") {
            console.error(`[맞춤법 검증 실패] 복수 허용 규칙: "${answer}"`);
            return false;
        }

        if (!isNegative && !isAllowed) {
            console.error(`[맞춤법 검증 실패] 올바른 표기 문제의 잘못된 정답: "${answer}"`);
            return false;
        }

        if (isNegative && !isForbidden) {
            console.error(`[맞춤법 검증 실패] 틀린 표기 문제의 올바른 정답: "${answer}"`);
            return false;
        }
    }

    return true;
}


// Jina 캐시 변수
async function fetchJinaSpellingData() {
    try {
        console.log("[Jina] 국립국어원 무작위 단건 탐색 중...");
        const targetUrl = "https://korean.go.kr/kornorms/m/m_regltn.do?#a";
        
        // Jina AI를 통해 HTML 형식으로 응답 수신
        const response = await axios.get(`https://r.jina.ai/${targetUrl}`, {
            headers: { 'Accept': 'text/html' },
            timeout: 30000 
        });
        
        if (response.data) {
            const $ = cheerio.load(response.data);
            
            // 1. '제N항'을 포함하는 h6 태그들만 탐색 (텍스트 추출은 아직 안 함)
            const ruleElements = Array.from(doc.querySelectorAll('h6'))
                                      .filter(h6 => h6.textContent.trim().match(/^제\s*\d+\s*항/));
            
            if (ruleElements.length === 0) return null;

            // 2. 💡 전체를 수집하지 않고, 여기서 무작위로 딱 1개만 선택!
            const randomIndex = Math.floor(Math.random() * ruleElements.length);
            const selectedRule = ruleElements[randomIndex];

            // 3. 선택된 단 1개의 조항에 대해서만 텍스트 및 예시 추출
            const ruleText = selectedRule.textContent.replace(/\s+/g, ' ').trim();
            let exampleText = "";
            
            let nextSibling = selectedRule.closest('.black14_word') 
                                ? selectedRule.closest('.black14_word').nextElementSibling 
                                : selectedRule.nextElementSibling;
            
            while (nextSibling) {
                // 다음 조항이나 큰 제목이 나오면 탐색 종료
                if (nextSibling.querySelector('h6') || nextSibling.classList?.contains('black14_word') || nextSibling.tagName === 'H4' || nextSibling.tagName === 'H5') {
                    break;
                }
                
                // 긴 해설문(.explnaArea) 제외
                if (nextSibling.classList?.contains('explnaArea')) {
                    nextSibling = nextSibling.nextElementSibling;
                    continue;
                }
                
                // 예시 텍스트 누적
                if (nextSibling.classList?.contains('subList_ex')) {
                    exampleText += nextSibling.textContent.replace(/\s+/g, ' ').trim() + "\n";
                }
                
                nextSibling = nextSibling.nextElementSibling;
            }
            
            // 4. 딱 1개의 조항만 포맷팅하여 바로 반환
            const formattedRule = `[${ruleText}]\n\n[예시]\n${exampleText.trim() || '예시 없음'}`;
            return [formattedRule];
        }
        
        return null;
    } catch (error) {
        console.error("[Jina] 수집 실패, 백업 데이터 사용:", error.message);
        return null;
    }
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
            const rawQuizzes = new Array(selectedTopics.length);
            let topicIndex = 0;
            const CONCURRENCY_LIMIT = 1;

            async function fetchWorker() {
                while (topicIndex < selectedTopics.length) {
                    const currentIndex = topicIndex++;
                    const topic = selectedTopics[currentIndex];

                    let spellingParam = SPELLING_DATA;
                    if (topic === "한글 맞춤법") {
                        spellingParam = await fetchJinaSpellingData();
                    }
                    // 기존 createQuizPayload 호출
                    const payload = createQuizPayload(topic, spellingParam);

                    // postWithRetry 적용
                    const response = await postWithRetry(API_URL, payload, {
                        headers: {
                            'Authorization': `Bearer ${MISTRAL_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 30000
                    });

                    const message = response.data?.choices?.[0]?.message;
                    if (!message?.content) throw new Error(`[${topic}] API 응답이 비어있습니다.`);

                    let rawContent = message.content;
                    if (Array.isArray(rawContent)) {
                        const textPart = rawContent.find(p => p.type === "text" && typeof p.text === "string");
                        rawContent = textPart?.text;
                    }

                    const cleanJson = extractJsonFromText(rawContent);
                    const parsed = JSON.parse(cleanJson);
                    
                    const quiz = parsed.quizzes ? parsed.quizzes[0] : parsed;

                    if (quiz) {
                        quiz.topic = topic;
                    }

                    rawQuizzes[currentIndex] = quiz;
                    // API 연속 충격 완화를 위한 300ms 딜레이
                    await new Promise(res => setTimeout(res, 800));
                }
            }

            const workers = Array.from(
                { length: Math.min(CONCURRENCY_LIMIT, selectedTopics.length) },
                () => fetchWorker()
            );

            await Promise.all(workers);

            if (rawQuizzes.some(q => !q)) {
                throw new Error("일부 퀴즈 생성 실패");
            }

            const processedQuizzes = [];
            const topicSet = new Set();

            for (let quiz of rawQuizzes) {
                quiz = autoFixQuiz(quiz);

                const fullText = [quiz.question, ...quiz.choices, quiz.explanation, quiz.correctAnswerText].join(" ");
                if (HANJA_AND_FOREIGN_REGEX.test(fullText)) {
                    const badChars = [...new Set([...fullText].filter(c => HANJA_AND_FOREIGN_REGEX.test(c)))];
                    console.log("❌ 차단된 문자 목록:", badChars);
                    throw new Error(`금지된 한자/외국 문자 포함: ${badChars.join(", ")}`);
                }

                if (!validateSpellingAnswer(quiz)) {
                    throw new Error("한글 맞춤법: 질문 유형(긍정/부정)과 정답 표기 불일치");
                }

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

            processedQuizzes.forEach((quiz, idx) => {
                const originalText = quiz.choices[quiz.correctAnswerIndex] || quiz.correctAnswerText;
                const originalChoices = [...quiz.choices];

                shuffleArray(quiz.choices, `${Date.now()}_${idx}`);

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

                if (quiz.explanation) {
                    for (let i = 0; i < originalChoices.length; i++) {
                        const oldNumText = `${i + 1}번`;
                        quiz.explanation = quiz.explanation.replaceAll(oldNumText, `__TEMP_${i}__`);
                    }

                    for (let i = 0; i < originalChoices.length; i++) {
                        const movedIndex = quiz.choices.indexOf(originalChoices[i]);
                        if (movedIndex !== -1) {
                            const newNumText = `${movedIndex + 1}번`;
                            quiz.explanation = quiz.explanation.replaceAll(`__TEMP_${i}__`, newNumText);
                        }
                    }
                }
            });

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
            // 실패 시 재시도 대기시간을 2초에서 3.5초로 증대
            await new Promise(resolve => setTimeout(resolve, 3500));
        }
    }
}

async function ensureDataFreshness() {
    if (MASTER_QUIZ_DATA.length > 0 && (Date.now() - LAST_FETCH_TIME) <= ONE_HOUR) {
        return;
    }

    if (fetchPromise) {
        await fetchPromise;
        return;
    }

    fetchPromise = (async () => {
        try {
            let success = false;
            let attempts = 0;
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
