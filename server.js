// ======================================================
// server.js
// Part 1 / 4
// 상식 퀴즈 서버
// ======================================================

require("dotenv").config();

const express = require("express");
const axios = require("axios");
const path = require("path");
const app = express();


// ======================================================
// 기본 설정
// ======================================================
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemma-4-26b-a4b-it";

if (!GEMINI_API_KEY) {
    console.error("❌ GEMINI_API_KEY가 없습니다.");
    process.exit(1);
}


// ======================================================
// Middleware
// ======================================================

app.use(express.json({
    limit: "2mb"
}));

app.use(express.urlencoded({
    extended: true
}));

// ======================================================
// Frontend 연결
// ======================================================
app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

// ======================================================
// Gemma REST API 설정
// ======================================================

const GEMMA_URL =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// ======================================================
// 퀴즈 출제 분야
// ======================================================
const QUIZ_TOPICS = ["문화예술", "환경", "과학", "역사", "디지털 리터러시", "인권 리터러시", "한글 맞춤법",
"코딩", "안전 및 건강상식", "경제", "지리", "정치", "심리학"
];

// ======================================================
// 배열 섞기
// ======================================================

function shuffle(array) {
  const copied = [...array];

    for (
        let i = copied.length - 1;
        i > 0;
        i--
    ) {

        const random =
            Math.floor(
                Math.random() * (i + 1)
            );


        [
            copied[i],
            copied[random]
        ] =
        [
            copied[random],
            copied[i]
        ];

    }


    return copied;

}


// ======================================================
// 랜덤 5개 분야 선택
// ======================================================

function selectQuizTopics() {

    return shuffle(QUIZ_TOPICS)
        .slice(0, 5);

}


// ======================================================
// Gemma Prompt 생성
// ======================================================

function createQuizPrompt() {


    const selectedTopics =
        selectQuizTopics();



    return `

너는 대한민국 상식 퀴즈 출제 AI다.


이번 출제 분야:

${selectedTopics
.map((topic, index) =>
    `${index + 1}. ${topic}`
)
.join("\n")}



출제 조건:

- 총 5문제 생성
- 선택된 5개 분야에서 각각 1문제씩 출제
- 난이도: 중하급~중급
- 일반인이 풀 수 있는 상식 수준
- 문제는 서로 중복되지 않음
- 객관식 4지선다
- 정답 위치는 랜덤
- 오답도 자연스럽게 구성
- 해설 포함



반드시 JSON 형식만 출력한다.


출력 형식:

{
  "questions":[
    {
      "topic":"",
      "question":"",
      "choices":[
        "",
        "",
        "",
        ""
      ],
      "answer":0,
      "explanation":""
    }
  ]
}

규칙:

- answer는 0~3 숫자
- JSON 외 설명 금지
- 마크다운 금지
- 코드블록 금지

`;
}

// ======================================================
// server.js
// Part 2 / 4
// ======================================================

async function callGemma(prompt){
    try{
        const response= await axios.post(
            GEMMA_URL,
            {
                contents:[
                    {
                        role:"user",
                        parts:[
                            {
                                text:prompt
                            }
                        ]
                    }
                ],
                generationConfig:{
                    temperature:0.8,
                    topP:0.9,
                    maxOutputTokens:4096,
                    responseMimeType:"application/json"
                }
            },
            {
                headers:{
                    "Content-Type":"application/json"
                },
                timeout:60000
            }
        );
        return response.data.candidates[0].content.parts[0].text;
    }catch(error){
        console.error("Gemma API 오류:",error.response?.data||error.message);
        throw new Error("퀴즈 생성 실패");
    }
}

function parseQuizJSON(text){
    if(!text) throw new Error("빈 응답");

    let json= text.trim()
        .replace(/```json/g,"")
        .replace(/```/g,"")
        .trim();

    const start= json.indexOf("{");
    const end= json.lastIndexOf("}");

    if(start===-1||end===-1)
        throw new Error("JSON 형식 오류");

    json=json.substring(start,end+1);

    return JSON.parse(json);
}

function validateQuiz(data){
    if(!data.questions||!Array.isArray(data.questions))
        throw new Error("문제 데이터 오류");

    if(data.questions.length!==5)
        throw new Error("문제 개수 오류");

    data.questions.forEach(q=>{
        if(!q.topic||!q.question)
            throw new Error("문제 내용 오류");

        if(!Array.isArray(q.choices)||q.choices.length!==4)
            throw new Error("보기 오류");

        if(typeof q.answer!=="number"||q.answer<0||q.answer>3)
            throw new Error("정답 오류");
    });

    return data;
};

// ======================================================
// server.js
// Part 3 / 4
// ======================================================

let lastTopics=[];


async function createQuizWithRetry(){

    let retry=0;
    let lastPrompt=null;

    while(retry<3){

        try{

            if(!lastPrompt){
                lastPrompt=createQuizPrompt();
            }

            const result=await callGemma(lastPrompt);

            const quiz=parseQuizJSON(result);

            validateQuiz(quiz);

            return quiz;


        }catch(error){

            retry++;

            console.log(
              `퀴즈 생성 재시도 ${retry}/3`
            );

            if(retry>=3)
                throw error;
        }
    }
}

app.get("/api/health",(req,res)=>{
    res.json({
        success:true,
        server:"quiz-server",
        status:"running"
    });
});

app.post("/api/quiz",async(req,res)=>{
    try{
        const quiz=await createQuizWithRetry();

        res.json({
            success:true,
            count:quiz.questions.length,
            questions:quiz.questions
        });

    }catch(error){
        res.status(500).json({
            success:false,
            message:"퀴즈 생성 중 오류 발생",
            error:error.message
        });
    }
});

app.get("*",(req,res)=>{
    res.sendFile(
        path.join(__dirname,"index.html")
    );
});

// ======================================================
// server.js
// Part 4 / 4
// ======================================================

app.use((err, req, res, next) => {
    console.error(err);

    res.status(500).json({
        success: false,
        message: "서버 내부 오류"
    });
});

process.on("unhandledRejection", (error) => {
    console.error("Unhandled Promise Error:", error);
});

process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error);
});

module.exports = app;
