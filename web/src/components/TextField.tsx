/**
 * Text input with the animated purple focus border.
 *
 * The mobile app requires `FormInput` because lifting focus state to a parent remounts the
 * TextInput on Android 15 + Fabric and dismisses the keyboard. That failure mode does not
 * exist in a browser — this component is here for visual parity, not to work around it, so
 * focus styling is pure CSS with no React state at all.
 */
import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string;
  /** Control rendered inside the field's right edge — the reveal toggle, today. */
  trailing?: ReactNode;
};

export function TextField({ label, className, trailing, ...rest }: Props) {
  const id = useId();
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__wrap">
        <input
          id={id}
          className={['field__input', trailing && 'field__input--trailing']
            .filter(Boolean)
            .join(' ')}
          {...rest}
        />
        {trailing && <div className="field__trailing">{trailing}</div>}
      </div>
    </div>
  );
}

/**
 * Multi-line variant, sharing the field chrome so it cannot drift from `TextField`.
 *
 * The dashboard had no textarea until now — bio is a single-line `TextField`, which is fine
 * for 160 characters. A message to the team is the first field where someone writes a
 * paragraph, and a single-line input for that makes people write less than they meant to.
 */
export function TextArea({
  label,
  className,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & { label: string }) {
  const id = useId();
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <textarea id={id} className="field__input field__input--area" {...rest} />
    </div>
  );
}

/**
 * Password field with a reveal toggle — mobile's `FormInput` has one, web did not.
 *
 * It earns its place beyond parity: this is a desktop app used at a desk, where the shoulder-
 * surfing risk that justifies masking is lowest and a mistyped password is most expensive —
 * with email confirmation on, a typo means confirming your address and then being unable to
 * sign in at all.
 *
 * `type` is swapped rather than the value being re-rendered, so password managers still see
 * a password field and offer to fill and save it.
 */
export function PasswordField({
  label,
  ...rest
}: Omit<Props, 'type' | 'trailing'> & { label: string }) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      {...rest}
      label={label}
      type={shown ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          className="field__reveal"
          // The control's own name has to say which state it is IN, not what it shows —
          // a screen reader user cannot see the icon that would disambiguate it.
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          onClick={() => setShown(v => !v)}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      }
    />
  );
}
