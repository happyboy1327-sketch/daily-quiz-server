function createQuizPayload(topic, previousQuestions = []) {
  const promptText = ` 
너에게 지정된 퀴즈 주제는 "${topic}"이다.

반드시 "${topic}" 분야에 직접 해당하는 문제만 생성하시오.
다른 분야의 지식이나 문제로 대체하는 행위를 금지한다.
특히 코딩 및 프로그래밍 문제는 주제가 "코딩"인 경우에만 허용한다.
JSON의 topic 값도 반드시 "${topic}"으로 출력한다.
맞춤법 문제는 정확히 현행 국립국어원 기준으로만 낼것. 또한, topic이 한글 맞춤법이면 구글 검색(googleSearch) 툴로 "https://korean.go.kr/kornorms/m/m_regltn.do?#a" 에서 검색할 것.


2026년 최신 정보를 기준으로 중급 난도 상식 퀴즈를 생성하시오.
반드시 다음 규칙을 준수하시오.
1. 출력은 순수 JSON 객체 하나로만 구성한다.
2. **JSON 앞뒤에 설명, 역할, 계획, 검증 결과와 부가 내용을 절대 절대로 출력하지 않는다.** (분명 하지 말라 했다!! 안하면 뒤진다)
3. internal error 유발하는 마크다운 코드 블록을 절대 사용하지 않는다.
4. 각 객체는 topic, question, choices, correctAnswerIndex, correctAnswerText, explanation 필드를 모두 포함한다.
5. choices는 정확히 4개의 보기 문자열 배열이어야 한다.
6. correctAnswerIndex는 0부터 시작한다.
7. 해설 내엔 출처를 반드시 표기한다. 예시: [출처: ...]
8. 복수 정답을 유발하는 문제는 출제 금지.
9. 이전 출제된 유사 문제는 절대 제외한다:
${previousQuestions.slice(-5).join("\n")}
10. **추론 절차와 과정, 확인 과정을 json 내에 절대로 출력하지 마시오.**

출력 형식:
{
  "topic": "${topic}",
  "concept_summary": "문제의 핵심내용",
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
        thinkingLevel: "high"
      },
      temperature: 0.3
    }
  };
}

module.exports = {
  createQuizPayload
};
