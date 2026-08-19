# Enterprise Technical Debt and Code Migration Intelligence Report (May 2026)

## TL;DR

- The three largest active enterprise tech-debt fronts RIGHT NOW are: **(1) SAP ECC to S/4HANA** with a hard December 31, 2027 mainstream support cliff and >60% of SAP's installed base un-migrated as of end-2024 (Gartner via SAVIC); **(2) Java 8/11 to Java 17/21 + Spring Boot 2 to 3/4 + javax-to-jakarta**, which Azul's 2025 State of Java Survey (n=2,039) shows is in mid-flight at most large enterprises (Java 8 usage fell from 40% in 2023 to 23% in 2025); **(3) COBOL/mainframe modernization** at banks, insurers, and the US federal government, where AI-assisted approaches (IBM watsonx Code Assistant for Z, Mechanical Orchard's Imogen, Amazon Q) are finally making the economics work.
- AI-assisted migration is becoming the default for high-volume, mechanical work (Spring Boot upgrades, Jakarta namespace changes, .NET upgrades, COBOL-to-Java); deterministic AST-based tooling (OpenRewrite/Moderne, Diffblue, codemods) still dominates audit-grade work; consulting services (TCS, Infosys, Wipro, Accenture, IBM Consulting, Deloitte) capture the lion's share of revenue on programs >$10M because of testing, integration, and regulatory burden. Microsoft deprecated the deterministic .NET Upgrade Assistant in late 2025 and now recommends GitHub Copilot App Modernization, an explicit bet on LLM agents.
- The highest-failure-risk programs remain **big-bang core banking replacements** (Commonwealth Bank of Australia's $1.5B/5-year program 2008-2013 is the cautionary success; TSB's 2018 cutover cost £330M plus £49M in fraud and the CEO's job), **government mainframe rewrites** (IRS Individual Master File slipping to 2030; SSA COBOL effort pushed by DOGE in March 2025 widely judged technically infeasible on the stated months-long timeline), and any program that conflates language migration with business-process re-engineering. The safe pattern is incremental "strangler" or "sidecar" modernization combined with AI-assisted code transformation and characterization testing.

---

## Category A: Language Migrations (cross-language)

### A1. COBOL to Java (and to a lesser extent Python, C#)

**What's happening.** Large banks, insurers, and government agencies are migrating COBOL business logic off IBM Z mainframes (and Unisys, Bull, Fujitsu equivalents) to Java running on Linux/cloud, occasionally to C# or Python. The dominant pattern in 2025-2026 is now AI-assisted, behavior-equivalent rewrite rather than line-by-line transpilation, driven by IBM watsonx Code Assistant for Z, Mechanical Orchard's Imogen platform, mLogica's automation framework, and Amazon Q.

**Why now.**
- Skills cliff. Per TNW's 2017 piece "Ancient programming language COBOL can make you bank, literally" (Már Másson Maack), citing Reuters on COBOL Cowboys founder Bill Hinshaw (age 75): "In the absence of operating manuals and instructions, Hinshaw's programmers can pretty much name their price, although $100+ an hour seems the norm."
- Hardware/licensing inflation on z/OS and CICS/IMS subscriptions.
- Regulatory pressure (APRA CPS 230 in Australia, EU DORA, US OCC operational-resilience guidance).
- AI capability. GenAI is the first technology in 30 years that materially changes the unit economics.

**Specific MNCs doing it RIGHT NOW.**
- **Commonwealth Bank of Australia (CBA)** completed in 2024-2025 the cloud migration of its core banking platform (originally re-platformed in the 2008-2013 $1.5B SAP Banking program) to AWS, moving 61,000+ data pipelines and supporting 16M customers and 40% of Australian payments (CBA newsroom, March 2026; appinventiv 2026).
- **Barclays** is decommissioning its mainframe cash-settlement system using Camunda after its January 2025 mainframe outage froze service for 20M+ customers (Camunda case study Dec 2024; Financial Times via klover.ai 2025). A UK parliamentary review found banks clocked 158 IT failures and 33 days of downtime between January 2023 and February 2025 (The Guardian via appinventiv).
- **Lloyds Banking Group** has spent £3B+ on digital transformation since 2018, including mainframe-footprint reduction (WebProNews aggregation, 2025); NatWest has similarly committed to reducing mainframe footprint.
- **BNP Paribas Group / BNL** is offloading DB2-on-mainframe workloads to Apache Kafka via Qlik Replicate and Confluent (Kai Waehner blog, June 2025); **BNP Paribas** modernized its IBM Z core banking IDE and test environment via the BP2I joint venture with IBM (IBM case study).
- **BBVA, Hapag-Lloyd, Regions Bank, Sun Life, The Standard, Verizon, Vodafone** are named as Rocket Software mainframe customers (Rocket-K2view press release, 2025).
- **Mechanical Orchard / Imogen** publicly disclosed (April 27, 2026 "Reflections on the first year of Imogen") active programs at: a large North American bank (COBOL+Assembler+Easytrieve to Java on AWS, regulator-driven); a major automotive company (air-gapped); a global industrial manufacturer (extended warranty system, completed in 4 months on AWS with Thoughtworks, 80% acceleration); one of North America's largest retailers (sales system, F100, recently completed 11,578 lines of COBOL in 28 hours); and **SulAmérica** (Latin American insurer, named publicly at Google Cloud Next 2026, claims system driving 30% of mainframe consumption). Earlier named customer: **Omni Logistics** (Emergence Capital blog).
- **Social Security Administration (US)**. WIRED (Makena Kelly, March 28, 2025) reported DOGE / Steve Davis was assembling a team to migrate SSA's 60M+ lines of COBOL to Java "in a matter of months." Per WIRED: "DOGE thinks if they can say they got rid of all the COBOL in months, then their way is the right way, and we all just suck for not breaking shit" (anonymous SSA technologist). CIO Magazine (April 2025) quoted BMC's John McKenny, SVP and GM of mainframe optimization: "You don't know what you're talking about… There are a few companies that have done it at a much, much smaller scale, but at that scale, those who have tried have failed and quietly walked away." 65M beneficiaries depend on the system; CIO cites 220 billion lines of COBOL still in use globally and 43% of banking systems built on it.
- **IRS (US)**. The Individual Master File (assembly + COBOL, 1960s) remains in production with retirement slipping to 2030 per current IRS plans; the Business Master File modernization budget started at $549M (GAO/NTU 2024-2025); Treasury IG (TIGTA) August 2024 audit found IRS ineffectively implemented 2 of 4 prior tech-debt recommendations; agency reportedly spent $1.3B beyond ordinary budget since 2022 on business systems modernization (WSJ Editorial Board, Sept 13, 2024).
- **National Organization for Social Insurance (NOSI)** is a publicly named IBM watsonx Code Assistant for Z customer using it to "explore, document and understand existing COBOL applications" (IBM site, 2025).

**Estimated scale.**
- 220 billion lines of COBOL still in use globally; 43% of banking systems built on it (CIO Magazine April 2025).
- IRS systems include 50-year-old IDRS and IMF; SSA has 60M+ lines of COBOL.
- $3 trillion in daily commerce flows through COBOL systems (Reuters via TNW).
- Mainframe modernization market: $8.39B in 2025 growing to $13.34B by 2030, 9.7% CAGR (MarketsandMarkets, 2025).

**Tools and consultants.**
- IBM Consulting + IBM watsonx Code Assistant for Z (versions 2.1 through 2.8 released through 2025; on-prem GA June 2024; Granite LLMs; ADDI tooling; Code Generation, Code Explanation including Assembler support added in v2.6 June 27, 2025).
- Mechanical Orchard / Imogen + Thoughtworks (formalized partnership April 3, 2025; $84M+ raised including $50M Series B from GV/Alphabet, Aug 2024; Series A $24M led by Emergence Capital at $95M valuation). Founder/CEO Rob Mee (ex-Pivotal Labs); Chief Scientist Kent Beck. Imogen now consistently replicates 10,000+ lines of COBOL per engineer per week per April 2026 Reflections post.
- TCS Mastercraft has "transformed over 300 million lines of legacy code to Java" and TCS manages "over half-a-billion mainframe MIPS" with 220+ code-transformation patents (TCS website).
- Infosys, Wipro, HCL, Cognizant, Capgemini, Atos, DXC, Kyndryl, Fujitsu, mLogica, Broadcom, TmaxSoft are the other mainframe-modernization market leaders (MarketsandMarkets 2025).
- Amazon Q Code Transformation supports Java upgrades (8/11 to 17/21) and announced agentic Java-to-Java modernization paths.

**AI/LLM usage.** Heavy. IBM Granite LLMs power watsonx Code Assistant for Z; Mechanical Orchard built Imogen as a GenAI-native platform that focuses on data-flow behavior rather than line-by-line translation; DOGE's SSA plan was reported to rely on GenAI to be feasible at all on its timeline.

**Success/failure indicators.** Per McKinsey's "How to get a core banking transformation right: Eight mistakes to avoid": "only about 30% of CBS transformations succeeded in carrying out a complete migration of ledgers and products to a new system... We've seen banks overspend by 100 percent and timelines increase by 50 to 100 percent." Commonwealth Bank's $1.5B/5-year SAP Banking program (2008-2013) is the canonical "succeeded but at brutal cost" reference; TSB's 2018 cutover (£330M cost + £49M fraud losses + CEO resignation + 200,000+ customer complaints) is the canonical disaster. By contrast, Mechanical Orchard claims 80% acceleration on the recent Thoughtworks-partnered manufacturer migration.

**What's blocking faster progress.** Talent (both COBOL experts retiring and migration-architect experience), risk aversion ("the code is the documentation"), data dependencies, regulatory testing burden, and the impossibility of running parallel cutovers at the scale of national insurance systems.

### A2. ABAP / SAP ECC to SAP S/4HANA

**What's happening.** End of mainstream maintenance for SAP ECC (EHP 6-8) is December 31, 2027; SAP has been emphatic that this date will not move again. Customers must do a Brownfield (System Conversion), Greenfield (New Implementation), or Bluefield/Shell (Selective Data Transition) move to S/4HANA, plus mandatory custom-ABAP remediation, Customer/Vendor Integration to Business Partner conversion (CVI), and Fiori UI work.

**Why now.** Hard regulatory deadline; security patches stop; extended maintenance from 2028-2030 costs an additional 2% premium on top of existing 22% support fees; resource market is already tightening per SAVIC's 2025 analysis.

**Specific MNCs doing it.** Gartner data via SAVIC: only ~39% of SAP ECC customers had even licensed S/4HANA as of end-2024; "25,000 companies using or implementing S/4HANA, approximately 22,000 still on ECC" (Pathlock). Public references are sparse because most SAP customers do not publicize migrations mid-flight.

**Estimated scale.** Full ECC to S/4HANA migration: 18-36 months for large enterprises, 30-42 months for "complex multi-country, multi-system, significant custom code" estates (Kellton; SAVIC); SAP itself historically estimates a minimum of 12-18 months. The professional-services market is enormous; industry sources peg the broader S/4HANA services TAM at ~$89B with the ECC migration as the primary driver (IC Euro analyst sizing, treat as directional).

**Tools and consultants.** SAP Readiness Check; SAP Software Update Manager (SUM); SAP Fiori Custom Code Migration App; ABAP Development Tools in Eclipse; SAP DMLT for CVI. Implementation partners: Accenture, Deloitte, IBM Consulting, Capgemini, TCS, Infosys, Wipro, LTIMindtree, Persistent, Kellton, SAVIC; SAP's own RISE/GROW with SAP and Signavio assets. SAP positions its own AI offerings (Joule, AI Foundation) for ABAP custom-code remediation.

**AI/LLM usage.** Moderate but accelerating. SAP's "clean core" doctrine specifically tries to minimize custom code; AI is used for impact analysis and to suggest remediation, but final cutover testing is still overwhelmingly manual.

**Success/failure.** No comprehensive public failure tally yet for the 2024-2027 wave; the iLAB-cited "global insurance company" that delayed by 18 months and faced a compliance event when compatibility packs expired (40% of custom ABAP-driven finance workflows had no valid path forward) is representative of the emerging failure mode.

**Blockers.** Custom-ABAP debt, third-party add-ons, master-data quality (Business Partner conversion is "a project within a project"), tightening consultant supply, CIO change-fatigue.

### A3. .NET Framework to .NET 8 / .NET 10 (with Web Forms, WCF, Windows Forms migrations)

**What's happening.** Microsoft has frozen .NET Framework at 4.8 and is investing only in modern .NET (formerly .NET Core). .NET 8 LTS support ends November 10, 2026; .NET 10 LTS (released November 2025) extends through November 2028. ASP.NET Web Forms have no direct migration path and must be rewritten to Razor Pages, Blazor, or a SPA + API split. WCF servers move to gRPC, REST, or community CoreWCF. EF6 must be ported (not auto-upgraded) to EF Core.

**Why now.** Cross-platform/Linux container deployment requires modern .NET; Windows licensing costs in cloud; Microsoft deprecated .NET Upgrade Assistant in late 2025 and now points enterprises to **GitHub Copilot App Modernization for .NET** (paid Copilot subscription required).

**Specific MNCs doing it.** Largely Fortune 500 firms with legacy Windows Forms / ASP.NET Web Forms estates; financial services, insurance, healthcare administration, and government are the largest pockets; specific public references are scarce because Microsoft customer references for this migration tend to be small ISVs rather than household-name MNCs.

**Tools and consultants.** GitHub Copilot App Modernization for .NET (Microsoft's current recommendation); deprecated .NET Upgrade Assistant; Windows Compatibility Pack; AWS Porting Assistant; HeroDevs Never-Ending Support for .NET 6 (compliance bridge); OpenRewrite has shipped C# recipes including ChangeDotNetTargetFramework. Major SI plays: Accenture, Avanade (Microsoft JV), Cognizant, Capgemini, EPAM, Insight, Concentrix.

**AI/LLM usage.** Heavy and increasing — Microsoft has explicitly bet on Copilot agents for this work; deterministic tooling is fading as the recommended path.

**Blockers.** Web Forms is the worst case (no direct migration); WCF servers; EF6 to EF Core query-translation differences; reliance on System.Web, COM, native PInvoke, and Windows-only APIs.

### A4. Other language migrations

- **Fortran to modern languages** in scientific/engineering: relatively quiet in 2024-2026 public reporting; the larger trend is preserving Fortran and wrapping it in Python (NumPy/SciPy ecosystem). Defense (Lockheed, Boeing), automotive CFD, and national labs continue to maintain Fortran.
- **VB6 / VB.NET to C#**: still happening in pockets of insurance, healthcare admin, and back-office finance.
- **Perl to Python** at older infrastructure-heavy MNCs: long tail at telcos and SaaS-era infrastructure firms.
- **ColdFusion to modern stacks**: residual government and legacy-CMS modernization; Adobe still ships ColdFusion 2025 but the workforce is shrinking.
- **PL/SQL to application-layer code**: bundled with Oracle-to-Postgres migrations (see B7). Data Patrol Technologies estimates 40-80 hours per 1,000 lines of PL/SQL; one financial-services case study cited $850K on PL/SQL refactoring alone, 45% of total migration budget.
- **Flash/ActionScript**: effectively done; residuals in legacy e-learning and enterprise CMS.
- **Objective-C to Swift** at Apple-ecosystem companies: largely complete at the major MNCs; UIKit-to-SwiftUI is the active surface (see B8).
- **Java to Kotlin** at Android-first MNCs is the most active mobile-platform language migration RIGHT NOW:
  - **Meta** (Engineering at Meta blog, Omer Strulovich, October 24, 2022): "Today, our Android apps for Facebook, Messenger, and Instagram each have more than 1 million lines of Kotlin code... In total, our Android codebase has more than 10 millions lines of Kotlin code."
  - **Google internal** (Android Developers Blog, August 2022): "Thousands of Google engineers are writing Kotlin code, and our internal codebase contains more than 8.5 million lines of Kotlin code to date. This number has been increasing rapidly as well, doubling year over year."
  - **Pinterest** (InfoQ 2018; Pinterest Engineering Medium): declared "Kotlin-first Android environment" in 2018.
  - **Uber Engineering blog**: "with over 20 Android applications and more than 2,000 modules in our Android monorepo, Uber's Mobile Engineering team had to carefully evaluate the impact of adopting something as significant as a new language."
  - **Swiggy**: 74% Kotlin with 50% crash reduction (secondary source InfoStride, not Swiggy primary — flag for verification).
- **AngularJS (1.x) to Angular (2+)**: This is a true language/framework migration (AngularJS is JavaScript; Angular is TypeScript with a totally different mental model). AngularJS reached EOL December 31, 2021; commercial support continues via **HeroDevs Never-Ending Support** and **OpenLogic**. Migrations remain ongoing at many enterprises.

---

## Category B: Within-Language Modernization

### B1. Java 8 to Java 17 / 21 / 25

**What's happening.** Azul's 2025 State of Java Survey (n=2,039) shows Java 8 usage dropped from 40% in 2023 to 23% in 2025; Java 17 and Java 21 are now the dominant LTS choices (49% combined); Java 25 LTS shipped September 2025 with Oracle support through 2033; 19% of enterprise still runs Java 6 or 7. The 2025 Jakarta EE Developer Survey reports Java 21 adoption jumped to 43% (up from 30% in 2024) while Java 17 and 8 declined and Java 11 rebounded to 37%.

**Why now.** Oracle ended free commercial support for Java 17 in October 2024, forcing customers to pay Oracle on the new employee-based pricing (82% of Oracle Java users remain concerned about this pricing — Azul 2025) OR move to OpenJDK distributions (Azul, Amazon Corretto, Eclipse Temurin, Microsoft Build of OpenJDK, BellSoft Liberica). Performance improvements (ZGC, Shenandoah, virtual threads in 21+) and security patches drive the rest.

**Specific MNCs.**
- **The Japan Research Institute (SMBC Group core IT)** is a publicly named Amazon Q Developer customer for Java 8 upgrades (AWS Q Developer customer page).
- **Persistent Systems**: used Amazon Q to migrate an internal function application from Java 8 to Java 17 in 4 hours vs. 24 expected (~83% productivity gain).
- **Novacomp** (Costa Rica IT firm): upgraded 10,000 lines of Java in 50 minutes vs. expected 3 weeks; migrated 80% of its base code; reduced technical debt by 60% on average (AWS case study).
- **Toyota, Pragma** named as Amazon Q customers for Java upgrades.
- **Major North American insurance company** and a "major financial services firm" (anonymized) ran a 2-day workshop where 20 developers transformed 20 production applications using Q Developer (42% time savings, 24 hours saved per app).
- AWS internal: a small team upgraded **1,000+ AWS internal applications** with Q Developer.

**Tools.** Amazon Q Code Transformation (primary public reference customers); IBM watsonx Code Assistant; **OpenRewrite (Moderne)** is the dominant deterministic option, identified by InfoQ's 2025 Java Trends report as the dominant automation tool for Java modernization, notable for migrating the Jakarta EE TCK itself and for thousands of javax-to-jakarta migrations. Diffblue Cover for test generation. JetBrains IntelliJ "Migrate to Jakarta EE 9" refactoring.

**Tool licensing controversy.** In December 2024, Moderne moved rewrite-java-security from Apache 2.0 to a proprietary Moderne Public License (MPL), provoking community backlash documented in Jonathan Leitschuh's InfoSec Write-ups post; the relicensing was attributed at Moderne's CodeRemix Summit 2025 to free-riding by Amazon Q Code Transformer, Sourcegraph Batch Changes, and Broadcom Application Advisor.

**AI/LLM usage.** Heavy and expanding. Amazon Q now uses Bedrock to correct compilation errors during Java 17 migration, supports Spring Boot 2.7 to 3.2 major-version jumps, supports Java 21 as a target as of 2025, and added selective transformation (CLI control) in 2025.

**Blockers.** First-party (1P) internal-library dependencies are the largest blocker per AWS customer reporting; Spring Security 6 configuration rewrite; Hibernate 6 SQL translation differences; testing burden; reflection-heavy framework dependencies; Log4j still affects 49% of respondents per Azul.

### B2. Spring Framework 5 to 6, Spring Boot 2 to 3 to 4 + javax.* to jakarta.*

**What's happening.** This is the single largest within-language modernization happening at enterprise Java shops in 2025-2026. Spring Boot 2.x OSS support ended in 2023; Spring Boot 3.3 OSS support ended June 2025; Spring Boot 4.0 shipped November 2025 (requires Java 17+, Jakarta EE 11, Jackson 3.x, Spring Framework 7). The recommended bridge path is 2.7 → 3.5 → 4.0. Jakarta EE 11 was adopted by 18% of Eclipse Jakarta EE survey respondents within months of release (Eclipse Foundation, Sept 30, 2025).

**The javax → jakarta namespace change** affects every JPA Entity, every Servlet, every Bean Validation, every JTA Transactional, typically thousands of imports across a large codebase.

**Why now.** Hard support cliff (2.7 EOL November 2023; 3.3 OSS June 2025); Jakarta EE 9+ namespace; AOT/GraalVM native compilation; performance; CVE patching.

**Tools.** OpenRewrite recipes (Spring Boot Migrator, "Migrate to Spring Boot 3", "Migrate to Jakarta EE 9"); JetBrains IntelliJ migration refactoring; Amazon Q Code Transformation (now supports Boot 2.7 to 3.2); sed scripts (small projects); GitHub Copilot prompts.

**Blockers.** Undertow dropped (must move to Tomcat or Jetty in Boot 4); Spring Security 6 config rewrite; Spring Data JPA derived-query count behavior; circular bean dependency detection enabled by default in Boot 3; library compatibility with Jakarta EE 11.

### B3. WebLogic / WebSphere to Tomcat / Spring Boot

Ongoing but losing visibility as a flagship initiative; bundled into the Boot 3 + Java 17 upgrade story. Oracle WebLogic and IBM WebSphere licensing costs are the typical driver. The 2025 Jakarta EE Developer Survey reports for the first time that more developers use Jakarta EE (58%) than Spring (56%).

### B4. Python 2 → 3, then 3.6/3.7/3.8 → 3.11/3.12/3.13

**What's happening.** Python 2 residuals exist at older infrastructure-heavy MNCs but are rapidly disappearing. The active modernization is 3.6/3.7/3.8 (all EOL) to 3.11/3.12 for performance and security CVE coverage. Django version upgrades (3.x to 5.x, async views); Flask to FastAPI for async/performance; pip/setuptools to Poetry/uv (uv is the dominant 2025 momentum).

**Why now.** EOL of older 3.x minors; performance gains in 3.11/3.12 (15-25% on many workloads); security scanner pressure.

**Tools.** No standout AI tool dominates this; codemods (libCST, Bowler), pyupgrade, ruff, and human upgrades.

### B5. JavaScript / TypeScript ecosystem

**TypeScript adoption.** Per GitHub Octoverse 2025 (published October 28, 2025, github.blog): TypeScript finished August 2025 with exactly 2,636,006 monthly contributors (+1,050,000 YoY; +66.6%), edging Python by approximately 42,000 developers; GitHub described this as "the most significant language shift in more than a decade." AI co-pilot adoption is credited as a key driver, alongside the GitHub Copilot Free release in late 2024 which drove 36M new developer sign-ups in the Octoverse year.

**Vue 2 → Vue 3.** Vue 2 reached EOL December 31, 2023; Nuxt 2 reached EOL June 30, 2024. Commercial extended support via **HeroDevs Never-Ending Support (NES)** is the standard bridge. Migration time estimation per HeroDevs: TTM ≈ (LOC × 0.75 / lines-per-week) × 1.3. Progress Kendo UI for Vue extended its Vue-2 support to November 2024.

**Node.js EOL cascade.** Node 14 EOL April 2023; Node 16 EOL September 2023; Node 18 EOL April 30, 2025. AWS CDK officially ended Node 18.x support December 1, 2025; Vercel disabled Node 18 in project settings September 1, 2025. Node 18 still saw approximately 50M monthly downloads at EOL per nodejs.org. Recommended jump: skip Node 20 (EOL April 2026) and go directly to Node 22 LTS.

**AngularJS to Angular**: see A4. Modern Angular versions 14-19 are also already EOL as of May 2026; Angular 20 and 21 are in LTS; Angular 22 ships June 2026 (FrontendMinds 2026).

**Other within-JS-ecosystem fronts**: jQuery to modern frameworks (GitHub itself dropped jQuery); Webpack/Babel to Vite/esbuild/Turbopack; CommonJS to ESM (slow but ongoing); React class components to function components with hooks (largely complete at modern shops); AWS SDK v2 to v3 (huge call-site changes; many enterprise projects mid-migration in 2025); Redux to Zustand / TanStack Query (modernization-with-optional-value).

### B6. C / C++ to Rust (memory safety mandate)

**What's happening.** A genuine, accelerating, security-mandated migration of new-system code in C/C++ codebases to Rust at the largest tech firms.

**Why now.** CISA's Secure by Design memory-safety roadmap deadline of **January 1, 2026** has codified the pressure. 70% of vulnerabilities at Microsoft and Google trace to memory errors in C/C++.

**Specific MNCs.**
- **Google / Android**: 1.5M+ lines of Rust in Android Open Source Project (~21% of all new native development). Per Google's Jeff Vander Stoep, writing in the Google Online Security Blog (November 2025): "We adopted Rust for its security and are seeing a 1000x reduction in memory safety vulnerability density compared to Android's C and C++ code." Memory-safety vulnerabilities dropped from 76% of Android vulnerabilities in 2019 to below 20% in 2025, the first time crossing that threshold. Zero memory-safety vulnerabilities discovered in Android's Rust code to date. Memory-safety bugs dropped from 223 in 2019 to fewer than 50 in 2024. Rust changes also show 25% less time in code review and a 4x lower rollback rate.
- **Microsoft**: Windows 11 kernel drivers now use Rust to prevent exploits.
- **Meta**: rewriting mobile messaging infrastructure in Rust across Facebook, Messenger, Instagram, and VR; engineers describe legacy C internally as "spaghetti."
- **AWS**: Firecracker microVM platform in Rust; broader Azure components increasingly Rust.
- **Linux kernel**: 150,000+ lines of Rust now in tree.

**Tooling.** No single AI tool dominates C++-to-Rust today; the work remains largely human-driven, with bindgen, cbindgen, and FFI-bridge patterns for incremental migration.

**Market data.** Per byteiota's 2026 industry compilation (citing iMocha hiring data), Rust job postings surged 35% year-over-year in 2025; mid-career Rust developers earn an average of $130K and seniors reach $235K (ZipRecruiter/Wellfound data cited in the same compilation).

### B7. Database migrations

**Oracle to PostgreSQL.** Dominant database migration of 2024-2026, cost-driven (Oracle employee-based pricing changes; escalating audit/support fees of $350K-$500K annually for mid-size enterprises per OptiSol).
- Reported TCO reductions of 70-90% (OptiSol 2026); a 12-core deployment commonly saves $385K-$420K/year (case-study aggregation).
- Tools: **Ora2Pg** (free, open source, Perl-based; dominant), AWS Schema Conversion Tool, EnterpriseDB EPAS (Oracle-compatibility mode), Estuary Flow, Debezium for CDC.
- The hard part is PL/SQL → PL/pgSQL: Data Patrol Technologies cites 40-80 hours per 1,000 lines of PL/SQL; one financial services migration spent $850K on PL/SQL refactoring (45% of total budget).
- Specific MNC public references are scarce; Amazon famously moved its consumer retail business off Oracle internally years ago and continues to publish PostgreSQL/Aurora customer references.

**SQL Server to PostgreSQL.** Continues at companies aggressively moving off Microsoft licensing; AWS DMS the common tooling.

**MongoDB to relational (or back)**: highly company-specific; not a broad industry trend right now.

### B8. Mobile

- **Java to Kotlin (Android)**: see A4. Meta, Pinterest, Uber, Google internal, Square, Airbnb all in mid-flight or "Kotlin-first."
- **Objective-C to Swift (iOS)**: largely complete at MNCs.
- **iOS UIKit to SwiftUI**: active migration at Apple-ecosystem MNCs through 2025-2026.
- **Android Views to Jetpack Compose**: Google's official direction; active migration at Android-first shops.
- **React Native vs Flutter migrations**: company-specific; no broad industry migration in either direction.

### B9. Cloud / infrastructure (architectural rather than language)

- On-prem to cloud (AWS/Azure/GCP) continuing; Microsoft projects Australian public cloud spending to reach AUD 22.4B in 2026 (83% increase from 2022, per appinventiv 2026).
- Monolith to microservices: still happening, slower than 2018 peak; many organizations now consolidating microservices back into "modular monoliths."
- VMs to containers/Kubernetes: mature.
- Manual deploy to GitOps/IaC (Terraform, Pulumi, OpenTofu, Crossplane, ArgoCD, Flux): mature at digital natives; emerging at traditional enterprises.

---

## Cross-cutting: AI-assisted code transformation tool landscape

| Tool | Vendor | Approach | Best for |
|---|---|---|---|
| Amazon Q Code Transformation | AWS | LLM + agents | Java 8/11 → 17/21, Spring Boot 2.7 → 3.2, internal AWS code |
| IBM watsonx Code Assistant for Z | IBM | Granite LLMs + ADDI + on-prem | COBOL/PL/I/JCL/Assembler/REXX understand-explain-refactor-transform |
| GitHub Copilot App Modernization for .NET / Java | Microsoft | LLM + agents | .NET Framework → .NET 8/10; Java upgrades (Microsoft's recommended path after Upgrade Assistant deprecation) |
| Mechanical Orchard Imogen | Mechanical Orchard / Thoughtworks | Behavior-equivalent rewrite (data-flow focus) | Mainframe COBOL/Assembler/Easytrieve → Java/cloud |
| OpenRewrite / Moderne | Moderne | Deterministic AST (Lossless Semantic Tree) + recipes | Java, Kotlin, Groovy, JavaScript/TypeScript, Python, C# migrations, javax→jakarta, Spring upgrades, security CVE remediation; auditable |
| Diffblue Cover | Diffblue | AI test generation | Java test backfill before migration |
| mLogica | mLogica | Automation framework + services | COBOL/Assembler/JCL/Easytrieve to Java/C#/PowerShell; IMS to Db2 |
| Cognition Devin / Sourcegraph Cody / Codemod.com | various | LLM agents / codemod scripts | Various; emerging |

---

## Cross-cutting: Indian IT services revenue context

- Mainframe modernization market: $8.39B (2025) → $13.34B (2030), 9.7% CAGR; key vendors per MarketsandMarkets: IBM, TCS, Capgemini, Atos, AWS, Micro Focus, BMC, Infosys, Wipro, HCL Tech, DXC, Kyndryl, Rocket, Fujitsu, Cognizant, Tech Mahindra, Broadcom, TmaxSoft.
- TCS Mastercraft has transformed 300M+ lines of legacy code to Java; TCS manages 500M+ mainframe MIPS; 220+ patents in code analysis/transformation.
- Infosys: FY24 large-deal TCV was a record $17.7B (52% net new); Q4 FY24 alone was $4.5B (Infosys PR Newswire, April 18, 2024). Notable 2024 mega-deals include a $1.5B 15-year AI/modernization MoU (CIO Coverage / Infosys exchange filing) and a $2B 5-year AI-and-automation modernization framework with an existing strategic client (Outlook Business, citing Infosys exchange statement).
- Infosys Resolution Life Australasia mainframe-virtualization case explicitly cited proprietary accelerators (Infosys SEC 6-K, FY2024); CIO Peter Histon: "Infosys brought a number of proprietary accelerators to the table as part of the virtualization which helped us to deliver the solution rapidly."
- Wipro 2024 revenue: $10.8B; PCITS revenue ~$475M; >1,300 PCITS migration projects (Gartner PCITS Magic Quadrant G00823162).
- Cognizant 2024 PCITS revenue: $7.7B+ (Gartner MQ).
- Q2 FY26 (calendar Q2 2025) results showed TCS reduced headcount by 19,755, Wipro grew by 8,203, Tech Mahindra slightly down to 78,528; attrition moderating at HCL (12.6%) and Infosys (12.9%), elevated at Wipro (14.3%).

---

## Top 10 most active MNC tech-debt fronts RIGHT NOW

| Rank | Front | Drivers | Estimated active budget |
|---|---|---|---|
| 1 | SAP ECC → S/4HANA | Hard 2027 deadline; >60% of installed base un-migrated | ~$89B services TAM (analyst sizing) |
| 2 | Java 8/11 → 17/21/25 + Spring Boot 2 → 3/4 + javax → jakarta | Oracle pricing; Spring/Boot EOL cascade; Java 17 baseline | Tens of billions across enterprises |
| 3 | COBOL mainframe → Java/cloud at banks, insurers, US federal (SSA, IRS) | Skills cliff; regulatory pressure; AI economics | $8.4B → $13.3B market by 2030 |
| 4 | .NET Framework → .NET 8/10 | EOL pressure; cross-platform/cloud cost | Multi-billion enterprise spend |
| 5 | C/C++ → Rust at hyperscalers + CISA mandate | Memory safety; CISA Jan 1, 2026 roadmap deadline | Hundreds of millions in eng cost at Google/Meta/MS alone |
| 6 | Oracle DB → PostgreSQL | Licensing cost; cloud portability | $350K-$500K annual savings per mid-size enterprise; aggregate billions |
| 7 | Vue 2 → Vue 3 + Node 18 → 22 + Angular version cascade | EOL cliffs; security CVEs | Lower per-program cost but very broad |
| 8 | AngularJS → Angular / React / Vue | EOL since Dec 2021; CVE accumulation | Long tail at legacy enterprises |
| 9 | Java → Kotlin (Android) | Modern language; null safety | Mature at Meta, Pinterest, Uber, Google |
| 10 | UIKit → SwiftUI / Android Views → Jetpack Compose | Apple/Google official direction | Substantial at consumer apps |

---

## Where the consulting money is flowing

- **Indian IT services majors** (TCS, Infosys, Wipro, HCL, Tech Mahindra, Cognizant) are positioning AI-accelerated modernization as their primary growth narrative against headwinds in traditional outsourcing; Infosys's FY24 large-deal TCV of $17.7B is the headline data point.
- **IBM Consulting + IBM Software**: leveraging watsonx Code Assistant for Z to recapture mainframe-modernization spend that risked flowing to AWS/Azure replatforming.
- **Accenture + Avanade + Deloitte + Capgemini + Atos + DXC + Kyndryl**: each capturing portions of SAP S/4HANA, mainframe, and cloud migration spend.
- **Mechanical Orchard**: $84M raised (Series A $24M Feb 2024 at $95M valuation; Series B $50M led by GV Aug 2024); Thoughtworks partnership announced April 3, 2025; signed customers in banking, automotive, manufacturing (with Thoughtworks), retail, and Latin American insurance (SulAmérica).
- **Moderne** (commercial OpenRewrite): courting platform engineering teams at large enterprises; controversial December 2024 relicensing of rewrite-java-security to MPL reflects competitive pressure from Amazon Q, Sourcegraph, Broadcom.
- **HeroDevs**: monetizing the long tail of EOL frameworks (AngularJS, Vue 2, Nuxt 2, Node 18, .NET 6) via Never-Ending Support subscriptions — a fast-growing category serving organizations that cannot migrate by EOL dates.

---

## Highest-failure-rate migrations and why

1. **Big-bang core banking replacements.** Per McKinsey's "How to get a core banking transformation right: Eight mistakes to avoid": "only about 30% of CBS transformations succeeded in carrying out a complete migration of ledgers and products to a new system… We've seen banks overspend by 100 percent and timelines increase by 50 to 100 percent." Commonwealth Bank's $1.5B over 5 years (2008-2013) is the cautionary success; TSB's 2018 cutover (£330M cost, £49M fraud losses, CEO resignation, 200,000+ customer complaints) is the canonical disaster. German banks have abandoned entire programs.
2. **Government mainframe rewrites.** IRS Individual Master File still in production at 60+ years, retirement now slipped to 2030; IRS Business Master File modernization estimated at $549M and slipping; SSA COBOL rewrite pushed by DOGE in 2025 widely judged technically infeasible on its proposed months-long timeline (BMC's John McKenny: "You don't know what you're talking about; those who have tried have failed and quietly walked away").
3. **Conflated transformations** that combine language migration + business process redesign + cloud move + org restructuring in one program. The strongest current safe pattern is incremental "strangler" / "sidecar" with characterization testing.
4. **Compatibility-pack reliance** to defer SAP ECC migration past 2027 — iLAB cites a global insurance company that lost a valid path forward for 40% of its custom ABAP-driven finance workflows mid-project.

---

## Where deterministic AST refactoring (e.g., Refactron) competes vs. LLM-territory vs. consulting-services-territory

**Deterministic AST/codemod territory (Refactron, OpenRewrite, codemod.com, jscodeshift compete strongly):**
- javax → jakarta namespace conversion (millions of imports across the enterprise)
- AWS SDK v2 → v3 call-site rewrites
- React class components → function components with hooks
- CommonJS → ESM
- Spring Boot 2.x → 3.x property and annotation renames
- Hibernate annotation updates
- Test framework version migrations (JUnit 4 → 5)
- Audit-grade regulatory-environment migrations where reviewers must trust the transformation
- Mass dependency upgrades across hundreds/thousands of repos (Moderne's wheelhouse)
- Python pyupgrade-style minor-version cleanups

**LLM/agent territory (Amazon Q, IBM watsonx, Imogen, GitHub Copilot dominate):**
- COBOL/Assembler/PL/I to Java rewrites (semantically complex, undocumented business rules)
- Spring Security 6 configuration rewrites (where every codebase looks different)
- Major version jumps where new APIs replace old ones in non-mechanical ways
- Code understanding/explanation of legacy code with no documentation
- Filling in tests for legacy code (Diffblue + Q hybrid)
- Cross-language behavior-equivalent rewrites where 1:1 syntax mapping is insufficient

**Consulting-services territory (TCS, Infosys, Wipro, Accenture, IBM Consulting, Deloitte own the budget):**
- Full SAP ECC → S/4HANA programs (process redesign, master-data quality, change management dominate the cost)
- Big-bank core platform replacements
- Government mainframe modernization (security clearances, regulatory liaison, multi-vendor integration)
- Anything where data quality, master-data, integration testing, and organizational change exceed the code-change burden
- Programs >$10M almost always run through SI partners

---

## Recommendations (staged, decision-ready)

**For a deterministic AST-based refactoring tool vendor (Refactron-positioning) over the next 6 months:**

1. **Lead with javax → jakarta** as the primary wedge case. The pain is universal, the transformation is overwhelmingly mechanical, the customer is forced (Spring Boot 3+ requirement), and OpenRewrite has the only mature deterministic offering. If you can match OpenRewrite's quality and offer something OpenRewrite cannot (e.g., better diff-review UX, lower-friction CI/CD integration, better licensing terms post-MPL controversy), you have a credible entry point.
2. **Pair with AWS SDK v2 → v3 and Spring Boot 2 → 3 property migrations** as the next two recipe lines. These compound the value of the same enterprise Java customer.
3. **Position against Moderne's MPL controversy.** Many Moderne customers and contributors are unhappy with the December 2024 relicensing. A clean Apache 2.0 alternative with comparable recipe quality could win share.
4. **Stay out of COBOL.** That is LLM + behavior-equivalence + consulting territory now (Mechanical Orchard, IBM watsonx, mLogica). A deterministic AST tool will not win there because the source code is rarely the source of truth.
5. **Stay out of full SAP S/4HANA.** That is consulting territory; the code transformation is <20% of the program cost.
6. **Consider .NET selectively.** Microsoft has bet on LLMs (Copilot App Modernization) post-Upgrade-Assistant deprecation; there is a deterministic gap in mid-market .NET 6/8/10 audits where customers want reproducibility.
7. **Benchmarks that would change these recommendations:** if Mechanical Orchard or IBM watsonx demonstrates audit-grade reproducibility on COBOL-to-Java (currently they do not), the consulting-territory boundary shifts; if Moderne reverses the MPL relicensing and re-opens rewrite-java-security, the Apache 2.0 positioning loses force.

**For an enterprise CIO planning 2026-2027:**

1. **SAP ECC customers:** sign your S/4HANA implementation partner in H1 2026 or accept the consultant-supply premium; budget for 30-42 months on complex multi-country estates.
2. **Java enterprise:** get to Java 17 + Spring Boot 3.5 in 2026 as a stepping stone to Java 25 + Spring Boot 4 by 2027; pilot Amazon Q or watsonx on a 1-2 application sample before mass rollout; use OpenRewrite for the javax → jakarta mechanical phase.
3. **.NET enterprise:** subscribe to GitHub Copilot App Modernization for .NET; target .NET 8 immediately and .NET 10 by November 2026 when .NET 8 LTS ends.
4. **Banks with mainframes:** abandon big-bang; adopt sidecar/strangler; pilot Mechanical Orchard or IBM watsonx Code Assistant for Z on a single bounded workload (e.g., one product line) before committing.
5. **C/C++ shops:** publish a CISA-compliant memory safety roadmap by January 1, 2026; default new modules to Rust; do not attempt mass C → Rust rewrites.
6. **Anything front-end:** if you are on Vue 2, Nuxt 2, AngularJS, or Node 18, you are already past EOL — either subscribe to HeroDevs NES as a bridge or finish migration in 2026.

---

## Caveats

- Several headline figures are analyst-aggregated (MarketsandMarkets $13.34B by 2030; IC Euro $89B SAP S/4HANA services TAM); treat as directional, not precise.
- The SSA / DOGE COBOL story rests primarily on a single WIRED report (Makena Kelly, March 28, 2025); secondary coverage all traces back to it. The actual technical execution status as of May 2026 is opaque.
- Vendor-published case studies (Amazon Q customer testimonials, IBM watsonx customer testimonials, Mechanical Orchard / Thoughtworks anonymized customers) reflect early/best-case data; failure data is systematically underreported.
- Mechanical Orchard's "Reflections on the first year of Imogen" (April 27, 2026) is a recent primary source but the company has been deliberately reticent about naming customers; only SulAmérica and Omni Logistics are publicly named.
- The Moderne / OpenRewrite December 2024 relicensing controversy is documented from Jonathan Leitschuh's contributor perspective; there is no public Moderne refutation cited.
- Indian IT vendors' AI-modernization narratives are partly marketing; revenue attribution between "modernization" and "general digital transformation" is not consistently broken out in earnings releases.
- Java 8/17/21/25 adoption percentages differ across surveys (Azul 2025, JetBrains, Eclipse Jakarta EE 2025, Stack Overflow); methodology and respondent self-selection vary.
- The Swiggy "74% Kotlin / 50% crash reduction" figure comes from a secondary marketing-style blog rather than Swiggy's own engineering blog; verify before citing externally.
- The Lloyds £3B figure is secondary (WebProNews aggregation); Lloyds annual reports would be the primary source to verify.
- The byteiota Rust market figures (35% YoY job posting growth, $130K mid-career, $235K senior) are an industry compilation rather than primary survey data.
- "Treat as ongoing": this report describes a moving market. EOL dates, Spring/Java/Node release cadence, and consulting deal flow are all evolving on a quarterly basis through 2026-2027.