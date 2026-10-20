import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/** Pastilles d'état : la couleur ne porte jamais seule le sens (icône + texte fournis par l'appelant). */
export const badgeVariants = cva('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary text-primary-foreground',
      secondary: 'border-transparent bg-muted text-foreground',
      outline: 'border-border text-muted-foreground',
      good: 'border-good/40 bg-good/10 text-good-ink',
      warning: 'border-warning/50 bg-warning/15 text-warning-ink',
      critical: 'border-critical/40 bg-critical/10 text-critical-ink',
      neutral: 'border-neutral/40 bg-neutral/10 text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}
export const Badge = ({ className, variant, ...p }: BadgeProps) => <span className={cn(badgeVariants({ variant }), className)} {...p} />;
