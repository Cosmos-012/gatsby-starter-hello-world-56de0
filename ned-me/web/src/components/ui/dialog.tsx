'use client';
import * as React from 'react';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;
export const DialogTitle = D.Title;
export const DialogDescription = D.Description;
export const DialogContent = React.forwardRef<React.ElementRef<typeof D.Content>, React.ComponentPropsWithoutRef<typeof D.Content> & { closeLabel?: string; side?: 'center' | 'start' }>(({ className, children, closeLabel = 'Close', side = 'center', ...p }, ref) => (
  <D.Portal>
    <D.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in" />
    <D.Content ref={ref} className={cn('fixed z-50 border border-border bg-card text-card-foreground shadow-xl focus-visible:outline-none',
      side === 'center' ? 'start-1/2 top-1/2 w-[calc(100%-2rem)] max-w-lg -translate-y-1/2 rounded-lg p-6 ltr:-translate-x-1/2 rtl:translate-x-1/2' : 'inset-y-0 start-0 w-72 max-w-[85vw] p-0', className)} {...p}>
      {children}
      <D.Close className="absolute end-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={closeLabel}><X className="size-4" /></D.Close>
    </D.Content>
  </D.Portal>
));
DialogContent.displayName = 'DialogContent';
