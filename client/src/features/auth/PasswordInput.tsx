import {
  forwardRef,
  useEffect,
  useState,
  type InputHTMLAttributes,
} from 'react';
import { Eye, EyeOff } from 'lucide-react';

export const PasswordInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function PasswordInput(props, ref) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, [visible]);

  return (
    <div className="password-input">
      <input {...props} ref={ref} type={visible ? 'text' : 'password'} />
      <button
        className="password-visibility"
        type="button"
        disabled={props.disabled}
        aria-label={visible ? 'Hide password' : 'Show password for 5 seconds'}
        aria-pressed={visible}
        aria-controls={props.id}
        title={visible ? 'Hide password' : 'Show password for 5 seconds'}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? (
          <EyeOff size={18} aria-hidden="true" />
        ) : (
          <Eye size={18} aria-hidden="true" />
        )}
      </button>
    </div>
  );
});
