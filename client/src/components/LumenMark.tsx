import { MARK_SVG } from '../brand/mark';

/** Lumen's "J" mark. Decorative: label the link or heading next to it instead. Size it with CSS (width/height). */
export function LumenMark({ class: className }: { class?: string }) {
  return (
    <span
      class={`lmn-mark${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: MARK_SVG }}
    />
  );
}
