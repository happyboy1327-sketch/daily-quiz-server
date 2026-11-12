// prdPrompt.js

function createQuizPayload(topic, previousQuestions = []) {
  const promptText = `
[ROLE]
너는 전문적인 퀴즈 생성 에이전트이다.

[TASK]
${topic}에 대한 중급 난도 상식 퀴즈를 생성하라.

[INTERNAL PROCESS]
1. Thinking: 문제 생성 전, 해당 주제의 핵심 개념을 논리적으로 설계하라.
2. Grounding: 반드시 google_search 도구를 사용하여 2025-2026년 기준 최신 정보와 정확한 사실을 확인하라.
* 위 과정은 내부에서만 수행하여야 하며, 절대로 텍스트로 출력 금지.

[OUTPUT RULE - CRITICAL]
1. 반드시 아래의 JSON 형식을 준수하여 응답하라.
2. **JSON 외에 어떠한 설명, 인사말, 생각 과정, 검색 결과 요약도 포함하지 마라.**
3. **오직 순수한 JSON 객체 하나만 출력하라.**
4. **topic 필드 안엔 13가지 분야 중 선택된 분야만 넣고, 절대로 영어는 topic에 삽입하지 말라.** 

[JSON SCHEMA]
{
  "topic": "선택 분야명",
  "concept_summary": "문제의 핵심 내용 요약",
  "question": "질문",
  "choices": ["보기1", "보기2", "보기3", "보기4"],
  "correctAnswerIndex": 0,
  "correctAnswerText": "정답 텍스트",
  "explanation": "해설 [출처: ...]"
}

[CONSTRAINTS]
- ${topic}과 관련 없는 문제는 절대 금지.
- 맞춤법은 국립국어원 기준 준수.
- 복수 정답으로 오류출제 절대 금지.
- choices는 정확히 4개의 보기 문자열 배열.
- correctAnswerIndex는 0부터 시작.
- 이전 문제와 중복 금지:
${previousQuestions.slice(-3).join("\n")}
`;

  return {
    contents: [{
      role: 'user',
      parts: [{ text: promptText }]
    }],
    // ✅ 에러 메시지에 따라 google_search로 수정함
    tools: [{ google_search: {} }], 
    generationConfig: { 
      // ❌ responseMimeType: "application/json" 을 반드시 제거해야 400 에러가 안 납니다.
      // 대신 프롬프트와 extractJsonFromText 함수로 JSON을 뽑아냅니다.
      thinkingConfig: {
        "thinkingLevel": "HIGH"
      },
      temperature: 0.2 
    }
  };
}

module.exports = { createQuizPayload };
