!macro customHeader
  ; Let users choose a drive root such as D:\.
  AllowRootDirInstall true
!macroend

!ifndef BUILD_UNINSTALLER
!include MUI2.nsh
!include nsDialogs.nsh
!insertmacro MUI_DIRECTORYPAGE_INTERFACE

Function normalizeRootInstallDir
  StrLen $R0 $INSTDIR
  StrCmp $R0 2 normalizeRootInstallDirWithoutSlash
  StrCmp $R0 3 0 normalizeRootInstallDirDone
  StrCpy $R1 $INSTDIR 1 1
  StrCmp $R1 ":" 0 normalizeRootInstallDirDone
  StrCpy $R2 $INSTDIR 1 2
  StrCmp $R2 "\" 0 normalizeRootInstallDirDone
  StrCpy $INSTDIR "$INSTDIR${APP_FILENAME}"
  Goto normalizeRootInstallDirDone

  normalizeRootInstallDirWithoutSlash:
  StrCpy $R1 $INSTDIR 1 1
  StrCmp $R1 ":" 0 normalizeRootInstallDirDone
  StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"

  normalizeRootInstallDirDone:
FunctionEnd

Function normalizeDirectoryPage
  GetFunctionAddress $R0 normalizeInstallDirTimer
  nsDialogs::CreateTimer $R0 100
  Call normalizeInstallDirTimer
FunctionEnd

Function stopNormalizeDirectoryPage
  GetFunctionAddress $R0 normalizeInstallDirTimer
  nsDialogs::KillTimer $R0
FunctionEnd

Function normalizeInstallDirTimer
  ${NSD_GetText} $mui.DirectoryPage.Directory $R9
  StrCpy $INSTDIR $R9
  Call normalizeRootInstallDir
  StrCmp $R9 $INSTDIR normalizeInstallDirTimerDone
  ${NSD_SetText} $mui.DirectoryPage.Directory $INSTDIR

  normalizeInstallDirTimerDone:
FunctionEnd

!macro customInit
  ; Keep the first directory-page value consistent with the real destination.
  Call normalizeRootInstallDir
!macroend
!endif
