// The component catalog: every shared control in every state, on the same styles and icons
// as the app. It reads no stored data. Open it with `npm run catalog`. It is not part of the
// built app. A new control or state is added here first.

import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/app.css";
import { Alert, Checkbox, Disclosure, IconButton, Loading, Select, ThemeSwitch } from "./ui/controls.tsx";
import { ConfirmDialog, NameDialog } from "./ui/Dialog.tsx";
import { CheckField, Field, FileButton, Num, Pick, Problems } from "./ui/fields.tsx";
import { Icon, type IconName } from "./ui/Icon.tsx";
import { startTooltips } from "./ui/tooltip.ts";

const ICONS: IconName[] = [
  "check", "chevron-down", "chevron-left", "chevron-right", "circle-check", "circle-exclamation-point", "copy", "download", "info",
  "loader-circle", "menu", "monitor", "moon", "pencil", "play", "plus", "square", "sun", "trash", "triangle-exclamation-point", "upload", "x",
];
const FRUIT = [{ value: "a", label: "First choice" }, { value: "b", label: "Second choice" }, { value: "c", label: "A third choice with a longer name" }];

function Part({ heading, note, children }: { heading: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <h2>{heading}</h2>
      {note && <p className="lead">{note}</p>}
      {children}
    </section>
  );
}

function Catalog() {
  const [choice, setChoice] = useState("a");
  const [number, setNumber] = useState<unknown>(12.5);
  const [checked, setChecked] = useState(true);
  const [dialog, setDialog] = useState<ReactNode>();
  const [last, setLast] = useState("");
  const [current, setCurrent] = useState("variables");
  const direction = () => (document.documentElement.dir = document.documentElement.dir === "rtl" ? "ltr" : "rtl");

  return (
    <div className="page">
      <div className="section-head">
        <h1>Component catalog</h1>
        <div className="row actions">
          <button type="button" className="btn btn-quiet btn-compact" onClick={direction}>Switch the direction</button>
          <ThemeSwitch />
        </div>
      </div>
      <p className="lead">Every shared control of YPEA Studio, in every state. Check each one in both themes, with the keyboard, and in a narrow window.</p>
      {dialog}

      <Part heading="Buttons" note="A page has one filled primary button. This page shows every kind side by side only because it is the catalog.">
        <div className="row actions">
          <button type="button" className="btn btn-primary"><Icon name="play" />Primary</button>
          <button type="button" className="btn btn-secondary">Secondary</button>
          <button type="button" className="btn btn-quiet">Quiet</button>
          <button type="button" className="btn btn-danger">Danger</button>
          <button type="button" className="btn btn-secondary" disabled>Disabled</button>
          <button type="button" className="btn btn-secondary" aria-busy="true">Busy</button>
          <button type="button" className="btn btn-quiet btn-compact" aria-disabled="true" data-tip="The reason it cannot be used now."><Icon name="trash" />Locked, with its reason</button>
        </div>
        <div className="row actions">
          <button type="button" className="btn btn-secondary btn-compact"><Icon name="plus" />Compact</button>
          <IconButton icon="pencil" label="Rename the example" tip="Rename" onClick={() => {}} />
          <IconButton icon="copy" label="Duplicate the example" tip="Duplicate" onClick={() => {}} />
          <IconButton icon="trash" label="Delete the example" tip="Delete" onClick={() => {}} />
          <span className="hint">Icon buttons show a tooltip on hover and on keyboard focus.</span>
        </div>
      </Part>

      <Part heading="Fields">
        <div className="row">
          <Field label="Text field" hint="A hint says what fits, before anything is typed.">
            {(tie) => <input {...tie} type="text" className="input" defaultValue="Some text" />}
          </Field>
          <Field label="With a problem" issues={[{ where: "", message: "the name is used twice." }]}>
            {(tie) => <input {...tie} type="text" className="input code" defaultValue="voltage" />}
          </Field>
          <Field label="Disabled" hint="With the reason next to it.">
            {(tie) => <input {...tie} type="text" className="input" defaultValue="Not yet" disabled />}
          </Field>
          <Field label="Number" className="narrow">
            {(tie) => <Num {...tie} value={number} onChange={setNumber} />}
          </Field>
        </div>
        <Field label="Text area" className="wide">
          {(tie) => <textarea {...tie} className="textarea" rows={2} defaultValue="Several lines of plain text." />}
        </Field>
        <Field label="Code field" className="wide" issues={[{ where: "", message: "Expected a value here.", line: 2, column: 6 }]}>
          {(tie) => <textarea {...tie} className="textarea code" rows={3} spellCheck={false} defaultValue={"sum((pressure - offset)\n  ** )"} />}
        </Field>
        <div className="row">
          <Field label="Name of column 0" hint={<>2 places still use the old name <code>weight</code>. <button type="button" className="btn btn-quiet btn-compact">Rename there too</button></>}>
            {(tie) => <input {...tie} type="text" className="input code" defaultValue="mass" />}
          </Field>
          <Field label="Unit of column 0" className="narrow">
            {(tie) => <input {...tie} type="text" className="input" defaultValue="kg" />}
          </Field>
          <button type="button" className="btn btn-quiet btn-compact beside-field" aria-label="Remove column mass"><Icon name="trash" />Remove column</button>
        </div>
        <p className="hint suggested">Simulated Annealing is suggested for this project because its variables are orderings, selections or groups. You can change it.</p>
        <p className="ok"><Icon name="circle-check" />Checked: this gives one number.</p>
        <Problems issues={[{ where: "", message: "a problem that belongs to a whole part, not to one field." }]} />
      </Part>

      <Part heading="Select" note="The list opens under the field. Arrows, Home, End, Enter, Escape and typing the start of a name all work.">
        <div className="row">
          <Field label="A choice">
            {(tie) => <Select {...tie} value={choice} options={FRUIT} onChange={setChoice} />}
          </Field>
          <Field label="With a problem" issues={[{ where: "", message: "choose another one." }]}>
            {(tie) => <Select {...tie} value={choice} options={FRUIT} onChange={setChoice} />}
          </Field>
          <Field label="Disabled">
            {(tie) => <Select {...tie} value="b" options={FRUIT} onChange={() => {}} disabled />}
          </Field>
          <Pick label="A name that is gone" value="old_name" options={["offset", "gain"]} onChange={() => {}} />
          <Pick label="Nothing to choose" value="" options={[]} onChange={() => {}} />
        </div>
      </Part>

      <Part heading="Check box">
        <div className="row actions">
          <label className="check"><Checkbox checked={checked} onChange={() => setChecked(!checked)} />Checked or not</label>
          <label className="check"><Checkbox defaultChecked={false} />Empty</label>
          <label className="check"><Checkbox checked disabled readOnly />Disabled</label>
        </div>
        <CheckField label="elitism" hint="A setting with its help below." checked={checked} onChange={setChecked} />
      </Part>

      <Part heading="Disclosure">
        <Disclosure summary="Closed at first">
          <p>Occasional detail goes here.</p>
        </Disclosure>
        <Disclosure summary="Open" open>
          <p>The chevron turns. It sits as far from the end edge as the text sits from the start edge.</p>
        </Disclosure>
      </Part>

      <Part heading="File button" note="The file chooser itself belongs to the system. The button, the hint and the name of the chosen file are ours.">
        <div className="row">
          <FileButton label="Import a table" accept=".csv" hint="A CSV file of numbers. Its first row holds the names of the columns." onFile={(file) => setLast(file.name)} />
        </div>
        {last && <Alert kind="danger" role="alert">{last} was not imported. This is how a refused file is reported, next to the button.</Alert>}
      </Part>

      <Part heading="Dialogs">
        <div className="row actions">
          <button type="button" className="btn btn-secondary" onClick={() => setDialog(<NameDialog heading="Rename the project" label="Project name" initial="Calibration line fit" action="Rename" onDone={() => setDialog(undefined)} />)}>Ask for a name</button>
          <button type="button" className="btn btn-secondary" onClick={() => setDialog(<ConfirmDialog heading="Delete this project?" action="Delete" body="It and its results will be deleted. This cannot be undone." onDone={() => setDialog(undefined)} />)}>Ask before deleting</button>
          <button
            type="button" className="btn btn-secondary"
            onClick={() => setDialog(
              <ConfirmDialog
                heading="Remove the column weight?" action="Remove anyway" onDone={() => setDialog(undefined)}
                body="Other parts of the project use it. Nothing in them is changed, so each will show a problem until you change it. Undo brings it back."
              >
                <ul className="uses">
                  <li>The objective uses <code>weight</code>.</li>
                  <li>The constraint "Total weight" uses <code>weight</code>.</li>
                </ul>
              </ConfirmDialog>,
            )}
          >
            Ask before removing something that is used
          </button>
        </div>
      </Part>

      <Part heading="Callouts" note="A tint, a glyph and a word. The border is the same on all four sides.">
        <Alert kind="info"><strong>Info:</strong> a routine fact that helps.</Alert>
        <Alert kind="success"><strong>Done:</strong> something was checked and holds.</Alert>
        <Alert kind="warning" role="note"><strong>Note:</strong> it will work, but look at this first.</Alert>
        <Alert kind="danger"><strong>Problem:</strong> what went wrong, and what to do next.</Alert>
        <Alert kind="neutral">A reminder that is not a status.</Alert>
      </Part>

      <Part heading="Empty, loading and failed" note="Three different looks, so that an empty list is never mistaken for a failed one.">
        <p className="empty">Nothing here yet. This line says what to do next.</p>
        <Loading>Loading your projects.</Loading>
        <Alert kind="danger"><strong>Problem:</strong> the list could not be read. <button type="button" className="btn btn-secondary btn-compact">Try again</button></Alert>
      </Part>

      <Part heading="Progress and status">
        <p className="progress"><progress aria-label="Evaluations used" max={100} value={35} /><span>3,500 of 10,000 evaluations. Best objective so far: 12.4 kPa^2</span></p>
        <div className="run-status"><p>Run finished. Best feasible solution found.</p></div>
        <div className="run-status"><p>The variable offset was removed.</p><button type="button" className="btn btn-quiet btn-compact">Undo</button></div>
        <div className="run-status"><p>The last change was undone.</p><button type="button" className="btn btn-quiet btn-compact">Redo</button></div>
        <div className="run-status" data-state="error"><Icon name="circle-exclamation-point" /><p>This project cannot run yet. Add at least one variable.</p></div>
        <p className="outcome feasible"><Icon name="circle-check" />Best feasible solution found.</p>
        <p className="outcome"><Icon name="triangle-exclamation-point" />No feasible solution found.</p>
        <span className="saving" data-state="saved"><Icon name="check" />All changes saved</span>
        <span className="saving" data-state="saving"><Icon name="loader-circle" />Saving</span>
        <span className="saving" data-state="failed"><Icon name="circle-exclamation-point" />Could not save. Download the project to keep it.</span>
      </Part>

      <Part heading="Tables">
        <div className="table-box" tabIndex={0} role="group" aria-label="An example table">
          <table className="table">
            <caption>Numbers are aligned at the end and use figures of one width.</caption>
            <thead><tr><th scope="col">Constraint</th><th scope="col" className="num">Value (kg)</th><th scope="col">Limit</th><th scope="col">Holds</th></tr></thead>
            <tbody>
              <tr><th scope="row">Total weight</th><td className="num">48.2</td><td>at most 50 kg</td><td className="holds"><Icon name="check" />Yes</td></tr>
              <tr><th scope="row">Total volume</th><td className="num">1,204.75</td><td>at most 1,000 l</td><td className="broken"><Icon name="x" />No, broken</td></tr>
            </tbody>
          </table>
        </div>
        <dl className="facts">
          <dt>Objective (minimized)</dt><dd className="value">9.9738 kPa^2</dd>
          <dt>Evaluations</dt><dd>5,000 of 5,000</dd>
        </dl>
      </Part>

      <Part heading="Cards and items">
        <ul className="cards">
          <li className="card">
            <button type="button" className="card-link" aria-describedby="card-a"><span className="card-title">A card is one button</span><Icon name="chevron-right" /></button>
            <span className="card-text" id="card-a">Its description is always visible, never only in a tooltip.</span>
          </li>
          <li className="card">
            <button type="button" className="card-link" aria-describedby="card-b"><span className="card-title">A card with a problem and a very long title that is cut</span><Icon name="chevron-right" /></button>
            <span className="card-text" id="card-b">It says what to fix.</span>
            <span className="card-problem"><Icon name="circle-exclamation-point" /><span><strong>To fix:</strong> Add at least one variable.</span></span>
          </li>
        </ul>
        <fieldset className="item">
          <legend className="visually-hidden">Variable 0</legend>
          <div className="item-head">
            <span className="item-title" aria-hidden="true">Variable 0</span>
            <button type="button" className="btn btn-quiet btn-compact" aria-label="Remove variable offset"><Icon name="trash" />Remove</button>
          </div>
          <p>One item of a list that is being edited.</p>
        </fieldset>
      </Part>

      <Part heading="Sidebar navigation" note="The selected entry has a wash, accent text and more weight. Hover and focus look different from it and from each other.">
        <nav className="catalog-nav" aria-label="Example of the sidebar">
          <p className="nav-group">Problem</p>
          <ul>
            {[["overview", "Overview"], ["variables", "Variables"], ["objective", "Objective"]].map(([key, label]) => (
              <li key={key}>
                <button type="button" className="nav-item" aria-current={current === key ? "true" : undefined} onClick={() => setCurrent(key)}>
                  <span className="label">{label}</span>
                  {key === "variables" && <span className="count">2</span>}
                  {key === "objective" && <span className="mark" role="img" aria-label="has a problem"><Icon name="circle-exclamation-point" /></span>}
                </button>
              </li>
            ))}
            <li><button type="button" className="nav-item new"><Icon name="plus" />New experiment</button></li>
          </ul>
        </nav>
      </Part>

      <Part heading="Icons" note="One family, Lucide outline, drawn with the color of the text.">
        <div className="row actions">
          {ICONS.map((name) => <span key={name} className="btn btn-quiet btn-compact" data-tip={name} tabIndex={0}><Icon name={name} /></span>)}
        </div>
      </Part>
    </div>
  );
}

startTooltips();
createRoot(document.getElementById("root")!).render(<Catalog />);
