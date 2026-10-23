@echo off
rem Fabrique « Installer Boombox iPhone.exe » avec le compilateur C# inclus dans Windows (.NET Framework 4)
cd /d "%~dp0"
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
"%CSC%" /nologo /target:winexe /optimize+ /out:"Installer Boombox iPhone.exe" /win32icon:..\..\resources\boombox.ico /win32manifest:app.manifest ^
  /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Management.dll /r:System.ServiceProcess.dll ^
  /resource:qr_start.png,qr_start.png /resource:qr_boombox.png,qr_boombox.png BoomboxIphone.cs
copy /y "Installer Boombox iPhone.exe" "dist\Installer-Boombox-iPhone.exe" >nul
