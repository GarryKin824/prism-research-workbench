@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -File "%~dp0prism-windows.ps1" -Action Install %*
if errorlevel 1 (pause & exit /b 1)
echo Installation complete. Double-click START-PRISM.cmd to open the workbench.
