import { useState } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { supabase } from '../supabaseClient';

function formatTime(createdAt) {
  const date = new Date(createdAt);
  const hoursAgo = (Date.now() - date.getTime()) / (1000 * 60 * 60);
  if (hoursAgo < 48) {
    return formatDistanceToNow(date, { addSuffix: true });
  }
  return format(date, 'MMM d');
}

export default function FeedbackCard({ item, pinNumber, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [tagsInput, setTagsInput] = useState(
    Array.isArray(item.tags) ? item.tags.join(', ') : ''
  );

  const selectorTruncated =
    item.element_selector && item.element_selector.length > 80 && !expanded;

  const updateField = async (fields) => {
    const { error } = await supabase
      .from('feedback')
      .update(fields)
      .eq('id', item.id);

    if (!error) {
      onUpdate({ ...item, ...fields });
    }
  };

  const handlePriorityChange = (e) => {
    const val = e.target.value;
    const priority = val === '' ? null : val;
    updateField({ priority });
  };

  const handleStatusChange = (e) => {
    updateField({ status: e.target.value });
  };

  const handleTagsBlur = () => {
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    updateField({ tags });
  };

  return (
    <article className={`feedback-card category-${item.category}`}>
      <div className="card-top">
        <span className="pin-num">#{String(pinNumber).padStart(3, '0')}</span>
        <span className="prototype-pill">{item.prototype_id}</span>
        <span className={`category-badge ${item.category}`}>{item.category}</span>
        <span className="card-time">{formatTime(item.created_at)}</span>
      </div>

      <div className="card-user">{item.user_name}</div>
      <p className="card-comment">{item.comment}</p>

      {(item.element_text || item.element_selector) && (
        <div className="card-context">
          {item.element_text && <div>{item.element_text}</div>}
          {item.element_selector && (
            <div className="selector">
              {selectorTruncated
                ? `${item.element_selector.slice(0, 80)}…`
                : item.element_selector}
            </div>
          )}
          {item.element_selector && item.element_selector.length > 80 && (
            <button
              type="button"
              className="expand-btn"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}

      {item.screenshot_url && (
        <a href={item.screenshot_url} target="_blank" rel="noopener noreferrer">
          <img
            className="card-screenshot"
            src={item.screenshot_url}
            alt="Screenshot"
          />
        </a>
      )}

      <div className="triage-row">
        <div className="triage-field">
          <label htmlFor={`priority-${item.id}`}>Priority</label>
          <select
            id={`priority-${item.id}`}
            value={item.priority || ''}
            onChange={handlePriorityChange}
            className={item.priority === 'p1' ? 'priority-p1' : ''}
          >
            <option value="">—</option>
            <option value="p1">P1</option>
            <option value="p2">P2</option>
            <option value="p3">P3</option>
          </select>
        </div>

        <div className="triage-field">
          <label htmlFor={`status-${item.id}`}>Status</label>
          <select
            id={`status-${item.id}`}
            value={item.status}
            onChange={handleStatusChange}
            className={item.status === 'done' ? 'status-done' : ''}
          >
            <option value="open">Open</option>
            <option value="doing">Doing</option>
            <option value="done">Done</option>
          </select>
        </div>

        <div className="triage-field tags-field">
          <label htmlFor={`tags-${item.id}`}>Tags</label>
          <input
            id={`tags-${item.id}`}
            type="text"
            placeholder="comma-separated"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            onBlur={handleTagsBlur}
          />
        </div>
      </div>
    </article>
  );
}
