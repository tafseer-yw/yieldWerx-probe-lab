import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useQuery } from '@tanstack/react-query';

import type { WaferSummary } from '../../shared/contracts.js';
import { errorMessage } from './api.js';
import { useAuth } from './auth.js';
import { formatDateTime, Icon } from './ui.js';

interface WaferPickerProps {
  initialSequence?: number | null;
  disabled?: boolean;
  onSelect: (waferSequence: number | null) => void;
}

function waferLabel(wafer: WaferSummary): string {
  const waferNumber = String(wafer.waferNumber).padStart(2, '0');
  return `#${wafer.waferSequence} · ${wafer.device} · ${wafer.lot} · W${waferNumber} · ${wafer.testProgram} · ${wafer.yield.toFixed(2)}% yield`;
}

export function WaferPicker({
  initialSequence = null,
  disabled = false,
  onSelect,
}: WaferPickerProps): ReactElement {
  const { api } = useAuth();
  const inputId = useId();
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState(initialSequence ? `#${initialSequence}` : '');
  const [debouncedInput, setDebouncedInput] = useState(input);
  const [selected, setSelected] = useState<WaferSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedInput(input), 180);
    return () => window.clearTimeout(timer);
  }, [input]);

  const search = selected ? '' : debouncedInput.trim();
  const wafers = useQuery({
    queryKey: ['wafer-picker', search],
    enabled: open || (initialSequence !== null && selected === null),
    queryFn: () =>
      api.listWafers({
        search: search || undefined,
        page: 1,
        pageSize: 8,
      }),
  });

  const items = wafers.data?.items ?? [];

  useEffect(() => {
    setActiveIndex(items.length > 0 ? 0 : -1);
  }, [items.length, search]);

  useEffect(() => {
    if (initialSequence === null || selected !== null) return;
    const exact = items.find((wafer) => wafer.waferSequence === initialSequence);
    if (!exact) return;
    setSelected(exact);
    setInput(waferLabel(exact));
  }, [initialSequence, items, selected]);

  const choose = (wafer: WaferSummary): void => {
    setSelected(wafer);
    setInput(waferLabel(wafer));
    setOpen(false);
    onSelect(wafer.waferSequence);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.min(current + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter' && open && activeIndex >= 0) {
      event.preventDefault();
      const active = items[activeIndex];
      if (active) choose(active);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
  };

  return (
    <div className="field wafer-picker-field" ref={root} onBlur={onBlur}>
      <label className="field-label" htmlFor={inputId}>
        Find a wafer
      </label>
      <div className="wafer-picker">
        <Icon name="search" size={15} />
        <input
          id={inputId}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
          }
          placeholder="Sequence, device, lot, W07, or program"
          value={input}
          disabled={disabled}
          onFocus={(event) => {
            setOpen(true);
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setInput(event.target.value);
            setSelected(null);
            setOpen(true);
            onSelect(null);
          }}
          onKeyDown={onKeyDown}
        />
        {open ? (
          <div className="wafer-picker-menu" id={listId} role="listbox">
            {wafers.isFetching ? (
              <div className="wafer-picker-state" role="status">
                Searching wafers…
              </div>
            ) : null}
            {!wafers.isFetching && wafers.error ? (
              <div className="wafer-picker-state is-error">{errorMessage(wafers.error)}</div>
            ) : null}
            {!wafers.isFetching && !wafers.error && items.length === 0 ? (
              <div className="wafer-picker-state">No matching wafers.</div>
            ) : null}
            {!wafers.isFetching
              ? items.map((wafer, index) => (
                  <button
                    id={`${listId}-option-${index}`}
                    key={wafer.waferSequence}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={index === activeIndex ? 'is-active' : undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(wafer)}
                  >
                    <span>
                      <strong>#{wafer.waferSequence}</strong>
                      <span>{wafer.lot}</span>
                      <span>W{String(wafer.waferNumber).padStart(2, '0')}</span>
                    </span>
                    <small>
                      {wafer.device} · {wafer.testProgram} · {wafer.yield.toFixed(2)}% yield ·{' '}
                      {formatDateTime(wafer.finishTime)}
                    </small>
                  </button>
                ))
              : null}
          </div>
        ) : null}
      </div>
      <span className="field-hint">Search by any useful wafer identifier.</span>
    </div>
  );
}
