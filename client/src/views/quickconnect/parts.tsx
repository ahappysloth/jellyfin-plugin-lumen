import type { Ref } from 'preact';
import { CODE_LENGTH, normalizeCode } from './model';
import { QR_QUIET, qrPath, type QrCode } from './qr';

/**
 * A QR code as one SVG path, dark on a white tile with the standard's quiet zone: many scanners don't read a light code
 * on dark. SVG rather than canvas: it draws the same on Chromium 68 and Safari 13 and stays sharp on a 4K TV.
 */
export function QrImage({ code, label }: { code: QrCode; label: string }) {
  const box = code.size + 2 * QR_QUIET;
  return (
    <svg
      class="lmn-qc-qr"
      viewBox={`0 0 ${box} ${box}`}
      role="img"
      aria-label={label}
      shape-rendering="crispEdges"
    >
      <rect width={box} height={box} fill="#fff" />
      <path d={qrPath(code)} fill="#000" />
    </svg>
  );
}

/**
 * The code field: one input drawn as six cells. One field (not six) is one label to a screen reader, pastes whole,
 * deletes with the phone keyboard's own Backspace, and on a TV leaves Left and Right to the field and Down to the next
 * control, as jellyfin-web's remote navigation expects, without the on-screen keyboard reopening for every digit.
 * `inputmode="numeric"` brings up digits; `autocomplete="off"`, not "one-time-code": these codes never come by text or
 * email, so all iOS could offer is someone's bank code. No maxlength (model.ts normalizeCode).
 */
export function CodeInput({
  id,
  value,
  onChange,
  describedBy,
  invalid,
  inputRef,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  describedBy?: string;
  invalid?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  // A tap or click puts the caret at the end, where the cells show the next digit goes (the invisible text under them
  // doesn't line up with the cells). Not a selection, though: focus by keyboard selects the whole code, and so does a
  // double click, so the next code typed or pasted replaces it rather than being cut off after six digits.
  const toEnd = (e: Event): void => {
    const input = e.currentTarget as HTMLInputElement;
    const end = input.value.length;
    if (input.selectionStart === input.selectionEnd) input.setSelectionRange(end, end);
  };
  const cells = [];
  for (let i = 0; i < CODE_LENGTH; i++) {
    const active = i === Math.min(value.length, CODE_LENGTH - 1);
    cells.push(
      <span key={i} class={active ? 'is-active' : undefined}>
        {value[i] ?? ''}
      </span>,
    );
  }
  return (
    <div class="lmn-qc-code">
      <input
        ref={inputRef}
        id={id}
        class="lmn-autofocus"
        type="text"
        inputmode="numeric"
        pattern="[0-9]*"
        autocomplete="off"
        value={value}
        aria-describedby={describedBy}
        aria-invalid={invalid ? 'true' : undefined}
        onInput={(e) => {
          const input = e.currentTarget;
          const next = normalizeCode(input.value);
          // Put back what was kept, so a stray letter never shows, even for a moment.
          if (input.value !== next) input.value = next;
          onChange(next);
        }}
        onClick={toEnd}
      />
      <div aria-hidden="true">{cells}</div>
    </div>
  );
}
