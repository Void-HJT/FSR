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
  ${NSD_OnChange} $mui.DirectoryPage.Directory normalizeInstallDirChange
  Call normalizeInstallDirChange
FunctionEnd

Function normalizeInstallDirChange
  ${NSD_GetText} $mui.DirectoryPage.Directory $R9
  StrCpy $INSTDIR $R9
  Call normalizeRootInstallDir
  StrCmp $R9 $INSTDIR normalizeInstallDirChangeDone
  ${NSD_SetText} $mui.DirectoryPage.Directory $INSTDIR

  normalizeInstallDirChangeDone:
FunctionEnd

Function .onVerifyInstDir
  StrCpy $R9 $INSTDIR
  Call normalizeRootInstallDir
  StrCmp $R9 $INSTDIR verifyInstallDirDone
  ${NSD_SetText} $mui.DirectoryPage.Directory $INSTDIR

  verifyInstallDirDone:
FunctionEnd

!macro customInit
  ; Keep the first directory-page value consistent with the real destination.
  Call normalizeRootInstallDir
!macroend
!endif
