import { invoke } from "@tauri-apps/api/core";

/** Opens one of the pages Gerfaut links to in the browser, through the
    app's own command: it opens the explorer, the releases page, the
    issues page and a price source's credit page, and refuses any other
    address (src-tauri/src/links.rs). Rejects when nothing opened it. */
export function openLink(url: string): Promise<void> {
  return invoke<void>("open_link", { url });
}
