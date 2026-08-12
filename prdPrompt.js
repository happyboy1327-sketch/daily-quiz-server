const MODEL_ID = "open-mistral-nemo";

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
□ NEVER use subjective or relative terms like "대표적인" (representative), "가장 ~한" (most), or "주요한" (major) in the question prompt.
   - ❌ WRONG: 세종대왕의 대표적인 업적은? (Causes multiple true options)
   - ⭕️ RIGHT: 조선 제4대 왕인 세종대왕 재위 기간에 창제된 한국어의 독자적 문자 체계는?
□ Scope, assumptions, units, dates, and classification criteria are explicit when relevant.
□ Exactly one objectively correct answer exists based on strict 1-to-1 facts.
□ Avoid subjective comparisons, unresolved controversies, time varying political facts, legal article numbers, and detailed statutory provisions.
□ For South Korean politics: Presidential term is 5 years, reelection prohibited.
□ For Geography: Specify ranking criteria (e.g., Antarctica is the largest desert overall, Sahara is the largest hot desert).

### 3. CHOICES AND CHARACTER SET CONSTRAINTS
□ Exactly 4 choices, exactly 1 correct answer. Construct all options to ensure that exactly one indisputably correct answer exists; explicitly state spatial and temporal prerequisites in the question (e.g., distinguishing 'Korean Peninsula' from 'South Korea'); and ensure every incorrect option possesses a scientifically or academically proven 1-to-1 refutation.
□ NEVER list 4 true facts of the SAME entity and ask the user to pick one.
  - Distractors MUST belong to a DIFFERENT person, era, or concept (e.g., If the question is about King Sejong, distractors MUST be achievements of King Yeongjo, Jeongjo, or Gwanghaegun).
□ All 4 choices MUST target the EXACT same phrase structure, rule, or conceptual category. NEVER mix different or unrelated grammar rules or categories in the choices.
□ Character set restriction: Use ONLY standard Korean, numbers, and basic ASCII (English, punctuation). NEVER use the Hanja.
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
  "explanation": "정답은 {correctAnswerText}입니다. [모든 오답의 명확한 근거 설명]",
  "question": "[전제와 조건이 명확한 질문]",
  "choices": ["보기1", "보기2", "보기3", "보기4"],
  "correctAnswerIndex": 0,
  "correctAnswerText": "보기1"
}`;

/**
/**
 * 토픽별 퓨샷(Few-Shot) 데이터베이스
 */
const FEW_SHOT_DATABASE = {
  "정치": [
    { role: "user", content: "선택된 분야:\n정치\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "정치",
        question: "대한민국 현행 헌법상 대통령의 임기와 재임 조건에 대한 설명으로 올바른 것은 무엇입니까?",
        choices: ["임기 5년, 단임제", "임기 4년, 연임 가능", "임기 5년, 중임 가능", "임기 6년, 단임제"],
        correctAnswerIndex: 0,
        correctAnswerText: "임기 5년, 단임제",
        explanation: "정답은 임기 5년, 단임제입니다. 대한민국 현행 헌법 제70조에 따라 대통령의 임기는 5년이며 중임 및 연임이 불가능한 단임제를 채택하고 있습니다."
      })
    }
  ],
  "역사": [
    // [유형 1: 한국사 - 인물 및 정변 타임라인 유형]
    { role: "user", content: "선택된 분야:\n역사\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "역사",
        question: "고려 시대 1170년 무신정변을 주도하여 무신정권을 수립한 대표적인 인물로 올바른 것은 누구입니까?",
        choices: ["정중부", "경대승", "이의민", "최충헌"],
        correctAnswerIndex: 0,
        correctAnswerText: "정중부",
        explanation: "정답은 정중부입니다. 정중부는 1170년 이의방, 이고 등과 함께 무신정변을 일으켜 무신정권을 수립했습니다. 경대승은 1179년 정중부를 제거하고 권력을 잡은 인물이며, 이의민은 경대승 사후 권력을 잡은 무신이고, 최충헌은 1196년 이의민을 제거하여 최씨 무신집권기를 연 인물입니다."
      })
    },
    // [유형 2: 세계사 - 배경 및 국가별 비교 유형]
    { role: "user", content: "선택된 분야:\n역사\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "역사",
        question: "18세기 후반 풍부한 자본과 자원, 정치적 안정을 바탕으로 세계 최초로 산업 혁명이 시작된 국가는 어디입니까?",
        choices: ["영국", "프랑스", "독일", "미국"],
        correctAnswerIndex: 0,
        correctAnswerText: "영국",
        explanation: "정답은 영국입니다. 영국은 18세기 후반 인클로저 운동으로 인한 노동력 확보, 풍부한 석탄 및 철광석 자원, 명예혁명 이후의 정치적 안정을 바탕으로 가장 먼저 산업 혁명을 달성했습니다. 프랑스는 19세기 초, 미국과 독일은 19세기 중후반에 본격적인 산업화를 추진했습니다."
      })
    }
  ],
  "문화예술": [
    { role: "user", content: "선택된 분야:\n문화예술\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "문화예술",
        question: "조선 후기 화가 겸재 정선이 비 온 뒤의 인왕산을 그린 대표적인 진경산수화는 무엇입니까?",
        choices: ["인왕제색도", "몽유도원도", "고사관수도", "금강전도"],
        correctAnswerIndex: 0,
        correctAnswerText: "인왕제색도",
        explanation: "정답은 인왕제색도입니다. 인왕제색도는 정선이 1751년에 그린 대표작입니다. 몽유도원도는 조선 전기 안견의 작품이며 고사관수도는 조선 전기 강희안의 작품입니다."
      })
    }
  ],
  "한글 맞춤법": [
    { role: "user", content: "선택된 분야:\n한글 맞춤법\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "한글 맞춤법",
        question: "상대방에게 약속이나 의지를 나타내는 종결어미의 올바른 표기로 적절한 것은 무엇입니까?",
        choices: ["내가 할게", "내가 할께", "내가 할개", "내가 할게유"],
        correctAnswerIndex: 0,
        correctAnswerText: "내가 할게",
        explanation: "정답은 내가 할게입니다. 약속이나 의지를 나타내는 종결어미는 된소리로 발음되더라도 '-ㄹ게'로 적는 것이 올바른 맞춤법입니다."
      })
    }
  ],
  "디지털 리터러시": [
    { role: "user", content: "선택된 분야:\n디지털 리터러시\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "디지털 리터러시",
        question: "개인정보 탈취를 목적으로 가짜 이메일이나 웹사이트로 사용자를 속이는 디지털 사기 행위는 무엇입니까?",
        choices: ["피싱", "랜섬웨어", "스파이웨어", "애드웨어"],
        correctAnswerIndex: 0,
        correctAnswerText: "피싱",
        explanation: "정답은 피싱입니다. 피싱은 사용자를 속여 금융 정보나 로그인 정보를 탈취하는 사기 기법입니다. 랜섬웨어는 파일을 암호화하여 금전을 요구하는 악성코드입니다."
      })
    }
  ],
  "인권 리터러시": [
    { role: "user", content: "선택된 분야:\n인권 리터러시\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "인권 리터러시",
        question: "유엔 아동권리협약에서 아동에게 보장하는 기본 권리와 거리가 먼 항목은 무엇입니까?",
        choices: ["직접적인 군사 훈련 및 전투 참여 권리", "생존과 발달을 누릴 권리", "아동의 최선의 이익을 우선할 권리", "표현의 자유를 누릴 권리"],
        correctAnswerIndex: 0,
        correctAnswerText: "직접적인 군사 훈련 및 전투 참여 권리",
        explanation: "정답은 직접적인 군사 훈련 및 전투 참여 권리입니다. 유엔 아동권리협약 제38조는 아동의 군사 참여 및 위험 노출을 철저히 금지하고 있습니다."
      })
    }
  ],
  "환경": [
    { role: "user", content: "선택된 분야:\n환경\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "환경",
        question: "화석 연료 연소 시 발생하며 지구 온난화를 유발하는 대표적인 온실가스는 무엇입니까?",
        choices: ["이산화탄소", "산소", "질소", "헬륨"],
        correctAnswerIndex: 0,
        correctAnswerText: "이산화탄소",
        explanation: "정답은 이산화탄소입니다. 이산화탄소는 대기 중 열을 흡수하여 온실효과를 일으키는 주요 가스입니다."
      })
    }
  ],
  "과학": [
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
  ],
  "코딩": [
    { role: "user", content: "선택된 분야:\n코딩\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "코딩",
        question: "프로그래밍에서 복수의 데이터를 하나의 연속된 변수에 순서대로 저장하기 위해 사용하는 자료구조는 무엇입니까?",
        choices: ["배열", "조건문", "반복문", "함수"],
        correctAnswerIndex: 0,
        correctAnswerText: "배열",
        explanation: "정답은 배열입니다. 배열은 동일한 타입의 데이터 요소들을 인덱스 순서대로 저장하는 자료구조입니다."
      })
    }
  ],
  "안전 및 건강상식": [
    { role: "user", content: "선택된 분야:\n안전 및 건강상식\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "안전 및 건강상식",
        question: "심정지 환자 발생 시 시행하는 심폐소생술에서 가슴 압박의 올바른 위치는 어디입니까?",
        choices: ["가슴 뼈 중앙 아래쪽 절반 부위", "왼쪽 흉부 심장 바로 위 부위", "명치 끝 부위", "쇄골 바로 아래 부위"],
        correctAnswerIndex: 0,
        correctAnswerText: "가슴 뼈 중앙 아래쪽 절반 부위",
        explanation: "정답은 가슴 뼈 중앙 아래쪽 절반 부위입니다. 정확한 압박 지점을 눌러야 늑골 골절 위험을 줄이고 혈액 순환을 도울 수 있습니다."
      })
    }
  ],
  "경제": [
    // [유형 1: 미시경제 - 시장 구조 및 가격 결정 유형]
    { role: "user", content: "선택된 분야:\n경제\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "경제",
        question: "하나의 선택으로 인해 포기해야 하는 대안 중 가치가 가장 높은 것을 뜻하는 경제학 용어는 무엇입니까?",
        choices: ["기회비용", "매몰비용", "한계비용", "고정비용"],
        correctAnswerIndex: 0,
        correctAnswerText: "기회비용",
        explanation: "정답은 기회비용입니다. 기회비용은 어떤 자원을 선택함으로 인해 포기한 나머지 대안들의 가치 중 가장 큰 가치를 의미합니다. 매몰비용은 이미 지출하여 회수할 수 없는 비용, 한계비용은 생산량을 1단위 증가시킬 때 추가로 드는 비용, 고정비용은 생산량과 상관없이 일정하게 발생하는 비용입니다."
      })
    },
    // [유형 2: 거시경제 - 지표 정확성 및 지출 접근법 구성 요소 유형]
    { role: "user", content: "선택된 분야:\n경제\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "경제",
        question: "한 나라의 국경 안에서 일정 기간 동안 생산된 최종 재화와 서비스의 시장 가치를 뜻하는 국내총생산(GDP)의 지출 접근법 구성 요소에 해당하지 않는 것은 무엇입니까?",
        choices: ["주식 거래액", "가계 소비 지출", "정부 소비 지출 및 투자", "순수출"],
        correctAnswerIndex: 0,
        correctAnswerText: "주식 거래액",
        explanation: "정답은 주식 거래액입니다. 국내총생산(GDP)은 당해 연도에 새로 생산된 재화와 서비스의 가치만을 포함하며, 기존 자산의 소유권 이전일 뿐인 주식 거래액은 당해 생산 활동이 아니므로 GDP 산출에서 제외됩니다. GDP 지출 접근법의 구성 요소는 가계 소비(C), 기업 투자(I), 정부 지출(G), 순수출(NX)로 이루어집니다. (※ GDP는 국내총생산, GNP는 국민총생산임)"
      })
    }
  ],
  "지리": [
    { role: "user", content: "선택된 분야:\n지리\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "지리",
        question: "연간 강수량이 극히 적은 지역을 기준으로 분류할 때 지구상에서 가장 면적이 넓은 사막은 무엇입니까?",
        choices: ["남극 사막", "사하라 사막", "고비 사막", "아라비아 사막"],
        correctAnswerIndex: 0,
        correctAnswerText: "남극 사막",
        explanation: "정답은 남극 사막입니다. 사막은 강수량을 기준으로 정의되므로 한대 사막인 남극 사막이 전체 지구 사막 중 가장 큽니다. 사하라 사막은 열대/아열대 사막 중 가장 큽니다."
      })
    }
  ],
  "심리학": [
    { role: "user", content: "선택된 분야:\n심리학\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "심리학",
        question: "자신의 기존 신념이나 판단에 부합하는 정보만 수용하고 반대되는 정보는 무시하는 인지적 편향은 무엇입니까?",
        choices: ["확증 편향", "후광 효과", "동조 효과", "가용성 편향"],
        correctAnswerIndex: 0,
        correctAnswerText: "확증 편향",
        explanation: "정답은 확증 편향입니다. 확증 편향은 주관적 신념을 강화하는 방향으로 정보를 선택적으로 수집하고 해석하는 현상입니다."
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
    systemPrompt += `\n\n## Mandatory Spelling Reference Dataset\nWhen generating questions for "한글 맞춤법", you MUST strictly use the following dataset:\n${JSON.stringify(selectedSpelling, null, 2)}`;
  }

  return {
    model: MODEL_ID,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "quiz_schema",
        strict: true,
        schema: {
          type: "object",
          properties: {
            topic: { type: "string" },
            question: { type: "string" },
            choices: {
              type: "array",
              items: { type: "string" },
              minItems: 4,
              maxItems: 4
            },
            correctAnswerIndex: { type: "integer", minimum: 0, maximum: 3 },
            correctAnswerText: { type: "string" },
            explanation: { type: "string" }
          },
          required: ["topic", "question", "choices", "correctAnswerIndex", "correctAnswerText", "explanation"],
          additionalProperties: false
        }
      }
    },
    messages: [
      { role: "system", content: systemPrompt },
      ...getFewShotMessages(topic),
      { role: "user", content: `선택된 분야:\n${topic}\n\n위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요.` }
    ],
    temperature: 0, 
    reasoning_effort: 'high',
    max_tokens: 2500
  };
}

module.exports = {
  MODEL_ID,
  PRD_SYSTEM_PROMPT,
  createQuizPayload
};
