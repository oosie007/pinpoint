export default function FilterBar({
  feedback,
  filters,
  onFilterChange,
}) {
  const prototypes = [...new Set(feedback.map((f) => f.prototype_id))].sort();

  return (
    <aside className="filter-sidebar">
      <h2>Filters</h2>

      <div className="filter-group">
        <label htmlFor="filter-prototype">Prototype</label>
        <select
          id="filter-prototype"
          value={filters.prototype}
          onChange={(e) => onFilterChange({ prototype: e.target.value })}
        >
          <option value="all">All</option>
          {prototypes.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="filter-category">Category</label>
        <select
          id="filter-category"
          value={filters.category}
          onChange={(e) => onFilterChange({ category: e.target.value })}
        >
          <option value="all">All</option>
          <option value="bug">Bug</option>
          <option value="idea">Idea</option>
          <option value="question">Question</option>
          <option value="unclear">Unclear</option>
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="filter-status">Status</label>
        <select
          id="filter-status"
          value={filters.status}
          onChange={(e) => onFilterChange({ status: e.target.value })}
        >
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="doing">Doing</option>
          <option value="done">Done</option>
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="filter-priority">Priority</label>
        <select
          id="filter-priority"
          value={filters.priority}
          onChange={(e) => onFilterChange({ priority: e.target.value })}
        >
          <option value="all">All</option>
          <option value="p1">P1</option>
          <option value="p2">P2</option>
          <option value="p3">P3</option>
          <option value="unset">Unset</option>
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="filter-search">Search</label>
        <input
          id="filter-search"
          type="search"
          placeholder="Comment or element text…"
          value={filters.search}
          onChange={(e) => onFilterChange({ search: e.target.value })}
        />
      </div>
    </aside>
  );
}
