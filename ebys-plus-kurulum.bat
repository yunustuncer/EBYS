@echo off
rem ============================================================
rem  EBYS Plus - Kur / Kaldir  (Emvalis)
rem  Surum 2.0
rem  Tampermonkey + EBYS Plus scriptini Chrome / Firefox / Edge
rem  tarayicilarina kurar veya kaldirir.
rem ============================================================
setlocal EnableExtensions DisableDelayedExpansion
set "BATFULL=%~f0"
set "BATDIR=%~dp0"
if not "%BATFULL%"=="%BATFULL:!=%" (
    echo [HATA] Dosya yolunda ! karakteri var. Dosyayi baska bir klasore tasiyin.
    pause
    exit /b 1
)
setlocal EnableDelayedExpansion

set "OLDCP="
for /f "tokens=2 delims=:." %%c in ('chcp') do set "OLDCP=%%c"
if defined OLDCP set "OLDCP=!OLDCP: =!"
chcp 65001 >nul
title Emvalis - EBYS Plus - Kur / Kaldir
color 0B

set "VER=2.0"
set "SCRIPT=https://raw.githubusercontent.com/yunustuncer/EBYS/refs/heads/main/ebys-plus.user.js"
set "RAW=https://raw.githubusercontent.com/yunustuncer/EBYS/refs/heads/main"
set "SCRIPTKUR=https://www.tampermonkey.net/script_installation.php#url=%SCRIPT%"
set "EBYS=https://ebys.tkgm.gov.tr/edys-web/sistemeGiris.xhtml"
set "PDIR=%ProgramData%\EBYS-Plus"
set "PDIRU=%ProgramData:\=/%/EBYS-Plus"
set "LOGDIR=%LOCALAPPDATA%\EBYS-Plus"
set "LOGFILE=%LOGDIR%\ebys-plus.log"
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1

rem PowerShell yardimcisi icin bu dosyanin gecici kopyasi
set "EBYS_SELF=%TEMP%\ebys_self_%RANDOM%%RANDOM%.bat"
copy /y "%~f0" "%EBYS_SELF%" >nul 2>&1
if not exist "%EBYS_SELF%" (
    echo [HATA] Gecici dosya olusturulamadi: !TEMP!
    pause
    exit /b 1
)
rem Onceki oturumlardan kalan eski kopyalari temizle [1 gunden eski]
forfiles /p "%TEMP%" /m "ebys_self_*.bat" /d -1 /c "cmd /c del @path" >nul 2>&1

call :LOG "---- Oturum basladi v!VER! ----"

:MENU
cls
echo ============================================================
echo.
echo      #####  #   #  #   #   ###   #      ###   ####
echo      #      ## ##  #   #  #   #  #       #   #
echo      ####   # # #  #   #  #####  #       #    ###
echo      #      #   #   # #   #   #  #       #       #
echo      #####  #   #    #    #   #  #####  ###  ####
echo.
echo                  EBYS Plus  -  Kur / Kaldir   v!VER!
echo ============================================================
echo.
echo.
echo   [1] KUR      Tampermonkey  + EBYS Plus + EBYS girisi
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
call :LOG "Mod: !MOD! / Tarayici: !BNAME! / Exe: !BEXE!"
if "!MOD!"=="KALDIR" goto KALDIR

rem ============================================================
rem  KUR
rem ============================================================
:KUR
set "FFZORLA=0"
set "TMPROF="
set "UNPACKED=0"
set "SRC="
cls
echo ============================================================
echo   KURULUM - !BNAME!
echo ============================================================
echo.
fltmc >nul 2>&1
if not errorlevel 1 (
    echo [UYARI] Bu arac YONETICI olarak calisiyor. Tarayici da yonetici
    echo         yetkisiyle acilir ve kurulum basarisiz olabilir.
    echo         Normal bir pencereden calistirmaniz onerilir.
    echo.
)
call :ENGELKONTROL
echo [1/4] Tampermonkey kontrol ediliyor...
call :TMKONTROL
if "!TMOK!"=="1" goto KUR_TMVAR

call :KAYNAKBUL
if defined SRC (
    echo       Kurulum dosyasi: !SRC!
    goto KUR_YEREL
)
if "!FF!"=="1" (
    echo.
    echo [HATA] Kurulum dosyasi bulunamadi: !SRCNAME!
    echo        Dosyayi su klasore koyun veya internet baglantisini kontrol edin:
    echo        !BATDIR!
    echo.
    pause
    goto MENU
)
echo       Yerel dosya yok; dogrudan Web Store yontemi denenecek.
goto KUR_MAGAZA

:KUR_YEREL
call :POLITIKAYAZ yerel
if errorlevel 1 (
    echo.
    pause
    goto MENU
)
call :TARAYICIKAPAT
if errorlevel 1 (
    echo.
    echo Tarayici kapatilmadan kurulum tamamlanamaz. Islem iptal edildi.
    echo Politika kaydi yazildi; tarayici yeniden basladiginda uygulanir.
    pause
    goto MENU
)
echo       !BNAME! aciliyor, uzanti yerel dosyadan kuruluyor...
start "" "!BEXE!" "!PAGE!"
call :TMBEKLE 30
if errorlevel 1 goto KUR_YEREL_BASARISIZ
goto KUR_TMTAMAM

:KUR_YEREL_BASARISIZ
echo.
echo [UYARI] Yerel dosya yontemi sonuc vermedi.
call :LOG "Yerel yontem basarisiz"
if "!FF!"=="1" goto KUR_TMHATA_FF
echo   Chrome ve Edge, magaza disi zorunlu kurulumu sadece yonetilen
echo   [domain / Intune / Pro surum] bilgisayarlarda kabul eder.
echo   Kontrol: adres cubuguna !POLPAGE! yazip politika durumuna bakin.
echo.
echo   Simdi Web Store zorunlu kurulum yontemi deneniyor...

:KUR_MAGAZA
call :POLITIKAYAZ magaza
if errorlevel 1 (
    echo.
    pause
    goto MENU
)
call :TARAYICIKAPAT
if errorlevel 1 (
    echo.
    echo Tarayici kapatilmadan kurulum tamamlanamaz. Islem iptal edildi.
    echo Politika kaydi yazildi; tarayici yeniden basladiginda uygulanir.
    pause
    goto MENU
)
echo       !BNAME! aciliyor, uzanti magazadan kuruluyor...
start "" "!BEXE!" "!PAGE!"
call :TMBEKLE 40
if errorlevel 1 goto KUR_ELLE
goto KUR_TMTAMAM

:KUR_ELLE
echo.
echo [HATA] Tampermonkey otomatik kurulamadi.
call :LOG "Otomatik yontemler basarisiz"
echo        Basarisiz politika kaydi temizleniyor...
call :POLITIKASIL
echo.
echo   Elle kurulum secenekleri:
echo   [1] !BNAME! uzanti magazasi sayfasini ac [onerilen]
echo   [2] Paketlenmemis yukle [Gelistirici modu, CRX dosyasi gerekir]
echo   [0] Iptal
echo.
choice /c 120 /n /m "Seciminiz: "
if errorlevel 3 goto MENU
if errorlevel 2 goto KUR_UNPACK
start "" "!BEXE!" "!STOREPAGE!"
echo.
echo   Acilan sayfada uzantiyi tarayiciya ekleyin.
echo   Eklenince buraya donup bir tusa basin.
echo.
pause
call :TMKONTROL
if not "!TMOK!"=="1" (
    echo.
    echo [HATA] Tampermonkey hala algilanmadi. Araci tekrar calistirin.
    echo.
    pause
    goto MENU
)
goto KUR_TMTAMAM

:KUR_UNPACK
if not defined SRC call :KAYNAKBUL
if not defined SRC (
    echo.
    echo [HATA] CRX dosyasi bulunamadi: !SRCNAME!
    echo.
    pause
    goto MENU
)
set "UDIR=%LOCALAPPDATA%\EBYS-Plus\!BKEY!-paket"
call :PSRUN unpack "!SRC!" "!UDIR!"
if errorlevel 1 (
    echo [HATA] Paket acilamadi.
    pause
    goto MENU
)
<nul set /p "=!UDIR!" | clip
start "" "!BEXE!" "!PAGE!"
echo.
echo ------------------------------------------------------------
echo   ELLE YUKLEME
echo ------------------------------------------------------------
echo   1. Acilan sayfanin sag ustunden "Gelistirici modu" acin.
echo   2. "Paketlenmemis oge yukle" [Load unpacked] dugmesine basin.
echo   3. Su klasoru secin [adres panoya kopyalandi]:
echo      !UDIR!
echo ------------------------------------------------------------
echo.
pause
set "UNPACKED=1"
goto KUR_SCRIPT

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
call :KAYNAKBUL
if not defined SRC (
    echo [HATA] Kurulum dosyasi bulunamadi: !SRCNAME!
    pause
    goto MENU
)
call :POLITIKAYAZ yerel
if errorlevel 1 (
    echo.
    pause
    goto MENU
)
call :TARAYICIKAPAT
if errorlevel 1 (
    echo.
    echo Tarayici kapatilmadan kurulum tamamlanamaz. Islem iptal edildi.
    pause
    goto MENU
)

:KUR_TMHATA_FF
if "!FFZORLA!"=="1" (echo        - Politika yeniden yazildi. Kurulum dosyasi dogrudan aciliyor.) else (echo        - Politika uygulanmadi. Kurulum dosyasi dogrudan aciliyor.)
start "" "!BEXE!" "about:policies"
start "" "!BEXE!" "!SRC!"
echo.
echo   Acilan pencerede "Ekle" butonuna basin. Kurulunca buraya donup
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
call :LOG "Tampermonkey tamam"
echo       Tampermonkey baslatiliyor, birkac saniye bekleniyor...
timeout /t 6 /nobreak >nul

:KUR_SCRIPT
echo.
echo [2/4] EBYS Plus scripti kontrol ediliyor...
if "!UNPACKED!"=="1" goto KUR_SCRIPT_ELLE
call :SCRIPTKONTROL
if "!SCOK!"=="1" (
    echo       [OK] EBYS Plus scripti zaten kurulu.
    goto KUR_BITTI
)
call :NETKONTROL

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
    call :LOG "Script kurulamadi"
    pause
    goto MENU
)

:KUR_SCTAMAM
echo.
echo       [OK] EBYS Plus scripti kuruldu.
call :LOG "Script tamam"
goto KUR_BITTI

:KUR_SCRIPT_ELLE
echo       Elle yuklenen uzantida script otomatik algilanamaz.
echo       Once uzanti ayrintilarinda "Kullanici komut dosyalarina izin
echo       ver" anahtarinin ACIK oldugundan emin olun.
echo       Script kurulum ekrani aciliyor, "Kur" butonuna basin.
start "" "!BEXE!" "!SCRIPTKUR!"
echo.
pause

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
echo.
echo   Not: Tampermonkey zorunlu kurulum olarak eklendi; tarayicidan
echo   elle kaldirilamaz. Kaldirmak icin bu aracta [2] KALDIR secin.
echo.
echo   Emvalis
echo.
call :LOG "Kurulum tamamlandi"
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

call :YEDEKAL yeni
call :POLITIKASIL
echo.
call :DURUM
if "!FOUND!"=="1" (
    echo [HATA] Kayit silinemedi. Yonetici iznini reddetmis olabilirsiniz.
    echo.
    call :LOG "Politika silinemedi"
    pause
    goto MENU
)
echo [OK] Kayit silindi.
call :LOG "Politika silindi"
if exist "%YEDEK%" echo      Politika yedegi: %YEDEK%
echo !BNAME! aciliyor, uzanti kaldiriliyor...
start "" "!BEXE!" "!PAGE!"

set /a N=0
:KALDIR_BEKLE
call :TMKONTROL
if not "!TMOK!"=="1" goto KALDIR_TAMAM
set /a N+=1
if !N! GEQ 20 goto KALDIR_ZAMAN
<nul set /p "=."
timeout /t 3 /nobreak >nul
goto KALDIR_BEKLE

:KALDIR_ZAMAN
echo.
echo [UYARI] Uzanti henuz kaldirilmamis gorunuyor. Tarayici tamamen
echo         yuklenince kaldirilir; gerekirse tarayiciyi yeniden baslatin.
goto KALDIR_FFTEMIZ

:KALDIR_TAMAM
echo.
echo       [OK] Uzanti kaldirildi.

:KALDIR_FFTEMIZ
if "!FF!"=="1" call :FFTEMIZLE

echo.
echo ============================================================
echo   Kaldirma tamamlandi
echo ============================================================
echo.
pause
goto MENU

:CIKIS
call :LOG "Oturum bitti"
del "%EBYS_SELF%" >nul 2>&1
if defined OLDCP chcp !OLDCP! >nul
endlocal
endlocal
exit /b 0

rem ============================================================
rem  ALT PROGRAMLAR
rem ============================================================

rem Gunluk dosyasina satir yazar. %1 = mesaj [tirnak icermemeli]
:LOG
set "LM=%~1"
(>>"%LOGFILE%" echo [!DATE! !TIME!] !LM!) 2>nul
exit /b 0

rem %1: 1=Chrome 2=Firefox 3=Edge
:AYAR
set "FF=0"
set "UDATA="
set "KEYUNSUB="
set "POLROOT="
if "%1"=="1" goto AYAR1
if "%1"=="2" goto AYAR2
goto AYAR3
:AYAR1
set "BNAME=Chrome"
set "BKEY=chrome"
set "SRCNAME=tampermonkey-chrome.crx"
set "SRCPAT=*tampermonkey*chrome*.crx"
set "PROC=chrome.exe"
set "KEYSUB=SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist"
set "POLROOT=HKLM\SOFTWARE\Policies\Google\Chrome"
set "EXTID=dhdgffkkebhmkfjojejmpbldmpobfkfo"
set "UDATA=%LOCALAPPDATA%\Google\Chrome\User Data"
set "PAGE=chrome://extensions"
set "POLPAGE=chrome://policy"
set "EXTPAGE=chrome://extensions/?id=dhdgffkkebhmkfjojejmpbldmpobfkfo"
set "STOREURL=https://clients2.google.com/service/update2/crx"
set "STOREPAGE=https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo"
goto AYAR_SON
:AYAR2
set "BNAME=Firefox"
set "BKEY=firefox"
set "SRCNAME=tampermonkey-firefox.xpi"
set "SRCPAT=*tampermonkey*.xpi"
set "FF=1"
set "PROC=firefox.exe"
set "KEYSUB=SOFTWARE\Policies\Mozilla\Firefox\Extensions\Install"
set "KEYUNSUB=SOFTWARE\Policies\Mozilla\Firefox\Extensions\Uninstall"
set "EXTID=firefox@tampermonkey.net"
set "UDATA=%APPDATA%\Mozilla\Firefox\Profiles"
set "PAGE=about:addons"
set "POLPAGE=about:policies"
set "EXTPAGE=about:addons"
set "STOREURL="
set "STOREPAGE=https://addons.mozilla.org/firefox/addon/tampermonkey/"
goto AYAR_SON
:AYAR3
set "BNAME=Edge"
set "BKEY=edge"
set "SRCNAME=tampermonkey-edge.crx"
set "SRCPAT=*tampermonkey*edge*.crx"
set "PROC=msedge.exe"
set "KEYSUB=SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist"
set "POLROOT=HKLM\SOFTWARE\Policies\Microsoft\Edge"
set "EXTID=iikmkjmpaadaobahmlepeloendndfphd"
set "UDATA=%LOCALAPPDATA%\Microsoft\Edge\User Data"
set "PAGE=edge://extensions"
set "POLPAGE=edge://policy"
set "EXTPAGE=edge://extensions/?id=iikmkjmpaadaobahmlepeloendndfphd"
set "STOREURL=https://edge.microsoft.com/extensionwebstorebase/v1/crx"
set "STOREPAGE=https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd"
:AYAR_SON
set "KEY=HKLM\%KEYSUB%"
set "KEYUN="
if defined KEYUNSUB set "KEYUN=HKLM\%KEYUNSUB%"
set "MARKER=%PDIR%\%BKEY%\slot.txt"
set "YEDEKDIR=%LOCALAPPDATA%\EBYS-Plus\yedek"
set "YEDEK=%YEDEKDIR%\ebys-plus-yedek-%BNAME%.reg"
rem Politika kayitlarini sadece bu aracin yazdigi kayitlardan ayirt etmek icin
set "MATCH=EBYS-Plus"
exit /b 0

rem Secilen tarayicinin exe yolunu bulur: BEXE
:EXEBUL
set "BEXE="
for /f "tokens=2,*" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\%PROC%" /ve 2^>nul ^| findstr REG_SZ') do set "BEXE=%%b"
if not defined BEXE for /f "tokens=2,*" %%a in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\%PROC%" /ve 2^>nul ^| findstr REG_SZ') do set "BEXE=%%b"
if not defined BEXE for /f "tokens=2,*" %%a in ('reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\%PROC%" /ve 2^>nul ^| findstr REG_SZ') do set "BEXE=%%b"
if defined BEXE if not exist "%BEXE%" set "BEXE="
if not defined BEXE call :EXEYEDEK
exit /b 0

rem Kayit defterinde bulunamazsa bilinen kurulum yollarini dener
:EXEYEDEK
if "%BKEY%"=="chrome" call :EXEDENE "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if "%BKEY%"=="firefox" call :EXEDENE "%ProgramFiles%\Mozilla Firefox\firefox.exe" "%ProgramFiles(x86)%\Mozilla Firefox\firefox.exe"
if "%BKEY%"=="edge" call :EXEDENE "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
exit /b 0
:EXEDENE
if "%~1"=="" exit /b 0
if not defined BEXE if exist "%~1" set "BEXE=%~1"
shift
goto EXEDENE

rem Kurulum dosyasi: once bat ile ayni klasorde aranir, yoksa GitHub'dan indirilir. SRC
:KAYNAKBUL
set "SRC="
if exist "%BATDIR%%SRCNAME%" set "SRC=%BATDIR%%SRCNAME%"
if defined SRC exit /b 0
for %%F in ("%BATDIR%%SRCPAT%") do if not defined SRC set "SRC=%%~fF"
if defined SRC exit /b 0
set "DLDIR=%TEMP%\EBYS-Plus-indirme"
if not exist "%DLDIR%" mkdir "%DLDIR%" >nul 2>&1
del "%DLDIR%\%SRCNAME%" >nul 2>&1
echo       Yerel dosya yok, indiriliyor: %SRCNAME%
echo       Lutfen bekleyin...
curl.exe -L -f -# --ssl-no-revoke --connect-timeout 15 --max-time 120 -o "%DLDIR%\%SRCNAME%" "%RAW%/%SRCNAME%"
if not errorlevel 1 goto KB_KONTROL
echo       curl basarisiz, PowerShell ile deneniyor...
set "EBYS_P1=%RAW%/%SRCNAME%"
set "EBYS_P2=%DLDIR%\%SRCNAME%"
powershell -NoProfile -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $p = [Net.WebRequest]::GetSystemWebProxy(); $p.Credentials = [Net.CredentialCache]::DefaultCredentials; [Net.WebRequest]::DefaultWebProxy = $p; Invoke-WebRequest -Uri $env:EBYS_P1 -OutFile $env:EBYS_P2 -UseBasicParsing -TimeoutSec 120 } catch { exit 1 }" >nul 2>&1
:KB_KONTROL
if not exist "%DLDIR%\%SRCNAME%" (
    echo       [UYARI] Indirilemedi. Internet, proxy veya guvenlik duvari engeli olabilir.
    exit /b 0
)
for %%S in ("%DLDIR%\%SRCNAME%") do if %%~zS LSS 10000 del "%DLDIR%\%SRCNAME%" >nul 2>&1
if exist "%DLDIR%\%SRCNAME%" set "SRC=%DLDIR%\%SRCNAME%"
exit /b 0

rem Politika kaydini yazar. %1 = yerel [dosyadan] veya magaza [Web Store]
rem Basari 0, hata 1
:POLITIKAYAZ
set "DST=%PDIR%\%BKEY%"
if not exist "%DST%" mkdir "%DST%" >nul 2>&1
if /i "%~1"=="magaza" goto PY_MAGAZA
set "COPYNAME=tampermonkey.crx"
if "%FF%"=="1" set "COPYNAME=tampermonkey.xpi"
copy /y "%SRC%" "%DST%\%COPYNAME%" >nul 2>&1
if not exist "%DST%\%COPYNAME%" (
    echo [HATA] Dosya klasore kopyalanamadi: !DST!
    echo        Bu araci yonetici olarak calistirmayi deneyin.
    exit /b 1
)
echo       Dosya kopyalandi: !DST!\!COPYNAME!
if "%FF%"=="1" (
    set "POLVAL=!DST!\tampermonkey.xpi"
    goto PY_YAZ
)
call :PSRUN ver "%SRC%" >"%TEMP%\ebys_ver.txt"
if errorlevel 1 (
    echo [HATA] CRX dosyasi okunamadi. Dosya bozuk veya yanlis olabilir.
    exit /b 1
)
set "TMVER="
set /p TMVER=<"%TEMP%\ebys_ver.txt"
del "%TEMP%\ebys_ver.txt" >nul 2>&1
if not defined TMVER (
    echo [HATA] Paket surumu okunamadi.
    exit /b 1
)
echo       Paket surumu: !TMVER!
call :PSRUN xml "%EXTID%" "file:///%PDIRU%/%BKEY%/tampermonkey.crx" "!TMVER!" "%DST%\update.xml"
if errorlevel 1 (
    echo [HATA] update.xml olusturulamadi.
    exit /b 1
)
set "POLVAL=%EXTID%;file:///%PDIRU%/%BKEY%/update.xml"
goto PY_YAZ

:PY_MAGAZA
if not defined STOREURL (
    echo [HATA] Bu tarayici icin Web Store yontemi desteklenmiyor.
    exit /b 1
)
set "POLVAL=%EXTID%;%STOREURL%"

:PY_YAZ
call :SLOTBUL
call :YEDEKAL
echo       Yonetici izni isteniyor, lutfen "Evet" deyin...
call :PSRUN polset "%KEYSUB%" "!SLOT!" "!POLVAL!" "%KEYUNSUB%" "%EXTID%"
if errorlevel 1 (
    echo [HATA] Yonetici islemi tamamlanamadi. Izni reddetmis olabilirsiniz.
    call :LOG "polset basarisiz"
    exit /b 1
)
reg query "%KEY%" /v !SLOT! 2>nul | findstr /i /c:"%EXTID%" >nul
if errorlevel 1 (
    echo [HATA] Kayit defterine yazilamadi. Yonetici iznini reddetmis olabilirsiniz.
    call :LOG "Politika yazilamadi"
    exit /b 1
)
>"%MARKER%" echo !SLOT!
echo       [OK] Politika kaydi eklendi [sira !SLOT!].
call :LOG "Politika yazildi: sira !SLOT!"
exit /b 0

rem Politika anahtarinda kullanilacak sira: bu aracin kaydi varsa o, yoksa ilk bos
:SLOTBUL
set "SLOT="
for /f "tokens=1" %%a in ('reg query "%KEY%" 2^>nul ^| findstr /i "%MATCH%"') do set "SLOT=%%a"
if defined SLOT exit /b 0
set "MSLOT="
if exist "%MARKER%" set /p MSLOT=<"%MARKER%"
if defined MSLOT (
    reg query "%KEY%" /v !MSLOT! 2>nul | findstr /i /c:"%EXTID%" >nul
    if not errorlevel 1 set "SLOT=!MSLOT!"
)
if defined SLOT exit /b 0
set "SLOT=1"
:SLOT_DON
reg query "%KEY%" /v !SLOT! >nul 2>&1
if not errorlevel 1 (
    set /a SLOT+=1
    goto SLOT_DON
)
exit /b 0

rem Bu aracin politika kaydi var mi? FOUND=1/0, MSLOT=isaretli sira
:DURUM
set "FOUND=0"
set "MSLOT="
if exist "%MARKER%" set /p MSLOT=<"%MARKER%"
for /f "tokens=1" %%a in ('reg query "%KEY%" 2^>nul ^| findstr /i "%MATCH%"') do set "FOUND=1"
if defined MSLOT (
    reg query "%KEY%" /v !MSLOT! 2>nul | findstr /i /c:"%EXTID%" >nul
    if not errorlevel 1 set "FOUND=1"
)
exit /b 0

rem Politika kaydini ve dosyalarini siler. Basari 0, hata 1
:POLITIKASIL
call :DURUM
echo Yonetici izni isteniyor, lutfen "Evet" deyin...
call :PSRUN poldel "%KEYSUB%" "!MSLOT!" "%EXTID%" "%MATCH%" "%KEYUNSUB%" "%PDIR%\%BKEY%" "%PDIR%"
exit /b %errorlevel%

rem Firefox: kaldirma tamamlaninca gecici "Uninstall" kaydini temizler
:FFTEMIZLE
call :PSRUN unclean "%KEYUNSUB%" "%EXTID%"
exit /b 0

rem PowerShell yardimcisi. %1=komut %2..%8=arguman
rem Argumanlar ortam degiskeniyle gecer; yolda ' gibi karakterler sorun cikarmaz.
:PSRUN
set "EBYS_A1=%~1"
set "EBYS_A2=%~2"
set "EBYS_A3=%~3"
set "EBYS_A4=%~4"
set "EBYS_A5=%~5"
set "EBYS_A6=%~6"
set "EBYS_A7=%~7"
set "EBYS_A8=%~8"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:EBYS_SELF);$c=($t -split '#PS-BEGIN')[-1];$q=@($env:EBYS_A1,$env:EBYS_A2,$env:EBYS_A3,$env:EBYS_A4,$env:EBYS_A5,$env:EBYS_A6,$env:EBYS_A7,$env:EBYS_A8);& ([scriptblock]::Create($c)) @q"
exit /b %errorlevel%

rem Script adresine erisim var mi? [uyari verir, islemi durdurmaz]
:NETKONTROL
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri $env:SCRIPT -UseBasicParsing -TimeoutSec 10; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [UYARI] Script adresine erisilemedi. Internet, proxy veya guvenlik
    echo         duvari engeli olabilir. Kurulum yine de denenecek.
    echo.
)
exit /b 0

rem Kurumsal ExtensionSettings politikasi uzantilari engelliyor mu? [Chrome/Edge]
:ENGELKONTROL
if not defined POLROOT exit /b 0
reg query "%POLROOT%" /v ExtensionSettings 2>nul | findstr /i "blocked" >nul
if errorlevel 1 exit /b 0
echo [UYARI] Kurumsal politika [ExtensionSettings] bazi uzantilari engelliyor
echo         olabilir. Kurulum basarisiz olursa BT birimine danisin.
echo.
exit /b 0

rem Firefox'un KULLANDIGI profili bulur: FFPROF [tam yol] veya bos
:FFPROFIL
set "FFPROF="
set "FFROOT=%APPDATA%\Mozilla\Firefox"
set "LASTP="
if exist "!FFROOT!\installs.ini" (
    for /f "usebackq tokens=1,* delims==" %%a in ("!FFROOT!\installs.ini") do (
        if /i "%%a"=="Default" if not defined FFPROF set "FFPROF=%%b"
    )
)
if not defined FFPROF if exist "!FFROOT!\profiles.ini" (
    for /f "usebackq tokens=1,* delims==" %%a in ("!FFROOT!\profiles.ini") do (
        if /i "%%a"=="Path" set "LASTP=%%b"
        if /i "%%a"=="Default" if "%%b"=="1" set "FFPROF=!LASTP!"
    )
)
if not defined FFPROF call :FFNEWEST
if not defined FFPROF exit /b 0
set "FFPROF=!FFPROF:/=\!"
if not "!FFPROF:~1,1!"==":" set "FFPROF=!FFROOT!\!FFPROF!"
exit /b 0

rem Ini dosyalarindan profil bulunamazsa en son kullanilan profili secer
:FFNEWEST
set "EBYS_P1=%UDATA%"
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "Get-ChildItem -Path (Join-Path $env:EBYS_P1 '*\prefs.js') | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty DirectoryName" 2^>nul`) do set "FFPROF=%%P"
exit /b 0

rem Tampermonkey tarayici profillerinde diskte kurulu mu? TMOK=1/0
:TMKONTROL
set "TMOK=0"
set "TMPROF="
if "%FF%"=="1" goto TMK_FF
for /d %%P in ("%UDATA%\*") do (
    if exist "%%~P\Extensions\%EXTID%\*" set "TMOK=1"
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
rem Sadece extensions.json icinde ETKIN [active] kayit varsa kurulu say
if not exist "%~1\extensions.json" exit /b 0
set "EBYS_P1=%~1"
powershell -NoProfile -Command "try { $j = Get-Content -Raw -LiteralPath (Join-Path $env:EBYS_P1 'extensions.json') | ConvertFrom-Json; $a = $j.addons | Where-Object { $_.id -eq 'firefox@tampermonkey.net' }; if ($a -and $a.active -and -not $a.userDisabled -and -not $a.appDisabled) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 exit /b 0
set "TMOK=1"
set "TMPROF=%~1"
exit /b 0

rem Tampermonkey kurulana kadar bekler. %1 = en fazla tur [her tur 3 sn]
rem 0: kuruldu, 1: zaman asimi, 2: kullanici atladi [S tusu]
:TMBEKLE
set /a TN=0
echo       Bekleniyor [atlamak icin S tusuna basin]
:TMB_DON
call :TMKONTROL
if "!TMOK!"=="1" (
    echo.
    exit /b 0
)
set /a TN+=1
if !TN! GEQ %1 (
    echo.
    exit /b 1
)
<nul set /p "=."
choice /c SN /t 3 /d N /n >nul
if errorlevel 2 goto TMB_DON
echo.
exit /b 2

rem EBYS Plus scripti Tampermonkey deposunda var mi? SCOK=1/0
rem En iyi caba denir; algilanamazsa E tusu ile onaylanir.
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

rem %1 = en fazla kac tur [her tur 3 sn]. Bulunursa veya E'ye basilirsa 0, aksi halde 1
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

rem Politika anahtarinin .reg yedegi. %1=yeni verilirse eski yedegin ustune yazar;
rem verilmezse ilk [orijinal] yedek korunur.
:YEDEKAL
reg query "%KEY%" >nul 2>&1
if errorlevel 1 exit /b 0
if not "%~1"=="yeni" if exist "%YEDEK%" exit /b 0
if not exist "%YEDEKDIR%" mkdir "%YEDEKDIR%" >nul 2>&1
reg export "%KEY%" "%YEDEK%" /y >nul 2>&1
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

rem Bu satirdan sonrasi PowerShell kodudur, batch buraya hic gelmez.
exit /b 0
#PS-BEGIN
$ErrorActionPreference = 'Stop'
$a = $args
try {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    # Yonetici komut satirina girecek degerlerde tehlikeli karakter olmamali
    function Safe([string]$s) {
        if ($s -match '[%"^]') { throw "Gecersiz karakter: $s" }
        return $s
    }

    function Get-HklmKey([string]$sub) {
        $b = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
        return $b.OpenSubKey($sub)
    }

    # Komutlari tek bir yukseltilmis cmd penceresinde calistirir. Komut satiri
    # UAC onayindan once sabitlenir; calisirken degistirilebilecek gecici dosya yoktur.
    function Invoke-Elevated([string[]]$cmds) {
        $cmdExe = Join-Path $env:SystemRoot 'System32\cmd.exe'
        $line = $cmds -join ' & '
        $p = Start-Process -FilePath $cmdExe -ArgumentList @('/d', '/c', $line) -Verb RunAs -Wait -PassThru -WindowStyle Hidden
        if (-not $p) { throw 'Yonetici islemi baslatilamadi.' }
    }

    function Open-Crx([string]$p) {
        $b = [IO.File]::ReadAllBytes($p)
        if ($b.Length -lt 16 -or [Text.Encoding]::ASCII.GetString($b, 0, 4) -ne 'Cr24') { throw "CRX dosyasi gecersiz: $p" }
        $v = [BitConverter]::ToUInt32($b, 4)
        if ($v -eq 3) { $s = 12 + [BitConverter]::ToUInt32($b, 8) }
        else { $s = 16 + [BitConverter]::ToUInt32($b, 8) + [BitConverter]::ToUInt32($b, 12) }
        $ms = New-Object IO.MemoryStream($b, [int]$s, [int]($b.Length - $s))
        return , (New-Object IO.Compression.ZipArchive($ms, [IO.Compression.ZipArchiveMode]::Read))
    }

    switch ($a[0]) {
        'ver' {
            $z = Open-Crx $a[1]
            $e = $z.GetEntry('manifest.json')
            if (-not $e) { throw 'manifest.json bulunamadi' }
            $r = New-Object IO.StreamReader($e.Open())
            $j = $r.ReadToEnd() | ConvertFrom-Json
            $r.Dispose(); $z.Dispose()
            Write-Output $j.version
        }
        'xml' {
            $x = "<?xml version='1.0' encoding='UTF-8'?>`n<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>`n  <app appid='$($a[1])'>`n    <updatecheck codebase='$($a[2])' version='$($a[3])' />`n  </app>`n</gupdate>`n"
            [IO.File]::WriteAllText($a[4], $x, (New-Object Text.UTF8Encoding($false)))
        }
        'unpack' {
            $z = Open-Crx $a[1]
            $d = [IO.Path]::GetFullPath($a[2])
            if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force }
            New-Item -ItemType Directory -Path $d -Force | Out-Null
            $root = $d.TrimEnd('\') + '\'
            foreach ($e in $z.Entries) {
                if ($e.FullName.StartsWith('_metadata') -or $e.FullName.EndsWith('/')) { continue }
                $t = [IO.Path]::GetFullPath((Join-Path $d ($e.FullName -replace '/', '\')))
                if (-not $t.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw "Gecersiz paket girdisi: $($e.FullName)" }
                $td = Split-Path $t -Parent
                if (-not (Test-Path -LiteralPath $td)) { New-Item -ItemType Directory -Path $td -Force | Out-Null }
                [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $t, $true)
            }
            $z.Dispose()
        }
        'polset' {
            # a1=anahtar a2=sira a3=deger a4=Firefox Uninstall anahtari a5=uzanti kimligi
            $sub = Safe $a[1]; $slot = Safe $a[2]; $val = Safe $a[3]; $un = Safe $a[4]; $ext = Safe $a[5]
            if (-not $sub -or -not $slot -or -not $val) { throw 'Eksik arguman.' }
            $cmds = New-Object System.Collections.ArrayList
            [void]$cmds.Add('reg add "HKLM\' + $sub + '" /v "' + $slot + '" /t REG_SZ /d "' + $val + '" /f /reg:64')
            if ($un -and $ext) {
                $k = Get-HklmKey $un
                if ($k) {
                    $names = @($k.GetValueNames())
                    $del = @($names | Where-Object { [string]$k.GetValue($_) -eq $ext })
                    foreach ($n in $del) { [void]$cmds.Add('reg delete "HKLM\' + $un + '" /v "' + (Safe $n) + '" /f /reg:64') }
                    if (($names.Count - $del.Count) -eq 0 -and $k.SubKeyCount -eq 0) { [void]$cmds.Add('reg delete "HKLM\' + $un + '" /f /reg:64') }
                    $k.Close()
                }
            }
            Invoke-Elevated $cmds.ToArray()
        }
        'poldel' {
            # a1=anahtar a2=sira a3=uzanti kimligi a4=eslesme metni a5=Firefox Uninstall anahtari a6=klasor a7=ust klasor
            $sub = Safe $a[1]; $slot = Safe $a[2]; $ext = Safe $a[3]; $mt = Safe $a[4]; $un = Safe $a[5]; $dir = Safe $a[6]; $par = Safe $a[7]
            $cmds = New-Object System.Collections.ArrayList
            $k = Get-HklmKey $sub
            if ($k) {
                $names = @($k.GetValueNames())
                $del = New-Object System.Collections.ArrayList
                foreach ($n in $names) {
                    $v = [string]$k.GetValue($n)
                    $hit = $false
                    if ($mt -and $v.IndexOf($mt, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $hit = $true }
                    if ($slot -and $ext -and $n -eq $slot -and $v.StartsWith($ext + ';', [StringComparison]::OrdinalIgnoreCase)) { $hit = $true }
                    if ($hit) { [void]$del.Add($n) }
                }
                foreach ($n in $del) { [void]$cmds.Add('reg delete "HKLM\' + $sub + '" /v "' + (Safe $n) + '" /f /reg:64') }
                if (($names.Count - $del.Count) -eq 0 -and $k.SubKeyCount -eq 0) { [void]$cmds.Add('reg delete "HKLM\' + $sub + '" /f /reg:64') }
                $k.Close()
            }
            if ($un -and $ext) {
                $u = Get-HklmKey $un
                $has = $false; $i = 1
                if ($u) {
                    foreach ($n in $u.GetValueNames()) { if ([string]$u.GetValue($n) -eq $ext) { $has = $true } }
                    while ($null -ne $u.GetValue([string]$i)) { $i++ }
                    $u.Close()
                }
                if (-not $has) { [void]$cmds.Add('reg add "HKLM\' + $un + '" /v "' + $i + '" /t REG_SZ /d "' + $ext + '" /f /reg:64') }
            }
            if ($dir) {
                if ($dir -notlike '*\EBYS-Plus\*') { throw "Guvensiz klasor: $dir" }
                [void]$cmds.Add('rmdir /s /q "' + $dir + '" 2>nul')
                if ($par -and $par -like '*\EBYS-Plus') { [void]$cmds.Add('rmdir "' + $par + '" 2>nul') }
            }
            if ($cmds.Count -gt 0) { Invoke-Elevated $cmds.ToArray() }
        }
        'unclean' {
            # a1=Firefox Uninstall anahtari a2=uzanti kimligi
            $un = Safe $a[1]; $ext = Safe $a[2]
            if ($un -and $ext) {
                $k = Get-HklmKey $un
                if ($k) {
                    $cmds = New-Object System.Collections.ArrayList
                    $names = @($k.GetValueNames())
                    $del = @($names | Where-Object { [string]$k.GetValue($_) -eq $ext })
                    foreach ($n in $del) { [void]$cmds.Add('reg delete "HKLM\' + $un + '" /v "' + (Safe $n) + '" /f /reg:64') }
                    if ($del.Count -gt 0 -and ($names.Count - $del.Count) -eq 0 -and $k.SubKeyCount -eq 0) { [void]$cmds.Add('reg delete "HKLM\' + $un + '" /f /reg:64') }
                    $k.Close()
                    if ($cmds.Count -gt 0) { Invoke-Elevated $cmds.ToArray() }
                }
            }
        }
        default { throw "bilinmeyen komut: $($a[0])" }
    }
} catch {
    [Console]::Error.WriteLine('[HATA] ' + $_.Exception.Message)
    exit 1
}