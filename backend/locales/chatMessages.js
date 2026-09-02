// backend/locales/chatMessages.js
//
// Phase 3: fixed visitor-facing message dictionaries/templates for the
// chatbot backend, in en/tr/ar. Every English value here was migrated
// verbatim (byte-identical) from its previous home — chatReplyBuilder.js,
// chatDistrictScope.js, chatLeadFlow.js, utils/leadCapture.js, and one
// literal that lived directly in routes/chat.js — so the default English
// output of every caller stays unchanged. Turkish/Arabic values are new
// translations authored for this phase; see the Phase 3 report for which
// strings still want a native-speaker pass before shipping.
//
// This module is pure data (plus tiny same-shape getters) — no composition,
// no pluralization, no list-joining. That logic lives in
// services/chatReplyRenderer.js, which is also the only place that applies
// the "missing key -> fall back to English -> log, never throw" policy.
// Templates use {placeholder} tokens, interpolated by the renderer's
// format() helper.

export const CHAT_MESSAGES = {
  en: {
    nonPropertyPage: 'For now, I can help with property searches. Service pages will be supported soon.',

    // Shown when a knowledge question matched no curated topic — see
    // utils/knowledgeAnswer.js. Never a guess.
    knowledge: {
      noMatchFallback: "I don't have verified information on that specific question, so I'd rather not guess. For legal, tax, or citizenship details, a licensed real estate lawyer or the Land Registry can give you a reliable answer. In the meantime, I'm happy to help you search for properties.",
    },

    nonProperty: {
      casual: "I'm doing well, thank you. I'm here to help you find the right property. Are you looking to buy, rent, or just exploring?",
      emotional: "I'm sorry to hear that. I hope your day gets better. I'm mainly here to help with property search, so whenever you're ready, tell me what kind of home you're looking for.",
      contact: 'Sure. You can contact the VarliKent team through the contact form or WhatsApp details on the property page. If you tell me which property you are interested in, I can help you narrow it down.',
      service: 'VarliKent can help with real estate, architecture, construction, renovation, and interior design services. Which service would you like to know more about?',
      unknown: 'I can help you search for properties by buy/rent, apartment/villa, district, budget, rooms, or lifestyle needs like sea view, family-friendly community, luxury, or investment. What are you looking for?',
    },

    slotQuestion: {
      listingType: 'Are you looking to buy or rent?',
      propertyType: 'What type of property are you looking for — apartment, villa, office, or something else?',
      district: 'Do you have a preferred district?',
      budget: 'Do you have a budget range in mind?',
      generic: 'Could you tell me a bit more about what you are looking for?',
    },

    slotFragment: {
      listingType: 'whether you are looking to buy or rent',
      propertyType: 'what type of property you are looking for',
      district: 'your preferred district',
      budget: 'your budget range',
    },
    multiSlotQuestionTemplate: 'Could you tell me {fragments}?',

    refinementOffer: {
      listingType: 'Are you looking to buy or rent?',
      propertyType: 'Do you prefer an apartment, villa, or another property type?',
      district: 'Do you have a preferred district?',
      budget: 'Do you have a budget range in mind?',
    },

    refinementReoffer: {
      listingType: "Whenever you're ready, I'm happy to narrow this down to buy or rent.",
      propertyType: "Whenever you're ready, I can narrow this down by property type.",
      district: "Whenever you're ready, I can narrow this down to a specific district.",
      budget: "Whenever you're ready, let me know your budget and I can narrow this down further.",
    },

    mixedListingNotice: 'These results include both properties for sale and for rent — each listing keeps its own type shown, since sale prices and monthly rents are not on the same scale.',

    noResults: {
      plain: "I couldn't find any available properties right now. Try adjusting your district, budget, or property type.",
      descriptionAttempted: "I couldn't find a strong match from the property descriptions yet.",
      descriptionAttemptedSuffix: 'Try adding a district, budget, or property type.',
    },

    // Honest wording for an open-ended requirement that no semantic or
    // description search could verify (chatPolicyEngine.deriveSoftOutcome).
    // Terminal, never promising a broaden/contact action the route does not
    // perform, and never claiming any listing satisfies the requirement.
    softUnverified: {
      noResults: "I couldn't confirm that specific requirement from our current listing descriptions.",
      withAlternatives: "I couldn't confirm that specific requirement from the current listing descriptions. The options below are broader alternatives that match some of your other criteria.",
    },

    featureLabel: {
      furnished: 'furnished',
      balcony: 'a balcony',
      elevator: 'an elevator',
      pool: 'a pool',
      garden: 'a garden',
      parking: 'parking',
    },

    grammar: { andWord: 'and', orWord: 'or', listSeparator: ', ', andWordGlued: false, dropCommaBeforeConjunction: false },

    leadFlow: {
      thankYouTemplate: "Thank you, {name}! I've passed your details to our team and they will reach out to you at {phone} soon.",
      saveFailure: "I collected your details but couldn't save them just now — please try the contact form or WhatsApp instead, and our team will assist you.",
      cancellation: "No problem — I won't send these details. Let me know if you change your mind.",
      correctionRetryPrefix: "Sorry, I didn't quite catch that. ",
      missingFieldsIntroWithProperty: 'Sure, I can help arrange an appointment for this property.',
      missingFieldsIntroGeneric: 'Great, I can have our team reach out to you.',
      missingFieldsSingleTemplate: '{intro} Could you also share your {field}?',
      missingFieldsMultiTemplate: '{intro} Please send your {fields} in one message.',
      fieldName: { name: 'name', phone: 'phone number', email: 'email', preferredTime: 'preferred appointment time' },
      confirmationIntro: 'I have these details:',
      confirmationLabel: {
        name: 'Name', phone: 'Phone', email: 'Email', interest: 'Interest',
        property: 'Property', searchContext: 'Property/search', preferredTime: 'Preferred contact time',
      },
      confirmationOutro: 'Should I send this to our team?',
      disambiguationTemplate: 'Which property would you like to schedule the appointment for — the {list} one?',
      ordinal: { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth' },
      // Display-only mapping of buildInterestType()'s canonical, UNCHANGED
      // return value ('Buying'/'Renting'/'General') for the visitor-facing
      // confirmation summary. buildInterestType() itself, and the value
      // persisted to ContactSubmission.interestType, are never touched by
      // this map — see chatLeadFlow.js/leadCapture.js for that boundary.
      interestTypeDisplay: { Buying: 'Buying', Renting: 'Renting', General: 'General' },
    },

    districtScope: {
      questionTemplate: 'Should I keep searching in {district}, or include other districts with {concepts} {typeLabel}?',
      retryTemplate: 'Sorry, just to confirm — should I keep searching in {district}, or search other districts too?',
      conceptFallback: 'that',
    },
    dateTime: {
      now: "It's currently {datetime} in Istanbul.",
    },

    propertyName: {
      resolved: "Here's the listing for {title}.",
      noMatch: "I couldn't find a listing called \"{phrase}\". I can search by district, price, property type or features instead — just tell me what you're looking for.",
      ambiguous: 'I found more than one listing matching "{phrase}": {list}. Which one did you mean?',
      lookupFailed: "I couldn't look that listing up just now. Please try again in a moment.",
    },
    areaInfo: {
      intro: 'Here are the closest {category} to {title}:',
      attribution: '© OpenStreetMap contributors',
      item: '{name} — about {distance} away',
      noCategory: "Which kind of place would you like me to look for near {target}? For example a school, a metro station, a hospital, a park or a supermarket.",
      noLocation: "We don't have enough location information for {title} to check what's nearby.",
      noResults: 'I could not find any {category} within about {radius} km of {title}.',
      providerError: "I couldn't check nearby places right now. Please try again in a moment.",
      placeNotFound: "I couldn't find a place called \"{phrase}\" in the Istanbul area. I can also look around one of our listings by name.",
      placeError: "I couldn't look that place up right now. Please try again in a moment.",
    },
  },

  tr: {
    nonPropertyPage: 'Şimdilik yalnızca mülk aramalarında yardımcı olabilirim. Hizmet sayfaları yakında desteklenecek.',

    // Shown when a knowledge question matched no curated topic — see
    // utils/knowledgeAnswer.js. Never a guess.
    knowledge: {
      noMatchFallback: "Bu soruya dair doğrulanmış bir bilgim yok, bu yüzden tahmin yürütmek istemem. Hukuki, vergi veya vatandaşlık detayları için ruhsatlı bir gayrimenkul avukatına ya da Tapu Müdürlüğüne danışabilirsiniz. Bu arada mülk aramanızda size memnuniyetle yardımcı olabilirim.",
    },

    nonProperty: {
      casual: 'İyiyim, teşekkür ederim. Size doğru mülkü bulmakta yardımcı olmak için buradayım. Satın almak mı, kiralamak mı istiyorsunuz, yoksa sadece göz mü atıyorsunuz?',
      emotional: 'Bunu duyduğuma üzüldüm. Umarım gününüz düzelir. Ben daha çok mülk arama konusunda yardımcı oluyorum, o yüzden hazır olduğunuzda nasıl bir ev aradığınızı söyleyebilirsiniz.',
      contact: 'Tabii. VarliKent ekibine mülk sayfasındaki iletişim formu veya WhatsApp bilgileri üzerinden ulaşabilirsiniz. Hangi mülkle ilgilendiğinizi söylerseniz, seçiminizi daraltmanıza yardımcı olabilirim.',
      service: 'VarliKent gayrimenkul, mimarlık, inşaat, renovasyon ve iç tasarım hizmetlerinde yardımcı olabilir. Hangi hizmet hakkında daha fazla bilgi almak istersiniz?',
      unknown: 'Satın alma/kiralama, daire/villa, bölge, bütçe, oda sayısı veya deniz manzarası, aileye uygun bir topluluk, lüks ya da yatırım gibi yaşam tarzı ihtiyaçlarına göre mülk aramanıza yardımcı olabilirim. Ne arıyorsunuz?',
    },

    slotQuestion: {
      listingType: 'Satın almak mı yoksa kiralamak mı istiyorsunuz?',
      propertyType: 'Ne tür bir mülk arıyorsunuz — daire, villa, ofis, yoksa başka bir şey mi?',
      district: 'Tercih ettiğiniz bir bölge var mı?',
      budget: 'Aklınızda bir bütçe aralığı var mı?',
      generic: 'Ne aradığınız hakkında biraz daha bilgi verebilir misiniz?',
    },

    slotFragment: {
      listingType: 'satın almak mı yoksa kiralamak mı istediğinizi',
      propertyType: 'ne tür bir mülk aradığınızı',
      district: 'tercih ettiğiniz bölgeyi',
      budget: 'bütçe aralığınızı',
    },
    multiSlotQuestionTemplate: '{fragments} söyler misiniz?',

    refinementOffer: {
      listingType: 'Satın almak mı yoksa kiralamak mı istiyorsunuz?',
      propertyType: 'Daire, villa, yoksa başka bir mülk türü mü tercih edersiniz?',
      district: 'Tercih ettiğiniz bir bölge var mı?',
      budget: 'Aklınızda bir bütçe aralığı var mı?',
    },

    refinementReoffer: {
      listingType: 'Hazır olduğunuzda, bunu satın alma veya kiralama olarak daraltmaktan memnuniyet duyarım.',
      propertyType: 'Hazır olduğunuzda, mülk türüne göre daraltabilirim.',
      district: 'Hazır olduğunuzda, belirli bir bölgeye daraltabilirim.',
      budget: 'Hazır olduğunuzda, bütçenizi belirtirseniz daha da daraltabilirim.',
    },

    mixedListingNotice: 'Bu sonuçlar hem satılık hem de kiralık mülkleri içeriyor — satış fiyatları ve aylık kiralar aynı ölçekte olmadığından, her ilan kendi türüyle gösterilmeye devam ediyor.',

    noResults: {
      plain: 'Şu anda uygun bir mülk bulamadım. Bölgenizi, bütçenizi veya mülk türünüzü değiştirmeyi deneyin.',
      descriptionAttempted: 'Mülk açıklamalarından güçlü bir eşleşme bulamadım.',
      descriptionAttemptedSuffix: 'Bir bölge, bütçe veya mülk türü eklemeyi deneyin.',
    },

    softUnverified: {
      noResults: 'Bu özel isteği mevcut ilan açıklamalarımızdan doğrulayamadım.',
      withAlternatives: 'Bu özel isteği mevcut ilan açıklamalarından doğrulayamadım. Aşağıdaki seçenekler, diğer bazı kriterlerinize uyan daha genel alternatiflerdir.',
    },

    featureLabel: {
      furnished: 'eşyalı',
      balcony: 'balkon',
      elevator: 'asansör',
      pool: 'havuz',
      garden: 'bahçe',
      parking: 'otopark',
    },

    // dropCommaBeforeConjunction: Turkish list style omits the comma before
    // "ve"/"veya" for 3+ items ("daire, villa ve stüdyo", not "daire, villa,
    // ve stüdyo" — the latter is an English Oxford-comma habit, not natural
    // Turkish).
    grammar: { andWord: 've', orWord: 'veya', listSeparator: ', ', andWordGlued: false, dropCommaBeforeConjunction: true },

    leadFlow: {
      thankYouTemplate: 'Teşekkür ederim, {name}! Bilgilerinizi ekibimize ilettim, en kısa sürede sizi {phone} numaranızdan arayacaklar.',
      saveFailure: "Bilgilerinizi aldım ama şu anda kaydedemedim — lütfen iletişim formunu veya WhatsApp'ı deneyin, ekibimiz size yardımcı olacaktır.",
      cancellation: 'Sorun değil — bu bilgileri göndermeyeceğim. Fikrinizi değiştirirseniz haber verin.',
      correctionRetryPrefix: 'Üzgünüm, tam anlayamadım. ',
      missingFieldsIntroWithProperty: 'Tabii, bu mülk için bir randevu ayarlamanıza yardımcı olabilirim.',
      missingFieldsIntroGeneric: 'Harika, ekibimizin sizinle iletişime geçmesini sağlayabilirim.',
      missingFieldsSingleTemplate: '{intro} {field} bilginizi de paylaşabilir misiniz?',
      missingFieldsMultiTemplate: '{intro} Lütfen {fields} bilgilerinizi tek bir mesajda gönderin.',
      fieldName: { name: 'isim', phone: 'telefon numarası', email: 'e-posta', preferredTime: 'tercih ettiğiniz randevu zamanı' },
      confirmationIntro: 'Şu bilgilere sahibim:',
      confirmationLabel: {
        name: 'İsim', phone: 'Telefon', email: 'E-posta', interest: 'İlgi Alanı',
        property: 'Mülk', searchContext: 'Mülk/arama', preferredTime: 'Tercih edilen iletişim zamanı',
      },
      confirmationOutro: 'Bunu ekibimize göndereyim mi?',
      disambiguationTemplate: 'Randevuyu hangi mülk için ayarlamamı istersiniz — {list} olanı mı?',
      ordinal: { 1: 'birinci', 2: 'ikinci', 3: 'üçüncü', 4: 'dördüncü', 5: 'beşinci' },
      interestTypeDisplay: { Buying: 'Satın Alma', Renting: 'Kiralama', General: 'Genel' },
    },

    districtScope: {
      questionTemplate: '{district} bölgesinde aramaya devam edeyim mi, yoksa {concepts} {typeLabel} olan başka bölgeleri de dahil edeyim mi?',
      retryTemplate: 'Üzgünüm, sadece teyit etmek istedim — {district} bölgesinde aramaya devam edeyim mi, yoksa başka bölgelere de bakayım mı?',
      conceptFallback: 'bunu',
    },
    dateTime: {
      now: "İstanbul'da şu anda {datetime}.",
    },

    propertyName: {
      resolved: '{title} ilanı burada.',
      noMatch: '"{phrase}" adında bir ilan bulamadım. Dilerseniz bölge, fiyat, mülk tipi veya özelliklere göre arayabilirim — ne aradığınızı söylemeniz yeterli.',
      ambiguous: '"{phrase}" ile eşleşen birden fazla ilan buldum: {list}. Hangisini kastetmiştiniz?',
      lookupFailed: 'Bu ilanı şu anda sorgulayamadım. Lütfen birazdan tekrar deneyin.',
    },
    areaInfo: {
      intro: '{title} konumuna en yakın {category}:',
      attribution: '© OpenStreetMap contributors',
      item: '{name} — yaklaşık {distance}',
      noCategory: '{target} yakınında ne aramamı istersiniz? Örneğin okul, metro istasyonu, hastane, park veya süpermarket.',
      noLocation: '{title} için yakındaki yerleri kontrol edecek yeterli konum bilgimiz yok.',
      noResults: '{title} çevresinde yaklaşık {radius} km içinde {category} bulamadım.',
      providerError: 'Yakındaki yerleri şu anda kontrol edemedim. Lütfen birazdan tekrar deneyin.',
      placeNotFound: 'İstanbul bölgesinde \"{phrase}\" adında bir yer bulamadım. Dilerseniz ilanlarımızdan birinin adıyla da çevresine bakabilirim.',
      placeError: 'Bu yeri şu anda sorgulayamadım. Lütfen birazdan tekrar deneyin.',
    },
  },

  ar: {
    nonPropertyPage: 'في الوقت الحالي، يمكنني المساعدة في البحث عن العقارات فقط. سيتم دعم صفحات الخدمات قريباً.',

    // Shown when a knowledge question matched no curated topic — see
    // utils/knowledgeAnswer.js. Never a guess.
    knowledge: {
      noMatchFallback: "لا تتوفر لديّ معلومات مؤكدة عن هذا السؤال تحديداً، ولا أفضّل التخمين. للحصول على تفاصيل قانونية أو ضريبية أو تتعلق بالجنسية، يمكن لمحامٍ عقاري مرخّص أو دائرة الطابو تقديم إجابة موثوقة. وفي هذه الأثناء، يسعدني مساعدتك في البحث عن عقار.",
    },

    nonProperty: {
      casual: 'بخير، شكراً لك. أنا هنا لمساعدتك في إيجاد العقار المناسب. هل تبحث عن الشراء، أم الإيجار، أم أنك تستكشف فقط؟',
      emotional: 'يؤسفني سماع ذلك. أتمنى أن يتحسن يومك. أنا هنا بشكل أساسي للمساعدة في البحث عن العقارات، فمتى ما كنت مستعداً، أخبرني عن نوع المنزل الذي تبحث عنه.',
      contact: 'بالتأكيد. يمكنك التواصل مع فريق فارلي كنت عبر نموذج الاتصال أو واتساب الموجودين في صفحة العقار. إذا أخبرتني بالعقار الذي يهمك، يمكنني مساعدتك في تحديد اختيارك.',
      service: 'يمكن لفارلي كنت مساعدتك في خدمات العقارات والعمارة والإنشاء والتجديد والتصميم الداخلي. عن أي خدمة تود معرفة المزيد؟',
      unknown: 'يمكنني مساعدتك في البحث عن العقارات حسب الشراء/الإيجار، الشقة/الفيلا، المنطقة، الميزانية، عدد الغرف، أو احتياجات نمط الحياة مثل الإطلالة البحرية، مجتمع مناسب للعائلات، الفخامة، أو الاستثمار. ماذا تبحث عنه؟',
    },

    slotQuestion: {
      listingType: 'هل تبحث عن الشراء أم الإيجار؟',
      propertyType: 'ما نوع العقار الذي تبحث عنه — شقة، فيلا، مكتب، أم شيء آخر؟',
      district: 'هل لديك منطقة مفضلة؟',
      budget: 'هل لديك نطاق ميزانية في ذهنك؟',
      generic: 'هل يمكنك إخباري بمزيد من التفاصيل عمّا تبحث عنه؟',
    },

    slotFragment: {
      listingType: 'ما إذا كنت تبحث عن الشراء أم الإيجار',
      propertyType: 'نوع العقار الذي تبحث عنه',
      district: 'المنطقة التي تفضلها',
      budget: 'نطاق ميزانيتك',
    },
    multiSlotQuestionTemplate: 'هل يمكنك إخباري ب{fragments}؟',

    refinementOffer: {
      listingType: 'هل تبحث عن الشراء أم الإيجار؟',
      propertyType: 'هل تفضل شقة أو فيلا أم نوعاً آخر من العقارات؟',
      district: 'هل لديك منطقة مفضلة؟',
      budget: 'هل لديك نطاق ميزانية في ذهنك؟',
    },

    refinementReoffer: {
      listingType: 'عندما تكون مستعداً، يسعدني تضييق البحث إلى الشراء أو الإيجار.',
      propertyType: 'عندما تكون مستعداً، يمكنني تضييق البحث حسب نوع العقار.',
      district: 'عندما تكون مستعداً، يمكنني تضييق البحث إلى منطقة محددة.',
      budget: 'عندما تكون مستعداً، أخبرني بميزانيتك لأتمكن من تضييق البحث أكثر.',
    },

    mixedListingNotice: 'تتضمن هذه النتائج عقارات للبيع وأخرى للإيجار — يحتفظ كل إعلان بنوعه الخاص، لأن أسعار البيع والإيجار الشهري ليست على نفس المقياس.',

    noResults: {
      plain: 'لم أتمكن من العثور على أي عقارات متاحة حالياً. حاول تعديل المنطقة أو الميزانية أو نوع العقار.',
      descriptionAttempted: 'لم أتمكن من العثور على تطابق قوي من أوصاف العقارات حتى الآن.',
      descriptionAttemptedSuffix: 'جرّب إضافة منطقة أو ميزانية أو نوع عقار.',
    },

    softUnverified: {
      noResults: 'لم أتمكن من تأكيد هذا الشرط من أوصاف الإعلانات الحالية.',
      withAlternatives: 'لم أتمكن من تأكيد هذا الشرط من أوصاف الإعلانات الحالية. الخيارات أدناه بدائل أوسع تطابق بعض معاييرك الأخرى.',
    },

    featureLabel: {
      furnished: 'مفروشة',
      balcony: 'شرفة',
      elevator: 'مصعد',
      pool: 'مسبح',
      garden: 'حديقة',
      parking: 'موقف سيارات',
    },

    grammar: { andWord: 'و', orWord: 'أو', listSeparator: '، ', andWordGlued: true, dropCommaBeforeConjunction: false },

    leadFlow: {
      thankYouTemplate: 'شكراً لك، {name}! لقد أرسلت بياناتك إلى فريقنا وسيتواصلون معك على {phone} قريباً.',
      saveFailure: 'لقد جمعت بياناتك لكن تعذّر حفظها الآن — يرجى تجربة نموذج الاتصال أو واتساب بدلاً من ذلك، وسيساعدك فريقنا.',
      cancellation: 'لا مشكلة — لن أرسل هذه البيانات. أخبرني إذا غيّرت رأيك.',
      correctionRetryPrefix: 'عذراً، لم أفهم ذلك تماماً. ',
      missingFieldsIntroWithProperty: 'بالتأكيد، يمكنني مساعدتك في ترتيب موعد لهذا العقار.',
      missingFieldsIntroGeneric: 'رائع، يمكنني تكليف فريقنا بالتواصل معك.',
      missingFieldsSingleTemplate: '{intro} هل يمكنك أيضاً مشاركة {field}؟',
      missingFieldsMultiTemplate: '{intro} يرجى إرسال {fields} في رسالة واحدة.',
      fieldName: { name: 'اسمك', phone: 'رقم هاتفك', email: 'بريدك الإلكتروني', preferredTime: 'وقت الموعد المفضل' },
      confirmationIntro: 'لدي هذه البيانات:',
      confirmationLabel: {
        name: 'الاسم', phone: 'الهاتف', email: 'البريد الإلكتروني', interest: 'الاهتمام',
        property: 'العقار', searchContext: 'العقار/البحث', preferredTime: 'وقت التواصل المفضل',
      },
      confirmationOutro: 'هل أرسل هذا إلى فريقنا؟',
      disambiguationTemplate: 'لأي عقار تود ترتيب الموعد — العقار {list}؟',
      ordinal: { 1: 'الأول', 2: 'الثاني', 3: 'الثالث', 4: 'الرابع', 5: 'الخامس' },
      interestTypeDisplay: { Buying: 'الشراء', Renting: 'الإيجار', General: 'عام' },
    },

    districtScope: {
      questionTemplate: 'هل أستمر في البحث في {district}، أم أشمل مناطق أخرى تحتوي على {typeLabel} {concepts}؟',
      retryTemplate: 'عذراً، أردت فقط التأكد — هل أستمر في البحث في {district}، أم أبحث في مناطق أخرى أيضاً؟',
      conceptFallback: 'ذلك',
    },
    dateTime: {
      now: 'الوقت الآن في إسطنبول {datetime}.',
    },

    propertyName: {
      resolved: 'إليك تفاصيل عقار {title}.',
      noMatch: 'لم أجد عقاراً باسم "{phrase}". يمكنني البحث حسب المنطقة أو السعر أو نوع العقار أو المزايا بدلاً من ذلك — فقط أخبرني بما تبحث عنه.',
      ambiguous: 'وجدت أكثر من عقار يطابق "{phrase}": {list}. أي واحد تقصد؟',
      lookupFailed: 'لم أتمكن من البحث عن هذا العقار الآن. يرجى المحاولة بعد قليل.',
    },
    areaInfo: {
      intro: 'إليك أقرب {category} إلى {title}:',
      attribution: '© OpenStreetMap contributors',
      item: '{name} — على بعد {distance} تقريباً',
      noCategory: 'ما نوع المكان الذي تريد أن أبحث عنه بالقرب من {target}؟ مثلاً مدرسة أو محطة مترو أو مستشفى أو حديقة أو سوبر ماركت.',
      noLocation: 'لا تتوفر لدينا معلومات موقع كافية عن {title} للتحقق من الأماكن القريبة.',
      noResults: 'لم أعثر على {category} ضمن حوالي {radius} كم من {title}.',
      providerError: 'لم أتمكن من التحقق من الأماكن القريبة الآن. يرجى المحاولة بعد قليل.',
      placeNotFound: 'لم أجد مكاناً باسم \"{phrase}\" في منطقة إسطنبول. يمكنني أيضاً البحث حول أحد عقاراتنا بالاسم.',
      placeError: 'لم أتمكن من البحث عن هذا المكان الآن. يرجى المحاولة بعد قليل.',
    },
  },
}

export const SUPPORTED_MESSAGE_LANGUAGES = ['en', 'tr', 'ar']
export const DEFAULT_MESSAGE_LANGUAGE = 'en'
