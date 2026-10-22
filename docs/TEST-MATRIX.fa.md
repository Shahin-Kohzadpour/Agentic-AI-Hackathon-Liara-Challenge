# ماتریس آزمون و شواهد «نگهبان»

**تاریخ:** ۲۲ اکتبر ۲۰۲۶  
**کامیت پایه:** `8dad40e`  
**نتیجهٔ نهایی:** ۲۷/۲۷ آزمون backend روی Node 26.7.0 و Node 22.16.0؛ build موفق؛ browser-check و MCP واقعی موفق.  
**قاعده:** هر رفتار «BLOCKED» یا «NOT TESTED» هرگز PASS حساب نشده است.

## راهنمای وضعیت‌ها

- **PASS:** در همین بازبینی اجرا و مشاهده شد.
- **FIXED:** نقص بازتولید شد، اصلاح و با آزمون رگرسیون تأیید شد.
- **FAIL:** رفتار مورد انتظار مشاهده نشد. اگر اصلاح محلی آماده ولی منتشر نشده باشد، وضعیت «FAIL / BLOCKED» است.
- **BLOCKED:** برای اجرا به تأیید یا منبع بیرونی نیاز است.
- **NOT TESTED:** خارج از دامنه یا بدون ابزار لازم.

---

## ۱. نصب، ساخت و بازتولید

| ID | نیازمندی | روش آزمون | نتیجه | شاهد | یادداشت |
| --- | --- | --- | --- | --- | --- |
| R-01 | checkout تمیز نصب شود | `git archive HEAD` + `npm ci` در `/tmp` | PASS | `artifacts/audit/final-git.txt` | ۴۸۴ بسته؛ بدون `.env`/`.data` |
| R-02 | build تولیدی موفق شود | `npm run build` | PASS | `artifacts/audit/final-build.txt` | tsc + Vite |
| R-03 | آزمون پایه ۱۸/۱۸ | `npm test` روی کامیت پایه | PASS | خروجی بازبینی (۱۸ pass) | قبل از اصلاحات |
| R-04 | آزمون نهایی ۲۷/۲۷ | `npm test` | PASS | `artifacts/audit/final-tests.txt` | ۹ آزمون جدید |
| R-05 | حداقل Node اعلام‌شده | Node 22.16.0 + `npm test` + build | PASS | خروجی Node 22 (۲۷/۲۷) | `node:sqlite` هشدار Experimental |
| R-06 | سرو SPA/asset با static جدید | `GET /`، `/assets/*.js`، `/assets/*.css` | PASS | `serve-test` (۱۰.۱.۷) | status 200 برای هر سه |

## ۲. نقص پایه و قرارداد اصلاح

| ID | نیازمندی | روش آزمون | نتیجه | شاهد | یادداشت |
| --- | --- | --- | --- | --- | --- |
| C-01 | نقص بدون `discounts` بازتولید شود | `runner.verify` روی fixture | PASS | `final-tests` | ۲ check ناموفق (بدون تخفیف و دو آیتم) |
| C-02 | شاهد سلامت ساختگی نباشد | `collect('local')` بدون سرور | PASS | `final-tests` | `health.available=false` |
| C-03 | اصلاح واقعی Codex به تأیید برسد | browser-check با Codex واقعی | PASS | `final-browser-check.json` | `repairInvoked:true`، ۵۰۰→۲۰۰ |
| C-04 | ۱۱ آزمون مستقل کاندید | verifier | PASS | `browser-final-rehearsal/browser-check.json` | ۷ اصلی + ۴ مرزی |
| C-04b | آیتم `null` در آرایه→۴۰۰ | verifier + API | PASS | `final-tests`، `live-boundary.json` | local و live هر دو ۴۰۰ |
| C-05 | حالت‌های held-out حفظ شوند | verifier | PASS | `final-tests` | دو آیتم و تخفیف منفی |
| C-06 | سرریز عددی رد شود | `1e308` و `MAX_SAFE×2` | FIXED | `final-tests`، `live-boundary.json` | محلی ۴۰۰؛ زنده هنوز ۲۰۰/null |
| C-07 | بزرگ‌ترین عدد امن پذیرفته شود | `MAX_SAFE×1` + `discounts:[]` | PASS | `final-tests` | ۲۰۰ با مقدار امن |
| C-08 | اصلاح سادهٔ ناقص رد شود | نسخهٔ naive بدون isSafeInteger | PASS | `final-tests` | ۲ مرز ناموفق |
| C-09 | retry محدود در رد اعتبارسنج | fake agent: نامعتبر سپس معتبر | PASS | `final-tests` | دو فراخوانی، سپس awaiting_approval |
| C-10 | پیام رد شامل callee باشد | بازرسی کد/آزمون | PASS | `src/candidate.ts:31` | برای تشخیص آینده |

## ۳. اعتبارسنجی و sandbox

| ID | نیازمندی | روش آزمون | نتیجه | شاهد | یادداشت |
| --- | --- | --- | --- | --- | --- |
| S-01 | import/constructor/process/globalThis مسدود | `validateCandidate` | PASS | `probe-boundaries.json` | پیام‌های فارسی |
| S-02 | element access/new/حلقه/await مسدود | `validateCandidate` | PASS | `probe-boundaries.json` | |
| S-03 | tagged template مسدود | آزمون جدید | PASS | `final-tests` | قبلاً دور زده می‌شد |
| S-04 | متدهای مشروع پذیرفته شوند | `isSafeInteger`، `every`، `abs` و… | PASS | `final-tests` | allowlist گسترده |
| S-05 | خواندن `.env` میزبان مسدود | snapshot خصمانه در bwrap | PASS | `probe-sandbox-network.json` | `blocked` |
| S-06 | شبکهٔ خروجی مسدود | `fetch` واقعی در sandbox | PASS | `probe-sandbox-network.json` | `TypeError` |
| S-07 | متغیرهای حساس محیطی لو نروند | `process.env` | PASS | `probe-boundaries.json` | توکن `null`؛ HOME=/tmp |
| S-08 | حلقهٔ بی‌پایان محدود شود | `for(;;)` در sandbox | PASS | `probe-boundaries.json` | timeout ۱۲s |
| S-09 | مصرف حافظه محدود شود | آرایه‌های بزرگ | PASS | `probe-boundaries.json` | OOM داخل sandbox |
| S-10 | سیاست subprocess شفاف باشد | `execFileSync('/usr/bin/id')` | PARTIAL | `probe-sandbox-network.json` | اجرا با uid=1000؛ بدون mount/شبکه. ریسک باقی‌مانده در صورت دور زدن AST |
| S-11 | source read-only و verifier جدا | bwrap flags | PASS | `src/runner.ts` | `/app` و `/runner` read-only |

## ۴. تأیید، CSRF و ماشین حالت

| ID | نیازمندی | روش آزمون | نتیجه | شاهد | یادداشت |
| --- | --- | --- | --- | --- | --- |
| A-01 | بدون نشست → ۴۰۱ | `/api/state`، `/api/reports` | PASS | `probe-boundaries.json` | |
| A-02 | Host غیرمجاز → ۴۰۳ | `localhost` | PASS | `probe-boundaries.json` | DNS rebinding سخت‌تر |
| A-03 | Origin غایب/جعلی → ۴۰۳ | POST با Origin بد | PASS | `probe-boundaries.json` | |
| A-04 | CSRF غلط/غایب → ۴۰۳ | POST incident | PASS | `probe-boundaries.json` | |
| A-05 | اجرای بدون تأیید ممنوع | `execute` مستقیم | PASS | `final-tests` | |
| A-06 | action منقضی اجرا نشود | تغییر `expiresAt` | PASS | `final-tests` | |
| A-07 | revision پایهٔ قدیمی باطل شود | افزایش revision | PASS | `final-tests` | |
| A-08 | دستکاری فایل snapshot مسدود | تغییر محتوا | PASS | `final-tests` | digest mismatch |
| A-09 | symlink در snapshot مسدود | جایگزینی فایل با symlink | PASS | `probe-boundaries.json` | `lstat` |
| A-10 | digest action در اجرا تطبیق داده شود | دستکاری digest | FIXED | `probe-state.json`، `final-tests` | قبلاً اجرا می‌شد |
| A-11 | replay deployment دوم نسازد | اجرای دوبارهٔ action موفق | PASS | `final-tests` | revision ثابت |
| A-12 | اجرای هم‌زمان سریال شود | دو `execute` هم‌زمان | PASS | `probe-state.json` | یکی رد، یک verification |
| A-13 | قفل مالک از دو سرور جلوگیری کند | `claimOwner` دوبار | PASS | `final-tests` | |
| A-14 | بازیابی پس از توقف، وضعیت مبهم را failed کند | `initialize(true)` | PASS | کد + آزمون | بدون retry خودکار |
| A-15 | reset زنده صریح هشدار دهد | `resetProposal` روی liara | FIXED | `probe-state.json`، `final-tests` | عنوان «نسخهٔ معیوب» |
| A-16 | بررسی ناموفق، شاهد را حفظ کند | verifyHttp همیشه false | PASS | `probe-state.json` | action failed + verification |

## ۵. MCP

| ID | نیازمندی | روش آزمون | نتیجه | شاهد | یادداشت |
| --- | --- | --- | --- | --- | --- |
| M-01 | شش ابزار واقعی تبلیغ شوند | کلاینت MCP واقعی | PASS | `final-mcp-check.json`، `probe-mcp.json` | هیچ ابزار approve نیست |
| M-02 | ورودی نامعتبر خطا بدهد | project/run/tool ناموجود | PASS | `probe-mcp.json` | خطای ساختاری |
| M-03 | action تأییدنشده اجرا نشود | `deployment_apply` | PASS | `probe-mcp2.json` | pending ماند |
| M-04 | MCP نتواند تأیید کند | decision با Bearer mcp-key | PASS | `probe-mcp2.json` | ۴۰۳ |
| M-05 | MCP نتواند نشست انسانی بسازد | `/api/session` با کلید ابزار | PASS | `probe-mcp2.json` | ۴۰۳ |
| M-06 | MCP نتواند SSE انسانی را اشغال کند | `/api/events` با کلید ابزار | FIXED | `final-tests` | ۴۰۱ |
| M-07 | STDIO آلوده نشود | کلاینت واقعی | PASS | `final-mcp-check.json` | stderr جدا |
| M-08 | ابزار فقط رفتار پیاده‌شده را تبلیغ کند | بازرسی schema/description | PASS | `probe-mcp.json` | scope ثبت‌شده |

## ۶. داشبورد

| ID | نیازمندی | روش آزمون | نتیجه | شاهد | یادداشت |
| --- | --- | --- | --- | --- | --- |
| U-01 | RTL و lang فارسی | Playwright | PASS | `probe-ui-fixed.json` | `dir=rtl`، `lang=fa` |
| U-02 | دسکتاپ بدون سرریز | ۱۴۴۰×۹۰۰ | PASS | `final-dashboard-desktop.png` | |
| U-03 | موبایل ۳۹۰/۳۲۰ بدون سرریز | Playwright | PASS | `final-dashboard-mobile.png` | sidebar به بالا منتقل می‌شود |
| U-04 | ترتیب Tab و Enter | کیبورد | PASS | `probe-ui-fixed.json` | برند، ناوبری، پروژه، textarea |
| U-05 | gate و خطای کلید | ورود غلط/درست | PASS | `probe-ui-fixed.json` | `role=alert`؛ `#key` پاک می‌شود |
| U-06 | حالت خالی | پروژهٔ تازه | PASS | `probe-ui-fixed.json` | «هنوز تغییری منتظر تأیید نیست» |
| U-07 | رد انتشار | کلیک انصراف | PASS | `probe-ui-fixed.json` | revision ۱، وضعیت rejected |
| U-08 | تأیید و بازیابی | کلیک تأیید | PASS | `final-browser-check.json` | پاسخ ۲۰۰، revision ۲ |
| U-09 | گزارش و دانلود JSON | کلیک گزارش/دریافت | PASS | `probe-ui-fixed.json` | JSON معتبر |
| U-10 | XSS در request/diagnosis/diff | payloadهای `<img>`/`<script>` | PASS | `probe-ui-fixed.json` | هیچ اجرا/DOM تزریقی |
| U-11 | XSS در evidence | شاهد خصمانه | PASS | `probe-ui-fixed.json` | متن escape شد |
| U-12 | SSE فوری | header timing | FIXED | `probe-ui.json` → `probe-ui-fixed.json` | ۱۲٬۰۱۶ms → ۲۸ms |
| U-13 | کنتراست AA | محاسبهٔ WCAG | FIXED | `contrast.txt` | ۱.۹۴–۳.۳ → ۴.۷۵–۵.۷۳ |
| U-14 | خطای صفحه در مرورگر | console/pageerror | PASS | `final-browser-check.json` | آرایهٔ خالی |

## ۷. لیارا (فقط خواندنی)

| ID | نیازمندی | روش آزمون | نتیجه | شاهد | یادداشت |
| --- | --- | --- | --- | --- | --- |
| L-01 | توکن/تیم/پروژه درست | `/v1/projects` | PASS | `liara-readonly.json` | یک پروژهٔ ACTIVE؛ team ID مطابق |
| L-02 | release فعلی همان ادعا | `/v1/projects/{name}/releases` | PASS | `liara-readonly.json` | `6ad9f90e…` READY |
| L-03 | لاگ‌ها به release درست تعلق دارند | v2 logs | PASS | `liara-readonly.json` | ۵ خط، همه همان release |
| L-04 | متریک‌ها بدون صفرسازی | CPU/memory | PASS | `liara-readonly.json` | محدودیت واحد/تازگی ثبت شد |
| L-05 | HTTP تجاری ۳/۳ | verifyHttp | PASS | `liara-readonly.json` | ۲۰۰/۲۰۰/۴۰۰ |
| L-06 | بدنهٔ خالی زنده | `POST /api/summary` | FAIL | `live-boundary.json` | ۵۰۰؛ اصلاح محلی آماده، انتشار BLOCKED |
| L-07 | سرریز عددی زنده | `1e308` | FAIL | `live-boundary.json` | ۲۰۰ با null؛ انتشار BLOCKED |
| L-08 | endpoint restart با CLI | بازرسی سورس CLI | PASS | `node_modules/@liara/cli/.../restart.js` | `v1/projects/{app}/actions/restart` |
| L-09 | انتشار اصلاح مرزی | deploy ابری | BLOCKED | `docs/AUDIT.fa.md` بخش ۸ | نیازمند تأیید صریح |
| L-10 | provision / restart / resize | اجرای ابری | NOT TESTED | — | خارج از مجوز؛ provision می‌تواند هزینه بسازد |

## ۸. تحویل، ویدئو و وابستگی

| ID | نیازمندی | روش آزمون | نتیجه | شاهد | یادداشت |
| --- | --- | --- | --- | --- | --- |
| D-01 | hash آرشیوها با manifest | SHA-256 | PASS | `package-manifest.json` | هر دو مطابق |
| D-02 | نبود راز در ZIP | اسکن مقدارهای شناخته‌شده | PASS | بازبینی Python | فقط `.env.example` |
| D-03 | نبود `.data`/SQLite/کلید | فهرست ZIP | PASS | بازبینی Python | ۴۸ و ۶۱ ورودی |
| D-04 | ویدئو پخش/صدا/مدت | ffprobe + volumedetect | PASS | خروجی ffprobe | ۳۰۰.۰۷s؛ صدا −۲۳.۵dB |
| D-05 | صدای مصنوعی اعلام شود | manifest/SUBMISSION | PASS | `presentation-manifest.json` | `syntheticNarration:true` |
| D-06 | ویدئوی خام جدا باشد | ffprobe | PASS | `LIVE-RUN.silent.mp4` | ۱۳۰.۱۶s بدون صدا |
| D-07 | شاهد مرورگری تاریخی، اصلاح تازه را اجرا کرده باشد | بازرسی `browser-check.json` | FAIL (شاهد تاریخی) | `artifacts/browser-check.json` | `repairInvoked:false`؛ اجرای جدید PASS |
| D-08 | آسیب‌پذیری‌های وابستگی بررسی شوند | `npm audit` | ACCEPTED | `final-npm-audit.json` | ۹ مورد در درخت CLI؛ ارتقای اجباری نشد |
| D-09 | بستهٔ تحویل با کد جاری هم‌راستا باشد | مقایسه | NOT DONE | — | ZIPها پس از اصلاحات قدیمی‌اند؛ قبل از ارسال بازسازی شوند |

## ۹. خارج از دامنه

| ID | نیازمندی | وضعیت | دلیل |
| --- | --- | --- | --- |
| X-01 | مخزن دلخواه / SRE عمومی | NOT TESTED | دامنهٔ ثبت‌شده فقط نمونهٔ Node.js است |
| X-02 | پایش دائمی/Uptime/MTTR | NOT TESTED | پیاده‌سازی نشده؛ ادعا نشود |
| X-03 | بازیابی دیتابیس/زیرساخت | NOT TESTED | خارج از دامنه |
| X-04 | بررسی تصویری کامل ویدئو با OCR فارسی | NOT TESTED | tessdata فارسی موجود نبود |
| X-05 | نفوذ سطح کرنل/container escape | NOT TESTED | خارج از دامنه؛ فقط مهار سطح برنامه آزموده شد |

---

## جمع‌بندی

- **PASS:** ۴۰+ مورد شامل نصب/build، ۲۷ آزمون، Node 22، مسیر اصلی، تأیید/CSRF، MCP، داشبورد، RTL/موبایل/کیبورد/XSS، گزارش، لیارا خواندنی، ZIP/ویدئو.
- **FIXED:** ۹ نقص محلی (F-01 تا F-09) با آزمون رگرسیون.
- **FAIL روی زنده:** دو رفتار مرزی (F-05/F-06) که اصلاح محلی دارند ولی انتشار آن‌ها **BLOCKED** است.
- **BLOCKED/NOT TESTED:** انتشار ابری، restart/resize/provision، مخزن دلخواه، پایش دائمی، OCR فارسی ویدئو.
