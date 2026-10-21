; Quizy installer safety rules (included through "nsis.include" in package.json).
;
; Quizy 1.0 and 1.1 let people choose any install folder. electron-builder's
; uninstaller removes its install folder with everything inside it, and every
; update runs the previous version's uninstaller. If someone had installed into
; a folder that also held their own files (a project folder, Documents, the
; Desktop...), updating would delete those files.
;
; The rules:
;   - You can choose where to install, but Quizy always gets a folder of its
;     own: picking D:\Apps installs into D:\Apps\Quizy.
;   - Outside the default folder (%LOCALAPPDATA%\Programs\Quizy) uninstalling
;     and updating only remove the files Quizy put there, never the folder's
;     other contents.
;   - An install made by Quizy 1.0/1.1 outside the default folder is never
;     uninstalled automatically (its uninstaller would remove the whole folder).

; ${if} and friends (also needed by the page function below, which is
; compiled where this file is included).
!include LogicLib.nsh

!macro quizyOwnDir OUT
  StrCpy ${OUT} "$LOCALAPPDATA\Programs\${APP_FILENAME}"
!macroend

; Quizy runs helper programs from its folder: the app server (node.exe), and in
; older versions the AI (llama-server.exe). If Quizy crashed or was closed oddly they can keep
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

; Give Quizy a folder of its own: "D:\Apps" becomes "D:\Apps\Quizy".
!macro quizyFixDir
  ; drop a trailing backslash ("D:\")
  StrCpy $R5 $INSTDIR 1 -1
  ${if} $R5 == "\"
    StrCpy $INSTDIR $INSTDIR -1
  ${endif}
  StrLen $R4 "${APP_FILENAME}"
  IntOp $R4 $R4 + 1
  StrCpy $R5 $INSTDIR "" -$R4
  ${if} $R5 != "\${APP_FILENAME}"
    StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
  ${endif}
!macroend

; Runs when the installer starts, before any old version is uninstalled.
!macro customInit
  !insertmacro quizyOwnDir $R9
  ReadRegStr $R8 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R3 HKCU "${INSTALL_REGISTRY_KEY}" QuizySafeUninstall
  ${if} $R8 != ""
  ${andIf} $R8 != $R9
  ${andIf} $R3 != "1"
    ; Made by Quizy 1.0/1.1 somewhere other than Quizy's own folder. Never run
    ; its uninstaller there: forget that install instead. Its files stay where
    ; they are, and the user can delete them by hand.
    DetailPrint "Previous Quizy install in $R8 was made by an old version; leaving its files alone."
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "QuietUninstallString"
    !ifdef UNINSTALL_REGISTRY_KEY_2
      DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
      DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" "QuietUninstallString"
    !endif
    DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${if} $INSTDIR == $R8
      StrCpy $INSTDIR $R9
    ${endif}
  ${endif}
  ${if} $INSTDIR == ""
    StrCpy $INSTDIR $R9
  ${endif}
  !insertmacro quizyFixDir
  ; Free the old version's files before it is uninstalled.
  ${if} $R8 != ""
    !insertmacro quizyStopHelpers $R8
  ${endif}
  !insertmacro quizyStopHelpers $INSTDIR
!macroend

; After the folder page: make sure the chosen folder is Quizy's own.
!macro customPageAfterChangeDir
  Page custom quizyAfterDirPage
!macroend
!ifndef BUILD_UNINSTALLER
Function quizyAfterDirPage
  !insertmacro quizyFixDir
  Abort ; nothing to show, just skip this page
FunctionEnd
!endif

; After installing: mark this install as one whose uninstaller is safe anywhere.
!macro customInstall
  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" QuizySafeUninstall "1"
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
