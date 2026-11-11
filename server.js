const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const { createQuizPayload } = require('./prdPrompt');

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
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

let MASTER_QUIZ_DATA = []; 
const ALL_TOPICS = ["문화예술", "환경", "과학", "역사", "디지털 리터러시", "인권 리터러시", "한글 맞춤법", "코딩", "안전 및 건강상식", "경제", "지리", "정치", "심리학"];

// 429 및 타임아웃 대응 지수 백오프 래퍼
async function postWithRetry(url, payload, maxRetries = 2, baseDelayMs = 1000) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await axios.post(url, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': GEMINI_API_KEY
                },
                timeout: 50000
            });
        
} catch (err) {
    const status = err.response?.status;
    const isTimeout =
        err.code === 'ECONNABORTED' ||
        err.message?.includes('timeout');

    const isRetryable =
        status === 429 ||
        [500, 502, 503, 504].includes(status) ||
        isTimeout;

    if (isRetryable && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);

        console.warn(
            `[API ${status || 'TIMEOUT'}] ${delay}ms 대기 후 재시도 (${attempt + 1}/${maxRetries})`
        );

        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
    }

    throw err;
}
    }
}

function extractJsonFromText(rawText) {
    if (typeof rawText !== "string") {
        if (typeof rawText === "object") rawText = JSON.stringify(rawText);
        else throw new Error("응답이 문자열이 아닙니다.");
    }
    
    let text = rawText.trim();
    
    // 마크다운 코드 블록 제거
    if (text.includes("```")) {
        text = text.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
    }
    
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    
    if (start === -1 || end === -1 || end < start) {
        console.error("❌ [JSON 추출 실패] rawText:", JSON.stringify(rawText));
        throw new Error("JSON 객체를 찾지 못했습니다.");
    }

    return text.slice(start, end + 1);
}

async function generateSingleQuiz(topic, seenQuestions) {
    try {
        const payload = createQuizPayload(topic, seenQuestions);
        const response = await postWithRetry(API_URL, payload);

        const parts = response.data?.candidates?.[0]?.content?.parts;
        if (!parts) return null;

        const anb = parts
            .filter(part => typeof part.text === 'string')
            .map(part => part.text)
            .join('');


        const cleanJson = extractJsonFromText(anb);


        const cleanedJsonText = cleanJson.trim()
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/```$/, "")
    .trim();

let parsed;

try {
    parsed = JSON.parse(cleanedJsonText);
} catch (err) {
    const position = Number(
        err.message.match(/position (\d+)/)?.[1]
    );

    console.error('[JSON 파싱 실패]', {
        error: err.message,
        aroundError: Number.isInteger(position)
            ? JSON.stringify(cleanedJsonText.slice(
                Math.max(0, position - 80),
                position + 80
            ))
            : cleanedJsonText
    });

    throw err;
}

        if (!parsed.question || !parsed.choices || parsed.choices.length !== 4) return null;

        return {
            topic: parsed.topic || topic,
            question: parsed.question,
            choices: parsed.choices,
            correctAnswerIndex: parsed.correctAnswerIndex ?? 0,
            correctAnswerText: parsed.correctAnswerText || parsed.choices[parsed.correctAnswerIndex ?? 0],
            explanation: parsed.explanation
        };
    } catch (err) {
    console.error(`[퀴즈 생성 실패 - ${topic}]`, {
        status: err.response?.status,
        statusText: err.response?.statusText,
        errorData: err.response?.data,
        message: err.message
    });

    return null;
}
}

async function fetchNewQuizData(requiredCount = 5, seenQuestions = []) {
    MASTER_QUIZ_DATA = [];
    const shuffledTopics = [...ALL_TOPICS].sort(() => Math.random() - 0.5).slice(0, requiredCount);

    for (const topic of shuffledTopics) {
        const quiz = await generateSingleQuiz(topic, seenQuestions);
        if (quiz) {
            MASTER_QUIZ_DATA.push(quiz);
        }
        await new Promise(res => setTimeout(res, 400));
    }
}

app.post('/api/quiz', async (req, res) => {
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const seenQuestions = history.map(h => (h.question || '').trim()).filter(Boolean);

    await fetchNewQuizData(5, seenQuestions);

    if (MASTER_QUIZ_DATA.length === 0) {
        return res.status(503).json({ errorCode: "DATA_UNAVAILABLE" });
    }

    MASTER_QUIZ_DATA = MASTER_QUIZ_DATA.slice(0, 5).map((q, idx) => ({
        ...q,
        id: idx + 1
    }));

    const sanitized = MASTER_QUIZ_DATA.map(({ correctAnswerIndex, ...q }) => ({
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

    if (MASTER_QUIZ_DATA.length === 0) {
        return res.status(503).json({ errorCode: "DATA_UNAVAILABLE" });
    }
    
    const answerKey = MASTER_QUIZ_DATA.reduce((acc, q) => {
        acc[q.id] = q.correctAnswerIndex;
        return acc;
    }, {});
    
    return res.status(200).json(answerKey);
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
