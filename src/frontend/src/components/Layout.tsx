import {
  FishIcon,
  LayoutDashboardIcon,
  LightbulbIcon,
  ListOrderedIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  PackageIcon,
  SunIcon,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NativeSelect } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useTheme, type Theme } from '@/context/ThemeContext';
import { cn } from '@/lib/utils';
import { useProducts } from '../context/ProductContext';
import { Link, matchPath, useRouter } from '../router';

const MENU: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'ダッシュボード', icon: LayoutDashboardIcon },
  { to: '/proposals', label: '提案', icon: LightbulbIcon },
  { to: '/backlogs', label: 'バックログ', icon: ListOrderedIcon },
  { to: '/products', label: 'プロダクト情報', icon: PackageIcon },
];

const THEMES: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'ライト', icon: SunIcon },
  { value: 'dark', label: 'ダーク', icon: MoonIcon },
  { value: 'system', label: 'システム設定に合わせる', icon: MonitorIcon },
];

function Brand() {
  return (
    <span className="flex items-center gap-2 text-base font-semibold tracking-tight">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <FishIcon className="size-4" aria-hidden="true" />
      </span>
      Flyingfish
    </span>
  );
}

function NavMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { path } = useRouter();
  return (
    <nav aria-label="メニュー">
      <ul className="space-y-1">
        {MENU.map((item) => {
          const active =
            item.to === '/' ? path === '/' : path === item.to || path.startsWith(`${item.to}/`);
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ThemeMenu() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="テーマの切り替え">
          {resolvedTheme === 'dark' ? <MoonIcon /> : <SunIcon />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>テーマ</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          {THEMES.map((item) => {
            const Icon = item.icon;
            return (
              <DropdownMenuRadioItem key={item.value} value={item.value}>
                <Icon aria-hidden="true" />
                {item.label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Header({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { products, selectedProduct, selectProduct } = useProducts();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="メニューを開く"
        onClick={onOpenMenu}
      >
        <MenuIcon />
      </Button>
      <span className="hidden sm:inline md:hidden">
        <Brand />
      </span>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <span className="hidden text-sm text-muted-foreground sm:inline" aria-hidden="true">
          プロダクト
        </span>
        <NativeSelect
          aria-label="プロダクト"
          className="w-44 min-w-0 sm:w-56"
          value={selectedProduct?.id ?? ''}
          onChange={(event) => selectProduct(event.target.value)}
        >
          <option value="">選択してください</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </NativeSelect>
        <ThemeMenu />
      </div>
    </header>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { path } = useRouter();
  // 提案一覧は固定幅のカードを並べるので、画面が広いほど並ぶ枚数を増やせるよう幅を制限しない。
  const wide = matchPath('/proposals', path) !== null;
  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col gap-6 border-r bg-sidebar px-3 py-4 text-sidebar-foreground md:flex">
        <div className="px-3">
          <Brand />
        </div>
        <NavMenu />
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-64 gap-6 px-3 py-4" aria-describedby={undefined}>
          <SheetTitle className="px-3">
            <Brand />
          </SheetTitle>
          <NavMenu onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-col">
        <Header onOpenMenu={() => setMenuOpen(true)} />
        <main
          className={cn('mx-auto w-full flex-1 px-4 py-6 md:px-8 md:py-8', !wide && 'max-w-6xl')}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
