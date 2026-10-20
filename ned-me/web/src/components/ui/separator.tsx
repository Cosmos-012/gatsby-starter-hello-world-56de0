import { cn } from '@/lib/cn';
export const Separator = ({ className, vertical }: { className?: string; vertical?: boolean }) => <div role="separator" className={cn('shrink-0 bg-border', vertical ? 'h-full w-px' : 'h-px w-full', className)} />;
