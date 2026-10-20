; Quizy installer safety rules (included through "nsis.include" in package.json).
;
; Quizy 1.0 and 1.1 let people choose any install folder. electron-builder's
; uninstaller removes its install folder with everything inside it, and every
; update runs the previous version's uninstaller. If someone had installed into
; a folder that also held their own files (a project folder, Documents, the
; Desktop...), updating would delete those files.
;
; These rules make Quizy only ever install into, and remove, its own folder:
;   %LOCALAPPDATA%\Programs\Quizy

!macro quizyOwnDir OUT
  StrCpy ${OUT} "$LOCALAPPDATA\Programs\${APP_FILENAME}"
!macroend

; Quizy runs helper programs from its folder: the app server (node.exe) and
; the AI (llama-server.exe). If Quizy crashed or was closed oddly they can keep
; running and lock their files, and then the old version can't be removed
; ("Failed to uninstall old application files: 2"). Stop any program running
; from DIR except Quizy itself, which electron-builder already asks you to close.
!macro quizyStopHelpers DIR
  StrCpy $R7 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ${if} ${FileExists} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    ; 64-bit PowerShell can see the paths of 64-bit programs.
    StrCpy $R7 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${endif}
  ${if} ${FileExists} "${DIR}\*.*"
    nsExec::Exec `"$R7" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d = '${DIR}\'; Get-Process -ErrorAction SilentlyContinue | Where-Object { $$_.ProcessName -ne '${PRODUCT_FILENAME}' -and $$_.Path -and $$_.Path.StartsWith($$d, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500"`
    Pop $R6
  ${endif}
!macroend

; Runs when the installer starts, before any old version is uninstalled.
!macro customInit
  !insertmacro quizyOwnDir $R9
  ReadRegStr $R8 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $R8 != ""
  ${andIf} $R8 != $R9
    ; The previous version lives somewhere other than Quizy's own folder.
    ; Never run its uninstaller there: forget that install instead. Its files
    ; stay where they are, and the user can delete them by hand.
    DetailPrint "Previous Quizy install in $R8 is not in Quizy's own folder; leaving its files alone."
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "QuietUninstallString"
    !ifdef UNINSTALL_REGISTRY_KEY_2
      DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
      DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" "QuietUninstallString"
    !endif
    DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${endif}
  ; Always install into Quizy's own folder (also ignores a /D= switch).
  StrCpy $INSTDIR $R9
  ; Free the old version's files before it is uninstalled.
  !insertmacro quizyStopHelpers $R9
!macroend

; Runs when the uninstaller starts (also during updates).
!macro customUnInit
  !insertmacro quizyStopHelpers $INSTDIR
!macroend

; Used by the uninstaller (and by updates) instead of "RMDir /r $INSTDIR".
!macro customRemoveFiles
  !insertmacro quizyOwnDir $R9
  ${if} $INSTDIR == $R9
    RMDir /r "$INSTDIR"
  ${else}
    ; Not Quizy's own folder: remove only the files Quizy put there.
    Delete "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    Delete "$INSTDIR\${UNINSTALL_FILENAME}"
    Delete "$INSTDIR\chrome_100_percent.pak"
    Delete "$INSTDIR\chrome_200_percent.pak"
    Delete "$INSTDIR\resources.pak"
    Delete "$INSTDIR\icudtl.dat"
    Delete "$INSTDIR\snapshot_blob.bin"
    Delete "$INSTDIR\v8_context_snapshot.bin"
    Delete "$INSTDIR\d3dcompiler_47.dll"
    Delete "$INSTDIR\ffmpeg.dll"
    Delete "$INSTDIR\libEGL.dll"
    Delete "$INSTDIR\libGLESv2.dll"
    Delete "$INSTDIR\vk_swiftshader.dll"
    Delete "$INSTDIR\vk_swiftshader_icd.json"
    Delete "$INSTDIR\vulkan-1.dll"
    Delete "$INSTDIR\LICENSE.electron.txt"
    Delete "$INSTDIR\LICENSES.chromium.html"
    Delete "$INSTDIR\uninstallerIcon.ico"
    RMDir /r "$INSTDIR\locales"
    RMDir /r "$INSTDIR\resources"
    ; Removes the folder only if it is now empty.
    RMDir "$INSTDIR"
  ${endif}
!macroend
