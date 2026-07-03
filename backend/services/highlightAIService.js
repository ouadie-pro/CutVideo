const OpenAI = require('openai');

function formatTranscript(segments) {
  return segments.map((s, i) =>
    `[${i + 1}] ${formatTime(s.start)} - ${formatTime(s.end)}: ${s.text}`
  ).join('\n');
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function doOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

async function selectHighlightsWithAI({ transcript, totalDuration, count, reelDuration }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const model = process.env.HIGHLIGHT_AI_MODEL || 'gpt-4o-mini';
  const minDuration = Math.max(3, reelDuration * 0.8);
  const maxDuration = reelDuration * 1.2;

  const transcriptText = formatTranscript(transcript.segments);

  const systemPrompt = `You are a video editor who selects the best moments for short-form social media reels. Given a transcript with timestamps, pick exactly ${count} non-overlapping highlight windows that would make the most engaging standalone clips.`;

  const userPrompt = `Here is the transcript of a ${formatTime(totalDuration)} video:

${transcriptText}

Select exactly ${count} highlight windows from this transcript. Each window should be roughly ${reelDuration} seconds long (flexible ±20%, so between ${Math.round(minDuration)} and ${Math.round(maxDuration)} seconds). The windows must NOT overlap.

Choose moments that are:
- Emotionally engaging, funny, surprising, or quotable
- Self-contained (complete thoughts, don't cut mid-sentence)
- Likely to perform well as standalone short-form clips

Return JSON in this exact structure (no markdown, no code fences):
{
  "highlights": [
    {
      "start": <number in seconds>,
      "end": <number in seconds>,
      "title": "<short catchy title for this clip>",
      "reason": "<why this moment was chosen>",
      "score": <number 0-100>
    }
  ]
}`;

  const openai = new OpenAI({ apiKey });

  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('AI returned empty response');
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`AI returned unparseable JSON: ${content.slice(200)}`);
  }

  let highlights = parsed.highlights;
  if (!Array.isArray(highlights) || highlights.length === 0) {
    throw new Error('AI returned no highlights array');
  }

  highlights = highlights.map(h => ({
    start: clamp(h.start, 0, totalDuration),
    end: clamp(h.end, 0, totalDuration),
    title: typeof h.title === 'string' ? h.title : `Highlight`,
    reason: typeof h.reason === 'string' ? h.reason : '',
    score: typeof h.score === 'number' ? clamp(Math.round(h.score), 0, 100) : 50
  }));

  highlights = highlights.filter(h => (h.end - h.start) >= 3);

  const deduped = [];
  for (const h of highlights) {
    if (!deduped.some(d => doOverlap(d, h))) {
      deduped.push(h);
    }
  }

  deduped.sort((a, b) => a.start - b.start);

  return deduped.slice(0, count);
}

module.exports = { selectHighlightsWithAI };
