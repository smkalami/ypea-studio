// The start of the app: the list of the user's projects with the welcome actions. An open
// project is a workspace (Workspace.tsx). The page title, the description and the Python link
// are static HTML in index.html.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Project } from "../../engine/project.ts";
import { blankProject, experimentsOf, tidy } from "./draft.ts";
import { EXAMPLES } from "./examples.ts";
import { bundleProjects, deleteProject, listProjects, projectsFromFile, saveProject, type StoredProject } from "./storage.ts";
import { Alert, IconButton, Loading, ThemeSwitch } from "./ui/controls.tsx";
import { ConfirmDialog, NameDialog } from "./ui/Dialog.tsx";
import { FileButton } from "./ui/fields.tsx";
import { Icon } from "./ui/Icon.tsx";
import { download, Workspace } from "./Workspace.tsx";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Asks the browser once to keep the data from automatic clearing. It waits for
// the first project, because some browsers ask the user and a new visitor has nothing to keep.
let askedToKeep = false;
function keepData(): void {
  if (askedToKeep) return;
  askedToKeep = true;
  navigator.storage?.persist?.().catch(() => {});
}

export function App() {
  const [projects, setProjects] = useState<StoredProject[]>();
  const [openId, setOpenId] = useState<string>();
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<ReactNode>();

  /** Does one storage action, then reads the list again. A failure becomes a notice. */
  const act = async (work?: () => Promise<unknown>) => {
    setNotice("");
    try {
      await work?.();
      setProjects(await listProjects());
    } catch (error) {
      setNotice(messageOf(error));
    }
  };
  useEffect(() => void act(), []);
  useEffect(() => {
    if (projects?.length) keepData();
  }, [projects]);

  const open = projects?.find((p) => p.id === openId);
  // the long description gives its room to the workspace while a project is open
  useEffect(() => void document.body.classList.toggle("in-project", open !== undefined), [open !== undefined]);

  const add = (project: Project) => act(async () => setOpenId((await saveProject(project)).id));
  const openFile = (file: File) =>
    act(async () => {
      const saved: StoredProject[] = [];
      for (const project of projectsFromFile(await file.text())) saved.push(await saveProject(project));
      // a file of all projects stays on the list, and a single project opens
      if (saved.length === 1) setOpenId(saved[0].id);
    });
  const rename = (p: StoredProject, old: string) =>
    setDialog(
      <NameDialog
        heading="Rename the project" label="Project name" initial={old} action="Rename"
        onDone={(name) => {
          setDialog(undefined);
          if (name) void act(() => saveProject({ ...p.project, name }, p.id));
        }}
      />,
    );
  const remove = (p: StoredProject, name: string) =>
    setDialog(
      <ConfirmDialog
        heading="Delete this project?" action="Delete" body={<>"{name}" and its results will be deleted. This cannot be undone.</>}
        onDone={async (confirmed) => {
          setDialog(undefined);
          if (!confirmed) return;
          await act(() => deleteProject(p.id));
          document.getElementById("root")?.focus(); // the button that had the focus is gone with its row
        }}
      />,
    );
  const has = projects !== undefined && projects.length > 0;

  return (
    <>
      {createPortal(<ThemeSwitch />, document.getElementById("bar-tools")!)}
      {dialog}
      {open ? <Workspace key={open.id} record={open} onBack={() => (setOpenId(undefined), void act())} /> : (
        <div className="page">
          {notice && <Alert kind="danger" role="alert">{notice}</Alert>}
          {!projects && !notice && <Loading>Loading your projects.</Loading>}
          {!projects && notice && <p><button type="button" className="btn btn-secondary" onClick={() => void act()}>Try again</button></p>}

          {has && (
            <section aria-labelledby="projects-heading">
              <div className="section-head">
                <h2 id="projects-heading">Your projects</h2>
                <button type="button" className="btn btn-primary" onClick={() => add(blankProject())}><Icon name="plus" />New blank project</button>
              </div>
              <table className="table projects">
                <thead>
                  <tr>
                    <th scope="col">Project</th>
                    <th scope="col" className="num">Experiments</th>
                    <th scope="col">Last changed</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => {
                    // a stored project may be unfinished, so it is read with care
                    const shown = tidy(p.project), name = shown.name;
                    return (
                      <tr key={p.id}>
                        <th scope="row">{name}</th>
                        <td className="num" data-label="Experiments">{experimentsOf(shown).length}</td>
                        <td data-label="Last changed">{new Date(p.updated).toLocaleString()}</td>
                        <td className="actions">
                          <button type="button" className="btn btn-secondary btn-compact" aria-label={`Open ${name}`} onClick={() => setOpenId(p.id)}>Open</button>
                          <IconButton icon="pencil" label={`Rename ${name}`} tip="Rename" onClick={() => rename(p, name)} />
                          <IconButton icon="copy" label={`Duplicate ${name}`} tip="Duplicate" onClick={() => void act(() => saveProject({ ...p.project, name: `${name} copy` }))} />
                          <IconButton icon="download" label={`Download ${name}`} tip="Download" onClick={() => download(name, p.project)} />
                          <IconButton icon="trash" label={`Delete ${name}`} tip="Delete" onClick={() => remove(p, name)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          <section aria-labelledby="examples-heading">
            <h2 id="examples-heading">Try an example</h2>
            <p>Each example becomes a project of your own. Open one and press Run.</p>
            <ul className="cards">
              {EXAMPLES.map((example, n) => (
                <li key={example.name} className="card">
                  <button type="button" className="card-link" aria-describedby={`example-${n}-text`} onClick={() => add(example)}>
                    <span className="card-title">{example.name}</span>
                    <Icon name="chevron-right" />
                  </button>
                  <span className="card-text" id={`example-${n}-text`}>{example.description}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="own-heading">
            <h2 id="own-heading">{has ? "Open a project file" : "Start your own"}</h2>
            <p>{has ? "Load a project file from this computer." : "Begin with a blank project, or load a project file from this computer."}</p>
            <div className="row">
              {projects?.length === 0 && <button type="button" className="btn btn-secondary" onClick={() => add(blankProject())}><Icon name="plus" />New blank project</button>}
              <FileButton id="project-file" accept=".json,application/json" label="Open a project" hint="A JSON file that was downloaded from YPEA Studio." onFile={openFile} />
            </div>
          </section>

          <aside aria-label="Where your projects are kept">
            <Alert kind="neutral">
              <p>
                Your projects are kept in this browser, on this computer, and nowhere else. Clearing the data of the browser
                deletes them. Download a copy to keep them safe.
              </p>
              {has && (
                <button type="button" className="btn btn-secondary btn-compact" onClick={() => download("ypea-studio-projects", bundleProjects(projects.map((p) => p.project)))}>
                  <Icon name="download" />Download all projects
                </button>
              )}
            </Alert>
          </aside>
        </div>
      )}
    </>
  );
}
