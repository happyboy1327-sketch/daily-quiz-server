// app.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const { createQuizPayload } = require('./prdPrompt');

const app = express();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'default-quiz-secret-key-32bytes';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(String(TOKEN_SECRET)).digest();
const ALGORITHM = 'aes-256-gcm';

// --- 유틸리티 ---
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

/**
 * JSON 추출 함수: 
 * 모델이 실수로 마크다운이나 텍스트를 섞더라도 JSON 부분만 찾아냄
 */
function extractJsonFromText(rawText) {
    let text = rawText.trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("JSON 구조를 찾을 수 없습니다.");
    return text.slice(start, end + 1);
}

async function postWithRetry(url, payload, maxRetries = 2) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await axios.post(url, payload, {
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
                timeout: 150000 // 검색+사고 시간을 위해 넉넉히 2.5분 설정
            });
        } catch (err) {
            const status = err.response?.status;
            if ((status === 429 || status >= 500) && attempt < maxRetries) {
                await new Promise(res => setTimeout(res, 3000 * Math.pow(2, attempt)));
                continue;
            }
            throw err;
        }
    }
}

// --- 핵심 로직 ---
async function generateSingleQuiz(topic, seenQuestions) {
    const MODEL = 'gemma-4-26b-a4b-it';
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

    try {
        const payload = createQuizPayload(topic, seenQuestions);
        const response = await postWithRetry(API_URL, payload);

        const candidate = response.data?.candidates?.[0];
        if (!candidate || !candidate.content?.parts) {
            throw new Error("모델로부터 유효한 응답 파트를 받지 못했습니다.");
        }

        // [충돌 방지의 핵심] 
        // candidate.content.parts에는 'thought' 파트와 'text' 파트가 나뉘어 있음.
        // 우리는 오직 'text' 파트(JSON이 담긴 곳)만 찾는다.
        const textPart = candidate.content.parts.find(p => p.text);
        
        if (!textPart) {
            // 만약 text가 없다면 모델이 검색/사고만 하고 JSON을 안 뱉은 것임
            throw new Error("모델이 JSON 응답을 생성하지 못했습니다. (사고/검색 단계에서 멈춤)");
        }

        const cleanJson = extractJsonFromText(textPart.text);
        const parsed = JSON.parse(cleanJson);

        // 데이터 검증
        if (!parsed.question || !parsed.choices || parsed.choices.length !== 4) {
            throw new Error("JSON 데이터 형식이 유효하지 않습니다.");
        }

        return {
            topic: parsed.topic || topic,
            question: parsed.question,
            choices: parsed.choices,
            correctAnswerIndex: parsed.correctAnswerIndex ?? 0,
            correctAnswerText: parsed.correctAnswerText || parsed.choices[parsed.correctAnswerIndex ?? 0],
            explanation: parsed.explanation
        };

    } catch (err) {
        console.error(`❌ [Error - ${topic}]:`, err.message);
        return null;
    }
}

// --- API 엔드포인트 ---
const ALL_TOPICS = ["문화예술", "환경", "과학", "역사", "디지털 리터러시", "인권 리터러시", "한글 맞춤법", "코딩", "안전 및 건강상식", "경제", "지리", "정치", "심리학"];
let MASTER_QUIZ_DATA = [];

app.use(cors());
app.use(express.json());

app.post('/api/quiz', async (req, res) => {
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const seenQuestions = history.map(h => (h.question || '').trim()).filter(Boolean);

    const shuffledTopics = [...ALL_TOPICS].sort(() => Math.random() - 0.5).slice(0, 5);
    MASTER_QUIZ_DATA = [];

    // 병렬 처리를 통해 속도 향상 (Promise.all)
    const quizPromises = shuffledTopics.map(topic => generateSingleQuiz(topic, seenQuestions));
    const results = await Promise.all(quizPromises);
    
    MASTER_QUIZ_DATA = results.filter(q => q !== null);

    if (MASTER_QUIZ_DATA.length === 0) {
        return res.status(503).json({ errorCode: "DATA_UNAVAILABLE" });
    }

    const sanitized = MASTER_QUIZ_DATA.map((q, idx) => {
        const { correctAnswerIndex, ...rest } = q;
        return {
            ...rest,
            id: idx + 1,
            token: encrypt(JSON.stringify({ id: idx + 1, correctAnswerIndex }))
        };
    });

    res.status(200).json(sanitized);
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
        } catch (err) { return res.status(400).json({ errorCode: "INVALID_TOKEN" }); }
    }
    res.status(503).json({ errorCode: "DATA_UNAVAILABLE" });
});

app.post('/api/reset-quiz', (req, res) => { MASTER_QUIZ_DATA = []; res.json({ success: true }); });
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
