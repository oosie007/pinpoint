function shortId(uuid) {
  if (!uuid) return 'unknown';
  return uuid.replace(/-/g, '').slice(0, 8);
}

export default function ExportButton({ feedback, prototypeFilter }) {
  const exportable = feedback.filter(
    (item) => item.status !== 'done' && item.priority != null
  );

  const sorted = [...exportable].sort((a, b) => {
    const order = { p1: 0, p2: 1, p3: 2 };
    return (order[a.priority] ?? 9) - (order[b.priority] ?? 9);
  });

  const handleExport = () => {
    const now = new Date().toISOString();
    const date = now.slice(0, 10);
    const prototype =
      prototypeFilter && prototypeFilter !== 'all' ? prototypeFilter : 'all';

    const payload = {
      generated_at: now,
      prototype,
      task_count: sorted.length,
      tasks: sorted.map((item) => ({
        id: `fb-${shortId(item.id)}`,
        priority: item.priority,
        category: item.category,
        user_name: item.user_name,
        comment: item.comment,
        element_selector: item.element_selector,
        element_text: item.element_text,
        page_url: item.page_url,
        prototype_id: item.prototype_id,
        screenshot_url: item.screenshot_url,
        created_at: item.created_at,
      })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pinpoint-tasks-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      className="export-btn"
      onClick={handleExport}
      disabled={sorted.length === 0}
    >
      Export for Claude Code ({sorted.length})
    </button>
  );
}
