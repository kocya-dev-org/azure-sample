import { Layout } from './components/Layout';
import { ProductProvider } from './context/ProductContext';
import { ProductsPage } from './pages/Products';
import { matchPath, Redirect, RouterProvider, useRouter } from './router';

function Placeholder({ title }: { title: string }) {
  return (
    <section>
      <h1>{title}</h1>
      <p>準備中です。</p>
    </section>
  );
}

function Routes() {
  const { path } = useRouter();

  if (path === '/') return <Redirect to="/proposals" />;
  if (path === '/proposals') return <Placeholder title="提案" />;
  if (path === '/proposals/new') return <Placeholder title="提案の新規登録" />;
  if (matchPath('/proposals/:id/edit', path)) return <Placeholder title="提案の編集" />;
  if (path === '/backlogs') return <Placeholder title="バックログ" />;
  if (matchPath('/backlogs/:id', path)) return <Placeholder title="バックログ詳細" />;
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
