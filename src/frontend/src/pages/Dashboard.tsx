import { useEffect, useState } from 'react';
import { api, errorMessage, type Dashboard, type MonthlyCount } from '../api/client';
import { ErrorMessage, NoProductSelected } from '../components/common';
import { useProducts } from '../context/ProductContext';

const SERIES = [
  { key: 'proposals', label: '提案数', color: 'var(--series-1)' },
  { key: 'issues', label: 'Issue 起票数', color: 'var(--series-2)' },
  { key: 'done', label: '実装済み数', color: 'var(--series-3)' },
] as const;

type SeriesKey = (typeof SERIES)[number]['key'];

// SVG の座標系（viewBox）。幅は CSS で親に合わせて伸縮する
const WIDTH = 640;
const HEIGHT = 240;
const MARGIN = { top: 24, right: 8, bottom: 28, left: 36 };
const BAR_WIDTH = 20;
const BAR_GAP = 2;

/** 目盛りの上限を 1・2・5 の倍数に丸める。 */
export function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

function formatMonth(month: string): string {
  const [year, m] = month.split('-');
  return `${year}年${Number(m)}月`;
}

/** 上端だけ 4px 角丸の棒（下端は基線に揃えて角を付けない）。 */
function barPath(x: number, y: number, width: number, height: number): string {
  if (height <= 0) return '';
  const r = Math.min(4, height, width / 2);
  const bottom = y + height;
  return [
    `M${x},${bottom}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${bottom}`,
    'Z',
  ].join(' ');
}

function MonthlyChart({ monthly }: { monthly: MonthlyCount[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...monthly.flatMap((row) => SERIES.map((s) => row[s.key]))));
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const band = plotWidth / monthly.length;
  const groupWidth = SERIES.length * BAR_WIDTH + (SERIES.length - 1) * BAR_GAP;
  const y = (value: number) => MARGIN.top + plotHeight - (value / max) * plotHeight;
  const ticks = [0, max / 2, max];
  const active = hovered === null ? null : monthly[hovered];

  return (
    <div className="chart">
      <ul className="legend" aria-label="凡例">
        {SERIES.map((series) => (
          <li key={series.key}>
            <span className="swatch" style={{ background: series.color }} aria-hidden="true" />
            {series.label}
          </li>
        ))}
      </ul>
      <div className="chart-plot" onMouseLeave={() => setHovered(null)}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="直近 6 か月の提案数・Issue 起票数・実装済み数の推移（数値は下の表を参照）"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={WIDTH - MARGIN.right}
                y1={y(tick)}
                y2={y(tick)}
                className={tick === 0 ? 'axis-line' : 'grid-line'}
              />
              <text
                x={MARGIN.left - 6}
                y={y(tick)}
                className="axis-label"
                textAnchor="end"
                dy="0.32em"
              >
                {tick}
              </text>
            </g>
          ))}
          {monthly.map((row, index) => {
            const bandX = MARGIN.left + index * band;
            const startX = bandX + (band - groupWidth) / 2;
            return (
              <g key={row.month}>
                {hovered === index && (
                  <rect
                    x={bandX}
                    y={MARGIN.top}
                    width={band}
                    height={plotHeight}
                    className="hover-band"
                  />
                )}
                {SERIES.map((series, i) => {
                  const value = row[series.key];
                  const x = startX + i * (BAR_WIDTH + BAR_GAP);
                  return (
                    <g key={series.key}>
                      <path
                        d={barPath(x, y(value), BAR_WIDTH, y(0) - y(value))}
                        fill={series.color}
                      />
                      {value > 0 && (
                        <text
                          x={x + BAR_WIDTH / 2}
                          y={y(value) - 4}
                          className="value-label"
                          textAnchor="middle"
                        >
                          {value}
                        </text>
                      )}
                    </g>
                  );
                })}
                <text
                  x={bandX + band / 2}
                  y={HEIGHT - MARGIN.bottom + 18}
                  className="axis-label"
                  textAnchor="middle"
                >
                  {Number(row.month.slice(5))}月
                </text>
                {/* ホバーの当たり判定は棒より広い月の帯全体にする */}
                <rect
                  x={bandX}
                  y={MARGIN.top}
                  width={band}
                  height={plotHeight + MARGIN.bottom}
                  fill="transparent"
                  onMouseEnter={() => setHovered(index)}
                  data-testid={`month-${row.month}`}
                />
              </g>
            );
          })}
        </svg>
        {active && hovered !== null && (
          <div
            className="tooltip"
            role="tooltip"
            style={{
              left: `${((MARGIN.left + (hovered + 0.5) * band) / WIDTH) * 100}%`,
            }}
          >
            <strong>{formatMonth(active.month)}</strong>
            {SERIES.map((series) => (
              <div key={series.key} className="tooltip-row">
                <span className="swatch" style={{ background: series.color }} aria-hidden="true" />
                <span>{series.label}</span>
                <span className="tooltip-value">{active[series.key]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { selectedProduct } = useProducts();
  const productId = selectedProduct?.id;
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!productId) return;
    let active = true;
    api
      .getDashboard(productId)
      .then((data) => {
        if (active) setDashboard(data);
      })
      .catch((e: unknown) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [productId]);

  if (!productId) {
    return (
      <section>
        <h1>ダッシュボード</h1>
        <NoProductSelected />
      </section>
    );
  }

  const totals: { key: SeriesKey; label: string }[] = [
    { key: 'proposals', label: '提案数' },
    { key: 'issues', label: 'Issue 起票数' },
    { key: 'done', label: '実装済み数' },
  ];

  return (
    <section>
      <h1>ダッシュボード</h1>
      <ErrorMessage>{error}</ErrorMessage>
      {!dashboard ? (
        !error && <p className="muted">読み込み中…</p>
      ) : (
        <>
          <div className="stat-tiles">
            {totals.map((tile) => (
              <div key={tile.key} className="stat-tile">
                <span className="stat-label">{tile.label}</span>
                <span className="stat-value">{dashboard.totals[tile.key]}</span>
              </div>
            ))}
          </div>
          {!dashboard.githubEnabled && (
            <p className="muted">GitHub 連携が未設定のため、Issue 起票数は増えません。</p>
          )}
          <h2>月別の推移（直近 6 か月）</h2>
          <MonthlyChart monthly={dashboard.monthly} />
          <table className="table">
            <caption className="visually-hidden">月別の推移</caption>
            <thead>
              <tr>
                <th>月</th>
                {SERIES.map((series) => (
                  <th key={series.key} className="number">
                    {series.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dashboard.monthly.map((row) => (
                <tr key={row.month}>
                  <td>{formatMonth(row.month)}</td>
                  {SERIES.map((series) => (
                    <td key={series.key} className="number">
                      {row[series.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
