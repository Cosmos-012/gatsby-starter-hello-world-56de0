import * as React from 'react';
import { cn } from '@/lib/cn';

const field = 'flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...p }, ref) => <input ref={ref} type={type} className={cn(field, 'file:me-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:font-medium', className)} {...p} />);
Input.displayName = 'Input';
/** Liste native stylée : accessible, fonctionne sans JavaScript et dans les formulaires GET/POST. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn(field, 'pe-8', className)} {...p} />);
Select.displayName = 'Select';
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(field, 'h-auto min-h-20 py-2', className)} {...p} />);
Textarea.displayName = 'Textarea';
