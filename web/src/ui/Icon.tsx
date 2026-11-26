// The one icon wrapper. Every icon is a Lucide outline file in ../icons, kept as downloaded
// and drawn with the color of the text around it.

const files = import.meta.glob<string>("../icons/*.svg", { query: "?raw", import: "default", eager: true });
/** The drawing inside each file, by the name of the file. */
const BODY: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, svg]) => [path.slice(path.lastIndexOf("/") + 1, -4), svg.replace(/^[\s\S]*?<svg[^>]*>|<\/svg>\s*$/g, "")]),
);

export type IconName =
  | "check" | "chevron-down" | "chevron-left" | "chevron-right" | "circle-check" | "circle-exclamation-point" | "copy"
  | "download" | "info" | "loader-circle" | "menu" | "monitor" | "moon" | "pencil" | "play" | "plus" | "square" | "sun" | "trash"
  | "triangle-exclamation-point" | "upload" | "x";

/** A decorative icon. The control it sits in carries the name. */
export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: BODY[name] ?? "" }}
    />
  );
}
