const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const seedrandom = require('seedrandom');
const crypto = require('crypto');
const https = require('https');
const cheerio = require('cheerio');

const { createQuizPayload } = require('./prdPrompt');

const app = express();
const UPSTAGE_API_KEY = process.env.UPSTAGE_API_KEY;

const SERVER_START_TIME = Date.now();
const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;


const TOKEN_SECRET = process.env.TOKEN_SECRET || UPSTAGE_API_KEY || 'default-quiz-secret-key-32bytes';
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
    if (Date.now() - SERVER_START_TIME > TWO_WEEKS) {
        console.log("[Vercel] 인스턴스 2주 경과: 메모리 초기화를 위해 컨테이너 재생성을 수행합니다.");
        process.exit(0);
    }
    
    res.set({
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=59',
        'Vary': 'Accept-Encoding'
    });
    next();
});

const API_URL = "https://api.upstage.ai/v1/chat/completions";
const ONE_HOUR = 3600000; 

let MASTER_QUIZ_DATA = []; 
let LAST_FETCH_TIME = 0;
let LAST_TOPICS = [];
let fetchPromise = null;

/**
 * 💡 [핵심 추가] 429 Too Many Requests 대응 지수 백오프 API 호출 래퍼
 */
//async func
async function postWithRetry(
    url,
    payload,
    options = {},
    maxRetries = 2,
    baseDelayMs = 2500
) {
    // options에 timeout이 없으면 기본 120초(120000ms) 강제 적용
    const requestOptions = {
        timeout: 100000,
        ...options
    };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await axios.post(url, payload, requestOptions);
        } catch (err) {
            const status = err.response?.status;
            const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout');

            console.log(
                `[UPSTAGE ${status || err.code}]`,
                err.response?.data ? JSON.stringify(err.response?.data, null, 2) : err.message
            );

            // 429(Rate Limit) 또는 타임아웃(Timeout) 발생 시 재시도
            if ((status === 429 || isTimeout) && attempt < maxRetries) {
                const delay = baseDelayMs * Math.pow(2, attempt);

                console.warn(
                    `[${status || 'TIMEOUT'}] ${delay}ms 대기 후 재시도 (${attempt + 1}/${maxRetries})`
                );

                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            throw err;
        }
    }
}


const SPELLING_DATA = [
    // ---축약형 허용---
    { id: "PRONOUN_POSTPOSITION_ABBR", category: "대명사 축약 (격조사/주격 결합)", allowed: ["이게 맞다", "이건 책이다", "네가 해라"], forbidden: ["이거이 맞다", "이거시 맞다", "니가 해라"], questionType: "single_correct", explanation: "'이것이→이게', '이것은→이건', '너+가→네가'가 표준 표기이며, '이거이', '니가(서면어)' 등은 비표준어다." },
    { id: "DEPENDENT_NOUN_GUT_ABBR", category: "의존 명사 준말 띄어쓰기", allowed: ["아는 게 힘이다", "할 건 많다", "볼 걸 그랬다", "먹을 거다"], forbidden: ["아는게 힘이다", "할건 많다", "볼걸 그랬다", "먹을거다"], questionType: "single_correct", explanation: "'것이→게', '것은→건', '것을→걸', '것이다→거다'는 정식 준말이며, 의존 명사이므로 앞말과 띄어 써야 한다." },
    { id: "VERB_OE_EO_ABBR", category: "용언 모음 축약 (ㅚ+어 → ㅙ)", allowed: ["내일 봬요", "그러면 안 돼요", "시간이 됐어", "봬서 반갑습니다"], forbidden: ["내일 뵈요", "그러면 안 되요", "시간이 됬어", "뵈서 반갑습니다"], questionType: "single_correct", explanation: "'뵈어→봬', '되어→돼'로 축약된다. 어미 '-요'나 '-서' 앞에서는 '뵈요/되요/뵈서'가 아닌 '봬요/돼요/봬서'가 맞다." },
    { id: "VERB_HA_LESS_VOICED", category: "용언 축약 (안울림소리 뒤 '하' 탈락)", allowed: ["생각건대", "섭섭지 않다", "깨끗지 못하다", "익숙지 않다"], forbidden: ["생각치 못하다", "섭섭치 않다", "깨끗치 못하다", "익숙치 않다"], questionType: "single_correct", explanation: "안울림소리 받침(ㄱ, ㅂ, ㅅ 등) 뒤에서는 '하'가 통째로 줄어 '지/건대'가 된다. ('섭섭치'X -> '섭섭지'O)" },
    { id: "VERB_HA_VOICED", category: "용언 축약 (울림소리 뒤 '하' 축약)", allowed: ["흔치 않다", "만만찮다", "만만치 않다", "그렇잖다"], forbidden: ["흔지 않다", "만만챦다", "만만지 않다", "그렇챦다"], questionType: "single_correct", explanation: "울림소리 받침(ㄴ, ㄹ, ㅁ, ㅇ 및 모음) 뒤에서는 '하'의 'ㅏ'만 줄고 'ㅎ'이 남아 '치/찮'이 된다. '챦'은 잘못된 옛 표기다." },
    { id: "VERB_RESTRICTED_STEM_ABBR", category: "용언 어간 준말 활용 제약", allowed: ["땅을 딛고 서다", "땅을 디뎌 서다", "물건을 갖고 가다", "물건을 가져 가다"], forbidden: ["땅을 딛어 서다", "땅을 딛으니", "물건을 갖아 가다", "물건을 갖어"], questionType: "single_correct", explanation: "'딛다', '갖다' 같은 어간 준말은 자음 어미('-고', '-지') 앞에서만 쓰인다. 모음 어미 결합 시 '딛어/갖아'는 비표준어이며, 본말을 활용한 '디디어(디뎌)', '가지어(가져)'가 올바른 표기다." },
    { id: "VERB_R_STEM_ABBR", category: "용언 '르' 불규칙 어간 준말 활용", allowed: ["머물러 쉬다", "서둘러 일하다", "머무르다", "서두르다"], forbidden: ["머물어 쉬다", "서둘어 일하다", "머물아", "서둘아"], questionType: "single_correct", explanation: "'머무르다/서두르다'의 준말 '머물다/서둘다'는 모음 어미 결합 시 '머물어/서둘어'가 아닌 본말 활용형 '머물러/서둘러'로 써야 한다." },
    { id: "NEGATION_JANKTA_CHANTA", category: "부정 어미 축약 표기 (-잖다/-찮다)", allowed: ["그렇잖다", "적잖다", "만만찮다", "변변찮다"], forbidden: ["그렇챦다", "적챦다", "만만챦다", "변변챦다"], questionType: "single_correct", explanation: "'하지 않다'가 줄어든 표기는 '-찮다', '지 않다'가 줄어든 표기는 '-잖다'이다. '챦'은 맞춤법에 맞지 않는 옛 표기다." },
    { id: "ADVERB_CONJUNCTION_ABBR", category: "부사/접속어 축약어 표기", allowed: ["요컨대 핵심은", "단언컨대 사실이다", "생각건대 맞다"], forbidden: ["요컨데 핵심은", "단언컨데 사실이다", "생각컨데 맞다"], questionType: "single_correct", explanation: "'요약하건대→요컨대', '단언하건대→단언컨대'로 축약되며, 어미 부분은 '-데'가 아닌 '-대'가 올바른 표기다." },
    // --- 의존 명사 ---
    { id: "SPACING_DEPENDENT_NOUN_IL", category: "의존 명사", allowed: ["할 일", "갈 곳", "볼 것", "먹을 것"], forbidden: ["할일", "갈곳", "볼것", "먹을것"], questionType: "single_correct", explanation: "'일', '곳', '것' 등의 의존 명사는 앞말과 띄어 쓴다." },
    { id: "SPACING_DEPENDENT_NOUN_GAJI", category: "의존 명사", allowed: ["몇 가지", "두 가지", "여러 가지", "한 가지"], forbidden: ["몇가지", "두가지", "여러가지", "한가지"], questionType: "single_correct", explanation: "'가지'는 의존 명사이므로 앞말과 띄어 쓴다." },
    { id: "SPACING_DEPENDENT_NOUN_GEOT", category: "의존 명사", allowed: ["것 같다", "갈 것 같다", "먹을 것 같다", "좋을 것 같다"], forbidden: ["것같다", "갈것같다", "먹을것같다", "좋을것같다"], questionType: "single_correct", explanation: "'것'은 의존 명사이므로 앞말과 띄어 쓴다." },
    { id: "SPACING_DEPENDENT_NOUN_SU", category: "의존 명사", allowed: ["할 수 있다", "볼 수 있다", "갈 수 있다", "먹을 수 있다"], forbidden: ["할수있다", "볼수있다", "갈수있다", "먹을수있다"], questionType: "single_correct", explanation: "'수'는 의존 명사이므로 앞말과 띄어 쓴다." },
    { id: "SPACING_DEPENDENT_NOUN_JI", category: "의존 명사", allowed: ["먹은 지 오래되었다", "떠난 지 삼 년이다", "시작한 지 얼마 안 되었다", "헤어진 지 오래다"], forbidden: ["먹은지 오래되었다", "떠난지 삼 년이다", "시작한지 얼마 안 되었다", "헤어진지 오래다"], questionType: "single_correct", explanation: "시간의 경과를 나타내는 의존 명사 '지'는 앞말과 띄어 쓴다." },
    { id: "SPACING_DEPENDENT_NOUN_MANKUM", category: "의존 명사", allowed: ["아는 만큼", "먹을 만큼", "할 만큼", "볼 만큼"], forbidden: ["아는만큼", "먹을만큼", "할만큼", "볼만큼"], questionType: "single_correct", explanation: "'만큼'이 관형사형 어미 뒤에서 의존 명사로 쓰인 경우 앞말과 띄어 쓴다." },
    { id: "SPACING_DEPENDENT_NOUN_SSI", category: "의존 명사", allowed: ["김철수 씨", "홍길동 님", "박영희 양", "이철수 군"], forbidden: ["김철수씨", "홍길동님", "박영희양", "이철수군"], questionType: "single_correct", explanation: "사람의 성이나 이름 뒤에 쓰이는 호칭어 및 관직명은 띄어 쓴다." },

    // --- 띄어쓰기 / 부사 / 조사 ---
    { id: "SPACING_PUNMAN", category: "띄어쓰기", allowed: ["뿐만 아니라"], forbidden: ["뿐만아니라", "뿐 만 아니라", "뿐 만아니라"], questionType: "single_correct", explanation: "'뿐만 아니라'는 올바르게 띄어 쓴다." },
    { id: "SPACING_SU_BAKKE", category: "조사", allowed: ["할 수밖에 없다"], forbidden: ["할수밖에 없다", "할 수 밖에 없다", "할수밖에없다"], questionType: "single_correct", explanation: "'수'는 의존 명사이므로 띄어 쓰고, '밖에'는 조사이므로 앞말에 붙여 쓴다." },
    { id: "SPACING_GOTBARO", category: "띄어쓰기", allowed: ["곧바로", "바로바로", "그때그때", "제각각"], forbidden: ["곧 바로", "바로 바로", "그때 그때", "제 각각"], questionType: "single_correct", explanation: "'곧바로', '그때그때' 등은 한 단어로 굳어진 부사이므로 붙여 쓴다." },
    { id: "SPACING_MYEOTMYES", category: "띄어쓰기", allowed: ["몇몇", "곳곳", "집집마다", "때때로"], forbidden: ["몇 몇", "곳 곳", "집 집마다", "때 때로"], questionType: "single_correct", explanation: "'몇몇', '곳곳' 등은 한 단어이므로 붙여 쓴다." },
    { id: "SPACING_MATASEO_HADA", category: "띄어쓰기", allowed: ["맡아서 하다", "이끌어 가다", "살아 오다", "견뎌 내다"], forbidden: ["맡아서하다", "이끌어가다", "살아오다", "견뎌내다"], questionType: "single_correct", explanation: "각각의 용언이 연결된 구조이므로 띄어 쓴다." },
    { id: "SPACING_BBUN_IDA", category: "조사", allowed: ["뿐이다", "뿐만이다", "뿐이었다", "뿐이겠는가"], forbidden: ["뿐 이다", "뿐 만이다", "뿐 이었다", "뿐 이겠는가"], questionType: "single_correct", explanation: "이 구성에서 '뿐'은 조사이므로 앞말에 붙여 쓰고 서술격 조사 '이다'도 붙여 쓴다." },
    { id: "SPACING_PARTICLE_MAN_IRADO", category: "조사", allowed: ["학교에서만이라도"], forbidden: ["학교 에서만이라도", "학교에서 만이라도", "학교에서만 이라도", "학교 에서 만 이라도"], questionType: "single_correct", explanation: "'에서', '만', '이라도'는 모두 조사이므로 앞말에 붙여 쓴다." },
    { id: "RULE_ROSSEO_ROSEO", category: "조사", allowed: ["학생으로서", "부모로서", "대표로서", "인간으로서"], forbidden: ["학생으로써", "부모로써", "대표로써", "인간으로써"], questionType: "single_correct", explanation: "지위나 자격을 나타낼 때는 조사 '-로서'를 사용한다." },

    // --- 보조 용언 ---
    { id: "SPACING_AUXILIARY_VERB_01", category: "보조 용언", allowed: ["깨뜨려 버렸다", "깨뜨려버렸다", "잊어 버렸다", "잊어버렸다"], forbidden: ["깨뜨려 버 렸다", "잊어 버 렸다"], questionType: "multiple_allowed", explanation: "보조 용언은 띄어 쓰는 것을 원칙으로 하되, 일정한 구성에서는 붙여 쓰기도 허용된다." },
    { id: "SPACING_AUXILIARY_VERB_02", category: "보조 용언", allowed: ["읽어 보고", "읽어보고", "해 보고", "해보고"], forbidden: ["읽 어 보고", "해 보 고"], questionType: "multiple_allowed", explanation: "본용언에 '-아/-어'가 연결되고 보조 용언이 이어지는 경우 띄어 쓰는 것을 원칙으로 하되 붙여 쓰기도 허용된다." },
    { id: "SPACING_AUXILIARY_VERB_JIDA", category: "보조 용언", allowed: ["이루어지다", "밝아지다", "편해지다"], forbidden: ["이루어 지다", "밝아 지다", "편해 지다"], questionType: "single_correct", explanation: "'-아/-어 지다'는 파생어(또는 통합형)로 보아 언제나 붙여 쓴다." },
    { id: "SPACING_AUXILIARY_VERB_HADA", category: "보조 용언", allowed: ["기뻐하다", "슬퍼하다", "귀여워하다", "어려워하다"], forbidden: ["기뻐 하다", "슬퍼 하다", "귀여워 하다", "어려워 하다"], questionType: "single_correct", explanation: "형용사에 붙어 동사를 만드는 '-아/-어 하다'는 붙여 쓴다." },

    // --- 피동 / 사동 표현 ---
    { id: "PASSIVE_DOUBLE_ITHIDA", category: "피동 표현", allowed: ["잊히다", "잊히지 않다", "잊히는 기억", "잊힌 이름"], forbidden: ["잊혀지다", "잊혀지지 않다", "잊혀지는 기억", "잊혀진 이름"], questionType: "single_correct", explanation: "'잊히다'에 '-어 지다'가 중복된 '잊혀지다'는 이중 피동이므로 '잊히다'가 올바르다." },
    { id: "PASSIVE_DOUBLE_YEOLIDA", category: "피동 표현", allowed: ["문이 열리다", "길이 열리다", "마음이 열리다", "생각이 열리다"], forbidden: ["문이 열려지다", "길이 열려지다", "마음이 열려지다", "생각이 열려지다"], questionType: "single_correct", explanation: "피동 접미사 '-리-'와 '-어 지다'가 중복된 '열려지다'는 이중 피동이므로 '열리다'가 올바르다." },
    { id: "CAUSATIVE_SEOLLEDA", category: "사동/피동", allowed: ["가슴이 설레다", "마음이 설레다", "설레는 마음", "설렘"], forbidden: ["가슴이 설레이다", "마음이 설레이다", "설레이는 마음", "설레임"], questionType: "single_correct", explanation: "기본형은 '설레다'이므로 불필요한 사동/피동 접미사가 들어간 '설레이다', '설레임'은 잘못된 표기이다." },
    { id: "CAUSATIVE_MAJCHIDA", category: "사동 표현", allowed: ["정답을 맞히다", "화살을 맞히다", "침을 맞히다", "매를 맞히다"], forbidden: ["정답을 맞추다", "화살을 맞추다", "침을 맞추다", "매를 맞추다"], questionType: "single_correct", explanation: "목표물에 적중하거나 정답을 대답하는 것은 '맞히다'를 쓴다." },
    { id: "CAUSATIVE_MOKMAEDA", category: "사동/피동", allowed: ["목매다", "목매어", "목맴", "목매는"], forbidden: ["목매이다", "목매이어", "목매임", "목매이는"], questionType: "single_correct", explanation: "기본형은 '목매다'가 올바른 표기이다." },

    // --- 어미 활용 ---
    { id: "ENDING_DOEGETDA", category: "어미 활용", allowed: ["되겠다"], forbidden: ["되갯다", "되겟다", "돼겠다", "되겄다", "됬겠다", "돼갰다"], questionType: "single_correct", explanation: "'되다'에 '-겠-'과 '-다'가 결합한 형태는 '되겠다'이다." },
    { id: "ENDING_DWAETDA", category: "어미 활용", allowed: ["됐다"], forbidden: ["됬다", "됫다", "되였다"], questionType: "single_correct", explanation: "'되었다'가 줄어든 말은 '됐다'이다." },
    { id: "ENDING_AN_DWAE", category: "어미 활용", allowed: ["안 돼"], forbidden: ["안 되", "않 돼", "않 되"], questionType: "single_correct", explanation: "'되다'의 활용형 '돼'를 사용하며, 이 구성에서는 '안 돼'로 띄어 쓴다." },
    { id: "ENDING_DWAEOSEO", category: "어미 활용", allowed: ["돼서", "돼야", "됐어", "돼요"], forbidden: ["되서", "되야", "됬어", "되요"], questionType: "single_correct", explanation: "'되다'에 '-어서'가 결합한 형태는 '돼서'이다." },
    { id: "ENDING_HARYEOGO", category: "어미 활용", allowed: ["하려고", "가려고", "먹으려고", "보려고"], forbidden: ["할려고", "갈려고", "먹을려고", "볼려고"], questionType: "single_correct", explanation: "의도를 나타내는 어미는 '-려고'이므로 '하려고'가 올바르다." },
    { id: "ENDING_HALGE", category: "어미 활용", allowed: ["할게", "갈게", "먹을게", "볼게"], forbidden: ["할께", "갈께", "먹을께", "볼께"], questionType: "single_correct", explanation: "약속이나 의지를 나타내는 종결 어미는 '-ㄹ게'로 적으므로 '할게'가 올바르다." },
    { id: "ENDING_DEON_DEUN", category: "어미 활용", allowed: ["하든지 말든지", "가든지 오든지", "먹든지 말든지", "보든지 말든지"], forbidden: ["하던지 말던지", "가던지 오던지", "먹던지 말던지", "보던지 말던지"], questionType: "single_correct", explanation: "선택을 나타낼 때는 '-든지', 과거 회상을 나타낼 때는 '-던지'를 쓴다." },

    // --- 표기 및 사이시옷 ---
    { id: "SPELLING_WENIL", category: "표기", allowed: ["웬일", "웬 떡", "웬만하면", "왠지"], forbidden: ["왠일", "왠 떡", "왠만하면", "웬지"], questionType: "single_correct", explanation: "'왠지'만 '왜인지'의 줄임말이고, 나머지는 관형사 '웬'을 사용한다." },
    { id: "SPELLING_EOI_EOPDA", category: "표기", allowed: ["어이없다"], forbidden: ["어의없다", "어이 없다", "어의 없다"], questionType: "single_correct", explanation: "'어이없다'가 올바른 표기이며, 한 단어이므로 붙여 쓴다." },
    { id: "SPELLING_GEUMSE", category: "표기", allowed: ["금세", "요새", "어느새", "방심한 새"], forbidden: ["금새", "요세", "어느세", "방심한 세"], questionType: "single_correct", explanation: "'금세'는 '금시에'가 줄어든 말로 '금세'가 올바른 표기이다." },
    { id: "SPELLING_MYEOCHIL", category: "표기", allowed: ["며칠"], forbidden: ["몇일", "몇 일", "며 칠"], questionType: "single_correct", explanation: "날짜나 기간을 나타내는 말은 '며칠'로 적는다." },
    { id: "SPELLING_ORENMAN", category: "표기", allowed: ["오랜만"], forbidden: ["오랫만", "오랜 만", "오랫 만"], questionType: "single_correct", explanation: "'오랜만'이 올바른 표기이다." },
    { id: "SPELLING_SEOLGEOJI", category: "표기", allowed: ["설거지", "지푸라기", "끄나풀", "더부살이"], forbidden: ["설겆이", "짚우라기", "끈아풀", "더불살이"], questionType: "single_correct", explanation: "원형을 밝혀 적지 않고 소리 나는 대로 적는 표준어 표기이다." },
    { id: "SPELLING_ORAETDONGAN", category: "표기", allowed: ["오랫동안"], forbidden: ["오랜동안", "오랫 동안", "오랜 동안"], questionType: "single_correct", explanation: "'오랫동안'이 올바른 표기이다." },
    { id: "SPELLING_KKAEKKEUSHI", category: "표기", allowed: ["깨끗이", "느긋이", "번번이", "일찍이"], forbidden: ["깨끗히", "느긋히", "번번히", "일찍히"], questionType: "single_correct", explanation: "'ㅅ' 받침 뒤나 부사 뒤에는 부사화 접미사 '-이'를 붙여 적는다." },
    { id: "SISIOS_NAMUTIP", category: "사이시옷", allowed: ["나뭇잎"], forbidden: ["나무잎", "나무 잎", "나뭇 잎"], questionType: "single_correct", explanation: "사이시옷 규정에 따라 '나뭇잎'으로 적는다." },
    { id: "SISIOS_GOGITJIP", category: "사이시옷", allowed: ["고깃집"], forbidden: ["고기집", "고기 집", "고깃 집"], questionType: "single_correct", explanation: "사이시옷 규정에 따라 '고깃집'으로 적는다." },
    { id: "SISIOS_JONSETJIP", category: "사이시옷", allowed: ["전셋집"], forbidden: ["전세집", "전세 집", "전셋 집"], questionType: "single_correct", explanation: "사이시옷 규정에 따라 '전셋집'으로 적는다." },
    { id: "SISIOS_JANGMATBI", category: "사이시옷", allowed: ["장맛비"], forbidden: ["장마비", "장마 비", "장맛 비"], questionType: "single_correct", explanation: "사이시옷 규정에 따라 '장맛비'로 적는다." },
    { id: "SISIOS_DWITBATCIM", category: "사이시옷", allowed: ["뒷받침"], forbidden: ["뒤받침"], questionType: "single_correct", explanation: "사이시옷 규정에 따라 '뒷받침'으로 적는다." },
    { id: "SISIOS_MEORIMAL", category: "사이시옷", allowed: ["머리말"], forbidden: ["머릿말"], questionType: "single_correct", explanation: "'머리말'은 사이시옷을 적지 않는다." },
    { id: "SISIOS_EOJESBAM", category: "사이시옷", allowed: ["어젯밤"], forbidden: ["어제밤", "어제 밤", "어젯 밤"], questionType: "single_correct", explanation: "사이시옷 규정에 따라 '어젯밤'으로 적는다." },

    // --- 표현 및 문맥 규칙 ---
    { id: "RULE_BULGYEON_BULGYEON", category: "표현", allowed: ["문제가 불거지다", "논란이 불거지다", "갈등이 불거지다"], forbidden: ["문제가 붉어지다", "논란이 붉어지다", "갈등이 붉어지다"], questionType: "single_correct", explanation: "'불거지다'는 속에 있던 것이 밖으로 드러나거나 문제가 드러나는 뜻이며, '붉어지다'와 혼동하지 않는다." },
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
    { id: "RULE_ISSDA_EOPDA", category: "표기", allowed: ["있어", "있고", "있으니", "없어", "없고", "없으니"], forbidden: ["이써", "이꼬", "이쓰니", "업써", "업꼬", "업쓰니"], questionType: "single_correct", explanation: "'있다'와 '없다'의 활용형은 발음대로 적지 않고 형태를 밝혀 적는다." },
  
  // [제7항] 'ㄷ' 소리로 나는 받침 중 'ㄷ'으로 적을 근거가 없는 것은 'ㅅ'으로 적음
    { id: "ARTICLE7_SUTJEOPDA", category: "한글 맞춤법 제7항", allowed: ["숫접다", "숫접어", "숫접은", "숫접게"], forbidden: ["숟접다", "숟접어", "숟접은", "숟접게"], questionType: "single_correct", explanation: "'ㄷ' 소리로 나는 받침 중에서 'ㄷ'으로 적을 근거가 없으므로 'ㅅ'으로 적은 '숫접다'가 올바른 표기이다." },
    { id: "ARTICLE7_DEOTNATDA", category: "한글 맞춤법 제7항", allowed: ["덧나다", "덧나", "덧나니", "덧나는"], forbidden: ["덛나다", "덛나", "덛나니", "덛나는"], questionType: "single_correct", explanation: "'ㄷ' 소리로 나는 받침 중에서 'ㄷ'으로 적을 근거가 없으므로 'ㅅ'으로 적은 '덧나다'가 올바른 표기이다." },

  // [제28항] 끝소리가 'ㄹ'인 말에 딴 말이 어울릴 때 'ㄹ' 소리가 탈락하는 경우
    { id: "ARTICLE28_SSAJEON", category: "한글 맞춤법 제28항", allowed: ["싸전", "싸전에", "싸전을", "싸전으로"], forbidden: ["쌀전", "쌀전에", "쌀전을", "쌀전으로"], questionType: "single_correct", explanation: "'쌀'과 가게를 뜻하는 '전(廛)'이 결합할 때 'ㄹ' 소리가 탈락하므로 소리 나는 대로 '싸전'으로 적는다." },
    { id: "ARTICLE28_BUSAP", category: "한글 맞춤법 제28항", allowed: ["부삽", "부삽으로", "부삽을", "부삽에"], forbidden: ["불삽", "불삽으로", "불삽을", "불삽에"], questionType: "single_correct", explanation: "'불'과 '삽'이 결합할 때 'ㄹ' 소리가 탈락하므로 소리 나는 대로 '부삽'으로 적는다." },

  // [제29항] 끝소리가 'ㄹ'인 말에 딴 말이 어울릴 때 'ㄹ' 소리가 'ㄷ' 소리로 바뀌는 경우
    { id: "ARTICLE29_JADDADEUMDA", category: "한글 맞춤법 제29항", allowed: ["잗다듬다", "잗다듬어", "잗다듬는", "잗다듬고"], forbidden: ["잘다듬다", "잘다듬어", "잘다듬는", "잘다듬고"], questionType: "single_correct", explanation: "'잘'과 '다듬다'가 결합할 때 'ㄹ' 소리가 'ㄷ' 소리로 바뀌어 나므로 '잗다듬다'로 적는다." },
    { id: "ARTICLE29_SAHEUTNAL", category: "한글 맞춤법 제29항", allowed: ["사흗날", "사흗날에", "사흗날의", "사흗날부터"], forbidden: ["사흘날", "사흘날에", "사흘날의", "사흘날부터"], questionType: "single_correct", explanation: "'사흘'과 '날'이 결합할 때 'ㄹ' 소리가 'ㄷ' 소리로 바뀌어 나므로 '사흗날'로 적는다." }    
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
        model: "solar-pro4",
        response_format: { type: "json_object" },
        messages: [
            {
                role: "system",
                content: `
[시스템 역할]
당신은 퀴즈의 사실성과 논리적 엄밀성을 100% 검증하는 극도로 까다로운 '팩트체크 검증관'입니다.
속도보다 정확성을 최우선하며, 조금이라도 오류·모호함·예외 가능성이 있으면 REJECT{valid: false} 처리합니다.

[필수 검증 절차]

1. 원천 출처(Primary Source) 검증
   - 블로그·요약집·학원 교재는 배제하고 ISO/IEC 표준, 공식 보고서, 법령 조문 등 최상위 공식 자료를 기준으로 검증합니다.
   - 해설 속 조문 내용이 소속된 조항 번호(예: 제1항, 제1조)가 실제와 일치되는지 확인합니다.
   - 해설에 언급된 출처의 명칭, 조항번호, 내용이 실제 주장과 일치하는지 확인합니다.

2. 개념·시간·장소·조건 검증
   - 표준/명세와 실제 구현체(OS·컴파일러 등)를 혼동하지 않았는지 확인합니다.
   - 상관관계와 인과관계, 선후관계, 유사 개념, 대립 개념을 혼동하지 않았는지 확인합니다.
   - 원인과 결과의 시간적 시차(Lag)를 무시하거나 '즉시', '가장 먼저' 등으로 잘못 표현하지 않았는지 확인합니다.
   - 연도·시대·법 개정·국가·기관·플랫폼·환경에 따라 달라지는 사실을 일반화하지 않았는지 확인합니다.
   - '가장 먼저', '반드시', '모두', '직접적으로' 등 절대적 표현은 단 하나의 반례나 예외가 있어도 valid=false 처리합니다.

3. 정답 및 오답지 역검증
   - 정답이 실제로 타당한지 검증합니다.
   - 모든 오답지가 어떤 해석·조건에서도 정답이 될 수 없는지 개별 검증합니다.
   - 문제의 전제조건이 부족하여 복수정답 가능성이 조금이라도 있으면 valid=false 처리합니다.

4. 비판적 심문(Red Teaming)
   - 출제자의 의도와 관계없이 문제·보기·정답·해설·출처를 공격적으로 검토하여 반례와 허점을 찾습니다.

5. 문제 중복 확인
   - 문장 표현이 달라도 정답 단어가 동일하거나 묻고자 하는 핵심 팩트와 보기 구성이 같은 경우 중복(false)으로 처리한다.

[출력 규칙]
- 문제·보기·정답·해설·출처 중 하나라도 오류, 모호함, 조건 누락, 복수정답 가능성이 발견되면:
  {"valid": false, "reason": "발견된 구체적 오류와 이유"}
- 오류가 없고 정답이 유일하며 정확하다고 판단될 때만:
  {"valid": true, "reason": "정확하다고 판단한 핵심 근거"}

### OUTPUT FORMAT
Return ONLY a valid, raw JSON object without markdown code blocks, code fences, or any preamble/postscript text.

{
  "valid": true,
  "reason": ""
}


`
            },
            {
                role: "user",
                content: JSON.stringify(quiz)
            }
        ],
        temperature: 0,
        max_tokens: 1000
    };

    try {
        // postWithRetry 적용
        const response = await postWithRetry(API_URL, payload, {
            headers: {
                'Authorization': `Bearer ${UPSTAGE_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 100000
        });

        const rawContent = response.data?.choices?.[0]?.message?.content;
        
        console.log("[AI RAW RESPONSE]", JSON.stringify(rawContent));
        
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

    const invalidIndices = [];
    for (let i = 0; i < results.length; i++) {
        if (!results[i].valid) invalidIndices.push(i);
    }

    if (invalidIndices.length > 0) {
        return {
            valid: false,
            invalidIndices,
            reason: invalidIndices
                .map(i => `[${i + 1}번 문항 (${quizzes[i].topic})] ${results[i].reason}`)
                .join(" / ")
        };
    }

    return { valid: true, invalidIndices: [], reason: "" };
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


function fetchJinaSpellingData() {
    return new Promise((resolve) => {
        const url = 'https://r.jina.ai/https://korean.go.kr/kornorms/m/m_regltn.do?';
        
        // Jina AI에 HTML 구조를 유지해달라는 헤더 설정
        const options = {
            headers: {
                'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
                'Accept': 'text/html',
                'X-Return-Format': 'html'
            }
        };

        https.get(url, options, (res) => {
    // 429 원인 확인용
    if (res.statusCode === 429) {
        let errorData = '';

        res.on('data', (chunk) => {
            errorData += chunk;
        });

        res.on('end', () => {
            console.error('[Jina 429]', {
                statusCode: res.statusCode,
                headers: res.headers,
                body: errorData
            });

            resolve(null);
        });

        return;
    }

    let data = '';

            res.on('data', (chunk) => { data += chunk; });

            res.on('end', () => {
                if (!data) return resolve(null);

                const $ = cheerio.load(data);
                
                // 1. '제N항' 탐색 (Cheerio 객체 유지)
                const ruleElements = $('h6').filter((_, el) => $(el).text().trim().match(/^제\s*\d+\s*항/));
                if (ruleElements.length === 0) return resolve(null);

                // 2. 무작위 1개 추출
                const randomIndex = Math.floor(Math.random() * ruleElements.length);
                const selectedRule = ruleElements.eq(randomIndex);

                // 3. 텍스트 및 예시 추출
                const ruleText = selectedRule.text().replace(/\s+/g, ' ').trim();
                let exampleText = "";
                
                let nextSibling = selectedRule.closest('.black14_word').length 
                    ? selectedRule.closest('.black14_word').next() 
                    : selectedRule.next();
                
                while (nextSibling.length) {
                    if (nextSibling.find('h6').length || nextSibling.hasClass('black14_word') || nextSibling.is('h4, h5')) {
                        break;
                    }
                    if (nextSibling.hasClass('explnaArea')) {
                        nextSibling = nextSibling.next();
                        continue;
                    }
                    if (nextSibling.hasClass('subList_ex')) {
                        exampleText += nextSibling.text().replace(/\s+/g, ' ').trim() + "\n";
                    }
                    nextSibling = nextSibling.next();
                }
                
                resolve([`[${ruleText}]\n\n[예시]\n${exampleText.trim() || '예시 없음'}`]);
            });

        }).on('error', (err) => {
            console.error('[Jina] 수집 실패:', err.message);
            resolve(null);
        });
    });
}

function isDuplicateQuiz(newQuiz, masterData) {
  if (!newQuiz?.correctAnswerText || !Array.isArray(masterData)) return false;
  const newAns = newQuiz.correctAnswerText.trim();

  return masterData.some(prev => {
    const prevAns = (typeof prev === "string" ? prev : prev?.correctAnswerText || "").trim();
    if (!prevAns) return false;

    // 1. 포함 관계 검사 (예: "지구 자전축" <-> "지구 자전축의 기울기")
    if (prevAns.includes(newAns) || newAns.includes(prevAns)) {
      return true;
    }

    // 2. 주요 단어(2자 이상) 2개 이상 겹침 검사
    const newKeywords = newAns.split(/\s+/).filter(w => w.length >= 2);
    const prevKeywords = prevAns.split(/\s+/).filter(w => w.length >= 2);

    const overlapCount = newKeywords.filter(word =>
      prevKeywords.some(pWord => pWord.includes(word) || word.includes(pWord))
    ).length;

    return overlapCount >= 2;
  });
}

// Node.js 실행 테스트

async function fetchNewQuizData() {
    if (!UPSTAGE_API_KEY) {
        console.error("[ERROR] UPSTAGE_API_KEY 환경변수가 설정되지 않았습니다.");
        return false;
    }

    const selectedTopics = getSelectedTopics();

    console.log(
        `[API] 퀴즈 생성 요청 중... (분야: ${selectedTopics.join(', ')})`
    );

    // ------------------------------------------------------------
    // 💡 [핵심 추출] 토픽 1개 생성 + 1차(구조/포맷) 검증 로직을
    // 재사용 가능한 함수로 분리. 최초 생성뿐 아니라, AI 2차 검증에서
    // 특정 문항만 실패했을 때 그 문항만 재생성하는 데에도 그대로 사용한다.
    // 로직 자체는 기존 fetchWorker 내부 try 블록과 완전히 동일하며,
    // 위치만 재사용 가능하도록 옮겼을 뿐 검증 규칙은 하나도 바뀌지 않았다.
    // ------------------------------------------------------------
    async function generateOneQuiz(topic, label) {
        const MAX_TOPIC_RETRIES = 3; // 토픽당 최대 재시도 횟수

        for (let attempt = 1; attempt <= MAX_TOPIC_RETRIES; attempt++) {
            try {
                let spellingParam = SPELLING_DATA;

                if (topic === "한글 맞춤법") {
                    const fetchedData = await fetchJinaSpellingData();
                    spellingParam = fetchedData || SPELLING_DATA;
                }

                // 💡 재시도할 때마다 새 payload 생성
                const payload = createQuizPayload(topic, spellingParam, MASTER_QUIZ_DATA.map(q => q.question));

                console.log(
                    `[${label}] ${topic} 생성 시도 (${attempt}/${MAX_TOPIC_RETRIES})`
                );

                const response = await postWithRetry(
                    API_URL,
                    payload,
                    {
                        headers: {
                            'Authorization': `Bearer ${UPSTAGE_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 50000
                    },
                    2,
                    2500
                );

                const message = response.data?.choices?.[0]?.message;

                if (!message?.content) {
                    throw new Error("API 응답이 비어있습니다.");
                }

                let rawContent = message.content;

                if (Array.isArray(rawContent)) {
                    const textPart = rawContent.find(
                        p => p.type === "text" &&
                             typeof p.text === "string"
                    );
                    rawContent = textPart?.text;
                }

                if (typeof rawContent === "string") {
                    rawContent = rawContent
                        .replace(/\u00a0/g, ' ')
                        .trim();
                }

                const cleanJson = extractJsonFromText(rawContent);
                const parsed = JSON.parse(cleanJson);

                let quiz = parsed.quizzes
                    ? parsed.quizzes[0]
                    : parsed;

                if (!quiz) {
                    throw new Error("퀴즈 데이터가 없습니다.");
                }

                quiz.topic = topic;

                // ----------------------------------------------------
                // 💡 [핵심 이동] 문제 검증 로직을 재시도 루프 안으로 통합
                // 아래 검증 중 하나라도 실패하면 throw -> catch 이동 -> 새 payload 재생성!
                // ----------------------------------------------------
                quiz = autoFixQuiz(quiz);

                const fullText = [
                    quiz.question,
                    ...(quiz.choices || []),
                    quiz.explanation,
                    quiz.correctAnswerText
                ].join(" ");

                // 1. 한자/외국어 검증
                if (HANJA_AND_FOREIGN_REGEX.test(fullText)) {
                    const badChars = [
                        ...new Set(
                            [...fullText].filter(c => HANJA_AND_FOREIGN_REGEX.test(c))
                        )
                    ];
                    throw new Error(`금지된 한자/외국 문자 포함: ${badChars.join(", ")}`);
                }

                // 2. 맞춤법 질문-정답 불일치 검증
                if (!validateSpellingAnswer(quiz)) {
                    throw new Error("한글 맞춤법: 질문 유형(긍정/부정)과 정답 표기 불일치");
                }

                // 3. 필수 필드 검증
                if (
                    !quiz.topic ||
                    !quiz.question ||
                    !Array.isArray(quiz.choices) ||
                    !quiz.correctAnswerText ||
                    typeof quiz.correctAnswerIndex !== "number" ||
                    !quiz.explanation
                ) {
                    throw new Error("필수 필드 누락");
                }

                // 4. 보기 중복 제거 및 개수 검증
                const seen = new Set();
                quiz.choices = quiz.choices.filter(c => {
                    if (!c) return false;
                    const norm = normalizeChoice(c, quiz.topic).toLowerCase().trim();
                    if (seen.has(norm)) return false;
                    seen.add(norm);
                    return true;
                });

                if (quiz.choices.length < 3) {
                    throw new Error("유효한 보기가 3개 미만입니다.");
                }

                // 5. 정답 인덱스/텍스트 검증
                if (
                    quiz.correctAnswerIndex < 0 ||
                    quiz.correctAnswerIndex > 3 ||
                    quiz.choices[quiz.correctAnswerIndex] !== quiz.correctAnswerText
                ) {
                    throw new Error("정답 인덱스/텍스트 불일치");
                }
                // 5.1 중복 정답 개념 검증
                if (isDuplicateQuiz(quiz, MASTER_QUIZ_DATA)) {
                throw new Error(`중복된 정답/개념 감지: ${quiz.correctAnswerText}`);
                }

                // 6. 해설 접두사 정형화
                const targetPrefix = `정답은 ${quiz.correctAnswerText}입니다.`;
                const trimmedExp = quiz.explanation.trim();

                if (!trimmedExp.startsWith(targetPrefix)) {
                    const splitIndex = trimmedExp.indexOf("입니다.");
                    if (splitIndex !== -1) {
                        const cleanExp = trimmedExp.slice(splitIndex + 4).trim();
                        quiz.explanation = `${targetPrefix} ${cleanExp}`;
                    }
                }

                // 모든 검증 통과 완료
                console.log(
                    `[${label}] ✅ ${topic} 생성 및 검증 성공 (${attempt}번째 시도)`
                );

                await new Promise(resolve => setTimeout(resolve, 1000));
                return quiz; // 성공

            } catch (error) {
                console.warn(
                    `[${label}] ⚠️ ${topic} 실패/검증오류 (${attempt}/${MAX_TOPIC_RETRIES}):`,
                    error.message
                );

                if (attempt < MAX_TOPIC_RETRIES) {
                    console.log(
                        `[${label}] 🔄 ${topic} 새 payload로 재시도 중...`
                    );
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
            }
        }

        console.error(`[${label}] ❌ ${topic} 최종 생성 실패`);
        return null;
    }

    // ------------------------------------------------------------
    // 💡 보기 셔플 + 정답 인덱스/해설 번호 재매핑도 함수로 분리.
    // 기존 forEach 안에 있던 로직과 동일하며, 최초 셔플뿐 아니라
    // 2차 검증 실패 후 재생성된 문제 하나에도 그대로 다시 적용한다.
    // ------------------------------------------------------------
    function shuffleQuizChoices(quiz, idx) {
        const originalText =
            quiz.choices[quiz.correctAnswerIndex] || quiz.correctAnswerText;
        const originalChoices = [...quiz.choices];

        shuffleArray(quiz.choices, `${Date.now()}_${idx}_${Math.random()}`);

        let newIndex = quiz.choices.indexOf(originalText);

        if (newIndex === -1 && originalText) {
            const cleanTarget = originalText.replace(/[\s\.]/g, '');
            newIndex = quiz.choices.findIndex(
                c => c.replace(/[\s\.]/g, '') === cleanTarget
            );
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
                quiz.explanation = quiz.explanation.replaceAll(
                    oldNumText,
                    `__TEMP_${i}__`
                );
            }

            for (let i = 0; i < originalChoices.length; i++) {
                const movedIndex = quiz.choices.indexOf(originalChoices[i]);
                if (movedIndex !== -1) {
                    const newNumText = `${movedIndex + 1}번`;
                    quiz.explanation = quiz.explanation.replaceAll(
                        `__TEMP_${i}__`,
                        newNumText
                    );
                }
            }
        }

        return quiz;
    }

    const rawQuizzes = new Array(selectedTopics.length);
    let topicIndex = 0;

    async function fetchWorker(workerId) {
        while (true) {
            const currentIndex = topicIndex++;

            if (currentIndex >= selectedTopics.length) {
                break;
            }

            const topic = selectedTopics[currentIndex];
            rawQuizzes[currentIndex] = await generateOneQuiz(topic, `WORKER ${workerId}`);
        }
        return rawQuizzes;
    }


    // 워커 1, 워커 2를 1초 시간차로 시작
    const worker1 = fetchWorker(1);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const worker2 = fetchWorker(2);

    await Promise.all([worker1, worker2]);

    // 성공한 문제만 추출 (이미 워커 안에서 모든 1차 상세 검증이 끝난 상태)
    let successfulQuizzes = rawQuizzes.filter(Boolean);

    console.log(
        `[API] 생성 완료: ${successfulQuizzes.length}/${selectedTopics.length}개 성공`
    );

    if (successfulQuizzes.length === 0) {
        console.error("[DATA FAIL] 검증 완료된 퀴즈가 없습니다.");
        return false;
    }

    // 보기 셔플 및 번호 교체 작업
    successfulQuizzes.forEach((quiz, idx) => shuffleQuizChoices(quiz, idx));

    // ------------------------------------------------------------
    // 💡 AI 2차 검증: validateQuizAccuracy는 이제 실패한 문항의
    // 인덱스 목록(invalidIndices)까지 반환한다 (validateSingleQuiz가
    // 이미 문항별로 결과를 갖고 있었으므로, 그중 실패한 것만 모아 반환하도록
    // validateQuizAccuracy를 수정함 — 아래 별도 함수 참고).
    // 검증에 실패한 "그 문항 하나만" 같은 토픽으로 재생성하고,
    // 다시 2차 검증을 돌리는 것을 최대 MAX_VALIDATION_ROUNDS번 반복한다.
    // ------------------------------------------------------------
    console.log(`[API] AI 2차 문항별 병렬 크로스 팩트체크 수행 중...`);

    const MAX_VALIDATION_ROUNDS = 3;
    let validationPassed = false;

    for (let round = 1; round <= MAX_VALIDATION_ROUNDS; round++) {
        const validation = await validateQuizAccuracy(successfulQuizzes);

        if (validation.valid) {
            validationPassed = true;
            break;
        }

        console.warn(
            `[VALIDATION] round ${round}/${MAX_VALIDATION_ROUNDS} 검증 실패: ${validation.reason}`
        );

        if (round === MAX_VALIDATION_ROUNDS) {
            console.error(`[VALIDATION] 최대 재시도(${MAX_VALIDATION_ROUNDS}회) 초과, 최종 검증 실패`);
            return false;
        }

        const invalidIndices = validation.invalidIndices || [];

        if (invalidIndices.length === 0) {
            // validateQuizAccuracy가 실패 인덱스를 특정하지 못한 경우
            // (이론상 발생하지 않아야 하지만 방어적으로 처리)
            console.error("[VALIDATION] 실패 문항을 특정할 수 없어 전체 실패 처리합니다.");
            return false;
        }

        // 실패한 문항만 골라 그 토픽으로 재생성 (병렬)
        await Promise.all(invalidIndices.map(async (idx) => {
            const topic = successfulQuizzes[idx].topic;
            console.log(`[VALIDATION] 🔄 [${idx + 1}번 문항 (${topic})] 2차 검증 실패, 해당 문항만 재생성합니다.`);

            const regenerated = await generateOneQuiz(topic, `REGEN r${round}-i${idx + 1}`);

            if (regenerated) {
                successfulQuizzes[idx] = shuffleQuizChoices(regenerated, idx);
            } else {
                successfulQuizzes[idx] = null;
            }
        }));

        successfulQuizzes = successfulQuizzes.filter(Boolean);

        if (successfulQuizzes.length === 0) {
            console.error("[VALIDATION] 재생성 후 남은 문제가 없습니다.");
            return false;
        }
    }

    if (!validationPassed) {
        return false;
    }

    MASTER_QUIZ_DATA = successfulQuizzes.map((q, idx) => ({
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

    console.log(
        `[API] 퀴즈 생성 및 병렬 2차 검증 최종 승인 완료 (${MASTER_QUIZ_DATA.length}개)`
    );

    return true;
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
