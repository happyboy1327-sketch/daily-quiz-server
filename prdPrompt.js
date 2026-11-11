
function createQuizPayload(topic, previousQuestions = []) {
  const promptText = `
[ROLE]
너는 전문적인 퀴즈 생성 에이전트이다.

[TASK]
주제 "${topic}"에 대한 중급 난도 상식 퀴즈를 생성하라.

[INTERNAL PROCESS - DO NOT OUTPUT]
1. Thinking: 문제를 만들기 전, 해당 주제의 핵심 개념을 논리적으로 설계하라.
2. Grounding: 반드시 Google Search를 사용하여 2025-2026년 기준 최신 정보와 정확한 사실(특히 맞춤법, 법률, 과학적 사실)을 확인하라.
* 위 과정은 내부적으로만 수행하며, 절대로 텍스트로 출력하지 마라.

[OUTPUT RULE - STRICT]
1. 오직 지정된 JSON 스키마 형식으로만 응답하라.
2. JSON 외에 어떠한 설명, 인사말, 생각 과정, 검색 결과 요약도 포함하지 마라.
3. JSON 형식이 깨지면 시스템이 즉시 중단되므로, 문법을 완벽하게 준수하라.

[CONSTRAINTS]
- 주제 "${topic}"과 관련 없는 문제는 절대 금지.
- 코딩 문제는 주제가 "코딩"일 때만 허용.
- 맞춤법은 국립국어원 기준 준수.
- choices는 정확히 4개의 보기 문자열 배열.
- correctAnswerIndex는 0부터 시작.
- 해설 내에 반드시 [출처: ...]를 포함할 것.
- 이전 문제와 중복 금지:
${previousQuestions.slice(-5).join("\n")}
`;

  return {
    contents: [{
      role: 'user',
      parts: [{ text: promptText }]
    }],
    // Grounding 사용: 모델이 알아서 검색하고 결과만 가져옴 (충돌 방지의 핵심)
    tools: [{ google_search_retrieval: {} }], 
    generationConfig: { 
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          topic: { type: "STRING" },
          concept_summary: { type: "STRING" },
          question: { type: "STRING" },
          choices: {
            type: "ARRAY",
            items: { type: "STRING" },
            minItems: 4,
            maxItems: 4
          },
          correctAnswerIndex: { type: "INTEGER" },
          correctAnswerText: { type: "STRING" },
          explanation: { type: "STRING" }
        },
        required: ["topic", "concept_summary", "question", "choices", "correctAnswerIndex", "correctAnswerText", "explanation"]
      },
      thinkingConfig: {
        "thinkingLevel": "HIGH" // 깊은 사고 허용
      },
      temperature: 0.2 // 일관성을 위해 온도를 낮춤
    }
  };
}

module.exports = { createQuizPayload };
