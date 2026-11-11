const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TOKEN_SECRET = process.env.TOKEN_SECRET || GEMINI_API_KEY || 'default-quiz-secret-key-32bytes';
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
app.use(cors());
app.use(express.json());

const MODEL = 'gemma-4-26b-a4b-it';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;  let MASTER_QUIZ_DATA = [];  // 429 / 타임아웃 대응 지수 백오프 래퍼 async function postWithRetry(url, payload, maxRetries = 3, baseDelayMs = 2000) { for (let attempt = 0; attempt <= maxRetries; attempt++) { try { return await axios.post(url, payload, { headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY }, timeout: 60000 }); } catch (err) { const status = err.response?.status; const isTimeout = err.code === 'ECONNABORTED' \vert{}\vert{} err.message?.includes('timeout');  if ((status === 429 \vert{}\vert{} isTimeout) && attempt < maxRetries) { const delay = baseDelayMs * Math.pow(2, attempt); console.warn(`[API ${status || 'TIMEOUT'}] ${delay}ms 대기 후 재시도 (${attempt + 1}/${maxRetries})`); await new Promise(resolve => setTimeout(resolve, delay)); continue; } throw err; } } }  // 5문제를 한 번에 요청하여 429 에러를 최소화하고 배열로 파싱 async function fetchNewQuizData(requiredCount = 5, seenQuestions = []) { const promptText = `2026년 최신 정보를 기준으로 주제의 편중 없이 중급 난도의 상식 퀴즈 ${requiredCount}문제를 생성하시오.

반드시 다음 규칙을 준수하시오.
1. 출력은 순수 JSON 배열 하나로만 구성한다.
2. JSON 배열 앞뒤에 설명, 역할, 계획, 검증 결과를 출력하지 않는다.
3. 마크다운 코드 블록(``` 등)을 절대 사용하지 않는다.
4. 각 객체는 topic, question, choices, correctAnswerIndex, correctAnswerText, explanation 필드를 모두 포함한다.
5. choices는 정확히 4개의 보기 문자열 배열이어야 한다.
6. correctAnswerIndex는 0부터 시작한다.
7. 해설 내엔 출처를 반드시 표기한다. 예시: [출처: ...]
8. 이전 출제된 유사 문제는 절대 제외한다:
${seenQuestions.slice(-5).join("\n")}

출력 형식:
[
  {
    "topic": "분야명",
    "question": "질문",
    "choices": ["보기1", "보기2", "보기3", "보기4"],
    "correctAnswerIndex": 0,
    "correctAnswerText": "보기1",
    "explanation": "해설 [출처: ...]"
  }
]`;

    const requestData = {
        contents: [{
            role: 'user',
            parts: [{ text: promptText }]
        }],
        tools: [{ googleSearch: {} }],
        generationConfig: { 
            responseMimeType: "application/json",
            thinkingConfig: {
                thinkingLevel: "minimal"
            },
            temperature: 0.3
        }
    };

    try {
        console.log('[Gemma] 퀴즈 배치 생성 API 호출 시작');
        const response = await postWithRetry(API_URL, requestData);

        const parts = response.data?.candidates?.[0]?.content?.parts;
        if (!parts) {
            console.error('[Gemma] 응답에 생성 결과가 없음');
            MASTER_QUIZ_DATA = [];
            return;
        }

        const answer = parts
            .filter(part => typeof part.text === 'string')
            .map(part => part.text)
            .join('');

        const cleanedJsonText = answer.trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
        const parsedArray = JSON.parse(cleanedJsonText);

        if (!Array.isArray(parsedArray)) {
            throw new Error('JSON 배열 형식이 아닙니다.');
        }

        MASTER_QUIZ_DATA = parsedArray.map((q, idx) => ({
            id: idx + 1,
            topic: q.topic || "일반상식",
            question: q.question,
            choices: q.choices,
            correctAnswerIndex: q.correctAnswerIndex ?? 0,
            correctAnswerText: q.correctAnswerText || q.choices[q.correctAnswerIndex ?? 0],
            explanation: q.explanation
        })).filter(q => q.question && q.choices && q.choices.length === 4);

        console.log(`[Gemma] API 호출 성공: ${MASTER_QUIZ_DATA.length}개 퀴즈 로드됨`);
    } catch (error) {
        console.error('[Gemma] API 호출 실패:', error.message);
        MASTER_QUIZ_DATA = [];
    }
}

app.post('/api/quiz', async (req, res) => {
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const seenQuestions = history.map(h => (h.question || '').trim()).filter(Boolean);

    await fetchNewQuizData(5, seenQuestions);

    if (MASTER_QUIZ_DATA.length === 0) {
        return res.status(503).json({ errorCode: "DATA_UNAVAILABLE" });
    }

    // HTML 프론트엔드가 요구하는 필드 구조 및 암호화 토큰 주입
    const sanitized = MASTER_QUIZ_DATA.slice(0, 5).map(({ correctAnswerIndex, ...q }) => ({
        ...q,
        token: encrypt(JSON.stringify({
            id: q.id,
            correctAnswerIndex
        }))
    }));

    return res.status(200).json(sanitized);
});

app.get('/api/answer-key', async (req, res) => {
    const tokenInput = req.query.tokens || req.query.token || req.headers['x-quiz-token'];
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
});

app.post('/api/reset-quiz', (req, res) => {
    MASTER_QUIZ_DATA = [];
    res.json({ success: true, message: '초기화 완료' });
});

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
