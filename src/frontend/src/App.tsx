import { lazy, Suspense } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { EmptyState, LoadingState, PageHeader } from './components/common';
import { Layout } from './components/Layout';
import { ProductProvider, useProducts } from './context/ProductContext';
import { ThemeProvider } from './context/ThemeContext';
import { BacklogDetailPage } from './pages/BacklogDetail';
import { BacklogsPage } from './pages/Backlogs';
import { ProposalFormPage } from './pages/ProposalForm';
import { ProposalsPage } from './pages/Proposals';
import { ProductsPage } from './pages/Products';
import { matchPath, RouterProvider, useRouter } from './router';

// ダッシュボードはグラフ（Recharts）が大きいため、別のチャンクに分けて読み込む
const DashboardPage = lazy(() =>
  import('./pages/Dashboard').then((module) => ({ default: module.DashboardPage })),
);

function Routes() {
  const { path } = useRouter();
  // プロダクトを切り替えたら画面の状態を作り直す
  const key = useProducts().selectedProduct?.id ?? '';
  const edit = matchPath('/proposals/:id/edit', path);
  const backlog = matchPath('/backlogs/:id', path);

  if (path === '/') {
    return (
      <Suspense fallback={<LoadingState rows={4} />}>
        <DashboardPage key={key} />
      </Suspense>
    );
  }
  if (path === '/proposals') return <ProposalsPage key={key} />;
  if (path === '/proposals/new') return <ProposalFormPage key={key} />;
  if (edit) return <ProposalFormPage key={key} proposalId={edit.id} />;
  if (path === '/backlogs') return <BacklogsPage key={key} />;
  if (backlog) return <BacklogDetailPage key={key} backlogId={backlog.id} />;
  if (path === '/products') return <ProductsPage />;
  return (
    <section>
      <PageHeader title="ページが見つかりません" />
      <EmptyState>URL を確認するか、左のメニューから画面を選んでください。</EmptyState>
    </section>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <RouterProvider>
        <ProductProvider>
          <Layout>
            <Routes />
          </Layout>
        </ProductProvider>
      </RouterProvider>
      <Toaster richColors closeButton position="top-right" />
    </ThemeProvider>
  );
}
