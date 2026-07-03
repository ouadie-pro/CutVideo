const path = require('path');
const fs = require('fs');

const transcriptionService = require('./transcriptionService');

function escapeAss(text) {
  return text
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\n/g, '\\N');
}

function secondsToAss(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${String(h).padStart(1, '0')}:${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function transcriptToAssEntries(segments) {
  const entries = [];
  for (const seg of segments) {
    const words = seg.text.trim().split(/\s+/);
    if (words.length === 0) continue;

    const segDuration = seg.end - seg.start;
    const wordDuration = segDuration / Math.max(words.length, 1);
    const groupSize = Math.min(4, Math.max(2, Math.ceil(words.length / Math.ceil(segDuration / 2))));

    for (let i = 0; i < words.length; i += groupSize) {
      const group = words.slice(i, i + groupSize);
      const groupText = group.join(' ');
      const groupStart = seg.start + i * wordDuration;
      const groupEnd = Math.min(seg.end, groupStart + group.length * wordDuration);

      if (groupEnd - groupStart < 0.3) continue;

      entries.push({ start: groupStart, end: groupEnd, text: groupText });
    }
  }
  return entries;
}

function generateAssContent(entries, videoWidth, videoHeight) {
  const marginV = Math.round(videoHeight * 0.08);
  const fontSize = Math.round(videoHeight * 0.055);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,2,10,10,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = entries.map((e, i) => {
    const start = secondsToAss(e.start);
    const end = secondsToAss(e.end);
    const text = escapeAss(e.text);
    return `Dialogue: 0,${start},${end},Caption,,0,0,0,,${text}`;
  });

  return header + events.join('\n');
}

async function generateCaptionFile(clipPath, outputAssPath) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return null;
    }

    const transcript = await transcriptionService.transcribeAudio(clipPath);

    if (!transcript.segments || transcript.segments.length === 0) {
      return null;
    }

    const entries = transcriptToAssEntries(transcript.segments);
    if (entries.length === 0) {
      return null;
    }

    const outputDir = path.dirname(outputAssPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const assContent = generateAssContent(entries, 1080, 1920);
    fs.writeFileSync(outputAssPath, assContent, 'utf-8');

    console.log(`captionService: generated ${entries.length} caption entries -> ${outputAssPath}`);
    return outputAssPath;
  } catch (err) {
    console.warn(`captionService: error: ${err.message}`);
    return null;
  }
}

module.exports = { generateCaptionFile };
