const MODEL_ID = "mistral-small-latest";

// prd.js
const PRD_SYSTEM_PROMPT = `당신은 한국어 상식 퀴즈 출제 시스템이다. 
선택된 5개 분야에 대해 각각 1문항씩 총 5개의 4지선다형 퀴즈를 생성하여라.

[필수 규칙]
1. 분야당 정확히 1문제씩 총 5문제를 생성한다. 문제 난도는 중급.
2. ***모든 문항은 객관적 사실(Fact)과 자료, 통설에 기반해야 하며, 질문의 전제와 기준을 명확히 정해야 한다.*** 
3. 단순 육하원칙식 암기 문제를 금지하고, 기본 개념에 따른 원리, 원인, 영향을 알아야 풀이 가능한 문제를 출제한다.
4. ***한자(漢字) 및 중국어 표기는 절대 포함하지 않는다.***
5. choices 배열은 정확히 4개의 문자열로 구성하고 중복이 없어야 한다.
6. correctAnswerText는 정답으로 정한 choices와 토씨 하나 안 틀리고 일치해야 한다.
7. correctAnswerIndex는 정답의 인덱스(0~3)다. 정답은 오직 하나여야 한다.
8. ***해설(explanation)은 반드시 "정답은 {correctAnswerText}입니다."로 시작해야 한다.***
- 문법 자동 수정 금지: correctAnswerText는 choices의 문자열을 그대로 복사하여 사용.
- 나머지 선택지가 틀린 이유도 명확히 작성해야 한다.

[출력 JSON 구조 및 예시]
{
  "quizzes": [
    {
      "topic": "과학",
      "question": "수온이 상승할 때 바닷물 속 기체 용해도의 변화로 올바른 것은?",
      "choices": [
        "산소의 용해도가 감소한다",
        "산소의 용해도가 증가한다",
        "이산화탄소만 선택적으로 폭발한다",
        "기체의 용해도는 수온과 아무 관련이 없다"
      ],
      "correctAnswerIndex": 0,
      "correctAnswerText": "산소의 용해도가 감소한다",
      "explanation": "정답은 산소의 용해도가 감소한다입니다. 기체의 용해도는 온도에 반비례하므로 수온이 올라가면 기체 용해도가 감소합니다. 따라서 증가한다거나 관련이 없다는 보기는 틀립니다."
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
        max_tokens: 4200
    };
}

module.exports = {
    MODEL_ID,
    createQuizPayload
};
