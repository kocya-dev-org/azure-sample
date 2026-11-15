import { Layout } from './components/Layout';
import { ProductProvider, useProducts } from './context/ProductContext';
import { BacklogDetailPage } from './pages/BacklogDetail';
import { BacklogsPage } from './pages/Backlogs';
import { ProposalFormPage } from './pages/ProposalForm';
import { ProposalsPage } from './pages/Proposals';
import { ProductsPage } from './pages/Products';
import { matchPath, Redirect, RouterProvider, useRouter } from './router';

function Routes() {
  const { path } = useRouter();
  // プロダクトを切り替えたら画面の状態を作り直す
  const key = useProducts().selectedProduct?.id ?? '';
  const edit = matchPath('/proposals/:id/edit', path);
  const backlog = matchPath('/backlogs/:id', path);

  if (path === '/') return <Redirect to="/proposals" />;
  if (path === '/proposals') return <ProposalsPage key={key} />;
  if (path === '/proposals/new') return <ProposalFormPage key={key} />;
  if (edit) return <ProposalFormPage key={key} proposalId={edit.id} />;
  if (path === '/backlogs') return <BacklogsPage key={key} />;
  if (backlog) return <BacklogDetailPage key={key} backlogId={backlog.id} />;
  if (path === '/products') return <ProductsPage />;
  return (
    <section>
      <h1>ページが見つかりません</h1>
    </section>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <ProductProvider>
        <Layout>
          <Routes />
        </Layout>
      </ProductProvider>
    </RouterProvider>
  );
}
