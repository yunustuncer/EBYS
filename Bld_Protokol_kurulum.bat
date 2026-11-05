@echo off
rem ============================================================
rem  Belediye Protokol - Kur / Kaldir  (Emvalis)
rem  Surum 1.0
rem  Belediye Protokol uzantisini [kodunu GitHub'dan kendi guncelleyen] Chrome /
rem  Edge / Firefox tarayicilarina kurar veya kaldirir. Uzanti paketi
rem  GitHub deposundan indirilir; Tampermonkey KULLANILMAZ.
rem
rem  Domain/kurumsal yonetim algilama, sessiz mod, durum/tani ekrani,
rem  SHA256 dogrulama ve proxy destekli indirme icerir.
rem
rem  Sessiz kullanim [BT / GPO baslangic betigi / yonetici konsolu]:
rem    Bld_Protokol_kurulum.bat /oto            hepsi: Chrome Edge Firefox
rem    Bld_Protokol_kurulum.bat /oto chrome     tek tarayici [edge, firefox]
rem    Bld_Protokol_kurulum.bat /oto-kaldir     politika kaydini kaldirir
rem  Sessiz mod uzanti politikasini yazar; uzanti tarayicinin bir sonraki
rem  acilisinda kendiliginden yuklenir. Soru sormaz, tarayiciyi kapatmaz.
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
rem Windows Terminal pencere konumlandirmaya izin vermez; klasik konsolda yeniden baslat
if defined WT_SESSION if not defined EBYS_CON if exist "%SystemRoot%\System32\conhost.exe" (
    set "EBYS_CON=1"
    start "" conhost.exe cmd.exe /d /c ""!BATFULL!" %*"
    exit /b 0
)

set "OLDCP="
for /f "tokens=2 delims=:." %%c in ('chcp') do set "OLDCP=%%c"
if defined OLDCP set "OLDCP=!OLDCP: =!"
chcp 65001 >nul
title Emvalis - Belediye Protokol - Kur / Kaldir
color 0B

set "VER=1.0"
rem Uzantinin cekecegi kod dosyasi [sadece erisim kontrolu icin]
set "SCRIPT=https://raw.githubusercontent.com/yunustuncer/EBYS/refs/heads/main/Bld_Protokol_Modiye.user.js"
set "RAW=https://raw.githubusercontent.com/yunustuncer/EBYS/refs/heads/main"
set "EBYS=https://ebelediye.turkoglu.bel.tr/Tapu"
rem SHA256 sabitleme [ONERILIR]: paket dosyalarinin ozetini yazarsaniz, GitHub deposu
rem degisse bile farkli dosya yonetici yetkisiyle kurulmaz. Bos birakilirsa
rem dogrulama yapilmaz. Hesaplamak icin: certutil -hashfile DOSYA SHA256
set "HASH_CHROME="
set "HASH_FIREFOX="
set "HASH_EDGE="
set "PDIR=%ProgramData%\Bld-Protokol"
set "PDIRU=%ProgramData:\=/%/Bld-Protokol"
set "LOGDIR=%LOCALAPPDATA%\Bld-Protokol"
set "LOGFILE=%LOGDIR%\bld-protokol.log"
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
call :YONETIMKONTROL
call :LOG "Yonetim: !MGMT!"
for /f "tokens=*" %%v in ('ver') do call :LOG "Windows: %%v"
set "AUTO=0"
set "AUTOMOD=KUR"
if /i "%~1"=="/oto" set "AUTO=1"
if /i "%~1"=="/oto-kaldir" set "AUTO=1" & set "AUTOMOD=KALDIR"
if "!AUTO!"=="1" goto OTOMATIK

rem Konsolu sag kenara sabitle [her zaman ustte]; tarayici icin kalan alani hesapla
mode con: cols=58 lines=30 >nul 2>&1
set "GEOX="
set "GEO="
call :PSRUN geo >"%TEMP%\ebys_geo.txt" 2>nul
if exist "%TEMP%\ebys_geo.txt" set /p GEO=<"%TEMP%\ebys_geo.txt"
del "%TEMP%\ebys_geo.txt" >nul 2>&1
if defined GEO for /f "tokens=1-4" %%a in ("!GEO!") do (set "GEOX=%%a" & set "GEOY=%%b" & set "GEOW=%%c" & set "GEOH=%%d")

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
echo                  Belediye Protokol  -  Kur / Kaldir   v!VER!
echo ============================================================
echo   Bilgisayar: !MGMTTXT!
echo.
echo   [1] KUR      Belediye Protokol uzantisi + site girisi
echo   [2] KALDIR   Belediye Protokol uzantisini kaldir
echo   [3] DURUM    Neyin kurulu oldugunu goster [tani]
echo   [0] Cikis
echo.
choice /c 1230 /n /m "Seciminiz: "
if errorlevel 4 goto CIKIS
if errorlevel 3 goto TANI
if errorlevel 2 goto SEC_KALDIR
set "MOD=KUR"
goto TARAYICISEC
:SEC_KALDIR
set "MOD=KALDIR"

:TARAYICISEC
set "KAPATIZIN=0"
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
set "UNPACKED=0"
set "SRC="
cls
echo ============================================================
echo   KURULUM - !BNAME!
echo ============================================================
echo.
call :ENGELKONTROL
echo [1/3] Uzanti paketi hazirlaniyor...
call :KAYNAKBUL
if not defined SRC goto KUR_PAKETYOK
echo       [OK] Paket hazir.
call :NETKONTROL
call :TMKONTROL
call :DURUM
set "SAME=0"
if "!TMOK!"=="1" if "!FOUND!"=="1" call :SURUMAYNI
if "!SAME!"=="1" (
    echo       [OK] Belediye Protokol bu tarayicida zaten kurulu ve guncel.
    call :LOG "Uzanti zaten kurulu"
    goto KUR_ACEBYS
)
if "!FF!"=="0" if "!MGMT!"=="YOK" goto KUR_YONETILMEYEN

:KUR_YEREL
echo.
echo [2/3] Kurumsal politika yaziliyor...
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
echo.
echo [3/3] !BNAME! aciliyor, uzanti yukleniyor...
call :BASLAT "!PAGE!"
call :TMBEKLE 40
if errorlevel 1 goto KUR_BASARISIZ
echo       [OK] Belediye Protokol uzantisi kuruldu ve dogrulandi.
call :LOG "Uzanti kuruldu"
goto KUR_ACEBYS

:KUR_YONETILMEYEN
call :LOG "Yonetilmeyen bilgisayar: Chrome/Edge yerel politika riskli"
echo.
echo [UYARI] Bu bilgisayar domain veya kurumsal yonetime bagli degil.
echo         !BNAME!, disaridan eklenen uzantiyi politikayla kurmayi
echo         cogu zaman REDDEDER. Firefox bu kisitlamadan etkilenmez.
echo.
echo   [1] Elle kurulum: Paketlenmemis yukle [guvenilir, onerilen]
echo   [2] Yine de politika ile dene
echo   [0] Geri
echo.
choice /c 120 /n /t 20 /d 1 /m "Seciminiz [20 sn sonra 1]: "
if errorlevel 3 goto MENU
if errorlevel 2 goto KUR_YEREL
goto KUR_UNPACK

:KUR_PAKETYOK
echo.
echo [HATA] Uzanti paketi bulunamadi: !SRCNAME!
if "!FF!"=="1" (
    echo        Firefox icin IMZALI paket gerekir. Imzali .xpi dosyasini
    echo        GitHub deposuna [Bld_Protokol_Modiye.xpi adiyla] yukleyin.
)
echo        Dosyayi su klasore koyun veya internet baglantisini kontrol edin:
echo        !BATDIR!
echo.
call :LOG "Paket bulunamadi: !SRCNAME!"
pause
goto MENU

:KUR_BASARISIZ
echo.
echo [HATA] Uzanti otomatik kurulamadi.
call :LOG "Uzanti kurulamadi"
echo        Olasi nedenler: tarayici uzantiyi henuz yuklememis, bilgisayar
echo        kurumsal yonetime bagli degil veya BT politikasi uzantilari
echo        engelliyor.
echo.
echo   [1] Politika durumunu goster [!POLPAGE!]
echo   [2] Elle kurulum: Paketlenmemis yukle
echo   [0] Menu
echo.
choice /c 120 /n /m "Seciminiz: "
if errorlevel 3 goto MENU
if errorlevel 2 goto KUR_UNPACK
call :BASLAT "!POLPAGE!"
echo.
echo   Acilan sayfada Politikalari yeniden yukle dugmesine basin;
echo   uzanti birkac dakika icinde yuklenir. Sonra bu araci tekrar
echo   calistirabilirsiniz.
echo.
pause
goto MENU

:KUR_UNPACK
if "!FF!"=="1" (
    echo.
    echo [HATA] Firefox icin elle kurulum desteklenmiyor. Imzali .xpi gerekir.
    pause
    goto MENU
)
if not defined SRC call :KAYNAKBUL
if not defined SRC goto KUR_PAKETYOK
set "UDIR=%LOCALAPPDATA%\Bld-Protokol\!BKEY!-paket"
call :PSRUN unpack "!SRC!" "!UDIR!"
if errorlevel 1 (
    echo [HATA] Paket acilamadi.
    pause
    goto MENU
)
<nul set /p "=!UDIR!" | clip
call :BASLAT "!PAGE!"
echo.
echo ------------------------------------------------------------
echo   ELLE YUKLEME
echo ------------------------------------------------------------
echo   1. Acilan sayfanin sag ustunden "Gelistirici modu" acin.
echo   2. "Paketlenmemis oge yukle" [Load unpacked] dugmesine basin.
echo   3. Su klasoru secin [adres panoya kopyalandi]:
echo      !UDIR!
echo   4. Bu klasoru sonradan silmeyin veya tasimayin.
echo ------------------------------------------------------------
echo.
pause
set "UNPACKED=1"
call :LOG "Paketlenmemis yukleme yonergesi verildi"

:KUR_ACEBYS
echo.
echo       Uzanti ilk ayarlarini yapiyor, birkac saniye bekleniyor...
timeout /t 10 /nobreak >nul
echo       Site aciliyor...
call :BASLAT "!EBYS!"
echo.
echo   [OK] Kurulum tamamlandi.
echo   Belediye Protokol simgesi tarayicinin arac cubugundadir [gorunmuyorsa
echo   bulmaca simgesinden sabitleyin]. Kaldirmak icin [2] KALDIR.
call :LOG "Kurulum tamamlandi, EBYS acildi"
goto BITIS

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
    echo Belediye Protokol elle kurulmus; tarayicinin uzantilar sayfasindan
    echo kaldirabilirsiniz.
)
echo.
pause
goto MENU

:KALDIR_ONAY
echo Belediye Protokol zorunlu kurulum kaydi silinecek [varsa eski Tampermonkey
echo kaydi da dahil]. Diger politikalariniza dokunulmaz. Tarayici
echo yeniden acildiginda uzanti kaldirilmis olur.
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
call :BASLAT "!PAGE!"

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
echo.
echo   [OK] Kaldirma tamamlandi.
goto BITIS

:BITIS
echo.
choice /c MX /n /t 10 /d X /m "[M] Menu   [X] Cikis   [10 sn sonra kapanir]: "
if errorlevel 2 goto CIKIS
goto MENU

:CIKIS
call :LOG "Oturum bitti"
del "%EBYS_SELF%" >nul 2>&1
if defined OLDCP chcp !OLDCP! >nul
endlocal
endlocal
exit /b 0

rem ============================================================
rem  SESSIZ MOD  [/oto  veya  /oto-kaldir]
rem  Soru sormaz, tarayiciyi kapatmaz. Sadece uzanti politikasini
rem  yazar/siler. Cikis kodu: 0 tamam, 1 hata, 2 kurulum dosyasi yok.
rem ============================================================
:OTOMATIK
set "AUTOLIST="
set "AUTOARG=%~2"
if /i "!AUTOARG!"=="chrome" set "AUTOLIST=1"
if /i "!AUTOARG!"=="firefox" set "AUTOLIST=2"
if /i "!AUTOARG!"=="edge" set "AUTOLIST=3"
if not defined AUTOLIST set "AUTOLIST=1 3 2"
set "AUTORC=0"
call :LOG "SESSIZ MOD: !AUTOMOD! liste=!AUTOLIST! yonetim=!MGMT!"
:OTO_DON
if not defined AUTOLIST goto OTO_BITTI
for /f "tokens=1,*" %%a in ("!AUTOLIST!") do (
    set "AUTOCUR=%%a"
    set "AUTOLIST=%%b"
)
call :AYAR !AUTOCUR!
call :EXEBUL
if not defined BEXE (
    call :LOG "OTO: !BNAME! bulunamadi, atlandi"
    goto OTO_DON
)
if "!AUTOMOD!"=="KALDIR" (
    call :OTO_KALDIR
) else (
    call :OTO_KUR
)
goto OTO_DON

:OTO_BITTI
call :LOG "SESSIZ MOD bitti, cikis kodu !AUTORC!"
del "%EBYS_SELF%" >nul 2>&1
if defined OLDCP chcp !OLDCP! >nul
exit /b !AUTORC!

:OTO_KUR
call :TMKONTROL
call :DURUM
set "SAME=0"
call :KAYNAKBUL
if "!TMOK!"=="1" if "!FOUND!"=="1" if defined SRC call :SURUMAYNI
if "!SAME!"=="1" (
    call :LOG "OTO: !BNAME! Belediye Protokol zaten kurulu ve guncel"
    exit /b 0
)
if "!FF!"=="0" if "!MGMT!"=="YOK" call :LOG "OTO UYARI: yonetilmeyen bilgisayar, !BNAME! politikayi reddedebilir"
if not defined SRC (
    call :LOG "OTO: !BNAME! paket bulunamadi veya indirilemedi: !SRCNAME!"
    set "AUTORC=2"
    exit /b 0
)
call :POLITIKAYAZ yerel
if errorlevel 1 (
    set "AUTORC=1"
    call :LOG "OTO: !BNAME! politika yazilamadi"
) else (
    call :LOG "OTO: !BNAME! politika yazildi"
)
exit /b 0

:OTO_KALDIR
call :DURUM
if not "!FOUND!"=="1" (
    call :LOG "OTO: !BNAME! kaldirilacak kayit yok"
    exit /b 0
)
call :YEDEKAL yeni
call :POLITIKASIL
if errorlevel 1 (
    set "AUTORC=1"
    call :LOG "OTO: !BNAME! kayit silinemedi"
) else (
    call :LOG "OTO: !BNAME! kayit silindi"
)
exit /b 0

rem ============================================================
rem  DURUM / TANI  [destek icin: ekrani gormeniz yeterli]
rem ============================================================
:TANI
cls
echo ============================================================
echo   DURUM / TANI
echo ============================================================
echo.
echo   Bilgisayar : !MGMTTXT!
echo   Gunluk     : !LOGFILE!
echo.
call :PSRUN head "%SCRIPT%" >nul 2>&1
if errorlevel 1 (
    echo   GitHub     : ERISILEMIYOR [internet / proxy / guvenlik duvari]
) else (
    echo   GitHub     : kod dosyasina erisilebiliyor
)
echo.
for %%B in (1 2 3) do call :TANI_TARAYICI %%B
call :LOG "TANI gosterildi"
pause
goto MENU

:TANI_TARAYICI
call :AYAR %1
call :EXEBUL
echo   --- !BNAME! ---
if not defined BEXE (
    echo   Tarayici          : kurulu degil
    echo.
    exit /b 0
)
call :TMKONTROL
call :DURUM
set "T1=YOK"
set "T2=YOK"
if "!TMOK!"=="1" set "T1=VAR"
if "!FOUND!"=="1" set "T2=VAR"
echo   Belediye Protokol uzantisi: !T1!
echo   Zorunlu kurulum   : !T2!
echo.
call :LOG "TANI !BNAME!: UZANTI=!T1! POLITIKA=!T2!"
exit /b 0

rem ============================================================
rem  ALT PROGRAMLAR
rem ============================================================

rem Bilgisayar domain / Azure AD / MDM ile yonetiliyor mu? MGMT, MGMTTXT
rem Chrome ve Edge, magaza disi uzantiyi politikayla sadece yonetilen
rem bilgisayarlarda kurar; Firefox her bilgisayarda kurar.
:YONETIMKONTROL
set "MGMT=YOK"
set "MGMTTXT=Kurumsal yonetim yok"
dsregcmd /status 2>nul | findstr /r /i /c:"DomainJoined *: *YES" >nul
if not errorlevel 1 (
    set "MGMT=DOMAIN"
    set "MGMTTXT=Domain'e bagli"
    exit /b 0
)
dsregcmd /status 2>nul | findstr /r /i /c:"AzureAdJoined *: *YES" >nul
if not errorlevel 1 (
    set "MGMT=AAD"
    set "MGMTTXT=Azure AD bagli"
    exit /b 0
)
dsregcmd /status 2>nul | findstr /r /i /c:"MdmUrl *: *http" >nul
if not errorlevel 1 (
    set "MGMT=MDM"
    set "MGMTTXT=MDM ile yonetiliyor"
    exit /b 0
)
exit /b 0

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
set "SRCNAME=Bld_Protokol_Modiye.crx"
set "SRCPAT=*Bld_Protokol*.crx"
set "SRCHASH=%HASH_CHROME%"
set "PROC=chrome.exe"
set "KEYSUB=SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist"
set "POLROOT=HKLM\SOFTWARE\Policies\Google\Chrome"
set "EXTID=mmndgbmdpaehlheflicpjmmdlpkilale"
set "UDATA=%LOCALAPPDATA%\Google\Chrome\User Data"
set "PAGE=chrome://extensions"
set "POLPAGE=chrome://policy"
set "EXTPAGE=chrome://extensions/?id=mmndgbmdpaehlheflicpjmmdlpkilale"
goto AYAR_SON
:AYAR2
set "BNAME=Firefox"
set "BKEY=firefox"
set "SRCNAME=Bld_Protokol_Modiye.xpi"
set "SRCPAT=*Bld_Protokol*.xpi"
set "SRCHASH=%HASH_FIREFOX%"
set "FF=1"
set "PROC=firefox.exe"
set "KEYSUB=SOFTWARE\Policies\Mozilla\Firefox\Extensions\Install"
set "KEYUNSUB=SOFTWARE\Policies\Mozilla\Firefox\Extensions\Uninstall"
set "EXTID=belediye-protokol@tkgm.local"
set "UDATA=%APPDATA%\Mozilla\Firefox\Profiles"
set "PAGE=about:addons"
set "POLPAGE=about:policies"
set "EXTPAGE=about:addons"
goto AYAR_SON
:AYAR3
set "BNAME=Edge"
set "BKEY=edge"
set "SRCNAME=Bld_Protokol_Modiye.crx"
set "SRCPAT=*Bld_Protokol*.crx"
set "SRCHASH=%HASH_EDGE%"
set "PROC=msedge.exe"
set "KEYSUB=SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist"
set "POLROOT=HKLM\SOFTWARE\Policies\Microsoft\Edge"
set "EXTID=mmndgbmdpaehlheflicpjmmdlpkilale"
set "UDATA=%LOCALAPPDATA%\Microsoft\Edge\User Data"
set "PAGE=edge://extensions"
set "POLPAGE=edge://policy"
set "EXTPAGE=edge://extensions/?id=mmndgbmdpaehlheflicpjmmdlpkilale"
:AYAR_SON
set "KEY=HKLM\%KEYSUB%"
set "KEYUN="
if defined KEYUNSUB set "KEYUN=HKLM\%KEYUNSUB%"
set "MARKER=%PDIR%\%BKEY%\slot.txt"
set "YEDEKDIR=%LOCALAPPDATA%\Bld-Protokol\yedek"
set "YEDEK=%YEDEKDIR%\bld-protokol-yedek-%BNAME%.reg"
rem Politika kayitlarini sadece bu aracin yazdigi kayitlardan ayirt etmek icin
set "MATCH=Bld-Protokol"
set "BARGS="
if not defined GEOX goto AYAR_FIN
if "%FF%"=="1" goto AYAR_FIN
set "BARGS=--window-position=!GEOX!,!GEOY! --window-size=!GEOW!,!GEOH!"
goto AYAR_FIN
:AYAR_FIN
exit /b 0

rem Tarayiciyi konsolun yanina acar. %1 = adres
:BASLAT
set "ARGS_NOW=!BARGS!"
set "YENIPENCERE=1"
tasklist /fi "imagename eq %PROC%" 2>nul | find /i "%PROC%" >nul
if not errorlevel 1 (
    set "ARGS_NOW="
    set "YENIPENCERE=0"
)
start "" "!BEXE!" !ARGS_NOW! "%~1"
if "!YENIPENCERE!"=="1" if defined GEOX call :PSRUN yerles "!PROC:.exe=!" "!GEOX!" "!GEOY!" "!GEOW!" "!GEOH!" >nul 2>&1
exit /b 0



rem Tarayiciyi once nazikce kapatir [verileri yazsin], kapanmazsa zorla. Onay sormaz.
:KAPATSESSIZ
tasklist /fi "imagename eq %PROC%" 2>nul | find /i "%PROC%" >nul
if errorlevel 1 exit /b 0
taskkill /im %PROC% >nul 2>&1
set /a KS=0
:KS_BEKLE
tasklist /fi "imagename eq %PROC%" 2>nul | find /i "%PROC%" >nul
if errorlevel 1 goto KS_BITTI
set /a KS+=1
if !KS! GEQ 6 (
    taskkill /f /im %PROC% >nul 2>&1
    goto KS_BITTI
)
timeout /t 1 /nobreak >nul
goto KS_BEKLE
:KS_BITTI
timeout /t 1 /nobreak >nul
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

rem Uzanti paketi: once bat ile ayni klasorde aranir, yoksa GitHub deposundan indirilir.
rem Indirme: proxy destekli, 3 deneme, SHA256 dogrulamali. SRC
:KAYNAKBUL
set "SRC="
if exist "%BATDIR%%SRCNAME%" set "SRC=%BATDIR%%SRCNAME%"
if defined SRC goto KB_HASH
for %%F in ("%BATDIR%%SRCPAT%") do if not defined SRC set "SRC=%%~fF"
if defined SRC goto KB_HASH
set "DLDIR=%TEMP%\Bld-Protokol-indirme"
if not exist "%DLDIR%" mkdir "%DLDIR%" >nul 2>&1
del "%DLDIR%\%SRCNAME%" >nul 2>&1
echo       Paket indiriliyor...
call :PSRUN get "%RAW%/%SRCNAME%" "%DLDIR%\%SRCNAME%" "!SRCHASH!"
if errorlevel 1 (
    echo       [UYARI] Indirilemedi veya dogrulanamadi. Internet, proxy, guvenlik
    echo               duvari engeli ya da dosya ozeti uyusmazligi olabilir.
    call :LOG "Indirme basarisiz veya hash uyusmadi: !SRCNAME!"
    del "%DLDIR%\%SRCNAME%" >nul 2>&1
    exit /b 0
)
for %%S in ("%DLDIR%\%SRCNAME%") do if %%~zS LSS 5000 del "%DLDIR%\%SRCNAME%" >nul 2>&1
if exist "%DLDIR%\%SRCNAME%" set "SRC=%DLDIR%\%SRCNAME%"
if defined SRC call :LOG "Indirildi: !SRCNAME!"
exit /b 0

rem Bat ile ayni klasorden gelen dosya icin SHA256 kontrolu [hash tanimliysa]
:KB_HASH
if not defined SRCHASH exit /b 0
call :PSRUN hash "!SRC!" "!SRCHASH!" >nul
if errorlevel 1 (
    echo       [HATA] Yerel dosyanin SHA256 degeri beklenenle uyusmuyor, reddedildi:
    echo              !SRC!
    call :LOG "Yerel dosya hash uyusmadi: !SRC!"
    set "SRC="
)
exit /b 0

rem Politika kaydini yazar. Paketi ProgramData altina kopyalar. Basari 0, hata 1
:POLITIKAYAZ
set "DST=%PDIR%\%BKEY%"
if not exist "%DST%" mkdir "%DST%" >nul 2>&1
set "COPYNAME=Bld_Protokol_Modiye.crx"
if "%FF%"=="1" set "COPYNAME=Bld_Protokol_Modiye.xpi"
del "%DST%\tampermonkey.crx" "%DST%\tampermonkey.xpi" >nul 2>&1
copy /y "%SRC%" "%DST%\%COPYNAME%" >nul 2>&1
if not exist "%DST%\%COPYNAME%" (
    echo [HATA] Dosya klasore kopyalanamadi: !DST!
    echo        Bu araci yonetici olarak calistirmayi deneyin.
    exit /b 1
)
if "%FF%"=="1" (
    set "POLVAL=!DST!\Bld_Protokol_Modiye.xpi"
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
call :PSRUN xml "%EXTID%" "file:///%PDIRU%/%BKEY%/Bld_Protokol_Modiye.crx" "!TMVER!" "%DST%\update.xml"
if errorlevel 1 (
    echo [HATA] update.xml olusturulamadi.
    exit /b 1
)
set "POLVAL=%EXTID%;file:///%PDIRU%/%BKEY%/update.xml"

:PY_YAZ
call :SLOTBUL
call :YEDEKAL
echo       Yonetici onayi bekleniyor [UAC]...
call :PSRUN polset "%KEYSUB%" "!SLOT!" "!POLVAL!" "%KEYUNSUB%" "%EXTID%"
if errorlevel 1 (
    echo [HATA] Yonetici islemi tamamlanamadi. Izni reddetmis olabilirsiniz.
    call :LOG "polset basarisiz"
    exit /b 1
)
reg query "%KEY%" /v !SLOT! 2>nul | findstr /i /c:"%EXTID%" /c:"%MATCH%" >nul
if errorlevel 1 (
    echo [HATA] Kayit defterine yazilamadi. Yonetici iznini reddetmis olabilirsiniz.
    call :LOG "Politika yazilamadi"
    exit /b 1
)
>"%MARKER%" echo !SLOT!
echo       [OK] Politika yazildi.
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
    reg query "%KEY%" /v !MSLOT! 2>nul | findstr /i /c:"%EXTID%" /c:"%MATCH%" >nul
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

rem Paketteki surum, kurulu paketle [update.xml] ayni mi? SAME=1/0
:SURUMAYNI
set "SAME=0"
if "!FF!"=="1" (
    set "SAME=1"
    exit /b 0
)
if not exist "%PDIR%\%BKEY%\update.xml" exit /b 0
set "NEWV="
call :PSRUN ver "!SRC!" >"%TEMP%\ebys_ver2.txt" 2>nul
set /p NEWV=<"%TEMP%\ebys_ver2.txt"
del "%TEMP%\ebys_ver2.txt" >nul 2>&1
if not defined NEWV exit /b 0
findstr /c:"version='!NEWV!'" "%PDIR%\%BKEY%\update.xml" >nul 2>&1
if not errorlevel 1 set "SAME=1"
exit /b 0

rem Bu aracin politika kaydi var mi? FOUND=1/0, MSLOT=isaretli sira
:DURUM
set "FOUND=0"
set "MSLOT="
if exist "%MARKER%" set /p MSLOT=<"%MARKER%"
for /f "tokens=1" %%a in ('reg query "%KEY%" 2^>nul ^| findstr /i "%MATCH%"') do set "FOUND=1"
if defined MSLOT (
    reg query "%KEY%" /v !MSLOT! 2>nul | findstr /i /c:"%EXTID%" /c:"%MATCH%" >nul
    if not errorlevel 1 set "FOUND=1"
)
exit /b 0

rem Politika kaydini ve dosyalarini siler. Basari 0, hata 1
:POLITIKASIL
call :DURUM
echo       Yonetici onayi bekleniyor [UAC]...
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

rem Uzantinin cekecegi kod adresine erisim var mi? [uyari verir, islemi durdurmaz]
:NETKONTROL
call :PSRUN head "%SCRIPT%" >nul 2>&1
if errorlevel 1 (
    echo [UYARI] Kod adresine erisilemedi [raw.githubusercontent.com]. Internet,
    echo         proxy veya guvenlik duvari engeli olabilir. Uzanti kurulur
    echo         ama kod indirilene kadar calismaz.
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

rem Belediye Protokol uzantisi tarayici profillerinde diskte kurulu mu? TMOK=1/0
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
if defined FFPROF call :TMK_FFPROFIL "!FFPROF!"
if "!TMOK!"=="1" exit /b 0
for /d %%P in ("%UDATA%\*") do if not "!TMOK!"=="1" call :TMK_FFPROFIL "%%~P"
exit /b 0
:TMK_FFPROFIL
rem Sadece extensions.json icinde ETKIN [active] kayit varsa kurulu say
if not exist "%~1\extensions.json" exit /b 0
set "EBYS_P1=%~1"
powershell -NoProfile -Command "try { $j = Get-Content -Raw -LiteralPath (Join-Path $env:EBYS_P1 'extensions.json') | ConvertFrom-Json; $a = $j.addons | Where-Object { $_.id -eq 'belediye-protokol@tkgm.local' }; if ($a -and $a.active -and -not $a.userDisabled -and -not $a.appDisabled) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 exit /b 0
set "TMOK=1"
set "TMPROF=%~1"
exit /b 0

rem Uzanti kurulana kadar bekler. %1 = en fazla tur [her tur 2 sn]
rem 0: kuruldu, 1: zaman asimi, 2: kullanici atladi [S tusu]
:TMBEKLE
set /a TN=0
echo       Uzantinin yuklenmesi bekleniyor
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
timeout /t 2 /nobreak >nul
goto TMB_DON

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
if "!KAPATIZIN!"=="1" goto KAPAT_ZORLA
echo.
echo %BNAME% acik. Degisikligin uygulanmasi icin kapatilip yeniden
echo acilmasi gerekiyor. Kaydedilmemis formlariniz varsa once kaydedin.
if "!MGMT!"=="YOK" (
    choice /c EH /n /m "%BNAME% simdi kapatilsin mi? [E/H]: "
) else (
    choice /c EH /n /t 15 /d E /m "%BNAME% kapatilsin mi? 15 sn sonra otomatik EVET [E/H]: "
)
if errorlevel 2 exit /b 1
set "KAPATIZIN=1"
:KAPAT_ZORLA
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
$ProgressPreference = 'SilentlyContinue'
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

    function Test-Admin {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        $pr = New-Object Security.Principal.WindowsPrincipal($id)
        return $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    }

    # TLS 1.2 [varsa 1.3] ve sistem proxy'si [kimlik bilgisiyle]
    function Net-Setup {
        try { [Net.ServicePointManager]::SecurityProtocol = 3072 -bor 12288 }
        catch { [Net.ServicePointManager]::SecurityProtocol = 3072 }
        $px = [Net.WebRequest]::GetSystemWebProxy()
        $px.Credentials = [Net.CredentialCache]::DefaultCredentials
        [Net.WebRequest]::DefaultWebProxy = $px
    }

    function Get-Sha256([string]$p) {
        $sha = [Security.Cryptography.SHA256]::Create()
        $fs = [IO.File]::OpenRead($p)
        try { return ([BitConverter]::ToString($sha.ComputeHash($fs))).Replace('-', '') }
        finally { $fs.Close(); $sha.Dispose() }
    }

    # Komutlari tek bir yukseltilmis cmd penceresinde calistirir. Komut satiri
    # UAC onayindan once sabitlenir; calisirken degistirilebilecek gecici dosya yoktur.
    function Invoke-Elevated([string[]]$cmds) {
        $cmdExe = Join-Path $env:SystemRoot 'System32\cmd.exe'
        $line = $cmds -join ' & '
        if (Test-Admin) {
            # Zaten yonetici [GPO baslangic betigi, yonetici konsolu]: UAC gerekmez
            $p = Start-Process -FilePath $cmdExe -ArgumentList @('/d', '/c', $line) -Wait -PassThru -WindowStyle Hidden
        } else {
            $p = Start-Process -FilePath $cmdExe -ArgumentList @('/d', '/c', $line) -Verb RunAs -Wait -PassThru -WindowStyle Hidden
        }
        if (-not $p) { throw 'Yonetici islemi baslatilamadi.' }
    }

    function Load-Win {
        Add-Type -AssemblyName System.Windows.Forms
        if (-not ('EbysWin' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class EbysWin {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
}
'@
        }
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
        'geo' {
            Load-Win
            $wa = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
            $ch = [EbysWin]::GetConsoleWindow()
            $conW = 520    # konsol genisligi [piksel] - istedigin gibi degistir
            $conH = 600    # konsol yuksekligi [piksel] - istedigin gibi degistir
            $cw = 0
            if ($ch -ne [IntPtr]::Zero) {
                $conH = [Math]::Min($conH, $wa.Height)
                $r = New-Object EbysWin+RECT
                for ($i = 0; $i -lt 10; $i++) {
                    [void][EbysWin]::SetWindowPos($ch, [IntPtr](-1), $wa.Left, $wa.Top, $conW, $conH, 0x0040)
                    Start-Sleep -Milliseconds 150
                    [void][EbysWin]::GetWindowRect($ch, [ref]$r)
                    if ([Math]::Abs($r.L - $wa.Left) -le 8 -and [Math]::Abs($r.T - $wa.Top) -le 8) { break }
                }
                $cw = $conW
            }
            $bw = [int][Math]::Min($wa.Width - $cw - 8, $wa.Width * 0.5)
            if ($bw -lt 400) { $bw = [int]($wa.Width * 0.5) }
            $bh = [int]($wa.Height * 0.7)
            Write-Output ("{0} {1} {2} {3}" -f ($wa.Right - $bw), $wa.Top, $bw, $bh)
        }
        'yerles' {
            # a1=islem adi a2..a5 = x y genislik yukseklik
            Load-Win
            $x = [int]$a[2]; $y = [int]$a[3]; $w = [int]$a[4]; $hh = [int]$a[5]
            if ($w -gt 0 -and $hh -gt 0) {
                for ($i = 0; $i -lt 40; $i++) {
                    $p = Get-Process -Name $a[1] -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
                    if ($p) {
                        [void][EbysWin]::ShowWindow($p.MainWindowHandle, 9)
                        [void][EbysWin]::SetWindowPos($p.MainWindowHandle, [IntPtr]::Zero, $x, $y, $w, $hh, 0x0040)
                        break
                    }
                    Start-Sleep -Milliseconds 500
                }
            }
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
                if ($dir -notlike '*\Bld-Protokol\*') { throw "Guvensiz klasor: $dir" }
                [void]$cmds.Add('rmdir /s /q "' + $dir + '" 2>nul')
                if ($par -and $par -like '*\Bld-Protokol') { [void]$cmds.Add('rmdir "' + $par + '" 2>nul') }
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
        'get' {
            # a1=adres a2=hedef dosya a3=beklenen SHA256 [bos olabilir]
            Net-Setup
            $url = $a[1]; $out = $a[2]; $want = $a[3]
            if (-not $url -or -not $out) { throw 'Eksik arguman.' }
            $done = $false
            for ($i = 1; $i -le 3 -and -not $done; $i++) {
                try {
                    Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -TimeoutSec 60
                    $done = $true
                } catch {
                    if ($i -ge 3) { throw ('Indirilemedi: ' + $_.Exception.Message) }
                    Start-Sleep -Seconds 2
                }
            }
            if ($want) {
                $w = $want.Trim().ToUpper()
                $h = Get-Sha256 $out
                if ($h -ne $w) {
                    Remove-Item -LiteralPath $out -Force -ErrorAction SilentlyContinue
                    throw ('SHA256 uyusmuyor. Beklenen: ' + $w + ' Gelen: ' + $h)
                }
            }
        }
        'head' {
            # a1=adres a2='any' ise sunucu hangi cevabi verirse versin ulasilmis sayilir
            Net-Setup
            try {
                $r = Invoke-WebRequest -Uri $a[1] -Method Head -UseBasicParsing -TimeoutSec 10
                if ($a[2] -ne 'any' -and $r.StatusCode -ne 200) { throw ('HTTP ' + $r.StatusCode) }
            } catch {
                if ($a[2] -eq 'any' -and $_.Exception.Response) { return }
                throw
            }
        }
        'hash' {
            # a1=dosya a2=beklenen SHA256
            $h = Get-Sha256 $a[1]
            Write-Output $h
            if ($a[2]) {
                $w = $a[2].Trim().ToUpper()
                if ($h -ne $w) { throw ('SHA256 uyusmuyor. Beklenen: ' + $w + ' Gelen: ' + $h) }
            }
        }
        default { throw "bilinmeyen komut: $($a[0])" }
    }
} catch {
    [Console]::Error.WriteLine('[HATA] ' + $_.Exception.Message)
    exit 1
}









