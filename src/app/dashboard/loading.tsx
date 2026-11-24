export default function DashboardLoading() {
  return (
    <div
      className="page-stack"
      aria-busy="true"
      aria-label="A carregar dashboard"
    >
      <div className="skeleton heading-skeleton" />
      <div className="stats-grid">
        {[0, 1, 2, 3].map((item) => (
          <div className="skeleton stat-skeleton" key={item} />
        ))}
      </div>
      <div className="skeleton panel-skeleton" />
    </div>
  );
}
