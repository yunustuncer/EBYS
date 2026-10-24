@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title EBYS Plus - Kur / Kaldir
color 0B

rem ============================================================
rem  Genel ayarlar
rem ============================================================
set "SCRIPT=https://raw.githubusercontent.com/yunustuncer/EBYS/refs/heads/main/ebys-plus.user.js"
set "SCRIPTKUR=https://www.tampermonkey.net/script_installation.php#url=%SCRIPT%"
set "EBYS=https://ebys.tkgm.gov.tr/edys-web/sistemeGiris.xhtml"
set "TMPCMD=%TEMP%\ebys_reg_%RANDOM%%RANDOM%.cmd"
set "BATDIR=%~dp0"

:MENU
cls
echo ============================================================
echo   EBYS Plus - Kur / Kaldir
echo ============================================================
echo.
echo   [1] KUR      Tampermonkey + EBYS Plus + EBYS girisi
echo   [2] KALDIR   Tampermonkey zorunlu kurulumunu kaldir
echo   [0] Cikis
echo.
choice /c 120 /n /m "Seciminiz: "
if errorlevel 3 goto CIKIS
if errorlevel 2 goto SEC_KALDIR
set "MOD=KUR"
goto TARAYICISEC
:SEC_KALDIR
set "MOD=KALDIR"

:TARAYICISEC
cls
echo ============================================================
if "!MOD!"=="KUR" (echo   Hangi tarayiciya kurulsun?) else (echo   Hangi tarayicidan kaldirilsin?)
echo ============================================================
echo.
echo   [1] Google Chrome
echo   [2] Mozilla Firefox
echo   [3] Microsoft Edge
echo   [0] Geri
echo.
choice /c 1230 /n /m "Seciminiz: "
if errorlevel 4 goto MENU
call :AYAR !errorlevel!
call :EXEBUL
if not defined BEXE (
    echo.
    echo [HATA] !BNAME! bilgisayarda bulunamadi.
    echo.
    pause
    goto TARAYICISEC
)
if "!MOD!"=="KALDIR" goto KALDIR

rem ============================================================
rem  KUR
rem ============================================================
:KUR
set "FFZORLA=0"
set "TMPROF="
cls
echo ============================================================
echo   KURULUM - !BNAME!
echo ============================================================
echo.
call :NETKONTROL
call :ENGELKONTROL
echo [1/4] Tampermonkey kontrol ediliyor...
call :TMKONTROL
if "!TMOK!"=="1" goto KUR_TMVAR

echo       Kurulu degil. Tarayici politikasi ile kuruluyor...
call :DURUM
if not "!FOUND!"=="1" (
    call :POLITIKAYAZ
    if errorlevel 1 (
        echo.
        echo [HATA] Kayit defterine yazilamadi. Yonetici iznini reddetmis olabilirsiniz.
        pause
        goto MENU
    )
) else (
    echo       Politika kaydi zaten var, tarayici yeniden baslatilarak uygulanacak.
)

call :TARAYICIKAPAT
if errorlevel 1 (
    echo.
    echo Tarayici kapatilmadan kurulum tamamlanamaz. Islem iptal edildi.
    pause
    goto MENU
)
echo       !BNAME! aciliyor, uzanti indirilip kuruluyor...
start "" "!BEXE!" "!PAGE!"

set /a N=0
:KUR_TMBEKLE
call :TMKONTROL
if "!TMOK!"=="1" goto KUR_TMTAMAM
set /a N+=1
if !N! GEQ 60 goto KUR_TMHATA
<nul set /p "=."
timeout /t 3 /nobreak >nul
goto KUR_TMBEKLE

:KUR_TMVAR
echo       [OK] Tampermonkey zaten kurulu.
if not "!FF!"=="1" goto KUR_SCRIPT
echo       Kontrol edilen profil:
echo       !TMPROF!
echo.
echo       Firefox'ta Tampermonkey uzantisi gercekten kurulu gorunuyor mu?
choice /c EH /n /m "Gorunuyor mu? (E/H): "
if errorlevel 2 goto KUR_FFZORLA
goto KUR_SCRIPT

:KUR_FFZORLA
set "FFZORLA=1"
call :DURUM
if not "!FOUND!"=="1" call :POLITIKAYAZ
call :TARAYICIKAPAT
goto KUR_TMHATA_FF

:KUR_TMHATA
echo.
echo.
echo [HATA] Tampermonkey 3 dakika icinde kurulamadi.
echo        - Internet baglantisini kontrol edin.
if "!FF!"=="1" goto KUR_TMHATA_FF
echo        - Tarayicida politika sayfasini acip politikalari yeniden
echo          yukleyin ve bu araci tekrar calistirin.
echo.
pause
goto MENU

:KUR_TMHATA_FF
echo        - Politika uygulanmadi. Elle kurulum sayfasi aciliyor.
start "" "!BEXE!" "about:policies"
start "" "!BEXE!" "https://addons.mozilla.org/firefox/addon/tampermonkey/"
echo.
echo   Acilan sayfada "Firefox'a Ekle" butonuna basin, cikan
echo   izin penceresinde "Ekle" deyin. Kurulunca buraya donup
echo   bir tusa basin.
echo.
pause
if "!FFZORLA!"=="1" goto KUR_TMTAMAM
call :TMKONTROL
if "!TMOK!"=="1" goto KUR_TMTAMAM
echo.
echo [HATA] Tampermonkey hala algilanmadi. Firefox'ta uzantinin
echo        acik oldugunu kontrol edip araci tekrar calistirin.
echo.
pause
goto MENU

:KUR_TMTAMAM
echo.
echo       [OK] Tampermonkey kuruldu ve dogrulandi.
if "!FF!"=="1" (
    echo       Tampermonkey baslatiliyor, birkac saniye bekleniyor...
    timeout /t 8 /nobreak >nul
)

:KUR_SCRIPT
echo.
echo [2/4] EBYS Plus scripti kontrol ediliyor...
call :SCRIPTKONTROL
if "!SCOK!"=="1" (
    echo       [OK] EBYS Plus scripti zaten kurulu.
    goto KUR_BITTI
)

if "!FF!"=="1" goto KUR_ONAY_FF
echo.
echo ------------------------------------------------------------
echo   SIZIN YAPACAGINIZ 2 ONAY ADIMI
echo ------------------------------------------------------------
echo   Tarayicinin guvenlik kurali geregi bu iki onayi otomatik
echo   vermek mumkun degil. Gerisi otomatik.
echo.
echo   ONAY 1 - Acilacak sayfada "Kullanici komut dosyalarina izin
echo            ver" [Allow User Scripts] anahtarini ACIK yapin.
echo            Bu anahtar yoksa sayfanin ustundeki "Gelistirici
echo            modu" anahtarini acin.
echo   ONAY 2 - Sonraki ekranda Tampermonkey'in "Kur" butonuna basin.
echo ------------------------------------------------------------
echo.
start "" "!BEXE!" "!EXTPAGE!"
pause
set "ILKURL=!SCRIPTKUR!"
goto KUR_SCRIPTAC

:KUR_ONAY_FF
echo.
echo ------------------------------------------------------------
echo   SIZIN YAPACAGINIZ ONAY
echo ------------------------------------------------------------
echo   Acilacak ekranda Tampermonkey'in "Kur" butonuna basin.
echo   Gerisi otomatik.
echo ------------------------------------------------------------
set "ILKURL=!SCRIPT!"

:KUR_SCRIPTAC
echo.
echo [3/4] Script kurulum ekrani aciliyor...
start "" "!BEXE!" "!ILKURL!"
echo       Tampermonkey ekraninda "Kur" butonuna basin.
echo       Kurulum otomatik algilanir. Algilanmazsa E tusuna basin.
echo.
call :BEKLESCRIPT 30
if not errorlevel 1 goto KUR_SCTAMAM

echo.
echo       Kurulum algilanamadi. Yedek yontem deneniyor...
<nul set /p "=!SCRIPT!" | clip
start "" "!BEXE!" "!SCRIPT!"
echo       Acilan Tampermonkey ekraninda "Kur" butonuna basin.
if "!FF!"=="1" (
    echo       Sayfa duz yazi olarak aciliyorsa Tampermonkey simgesi
    echo       - Yardimci Programlar - "URL'den kur" bolumune, panoya
    echo       kopyalanan adresi yapistirin.
)
echo       Algilanmazsa E tusuna basin.
echo.
call :BEKLESCRIPT 20
if not errorlevel 1 goto KUR_SCTAMAM

echo.
choice /c EH /n /m "EBYS Plus scriptini kurdunuz mu? (E/H): "
if errorlevel 2 (
    echo.
    echo [HATA] Script kurulamadi. Kontrol edin:
    echo        1. Uzantilar sayfasinda Tampermonkey acik mi?
    if "!FF!"=="1" (
        echo        2. Firefox'ta Tampermonkey simgesi arac cubugunda gorunuyor mu?
    ) else (
        echo        2. "Kullanici komut dosyalarina izin ver" acik mi?
    )
    echo        Sonra bu araci tekrar calistirin.
    echo.
    pause
    goto MENU
)

:KUR_SCTAMAM
echo.
echo       [OK] EBYS Plus scripti kuruldu.

:KUR_BITTI
echo.
echo [4/4] EBYS giris sayfasi aciliyor...
start "" "!BEXE!" "!EBYS!"
echo.
echo ============================================================
echo   Kurulum tamamlandi
echo ============================================================
echo   Sag ust kosedeki "EBYS Plus" butonuna basinca ilk kurulum
echo   sihirbazi sizi karsilayacak.
echo   Sorulariniz icin BT veya size bu dosyayi gonderen kisiye
echo   danisabilirsiniz.
echo.
pause
goto MENU

rem ============================================================
rem  KALDIR
rem ============================================================
:KALDIR
cls
echo ============================================================
echo   KALDIRMA - !BNAME!
echo ============================================================
echo.
call :DURUM
if "!FOUND!"=="1" goto KALDIR_ONAY
echo Bu araca ait zorunlu kurulum kaydi bulunamadi.
call :TMKONTROL
if "!TMOK!"=="1" (
    echo Tampermonkey elle kurulmus; tarayicinin uzantilar sayfasindan
    echo kaldirabilirsiniz.
)
echo.
pause
goto MENU

:KALDIR_ONAY
echo Tampermonkey zorunlu kurulum kaydi silinecek. Diger politikalariniza
echo dokunulmaz. Tarayici yeniden acildiginda uzanti ve icindeki
echo EBYS Plus scripti kaldirilmis olur.
echo.
choice /c EH /n /m "Devam edilsin mi? (E/H): "
if errorlevel 2 goto MENU

call :TARAYICIKAPAT
if errorlevel 1 (
    echo.
    echo Tarayici kapatilmadan kaldirma yapilamaz. Islem iptal edildi.
    pause
    goto MENU
)

call :YEDEKAL
call :POLITIKASIL
echo.
call :DURUM
if "!FOUND!"=="1" (
    echo [HATA] Kayit silinemedi. Yonetici iznini reddetmis olabilirsiniz.
    echo.
    pause
    goto MENU
)
echo [OK] Kayit silindi.
echo !BNAME! aciliyor, uzanti kaldiriliyor...
start "" "!BEXE!" "!PAGE!"

if not "!FF!"=="1" goto KALDIR_BITTI
set /a N=0
:KALDIR_FFBEKLE
call :TMKONTROL
if not "!TMOK!"=="1" goto KALDIR_FFTAMAM
set /a N+=1
if !N! GEQ 30 goto KALDIR_FFTAMAM
<nul set /p "=."
timeout /t 3 /nobreak >nul
goto KALDIR_FFBEKLE

:KALDIR_FFTAMAM
echo.
call :FFTEMIZLE

:KALDIR_BITTI
echo.
echo ============================================================
echo   Kaldirma tamamlandi
echo ============================================================
echo.
pause
goto MENU

:CIKIS
endlocal
exit /b

rem ============================================================
rem  ALT PROGRAMLAR
rem ============================================================

rem %1: 1=Chrome 2=Firefox 3=Edge
:AYAR
set "FF=0"
set "UDATA="
set "KEYBL="
if "%1"=="1" goto AYAR1
if "%1"=="2" goto AYAR2
goto AYAR3
:AYAR1
set "BNAME=Chrome"
set "PROC=chrome.exe"
set "KEY=HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist"
set "KEYBL=HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallBlocklist"
set "EXTID=dhdgffkkebhmkfjojejmpbldmpobfkfo"
set "POLVAL=dhdgffkkebhmkfjojejmpbldmpobfkfo;https://clients2.google.com/service/update2/crx"
set "UDATA=%LOCALAPPDATA%\Google\Chrome\User Data"
set "PAGE=chrome://extensions"
set "EXTPAGE=chrome://extensions/?id=dhdgffkkebhmkfjojejmpbldmpobfkfo"
goto AYAR_SON
:AYAR2
set "BNAME=Firefox"
set "FF=1"
set "PROC=firefox.exe"
set "KEY=HKLM\SOFTWARE\Policies\Mozilla\Firefox\Extensions\Install"
set "KEYUN=HKLM\SOFTWARE\Policies\Mozilla\Firefox\Extensions\Uninstall"
set "EXTID=firefox@tampermonkey.net"
set "POLVAL=https://addons.mozilla.org/firefox/downloads/latest/tampermonkey/latest.xpi"
set "UDATA=%APPDATA%\Mozilla\Firefox\Profiles"
set "PAGE=about:addons"
set "EXTPAGE=about:addons"
goto AYAR_SON
:AYAR3
set "BNAME=Edge"
set "PROC=msedge.exe"
set "KEY=HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist"
set "KEYBL=HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallBlocklist"
set "EXTID=iikmkjmpaadaobahmlepeloendndfphd"
set "POLVAL=iikmkjmpaadaobahmlepeloendndfphd;https://edge.microsoft.com/extensionwebstorebase/v1/crx"
set "UDATA=%LOCALAPPDATA%\Microsoft\Edge\User Data"
set "PAGE=edge://extensions"
set "EXTPAGE=edge://extensions/?id=iikmkjmpaadaobahmlepeloendndfphd"
:AYAR_SON
set "YEDEK=%BATDIR%ebys-plus-yedek-%BNAME%.reg"
set "MATCH=%EXTID%"
if "%FF%"=="1" set "MATCH=tampermonkey"
exit /b 0

rem Secilen tarayicinin exe yolunu bulur: BEXE
:EXEBUL
set "BEXE="
for /f "tokens=2,*" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\%PROC%" /ve 2^>nul ^| findstr REG_SZ') do set "BEXE=%%b"
if not defined BEXE for /f "tokens=2,*" %%a in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\%PROC%" /ve 2^>nul ^| findstr REG_SZ') do set "BEXE=%%b"
if not defined BEXE for /f "tokens=2,*" %%a in ('reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\%PROC%" /ve 2^>nul ^| findstr REG_SZ') do set "BEXE=%%b"
if defined BEXE if not exist "%BEXE%" set "BEXE="
exit /b 0

rem Script adresine erisim var mi? (uyari verir, islemi durdurmaz)
:NETKONTROL
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%SCRIPT%' -UseBasicParsing -TimeoutSec 10; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [UYARI] Script adresine erisilemedi. Internet, proxy veya guvenlik
    echo         duvari engeli olabilir. Kurulum yine de denenecek.
    echo.
)
exit /b 0

rem Kurumsal politika tum uzantilari engelliyor mu? (Chrome/Edge)
:ENGELKONTROL
if not defined KEYBL exit /b 0
reg query "%KEYBL%" 2>nul | findstr /r /c:"REG_SZ  *\*$" >nul
if not errorlevel 1 (
    echo [UYARI] Bu bilgisayarda tum uzantilar kurumsal politika ile engellenmis.
    echo         Kurulum basarisiz olabilir; BT birimine danisin.
    echo.
)
exit /b 0

rem Politika kaydi var mi? FOUND=1/0
:DURUM
set "FOUND=0"
for /f "tokens=1" %%a in ('reg query "%KEY%" 2^>nul ^| findstr /i "%MATCH%"') do set "FOUND=1"
exit /b 0

rem Firefox'un KULLANDIGI profili bulur: FFPROF (tam yol) veya bos
:FFPROFIL
set "FFPROF="
set "FFROOT=%APPDATA%\Mozilla\Firefox"
set "LASTP="
if exist "%FFROOT%\installs.ini" (
    for /f "usebackq tokens=1,* delims==" %%a in ("%FFROOT%\installs.ini") do (
        if /i "%%a"=="Default" if not defined FFPROF set "FFPROF=%%b"
    )
)
if not defined FFPROF if exist "%FFROOT%\profiles.ini" (
    for /f "usebackq tokens=1,* delims==" %%a in ("%FFROOT%\profiles.ini") do (
        if /i "%%a"=="Path" set "LASTP=%%b"
        if /i "%%a"=="Default" if "%%b"=="1" set "FFPROF=!LASTP!"
    )
)
if not defined FFPROF call :FFNEWEST
if not defined FFPROF exit /b 0
set "FFPROF=!FFPROF:/=\!"
if not "!FFPROF:~1,1!"==":" set "FFPROF=%FFROOT%\!FFPROF!"
exit /b 0

rem Ini dosyalarindan profil bulunamazsa en son kullanilan profili secer
:FFNEWEST
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "Get-ChildItem -Path '%UDATA%\*\prefs.js' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty DirectoryName" 2^>nul`) do set "FFPROF=%%P"
exit /b 0

rem Tampermonkey tarayici profillerinde diskte kurulu mu? TMOK=1/0
:TMKONTROL
set "TMOK=0"
if "%FF%"=="1" goto TMK_FF
for /d %%P in ("%UDATA%\*") do (
    if exist "%%~P\Extensions\%EXTID%\" set "TMOK=1"
)
exit /b 0
:TMK_FF
call :FFPROFIL
if defined FFPROF (
    call :TMK_FFPROFIL "!FFPROF!"
) else (
    for /d %%P in ("%UDATA%\*") do call :TMK_FFPROFIL "%%~P"
)
exit /b 0
:TMK_FFPROFIL
rem Sadece extensions.json icinde ETKIN (active) kayit varsa kurulu say
if not exist "%~1\extensions.json" exit /b 0
powershell -NoProfile -Command "try { $j = Get-Content -Raw -LiteralPath '%~1\extensions.json' | ConvertFrom-Json; $a = $j.addons | Where-Object { $_.id -eq 'firefox@tampermonkey.net' }; if ($a -and $a.active -and -not $a.userDisabled -and -not $a.appDisabled) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 exit /b 0
set "TMOK=1"
set "TMPROF=%~1"
exit /b 0

rem EBYS Plus scripti Tampermonkey deposunda var mi? SCOK=1/0
rem Firefox'ta en iyi caba denir; algilanamazsa E tusu ile onaylanir.
:SCRIPTKONTROL
set "SCOK=0"
if "%FF%"=="1" goto SCK_FF
for /d %%P in ("%UDATA%\*") do (
    if exist "%%~P\Local Extension Settings\%EXTID%\" (
        findstr /m /l /i /c:"ebys-plus.user.js" "%%~P\Local Extension Settings\%EXTID%\*" >nul 2>&1 && set "SCOK=1"
    )
)
exit /b 0
:SCK_FF
call :FFPROFIL
if not defined FFPROF exit /b 0
if exist "!FFPROF!\storage\default\" (
    for /d %%D in ("!FFPROF!\storage\default\moz-extension*") do (
        findstr /s /m /l /i /c:"ebys-plus.user.js" "%%~D\*" >nul 2>&1 && set "SCOK=1"
    )
)
if exist "!FFPROF!\browser-extension-data\firefox@tampermonkey.net\" (
    findstr /s /m /l /i /c:"ebys-plus.user.js" "!FFPROF!\browser-extension-data\firefox@tampermonkey.net\*" >nul 2>&1 && set "SCOK=1"
)
exit /b 0

rem %1 = en fazla kac tur (her tur 3 sn). Bulunursa veya E'ye basilirsa 0, aksi halde 1
:BEKLESCRIPT
set /a BN=0
:BS_DON
call :SCRIPTKONTROL
if "!SCOK!"=="1" exit /b 0
set /a BN+=1
if !BN! GEQ %1 exit /b 1
choice /c EN /t 3 /d N /n >nul
if errorlevel 2 goto BS_DON
exit /b 0

rem Yonetici yetkisiyle gecici .cmd dosyasini calistirir
:YONETICICALISTIR
powershell -NoProfile -Command "try { Start-Process -FilePath '%TMPCMD%' -Verb RunAs -Wait -WindowStyle Hidden -ErrorAction Stop } catch { exit 1 }" >nul 2>&1
set "YR=%errorlevel%"
del "%TMPCMD%" >nul 2>&1
exit /b %YR%

:POLITIKAYAZ
call :YEDEKAL
set "SLOT=1"
:SLOT_DON
reg query "%KEY%" /v !SLOT! >nul 2>&1
if not errorlevel 1 (
    set /a SLOT+=1
    goto SLOT_DON
)
> "%TMPCMD%" echo @echo off
>> "%TMPCMD%" echo reg add "%KEY%" /v !SLOT! /t REG_SZ /d "%POLVAL%" /f
if "%FF%"=="1" >> "%TMPCMD%" echo reg delete "%KEYUN%" /f
echo       Yonetici izni isteniyor, lutfen "Evet" deyin...
call :YONETICICALISTIR
if errorlevel 1 exit /b 1
call :DURUM
if "!FOUND!"=="1" (
    echo       [OK] Politika kaydi eklendi [sira !SLOT!].
    exit /b 0
)
exit /b 1

:POLITIKASIL
> "%TMPCMD%" echo @echo off
for /f "tokens=1" %%a in ('reg query "%KEY%" 2^>nul ^| findstr /i "%MATCH%"') do (
    >> "%TMPCMD%" echo reg delete "%KEY%" /v "%%a" /f
)
>> "%TMPCMD%" echo reg query "%KEY%" ^| findstr /i REG_ ^>nul ^|^| reg delete "%KEY%" /f
if "%FF%"=="1" >> "%TMPCMD%" echo reg add "%KEYUN%" /v 1 /t REG_SZ /d "%EXTID%" /f
echo Yonetici izni isteniyor, lutfen "Evet" deyin...
call :YONETICICALISTIR
exit /b %errorlevel%

rem Firefox: kaldirma tamamlaninca gecici "Uninstall" kaydini temizler
:FFTEMIZLE
> "%TMPCMD%" echo @echo off
>> "%TMPCMD%" echo reg delete "%KEYUN%" /f
call :YONETICICALISTIR
exit /b 0

:YEDEKAL
reg query "%KEY%" >nul 2>&1
if errorlevel 1 exit /b 0
reg export "%KEY%" "%YEDEK%" /y >nul 2>&1
if errorlevel 1 reg export "%KEY%" "%TEMP%\ebys-plus-yedek-%BNAME%.reg" /y >nul 2>&1
exit /b 0

rem Tarayici aciksa onayla kapat. Basariliysa 0, vazgecilirse 1
:TARAYICIKAPAT
tasklist /fi "imagename eq %PROC%" 2>nul | find /i "%PROC%" >nul
if errorlevel 1 exit /b 0
echo.
echo %BNAME% acik. Degisikligin uygulanmasi icin kapatilip yeniden
echo acilmasi gerekiyor. Kaydedilmemis formlariniz varsa once kaydedin.
choice /c EH /n /m "%BNAME% simdi kapatilsin mi? (E/H): "
if errorlevel 2 exit /b 1
taskkill /f /im %PROC% >nul 2>&1
set /a KN=0
:KAPAT_BEKLE
tasklist /fi "imagename eq %PROC%" 2>nul | find /i "%PROC%" >nul
if errorlevel 1 goto KAPAT_BITTI
set /a KN+=1
if !KN! GEQ 10 goto KAPAT_BITTI
timeout /t 1 /nobreak >nul
goto KAPAT_BEKLE
:KAPAT_BITTI
timeout /t 2 /nobreak >nul
exit /b 0
