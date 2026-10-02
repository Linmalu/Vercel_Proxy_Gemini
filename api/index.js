export default async function handler(req, res) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // 1. 요청 Body 파싱 안전화
    let body = req.body || {};
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }

    // 2. API Key 파싱 (Immersive Translate가 전송하는 모든 위치 전수 조사)
    const headers = req.headers || {};
    const authHeader = headers.authorization || headers.Authorization || '';
    
    let apiKey = '';

    // (1) Bearer 토큰 형태
    if (authHeader) {
      apiKey = authHeader.replace(/^Bearer\s+/i, '').trim();
    }
    // (2) x-goog-api-key 헤더 형태
    if (!apiKey) {
      apiKey = headers['x-goog-api-key'] || headers['X-Goog-Api-Key'] || '';
    }
    // (3) api-key / x-api-key 헤더 형태
    if (!apiKey) {
      apiKey = headers['api-key'] || headers['x-api-key'] || '';
    }
    // (4) URL Query 파라미터 (?key= 또는 ?api_key=)
    if (!apiKey && req.query) {
      apiKey = req.query.key || req.query.api_key || req.query.apiKey || '';
    }

    // 따옴표 및 양끝 공백 정제
    apiKey = apiKey.replace(/^["']|["']$/g, '').trim();

    if (!apiKey) {
      return res.status(401).json({ 
        error: "API Key를 찾을 수 없습니다. Immersive Translate의 API Key 설정을 확인해주세요." 
      });
    }

    // 3. OpenAI messages -> Gemini contents 규격 변환
    const contents = (body.messages || []).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content || '' }]
    }));

    // 4. Gemini Native 규격 payload (safetySettings BLOCK_NONE 적용)
    const geminiPayload = {
      contents: contents.length > 0 ? contents : [{ parts: [{ text: "Hello" }] }],
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
      ]
    };

    // 5. 모델명 정제 (google/ 접두사 제거)
    const rawModel = body.model || 'gemini-2.5-flash';
    let cleanModel = rawModel.replace(/^google\//i, '').trim();

    // 6. Google Gemini API 호출 (URL 쿼리 + Header 양쪽으로 Key 전달)
    const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(geminiPayload)
    });

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      return res.status(response.status || 500).json({
        error: `Google Gemini API 응답 해석 실패 (${response.status})`,
        rawResponseBody: rawText
      });
    }

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // 7. OpenAI 규격으로 반환
    const openAiResponse = {
      id: 'chatcmpl-' + Date.now(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: rawModel,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: generatedText
          },
          finish_reason: 'stop'
        }
      ]
    };

    return res.status(200).json(openAiResponse);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}