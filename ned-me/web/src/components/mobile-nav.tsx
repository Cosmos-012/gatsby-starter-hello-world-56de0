'use client';
import { useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

/** Menu latéral des petits écrans : le contenu (liste de liens) est rendu côté serveur et reçu en `children`. */
export function MobileNav({ children, openLabel, closeLabel, title }: { children: ReactNode; openLabel: string; closeLabel: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden" aria-label={openLabel}><Menu /></Button></DialogTrigger>
      <DialogContent side="start" closeLabel={closeLabel} className="bg-sidebar text-sidebar-foreground border-sidebar-border" aria-describedby={undefined}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setOpen(false); }}>{children}</div>
      </DialogContent>
    </Dialog>
  );
}
