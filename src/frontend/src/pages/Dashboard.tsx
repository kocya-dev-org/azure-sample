import { CircleCheckIcon, CircleDotIcon, LightbulbIcon, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, errorMessage, type Dashboard } from '../api/client';
import { ErrorMessage, LoadingState, NoProductSelected, PageHeader } from '../components/common';
import { useProducts } from '../context/ProductContext';

type SeriesKey = 'proposals' | 'issues' | 'done';

// 系列の色は index.css の --chart-1〜3（dataviz の検証済みパレット。ライトとダークで別の段）
const SERIES: { key: SeriesKey; label: string; icon: LucideIcon }[] = [
  { key: 'proposals', label: '提案数', icon: LightbulbIcon },
  { key: 'issues', label: 'Issue 起票数', icon: CircleDotIcon },
  { key: 'done', label: '実装済み数', icon: CircleCheckIcon },
];

const chartConfig = {
  proposals: { label: '提案数', color: 'var(--chart-1)' },
  issues: { label: 'Issue 起票数', color: 'var(--chart-2)' },
  done: { label: '実装済み数', color: 'var(--chart-3)' },
} satisfies ChartConfig;

/** 凡例とツールチップを、Recharts の既定（名前順）ではなく SERIES の順に並べる。 */
function seriesOrder(item: { dataKey?: unknown }): number {
  return SERIES.findIndex((series) => series.key === item.dataKey);
}

function formatMonth(month: string): string {
  const [year, m] = month.split('-');
  return `${year}年${Number(m)}月`;
}

function MonthlyChart({ monthly }: { monthly: Dashboard['monthly'] }) {
  return (
    <div
      role="img"
      aria-label="直近 6 か月の提案数・Issue 起票数・実装済み数の推移（数値は下の表を参照）"
    >
      <ChartContainer config={chartConfig} className="aspect-auto h-72 w-full">
        <BarChart data={monthly} barGap={2} barCategoryGap="20%" margin={{ top: 20, left: -16 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(month: string) => `${Number(month.slice(5))}月`}
          />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={48} />
          <ChartTooltip
            cursor={{ fillOpacity: 0.6 }}
            itemSorter={seriesOrder}
            content={
              <ChartTooltipContent
                indicator="dot"
                labelFormatter={(_, payload) => {
                  const month = (payload?.[0]?.payload as { month?: string } | undefined)?.month;
                  return month ? formatMonth(month) : '';
                }}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} itemSorter={seriesOrder} />
          {SERIES.map((series) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              fill={`var(--color-${series.key})`}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            >
              {/* ライトの面では一部の系列色のコントラストが 3:1 未満のため、値を直接表示する */}
              <LabelList
                dataKey={series.key}
                position="top"
                offset={6}
                className="fill-foreground"
                fontSize={11}
                formatter={(value: unknown) => (Number(value) > 0 ? String(value) : '')}
              />
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
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
        <PageHeader title="ダッシュボード" />
        <NoProductSelected />
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        title="ダッシュボード"
        description={`${selectedProduct.name} の提案と開発の状況です。`}
      />
      <ErrorMessage>{error}</ErrorMessage>
      {!dashboard ? (
        !error && <LoadingState rows={4} />
      ) : (
        <div className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {SERIES.map((tile) => {
              const Icon = tile.icon;
              return (
                <Card key={tile.key} className="gap-2">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardDescription className="font-medium">{tile.label}</CardDescription>
                    <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <span className="text-3xl font-semibold tracking-tight tabular-nums">
                      {dashboard.totals[tile.key]}
                    </span>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {!dashboard.githubEnabled && (
            <p className="-mt-2 text-sm text-muted-foreground">
              GitHub 連携が未設定のため、Issue 起票数は増えません。
            </p>
          )}
          <Card>
            <CardHeader>
              <CardTitle>月別の推移（直近 6 か月）</CardTitle>
              <CardDescription>月ごとの提案数・Issue 起票数・実装済み数</CardDescription>
            </CardHeader>
            <CardContent>
              <MonthlyChart monthly={dashboard.monthly} />
            </CardContent>
          </Card>
          <Card className="gap-0 overflow-hidden py-0">
            <Table>
              <caption className="sr-only">月別の推移</caption>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-4">月</TableHead>
                  {SERIES.map((series) => (
                    <TableHead key={series.key} className="text-right last:pr-4">
                      {series.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.monthly.map((row) => (
                  <TableRow key={row.month}>
                    <TableCell className="pl-4">{formatMonth(row.month)}</TableCell>
                    {SERIES.map((series) => (
                      <TableCell key={series.key} className="text-right tabular-nums last:pr-4">
                        {row[series.key]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </section>
  );
}
