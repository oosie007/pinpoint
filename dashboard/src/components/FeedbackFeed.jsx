import FeedbackCard from './FeedbackCard';

export default function FeedbackFeed({ items, onUpdate }) {
  if (items.length === 0) {
    return (
      <div className="feed-empty">
        No feedback matches your filters. Submit feedback via the Chrome extension.
      </div>
    );
  }

  return (
    <div className="feed-list">
      {items.map((item, index) => (
        <FeedbackCard
          key={item.id}
          item={item}
          pinNumber={index + 1}
          onUpdate={onUpdate}
        />
      ))}
    </div>
  );
}
