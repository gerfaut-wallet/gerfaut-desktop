// The system's say on notifications, behind one object so a test can
// stand in for it.
//
// Nothing is posted from here. What Gerfaut says about a transaction is
// composed and posted by the Rust side, which is still awake when the
// window is minimised or locked; this side only asks the system whether
// it may, when the setting is turned on.

import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";

export const notifier = {
  isPermissionGranted,
  requestPermission,
};
