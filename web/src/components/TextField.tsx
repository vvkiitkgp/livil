/**
 * Text input with the animated purple focus border.
 *
 * The mobile app requires `FormInput` because lifting focus state to a parent remounts the
 * TextInput on Android 15 + Fabric and dismisses the keyboard. That failure mode does not
 * exist in a browser — this component is here for visual parity, not to work around it, so
 * focus styling is pure CSS with no React state at all.
 */
import { useId, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string;
};

export function TextField({ label, className, ...rest }: Props) {
  const id = useId();
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="field__input" {...rest} />
    </div>
  );
}
