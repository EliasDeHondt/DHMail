; Updates without questions or errors: a running DHMail (installed or portable) is closed first, so the
; installer can replace its files. Your mail, settings and PIN live in %APPDATA%\DHMail and stay untouched.
!macro customCheckAppRunning
  DetailPrint "DHMail wordt afgesloten voor de update..."
  ; ask nicely first (the app saves and closes), then make sure it is gone
  nsExec::Exec 'taskkill /IM "DHMail.exe" /T'
  Sleep 2000
  nsExec::Exec 'taskkill /F /IM "DHMail.exe" /T'
  Sleep 800
!macroend
