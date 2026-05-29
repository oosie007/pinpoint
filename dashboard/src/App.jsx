import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import FilterBar from './components/FilterBar';
import FeedbackFeed from './components/FeedbackFeed';
import ExportButton from './components/ExportButton';

const DEFAULT_FILTERS = {
  prototype: 'all',
  category: 'all',
  status: 'all',
  priority: 'all',
  search: '',
};

function applyFilters(items, filters) {
  return items.filter((item) => {
    if (filters.prototype !== 'all' && item.prototype_id !== filters.prototype) {
      return false;
    }
    if (filters.category !== 'all' && item.category !== filters.category) {
      return false;
    }
    if (filters.status !== 'all' && item.status !== filters.status) {
      return false;
    }
    if (filters.priority === 'unset' && item.priority != null) {
      return false;
    }
    if (
      filters.priority !== 'all' &&
      filters.priority !== 'unset' &&
      item.priority !== filters.priority
    ) {
      return false;
    }
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      const inComment = (item.comment || '').toLowerCase().includes(q);
      const inElement = (item.element_text || '').toLowerCase().includes(q);
      if (!inComment && !inElement) return false;
    }
    return true;
  });
}

export default function App() {
  const [feedback, setFeedback] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadFeedback = useCallback(async () => {
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    setFeedback(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadFeedback();

    const channel = supabase
      .channel('feedback-inserts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'feedback' },
        (payload) => {
          setFeedback((prev) => {
            if (prev.some((f) => f.id === payload.new.id)) return prev;
            return [payload.new, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadFeedback]);

  const handleFilterChange = (patch) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const handleCardUpdate = (updated) => {
    setFeedback((prev) =>
      prev.map((f) => (f.id === updated.id ? updated : f))
    );
  };

  const filtered = useMemo(
    () => applyFilters(feedback, filters),
    [feedback, filters]
  );

  const missingEnv =
    !import.meta.env.VITE_SUPABASE_URL ||
    !import.meta.env.VITE_SUPABASE_ANON_KEY;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-left">
          <h1 className="wordmark">Pinpoint</h1>
          <span className="count-badge">{filtered.length}</span>
        </div>
        <ExportButton feedback={feedback} prototypeFilter={filters.prototype} />
      </header>

      {missingEnv && (
        <div className="feed-error">
          Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in dashboard/.env
        </div>
      )}

      {error && <div className="feed-error">{error}</div>}

      <div className="app-layout">
        <FilterBar
          feedback={feedback}
          filters={filters}
          onFilterChange={handleFilterChange}
        />

        <main className="feed-main">
          {loading ? (
            <div className="feed-loading">Loading feedback…</div>
          ) : (
            <FeedbackFeed items={filtered} onUpdate={handleCardUpdate} />
          )}
        </main>
      </div>
    </div>
  );
}
