; ===========================================================================
;  Cafe POS Print Bridge - all-in-one installer
;  Builds ONE file (CafePOS-Printer-Setup.exe) that a customer downloads and
;  double-clicks. It:
;    1. installs the AN581 receipt-printer driver (BeeprtEx)   [optional task]
;    2. copies the print bridge (node runtime + server.mjs + nssm)
;    3. registers + starts the CafePosBridge Windows service (auto-start)
;
;  Build:  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
;  Output: ..\dist\CafePOS-Printer-Setup.exe
;
;  Payload sources (absolute - this is OUR build machine):
;    - driver : d:\POS-dev\BeeprtEx_Printer_Driver_3.3.6.583.exe
;    - node   : C:\ProgramData\cafe-pos-bridge\bridge.exe   (renamed node.exe)
;    - server : d:\POS-dev\bridge\server.mjs                (source of truth)
;    - nssm   : C:\ProgramData\cafe-pos-bridge\nssm.exe
; ===========================================================================

#define AppName       "Cafe POS Print Bridge"
#define AppVersion    "1.0"
#define AppPublisher  "Kael-Dean"
#define WebUrl        "https://cafe-pos-sable.vercel.app"
#define SvcName       "CafePosBridge"

#define DriverExe  "d:\POS-dev\BeeprtEx_Printer_Driver_3.3.6.583.exe"
#define BridgeExe  "C:\ProgramData\cafe-pos-bridge\bridge.exe"
#define ServerMjs  "d:\POS-dev\bridge\server.mjs"
#define NssmExe    "C:\ProgramData\cafe-pos-bridge\nssm.exe"

[Setup]
AppId={{8F3B2A14-7C5D-4E96-9A11-CAFEPOSBRIDGE01}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={commonappdata}\cafe-pos-bridge
DisableDirPage=yes
DisableProgramGroupPage=yes
UsePreviousAppDir=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#SourcePath}\..\dist
OutputBaseFilename=CafePOS-Printer-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
ShowLanguageDialog=no

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[Messages]
; --- Thai overrides for the visible wizard chrome ---
WelcomeLabel1=ติดตั้งระบบพิมพ์ใบเสร็จ Cafe POS
WelcomeLabel2=โปรแกรมนี้จะติดตั้ง "ตัวเชื่อมเครื่องพิมพ์ (Print Bridge)" และไดรเวอร์เครื่องพิมพ์ลงในคอมเครื่องนี้ เพื่อให้สั่งพิมพ์ใบเสร็จจากหน้าเว็บได้%n%nต่อสาย USB เครื่องพิมพ์เข้ากับคอมและเปิดเครื่องพิมพ์ก่อน แล้วกด ถัดไป (Next)
FinishedHeadingLabel=ติดตั้งเสร็จเรียบร้อย
FinishedLabel=ระบบพิมพ์พร้อมใช้งานแล้ว เปิดหน้าเว็บ POS แล้วลองสั่งพิมพ์ใบเสร็จได้เลย%n%nถ้าเว็บแจ้งว่าหาเครื่องพิมพ์ไม่เจอ ให้ไปที่หน้า "ฮาร์ดแวร์" ในเว็บ แล้วเลือกชื่อเครื่องพิมพ์ของเครื่องนี้
ExitSetupTitle=ออกจากการติดตั้ง
ExitSetupMessage=การติดตั้งยังไม่เสร็จ ถ้าออกตอนนี้ระบบพิมพ์จะยังใช้ไม่ได้%n%nต้องการออกจริงหรือไม่?

[Tasks]
Name: "installdriver"; Description: "ติดตั้งไดรเวอร์เครื่องพิมพ์ AN581 (ข้ามได้ถ้าเครื่องนี้เคยลงไดรเวอร์แล้ว)"; GroupDescription: "ส่วนประกอบที่จะติดตั้ง:"

[Files]
; driver -> temp, run during install, then delete (only if task chosen)
Source: "{#DriverExe}"; DestDir: "{tmp}"; DestName: "printer-driver.exe"; Flags: deleteafterinstall; Tasks: installdriver
; bridge runtime + service files -> install dir
Source: "{#BridgeExe}"; DestDir: "{app}"; DestName: "bridge.exe"; Flags: ignoreversion
Source: "{#ServerMjs}"; DestDir: "{app}"; DestName: "server.mjs"; Flags: ignoreversion
Source: "{#NssmExe}";   DestDir: "{app}"; DestName: "nssm.exe";   Flags: ignoreversion
Source: "bridge-service.bat"; DestDir: "{app}"; Flags: ignoreversion
; default config - drop ONLY on first install, never clobber an existing one
Source: "printer-config.default.json"; DestDir: "{app}"; DestName: "printer-config.json"; Flags: onlyifdoesntexist

[Run]
; 1) driver wizard (shows once; runs elevated already so no extra UAC)
Filename: "{tmp}\printer-driver.exe"; StatusMsg: "กำลังติดตั้งไดรเวอร์เครื่องพิมพ์ — ทำตามหน้าต่างไดรเวอร์จนจบ (Next / Finish)..."; Tasks: installdriver; Flags: waituntilterminated
; 2) register + start the print-bridge service (hidden)
Filename: "{cmd}"; Parameters: "/C ""{app}\bridge-service.bat"""; StatusMsg: "กำลังติดตั้งบริการพิมพ์ (Print Bridge)..."; Flags: runhidden waituntilterminated
; 3) offer to open the web app
Filename: "{#WebUrl}"; Description: "เปิดหน้าเว็บ POS"; Flags: postinstall shellexec nowait skipifsilent

[UninstallRun]
Filename: "{app}\nssm.exe"; Parameters: "stop {#SvcName}";         Flags: runhidden; RunOnceId: "StopBridgeSvc"
Filename: "{app}\nssm.exe"; Parameters: "remove {#SvcName} confirm"; Flags: runhidden; RunOnceId: "RemoveBridgeSvc"

[UninstallDelete]
Type: files; Name: "{app}\bridge.log"
