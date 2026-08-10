const MODEL_ID = "mistral-small-latest";

const PRD_SYSTEM_PROMPT = `
You are an expert system for generating accurate Korean-language general knowledge quizzes.

## CRITICAL GENERATION CHECKLIST
You MUST satisfy EVERY single rule below before outputting.

### 1. ABSOLUTE TRUTH AND FACTUALITY (NO SPECULATION)
□ **Do NOT guess, speculate, or fabricate any statements under any circumstances.** 
□ **Based on stable, objective, widely accepted, and up-to-date facts.**
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

### 5. ACCURACY CHECKLIST
□ Are all titles of movies, animations, books, and artworks 100% real and verified?
□ Are all facts 100% real and verified?
□ Does the question refrain from falsely attributing modern technology (e.g., 3D CGI) to incorrect historical eras (e.g., 1980s)?
□ For "first ever" (최초) or "record-holding" (최고) claims, are they strictly verified historical milestones? If uncertain, DO NOT generate "first ever" questions.

### 6. OUTPUT FORMAT
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
 * 퓨샷(Few-Shot) 데이터베이스
 */
const FEW_SHOT_DATABASE = {
  "한글 맞춤법": [
    { role: "user", content: "선택된 분야:\n한글 맞춤법\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "한글 맞춤법",
        question: "다음 중 표준 맞춤법에 맞는 올바른 표기는 무엇입니까?",
        choices: ["할게", "할께", "할게여", "할꺼야"],
        correctAnswerIndex: 0,
        correctAnswerText: "할게",
        explanation: "정답은 할게입니다. 어미 '-ㄹ게'는 된소리로 발음되더라도 표기할 때는 기본 형태인 '-ㄹ게'로 적는 것이 올바른 맞춤법입니다. '할께', '할게여', '할꺼야'는 모두 된소리 표기 오류입니다."
      })
    }
  ],
  "DEFAULT": [
    { role: "user", content: "선택된 분야:\n과학\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "과학",
        question: "햇빛이 공기 중의 물방울을 통과할 때 꺾이고 분산되어 나타나는 기상 현상인 무지개와 가장 밀접한 빛의 성질은 무엇입니까?",
        choices: ["빛의 굴절", "빛의 회절", "빛의 간섭", "빛의 편광"],
        correctAnswerIndex: 0,
        correctAnswerText: "빛의 굴절",
        explanation: "정답은 빛의 굴절입니다. 무지개는 태양광이 공기보다 밀도가 높은 물방울에 진입할 때 속도 차이로 인해 진행 방향이 꺾이는 '굴절'과, 파장에 따라 꺾이는 각도가 달라 색이 나누어지는 '분산' 현상이 복합적으로 작용하여 형성됩니다. 반면 빛의 회절은 빛이 장애물 모서리를 돌아 들어가는 현상이고, 간섭은 두 파동이 겹쳐 세기가 변하는 현상이며, 편광은 특정 진동 방향의 빛만 투과하는 현상으로 무지개의 직접적인 원인이 아닙니다."
      })
    }
  ]
};

function getFewShotMessages(topic) {
  return FEW_SHOT_DATABASE[topic] || FEW_SHOT_DATABASE["DEFAULT"];
}

function createQuizPayload(topic, spellingData = null) {
  let systemPrompt = PRD_SYSTEM_PROMPT;

  const shouldUseSpellingData =
    topic === "한글 맞춤법" &&
    Array.isArray(spellingData) &&
    spellingData.length > 0 &&
    Math.random() < 0.7;

  if (shouldUseSpellingData) {
    const selectedSpelling = spellingData[Math.floor(Math.random() * spellingData.length)];
    systemPrompt += `\n\n## Mandatory Spelling Reference Dataset\nWhen generating questions for "한글 맞춤법", you MUST strictly use the following dataset.\nUse 'allowed' terms for correct answers and 'forbidden' terms for distractors/wrong choices:\n${JSON.stringify(selectedSpelling, null, 2)}`;
  }

  return {
    model: MODEL_ID,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      ...getFewShotMessages(topic),
      { role: "user", content: `선택된 분야:\n${topic}\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요.` }
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
