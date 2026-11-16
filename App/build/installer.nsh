; Updates without questions or errors: a running DHMail (installed or portable) is closed first, so the
; installer can replace its files. Your mail, settings and PIN live in %APPDATA%\DHMail and stay untouched.
!macro customCheckAppRunning
  DetailPrint "Closing DHMail before the update..."
  ; ask nicely first (the app saves and closes), then make sure it is gone; DHDMail.exe was a short-lived 1.29.0 test name
  nsExec::Exec 'taskkill /IM "DHMail.exe" /T'
  nsExec::Exec 'taskkill /IM "DHDMail.exe" /T'
  Sleep 2000
  nsExec::Exec 'taskkill /F /IM "DHMail.exe" /T'
  nsExec::Exec 'taskkill /F /IM "DHDMail.exe" /T'
  Sleep 800
!macroend

; 1.29.0 was briefly built as "DHDMail": remove its shortcuts if that build was ever installed
!macro customInstall
  Delete "$DESKTOP\DHDMail.lnk"
  Delete "$SMPROGRAMS\DHDMail.lnk"
!macroend