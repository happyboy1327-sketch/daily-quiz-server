// server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const { createQuizPayload } = require('./prdPrompt');

const app = express();

// ==========================================
// 1. 워커 설정
// ==========================================

const WORKERS = [
    {
        id: 1,
        name: 'WORKER-1',
        model: 'gemma-4-26b-a4b-it',
        apiKey: process.env.GEMINI_API_KEY
    },
    {
        id: 2,
        name: 'WORKER-2',
        model: 'gemma-4-31b-it',
        apiKey: process.env.GEMINI_API_KEY_2
    }
];

// ==========================================
// 2. 보안 설정
// ==========================================

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'default-quiz-secret-key-32bytes';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(String(TOKEN_SECRET)).digest();
const ALGORITHM = 'aes-256-gcm';

// ==========================================
// 3. 유틸리티
// ==========================================

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

    const decipher = crypto.createDecipheriv(
        ALGORITHM,
        ENCRYPTION_KEY,
        Buffer.from(ivHex, 'hex')
    );

    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

function extractJsonFromText(rawText) {
    let text = rawText.trim();

    if (text.includes("```")) {
        text = text.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
    }

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1) {
        throw new Error("JSON 구조를 찾을 수 없습니다.");
    }

    return text.slice(start, end + 1);
}

// ==========================================
// 4. API 재시도
// ==========================================

async function postWithRetry(url, payload, apiKey, maxRetries = 1) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await axios.post(url, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                timeout: 180000
            });

        } catch (err) {
            const status = err.response?.status;

console.error('[GEMINI API DEBUG]', {
    timestamp: new Date().toISOString(),
    attempt: attempt + 1,
    url,
    model: url.split('/models/')[1]?.split(':')[0],
    status,
    axiosCode: err.code,
    responseStatus: err.response?.statusText,
    errorStatus: err.response?.data?.error?.status,
    errorMessage: err.response?.data?.error?.message,
    errorCode: err.response?.data?.error?.code,
    responseHeaders: {
        requestId:
            err.response?.headers?.['x-request-id'] ||
            err.response?.headers?.['request-id'] ||
            err.response?.headers?.['x-goog-request-id'],
        retryAfter: err.response?.headers?.['retry-after']
    },
    payloadBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8')
});

            if (
                (status === 429 || status >= 500) &&
                attempt < maxRetries
            ) {
                const delay = 3000 * Math.pow(2, attempt);

                console.warn(
                    `[${delay}ms 재시도] ${attempt + 1}/${maxRetries}`
                );

                await new Promise(res => setTimeout(res, delay));
                continue;
            }

            throw err;
        }
    }
}

// ==========================================
// 5. 개별 퀴즈 생성
// ==========================================

async function generateSingleQuiz(topic, seenQuestions, worker) {

    if (!worker.apiKey) {
        console.error(
            `[${worker.name}] API 키 미설정`
        );
        return null;
    }

    const API_URL =
        `https://generativelanguage.googleapis.com/v1beta/models/${worker.model}:generateContent`;

    try {
        const payload = createQuizPayload(topic, seenQuestions);

        console.log(
            `\n[${worker.name}] 주제: ${topic} 생성 중...`
        );

        const response = await postWithRetry(
            API_URL,
            payload,
            worker.apiKey
        );

        console.log(
            `[${worker.name}] API 응답 상태: ${response.status}`
        );

        const candidate = response.data?.candidates?.[0];

        if (!candidate || !candidate.content?.parts) {
            console.error(
                `[${worker.name}] 응답 구조 오류:`,
                JSON.stringify(response.data, null, 2)
            );
            return null;
        }

        const parts = candidate.content.parts;

        console.log(
            `[${worker.name}] 수신 파트: ${parts.length}`
        );

        let textPart = null;

        parts.forEach((p, i) => {
            if (p.text) {
                console.log(
                    `[${worker.name}] Part ${i} (text) 발견`
                );
                textPart = p;
            }

            if (p.thought) {
                console.log(
                    `[${worker.name}] Part ${i} (thought) 발견`
                );
            }

            if (p.functionCall) {
                console.log(
                    `[${worker.name}] Part ${i} (functionCall) 발견`
                );
            }
        });

        if (!textPart) {
            console.error(
                `[${worker.name}] 텍스트 파트 없음:`,
                JSON.stringify(parts, null, 2)
            );
            return null;
        }

        console.log(
            `[${worker.name}] 추출 전: ${textPart.text.substring(0, 100)}...`
        );

        const cleanJson = extractJsonFromText(textPart.text);

        console.log(
            `[${worker.name}] 추출 후: ${cleanJson.substring(0, 100)}...`
        );

        const parsed = JSON.parse(cleanJson);

        if (
            !parsed.question ||
            !parsed.choices ||
            parsed.choices.length !== 4
        ) {
            console.error(
                `[${worker.name}] JSON 필드 부족:`,
                parsed
            );
            return null;
        }

        console.log(
            `[${worker.name}] [SUCCESS] ${topic} 생성 완료`
        );

        return {
            topic: parsed.topic || topic,
            question: parsed.question,
            choices: parsed.choices,
            correctAnswerIndex: parsed.correctAnswerIndex ?? 0,
            correctAnswerText:
                parsed.correctAnswerText ||
                parsed.choices[parsed.correctAnswerIndex ?? 0],
            explanation: parsed.explanation
        };

    } catch (err) {

        if (err.response) {
            console.error(
                `[${worker.name}] [API ERROR - ${topic}]`,
                {
                    status: err.response.status,
                    data: err.response.data
                }
            );

        } else {
            console.error(
                `[${worker.name}] [CLIENT ERROR - ${topic}]`,
                err.message
            );
        }

        return null;
    }
}

// ==========================================
// 6. 비동기 병렬 워커
// ==========================================

async function runWorker(worker, topics, seenQuestions) {

    console.log(`\n========== ${worker.name} 시작 ==========`);

    console.log(`[${worker.name}] 모델: ${worker.model}`);
    console.log(`[${worker.name}] 작업 수: ${topics.length}`);

    if (!worker.apiKey) {
        console.error(`[${worker.name}] API 키 미설정 - 작업 건너뜀`);
        return [];
    }

    const successfulResults = [];

    for (const topic of topics) {
        const result = await generateSingleQuiz(
            topic,
            seenQuestions,
            worker
        );

        if (result !== null) {
            successfulResults.push(result);
        }
    }

    console.log(
        `[${worker.name}] 완료: ${successfulResults.length}/${topics.length}`
    );

    return successfulResults;
}

// ==========================================
// 7. 주제 설정
// ==========================================

const ALL_TOPICS = [
    "문화예술",
    "환경",
    "과학",
    "역사",
    "디지털 리터러시",
    "인권 리터러시",
    "한글 맞춤법",
    "코딩",
    "안전 및 건강상식",
    "경제",
    "지리",
    "정치",
    "심리학"
];

let MASTER_QUIZ_DATA = [];

// ==========================================
// 8. Express 설정
// ==========================================

app.use(cors());
app.use(express.json());

// ==========================================
// 9. 퀴즈 생성 API
// ==========================================

app.post('/api/quiz', async (req, res) => {

    try {
        const history = Array.isArray(req.body?.history)
            ? req.body.history
            : [];

        const seenQuestions = history
            .map(h => (h.question || '').trim())
            .filter(Boolean);

        const shuffledTopics = [...ALL_TOPICS]
            .sort(() => Math.random() - 0.5)
            .slice(0, 5);

        MASTER_QUIZ_DATA = [];

        // ----------------------------------
        // 워커별 작업 분배
        // ----------------------------------

        const workerTasks = [
            [],
            []
        ];

        shuffledTopics.forEach((topic, index) => {
            workerTasks[index % 2].push(topic);
        });

        console.log('\n================================');
        console.log('[병렬 퀴즈 생성 시작]');
        console.log('================================');

        // ----------------------------------
// 워커 1, 2 실행 (워커 2는 15초 뒤 시작)
// ----------------------------------

// WORKER-1 즉시 시작
const worker1Promise = runWorker(
    WORKERS[0],
    workerTasks[0],
    seenQuestions
);

// WORKER-1 시작 후 15초 대기
await new Promise(resolve => setTimeout(resolve, 15000));

// WORKER-2 시작
const worker2Promise = runWorker(
    WORKERS[1],
    workerTasks[1],
    seenQuestions
);

// 두 워커 모두 완료될 때까지 대기
const workerResults = await Promise.all([
    worker1Promise,
    worker2Promise
]);

        // ----------------------------------
        // 결과 통합
        // ----------------------------------

        MASTER_QUIZ_DATA = workerResults.flat();

        console.log(
            `[최종 결과] ${MASTER_QUIZ_DATA.length}/5개 생성 성공`
        );

        if (MASTER_QUIZ_DATA.length === 0) {
            return res.status(503).json({
                errorCode: "DATA_UNAVAILABLE"
            });
        }

        // ----------------------------------
        // 정답 암호화
        // ----------------------------------

        const sanitized = MASTER_QUIZ_DATA.map((q, idx) => {

            const { correctAnswerIndex, ...rest } = q;

            return {
                ...rest,
                id: idx + 1,
                token: encrypt(
                    JSON.stringify({
                        id: idx + 1,
                        correctAnswerIndex
                    })
                )
            };
        });

        return res.status(200).json(sanitized);

    } catch (err) {

        console.error(
            '[QUIZ API ERROR]',
            err.message
        );

        return res.status(500).json({
            errorCode: "INTERNAL_SERVER_ERROR"
        });
    }
});

// ==========================================
// 10. 정답 확인 API
// ==========================================

app.get('/api/answer-key', async (req, res) => {

    const tokenInput =
        req.query.tokens ||
        req.query.token ||
        req.headers['x-quiz-token'];

    if (tokenInput) {
        try {
            const tokenList = Array.isArray(tokenInput)
                ? tokenInput
                : String(tokenInput).split(',');

            const answerKey = {};

            for (const t of tokenList) {
                const decoded = JSON.parse(
                    decrypt(t.trim())
                );

                answerKey[decoded.id] =
                    decoded.correctAnswerIndex;
            }

            return res.status(200).json(answerKey);

        } catch (err) {
            return res.status(400).json({
                errorCode: "INVALID_TOKEN"
            });
        }
    }

    return res.status(503).json({
        errorCode: "DATA_UNAVAILABLE"
    });
});

// ==========================================
// 11. 퀴즈 초기화 API
// ==========================================

app.post('/api/reset-quiz', (req, res) => {
    MASTER_QUIZ_DATA = [];

    res.json({
        success: true
    });
});

// ==========================================
// 12. 정적 파일
// ==========================================

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// 13. Vercel 서버리스 export
// ==========================================

module.exports = app;
