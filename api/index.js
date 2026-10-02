export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const body = req.body || {};
    
    // API Key 추출
    const authHeader = req.headers.authorization || '';
    let apiKey = authHeader.replace('Bearer ', '').trim();

    if (!apiKey) {
      apiKey = req.headers['x-goog-api-key'] || req.query.key || '';
    }

    if (!apiKey) {
      return res.status(401).json({ error: "API Key가 전달되지 않았습니다." });
    }

    // OpenAI messages -> Gemini contents 변환
    const contents = (body.messages || []).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content || '' }]
    }));

    // Gemini Native 규격 payload
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

    const modelName = body.model || 'gemini-3.8-flash';
    const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    const openAiResponse = {
      id: 'chatcmpl-' + Date.now(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelName,
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