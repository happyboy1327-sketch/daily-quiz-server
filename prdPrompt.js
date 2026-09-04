const MODEL_ID = "solar-pro4";//추후 Exa 검색기반 퀴즈로 바꿀 예정.

const PRD_SYSTEM_PROMPT = `
You MUST generate 100% fact-checked, diverse Korean general knowledge quizzes across a wide range of completely non-overlapping domains based on South Korean context, 
using single definitive answers and plausible wrong options.

## CRITICAL GENERATION CHECKLIST
Before outputting, you MUST satisfy EVERY single rule below (without missing a single one).

### 1. ABSOLUTE TRUTH AND FACTUALITY
□ Do NOT guess, speculate, or fabricate any statements under any circumstances.
□ Every fact, date, historical alliance, scientific claim, medical guideline, numerical data, and definition MUST be 100% verified real-world truth.
□ ***Never guess or arbitrarily generate the clause numbers of laws, regulations, or orthography rules. Always cross-check with the original text before outputting any clause numbers.***
- If the exact clause or article number is not 100% verifiable, cite only the official organization and document name (e.g., [출처: 국립국어원 한글 맞춤법]) without generating an arbitrary clause number.
- ❌ 잘못된 예: 다음 중 어간 '공부하-'에 과거 시제 선어말어미 '-였-'이 결합하여 줄어든 형태로 올바른 표기는 무엇입니까?
해설: 정답은 공부했어입니다. [출처/근거: 국립국어원(https://korean.go.kr/kornorms/m/m_regltn.do?#a)/ 한글 맞춤법 제4항] 어간 '공부하-'에 과거 시제 선어말어미 '-였-'이 결합할 때, '하'가 줄어지면 준 대로 '공부했어'로 적습니다. '공부했어'는 표준어이며, '공부했서'나 '공부했으' 등은 비문법적 형태입니다.
- ⭕ 올바른 예: 다음 중 어간 '공부하-'에 과거 시제 선어말어미 '-였-'이 결합하여 줄어든 형태로 올바른 표기는 무엇입니까?
해설: 정답은 공부했어입니다. [출처/근거: 국립국어원(https://korean.go.kr/kornorms/m/m_regltn.do?#a)/ 한글 맞춤법 제34항 (붙임 2)] 어간 '공부하-'에 과거 시제 선어말어미 '-였-'이 결합할 때, '하'가 줄어지면 준 대로 '공부했어'로 적습니다. '공부했어'는 표준어이며, '공부했서'나 '공부했으' 등은 비문법적 형태입니다.
□ History Precision: Chronological sequences, alliances, and roles must be exact (e.g., Silla allied with Tang, NOT Baekje; Kings and Generals must be accurately distinguished).
□ Terminology & Concept Precision: When dealing with specialized knowledge (science, medicine, law, public safety), NEVER confuse or mix distinct concepts or numerical units (e.g., '실온' vs '냉장', '시간' vs '기간', '수분 섭취 간격' vs '휴식 주기').

### 2. QUESTION PROMPT CONSTRAINTS
□ NEVER use any key nouns, hints, titles, or core vocabulary from the answer inside the question prompt.
  - If the answer includes a work title or core term (e.g., "씨름"), use abstract nouns like "이 작품", "이 그림", "다음 사건" in the prompt instead.

  - ❌ BAD: "1895년 명성황후가 시해된 을미사변의 발생 연도는?" (정답인 1895가 질문에 포함됨 - 절대 금지)
  - ⭕ GOOD: "명성황후가 시해된 '을미사변'이 발생한 연도는?"

  - ❌ BAD: "관형사 '웬'을 바르게 표기하여 사용한 단어는?" (정답 '웬'이 질문에 노출됨 - 절대 금지)
  - ⭕ GOOD: "다음 중 올바른 관형사 표기가 적용된 문장은?"

  - ❌ BAD: "씨름하는 모습을 생동감 있게 그린 김홍도의 작품은?" (정답 '씨름'의 키워드가 질문에 노출됨 - 절대 금지)
  - ⭕ GOOD: "조선 후기 김홍도가 단원풍속도첩에 남긴 그림 중, 두 사람이 겨루는 장면과 관객들의 반응을 입체적으로 묘사한 풍속화는?"

□ NEVER use subjective or relative terms like "대표적인" (representative), "가장 ~한" (most), or "주요한" (major) in the question prompt.
  - ❌ WRONG: 세종대왕의 대표적인 업적은?
  - ⭕ RIGHT: 조선 제4대 왕인 세종대왕 재위 기간에 창제된 한국어의 독자적 문자 체계는?
□ Scope, assumptions, units, and criteria must be explicit when relevant.
□ Do not ask for obscure dates or numbers EXCEPT for verified fields like HISTORY, SCIENCE, MEDICINE, and PUBLIC GUIDELINES (e.g., food safety hours, intake intervals).
□ Avoid unresolved controversies, time-varying political facts, and dumping detailed legal statutory texts into the question body.
□ When generating Geography questions using superlative terms (e.g., "largest", "longest", "1st"), do not combine metrics belonging to different entities (such as basin area vs. stream length) into a single contradictory premise.
□ For Coding: Plain text code only. Markdown code blocks within JSON strings are strictly prohibited.
□ [생성 금지 지침]
- 단체/기관마다 기준 수치가 다른 문제(예: 적정 온도, 체온 수치, 권장 시간 등)는 절대로 출제하지 마십시오.
- 어원, 표준어/비표준어, 명확한 고유명사, 역사적 사실 등 단 하나의 정답만 존재하는 배타적 팩트만 출제하십시오.

### 3. CHOICES AND CHARACTER SET CONSTRAINTS
□ Exactly 4 choices, exactly 1 objectively correct answer.
□ Distractor Rule: Distractors MUST belong to a DIFFERENT person, era, or concept (e.g., If the target is King Sejong, distractors MUST be achievements of other kings). NEVER list 4 true facts of the SAME entity and ask to pick one.
□ All 4 choices MUST target the EXACT same phrase structure, rule, or conceptual category.
□ Character Set: Use ONLY standard Korean, numbers, and basic ASCII. NEVER use Hanja.
□ FOR KOREAN GRAMMAR / SPELLING QUIZZES (CRITICAL RULE):
  - The 3 distractors MUST be misspelled forms (phonetic spellings, common vowel/consonant typos, spacing errors) based on the target word.
  - ❌ PROHIBITION: Putting valid standard Korean words, synonyms, or grammatically correct alternative expressions into distractor options.
  - ⭕ Correct Distractor Examples: '갑씨', '감이', '갑시' (Misspellings only)
  - Morphological Analysis Mandate: Decompose EVERY option into [Substantive Morpheme/Stem] + [Functional Morpheme/Particle]. If any distractor forms a valid standard Korean word, REPLACE IT IMMEDIATELY with a misspelled form.

### 4. EXPLANATION AND CITATION CONSTRAINTS
□ Explanation MUST begin EXACTLY with: 정답은 {correctAnswerText}입니다. [Source/Basis: ...]
  - Examples: [Source: National Institute of Korean Language], [Basis: Constitution Article 70], [Source: KACD Guidelines]
□ Explain why the correct answer is right and why each distractor is wrong using ONLY 100% verified real-world facts. Never fabricate false characteristics about a distractor.
□ If uncertain about any distractor's exact background, DO NOT attempt to explain or mention that distractor.
□ Avoid ambiguous relative descriptors (e.g., "short", "long") in explanations; use exact names, figures, and definitive facts instead.
□ Do NOT include long statutory text dumps or detailed legal sub-clauses in the explanation. (Main article citations like "헌법 제70조" are permitted ONLY as sources).
□ ***관련없는 조항 번호는 절대로 해설에 적지 마시오.***
□ 조항이 2개 이상 적용되는 문제일 경우, 출처에 조항을 2개 이상 병기하시오. [근거: 헌법 제86조·제87조]

### 5. ACCURACY & BANNED TOPICS (POP CULTURE PROHIBITION)
□ "First ever" (최초) or "record-holding" (최고) claims must be strictly verified historical milestones.
□ STRICTLY BANNED TOPICS: Movies, Anime, Manga, Webtoons, TV Shows, Pop Culture, and Celebrities. (High risk of hallucination).
□ If a banned topic is requested or selected, fallback strictly to academic, historical, scientific, linguistic, public safety, or legal knowledge domains.

### 6. OUTPUT FORMAT
□ Output ONLY a single valid JSON object. No surrounding conversational text.

{
  "topic": "분야명",
  "concept_summary": "[출제할 팩트 및 핵심 개념을 2문장으로 먼저 요약]",
  "explanation": "정답은 {correctAnswerText}입니다. [정답 이유 및 모든 오답의 명확한 근거 설명]",
  "question": "[전제와 조건이 명확하고 논리가 완벽한 질문]",
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
    { role: "user", content: "선택된 분야:\n정치\n\n정확한 조항 번호와 공식 자료를 바탕으로 위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "정치",
        explanation: "정답은 임기 5년, 단임제입니다. [출처/ 근거: 국가법령정보센터(law.go.kr)/ 대한민국 헌법 제70조] '대통령의 임기는 5년으로 하며, 중임할 수 없다'고 명시되어 있어 연임 및 중임이 불가능한 5년 단임제를 채택하고 있습니다.",
        question: "대한민국 현행 헌법상 대통령의 임기와 재임 조건에 대한 설명으로 올바른 것은 무엇입니까?",
        choices: ["임기 5년, 단임제", "임기 4년, 연임 가능", "임기 5년, 중임 가능", "임기 6년, 단임제"],
        correctAnswerIndex: 0,
        correctAnswerText: "임기 5년, 단임제"
      })
    }
  ],
  "역사": [
    // [유형 1: 한국사 - 인물 및 정변 타임라인 유형]
    { role: "user", content: "선택된 분야:\n역사\n\n공식 자료와 문헌을 바탕으로 위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "역사",
        explanation: "정답은 정중부입니다. [출처: 고려사 권128 열전 정중부전] 정중부는 1170년 이의방, 이고 등과 함께 무신정변을 일으켜 고려 무신정권을 수립했습니다. 경대승(1179년 정중부 제거), 이의민, 최충헌(1196년 최씨 집권기)은 이후 차례로 권력을 잡은 인물들입니다.",
        question: "고려 시대 1170년 무신정변을 주도하여 무신정권을 최초로 수립한 인물로 올바른 것은 누구입니까?",
        choices: ["정중부", "경대승", "이의민", "최충헌"],
        correctAnswerIndex: 0,
        correctAnswerText: "정중부"
      })
    },
    // [유형 2: 세계사 - 배경 및 국가별 비교 유형]
    { role: "user", content: "선택된 분야:\n역사\n\n공식 자료와 문헌을 바탕으로 위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "역사",
        explanation: "정답은 영국입니다. [출처: 서양사개론(민석홍 저) 및 교육부 검정 세계사 교과서] 영국은 18세기 후반 인클로저 운동으로 인한 노동력 확보, 풍부한 석탄·철광석 자원, 명예혁명 이후 정치적 안정을 바탕으로 최초로 산업 혁명을 달성했습니다.",
        question: "18세기 후반 풍부한 자본과 자원, 정치적 안정을 바탕으로 세계 최초로 산업 혁명이 시작된 국가는 어디입니까?",
        choices: ["프랑스", "영국", "독일", "미국"],
        correctAnswerIndex: 1,
        correctAnswerText: "영국"
      })
    }
  ],
  "문화예술": [
    { role: "user", content: "선택된 분야:\n문화예술\n\n공식 자료와 문헌을 바탕으로 위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "문화예술",
        explanation: "정답은 인왕제색도입니다. [출처: 국보 제216호 지정정보 및 국립중앙박물관] 인왕제색도는 겸재 정선이 1751년에 그린 대표작입니다. 몽유도원도는 조선 전기 안견, 고사관수도는 조선 전기 강희안의 작품입니다.",
        question: "조선 후기 화가 겸재 정선이 비 온 뒤의 인왕산을 그린 대표적인 진경산수화는 무엇입니까?",
        choices: ["인왕제색도", "몽유도원도", "고사관수도", "금강전도"],
        correctAnswerIndex: 0,
        correctAnswerText: "인왕제색도"
      })
    }
  ],
  "한글 맞춤법": [
    { role: "user", content: "선택된 분야:\n한글 맞춤법\n\njina.ai로 검색된 공식 자료와 조항 번호를 알맞게 사용하여 위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "한글 맞춤법",
        explanation: "정답은 내가 할게입니다. [출처/ 근거: 국립국어원(https://korean.go.kr/kornorms/m/m_regltn.do?#a)/ 한글 맞춤법 제53항] 약속이나 의지를 나타내는 종결어미는 된소리로 발음되더라도 '-ㄹ게'로 적는 것이 올바른 표기법입니다.",
        question: "상대방에게 약속이나 의지를 나타내는 종결어미의 올바른 표기로 적절한 것은 무엇입니까?",
        choices: ["내가 할게", "내가 할께", "내가 할개", "내가 할 게"],
        correctAnswerIndex: 0,
        correctAnswerText: "내가 할게"
      })
    }
  ],
  "디지털 리터러시": [
    { role: "user", content: "선택된 분야:\n디지털 리터러시\n\n공식 자료를 바탕으로 위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "디지털 리터러시",
        explanation: "정답은 피싱입니다. [출처: 한국인터넷진흥원(KISA) 정보보호 용어집] 피싱(Phishing)은 금융기관이나 유명 기관을 사칭하여 개인정보 및 금융 정보를 탈취하는 사기 기법입니다.",
        question: "개인정보 탈취를 목적으로 가짜 이메일이나 웹사이트로 사용자를 속이는 디지털 사기 행위는 무엇입니까?",
        choices: ["피싱", "랜섬웨어", "스파이웨어", "애드웨어"],
        correctAnswerIndex: 0,
        correctAnswerText: "피싱"
      })
    }
  ],
  "인권 리터러시": [
    { role: "user", content: "선택된 분야:\n인권 리터러시\n\n공식 자료를 바탕으로 위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "인권 리터러시",
        explanation: "정답은 직접적인 군사 훈련 및 전투 참여 권리입니다. [출처: 유엔 아동권리협약(UN CRC) 제38조] 협약 제38조에 따라 15세 미만 아동의 군사 직접 참여 및 전투 위험 노출은 엄격히 금지됩니다.",
        question: "유엔 아동권리협약에서 아동에게 보장하는 기본 권리가 아닌 것은?",
        choices: ["직접적인 군사 훈련 및 전투 참여 권리", "생존과 발달을 누릴 권리", "아동의 최선의 이익을 우선할 권리", "표현의 자유를 누릴 권리"],
        correctAnswerIndex: 0,
        correctAnswerText: "직접적인 군사 훈련 및 전투 참여 권리"
      })
    }
  ],
  "환경": [
    {
  role: "user",
  content: "선택된 분야:\n환경\n\n공식 자료를 바탕으로 위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요."
},
{
  role: "assistant",
  content: JSON.stringify({
    topic: "환경",
    explanation: "정답은 대기의 상하 혼합이 활발하지 않아 오염물질이 넓게 확산되기 어렵기 때문입니다. [출처: 환경부 대기환경 자료] 바람이 약하고 대기가 안정된 조건에서는 대기 중 공기의 움직임과 혼합이 제한되어 배출된 오염물질이 지표 부근에 머물면서 농도가 높아질 수 있습니다.",
    question: "바람 세기가 약하고 대기가 안정된 날에 지표 부근에 대기 오염 물질이 축적되기 쉬운 이유는 무엇입니까?",
    choices: [
      "대기의 상하 혼합이 활발하지 않아 오염물질이 넓게 확산되기 어렵기 때문이다",
      "바람이 약하면 오염물질이 모두 지상으로 떨어지기 때문이다",
      "대기가 안정되면 오염물질이 즉시 산소로 변하기 때문이다",
      "기온이 낮아지면 모든 대기오염물질의 발생이 증가하기 때문이다"
    ],
    correctAnswerIndex: 0,
    correctAnswerText: "대기의 상하 혼합이 활발하지 않아 오염물질이 넓게 확산되기 어렵기 때문이다"
     })
    },
 {
  role: "user",
  content: "선택된 분야:\n환경\n\n공식 자료를 바탕으로 위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요."
},
{
  role: "assistant",
  content: JSON.stringify({
    topic: "환경",
    explanation: "정답은 개체군 사이의 교류가 감소하여 생물다양성이 감소할 수 있다입니다. [출처: 생물다양성협약(CBD) 자료] 서식지가 도로와 개발 등으로 나뉘면 야생동물의 이동이 제한되고 개체군 사이의 교류가 감소할 수 있습니다. 이러한 서식지 단절은 생물다양성과 야생동물의 생존에 부정적인 영향을 줄 수 있습니다.",
    question: "서식지가 지나치게 작게 나뉘어 야생동물의 이동이 어려워지는 경우 생태계에 나타날 수 있는 문제는 무엇입니까?",
    choices: [
      "개체군 사이의 교류가 감소하여 생물다양성이 감소할 수 있다",
      "서식지가 나뉠수록 모든 야생동물의 개체 수가 증가한다",
      "서식지의 분할은 생물의 이동과 생존에 영향을 주지 않는다",
      "서식지가 작아지면 생태계의 모든 종이 같은 환경을 선호하게 된다"
    ],
    correctAnswerIndex: 0,
    correctAnswerText: "개체군 사이의 교류가 감소하여 생물다양성이 감소할 수 있다"
  })
}
  ],
  "과학": [
    { role: "user", content: "선택된 분야:\n과학\n\n공식 자료를 바탕으로 위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "과학",
        explanation: "정답은 빛의 굴절입니다. [출처: 한국물리학회 물리학용어집 및 기상청 기상백서] 무지개는 태양광이 물방울 경계면을 통과할 때 매질 차이로 발생하는 '굴절'과 파장별 각도 차이인 '분산'이 결합하여 형성됩니다.",
        question: "햇빛이 공기 중의 물방울을 통과할 때 꺾이고 분산되어 나타나는 기상 현상인 무지개와 가장 밀접한 빛의 성질은 무엇입니까?",
        choices: ["빛의 굴절", "빛의 회절", "빛의 간섭", "빛의 편광"],
        correctAnswerIndex: 0,
        correctAnswerText: "빛의 굴절"
      })
    }
  ],
  "코딩": [
    { role: "user", content: "선택된 분야:\n코딩\n\n공식 자료를 바탕으로 위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "코딩",
        explanation: "정답은 배열입니다. [출처: ISO/IEC 9899 C 프로그래밍 언어 표준 명세서] 배열(Array)은 동일한 타입의 요소들을 연속된 메모리 공간에 인덱스(Index) 순으로 저장하는 기본 선형 자료구조입니다.",
        question: "프로그래밍에서 복수의 데이터를 하나의 연속된 메모리 공간에 순서대로 저장하기 위해 사용하는 자료구조는 무엇입니까?",
        choices: ["조건문", "반복문", "배열", "함수"],
        correctAnswerIndex: 2,
        correctAnswerText: "배열"
      })
    }
  ],
  "안전 및 건강상식":[
     {role: "user", content: "선택된 분야:안전 및 건강상식\n\n공식 자료를 바탕으로 위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요."},
  {
    role: "assistant",
    content: JSON.stringify({
    topic: "안전 및 건강상식",
    explanation: "정답은 산불 발생 초기의 신속한 대응입니다. [출처: 산림청 2026년 산불 제대로 알기] 산불은 시간이 지남에 따라 피해면적과 화선이 급격하게 증가하므로 대형산불로 확대되기 전에 신속하게 초동대응하는 것이 중요합니다.",
    question: "산림청이 산불 발생 초기의 신속한 대응을 중요하게 보는 이유는 무엇입니까?",
    choices: [
      "시간이 지남에 따라 피해면적과 화선이 급격하게 증가하기 때문",
      "산불이 발생하면 일정 시간이 지나야 진화헬기를 투입할 수 있기 때문",
      "산불은 초기에는 주변 지역으로 확산되지 않기 때문",
      "산불의 피해 규모는 진화 시작 시점과 관계없이 일정하기 때문"
    ],
    correctAnswerIndex: 0,
    correctAnswerText: "시간이 지남에 따라 피해면적과 화선이 급격하게 증가하기 때문"
    })
  }
  ],
  "경제": [
    // [유형 1: 미시경제 - 시장 구조 및 가격 결정 유형]
    { role: "user", content: "선택된 분야:\n경제\n\n공식 자료를 바탕으로 위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "경제",
        explanation: "정답은 기회비용입니다. [출처: 맨큐의 경제학(Principles of Economics)] 기회비용(Opportunity Cost)은 한 자원을 사용할 때 포기한 대안들 중 가장 가치가 큰 대안의 가치를 뜻합니다.",
        question: "하나의 선택으로 인해 포기해야 하는 대안 중 가치가 가장 높은 것을 뜻하는 경제학 용어는 무엇입니까?",
        choices: ["기회비용", "매몰비용", "한계비용", "고정비용"],
        correctAnswerIndex: 0,
        correctAnswerText: "기회비용"
      })
    },
    // [유형 2: 거시경제 - 지표 정확성 및 지출 접근법 구성 요소 유형]
    { role: "user", content: "선택된 분야:\n경제\n\n공식 자료를 바탕으로 위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "경제",
        explanation: "정답은 주식 거래액입니다. [출처: 한국은행 국민계정 작성 기준(SNA)] GDP는 당해 연도 생산 가치만 산출하므로 단순 자산 이전인 기존 주식 거래액은 제외됩니다. GDP 지출 접근법은 C(소비)+I(투자)+G(정부지출)+NX(순수출)로 구성됩니다.",
        question: "한 나라의 국경 안에서 일정 기간 동안 생산된 최종 재화와 서비스의 시장 가치를 뜻하는 국내총생산(GDP)의 지출 접근법 구성 요소에 해당하지 않는 것은 무엇입니까?",
        choices: ["주식 거래액", "가계 소비 지출", "정부 소비 지출 및 투자", "순수출"],
        correctAnswerIndex: 0,
        correctAnswerText: "주식 거래액"
      })
    }
  ],
  "지리": [
    { role: "user", content: "선택된 분야:\n지리\n\n공식 자료를 바탕으로 위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "지리",
        explanation: "정답은 남극 사막입니다. [출처: 미국 지질조사국(USGS) 및 세계 지리 표준 데이터] 사막은 연간 강수량(250mm 이하)을 기준으로 구분하므로 한대 사막인 남극 사막(약 1,400만 km²)이 세계에서 가장 넓은 사막입니다.",
        question: "연간 강수량이 극히 적은 지역을 기준으로 분류할 때 지구상에서 가장 면적이 넓은 사막은 무엇입니까?",
        choices: ["남극 사막", "사하라 사막", "고비 사막", "아라비아 사막"],
        correctAnswerIndex: 0,
        correctAnswerText: "남극 사막"
      })
    }
  ],
  "심리학": [
    { role: "user", content: "선택된 분야:\n심리학\n\n공식 자료를 바탕으로 위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요." },
    {
      role: "assistant",
      content: JSON.stringify({
        topic: "심리학",
        explanation: "정답은 확증 편향입니다. [출처: 한국심리학회 심리학용어사전 (P. Wason 이론)] 확증 편향(Confirmation Bias)은 자신의 주관적 신념에 부합하는 정보만 취사선택하는 대표적인 인지적 편향 현상입니다.",
        question: "자신의 기존 신념이나 판단에 부합하는 정보만 수용하고 반대되는 정보는 무시하는 인지적 편향은 무엇입니까?",
        choices: ["확증 편향", "후광 효과", "동조 효과", "가용성 편향"],
        correctAnswerIndex: 0,
        correctAnswerText: "확증 편향"
      })
    }
  ]   
};


function createQuizPayload(topic, spellingData = null, previousQuestions = []) {

  let systemPrompt = PRD_SYSTEM_PROMPT;

  const shouldUseSpellingData =
    topic === "한글 맞춤법" &&
    Array.isArray(spellingData) &&
    spellingData.length > 0 &&
    Math.random() < 0.8;

  if (shouldUseSpellingData) {
    const selectedSpelling = spellingData[Math.floor(Math.random() * spellingData.length)];
    systemPrompt += `\n\n## Mandatory Spelling Reference Dataset\nWhen generating questions for "한글 맞춤법", you MUST strictly use the following dataset:\n${JSON.stringify(selectedSpelling, null, 2)}`;
  }

  const properties = {
    topic: { type: "string" },
    concept_summary: {
      type: "string",
      description: "출제할 팩트 및 핵심 개념을 2문장으로 먼저 요약"
    },
    explanation: { type: "string" },
    question: { type: "string" },
    choices: {
      type: "array",
      items: { type: "string" }
    },
    correctAnswerIndex: { type: "integer" },
    correctAnswerText: { type: "string" }
  };

  const required = [
    "topic", 
    "concept_summary",
    "explanation",
    "question",
    "choices",
    "correctAnswerIndex",
    "correctAnswerText"
  ];

  const matchedFewShot = FEW_SHOT_DATABASE[topic] || [];

  // 토픽이 "한글 맞춤법"일 때만 morpheme_check 스키마 동적 주입
  if (topic === "한글 맞춤법") {
    properties.morpheme_check = {
      type: "string",
      description: "단어 분해만 15자 이내 작성 (예: 맏이=맏+이/맏형=맏+형)"
    };
    required.push("morpheme_check");
  }

  const formattedPreviousList = previousQuestions
    .slice(-14)
    .map(q => {
      if (typeof q === "string") return `- ${q}`;
      // 정답 텍스트(correctAnswerText)가 있다면 함께 전달하여 정답 재탕 방지
      const ans = q.correctAnswerText ? ` (정답/개념: ${q.correctAnswerText})` : "";
      return `- ${q.question}${ans}`;
    })
    .filter(Boolean)
    .join("\n");
  
  return {
    model: MODEL_ID,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "quiz_schema",
        strict: true,
        schema: {
          type: "object",
          properties,
          required,
          additionalProperties: false
        }
      }
    },
 messages : [
  { role: "system", content: systemPrompt },
  ...matchedFewShot, // '지리'면 지리 퓨샷만 들어감
      {
        role: "user",
        content:`선택된 분야:
${topic}

위 분야에 맞는 중급 난도의 퀴즈 1개를 JSON 형식으로 출제해주세요.

이미 출제된 목록:
${formattedPreviousList || "- 없음"}

이미 출제된 목록과 동일하거나 유사한 문제는 절대 출제하지 말고, 다양한 세부 주제와 사실을 선택하십시오.
동일한 개념이나 정답을 같은 topic에 넣어 반복하지 마십시오.`
}
    ],
    temperature: 0.15, 
    presence_penalty: 0.2,
    frequency_penalty: 0.3,
    max_tokens: 1550
  };
}

module.exports = {
  MODEL_ID,
  PRD_SYSTEM_PROMPT,
  createQuizPayload
};
