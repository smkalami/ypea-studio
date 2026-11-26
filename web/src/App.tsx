// The start of the app: the list of the user's projects with the welcome actions. An open
// project is a workspace (Workspace.tsx). The page title, the description and the Python link
// are static HTML in index.html.

import { useEffect, useState } from "react";
import type { Project } from "../../engine/project.ts";
import { blankProject, experimentsOf, tidy } from "./draft.ts";
import { EXAMPLES } from "./examples.ts";
import { FileButton } from "./fields.tsx";
import { bundleProjects, deleteProject, listProjects, projectsFromFile, saveProject, type StoredProject } from "./storage.ts";
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
  if (open) return <Workspace key={open.id} record={open} onBack={() => (setOpenId(undefined), void act())} />;

  const add = (project: Project) => act(async () => setOpenId((await saveProject(project)).id));
  const openFile = (file: File) =>
    act(async () => {
      const saved: StoredProject[] = [];
      for (const project of projectsFromFile(await file.text())) saved.push(await saveProject(project));
      // a file of all projects stays on the list, and a single project opens
      if (saved.length === 1) setOpenId(saved[0].id);
    });
  const rename = (p: StoredProject, old: string) => {
    const name = window.prompt("New name for the project", old)?.trim();
    if (name) act(() => saveProject({ ...p.project, name }, p.id));
  };
  const remove = (p: StoredProject, name: string) => {
    if (window.confirm(`Delete "${name}" and its results? This cannot be undone.`)) act(() => deleteProject(p.id));
  };
  const blank = <button onClick={() => add(blankProject())}>New blank project</button>;

  return (
    <>
      {notice && <p className="notice" role="alert">{notice}</p>}
      {!projects && !notice && <p>Loading your projects.</p>}

      {projects && projects.length > 0 && (
        <section aria-labelledby="projects-heading">
          <h2 id="projects-heading">Your projects</h2>
          <table className="projects">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Experiments</th>
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
                    <td>{experimentsOf(shown).length}</td>
                    <td>{new Date(p.updated).toLocaleString()}</td>
                    <td className="actions">
                      <button className="primary" aria-label={`Open ${name}`} onClick={() => setOpenId(p.id)}>Open</button>
                      <button aria-label={`Rename ${name}`} onClick={() => rename(p, name)}>Rename</button>
                      <button aria-label={`Duplicate ${name}`} onClick={() => act(() => saveProject({ ...p.project, name: `${name} copy` }))}>Duplicate</button>
                      <button aria-label={`Download ${name}`} onClick={() => download(name, p.project)}>Download</button>
                      <button aria-label={`Delete ${name}`} onClick={() => remove(p, name)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p>{blank}</p>
        </section>
      )}

      <section aria-labelledby="examples-heading">
        <h2 id="examples-heading">Try an example</h2>
        <p>
          Each example becomes a project of your own.
        </p>
        <ul className="examples">
          {EXAMPLES.map((example) => (
            <li key={example.name}>
              <button onClick={() => add(example)}>{example.name}</button>
              <span>{example.description}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="own-heading">
        <h2 id="own-heading">Start your own</h2>
        <p>Begin with a blank project, or load a project file (JSON) from this computer.</p>
        <p className="row">
          {projects?.length === 0 && blank}
          <FileButton id="project-file" accept=".json,application/json" label="Open a project" onFile={openFile} />
        </p>
      </section>

      <aside className="reminder" aria-label="Where your projects are kept">
        <p>
          Your projects are kept in this browser, on this computer, and nowhere else. Clearing the browser's data
          deletes them. Download a copy to keep them safe.
        </p>
        {projects && projects.length > 0 && (
          <button onClick={() => download("ypea-studio-projects", bundleProjects(projects.map((p) => p.project)))}>
            Download all projects
          </button>
        )}
      </aside>
    </>
  );
}
