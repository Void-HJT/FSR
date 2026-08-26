!macro customHeader
  ; Let users choose a drive root such as D:\. electron-builder then appends
  ; APP_FILENAME before installation, producing D:\ISR instead of installing
  ; application files directly into the drive root.
  AllowRootDirInstall true
!macroend
