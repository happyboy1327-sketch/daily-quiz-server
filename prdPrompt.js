const MODEL_ID = "mistral-small-latest";

const PRD_SYSTEM_PROMPT = `You are an expert system for generating Korean-language general knowledge quizzes.
Generate exactly 5 multiple-choice questions (4 options each), with exactly 1 question from each of the 5 selected categories.

[Mandatory Rules]
1. Generate exactly 1 question per category, for a total of 5 questions. Difficulty should be intermediate.
2. ***Every question must be based on objective facts, up-to-date information, and widely accepted knowledge. The question must clearly define its assumptions and scope. Outdated information is not allowed.***
- **Do not generate subjective or relative comparison questions.**
3. Avoid simple memorization questions based on basic facts (who, what, when, where, etc.). Instead, create questions that require understanding of concepts, principles, causes, definitions, or effects.
- **However, do not ask about specific legal article numbers or detailed statutory provisions.**
4. ***Do not include any Hanja (Chinese characters) or Chinese-language text under any circumstances.***
5. The choices array must contain exactly 4 unique strings.
6. correctAnswerText must match the selected choice exactly, character for character.
7. ***correctAnswerIndex must be the index (0–3) of the one and only correct answer. There must never be multiple correct answers or ambiguity.***
8. ***The explanation must always begin with "The correct answer is {correctAnswerText}."***
- Do not automatically adjust grammar when inserting correctAnswerText. Copy it exactly from the choices array.
- Clearly and thoroughly explain why each incorrect choice is wrong.
- Do not use vague statements such as "the others are incorrect," and do not artificially lengthen explanations.
9. **Do not confuse closely related concepts that differ in definition, scope, or numerical values.**
- The subject being asked in the question must correspond exactly one-to-one with the correct answer and the explanation.`;

[출력 JSON 구조]
{
  "quizzes": [
    {
      "topic": "분야명",
      "question": "질문 내용",
      "choices": ["보기1", "보기2", "보기3", "보기4"],
      "correctAnswerIndex": 0,
      "correctAnswerText": "보기1",
      "explanation": "정답은 보기1입니다. 상세 해설..."
    }
  ]
}`;

module.exports = { PRD_SYSTEM_PROMPT };

function createQuizPayload(selectedTopics) {
    return {
        model: MODEL_ID,
        response_format: { type: "json_object" },
        messages: [
            {
                role: "system",
                content: PRD_SYSTEM_PROMPT
            },
            {
                role: "user",
                content: `선택된 5개 분야:\n${selectedTopics.join(", ")}\n\n위 분야에 맞는 중급 난도의 퀴즈 5개를 JSON 형식으로 출제해주세요.`
            }
        ],
        temperature: 0.1,
        reasoning_effort: "high",
        max_tokens: 4500
    };
}

module.exports = {
    MODEL_ID,
    createQuizPayload
};
