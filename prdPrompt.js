function createQuizPayload(topic, previousQuestions = []) {
  const promptText = ` 
너에게 지정된 퀴즈 주제는 "${topic}"이다.

반드시 "${topic}" 분야에 직접 해당하는 문제만 생성하시오.
다른 분야의 지식이나 문제로 대체하는 행위를 금지한다.
특히 코딩 및 프로그래밍 문제는 주제가 "코딩"인 경우에만 허용한다.
JSON의 topic 값도 반드시 "${topic}"으로 출력한다.
맞춤법 문제는 정확히 현행 국립국어원 기준으로만 낼것. 또한, topic이 한글 맞춤법이면 구글 검색(googleSearch) 툴로 "https://korean.go.kr" 에서 검색할 것.

2026년 최신 정보를 기준으로 중급 난도 상식 퀴즈를 생성하시오.
반드시 다음 규칙을 준수하시오.
1. 각 객체는 지정된 JSON 스키마 필드를 모두 포함한다.
2. choices는 정확히 4개의 보기 문자열 배열이어야 한다.
3. correctAnswerIndex는 0부터 시작한다.
4. 해설 내엔 출처를 반드시 표기한다. 예시: [출처: ...]
5. 복수 정답을 유발하는 문제는 출제 금지.
6. 이전 출제된 유사 문제는 절대 제외한다:
${previousQuestions.slice(-5).join("\n")}
7. 추론 절차와 과정, 확인 과정을 json 내에 절대로 출력하지 마시오.`;

  return {
    contents: [{
      role: 'user',
      parts: [{ text: promptText }]
    }],
    tools: [{ googleSearch: {} }],
    toolConfig: {
      // 검색 도구 사용 시 JSON 응답 파트가 섞이지 않도록 분리
      includeServerSideToolInvocations: true
    },
    generationConfig: { 
      responseMimeType: "application/json",
      // 프롬프트의 출력 형식을 API 스키마로 강제 적용
      responseSchema: {
        type: "OBJECT",
        properties: {
          topic: { 
            type: "STRING",
            description: "지정된 퀴즈 주제"
          },
          concept_summary: { 
            type: "STRING",
            description: "문제의 핵심 내용 요약"
          },
          question: { 
            type: "STRING",
            description: "퀴즈 질문"
          },
          choices: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "정확히 4개의 보기 문자열 배열"
          },
          correctAnswerIndex: { 
            type: "INTEGER",
            description: "정답 인덱스 (0~3)"
          },
          correctAnswerText: { 
            type: "STRING",
            description: "정답 보기의 텍스트"
          },
          explanation: { 
            type: "STRING",
            description: "해설 및 [출처: ...] 표기"
          }
        },
        required: [
          "topic",
          "concept_summary",
          "question",
          "choices",
          "correctAnswerIndex",
          "correctAnswerText",
          "explanation"
        ]
      },
      thinkingConfig: {
        "thinkingLevel": "HIGH"
      },
      temperature: 0.3
    }
  };
}


module.exports = {
  createQuizPayload
};
