@echo off
rem Opens the RoboGolfPro Repair POS in its own app window (no tabs / address bar).
rem Uses Microsoft Edge, which is installed on every Windows 10/11 PC.
rem Always launch through this file so tickets and catalog stay in the same browser storage.
set "APP=%~dp0app\index.html"
start "" msedge --app="file:///%APP:\=/%"
