; Updates without questions or errors: a running DHDMail (installed or portable, also the older
; DHMail) is closed first, so the installer can replace its files. Your mail, settings and PIN live in
; %APPDATA%\DHDMail; on first start the app moves them there from the old %APPDATA%\DHMail.
!macro customCheckAppRunning
  DetailPrint "Closing DHDMail before the update..."
  ; ask nicely first (the app saves and closes), then make sure it is gone
  nsExec::Exec 'taskkill /IM "DHDMail.exe" /T'
  nsExec::Exec 'taskkill /IM "DHMail.exe" /T'
  Sleep 2000
  nsExec::Exec 'taskkill /F /IM "DHDMail.exe" /T'
  nsExec::Exec 'taskkill /F /IM "DHMail.exe" /T'
  Sleep 800
!macroend

; the app was called DHMail before: remove its old shortcuts, the new ones are called DHDMail
!macro customInstall
  Delete "$DESKTOP\DHMail.lnk"
  Delete "$SMPROGRAMS\DHMail.lnk"
!macroend
