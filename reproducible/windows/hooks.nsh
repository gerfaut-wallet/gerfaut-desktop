; Included by Tauri's installer template when the reproducible build
; bundles the Windows installer (reproducible/targets/windows.sh).
;
; By default makensis stores the modification time of every file it
; packs, and Tauri's bundler rewrites the application binary just before
; it calls makensis, so that time would be the wall clock of the build.
; With SetDateSave off no file time enters the installer, and an
; installed file is dated from the moment it was installed.
;
; The template expands this macro at the top of its Install section,
; ahead of every File instruction, and SetDateSave holds from there to
; the end of the script.

!macro NSIS_HOOK_PREINSTALL
  SetDateSave off
!macroend
