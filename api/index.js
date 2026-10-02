export default async function handler(req, res) {
  // CORS 및 Preflight 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const body = req.body || {};
    
    // API Key 추출 및 정제 (공백, 따옴표, Bearer 문구 제거)
    const authHeader = req.headers.authorization || '';
    let apiKey = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!apiKey) {
      apiKey = req.headers['x-goog-api-key'] || req.query.key || '';
    }

    // 따옴표나 불필요한 감싸는 문자 제거
    apiKey = apiKey.replace(/^["']|["']$/g, '').trim();

    if (!apiKey) {
      return res.status(401).json({ error: "API Key가 전달되지 않았습니다." });
    }

    // OpenAI messages -> Gemini contents 규격 변환
    const contents = (body.messages || []).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content || '' }]
    }));

    // Gemini Native 규격 payload (safetySettings BLOCK_NONE 적용)
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

    // Immersive Translate의 모델명에서 google/ 접두사만 제거
    const rawModel = body.model || 'gemini-3.8-flash';
    const cleanModel = rawModel.replace(/^google\//i, '').trim();

    const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      return res.status(response.status || 500).json({
        error: `Google Gemini API 호출 실패 (${response.status})`,
        modelUsed: cleanModel,
        rawResponseBody: rawText
      });
    }

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // OpenAI 규격으로 포맷팅하여 반환
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