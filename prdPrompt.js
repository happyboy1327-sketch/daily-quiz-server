const MODEL_ID = "mistral-small-latest";

const PRD_SYSTEM_PROMPT = `당신은 한국어 상식 퀴즈 출제 시스템입니다. 
퀴즈를 생성할 때 다음 [병렬형 스테이지 생각 트리]와 [엄격 체크리스트]를 철저히 준수하여 사실(Fact) 기반의 고품질 퀴즈를 출제하십시오.

# [1. 병렬형 스테이지 생각 트리 (Parallel Stage Thinking Tree with Fact-Checking)]

[STAGE 1: 입력 병렬 분해 및 사전 팩트 출처 확정]
 ├─ [Track 1-A] 선택된 5개 분야 파싱 및 수량(정확히 5개) 검증
 ├─ [Track 1-B] 한글 맞춤법 포함 여부 확인 ➔ Seed 제약조건(정답/오답/원칙) 추출 및 국립국어원 규정 검증
 └─ [Track 1-C] 출제 대상 팩트의 출처(교과서, 법령, 학술 백과, 공식 기관) 사전 확보 (할루시네이션 차단)

[STAGE 2: 분야별 독립 생성 및 팩트 검증 트랙]
 ├─ [Branch A: 한글 맞춤법 트랙]
 │   ├─ 규정 기반 (정답/오답/원칙) 팩트를 100% 유지
 │   └─ 표준국어대사전 기준 용법 검증 후 문맥 창작 (마침표 앞 공백 절대 금지)
 │
 ├─ [Branch B: 코딩 트랙]
 │   ├─ 공식 언어 스펙 및 컴파일러/인터프리터 실행 결과 기준 팩트 검증
 │   └─ 마크다운 코드블록 기호 절대 배제, 평문 코드로 지문 작성
 │
 └─ [Branch C: 일반 상식 트랙 (과학/역사/지리/경제 등)]
     └─ 단일 정답의 사실성 확보 및 오답 3개의 확실한 비사실성/오류 검증

[STAGE 3: 팩트 무결성 교차 검증 및 해설 수렴]
 ├─ [Fact Verification Track] 문제-정답-오답 간 사실관계 2차 교차 검증 (교차 검증 실패 시 재생성)
 ├─ [Validation Track] 4개 선택지 간 중복 0% & correctAnswerText 완벽 일치 검증
 └─ [Explanation Track] 팩트 기반 해설 4단계 조립:
     1) 첫 문장 포맷: "정답은 {correctAnswerText}입니다."
     - 문법 자동 수정 금지: correctAnswerText는 choices의 문자열을 그대로 복사하여 사용.
     2) 선택지 단어 직접 인용 및 각 선택지의 사실/허위 여부 설명
     3) 전체 3문장 이상 분량 확보
     4) 오답의 정답 가능성 인정 지문 절대 배제

[STAGE 4: 최종 필터링 및 JSON 수렴]
 ├─ 한자(漢字)/중국어 단 1자도 포함 안 됨 확인
 └─ 해설에 절대적인 불변의 사실이 포함되어 있는가? ➔ JSON 형식 확정 출력

# [2. 엄격 체크리스트 (Hard Constraints)]
- [ ] **모든 문제의 정답과 오답이 교과서/공식 기록/학술 기준 100% 팩트로 검증되었는가?** (할루시네이션 0%)
- [ ] 선택된 분야별 정확히 1문제씩 총 5문제가 생성되었는가?
- [ ] choices 배열의 요소가 정확히 4개이며 중복이 없는가?
- [ ] correctAnswerText가 choices 배열 중 하나와 토씨 하나 안 틀리고 일치하는가?
- [ ] correctAnswerIndex가 choices 내 정답 위치(0~3)와 일치하는가?
- [ ] **해설 첫 문장이 "정답은 {correctAnswerText}입니다."로 시작하는가?**
- [ ] 해설 오답 설명 시 선택지 단어를 직접 인용하여 팩트에 근거해 전체 3문장 이상 작성했는가?
- [ ] 한자(漢字) 및 중국어 표기가 단 한 자도 포함되지 않았는가?`;

function createQuizPayload(selectedTopics) {
    return {
        model: MODEL_ID,
        response_format: {
            type: "json_schema",
            json_schema: {
                name: "quiz_response",
                strict: true,
                schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["quizzes"],
                    properties: {
                        quizzes: {
                            type: "array",
                            minItems: 5,
                            maxItems: 5,
                            items: {
                                type: "object",
                                additionalProperties: false,
                                required: [
                                    "topic",
                                    "question",
                                    "choices",
                                    "correctAnswerIndex",
                                    "correctAnswerText",
                                    "explanation"
                                ],
                                properties: {
                                    topic: { type: "string" },
                                    question: { type: "string" },
                                    choices: {
                                        type: "array",
                                        minItems: 4,
                                        maxItems: 4,
                                        items: { type: "string" }
                                    },
                                    correctAnswerIndex: {
                                        type: "integer",
                                        minimum: 0,
                                        maximum: 3
                                    },
                                    correctAnswerText: { type: "string" },
                                    explanation: {
                                        type: "string",
                                        pattern: "^(.*\\.\\s*)+$"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        messages: [
            {
                role: "system",
                content: PRD_SYSTEM_PROMPT
            },
            {
                role: "user",
                content: `선택된 5개 분야:\n${selectedTopics.join(", ")}\n\n위 5개 분야에 대해 정확히 1문제씩 총 5개의 중급 난도 퀴즈를 생성하세요.`
            }
        ],
        temperature: 0.05,
        max_tokens: 4500
    };
}

module.exports = {
    MODEL_ID,
    createQuizPayload
};
