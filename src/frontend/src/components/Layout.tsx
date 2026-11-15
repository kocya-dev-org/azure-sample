import type { ReactNode } from 'react';
import { useProducts } from '../context/ProductContext';
import { Link, useRouter } from '../router';

const MENU = [
  { to: '/proposals', label: '提案' },
  { to: '/backlogs', label: 'バックログ' },
  { to: '/products', label: 'プロダクト情報' },
];

function Header() {
  const { products, selectedProduct, selectProduct } = useProducts();
  return (
    <header className="header">
      <span className="brand">Flyingfish</span>
      <label className="product-select">
        <span>プロダクト</span>
        <select
          value={selectedProduct?.id ?? ''}
          onChange={(event) => selectProduct(event.target.value)}
        >
          <option value="">選択してください</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </label>
    </header>
  );
}

function SideMenu() {
  const { path } = useRouter();
  return (
    <nav className="side-menu" aria-label="メニュー">
      <ul>
        {MENU.map((item) => {
          const active = path === item.to || path.startsWith(`${item.to}/`);
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                className={active ? 'active' : undefined}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="layout">
      <Header />
      <SideMenu />
      <main className="content">{children}</main>
    </div>
  );
}
