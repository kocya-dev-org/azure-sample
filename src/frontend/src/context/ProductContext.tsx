// 操作対象のプロダクト。選択はブラウザーに保存し、次回も同じプロダクトを開く。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, errorMessage, type Product } from '../api/client';

const STORAGE_KEY = 'flyingfish.selectedProductId';

function loadSelectedId(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeSelectedId(id: string): void {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 保存できない環境では選択を記憶しない
  }
}

interface ProductContextValue {
  products: Product[];
  loading: boolean;
  error: string;
  selectedProduct: Product | undefined;
  selectProduct: (id: string) => void;
  reload: () => Promise<void>;
}

const ProductContext = createContext<ProductContextValue | null>(null);

export function ProductProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(loadSelectedId);

  const load = useCallback(
    (isActive: () => boolean = () => true) =>
      api
        .listProducts()
        .then((list) => {
          if (!isActive()) return;
          setProducts(list);
          setError('');
        })
        .catch((e: unknown) => {
          if (isActive()) setError(errorMessage(e));
        })
        .finally(() => {
          if (isActive()) setLoading(false);
        }),
    [],
  );

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load]);

  const reload = useCallback(() => load(), [load]);

  const selectProduct = useCallback((id: string) => {
    setSelectedId(id);
    storeSelectedId(id);
  }, []);

  const selectedProduct = products.find((product) => product.id === selectedId);

  const value = useMemo(
    () => ({ products, loading, error, selectedProduct, selectProduct, reload }),
    [products, loading, error, selectedProduct, selectProduct, reload],
  );
  return <ProductContext.Provider value={value}>{children}</ProductContext.Provider>;
}

export function useProducts(): ProductContextValue {
  const value = useContext(ProductContext);
  if (!value) throw new Error('useProducts は ProductProvider の中で使ってください。');
  return value;
}
