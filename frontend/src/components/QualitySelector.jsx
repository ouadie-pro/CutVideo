import './QualitySelector.css';

export default function QualitySelector({ qualities, value, onChange }) {
  if (!qualities || qualities.length === 0) return null;

  const sortedQualities = [...qualities].sort((a, b) => {
    const numA = parseInt(a);
    const numB = parseInt(b);
    return numB - numA;
  });

  return (
    <div className="quality-selector">
      <label className="quality-label">Quality</label>
      <div className="quality-options">
        {sortedQualities.map((q) => (
          <button
            key={q}
            className={`quality-btn ${value === q ? 'active' : ''}`}
            onClick={() => onChange(q)}
            type="button"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
