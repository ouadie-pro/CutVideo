const ENGAGEMENT_WORDS = [
  'insane', 'crazy', 'never', 'best', 'secret', 'wow', 'amazing', 'incredible',
  'shocking', 'terrible', 'worst', 'hilarious', 'unbelievable', 'genius',
  'epic', 'legendary', 'disaster', 'nightmare', 'perfect',
  'must', 'need', 'love', 'hate',
  'seriously', 'literally', 'actually', 'finally', 'impossible',
  'what', 'why', 'how', 'wait', 'stop', 'guaranteed', 'free',
  'you won\'t believe', 'no way', 'mind blowing', 'game changer',
  'never seen', 'best ever', 'worst ever', 'check this out'
];

const ENGAGEMENT_WORD_SET = new Set(ENGAGEMENT_WORDS);

function scoreSegmentText(text, start, end) {
  let score = 0;
  if (!text) return score;

  const excCount = (text.match(/!/g) || []).length;
  const qCount = (text.match(/\?/g) || []).length;
  score += excCount * 10;
  score += qCount * 8;

  const lower = text.toLowerCase();
  for (const word of ENGAGEMENT_WORDS) {
    if (lower.includes(word)) {
      score += 12;
    }
  }

  const words = text.split(/\s+/);
  const upperWords = words.filter(w => w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w));
  score += upperWords.length * 5;

  if (text.length > 20 && text.length < 200) {
    score += 5;
  }

  if (start != null && end != null) {
    const duration = end - start;
    if (duration >= 1.5 && duration <= 8) {
      score += duration < 4 ? 8 : 3;
    }
  }

  return score;
}

function addTranscriptBonusToCandidates(candidates, transcriptSegments, reelDuration) {
  if (!transcriptSegments || transcriptSegments.length === 0) return candidates;

  const scored = candidates.map(c => {
    let transcriptScore = 0;
    const overlapping = transcriptSegments.filter(
      s => s.start < c.end && s.end > c.start
    );
    for (const seg of overlapping) {
      transcriptScore += scoreSegmentText(seg.text, seg.start, seg.end);
    }
    return { ...c, transcriptScore, score: c.score + transcriptScore };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function applyTranscriptBonus(totalDuration, scenes, silences, motionScores, audioBeats, count, reelDuration, transcript, scoreHighlightsFn) {
  const baseResults = scoreHighlightsFn(totalDuration, scenes, silences, motionScores, audioBeats, count, reelDuration);

  if (!transcript || !transcript.segments || transcript.segments.length === 0) {
    return baseResults;
  }

  const scoredCandidates = addTranscriptBonusToCandidates(
    baseResults,
    transcript.segments,
    reelDuration
  );

  const selected = [];
  const minGap = reelDuration * 0.6;
  for (const c of scoredCandidates) {
    if (selected.length >= count) break;
    if (!selected.some(s => Math.abs(s.start - c.start) < minGap)) {
      selected.push(c);
    }
  }

  selected.sort((a, b) => a.start - b.start);
  return selected;
}

module.exports = { scoreSegmentText, addTranscriptBonusToCandidates, applyTranscriptBonus, ENGAGEMENT_WORDS };
