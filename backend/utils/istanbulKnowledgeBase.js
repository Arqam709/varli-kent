// backend/utils/istanbulKnowledgeBase.js
//
// Curated knowledge base for GENERAL Istanbul real-estate questions — the
// factual source behind the `knowledge_question` intent. Transplanted from the
// donor project, whose header records that every legal/tax/citizenship figure
// here was checked on 2026-08-11 against legal/immigration-advisory sources
// (Global Citizen Solutions, Legal500, getgoldenvisa.com, kaymaz.av.tr).
//
// This file is the SINGLE SOURCE OF TRUTH for what the chatbot may state as
// fact on these subjects. Nothing here is generated at request time, and
// utils/knowledgeAnswer.js returns this text rather than paraphrasing it, so a
// wrong tax rate can only ever come from this file being wrong — not from a
// model improvising. That matters more here than anywhere else in the chatbot:
// a wrong property filter shows the wrong flat, a wrong citizenship threshold
// is a real financial and legal liability for the reader.
//
// Structure: topicId -> { category, en, tr, ar }.
//   category — 'legal_tax_citizenship' (gets STANDARD_DISCLAIMER and the
//              last-verified line appended) or 'district_lifestyle' (neither:
//              describing a neighbourhood's character needs no legal hedge).
//   en/tr/ar — the answer text itself. Three languages because that is exactly
//              what CURRENT's chat pipeline supports: locales/chatMessages.js
//              declares SUPPORTED_MESSAGE_LANGUAGES = ['en','tr','ar'] and
//              utils/chatLanguage.js normalises everything else to 'en', so a
//              German, Russian or Urdu visitor already receives English
//              chatbot replies. Adding de/ru/ur here alone would make these
//              answers inconsistent with every other reply the bot sends, and
//              would mean translating legal thresholds by hand.
//
// The donor also carried five `service_offering` topics (architecture,
// construction, renovation, interior design, overview). Those are deliberately
// NOT included: CURRENT already answers service questions through its own
// `website_service_question` intent in services/chatReplyBuilder.js, and
// importing the donor's service keywords would have let this feature quietly
// take that intent over.

export const KNOWLEDGE_TOPIC_CATEGORY = {
  LEGAL_TAX_CITIZENSHIP: 'legal_tax_citizenship',
  DISTRICT_LIFESTYLE: 'district_lifestyle',
}

/*
 * When the legal/tax/citizenship figures above were last checked, per the
 * donor's own header. Surfaced to the reader on those answers so a stale
 * figure is visibly stale rather than silently authoritative.
 *
 * Deliberately worded as "last verified", never "officially verified": the
 * donor checked advisory sources, not a government register, and claiming
 * otherwise would be a stronger assurance than the evidence supports.
 */
export const KNOWLEDGE_VERIFIED_ON = '2026-08-11'

export const KNOWLEDGE_VERIFIED_NOTE = {
  en: 'Information last verified: 11 August 2026.',
  tr: 'Bilgilerin son doğrulanma tarihi: 11 Ağustos 2026.',
  ar: 'آخر تحقق من المعلومات: 11 أغسطس 2026.',
}

// Appended to legal/tax/citizenship answers only. Carried over from the donor
// unchanged — weakening it would be the one edit here with real-world cost.
export const STANDARD_DISCLAIMER = {
  en: "This is general information, not legal or tax advice — rules can change and your specific situation may have details that matter, so please confirm with a licensed real estate lawyer or the Land Registry before making decisions.",
  tr: "Bu genel bir bilgilendirmedir, hukuki veya mali tavsiye niteliğinde değildir — kurallar değişebilir ve sizin durumunuzun önemli olabilecek özel detayları olabilir, bu yüzden karar vermeden önce lütfen ruhsatlı bir gayrimenkul avukatına veya Tapu Müdürlüğüne danışın.",
  ar: "هذه معلومات عامة وليست استشارة قانونية أو ضريبية — فالقوانين قد تتغير، وقد تنطوي حالتك الخاصة على تفاصيل مهمة، لذا يُرجى التأكد من التفاصيل مع محامٍ عقاري مرخّص أو دائرة الطابو (السجل العقاري) قبل اتخاذ أي قرار.",
}

// ─── Legal / tax / citizenship topics ──────────────────────────────────────
const legalTopics = {
  buying_process: {
    category: KNOWLEDGE_TOPIC_CATEGORY.LEGAL_TAX_CITIZENSHIP,
    en: `The standard process for a foreign buyer purchasing property in Turkey (current as of 2026):
1. Choose a property and agree on the price with the seller or agency.
2. Get a Turkish tax number from any tax office (only a passport is needed).
3. Open a Turkish bank account — recommended, and required if the buyer wants to use the VAT-exemption route.
4. Get a property valuation report from a licensed appraiser — this is now mandatory for foreign buyers.
5. Optionally sign a reservation/deposit agreement, then proceed to the notarized sale process.
6. Apply to the Land Registry Office (Tapu Müdürlüğü) for the title transfer. Both parties (or their power-of-attorney representatives) attend, the title deed transfer tax is paid, and the buyer receives the title deed (tapu).
7. Register utilities (water, electricity, gas) in the new owner's name.`,
    tr: `Türkiye'de mülk satın alan yabancı bir alıcı için standart süreç (2026 itibarıyla):
1. Mülk seçilir ve satıcı veya emlak ofisiyle fiyat üzerinde anlaşılır.
2. Herhangi bir vergi dairesinden Türk vergi numarası alınır (sadece pasaport yeterlidir).
3. Türkiye'de bir banka hesabı açılır — önerilir, ve KDV istisnası yolunu kullanmak isteyen alıcılar için gereklidir.
4. Lisanslı bir eksperden mülk değerleme raporu alınır — bu artık yabancı alıcılar için zorunludur.
5. İsteğe bağlı olarak bir rezervasyon/depozito sözleşmesi imzalanır, ardından noter onaylı satış süreci başlar.
6. Tapu devri için Tapu Müdürlüğüne başvurulur. Her iki taraf (veya vekaletnameli temsilcileri) katılır, tapu harcı ödenir ve alıcı tapu senedini alır.
7. Su, elektrik, doğalgaz gibi hizmetler yeni malik adına kaydedilir.`,
    ar: `الخطوات المعتادة لشراء عقار في تركيا كمشترٍ أجنبي (حتى عام 2026):
1. اختيار العقار والاتفاق على السعر مع البائع أو الوكالة العقارية.
2. الحصول على رقم ضريبي تركي من أي دائرة ضريبية (يكفي جواز السفر فقط).
3. فتح حساب مصرفي في تركيا — أمر مُوصى به، وضروري إذا رغب المشتري في الاستفادة من مسار الإعفاء من ضريبة القيمة المضافة.
4. الحصول على تقرير تقييم للعقار من خبير مرخّص — وهذا إجراء إلزامي الآن للمشترين الأجانب.
5. يمكن اختيارياً توقيع اتفاقية حجز/دفعة مقدمة، ثم المتابعة إلى إجراءات البيع الموثّقة.
6. التقديم إلى دائرة السجل العقاري (الطابو) لنقل الملكية. يحضر الطرفان (أو من يوكلونهما) الجلسة، يتم دفع رسم نقل الطابو، ويحصل المشتري على سند الملكية (الطابو).
7. تسجيل خدمات المياه والكهرباء والغاز باسم المالك الجديد.`,
  },

  required_documents: {
    category: KNOWLEDGE_TOPIC_CATEGORY.LEGAL_TAX_CITIZENSHIP,
    en: `Documents typically required from a foreign buyer purchasing property in Turkey (current as of 2026):
- A valid passport, with a certified Turkish translation for the notary/Land Registry.
- A Turkish tax identification number.
- Turkish bank account details.
- Passport-style photos (usually 2).
- A property valuation report (mandatory for foreign buyers).
- A power of attorney document, only if the buyer will not be present in person to sign.`,
    tr: `Türkiye'de mülk satın alan bir yabancı alıcıdan genellikle istenen belgeler (2026 itibarıyla):
- Noter/Tapu Müdürlüğü için onaylı Türkçe tercümesiyle birlikte geçerli bir pasaport.
- Türk vergi numarası.
- Türkiye'deki banka hesabı bilgileri.
- Vesikalık fotoğraf (genellikle 2 adet).
- Mülk değerleme raporu (yabancı alıcılar için zorunludur).
- Alıcı işlemler için şahsen bulunmayacaksa vekaletname belgesi.`,
    ar: `المستندات التي يُطلب من المشتري الأجنبي تقديمها عادةً عند شراء عقار في تركيا (حتى عام 2026):
- جواز سفر ساري المفعول، مع ترجمة تركية معتمدة لدى الكاتب العدل/دائرة الطابو.
- رقم ضريبي تركي.
- بيانات حساب مصرفي في تركيا.
- صور شخصية بحجم صور جواز السفر (عادةً صورتان).
- تقرير تقييم للعقار (إلزامي للمشترين الأجانب).
- وثيقة وكالة رسمية (بالوكالة)، فقط إذا لم يكن المشتري حاضراً شخصياً للتوقيع.`,
  },

  property_taxes: {
    category: KNOWLEDGE_TOPIC_CATEGORY.LEGAL_TAX_CITIZENSHIP,
    en: `Annual property tax (emlak vergisi) in Turkey — current as of 2026:
- Residential property: 0.1%–0.2% of the property's assessed value per year.
- Commercial property: 0.2%–0.4% per year.
- Land: 0.3%–0.6% per year.
These rates are effectively doubled in metropolitan municipalities ("büyükşehir"), which includes Istanbul, so in Istanbul specifically you should generally expect figures toward the higher end of these ranges — the exact multiplier mechanics can vary somewhat by municipality, so this should be treated as a general expectation rather than an exact number.
There is also a one-time title deed transfer tax (tapu harcı) at the time of purchase, which is a separate fee — see the buying-process/tax-on-purchase topic for that.`,
    tr: `Türkiye'de yıllık emlak vergisi — 2026 itibarıyla:
- Konut: mülkün rayiç değerinin yıllık %0,1–%0,2'si.
- Ticari mülk: yıllık %0,2–%0,4'ü.
- Arsa: yıllık %0,3–%0,6'sı.
Bu oranlar büyükşehir belediyelerinde (İstanbul da dahil) fiilen iki katına çıkmaktadır, dolayısıyla özellikle İstanbul'da genellikle bu aralıkların üst sınırına yakın değerler beklenmelidir — tam çarpan mekanizması belediyeye göre biraz değişebilir, bu yüzden bunu kesin bir rakam değil genel bir beklenti olarak değerlendirin.
Satın alma anında ödenen ayrı, tek seferlik bir tapu harcı da vardır — bu konu için satın alma süreci/vergi başlığına bakınız.`,
    ar: `ضريبة العقار السنوية (إملاك) في تركيا — حتى عام 2026:
- العقارات السكنية: من 0.1% إلى 0.2% من القيمة المقدَّرة للعقار سنوياً.
- العقارات التجارية: من 0.2% إلى 0.4% سنوياً.
- الأراضي: من 0.3% إلى 0.6% سنوياً.
هذه النسب تُضاعَف عملياً في بلديات المدن الكبرى ("بويوك شهير")، ومن ضمنها إسطنبول، لذا في إسطنبول تحديداً يُتوقع عموماً أن تكون النسب أقرب إلى الحد الأعلى من هذه النطاقات — وقد تختلف آلية المضاعفة الدقيقة قليلاً بين البلديات، فمن الأفضل اعتبار هذا توقعاً عاماً وليس رقماً نهائياً.
هناك أيضاً رسم نقل ملكية (طابو) يُدفع مرة واحدة عند الشراء، وهو رسم مختلف — راجع موضوع عملية الشراء/الضرائب لهذا الرسم.`,
  },

  transfer_tax: {
    category: KNOWLEDGE_TOPIC_CATEGORY.LEGAL_TAX_CITIZENSHIP,
    en: `Title deed transfer tax (tapu harcı) in Turkey — current as of 2026:
- The tax is 4% of the property's declared value, paid at the Land Registry Office (Tapu Müdürlüğü).
- By law it is split 2% buyer / 2% seller, but customary practice in the Turkish market is that the buyer pays the full 4% unless separately negotiated with the seller.
- There is no extra "foreigner surcharge" on this 4% rate — foreign and Turkish buyers pay exactly the same percentage.
- There is a separate, smaller, fixed administrative fee (the "döner sermaye" / revolving-fund fee) charged by the Land Registry, which is higher when the transfer is from a foreign buyer than when it is between two Turkish parties. This fee is a small fixed government charge, not a percentage of the property price.`,
    tr: `Türkiye'de tapu harcı — 2026 itibarıyla:
- Tapu Müdürlüğünde ödenen bu harç, mülkün beyan edilen değerinin %4'üdür.
- Kanunen %2 alıcı / %2 satıcı olarak paylaştırılır, ancak Türk piyasasında yaygın uygulama, ayrıca anlaşılmadığı sürece alıcının %4'ün tamamını ödemesidir.
- Bu %4'lük oranda yabancılar için ekstra bir "yabancı farkı" yoktur — yabancı ve Türk alıcılar tam olarak aynı oranı öder.
- Tapu Müdürlüğü tarafından alınan, ayrı ve daha küçük sabit bir idari ücret (döner sermaye ücreti) de vardır; bu ücret, devir yabancı bir alıcıdan yapıldığında iki Türk taraf arasındaki devre kıyasla daha yüksektir. Bu ücret, mülk fiyatının bir yüzdesi değil, küçük ve sabit bir devlet ücretidir.`,
    ar: `رسم نقل ملكية الطابو في تركيا — حتى عام 2026:
- يبلغ الرسم 4% من القيمة المصرَّح بها للعقار، ويُدفع في دائرة السجل العقاري (الطابو).
- قانونياً يُقسَّم الرسم 2% على المشتري و2% على البائع، لكن الممارسة المتعارف عليها في السوق التركي هي أن يدفع المشتري نسبة 4% كاملة، إلا إذا تم الاتفاق على غير ذلك مع البائع.
- لا توجد رسوم إضافية "خاصة بالأجانب" على هذه النسبة 4% — يدفع المشترون الأجانب والتركيون النسبة ذاتها بالضبط.
- توجد رسوم إدارية ثابتة أصغر ومنفصلة (رسم "الصندوق الدوّار") تفرضها دائرة السجل العقاري، وهي أعلى عندما يكون النقل من مشترٍ أجنبي مقارنةً بالنقل بين طرفين تركيين. هذه الرسوم مبلغ حكومي ثابت وصغير، ولا تُحسب كنسبة من سعر العقار.`,
  },

  vat_exemption: {
    category: KNOWLEDGE_TOPIC_CATEGORY.LEGAL_TAX_CITIZENSHIP,
    en: `VAT exemption for foreign buyers in Turkey (KDV istisnası, Turkish VAT Law Article 13/i) — current as of 2026:
- Can save up to 18% on the purchase of NEW-BUILD residential or commercial units (first sale directly from the developer). It does NOT apply to resale/secondhand properties.
- Eligibility: foreign nationals who have not resided in Turkey in the 6 months before the purchase, paying in foreign currency transferred from abroad — or Turkish citizens who have lived/worked abroad for 6 months or more.
- Payment must be made through a Turkish bank, in foreign currency, before the title transfer takes place.
- The buyer must not sell or transfer the property within 1 year of purchase, or the exemption is clawed back with interest.`,
    tr: `Türkiye'de yabancı alıcılar için KDV istisnası (KDV Kanunu Madde 13/i) — 2026 itibarıyla:
- SIFIR (yeni inşa edilmiş) konut veya ticari birimlerin satın alımında (doğrudan müteahhitten ilk satış) %18'e kadar tasarruf sağlanabilir. İkinci el mülklerde bu istisna uygulanmaz.
- Uygunluk: satın almadan önceki 6 ay içinde Türkiye'de ikamet etmemiş, ödemeyi yurt dışından transfer edilen döviz ile yapan yabancı vatandaşlar — veya 6 ay ya da daha uzun süre yurt dışında yaşamış/çalışmış Türk vatandaşları.
- Ödeme, tapu devri gerçekleşmeden önce bir Türk bankası aracılığıyla ve döviz olarak yapılmalıdır.
- Alıcı, satın alımdan itibaren 1 yıl içinde mülkü satamaz veya devredemez; aksi halde istisna faiziyle birlikte geri alınır.`,
    ar: `الإعفاء من ضريبة القيمة المضافة للمشترين الأجانب في تركيا (المادة 13/i من قانون ضريبة القيمة المضافة التركي) — حتى عام 2026:
- يمكن توفير ما يصل إلى 18% عند شراء وحدات سكنية أو تجارية جديدة (بيع أول مباشرة من المطوّر). لا ينطبق هذا الإعفاء على العقارات المستعملة (البيع الثاني).
- شروط الاستحقاق: أن يكون المشتري من الأجانب الذين لم يقيموا في تركيا خلال الأشهر الستة السابقة للشراء، وأن يتم الدفع بعملة أجنبية محوّلة من الخارج — أو أن يكون المشتري مواطناً تركياً عاش أو عمل في الخارج لمدة 6 أشهر أو أكثر.
- يجب أن يتم الدفع عبر بنك تركي وبعملة أجنبية قبل إتمام نقل الملكية (الطابو).
- يجب على المشتري عدم بيع أو نقل ملكية العقار خلال سنة واحدة من الشراء، وإلا يتم استرداد قيمة الإعفاء مع الفوائد.`,
  },

  citizenship_investment: {
    category: KNOWLEDGE_TOPIC_CATEGORY.LEGAL_TAX_CITIZENSHIP,
    en: `Turkish citizenship by real estate investment — current as of 2026:
- Minimum investment: $400,000 USD (raised from $250,000 in June 2022).
- The property (or properties) must be held for at least 3 years — the title deed carries a sale-restriction annotation during that period.
- The investment can be a single property or several properties that together total $400,000 or more, and can be residential, commercial, or land.
- Typical processing timeline: 3 to 6 months.
- There is no separate residency requirement to qualify. The applicant's spouse and children under 18 can be included in the same application.`,
    tr: `Gayrimenkul yatırımı yoluyla Türk vatandaşlığı — 2026 itibarıyla:
- Minimum yatırım tutarı: 400.000 ABD Doları (Haziran 2022'de 250.000 dolardan yükseltilmiştir).
- Mülk (veya mülkler) en az 3 yıl elde tutulmalıdır — bu süre boyunca tapuda satış kısıtlaması şerhi bulunur.
- Yatırım tek bir mülk olabileceği gibi, toplamda 400.000 doları bulan birden fazla mülk de olabilir; konut, ticari veya arsa şeklinde olabilir.
- Tipik işlem süresi: 3 ila 6 ay.
- Başvuru için ayrıca bir ikamet şartı yoktur. Başvuru sahibinin eşi ve 18 yaşından küçük çocukları aynı başvuruya dahil edilebilir.`,
    ar: `الجنسية التركية عن طريق الاستثمار العقاري — حتى عام 2026:
- الحد الأدنى للاستثمار: 400,000 دولار أمريكي (تمت زيادته من 250,000 دولار في يونيو 2022).
- يجب الاحتفاظ بالعقار (أو العقارات) لمدة لا تقل عن 3 سنوات — ويُدرج قيد يمنع البيع على سند الطابو خلال هذه الفترة.
- يمكن أن يكون الاستثمار في عقار واحد أو عدة عقارات يبلغ إجمالي قيمتها 400,000 دولار أو أكثر، ويمكن أن تكون سكنية أو تجارية أو أرضاً.
- المدة المعتادة لمعالجة الطلب: من 3 إلى 6 أشهر.
- لا يوجد شرط إقامة منفصل للتأهل. يمكن ضم زوج/زوجة مقدّم الطلب وأبنائه دون 18 عاماً إلى نفس الطلب.`,
  },
}

// ─── District lifestyle topics ─────────────────────────────────────────────
const districtTopics = {
  district_esenyurt: {
    category: KNOWLEDGE_TOPIC_CATEGORY.DISTRICT_LIFESTYLE,
    en: `Esenyurt is a fast-growing, densely populated district on the European side, known for large-scale modern housing developments and relatively accessible entry points into the market. It tends to suit young families, first-time buyers, and investors looking at rental demand from a large, diverse resident population. It is well connected by metro and major roads, though it is further from the historic/coastal core of the city.`,
    tr: `Esenyurt, Avrupa yakasında hızla büyüyen, yoğun nüfuslu bir bölgedir; büyük ölçekli modern konut projeleri ve piyasaya nispeten erişilebilir giriş noktalarıyla tanınır. Genellikle genç aileler, ilk kez ev alacaklar ve geniş, çeşitli bir nüfustan kira talebine bakan yatırımcılar için uygundur. Metro ve ana yollarla iyi bağlantılıdır, ancak şehrin tarihi/sahil merkezine daha uzaktır.`,
    ar: `إسنيورت منطقة سريعة النمو وذات كثافة سكانية عالية على الجانب الأوروبي، تشتهر بمشاريع سكنية حديثة وواسعة النطاق ونقاط دخول نسبياً ميسورة إلى السوق. تناسب عموماً العائلات الشابة، والمشترين لأول مرة، والمستثمرين المهتمين بالطلب الإيجاري من قاعدة سكانية كبيرة ومتنوعة. تتمتع باتصال جيد عبر المترو والطرق الرئيسية، لكنها أبعد عن المركز التاريخي/الساحلي للمدينة.`,
  },

  district_buyukcekmece: {
    category: KNOWLEDGE_TOPIC_CATEGORY.DISTRICT_LIFESTYLE,
    en: `Büyükçekmece is a coastal district on the European side, built around a large lagoon-like bay, with a calmer, more suburban feel than central Istanbul. It suits families and retirees looking for a quieter lifestyle with sea views and green space, as well as investors betting on continued westward growth of the city.`,
    tr: `Büyükçekmece, Avrupa yakasında büyük bir koy etrafında kurulmuş sahil bir bölgedir ve İstanbul merkezine kıyasla daha sakin, banliyö tarzı bir atmosfere sahiptir. Deniz manzarası ve yeşil alanlarla sakin bir yaşam tarzı arayan aileler ve emekliler ile şehrin batıya doğru büyümesine yatırım yapmak isteyenler için uygundur.`,
    ar: `بيوك تشكمجة منطقة ساحلية على الجانب الأوروبي، تقع حول خليج شبيه بالبحيرة، وتتميز بجو أكثر هدوءاً وطابعاً ضاحوياً مقارنة بوسط إسطنبول. تناسب العائلات والمتقاعدين الباحثين عن نمط حياة هادئ مع إطلالات بحرية ومساحات خضراء، وكذلك المستثمرين الذين يراهنون على استمرار توسع المدينة نحو الغرب.`,
  },

  district_beylikduzu: {
    category: KNOWLEDGE_TOPIC_CATEGORY.DISTRICT_LIFESTYLE,
    en: `Beylikdüzü is a planned, modern coastal district on the European side, popular for its wide boulevards, parks, marina, and organized master-planned residential complexes. It particularly suits young professionals and families wanting a newer, well-organized urban environment with good amenities and reasonably easy access to central Istanbul via metro and highway.`,
    tr: `Beylikdüzü, Avrupa yakasında planlı ve modern bir sahil bölgesidir; geniş bulvarları, parkları, marinası ve düzenli, master plana sahip konut kompleksleriyle bilinir. Özellikle daha yeni ve düzenli bir kentsel çevre, iyi olanaklar ve metro/otoyol ile merkezi İstanbul'a nispeten kolay erişim isteyen genç profesyoneller ve aileler için uygundur.`,
    ar: `بيليك دوزو منطقة ساحلية حديثة ومخططة على الجانب الأوروبي، تشتهر بجادّاتها الواسعة وحدائقها ومارينا الخاصة بها ومجمعاتها السكنية المنظّمة ذات التخطيط الشامل. تناسب بشكل خاص المهنيين الشباب والعائلات الباحثين عن بيئة حضرية أحدث ومنظمة مع مرافق جيدة وسهولة وصول نسبية إلى وسط إسطنبول عبر المترو والطريق السريع.`,
  },

  district_basaksehir: {
    category: KNOWLEDGE_TOPIC_CATEGORY.DISTRICT_LIFESTYLE,
    en: `Başakşehir is a newer, master-planned district on the European side known for modern high-rise residential projects, wide green spaces, and proximity to Istanbul Airport and the city's northern business corridor. It suits families and professionals who want a modern, orderly environment and investors drawn to the district's ongoing infrastructure growth.`,
    tr: `Başakşehir, Avrupa yakasında modern yüksek katlı konut projeleri, geniş yeşil alanları ve İstanbul Havalimanı ile şehrin kuzey iş koridoruna yakınlığıyla bilinen daha yeni, master planlı bir bölgedir. Modern ve düzenli bir çevre isteyen aileler ve profesyoneller ile bölgenin sürmekte olan altyapı gelişimine ilgi duyan yatırımcılar için uygundur.`,
    ar: `باشاك شهير منطقة أحدث ومخططة بالكامل على الجانب الأوروبي، تشتهر بمشاريعها السكنية الشاهقة الحديثة ومساحاتها الخضراء الواسعة وقربها من مطار إسطنبول والممر التجاري الشمالي للمدينة. تناسب العائلات والمهنيين الراغبين في بيئة حديثة ومنظمة، وكذلك المستثمرين المهتمين بنمو البنية التحتية المستمر في المنطقة.`,
  },

  district_kadikoy: {
    category: KNOWLEDGE_TOPIC_CATEGORY.DISTRICT_LIFESTYLE,
    en: `Kadıköy is a lively, cultural district on the Asian side, known for its ferry connections, cafes, nightlife, arts scene, and a strong sense of neighborhood community. It particularly suits young professionals, students, and anyone wanting a walkable, culturally rich urban lifestyle close to the Bosphorus.`,
    tr: `Kadıköy, Anadolu yakasında hareketli, kültürel bir bölgedir; vapur bağlantıları, kafeleri, gece hayatı, sanat ortamı ve güçlü bir mahalle topluluğu duygusuyla bilinir. Özellikle Boğaz'a yakın, yürünebilir ve kültürel açıdan zengin bir kentsel yaşam tarzı isteyen genç profesyoneller, öğrenciler ve herkes için uygundur.`,
    ar: `كاديكوي منطقة نابضة بالحياة وذات طابع ثقافي على الجانب الآسيوي، تشتهر باتصالاتها بالعبّارات ومقاهيها وحياتها الليلية ومشهدها الفني وإحساسها القوي بالانتماء للحي. تناسب بشكل خاص المهنيين الشباب والطلاب وأي شخص يبحث عن نمط حياة حضري نابض بالحياة الثقافية وقريب من البوسفور ويمكن التنقل فيه سيراً على الأقدام.`,
  },

  district_besiktas: {
    category: KNOWLEDGE_TOPIC_CATEGORY.DISTRICT_LIFESTYLE,
    en: `Beşiktaş is a central, prestigious district on the European side along the Bosphorus, mixing historic character with a dense business and university presence. It suits professionals wanting to be close to the city center and Bosphorus views, as well as families who value good schools and established infrastructure, though it is a busy, urban environment rather than a quiet suburb.`,
    tr: `Beşiktaş, Avrupa yakasında Boğaz kıyısında yer alan, tarihi karakteri yoğun bir iş ve üniversite ortamıyla birleştiren merkezi ve prestijli bir bölgedir. Şehir merkezine ve Boğaz manzarasına yakın olmak isteyen profesyoneller ile iyi okulları ve köklü altyapıyı önemseyen aileler için uygundur; ancak sakin bir banliyöden ziyade hareketli, kentsel bir çevredir.`,
    ar: `بشكتاش منطقة مركزية ومرموقة على الجانب الأوروبي بمحاذاة البوسفور، تجمع بين الطابع التاريخي وحضور تجاري وجامعي كثيف. تناسب المهنيين الراغبين بالقرب من وسط المدينة وإطلالات البوسفور، وكذلك العائلات التي تقدّر المدارس الجيدة والبنية التحتية الراسخة، مع أنها بيئة حضرية مزدحمة أكثر من كونها ضاحية هادئة.`,
  },

  district_sisli: {
    category: KNOWLEDGE_TOPIC_CATEGORY.DISTRICT_LIFESTYLE,
    en: `Şişli is a central business and shopping district on the European side, home to major office towers, hospitals, and shopping malls alongside established residential streets. It suits professionals working nearby and investors seeking strong rental demand from a central, highly connected location, though it is dense and traffic-heavy rather than quiet.`,
    tr: `Şişli, Avrupa yakasında merkezi bir iş ve alışveriş bölgesidir; köklü konut sokaklarının yanı sıra büyük ofis kulelerine, hastanelere ve alışveriş merkezlerine ev sahipliği yapar. Yakında çalışan profesyoneller ve merkezi, iyi bağlantılı bir konumdan güçlü kira talebi arayan yatırımcılar için uygundur; ancak sakin olmaktan çok yoğun ve trafiği kalabalık bir bölgedir.`,
    ar: `شيشلي منطقة تجارية وتسويقية مركزية على الجانب الأوروبي، تحتضن أبراج مكاتب كبرى ومستشفيات ومراكز تسوق إلى جانب شوارع سكنية راسخة. تناسب المهنيين العاملين بالقرب منها والمستثمرين الباحثين عن طلب إيجاري قوي من موقع مركزي وجيد الاتصال، لكنها منطقة مزدحمة وكثيفة الحركة المرورية أكثر من كونها هادئة.`,
  },

  district_uskudar: {
    category: KNOWLEDGE_TOPIC_CATEGORY.DISTRICT_LIFESTYLE,
    en: `Üsküdar is a historic, family-oriented district on the Asian side with a strong traditional character, waterfront promenades, and Bosphorus views. It suits families and retirees looking for a more conservative, community-feeling neighborhood with good ferry/metro links to the European side.`,
    tr: `Üsküdar, Anadolu yakasında güçlü bir geleneksel karaktere, sahil yürüyüş yollarına ve Boğaz manzarasına sahip, tarihi ve aile odaklı bir bölgedir. Avrupa yakasına iyi vapur/metro bağlantılarına sahip, daha muhafazakâr ve topluluk hissi güçlü bir mahalle arayan aileler ve emekliler için uygundur.`,
    ar: `أوسكودار منطقة تاريخية وعائلية على الجانب الآسيوي، تتميز بطابع تقليدي قوي وممرات مشي على الواجهة البحرية وإطلالات على البوسفور. تناسب العائلات والمتقاعدين الباحثين عن حي أكثر تحفظاً وذي طابع مجتمعي، مع روابط جيدة عبر العبّارات والمترو إلى الجانب الأوروبي.`,
  },

  district_sariyer: {
    category: KNOWLEDGE_TOPIC_CATEGORY.DISTRICT_LIFESTYLE,
    en: `Sarıyer is an upscale, green district at the northern end of the European side of the Bosphorus, known for waterfront villages, forested areas, and some of the city's most exclusive residential addresses. It suits affluent families, retirees, and investors seeking premium, low-density, nature-adjacent living, generally further from the busiest central business districts.`,
    tr: `Sarıyer, Boğaz'ın Avrupa yakasının kuzey ucunda yer alan, sahil köyleri, ormanlık alanları ve şehrin en özel konut adreslerinden bazılarıyla bilinen üst düzey, yeşil bir bölgedir. Lüks, düşük yoğunluklu ve doğaya yakın bir yaşam arayan varlıklı aileler, emekliler ve yatırımcılar için uygundur; genellikle en yoğun merkezi iş bölgelerinden daha uzaktır.`,
    ar: `ساريير منطقة راقية وخضراء تقع في الطرف الشمالي للجانب الأوروبي من البوسفور، وتشتهر بقراها الساحلية ومناطقها الحرجية وبعض أرقى العناوين السكنية في المدينة. تناسب العائلات الميسورة والمتقاعدين والمستثمرين الباحثين عن سكن راقٍ منخفض الكثافة وقريب من الطبيعة، وهي عموماً أبعد عن أكثر مناطق الأعمال المركزية ازدحاماً.`,
  },

  district_bakirkoy: {
    category: KNOWLEDGE_TOPIC_CATEGORY.DISTRICT_LIFESTYLE,
    en: `Bakırköy is a well-established coastal district on the European side, close to the airport and city center, with a mix of older residential neighborhoods and a marina area. It suits families and professionals wanting a settled, convenient location with good transport links and some seafront lifestyle appeal.`,
    tr: `Bakırköy, havalimanına ve şehir merkezine yakın, Avrupa yakasında köklü bir sahil bölgesidir; eski konut mahalleleri ile bir marina bölgesinin bir karışımını sunar. Yerleşik, ulaşımı kolay ve biraz sahil yaşamı çekiciliği olan bir konum isteyen aileler ve profesyoneller için uygundur.`,
    ar: `باكركوي منطقة ساحلية راسخة على الجانب الأوروبي، قريبة من المطار ووسط المدينة، وتجمع بين أحياء سكنية قديمة ومنطقة مارينا. تناسب العائلات والمهنيين الراغبين في موقع مستقر ومريح مع روابط نقل جيدة وقدر من جاذبية الحياة على الواجهة البحرية.`,
  },

  district_kagithane: {
    category: KNOWLEDGE_TOPIC_CATEGORY.DISTRICT_LIFESTYLE,
    en: `Kağıthane is a centrally located, rapidly redeveloping district on the European side, with a growing number of modern residential towers replacing older industrial and low-rise areas. It suits professionals and investors seeking central-Istanbul access at a relatively more accessible price point than the most prestigious Bosphorus-front districts.`,
    tr: `Kağıthane, Avrupa yakasında merkezi bir konuma sahip, hızla yeniden gelişen bir bölgedir; eski sanayi ve alçak katlı alanların yerini artan sayıda modern konut kulesi almaktadır. Merkezi İstanbul'a erişimi, en prestijli Boğaz kıyısı bölgelerine kıyasla nispeten daha erişilebilir bir fiyat noktasında isteyen profesyoneller ve yatırımcılar için uygundur.`,
    ar: `كاغيتهانه منطقة ذات موقع مركزي وتشهد إعادة تطوير سريعة على الجانب الأوروبي، حيث يحل عدد متزايد من الأبراج السكنية الحديثة محل المناطق الصناعية والمباني المنخفضة القديمة. تناسب المهنيين والمستثمرين الباحثين عن الوصول إلى وسط إسطنبول بسعر أكثر سهولة نسبياً مقارنة بأكثر مناطق واجهة البوسفور شهرة.`,
  },

  district_fatih: {
    category: KNOWLEDGE_TOPIC_CATEGORY.DISTRICT_LIFESTYLE,
    en: `Fatih is the historic heart of Istanbul on the European side, home to major landmarks, the old city walls, and a traditional, dense urban fabric. It suits buyers drawn to historic character and heritage properties, and investors interested in tourism-driven demand, though building stock is often older and more varied in condition than in newer districts.`,
    tr: `Fatih, Avrupa yakasında İstanbul'un tarihi kalbidir; önemli tarihi mekanlara, eski şehir surlarına ve geleneksel, yoğun bir kentsel dokuya ev sahipliği yapar. Tarihi karaktere ve mirası olan mülklere ilgi duyan alıcılar ile turizm odaklı taleple ilgilenen yatırımcılar için uygundur; ancak bina stoku genellikle daha eski ve daha yeni bölgelere kıyasla durum açısından daha değişkendir.`,
    ar: `الفاتح هو القلب التاريخي لإسطنبول على الجانب الأوروبي، ويحتضن معالم بارزة وأسوار المدينة القديمة ونسيجاً حضرياً تقليدياً وكثيفاً. تناسب المشترين المهتمين بالطابع التاريخي والعقارات التراثية، والمستثمرين المهتمين بالطلب المرتبط بالسياحة، مع أن المخزون العقاري غالباً أقدم وأكثر تفاوتاً في حالته مقارنة بالمناطق الأحدث.`,
  },

  district_zeytinburnu: {
    category: KNOWLEDGE_TOPIC_CATEGORY.DISTRICT_LIFESTYLE,
    en: `Zeytinburnu is a well-connected coastal district on the European side, close to the city center and popular with international buyers thanks to strong tram/metro links and ongoing urban renewal projects. It suits investors and families seeking convenient transport and relatively accessible entry into a central location.`,
    tr: `Zeytinburnu, Avrupa yakasında şehir merkezine yakın, iyi bağlantılı bir sahil bölgesidir; güçlü tramvay/metro bağlantıları ve sürmekte olan kentsel dönüşüm projeleri sayesinde uluslararası alıcılar arasında popülerdir. Uygun ulaşım ve merkezi bir konuma nispeten erişilebilir giriş arayan yatırımcılar ve aileler için uygundur.`,
    ar: `زيتون بورنو منطقة ساحلية جيدة الاتصال على الجانب الأوروبي، قريبة من وسط المدينة وتحظى بشعبية بين المشترين الدوليين بفضل روابط الترام/المترو القوية ومشاريع التجديد الحضري المستمرة. تناسب المستثمرين والعائلات الباحثين عن نقل مريح ودخول ميسور نسبياً إلى موقع مركزي.`,
  },

  district_avcilar: {
    category: KNOWLEDGE_TOPIC_CATEGORY.DISTRICT_LIFESTYLE,
    en: `Avcılar is a coastal district on the European side with a significant student population thanks to nearby universities, alongside established residential neighborhoods along the Marmara Sea. It suits students, young renters, and investors interested in rental demand, as well as families looking for a seaside setting further from the busiest city center.`,
    tr: `Avcılar, yakınındaki üniversiteler sayesinde önemli bir öğrenci nüfusuna sahip, Marmara Denizi kıyısında köklü konut mahalleleriyle birlikte Avrupa yakasında bir sahil bölgesidir. Öğrenciler, genç kiracılar ve kira talebiyle ilgilenen yatırımcılar ile şehrin en yoğun merkezinden daha uzak bir sahil ortamı arayan aileler için uygundur.`,
    ar: `أفجلار منطقة ساحلية على الجانب الأوروبي تضم عدداً كبيراً من الطلاب بفضل الجامعات القريبة، إلى جانب أحياء سكنية راسخة على بحر مرمرة. تناسب الطلاب والمستأجرين الشباب والمستثمرين المهتمين بالطلب الإيجاري، وكذلك العائلات الباحثة عن بيئة ساحلية أبعد عن أكثر مناطق وسط المدينة ازدحاماً.`,
  },

  district_bahcelievler: {
    category: KNOWLEDGE_TOPIC_CATEGORY.DISTRICT_LIFESTYLE,
    en: `Bahçelievler is a well-established, centrally located residential district on the European side, known for a settled family atmosphere, good schools, and convenient access to major highways and public transport. It suits families and professionals wanting a stable, mid-city residential setting without being right on the coast.`,
    tr: `Bahçelievler, Avrupa yakasında köklü ve merkezi bir konumdaki konut bölgesidir; yerleşik bir aile atmosferi, iyi okulları ve ana yollara ve toplu taşımaya uygun erişimiyle bilinir. Sahilde olmadan şehrin ortasında sabit ve rahat bir yerleşim yeri isteyen aileler ve profesyoneller için uygundur.`,
    ar: `بهتشلي إيفلر منطقة سكنية راسخة وذات موقع مركزي على الجانب الأوروبي، تشتهر بجو عائلي مستقر ومدارس جيدة وسهولة الوصول إلى الطرق السريعة الرئيسية ووسائل النقل العام. تناسب العائلات والمهنيين الراغبين في بيئة سكنية مستقرة في وسط المدينة دون أن تكون على الساحل مباشرة.`,
  },
}

export const KNOWLEDGE_BASE = { ...legalTopics, ...districtTopics }

export const KNOWLEDGE_TOPIC_IDS = Object.keys(KNOWLEDGE_BASE)

export const getKnowledgeTopic = (topicId = '') => KNOWLEDGE_BASE[topicId] || null

export const isLegalTaxCitizenshipTopic = (topicId = '') =>
  KNOWLEDGE_BASE[topicId]?.category === KNOWLEDGE_TOPIC_CATEGORY.LEGAL_TAX_CITIZENSHIP
