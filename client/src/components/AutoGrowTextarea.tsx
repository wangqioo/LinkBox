import { forwardRef, TextareaHTMLAttributes, useImperativeHandle, useLayoutEffect, useRef } from 'react';

type AutoGrowTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  maxHeight?: number;
};

const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, AutoGrowTextareaProps>(function AutoGrowTextarea(
  { maxHeight = 180, style, rows = 1, onChange, ...props },
  forwardedRef,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(forwardedRef, () => ref.current as HTMLTextAreaElement);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };

  useLayoutEffect(() => {
    resize();
  }, [props.value, maxHeight]);

  return (
    <textarea
      {...props}
      ref={ref}
      rows={rows}
      style={{ ...style, resize: 'none' }}
      onChange={event => {
        onChange?.(event);
        requestAnimationFrame(resize);
      }}
    />
  );
});

export default AutoGrowTextarea;
