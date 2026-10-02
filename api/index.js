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

    // 2. Vercel AI Gateway Key (vck_...) 추출
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

    // 3. 모델명 정제 (Vercel Gateway 규격: google/ 접두사가 필요함)
    let modelName = body.model || 'gemini-2.5-flash';
    if (!modelName.startsWith('google/')) {
      modelName = `google/${modelName}`;
    }

    // 4. Vercel AI Gateway OpenAI 표준 페이로드 구성
    const gatewayPayload = {
      model: modelName,
      messages: body.messages || [{ role: 'user', content: 'Hello' }],
      temperature: body.temperature ?? 0.7,
      stream: false
    };

    // 5. Vercel AI Gateway 공식 표준 엔드포인트 호출
    const targetUrl = 'https://ai-gateway.vercel.sh/v1/chat/completions';

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(gatewayPayload)
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

    // 6. 이미 OpenAI 호환 응답으로 넘어오므로 그대로 반환
    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}