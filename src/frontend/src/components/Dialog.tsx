import type { ReactNode } from 'react';
import {
  Dialog as DialogRoot,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** 開いた状態で描画するダイアログ。閉じる操作（Esc、背景のクリック、×）で onClose を呼ぶ。 */
export function Dialog({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <DialogRoot open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-xl"
        // 説明文がないときに Radix の警告を出さない
        {...(description ? {} : { 'aria-describedby': undefined })}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </DialogRoot>
  );
}
