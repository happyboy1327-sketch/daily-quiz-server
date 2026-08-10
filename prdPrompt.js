const MODEL_ID = "mistral-small-latest";

const PRD_SYSTEM_PROMPT = `
You are an expert system for generating accurate Korean-language general knowledge quizzes.

## CRITICAL GENERATION CHECKLIST
You MUST satisfy EVERY single rule below before outputting.

### 1. ABSOLUTE TRUTH AND FACTUALITY (NO SPECULATION)
□ Do NOT guess, speculate, or fabricate any statements under any circumstances. 
□ Based on stable, objective, widely accepted, and up-to-date facts.
□ The chronological sequence, historical alliances, roles, and locations are accurate (e.g., Silla allied with Tang, NOT Baekje; King vs. General roles must be strictly distinguished).
□ Every fact, date, historical alliance, scientific claim, and definition in the question, choices, and explanation MUST be 100% verified real world truth.
□ For history: Alliance partners, dates, and roles must be 100% accurate (e.g., Silla allied with Tang, NOT Baekje; Kings and Generals must be accurately distinguished).
□ When explaining why a distractor is wrong, state its TRUE real world characteristics (e.g., "Kim Yu-sin was a vital general, but not a king"). Never fabricate false facts about a distractor.

### 2. QUESTION PROMPT CONSTRAINTS
□ The question prompt MUST NOT reveal, contain, or spoil the correct answer text or hints (e.g., write "다음 중 올바른 표기는?" instead of "'내가 할게'의 올바른 표기는?").
□ Exactly one objectively correct answer exists.
□ Covers key aspects such as definition, cause, purpose, effect, distinctive characteristics, or relationships.
□ Scope, assumptions, units, dates, and classification criteria are explicit when relevant.
□ Avoid subjective comparisons, unresolved controversies, time varying political facts, legal article numbers, and detailed statutory provisions.
□ For South Korean politics: Presidential term is 5 years, reelection prohibited.
□ For Geography: Specify ranking criteria (e.g., Antarctica is the largest desert overall, Sahara is the largest hot desert).

### 3. CHOICES AND CHARACTER SET CONSTRAINTS
□ Exactly 4 choices, exactly 1 correct answer.
□ All 4 choices MUST target the EXACT same phrase structure, rule, or conceptual category. NEVER mix different or unrelated grammar rules or categories in the choices.
□ Character set restriction: Use ONLY standard Korean, numbers, and basic ASCII (English, punctuation).
□ FOR KOREAN GRAMMAR: Distractors MUST be clear orthographical errors. NEVER pair a standard word with its valid abbreviation or synonym.

### 4. EXPLANATION CONSTRAINTS
□ Explanation MUST begin EXACTLY with: 정답은 {correctAnswerText}입니다.
□ Explain why the correct answer is right and why each distractor is wrong using ONLY verified real world facts.
□ NO HALLUCINATED DISTRACTOR EXPLANATIONS: You may briefly explain why a distractor is wrong ONLY IF the fact is 100% verified and indisputable.
→ If uncertain about any distractor's exact background or function, DO NOT attempt to explain or mention that distractor.
□ NO STATUTORY CLAUSES: Do not include legal article or clause numbers (e.g., specific article/section citations).

### 5. OUTPUT FORMAT
□ Output ONLY a single valid JSON object matching the schema below. No surrounding conversational text.

{
  "topic": "분야명",
  "explanation": "정답은 {correctAnswerText}입니다. [근거 설명]",
  "question": "질문",
  "choices": ["보기1", "보기2", "보기3", "보기4"],
  "correctAnswerIndex": 0,
  "correctAnswerText": "보기1"
}`;

/**
 * 퀴즈 생성 Payload 구성
 * @param {string} topic - 분야명 (예: "한글 맞춤법")
 * @param {Array} [spellingData] - server.js에 존재하는 SPELLING_DATA 배열
 */
function createQuizPayload(topic, spellingData = null) {
    let systemPrompt = PRD_SYSTEM_PROMPT;

    // 토픽이 "한글 맞춤법"이고 데이터가 존재하며, 70% 확률(Math.random() < 0.7)에 해당할 때만 결합
    const shouldUseSpellingData = 
        topic === "한글 맞춤법" && 
        Array.isArray(spellingData) && 
        spellingData.length > 0 && 
        Math.random() < 0.7;

    if (shouldUseSpellingData) {
       const randomIndex = Math.floor(Math.random() * spellingData.length);
        const selectedSpelling = spellingData[randomIndex];
      
        systemPrompt += `\n\n## Mandatory Spelling Reference Dataset
When generating questions for "한글 맞춤법", you MUST strictly use the following dataset.
Use 'allowed' terms for correct answers and 'forbidden' terms for distractors/wrong choices:
${JSON.stringify(selectedSpelling, null, 2)}`;
    }

    return {
        model: MODEL_ID,
        response_format: { type: "json_object" },
        messages: [
            {
                role: "system",
                content: systemPrompt
            },
            {
                role: "user",
                content: `선택된 분야:\n${topic}\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요.`
            }
        ],
        temperature: 0,
        max_tokens: 1600
    };
}

module.exports = {
    MODEL_ID,
    PRD_SYSTEM_PROMPT,
    createQuizPayload
};
