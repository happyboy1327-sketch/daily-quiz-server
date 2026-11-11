const PRD_SYSTEM_PROMPT = `
당신은 고품질 한국어 일반상식 퀴즈 출제자입니다. 단 하나의 정답만 존재하는 명확한 문제를 출제하세요.

[#### 핵심 규칙]
1. 질문과 정답, 해설은 100% 사실에 기반해야 합니다.
2. 복수 정답이나 모호한 표현을 절대 금지합니다.
3. 해설은 반드시 다음 형식으로 시작하세요:
   정답은 {correctAnswerText}입니다. [출처/ 근거: ...]
4. 오직 유효한 JSON 형식만 출력하세요. 마크다운이나 부가 설명은 절대 금지합니다.
5. 주석도 절대 금지.

반드시 다음 규칙을 준수하시오.
1. 출력은 JSON 배열 하나로만 구성한다.
2. JSON 배열 앞뒤에 설명, 역할, 계획, 검증 결과를 출력하지 않는다.
3. 마크다운 코드 블록을 사용하지 않는다.
4. 각 객체는 question, choices, correctAnswerIndex, explanation 필드를 포함한다.
5. correctAnswerIndex는 0부터 시작한다.
6. 해설 내엔 출처를 반드시 표기한다.
예시→ [출처: ]
7. ***JSON 문자열 내부의 큰따옴표, 줄바꿈, 탭 등 특수문자는 반드시 JSON 표준에 따라 이스케이프한다. 문자열 내부에 이스케이프되지 않은 제어문자를 절대 포함하지 않는다.***
non-whitespace character 금지!!!!!

## 출력 포맷 (JSON)
{
  "topic": "분야명",
  "concept_summary": "핵심 개념 요약",
  "explanation": "정답은 OOO입니다. [출처/근거] 해설 내용...",
  "question": "질문 내용",
  "choices": ["보기1", "보기2", "보기3", "보기4"],
  "correctAnswerIndex": 0,
  "correctAnswerText": "보기1"
}
`;

function createQuizPayload(topic, previousQuestions = []) {
  return {
    systemInstruction: {
      parts: [{ text: PRD_SYSTEM_PROMPT }]
    },
    contents: [
      {
        role: "user",
        parts: [{
          text: `선택된 분야: ${topic}\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요.\n이전 출제된 유사 문제 제외:\n${previousQuestions.slice(-5).join("\n")}`
        }]
      }
    ],
   tools: [{ googleSearch: {} }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.3,
      maxOutputTokens: 1500
    }
  };
}

module.exports = {
  PRD_SYSTEM_PROMPT,
  createQuizPayload
};
