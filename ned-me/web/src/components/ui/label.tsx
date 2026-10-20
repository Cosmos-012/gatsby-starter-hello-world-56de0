'use client';
import * as React from 'react';
import * as L from '@radix-ui/react-label';
import { cn } from '@/lib/cn';

export const Label = React.forwardRef<React.ElementRef<typeof L.Root>, React.ComponentPropsWithoutRef<typeof L.Root>>(({ className, ...p }, ref) => <L.Root ref={ref} className={cn('text-[13px] font-medium text-muted-foreground', className)} {...p} />);
Label.displayName = 'Label';
