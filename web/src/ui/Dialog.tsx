// The dialogs of the app, on the modal dialog element of the browser: the page behind is
// inert, Tab stays inside, Escape closes, and the focus returns to the control that opened it.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Field } from "./fields.tsx";

/** A modal dialog that is open while it is rendered. `onClose` is called after it has closed, however that happened. */
export function Dialog({ heading, onClose, children }: { heading: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={id} onClose={onClose}>
      <h2 id={id}>{heading}</h2>
      {children}
    </dialog>
  );
}

/** Asks before something is deleted. Cancel comes first, so it has the focus when the dialog opens. */
export function ConfirmDialog({ heading, body, action, onDone }: { heading: string; body: ReactNode; action: string; onDone: (confirmed: boolean) => void }) {
  const confirmed = useRef(false);
  return (
    <Dialog heading={heading} onClose={() => onDone(confirmed.current)}>
      <p>{body}</p>
      <form method="dialog" className="dialog-actions">
        <button className="btn btn-quiet">Cancel</button>
        <button className="btn btn-danger" onClick={() => (confirmed.current = true)}>{action}</button>
      </form>
    </Dialog>
  );
}

/** Asks for a name. An empty name is refused next to the field, and the dialog stays open. */
export function NameDialog({ heading, label, initial, action, onDone }: { heading: string; label: string; initial: string; action: string; onDone: (name?: string) => void }) {
  const [text, setText] = useState(initial);
  const [refused, setRefused] = useState(false);
  const accepted = useRef(false);
  return (
    <Dialog heading={heading} onClose={() => onDone(accepted.current ? text.trim() : undefined)}>
      <form
        method="dialog"
        onSubmit={(event) => {
          accepted.current = text.trim() !== "";
          if (accepted.current) return;
          event.preventDefault();
          setRefused(true);
          event.currentTarget.querySelector("input")?.focus();
        }}
      >
        <Field label={label} issues={refused && text.trim() === "" ? [{ where: "", message: "Type a name." }] : []}>
          {(tie) => <input {...tie} type="text" className="input" autoComplete="off" value={text} onChange={(event) => setText(event.target.value)} onFocus={(event) => event.target.select()} />}
        </Field>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={(event) => event.currentTarget.closest("dialog")?.close()}>Cancel</button>
          <button className="btn btn-primary">{action}</button>
        </div>
      </form>
    </Dialog>
  );
}
