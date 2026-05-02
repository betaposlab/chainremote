; ChainRemote installer (ASCII source - Korean text via LangString below)
; Build: makensis installer.nsi -> ChainRemote_Setup.exe

Unicode true
SetCompressor zlib

!define APP_NAME       "ChainRemote"
!define APP_VERSION    "1.0.0"
!define APP_PUBLISHER  "BetaposLab"
!define INNER_INSTALLER "rustdesk-1.4.6-x86_64.exe"

Name "${APP_NAME}"
OutFile "ChainRemote_Setup.exe"
InstallDir "$PROGRAMFILES64\${APP_NAME}"
RequestExecutionLevel admin

VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName"     "${APP_NAME}"
VIAddVersionKey "FileVersion"     "${APP_VERSION}"
VIAddVersionKey "ProductVersion"  "${APP_VERSION}"
VIAddVersionKey "CompanyName"     "${APP_PUBLISHER}"
VIAddVersionKey "FileDescription" "ChainRemote remote support setup"
VIAddVersionKey "LegalCopyright"  "${APP_PUBLISHER}"

!include "MUI2.nsh"

!define MUI_ABORTWARNING
!define MUI_ICON   "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

!define MUI_WELCOMEPAGE_TITLE          "$(WelcomeTitle)"
!define MUI_WELCOMEPAGE_TEXT           "$(WelcomeText)"
!define MUI_FINISHPAGE_TITLE           "$(FinishTitle)"
!define MUI_FINISHPAGE_TEXT            "$(FinishText)"
!define MUI_FINISHPAGE_RUN             "$INSTDIR\ChainRemote.exe"
!define MUI_FINISHPAGE_RUN_TEXT        "$(RunText)"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Korean"
!insertmacro MUI_LANGUAGE "English"

LangString WelcomeTitle ${LANG_KOREAN} "ChainRemote Setup"
LangString WelcomeText  ${LANG_KOREAN} "ChainRemote will be installed with auto-configured remote support environment.$\r$\n$\r$\nClick Next to continue."
LangString FinishTitle  ${LANG_KOREAN} "Installation Complete"
LangString FinishText   ${LANG_KOREAN} "Installation finished. Please tell BetaposLab the ID shown in ChainRemote so they can register your machine."
LangString RunText      ${LANG_KOREAN} "Run ChainRemote now"

LangString WelcomeTitle ${LANG_ENGLISH} "ChainRemote Setup"
LangString WelcomeText  ${LANG_ENGLISH} "This wizard installs ChainRemote and pre-configures the remote support server.$\r$\n$\r$\nClick Next to continue."
LangString FinishTitle  ${LANG_ENGLISH} "Setup Complete"
LangString FinishText   ${LANG_ENGLISH} "ChainRemote installation finished."
LangString RunText      ${LANG_ENGLISH} "Run ChainRemote now"

Section "Core" SecCore
  SetOutPath "$INSTDIR"

  SetOutPath "$PLUGINSDIR"
  File "${INNER_INSTALLER}"

  DetailPrint "Installing RustDesk core (silent)..."
  ExecWait '"$PLUGINSDIR\${INNER_INSTALLER}" --silent-install' $0
  DetailPrint "Core install exit code: $0"

  SetOutPath "$INSTDIR"
  CopyFiles /SILENT "$PROGRAMFILES64\RustDesk\rustdesk.exe" "$INSTDIR\ChainRemote.exe"

  CreateDirectory "$APPDATA\RustDesk\config"
  SetOutPath "$APPDATA\RustDesk\config"
  File "RustDesk2.toml"

  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\ChainRemote.exe"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\Uninstall.lnk"  "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk"               "$INSTDIR\ChainRemote.exe"

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_NAME}" '"$INSTDIR\ChainRemote.exe" --tray'

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayName"     "${APP_NAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "Publisher"       "${APP_PUBLISHER}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayIcon"     "$INSTDIR\ChainRemote.exe"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "NoRepair" 1

  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_NAME}"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
  Delete "$INSTDIR\ChainRemote.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
