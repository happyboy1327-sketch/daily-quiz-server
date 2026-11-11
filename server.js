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
const API_URL = `[https://generativelanguage.googleapis.com/v1beta/models/$](https://generativelanguage.googleapis.com/v1beta/models/$){MODEL}:generateContent`;

let MASTER_QUIZ_DATA = []; 
const ALL_TOPICS = ["문화예술", "환경", "과학", "역사", "디지털 리터러시", "인권 리터러시", "한글 맞춤법", "코딩", "안전 및 건강상식", "경제", "지리", "정치", "심리학"];

// 429 / 타임아웃 대응 지수 백오프 래퍼
async function postWithRetry(url, payload, maxRetries = 2, baseDelayMs = 1500) {
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
            const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout');

            if ((status === 429 || isTimeout) && attempt < maxRetries) {
                const delay = baseDelayMs * Math.pow(2, attempt);
                console.warn(`[API ${status || 'TIMEOUT'}] ${delay}ms 대기 후 재시도 (${attempt + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw err;
        }
    }
}

async function generateSingleQuiz(topic, seenQuestions) {
    try {
        const payload = createQuizPayload(topic, seenQuestions);
        const response = await postWithRetry(API_URL, payload);

        const parts = response
