@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Git account switcher

rem ==========================================================================
rem  EDIT YOUR ACCOUNTS HERE  (add more by copying a block and bumping COUNT)
rem  USER  = GitHub username (what you sign in to github.com with)
rem  NAME  = name shown on your commits
rem  CF_ACCOUNT = Cloudflare account ID to be logged in to for "npm run deploy"
rem          (leave blank to skip the Cloudflare check for that profile)
rem  EMAIL = email on your commits. Tip: for public repos use your GitHub
rem          "noreply" address (GitHub > Settings > Emails) to keep it private.
rem ==========================================================================
set "P1_LABEL=Personal"
set "P1_USER=pollo-loco-nz"
set "P1_NAME=pollo-loco-nz"
set "P1_EMAIL=mcclintock@gmail.com"
rem Cloudflare account this profile deploys to (blank = don't check Cloudflare)
set "P1_CF_ACCOUNT=c22328e02814d4b4d4cdd033bb890569"

set "P2_LABEL=Work"
set "P2_USER=nathan-mcclintock"
set "P2_NAME=nathan-mcclintock"
set "P2_EMAIL=nathan.mcclintock@codeblue.co.nz"
set "P2_CF_ACCOUNT="

set "COUNT=2"
rem ==========================================================================

rem ---- Check Git is installed ----------------------------------------------
where git >nul 2>&1
if errorlevel 1 (
  echo Git isn't installed or isn't on PATH. Install it from git-scm.com first.
  goto :done
)

rem ---- Work out which repo -------------------------------------------------
rem  1) a folder passed on the command line, 2) the current folder if it's a
rem  repo, 3) otherwise pick from the repos next to this .bat file.
set "REPO="
if not "%~1"=="" (
  if exist "%~1\.git" set "REPO=%~f1"
)
if not defined REPO (
  for /f "delims=" %%T in ('git rev-parse --show-toplevel 2^>nul') do set "REPO=%%T"
)
if defined REPO goto :haveRepo

echo.
echo  Which project?
echo  --------------
set /a N=0
for /d %%D in ("%~dp0*") do (
  if exist "%%D\.git" (
    set /a N+=1
    set "R!N!=%%~fD"
    echo   !N!. %%~nxD
  )
)
echo   G. None - set my default for ALL projects on this PC
echo.
if !N! EQU 0 echo  (No Git projects found next to this file.)
set "PICK="
set /p "PICK= Choose a number (or G): "
if /i "!PICK!"=="G" (
  set "REPO=GLOBAL"
  goto :haveRepo
)
if not defined PICK goto :done
if not defined R%PICK% (
  echo  That's not one of the options.
  goto :done
)
set "REPO=!R%PICK%!"

:haveRepo
echo.
if "%REPO%"=="GLOBAL" (
  echo  Changing your default for all projects on this PC.
  set "SCOPE=--global"
  set "GIT=git"
) else (
  echo  Project: %REPO%
  set "SCOPE=--local"
  set "GIT=git -C "%REPO%""
)

rem ---- Show the current setup ----------------------------------------------
call :showCurrent

rem ---- Pick an account ------------------------------------------------------
echo.
echo  Switch to which account?
echo  ------------------------
for /l %%I in (1,1,%COUNT%) do (
  echo   %%I. !P%%I_LABEL!  -  !P%%I_USER!  ^<!P%%I_EMAIL!^>
)
echo.
set "ACC="
set /p "ACC= Choose a number (Enter to cancel): "
if not defined ACC goto :done
if not defined P%ACC%_USER (
  echo  That's not one of the options.
  goto :done
)
set "U=!P%ACC%_USER!"
set "NM=!P%ACC%_NAME!"
set "EM=!P%ACC%_EMAIL!"

rem ---- Apply ----------------------------------------------------------------
%GIT% config %SCOPE% user.name "!NM!"
%GIT% config %SCOPE% user.email "!EM!"
rem Tells Git Credential Manager which saved GitHub login to use.
%GIT% config %SCOPE% credential.https://github.com.username "!U!"

if not "%REPO%"=="GLOBAL" call :fixRemote

echo.
echo  Done - now using !P%ACC%_LABEL! (!U!).
call :showCurrent

rem ---- Cloudflare (Wrangler) login ------------------------------------------
call :checkCloudflare

rem ---- Optional test ---------------------------------------------------------
if "%REPO%"=="GLOBAL" goto :done
echo.
set "TEST="
set /p "TEST= Test it with a push dry run (signs in, sends nothing)? [y/N]: "
if /i "!TEST!"=="y" (
  echo.
  %GIT% push --dry-run
  if errorlevel 1 (
    echo.
    echo  The dry run failed. A 403 usually means the wrong GitHub login was used:
    echo  open Credential Manager ^> Windows Credentials, remove entries starting
    echo  with git:https://github.com, then run this again and push.
  ) else (
    echo.
    echo  Looks good - a real "git push" will go to the place shown above.
  )
)
goto :done


rem ==========================================================================
:checkCloudflare
rem Wrangler keeps ONE Cloudflare login for your whole Windows user, so make
rem sure it's the account this profile deploys to.
set "CF=!P%ACC%_CF_ACCOUNT!"
if not defined CF goto :eof
where npx >nul 2>&1
if errorlevel 1 (
  echo.
  echo  ^(Node.js isn't installed, so skipped the Cloudflare check.^)
  goto :eof
)
echo.
echo  Checking your Cloudflare login (used by npm run deploy)...
if "%REPO%"=="GLOBAL" (pushd "%~dp0") else (pushd "%REPO%")
set "WHO=%TEMP%\git-switch-whoami.txt"
call npx --yes wrangler whoami > "!WHO!" 2>&1
findstr /i /c:"!CF!" "!WHO!" >nul
if not errorlevel 1 (
  echo  Cloudflare: logged in to the right account.
  for /f "tokens=*" %%L in ('findstr /i /c:"associated with the email" "!WHO!"') do echo    %%L
  popd
  goto :eof
)
echo  Cloudflare: NOT logged in to the !P%ACC%_LABEL! account.
for /f "tokens=*" %%L in ('findstr /i /c:"associated with the email" "!WHO!"') do echo    Currently: %%L
set "CFL="
set /p "CFL= Log out and sign in to Cloudflare as !P%ACC%_LABEL! now? [Y/n]: "
if /i "!CFL!"=="n" (
  echo  Skipped - "npm run deploy" will fail until you log in to the right account.
  popd
  goto :eof
)
call npx --yes wrangler logout >nul 2>&1
echo.
echo  A browser window will open. Make sure you're signed in to your
echo  !P%ACC%_LABEL! Cloudflare account, then click Authorize.
echo.
call npx --yes wrangler login
call npx --yes wrangler whoami > "!WHO!" 2>&1
findstr /i /c:"!CF!" "!WHO!" >nul
if errorlevel 1 (
  echo.
  echo  Still not the right Cloudflare account. In the browser, log out of
  echo  dash.cloudflare.com, log in as !P%ACC%_LABEL!, then run this again.
) else (
  echo.
  echo  Cloudflare: now logged in to the right account.
)
popd
goto :eof

:fixRemote
rem Put the chosen username into the origin URL (https://USER@github.com/...),
rem so pushes sign in as that account even if another one is saved.
set "URL="
for /f "delims=" %%U in ('git -C "%REPO%" remote get-url origin 2^>nul') do set "URL=%%U"
if not defined URL (
  echo  ^(This project has no "origin" remote yet, so only name/email were set.^)
  goto :eof
)
if /i not "!URL:~0,8!"=="https://" (
  echo  ^(origin isn't an https:// address - left it as is: !URL!^)
  goto :eof
)
set "REST=!URL:*github.com/=!"
if "!REST!"=="!URL!" (
  echo  ^(origin isn't on github.com - left it as is.^)
  goto :eof
)
git -C "%REPO%" remote set-url origin "https://!U!@github.com/!REST!"
goto :eof

:showCurrent
set "CN=" & set "CE=" & set "CU=" & set "CR="
for /f "delims=" %%A in ('%GIT% config user.name 2^>nul') do set "CN=%%A"
for /f "delims=" %%A in ('%GIT% config user.email 2^>nul') do set "CE=%%A"
for /f "delims=" %%A in ('%GIT% config credential.https://github.com.username 2^>nul') do set "CU=%%A"
if not "%REPO%"=="GLOBAL" for /f "delims=" %%A in ('git -C "%REPO%" remote get-url origin 2^>nul') do set "CR=%%A"
echo.
echo  Current setup:
echo    Commit name  : !CN!
echo    Commit email : !CE!
echo    GitHub login : !CU!
if not "%REPO%"=="GLOBAL" echo    Pushes go to : !CR!
goto :eof

:done
echo.
pause
endlocal
