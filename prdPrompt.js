function createQuizPayload(topic, previousQuestions = []) {
  const promptText = `2026년 최신 정보를 기준으로 ${topic} 분야의 중급 난도 상식 퀴즈 1문제를 생성하시오.

반드시 다음 규칙을 준수하시오.
1. 출력은 순수 JSON 객체 하나로만 구성한다.
2. JSON 앞뒤에 설명, 역할, 계획, 검증 결과를 출력하지 않는다.
3. 마크다운 코드 블록을 절대 사용하지 않는다.
4. 각 객체는 topic, question, choices, correctAnswerIndex, correctAnswerText, explanation 필드를 모두 포함한다.
5. choices는 정확히 4개의 보기 문자열 배열이어야 한다.
6. correctAnswerIndex는 0부터 시작한다.
7. 해설 내엔 출처를 반드시 표기한다. 예시: [출처: ...]
8. 이전 출제된 유사 문제는 절대 제외한다:
${previousQuestions.slice(-5).join("\n")}

출력 형식:
{
  "topic": "${topic}",
  "question": "질문",
  "choices": ["보기1", "보기2", "보기3", "보기4"],
  "correctAnswerIndex": 0,
  "correctAnswerText": "보기1",
  "explanation": "해설 [출처: ...]"
}`;

  return {
    contents: [{
      role: 'user',
      parts: [{ text: promptText }]
    }],
    tools: [{ googleSearch: {} }],
    generationConfig: { 
      responseMimeType: "application/json",
      thinkingConfig: {
        thinkingLevel: "minimal"
      },
      temperature: 0.3
    }
  };
}

module.exports = {
  createQuizPayload
};
