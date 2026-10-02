export default async function handler(req, res) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // 1. 요청 Body 파싱
    let body = req.body || {};
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }

    // 2. API Key (Vercel Key vck_...) 추출
    const headers = req.headers || {};
    const authHeader = headers.authorization || headers.Authorization || '';
    
    let rawApiKey = '';

    if (authHeader) {
      rawApiKey = authHeader;
    } else if (headers['x-goog-api-key'] || headers['X-Goog-Api-Key']) {
      rawApiKey = headers['x-goog-api-key'] || headers['X-Goog-Api-Key'];
    } else if (headers['api-key'] || headers['x-api-key']) {
      rawApiKey = headers['api-key'] || headers['x-api-key'];
    } else if (req.query && (req.query.key || req.query.api_key || req.query.apiKey)) {
      rawApiKey = req.query.key || req.query.api_key || req.query.apiKey;
    }

    let apiKey = rawApiKey
      .replace(/^Bearer\s+/i, '')
      .replace(/^["']|["']$/g, '')
      .trim();

    if (!apiKey) {
      return res.status(401).json({ 
        error: "API Key(vck_...)가 전달되지 않았습니다." 
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
    const rawModel = body.model || 'gemini-3.8-flash';
    const cleanModel = rawModel.replace(/^google\//i, '').trim();

    // 6. Vercel AI Gateway 엔드포인트 호출 (vck_... 키 적용)
    // Vercel AI Gateway를 거쳐 Google Gemini로 안전하게 포워딩됩니다.
    const targetUrl = `https://ai.vercel.dev/v1/models/${cleanModel}:generateContent`;

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(geminiPayload)
    });

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      return res.status(response.status || 500).json({
        error: `Vercel Gateway 응답 파싱 실패 (${response.status})`,
        rawResponseBody: rawText
      });
    }

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // 7. OpenAI 규격 변환 반환
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