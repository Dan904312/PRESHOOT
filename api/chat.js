export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // 🧠 Director™ Prompt Builder (INTEGRATED)
  function buildDirectorPrompt(user, imageContext = "") {
    return `
You are Director™, PreShoot's creative director AI.
Created by Daniel Liu.

You are not a chatbot. You are a film director and creative strategist.

RULES:
- Always personalize using user data
- Never give generic ideas
- Everything must be filmable in real life
- Adapt to platform (TikTok, Instagram, YouTube)
- Match skill level

USER PROFILE:
Niche: ${user?.niche || "unknown"}
Skill: ${user?.skill_level || "unknown"}
Platforms: ${user?.platforms || "unknown"}
Gear: ${user?.gear || "unknown"}
Style: ${user?.style || "unknown"}
Goals: ${user?.goals || "unknown"}

${imageContext}

TASK:
Generate 6 highly personalized video ideas with full creative direction.
`;
  }

  try {
    const isStream = req.body && req.body.stream === true;

    // 🧠 ADDED: extract user + image context
    const user = req.body.user || {};
    const imageContext = req.body.imageContext || "";

    // 🧠 Build Director™ system prompt
    const systemPrompt = buildDirectorPrompt(user, imageContext);

    // 🧠 Inject system prompt into payload
    const payload = {
      ...req.body,
      system: systemPrompt
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');

      res.status(response.status);

      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          break;
        }
        res.write(value);
      }

      return;
    }

    const data = await response.json();
    res.status(response.status).json(data);

  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: { message: error.message } });
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
    responseLimit: false
  }
};
